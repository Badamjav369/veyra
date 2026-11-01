// SHIVNEE on Cloudflare.
//
//   • The web app (./dist) is served as static assets.
//   • /ws and /health go to ONE Durable Object ("Relay") that holds every WebSocket and stores
//     public keys + sealed envelopes in its built-in SQLite database.
//   • The rules are the same code the Node relay uses (../server/relay.ts).
//
// WebSockets use the Hibernation API: idle connections cost nothing, and the object wakes up when a
// message arrives.

import { DurableObject } from 'cloudflare:workers';
import { b64, randomBytes, randomId } from '../shared/encoding';
import type { OneTimePreKeyPublic, ServerMsg, SignedPreKeyPublic } from '../shared/protocol';
import { handleFrame, purgeInactive, type BackupRecord, type Envelope, type RelayConn, type RelayHub, type RelayStore, type UserRecord } from '../server/relay';

export interface Env {
  RELAY: DurableObjectNamespace<Relay>;
  ASSETS: Fetcher;
  ADMIN_TOKEN?: string; // secret; enables POST /admin/reset
}

const MAIL_TTL = 30 * 24 * 60 * 60 * 1000;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/ws' || url.pathname === '/health' || url.pathname === '/admin/reset') {
      return env.RELAY.get(env.RELAY.idFromName('global')).fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

interface Attachment {
  id: string;
  nonce: string;
  handle: string | null;
}

