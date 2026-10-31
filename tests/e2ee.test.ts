// Run with: npm test
// Checks the protocol end to end without any network: key agreement, ratchet, out-of-order delivery,
// tampering, sealed sender and safety numbers.

import assert from 'node:assert/strict';
import { fromUtf8, utf8 } from '../shared/encoding';
import {
  fingerprint,
  generateIdentity,
  generateOneTimePreKeys,
  generateSignedPreKey,
  publicOpk,
  publicSpk,
  ratchetDecrypt,
  ratchetEncrypt,
  ratchetInitAlice,
  ratchetInitBob,
  safetyNumber,
  seal,
  unseal,
  verifyBundle,
  x3dhInitiate,
  x3dhRespond,
  type RatchetState,
} from '../shared/e2ee';
import type { PreKeyBundle } from '../shared/protocol';

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

const alice = generateIdentity();
const bob = generateIdentity();
const bobSpk = generateSignedPreKey(1, bob);
const bobOpks = generateOneTimePreKeys(100, 3);
const bundle: PreKeyBundle = { handle: 'bob', ik: bob.sign.pub, ikDh: bob.dh.pub, ikDhSig: bob.dhSig, spk: publicSpk(bobSpk), opk: publicOpk(bobOpks[0]) };

let a: RatchetState;
let b: RatchetState;

test('bundle signatures verify, and a forged prekey is rejected', () => {
  assert.equal(verifyBundle(bundle), true);
  const forged = { ...bundle, spk: { ...bundle.spk, pub: generateSignedPreKey(2, alice).pub } };
  assert.equal(verifyBundle(forged), false);
});

test('X3DH: both sides derive the same secret', () => {
  const init = x3dhInitiate(alice, bundle);
  const resp = x3dhRespond(bob, bobSpk, bobOpks[0], init.header);
  assert.deepEqual(init.sk, resp.sk);
  assert.deepEqual(init.ad, resp.ad);
  a = ratchetInitAlice(init.sk, bundle.spk.pub, init.ad);
  b = ratchetInitBob(resp.sk, bobSpk, resp.ad);
});

const send = (from: RatchetState, text: string) => {
  const r = ratchetEncrypt(from, utf8(text));
  return { state: r.state, msg: { h: r.header, ct: r.ct } };
};
const recv = (to: RatchetState, m: { h: { dh: string; pn: number; n: number }; ct: string }) => {
  const r = ratchetDecrypt(to, m.h, m.ct);
  return { state: r.state, text: fromUtf8(r.plaintext) };
};

test('messages flow both ways and the ratchet turns', () => {
  let r = send(a, 'hello bob');
  a = r.state;
  let got = recv(b, r.msg);
  b = got.state;
  assert.equal(got.text, 'hello bob');

  r = send(b, 'hi alice');
  b = r.state;
  got = recv(a, r.msg);
  a = got.state;
  assert.equal(got.text, 'hi alice');
  assert.ok(a.steps >= 2 && b.steps >= 1);
});

test('every message uses a different key (same text → different ciphertext)', () => {
  const r1 = send(a, 'same');
  const r2 = send(r1.state, 'same');
  assert.notEqual(r1.msg.ct, r2.msg.ct);
  a = r2.state;
  b = recv(recv(b, r1.msg).state, r2.msg).state;
});

test('out-of-order delivery still decrypts', () => {
  const m1 = send(a, 'one');
  const m2 = send(m1.state, 'two');
  const m3 = send(m2.state, 'three');
  a = m3.state;
  let s = recv(b, m3.msg);
  assert.equal(s.text, 'three');
  s = recv(s.state, m1.msg);
  assert.equal(s.text, 'one');
  s = recv(s.state, m2.msg);
  assert.equal(s.text, 'two');
  b = s.state;
});

test('tampered ciphertext is rejected and the state is unchanged', () => {
  const m = send(a, 'do not touch');
  a = m.state;
  const raw = Buffer.from(m.msg.ct, 'base64');
  raw[5] ^= 1;
  assert.throws(() => recv(b, { ...m.msg, ct: raw.toString('base64') }));
  b = recv(b, m.msg).state; // the genuine one still works
});

test('a replayed message cannot be decrypted twice', () => {
  const m = send(a, 'once');
  a = m.state;
  b = recv(b, m.msg).state;
  assert.throws(() => recv(b, m.msg));
});

test('sealed sender: only the recipient can open it', () => {
  const sealed = seal(bob.dh.pub, utf8('secret envelope'));
  assert.equal(fromUtf8(unseal(bob.dh, sealed)), 'secret envelope');
  assert.throws(() => unseal(alice.dh, sealed));
});

test('safety numbers match on both sides and change with the key', () => {
  assert.deepEqual(safetyNumber(alice.sign.pub, bob.sign.pub), safetyNumber(bob.sign.pub, alice.sign.pub));
  assert.notDeepEqual(safetyNumber(alice.sign.pub, bob.sign.pub), safetyNumber(generateIdentity().sign.pub, bob.sign.pub));
  assert.match(fingerprint(alice.sign.pub), /^[0-9A-F]{4}( [0-9A-F]{4}){3}$/);
});

console.log(`\n${passed} checks passed`);
