// SHIVNEE end-to-end encryption, modelled on the Signal protocol:
//   • X3DH         — two people agree on a shared secret using only each other's PUBLIC keys
//   • Double Ratchet — every message gets a fresh key; old keys are thrown away
//   • Sealed sender — the server can't see who sent a message, only who receives it
//
// Primitives: X25519 (key agreement), Ed25519 (signatures), HKDF/HMAC-SHA-256, AES-256-GCM.
// Implementations from the audited @noble libraries, so browser and server behave identically.

import { gcm } from '@noble/ciphers/aes.js';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { b64, concat, fromUtf8, unb64, utf8, type Bytes } from './encoding';
import type { OneTimePreKeyPublic, PreKeyBundle, SignedPreKeyPublic, UploadBundle } from './protocol';

/* ================================================================ Keys */

export interface KeyPair {
  pub: string; // base64
  priv: string; // base64 — stays on the device, inside the encrypted vault
}

export interface IdentityKeys {
  sign: KeyPair; // Ed25519: proves who you are
  dh: KeyPair; // X25519: used for key agreement
  dhSig: string; // dh.pub signed by sign.priv
}

export interface PreKey extends KeyPair {
  id: number;
}

export interface SignedPreKey extends PreKey {
  sig: string;
  createdAt: number;
}

export function generateDH(): KeyPair {
  const priv = x25519.utils.randomSecretKey();
  return { pub: b64(x25519.getPublicKey(priv)), priv: b64(priv) };
}

export function generateIdentity(): IdentityKeys {
  const signPriv = ed25519.utils.randomSecretKey();
  const sign = { pub: b64(ed25519.getPublicKey(signPriv)), priv: b64(signPriv) };
  const dh = generateDH();
  return { sign, dh, dhSig: signBytes(sign.priv, unb64(dh.pub)) };
}

export function generateSignedPreKey(id: number, identity: IdentityKeys): SignedPreKey {
  const kp = generateDH();
  return { id, ...kp, sig: signBytes(identity.sign.priv, unb64(kp.pub)), createdAt: Date.now() };
}

export function generateOneTimePreKeys(firstId: number, count: number): PreKey[] {
  return Array.from({ length: count }, (_, i) => ({ id: firstId + i, ...generateDH() }));
}

export function signBytes(privB64: string, msg: Bytes): string {
  return b64(ed25519.sign(msg, unb64(privB64)));
}

export function verifyBytes(pubB64: string, msg: Bytes, sigB64: string): boolean {
  try {
    return ed25519.verify(unb64(sigB64), msg, unb64(pubB64));
  } catch {
    return false;
  }
}

function dh(privB64: string, pubB64: string): Bytes {
  return x25519.getSharedSecret(unb64(privB64), unb64(pubB64));
}

export function uploadBundle(identity: IdentityKeys, spk: SignedPreKey, opks: PreKey[]): UploadBundle {
  return {
    ik: identity.sign.pub,
    ikDh: identity.dh.pub,
    ikDhSig: identity.dhSig,
    spk: publicSpk(spk),
    opks: opks.map(publicOpk),
  };
}

export const publicSpk = (k: SignedPreKey): SignedPreKeyPublic => ({ id: k.id, pub: k.pub, sig: k.sig });
export const publicOpk = (k: PreKey): OneTimePreKeyPublic => ({ id: k.id, pub: k.pub });

/** Checks that the keys in a bundle really belong to its identity key. */
export function verifyBundle(b: Pick<PreKeyBundle, 'ik' | 'ikDh' | 'ikDhSig' | 'spk'>): boolean {
  return verifyBytes(b.ik, unb64(b.ikDh), b.ikDhSig) && verifyBytes(b.ik, unb64(b.spk.pub), b.spk.sig);
}

/* ============================================ Fingerprints / safety numbers */

