// Account keys and the vault.
//
// Your password is stretched with PBKDF2-SHA-256 (310 000 rounds, salted with your handle) into a
// master secret, which is split with HKDF into two unrelated keys:
//
//   • the vault key (AES-256-GCM) — encrypts all your data: on this device, and the backup copy the
//     server keeps so you can sign in elsewhere. It never leaves the device.
//   • the login key — sent to the server to prove you know the password. The server stores only
//     its SHA-256 hash, and learns nothing about the vault key from it.
//
// Locally each account is one record in localStorage (ciphertext only).

import { fromB64, randomBytes, toB64, utf8 } from './crypto';

const ITERATIONS = 310_000;
const ACCOUNT_PREFIX = 'shivnee.account.';
const INDEX_KEY = 'shivnee.accounts';
const DEVICE_KEY = 'shivnee.device';
const LEGACY_KEY = 'shivnee.vault.v1';

export interface AccountKeys {
  handle: string;
  key: CryptoKey; // vault key (AES-GCM, not extractable)
  auth: string; // login key, base64 (32 bytes)
}

/** An unlocked account. `syncedRev` = the server backup version this device last uploaded or downloaded. */
export interface VaultSession extends AccountKeys {
  syncedRev: number;
}

interface StoredAccount {
  v: 2;
  handle: string;
  iv: string;
  ct: string;
  savedAt: number;
  syncedRev: number;
}

export class WrongPassphraseError extends Error {
  constructor() {
    super('wrong passphrase');
  }
}

/* ------------------------------------------------------------- keys */

export async function deriveAccountKeys(handle: string, password: string): Promise<AccountKeys> {
  const base = await crypto.subtle.importKey('raw', utf8(password), 'PBKDF2', false, ['deriveBits']);
  const master = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: utf8(`SHIVNEE-login-v1|${handle}`), iterations: ITERATIONS, hash: 'SHA-256' }, base, 256);
  const hk = await crypto.subtle.importKey('raw', master, 'HKDF', false, ['deriveKey', 'deriveBits']);
  const salt = new Uint8Array(32);
  const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: utf8('SHIVNEE vault key') }, hk, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  const auth = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: utf8('SHIVNEE login key') }, hk, 256);
  return { handle, key, auth: toB64(auth) };
}

const aad = (handle: string) => utf8(`SHIVNEE-vault|${handle}`);

/** Encrypts any JSON value. Output: base64(iv ‖ ciphertext). */
export async function sealData(keys: AccountKeys, data: unknown): Promise<string> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(keys.handle) }, keys.key, utf8(JSON.stringify(data))));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return toB64(out);
}

export async function openData<T>(keys: AccountKeys, blob: string): Promise<T> {
  const raw = fromB64(blob);
  return decrypt<T>(keys, raw.slice(0, 12), raw.slice(12));
}

async function decrypt<T>(keys: AccountKeys, iv: Uint8Array<ArrayBuffer>, ct: Uint8Array<ArrayBuffer>): Promise<T> {
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad(keys.handle) }, keys.key, ct);
  } catch {
    throw new WrongPassphraseError();
  }
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}

/* ------------------------------------------------------- this device */

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function remove(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* nothing to remove */
  }
}

/** A random id for this browser, so the server can tell which device uploaded a backup. */
export function deviceId(): string {
  let id = read(DEVICE_KEY);
  if (!id) {
    id = toB64(randomBytes(12)).replace(/[+/=]/g, '');
    try {
      window.localStorage.setItem(DEVICE_KEY, id);
    } catch {
      /* private mode: a new id each time is fine */
    }
  }
  return id;
}

/** Handles that have signed in on this device, most recent first. */
export function knownAccounts(): string[] {
  try {
    const list = JSON.parse(read(INDEX_KEY) ?? '[]') as unknown;
    return Array.isArray(list) ? list.filter((h): h is string => typeof h === 'string' && read(ACCOUNT_PREFIX + h) !== null) : [];
  } catch {
    return [];
  }
}

export function rememberAccount(handle: string) {
  try {
    window.localStorage.setItem(INDEX_KEY, JSON.stringify([handle, ...knownAccounts().filter((h) => h !== handle)].slice(0, 8)));
  } catch {
    /* ignore */
  }
}

