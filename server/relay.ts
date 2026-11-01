// The relay's rules, independent of where it runs.
// Used by the Node server (server/index.ts) and by the Cloudflare Durable Object (cloudflare/worker.ts),
// so both enforce exactly the same checks.

import { sha256 } from '@noble/hashes/sha2.js';
import { b64, isB64Len, randomId, unb64, utf8 } from '../shared/encoding';
import { verifyBytes, verifyBundle } from '../shared/e2ee';
import {
  authMessage,
  HANDLE_RE,
  MAX_BODY_CHARS,
  type BackupMeta,
  type ClientMsg,
  type ErrorCode,
  type OneTimePreKeyPublic,
  type ServerMsg,
  type SignedPreKeyPublic,
} from '../shared/protocol';

export interface UserRecord {
  ik: string;
  ikDh: string;
  ikDhSig: string;
  spk: SignedPreKeyPublic;
  opks: OneTimePreKeyPublic[];
  createdAt: number;
  lastSeen?: number; // last sign-in
}

export interface Envelope {
  id: string;
  ts: number;
  body: string; // sealed — the relay can't read it or tell who sent it
}

/**
 * An account backup. `blob` is the user's vault encrypted on their device with a key derived from
 * their password — the relay can't open it. `authHash` is SHA-256 of a second key derived from the
 * same password; whoever presents the matching key may download the blob.
 */
export interface BackupRecord extends BackupMeta {
  authHash: string;
  blob: string;
  wrap?: string;
  rcHash?: string;
  rcWrap?: string;
  fails: number; // wrong passwords in the current window
  failSince: number;
}

export const MAX_BACKUP_CHARS = 960_000; // the whole frame must stay under 1 MiB
/** Accounts nobody signed in to for this long are deleted, and their handle becomes free again. */
export const INACTIVE_TTL = 180 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW = 15 * 60 * 1000;
const LOGIN_MAX_FAILS = 10;

/** Storage the relay needs. Only public keys and sealed envelopes ever go in here. */
export interface RelayStore {
  user(handle: string): UserRecord | undefined;
  addUser(handle: string, record: UserRecord): void;
  deleteUser(handle: string): void;
  takeOneTimePreKey(handle: string): OneTimePreKeyPublic | undefined;
  countOneTimePreKeys(handle: string): number;
  addOneTimePreKeys(handle: string, keys: OneTimePreKeyPublic[]): void;
  enqueue(handle: string, env: Envelope): void;
  mailbox(handle: string): Envelope[];
  ack(handle: string, ids: string[]): void;
  /** Records a sign-in (keeps the account from expiring). */
  touch(handle: string): void;
  /** Handles whose last sign-in is older than `before`. */
  inactive(before: number): string[];
  backup(handle: string): BackupRecord | undefined;
  setBackup(handle: string, record: BackupRecord): void;
}

/** One client connection, whatever the transport. */
export interface RelayConn {
  readonly id: string;
  readonly nonce: string;
  handle: string | null;
  setHandle(handle: string | null): void;
  send(m: ServerMsg): void;
  close(code: number, reason: string): void;
}

/** Who is online right now. */
export interface RelayHub {
  online(handle: string): RelayConn | undefined;
  register(handle: string, c: RelayConn): void;
  unregister(handle: string, c: RelayConn): void;
}

export const MAX_FRAME_BYTES = 1_000_000; // Cloudflare's WebSocket message limit is 1 MiB