/** Short fingerprint of an identity key: "3F9A 1C7E 88D0 42B1". */
export function fingerprint(ikB64: string): string {
  const h = Array.from(sha256(unb64(ikB64)).subarray(0, 8), (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  return h.match(/.{4}/g)!.join(' ');
}

/** 60 digits (12 × 5) from both identity keys. Both sides compute exactly the same number. */
export function safetyNumber(ikA: string, ikB: string): string[] {
  const [x, y] = [ikA, ikB].sort();
  const all = concat(sha256(utf8(`${x}|${y}|0`)), sha256(utf8(`${x}|${y}|1`)));
  const groups: string[] = [];
  for (let i = 0; i < 12; i++) {
    let n = 0;
    for (let k = 0; k < 5; k++) n = n * 256 + all[i * 5 + k];
    groups.push(String(n % 100000).padStart(5, '0'));
  }
  return groups;
}

/* ================================================================= X3DH */

const ZERO32 = new Uint8Array(32);
const FF32 = new Uint8Array(32).fill(0xff);

export interface X3dhHeader {
  ik: string; // sender identity (Ed25519)
  ikDh: string; // sender identity (X25519)
  ikDhSig: string;
  ek: string; // sender's one-off ephemeral key
  spkId: number;
  opkId?: number;
}

function x3dhKdf(material: Bytes): Bytes {
  return hkdf(sha256, concat(FF32, material), ZERO32, utf8('SHIVNEE-X3DH-v1'), 32);
}

/** Alice starts a conversation using Bob's published bundle. */
export function x3dhInitiate(me: IdentityKeys, bundle: PreKeyBundle): { sk: Bytes; ad: Bytes; header: X3dhHeader } {
  if (!verifyBundle(bundle)) throw new Error('bundle signature invalid');
  const ek = generateDH();
  const parts = [
    dh(me.dh.priv, bundle.spk.pub), // DH1: my identity ↔ their signed prekey
    dh(ek.priv, bundle.ikDh), //       DH2: my ephemeral ↔ their identity
    dh(ek.priv, bundle.spk.pub), //    DH3: my ephemeral ↔ their signed prekey
  ];
  if (bundle.opk) parts.push(dh(ek.priv, bundle.opk.pub)); // DH4: my ephemeral ↔ their one-time prekey
  return {
    sk: x3dhKdf(concat(...parts)),
    ad: concat(unb64(me.sign.pub), unb64(bundle.ik)),
    header: { ik: me.sign.pub, ikDh: me.dh.pub, ikDhSig: me.dhSig, ek: ek.pub, spkId: bundle.spk.id, opkId: bundle.opk?.id },
  };
}

/** Bob computes the same secret from Alice's first message. */
export function x3dhRespond(me: IdentityKeys, spk: PreKey, opk: PreKey | undefined, h: X3dhHeader): { sk: Bytes; ad: Bytes } {
  if (!verifyBytes(h.ik, unb64(h.ikDh), h.ikDhSig)) throw new Error('sender identity signature invalid');
  const parts = [dh(spk.priv, h.ikDh), dh(me.dh.priv, h.ek), dh(spk.priv, h.ek)];
  if (h.opkId !== undefined) {
    if (!opk) throw new Error('one-time prekey already used');
    parts.push(dh(opk.priv, h.ek));
  }
  return { sk: x3dhKdf(concat(...parts)), ad: concat(unb64(h.ik), unb64(me.sign.pub)) };
}

/* ======================================================== Double Ratchet */

export interface RatchetState {
  dhs: KeyPair; // my current ratchet key
  dhr: string | null; // their current ratchet key
  rk: string; // root key
  cks: string | null; // sending chain key
  ckr: string | null; // receiving chain key
  ns: number;
  nr: number;
  pn: number;
  skipped: Record<string, string>; // "<dh>:<n>" → message key, for out-of-order delivery
  ad: string;
  steps: number; // how many times the DH ratchet has turned (shown in the UI)
}

export interface RatchetHeader {
  dh: string;
  pn: number;
  n: number;
}

const MAX_SKIP = 1000;

function kdfRK(rk: Bytes, dhOut: Bytes): [Bytes, Bytes] {
  const out = hkdf(sha256, dhOut, rk, utf8('SHIVNEE-RK'), 64);
  return [out.slice(0, 32), out.slice(32)];
}

function kdfCK(ck: Bytes): [Bytes, Bytes] {
  return [hmac(sha256, ck, Uint8Array.of(1)), hmac(sha256, ck, Uint8Array.of(2))]; // [messageKey, nextChainKey]
}

function aead(mk: Bytes, ad: Bytes) {
  const k = hkdf(sha256, mk, ZERO32, utf8('SHIVNEE-MSG'), 44);
  return gcm(k.slice(0, 32), k.slice(32, 44), ad);
}

const headerAd = (ad: string, h: RatchetHeader) => concat(unb64(ad), utf8(JSON.stringify(h)));

export function ratchetInitAlice(sk: Bytes, theirSpkPub: string, ad: Bytes): RatchetState {
  const dhs = generateDH();
  const [rk, cks] = kdfRK(sk, dh(dhs.priv, theirSpkPub));
  return { dhs, dhr: theirSpkPub, rk: b64(rk), cks: b64(cks), ckr: null, ns: 0, nr: 0, pn: 0, skipped: {}, ad: b64(ad), steps: 1 };
}

export function ratchetInitBob(sk: Bytes, mySpk: KeyPair, ad: Bytes): RatchetState {
  return { dhs: { pub: mySpk.pub, priv: mySpk.priv }, dhr: null, rk: b64(sk), cks: null, ckr: null, ns: 0, nr: 0, pn: 0, skipped: {}, ad: b64(ad), steps: 0 };
}

const clone = (s: RatchetState): RatchetState => ({ ...s, dhs: { ...s.dhs }, skipped: { ...s.skipped } });

/** Encrypts one message. Returns a NEW state — the old one must be discarded. */
export function ratchetEncrypt(state: RatchetState, plaintext: Bytes): { state: RatchetState; header: RatchetHeader; ct: string } {
  const s = clone(state);
  if (!s.cks) throw new Error('cannot send before the first reply');
  const [mk, ck] = kdfCK(unb64(s.cks));
  s.cks = b64(ck);
  const header = { dh: s.dhs.pub, pn: s.pn, n: s.ns };
  s.ns += 1;
  return { state: s, header, ct: b64(aead(mk, headerAd(s.ad, header)).encrypt(plaintext)) };
}

function skipKeys(s: RatchetState, until: number) {
  if (!s.ckr) return;
  if (s.nr + MAX_SKIP < until) throw new Error('too many skipped messages');
  while (s.nr < until) {
    const [mk, ck] = kdfCK(unb64(s.ckr));
    s.skipped[`${s.dhr}:${s.nr}`] = b64(mk);
    s.ckr = b64(ck);
    s.nr += 1;
  }
  const keys = Object.keys(s.skipped);
  if (keys.length > 2000) for (const k of keys.slice(0, keys.length - 2000)) delete s.skipped[k];
}

/** Decrypts one message. Throws (leaving the old state untouched) if it can't be authenticated. */
export function ratchetDecrypt(state: RatchetState, header: RatchetHeader, ct: string): { state: RatchetState; plaintext: Bytes } {
  const s = clone(state);
  const skippedKey = `${header.dh}:${header.n}`;
  if (s.skipped[skippedKey]) {
    const mk = unb64(s.skipped[skippedKey]);
    delete s.skipped[skippedKey];
    return { state: s, plaintext: aead(mk, headerAd(s.ad, header)).decrypt(unb64(ct)) };
  }
  if (header.dh !== s.dhr) {
    skipKeys(s, header.pn);
    // DH ratchet step: their new key → new receiving chain; my new key → new sending chain.
    s.pn = s.ns;
    s.ns = 0;
    s.nr = 0;
    s.dhr = header.dh;
    let [rk, ckr] = kdfRK(unb64(s.rk), dh(s.dhs.priv, s.dhr));
    s.ckr = b64(ckr);
    s.dhs = generateDH();
    const [rk2, cks] = kdfRK(rk, dh(s.dhs.priv, s.dhr));
    rk = rk2;
    s.rk = b64(rk);
    s.cks = b64(cks);
    s.steps += 1;
  }
  skipKeys(s, header.n);
  const [mk, ck] = kdfCK(unb64(s.ckr!));
  s.ckr = b64(ck);
  s.nr += 1;
  return { state: s, plaintext: aead(mk, headerAd(s.ad, header)).decrypt(unb64(ct)) };
}

/* ========================================================= Sealed sender */

/**
 * Wraps a payload so only the holder of `recipientIkDh` can open it — and only they learn who sent it.
 * The server sees: recipient handle + an opaque blob.
 */
export function seal(recipientIkDh: string, payload: Bytes): string {
  const e = generateDH();
  const k = hkdf(sha256, dh(e.priv, recipientIkDh), concat(unb64(e.pub), unb64(recipientIkDh)), utf8('SHIVNEE-SEAL'), 44);
  const ct = gcm(k.slice(0, 32), k.slice(32, 44)).encrypt(payload);
  return b64(concat(unb64(e.pub), ct));
}

export function unseal(me: KeyPair, sealed: string): Bytes {
  const raw = unb64(sealed);
  const ePub = b64(raw.subarray(0, 32));
  const k = hkdf(sha256, dh(me.priv, ePub), concat(raw.subarray(0, 32), unb64(me.pub)), utf8('SHIVNEE-SEAL'), 44);
  return gcm(k.slice(0, 32), k.slice(32, 44)).decrypt(raw.subarray(32));
}

/** The inner envelope (after unsealing). */
export interface InnerEnvelope {
  v: 1;
  from: string; // sender handle
  ik: string; // sender identity key
  x3dh?: X3dhHeader; // present until the sender has received a reply
  h: RatchetHeader;
  ct: string;
}

export const encodeJson = (o: unknown) => utf8(JSON.stringify(o));
export const decodeJson = <T>(b: Bytes) => JSON.parse(fromUtf8(b)) as T;