function stored(handle: string): StoredAccount | null {
  try {
    const raw = read(ACCOUNT_PREFIX + handle);
    const s = raw ? (JSON.parse(raw) as StoredAccount) : null;
    return s?.v === 2 ? s : null;
  } catch {
    return null;
  }
}

export function hasLocal(handle: string): boolean {
  return stored(handle) !== null;
}

/** Opens this device's copy. Throws WrongPassphraseError if the keys don't fit. */
export async function openLocal<T>(keys: AccountKeys): Promise<{ data: T; syncedRev: number }> {
  const s = stored(keys.handle);
  if (!s) throw new Error('no local copy');
  const data = await decrypt<T>(keys, fromB64(s.iv), fromB64(s.ct));
  return { data, syncedRev: s.syncedRev };
}

/** Re-encrypts and stores the data. A fresh IV is used for every save. Throws when storage is full. */
export async function saveVault(session: VaultSession, data: unknown): Promise<void> {
  const raw = fromB64(await sealData(session, data));
  const rec: StoredAccount = { v: 2, handle: session.handle, iv: toB64(raw.slice(0, 12)), ct: toB64(raw.slice(12)), savedAt: Date.now(), syncedRev: session.syncedRev };
  window.localStorage.setItem(ACCOUNT_PREFIX + session.handle, JSON.stringify(rec));
}

/** Notes which server backup version this device's copy matches (no re-encryption needed). */
export function markSynced(session: VaultSession, rev: number) {
  session.syncedRev = rev;
  const s = stored(session.handle);
  if (!s) return;
  try {
    window.localStorage.setItem(ACCOUNT_PREFIX + session.handle, JSON.stringify({ ...s, syncedRev: rev }));
  } catch {
    /* ignore */
  }
}

/** Removes this device's copy of an account (the server backup is untouched). */
export function forgetAccount(handle: string) {
  remove(ACCOUNT_PREFIX + handle);
  try {
    window.localStorage.setItem(INDEX_KEY, JSON.stringify(knownAccounts().filter((h) => h !== handle)));
  } catch {
    /* ignore */
  }
}

/* ---------------------------------------- vaults from earlier versions */

interface LegacyVault {
  v: 1;
  salt: string;
  iv: string;
  ct: string;
  iter: number;
}

export function hasLegacyVault(): boolean {
  return read(LEGACY_KEY) !== null;
}

/** Opens a vault made before sign-in existed (one per browser, own passphrase). */
export async function openLegacyVault<T>(passphrase: string): Promise<T> {
  const raw = read(LEGACY_KEY);
  if (!raw) throw new Error('no legacy vault');
  const s = JSON.parse(raw) as LegacyVault;
  const base = await crypto.subtle.importKey('raw', utf8(passphrase), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: fromB64(s.salt), iterations: s.iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, [
    'decrypt',
  ]);
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(s.iv) }, key, fromB64(s.ct));
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    throw new WrongPassphraseError();
  }
}

export function eraseLegacyVault() {
  remove(LEGACY_KEY);
}

/* ------------------------------------------------- data key, recovery */

/** A random data key. Account backups are encrypted with it; the password and the recovery code each lock a copy of it. */
export function newDataKey(): string {
  return toB64(randomBytes(32));
}

export async function dataKeys(handle: string, dek: string): Promise<AccountKeys> {
  const key = await crypto.subtle.importKey('raw', fromB64(dek), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { handle, key, auth: '' };
}

const RC_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // no I, L, O, U

/** A 120-bit recovery code like 7K2M-QX9D-… (6 groups of 4). */
export function newRecoveryCode(): string {
  const bytes = randomBytes(24);
  const chars = Array.from(bytes, (b) => RC_ALPHABET[b & 31]);
  return chars.join('').match(/.{4}/g)!.join('-');
}

export function normalizeRecoveryCode(code: string): string {
  return code
    .toUpperCase()
    .replace(/[OIL]/g, (c) => (c === 'O' ? '0' : '1'))
    .replace(/[^0-9A-Z]/g, '');
}

/** Keys from a recovery code (same derivation as a password, different input). */
export function recoveryKeys(handle: string, code: string): Promise<AccountKeys> {
  return deriveAccountKeys(handle, `recovery:${normalizeRecoveryCode(code)}`);
}