export class Relay extends DurableObject<Env> {
  private sql: SqlStorage;
  private store: RelayStore;
  private hub: RelayHub;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.createSchema();
    // Keep-alive pings are answered without waking the object up.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
    this.store = this.makeStore();
    this.hub = this.makeHub();
    void ctx.storage.getAlarm().then(async (a) => {
      if (a === null) await ctx.storage.setAlarm(Date.now() + 60 * 60 * 1000);
    });
  }

  private createSchema() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (handle TEXT PRIMARY KEY, ik TEXT NOT NULL, ik_dh TEXT NOT NULL, ik_dh_sig TEXT NOT NULL, spk TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS opks (handle TEXT NOT NULL, id INTEGER NOT NULL, pub TEXT NOT NULL, PRIMARY KEY (handle, id));
      CREATE TABLE IF NOT EXISTS mail (id TEXT PRIMARY KEY, handle TEXT NOT NULL, ts INTEGER NOT NULL, body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS mail_by_handle ON mail (handle, ts);
      CREATE TABLE IF NOT EXISTS backups (handle TEXT PRIMARY KEY, auth_hash TEXT NOT NULL, blob TEXT NOT NULL, rev INTEGER NOT NULL, device TEXT NOT NULL, at INTEGER NOT NULL, fails INTEGER NOT NULL, fail_since INTEGER NOT NULL);
    `);
    for (const [table, col] of [['backups', 'wrap'], ['backups', 'rc_hash'], ['backups', 'rc_wrap'], ['users', 'last_seen']]) {
      try {
        this.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${col === 'last_seen' ? 'INTEGER' : 'TEXT'}`); // added after v1; fails once it exists
      } catch {
        /* already there */
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/admin/reset') return this.reset(request);
    if (url.pathname === '/health') {
      const users = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM users').one().n;
      const queued = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM mail').one().n;
      return Response.json({ ok: true, users, queued, online: this.ctx.getWebSockets().length });
    }
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    const att: Attachment = { id: randomId(), nonce: b64(randomBytes(32)), handle: null };
    server.serializeAttachment(att);
    server.send(JSON.stringify({ t: 'challenge', nonce: att.nonce } satisfies ServerMsg));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const raw = typeof message === 'string' ? message : new TextDecoder().decode(message);
    handleFrame(this.store, this.hub, this.conn(ws), raw, (s) => console.log(s));
  }

  async webSocketClose(ws: WebSocket, code: number) {
    try {
      ws.close(code === 1005 ? 1000 : code, 'bye');
    } catch {
      /* already closed */
    }
  }

  /**
   * Wipes everything (accounts, keys, mail, backups). Only with the ADMIN_TOKEN secret:
   *   npx wrangler secret put ADMIN_TOKEN
   *   curl -X POST -H "Authorization: Bearer <token>" https://<site>/admin/reset
   */
  private async reset(request: Request): Promise<Response> {
    const token = this.env.ADMIN_TOKEN;
    if (!token || request.method !== 'POST' || request.headers.get('Authorization') !== `Bearer ${token}`) return new Response('Not found', { status: 404 });
    for (const ws of this.ctx.getWebSockets()) ws.close(4001, 'reset');
    await this.ctx.storage.deleteAll();
    this.createSchema();
    await this.ctx.storage.setAlarm(Date.now() + 60 * 60 * 1000);
    console.log('database reset');
    return Response.json({ ok: true, reset: true });
  }

  async alarm() {
    this.sql.exec('DELETE FROM mail WHERE ts < ?', Date.now() - MAIL_TTL);
    purgeInactive(this.store, (s) => console.log(s));
    await this.ctx.storage.setAlarm(Date.now() + 60 * 60 * 1000);
  }

  /* --------------------------------------------------------- adapters */

  private conn(ws: WebSocket): RelayConn {
    const att = ws.deserializeAttachment() as Attachment;
    return {
      id: att.id,
      nonce: att.nonce,
      handle: att.handle,
      setHandle(h) {
        this.handle = h;
        ws.serializeAttachment({ ...att, handle: h });
      },
      send: (m) => {
        try {
          ws.send(JSON.stringify(m));
        } catch {
          /* socket gone */
        }
      },
      close: (code, reason) => ws.close(code, reason),
    };
  }

  private makeHub(): RelayHub {
    return {
      online: (handle) => {
        for (const ws of this.ctx.getWebSockets()) {
          const att = ws.deserializeAttachment() as Attachment | null;
          if (att?.handle === handle && ws.readyState === WebSocket.OPEN) return this.conn(ws);
        }
        return undefined;
      },
      register: () => {}, // the handle lives in the socket's attachment
      unregister: () => {},
    };
  }

  private makeStore(): RelayStore {
    const sql = this.sql;
    type Row = { ik: string; ik_dh: string; ik_dh_sig: string; spk: string; created_at: number };
    return {
      user(handle) {
        const row = sql.exec<Row>('SELECT ik, ik_dh, ik_dh_sig, spk, created_at FROM users WHERE handle = ?', handle).toArray()[0];
        if (!row) return undefined;
        const opks = sql.exec<{ id: number; pub: string }>('SELECT id, pub FROM opks WHERE handle = ? ORDER BY id', handle).toArray();
        const u: UserRecord = { ik: row.ik, ikDh: row.ik_dh, ikDhSig: row.ik_dh_sig, spk: JSON.parse(row.spk) as SignedPreKeyPublic, opks, createdAt: row.created_at };
        return u;
      },
      addUser(handle, r) {
        sql.exec('INSERT INTO users (handle, ik, ik_dh, ik_dh_sig, spk, created_at) VALUES (?, ?, ?, ?, ?, ?)', handle, r.ik, r.ikDh, r.ikDhSig, JSON.stringify(r.spk), r.createdAt);
        for (const k of r.opks) sql.exec('INSERT OR IGNORE INTO opks (handle, id, pub) VALUES (?, ?, ?)', handle, k.id, k.pub);
      },
      deleteUser(handle) {
        sql.exec('DELETE FROM users WHERE handle = ?', handle);
        sql.exec('DELETE FROM opks WHERE handle = ?', handle);
        sql.exec('DELETE FROM mail WHERE handle = ?', handle);
        sql.exec('DELETE FROM backups WHERE handle = ?', handle);
      },
      touch(handle) {
        sql.exec('UPDATE users SET last_seen = ? WHERE handle = ?', Date.now(), handle);
      },
      inactive(before) {
        return sql.exec<{ handle: string }>('SELECT handle FROM users WHERE COALESCE(last_seen, created_at) < ?', before).toArray().map((r) => r.handle);
      },
      backup(handle) {
        type B = { auth_hash: string; blob: string; rev: number; device: string; at: number; fails: number; fail_since: number; wrap: string | null; rc_hash: string | null; rc_wrap: string | null };
        const r = sql.exec<B>('SELECT auth_hash, blob, rev, device, at, fails, fail_since, wrap, rc_hash, rc_wrap FROM backups WHERE handle = ?', handle).toArray()[0];
        if (!r) return undefined;
        const b: BackupRecord = { authHash: r.auth_hash, blob: r.blob, rev: r.rev, device: r.device, at: r.at, fails: r.fails, failSince: r.fail_since, wrap: r.wrap ?? undefined, rcHash: r.rc_hash ?? undefined, rcWrap: r.rc_wrap ?? undefined };
        return b;
      },
      setBackup(handle, b) {
        sql.exec(
          'INSERT OR REPLACE INTO backups (handle, auth_hash, blob, rev, device, at, fails, fail_since, wrap, rc_hash, rc_wrap) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          handle, b.authHash, b.blob, b.rev, b.device, b.at, b.fails, b.failSince, b.wrap ?? null, b.rcHash ?? null, b.rcWrap ?? null,
        );
      },
      takeOneTimePreKey(handle) {
        const k = sql.exec<{ id: number; pub: string }>('SELECT id, pub FROM opks WHERE handle = ? ORDER BY id LIMIT 1', handle).toArray()[0];
        if (k) sql.exec('DELETE FROM opks WHERE handle = ? AND id = ?', handle, k.id);
        return k as OneTimePreKeyPublic | undefined;
      },
      countOneTimePreKeys(handle) {
        return sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM opks WHERE handle = ?', handle).one().n;
      },
      addOneTimePreKeys(handle, keys) {
        for (const k of keys) sql.exec('INSERT OR IGNORE INTO opks (handle, id, pub) VALUES (?, ?, ?)', handle, k.id, k.pub);
        // keep at most 200
        sql.exec('DELETE FROM opks WHERE handle = ? AND id NOT IN (SELECT id FROM opks WHERE handle = ? ORDER BY id DESC LIMIT 200)', handle, handle);
      },
      enqueue(handle, env: Envelope) {
        sql.exec('INSERT INTO mail (id, handle, ts, body) VALUES (?, ?, ?, ?)', env.id, handle, env.ts, env.body);
      },
      mailbox(handle) {
        return sql.exec<{ id: string; ts: number; body: string }>('SELECT id, ts, body FROM mail WHERE handle = ? ORDER BY ts', handle).toArray();
      },
      ack(handle, ids) {
        for (const id of ids) sql.exec('DELETE FROM mail WHERE handle = ? AND id = ?', handle, id);
      },
    };
  }
}
