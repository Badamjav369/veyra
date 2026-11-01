// Run with: npm test
// Sign-in backup rules on the relay (password check, lockout, uploads) and the client-side key split.

import assert from 'node:assert/strict';
import { b64, randomBytes, utf8 } from '../shared/encoding';
import { generateIdentity, generateOneTimePreKeys, generateSignedPreKey, signBytes, uploadBundle } from '../shared/e2ee';
import { authMessage, type ServerMsg } from '../shared/protocol';
import { handleClientMessage, INACTIVE_TTL, purgeInactive, type BackupRecord, type Envelope, type RelayConn, type RelayHub, type RelayStore, type UserRecord } from '../server/relay';
import { deriveAccountKeys, openData, sealData } from '../src/lib/vault';

class MemStore implements RelayStore {
  users = new Map<string, UserRecord>();
  backups = new Map<string, BackupRecord>();
  mail = new Map<string, Envelope[]>();
  user = (h: string) => this.users.get(h);
  addUser = (h: string, r: UserRecord) => void this.users.set(h, r);
  deleteUser = (h: string) => void (this.users.delete(h), this.backups.delete(h));
  takeOneTimePreKey = (h: string) => this.users.get(h)?.opks.shift();
  countOneTimePreKeys = (h: string) => this.users.get(h)?.opks.length ?? 0;
  addOneTimePreKeys = () => {};
  enqueue = (h: string, e: Envelope) => void (this.mail.get(h) ?? this.mail.set(h, []).get(h)!).push(e);
  mailbox = (h: string) => this.mail.get(h) ?? [];
  ack = () => {};
  touch = (h: string) => void (this.users.has(h) && (this.users.get(h)!.lastSeen = Date.now()));
  inactive = (before: number) => [...this.users].filter(([, u]) => (u.lastSeen ?? u.createdAt) < before).map(([h]) => h);
  backup = (h: string) => this.backups.get(h);
  setBackup = (h: string, r: BackupRecord) => void this.backups.set(h, r);
}

function conn(): RelayConn & { inbox: ServerMsg[]; last(): ServerMsg } {
  const inbox: ServerMsg[] = [];
  return {
    id: b64(randomBytes(6)),
    nonce: b64(randomBytes(32)),
    handle: null,
    setHandle(h) {
      this.handle = h;
    },
    send: (m) => void inbox.push(m),
    close: () => {},
    inbox,
    last: () => inbox[inbox.length - 1],
  };
}

const hub: RelayHub = { online: () => undefined, register: () => {}, unregister: () => {} };

let passed = 0;
const test = async (name: string, fn: () => Promise<void> | void) => {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
};

const store = new MemStore();
const id = generateIdentity();
const handle = 'mira';
const owner = conn();
handleClientMessage(store, hub, owner, {
  t: 'register',
  handle,
  bundle: uploadBundle(id, generateSignedPreKey(1, id), generateOneTimePreKeys(1, 5)),
  sig: signBytes(id.sign.priv, utf8(authMessage('register', owner.nonce, handle))),
});
const keys = await deriveAccountKeys(handle, 'correct horse battery');

await test('password keys: same input → same keys; different password or handle → different', async () => {
  assert.equal((await deriveAccountKeys(handle, 'correct horse battery')).auth, keys.auth);
  assert.notEqual((await deriveAccountKeys(handle, 'correct horse batterY')).auth, keys.auth);
  assert.notEqual((await deriveAccountKeys('mirb', 'correct horse battery')).auth, keys.auth);
});

await test('vault data only opens with the right password and handle', async () => {
  const blob = await sealData(keys, { hello: 'world' });
  assert.deepEqual(await openData(keys, blob), { hello: 'world' });
  await assert.rejects(openData(await deriveAccountKeys(handle, 'wrong password!'), blob));
  // Same password, other handle → different key (the handle is the salt and the AAD).
  await assert.rejects(openData(await deriveAccountKeys('mirb', 'correct horse battery'), blob));
});

await test('no backup yet → no_backup; unknown handle → not_found', () => {
  const c = conn();
  handleClientMessage(store, hub, c, { t: 'backup-get', rid: 1, handle, auth: keys.auth });
  assert.equal((c.last() as { code: string }).code, 'no_backup');
  handleClientMessage(store, hub, c, { t: 'backup-get', rid: 2, handle: 'nobody', auth: keys.auth });
  assert.equal((c.last() as { code: string }).code, 'not_found');
});