/** Constant-time comparison. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

const fail = (c: RelayConn, code: ErrorCode, rid?: number) => c.send({ t: 'error', code, rid });

function validOpks(list: unknown): list is OneTimePreKeyPublic[] {
  return Array.isArray(list) && list.length <= 200 && list.every((k) => Number.isInteger(k?.id) && isB64Len(k?.pub, 32));
}

function signIn(store: RelayStore, hub: RelayHub, c: RelayConn, handle: string) {
  const previous = hub.online(handle);
  if (previous && previous.id !== c.id) {
    fail(previous, 'replaced');
    previous.close(4000, 'replaced');
    hub.unregister(handle, previous);
  }
  c.setHandle(handle);
  hub.register(handle, c);
  store.touch(handle);
  const b = store.backup(handle);
  c.send({ t: 'ready', handle, opkCount: store.countOneTimePreKeys(handle), backup: b ? { rev: b.rev, device: b.device, at: b.at } : undefined });
  for (const env of store.mailbox(handle)) c.send({ t: 'msg', ...env }); // what arrived while offline
}

/** Applies one client message. Throws nothing; bad input becomes an error reply. */
export function handleClientMessage(store: RelayStore, hub: RelayHub, c: RelayConn, m: ClientMsg, log: (s: string) => void = () => {}) {
  switch (m.t) {
    case 'ping':
      return c.send({ t: 'pong' });

    case 'register': {
      if (typeof m.handle !== 'string' || !HANDLE_RE.test(m.handle)) return fail(c, 'invalid_handle');
      const b = m.bundle;
      if (!b || !isB64Len(b.ik, 32) || !isB64Len(b.ikDh, 32) || !isB64Len(b.ikDhSig, 64) || !b.spk || !isB64Len(b.spk.pub, 32) || !isB64Len(b.spk.sig, 64) || !validOpks(b.opks))
        return fail(c, 'bad_request');
      // Prove possession of the identity key, and that the prekeys belong to it.
      if (typeof m.sig !== 'string' || !verifyBytes(b.ik, utf8(authMessage('register', c.nonce, m.handle)), m.sig) || !verifyBundle(b)) return fail(c, 'bad_signature');
      const existing = store.user(m.handle);
      if (existing && existing.ik !== b.ik) return fail(c, 'handle_taken');
      if (!existing) {
        store.addUser(m.handle, { ik: b.ik, ikDh: b.ikDh, ikDhSig: b.ikDhSig, spk: b.spk, opks: b.opks, createdAt: Date.now() });
        log(`registered @${m.handle}`);
      }
      return signIn(store, hub, c, m.handle);
    }

    case 'backup-get': {
      // Allowed before signing in: this is how a new device gets its keys back.
      if (typeof m.handle !== 'string' || !HANDLE_RE.test(m.handle) || !isB64Len(m.auth, 32)) return fail(c, 'bad_request', m.rid);
      if (!store.user(m.handle)) return fail(c, 'not_found', m.rid);
      const b = store.backup(m.handle);
      if (!b) return fail(c, 'no_backup', m.rid);
      const now = Date.now();
      const windowOpen = now - b.failSince < LOGIN_WINDOW;
      if (windowOpen && b.fails >= LOGIN_MAX_FAILS) return fail(c, 'locked_out', m.rid);
      const recovery = m.by === 'recovery';
      if (recovery && !b.rcHash) return fail(c, 'no_recovery', m.rid);
      if (!sameBytes(sha256(unb64(m.auth)), unb64(recovery ? b.rcHash! : b.authHash))) {
        store.setBackup(m.handle, { ...b, fails: windowOpen ? b.fails + 1 : 1, failSince: windowOpen ? b.failSince : now });
        log(`wrong password for @${m.handle}`);
        return fail(c, 'bad_login', m.rid);
      }
      if (b.fails) store.setBackup(m.handle, { ...b, fails: 0, failSince: 0 });
      return c.send({ t: 'backup', rid: m.rid, blob: b.blob, wrap: recovery ? b.rcWrap : b.wrap, meta: { rev: b.rev, device: b.device, at: b.at } });
    }

    case 'auth': {
      const u = typeof m.handle === 'string' ? store.user(m.handle) : undefined;
      if (!u) return fail(c, 'not_found');
      if (typeof m.sig !== 'string' || !verifyBytes(u.ik, utf8(authMessage('auth', c.nonce, m.handle)), m.sig)) return fail(c, 'bad_signature');
      return signIn(store, hub, c, m.handle);
    }
  }

  if (!c.handle) return fail(c, 'not_authenticated');
  const me = c.handle;

  switch (m.t) {
    case 'identity': {
      const u = typeof m.handle === 'string' ? store.user(m.handle) : undefined;
      if (!u) return fail(c, 'not_found', m.rid);
      return c.send({ t: 'identity', rid: m.rid, handle: m.handle, ik: u.ik, ikDh: u.ikDh, ikDhSig: u.ikDhSig });
    }

    case 'bundle': {
      const u = typeof m.handle === 'string' ? store.user(m.handle) : undefined;
      if (!u) return fail(c, 'not_found', m.rid);
      const opk = store.takeOneTimePreKey(m.handle); // each one-time prekey is handed out once
      c.send({ t: 'bundle', rid: m.rid, bundle: { handle: m.handle, ik: u.ik, ikDh: u.ikDh, ikDhSig: u.ikDhSig, spk: u.spk, opk } });
      const left = store.countOneTimePreKeys(m.handle);
      const owner = hub.online(m.handle);
      if (left < 10 && owner) owner.send({ t: 'opk-low', count: left });
      return;
    }

    case 'send': {
      if (typeof m.body !== 'string' || typeof m.to !== 'string') return fail(c, 'bad_request', m.rid);
      if (m.body.length > MAX_BODY_CHARS) return fail(c, 'too_large', m.rid);
      if (!store.user(m.to)) return fail(c, 'not_found', m.rid);
      // Deliberately NOT recorded: who sent it. Only the recipient finds out, after unsealing.
      const env: Envelope = { id: randomId(), ts: Date.now(), body: m.body };
      store.enqueue(m.to, env);
      hub.online(m.to)?.send({ t: 'msg', ...env });
      return c.send({ t: 'sent', rid: m.rid, id: env.id });
    }

    case 'ack':
      if (Array.isArray(m.ids)) store.ack(me, m.ids.filter((x): x is string => typeof x === 'string').slice(0, 500));
      return;

    case 'opks':
      if (validOpks(m.opks)) store.addOneTimePreKeys(me, m.opks);
      return;

    case 'backup-put': {
      if (typeof m.blob !== 'string' || typeof m.device !== 'string' || m.device.length > 64) return fail(c, 'bad_request', m.rid);
      if (m.blob.length > MAX_BACKUP_CHARS) return fail(c, 'too_large', m.rid);
      if (m.auth !== undefined && !isB64Len(m.auth, 32)) return fail(c, 'bad_request', m.rid);
      const rc = m.recovery;
      if ((m.wrap !== undefined && (typeof m.wrap !== 'string' || m.wrap.length > 400)) || (rc && (!isB64Len(rc.auth, 32) || typeof rc.wrap !== 'string' || rc.wrap.length > 400)))
        return fail(c, 'bad_request', m.rid);
      const prev = store.backup(me);
      if (!prev && m.auth === undefined) return fail(c, 'bad_request', m.rid); // the first upload must set the password
      const meta: BackupMeta = { rev: (prev?.rev ?? 0) + 1, device: m.device, at: Date.now() };
      store.setBackup(me, {
        ...meta,
        blob: m.blob,
        wrap: m.wrap ?? prev?.wrap,
        rcHash: rc ? b64(sha256(unb64(rc.auth))) : prev?.rcHash,
        rcWrap: rc ? rc.wrap : prev?.rcWrap,
        authHash: m.auth !== undefined ? b64(sha256(unb64(m.auth))) : prev!.authHash,
        fails: m.auth !== undefined ? 0 : (prev?.fails ?? 0),
        failSince: m.auth !== undefined ? 0 : (prev?.failSince ?? 0),
      });
      return c.send({ t: 'backup-saved', rid: m.rid, meta });
    }

    case 'delete-account':
      store.deleteUser(me);
      hub.unregister(me, c);
      c.setHandle(null);
      log(`deleted @${me}`);
      return c.send({ t: 'deleted', rid: m.rid });

    default:
      return fail(c, 'bad_request');
  }
}

/** Parses one raw frame and applies it. */
export function handleFrame(store: RelayStore, hub: RelayHub, c: RelayConn, raw: string, log?: (s: string) => void) {
  if (raw.length > MAX_FRAME_BYTES * 2) return fail(c, 'too_large');
  let msg: ClientMsg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return fail(c, 'bad_request');
  }
  if (!msg || typeof msg !== 'object') return fail(c, 'bad_request');
  try {
    handleClientMessage(store, hub, c, msg, log);
  } catch (err) {
    log?.(`handler error: ${String(err)}`);
    fail(c, 'bad_request');
  }
}

/** Deletes accounts that haven't signed in for INACTIVE_TTL (keys, prekeys, mail, backup). */
export function purgeInactive(store: RelayStore, log: (s: string) => void = () => {}) {
  for (const h of store.inactive(Date.now() - INACTIVE_TTL)) {
    store.deleteUser(h);
    log(`expired @${h} (inactive)`);
  }
}