await test('upload needs a signed-in connection, and the first one must set the password', () => {
  const anon = conn();
  handleClientMessage(store, hub, anon, { t: 'backup-put', rid: 1, blob: 'x', device: 'd1', auth: keys.auth });
  assert.equal((anon.last() as { code: string }).code, 'not_authenticated');
  handleClientMessage(store, hub, owner, { t: 'backup-put', rid: 2, blob: 'x', device: 'd1' });
  assert.equal((owner.last() as { code: string }).code, 'bad_request');
  handleClientMessage(store, hub, owner, { t: 'backup-put', rid: 3, blob: 'BLOB1', device: 'd1', auth: keys.auth });
  assert.equal(owner.last().t, 'backup-saved');
  assert.equal(store.backup(handle)!.rev, 1);
  assert.notEqual(store.backup(handle)!.authHash, keys.auth, 'the server keeps a hash, not the key');
});

await test('right password → the blob; wrong password → bad_login', async () => {
  const c = conn();
  handleClientMessage(store, hub, c, { t: 'backup-get', rid: 1, handle, auth: keys.auth });
  const r = c.last() as Extract<ServerMsg, { t: 'backup' }>;
  assert.equal(r.t, 'backup');
  assert.equal(r.blob, 'BLOB1');
  assert.equal(r.meta.device, 'd1');
  const wrong = await deriveAccountKeys(handle, 'nope nope nope');
  handleClientMessage(store, hub, c, { t: 'backup-get', rid: 2, handle, auth: wrong.auth });
  assert.equal((c.last() as { code: string }).code, 'bad_login');
});

await test('ten wrong passwords lock the account for a while (even the right one is refused)', () => {
  const c = conn();
  const bad = b64(randomBytes(32));
  for (let i = 0; i < 12; i++) handleClientMessage(store, hub, c, { t: 'backup-get', rid: i, handle, auth: bad });
  assert.equal((c.last() as { code: string }).code, 'locked_out');
  handleClientMessage(store, hub, c, { t: 'backup-get', rid: 99, handle, auth: keys.auth });
  assert.equal((c.last() as { code: string }).code, 'locked_out');
  // …until the window passes.
  store.setBackup(handle, { ...store.backup(handle)!, failSince: Date.now() - 16 * 60 * 1000 });
  handleClientMessage(store, hub, c, { t: 'backup-get', rid: 100, handle, auth: keys.auth });
  assert.equal(c.last().t, 'backup');
});

await test('later uploads bump the version; a new password replaces the old one', async () => {
  handleClientMessage(store, hub, owner, { t: 'backup-put', rid: 4, blob: 'BLOB2', device: 'd2' });
  assert.equal(store.backup(handle)!.rev, 2);
  const next = await deriveAccountKeys(handle, 'a brand new password');
  handleClientMessage(store, hub, owner, { t: 'backup-put', rid: 5, blob: 'BLOB3', device: 'd2', auth: next.auth });
  const c = conn();
  handleClientMessage(store, hub, c, { t: 'backup-get', rid: 1, handle, auth: keys.auth });
  assert.equal((c.last() as { code: string }).code, 'bad_login');
  handleClientMessage(store, hub, c, { t: 'backup-get', rid: 2, handle, auth: next.auth });
  assert.equal((c.last() as Extract<ServerMsg, { t: 'backup' }>).blob, 'BLOB3');
});

await test('signing in tells the client which backup version the server has', () => {
  const c = conn();
  handleClientMessage(store, hub, c, { t: 'auth', handle, sig: signBytes(id.sign.priv, utf8(authMessage('auth', c.nonce, handle))) });
  const ready = c.inbox.find((m) => m.t === 'ready') as Extract<ServerMsg, { t: 'ready' }>;
  assert.deepEqual({ rev: ready.backup?.rev, device: ready.backup?.device }, { rev: 3, device: 'd2' });
});

await test('deleting the account deletes the backup', () => {
  handleClientMessage(store, hub, owner, { t: 'delete-account', rid: 9 });
  assert.equal(store.backup(handle), undefined);
});

await test('accounts unused for 6 months are deleted and the handle is freed', () => {
  const s2 = new MemStore();
  const c = conn();
  const who = generateIdentity();
  handleClientMessage(s2, hub, c, { t: 'register', handle: 'sleepy', bundle: uploadBundle(who, generateSignedPreKey(1, who), []), sig: signBytes(who.sign.priv, utf8(authMessage('register', c.nonce, 'sleepy'))) });
  purgeInactive(s2);
  assert.ok(s2.user('sleepy'), 'recently active account stays');
  s2.users.get('sleepy')!.lastSeen = Date.now() - INACTIVE_TTL - 1000;
  purgeInactive(s2);
  assert.equal(s2.user('sleepy'), undefined);
});

console.log(`\n${passed} sign-in checks passed`);
