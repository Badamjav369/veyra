// One WebSocket connection to the relay: signs the login challenge, matches requests to replies,
// and reconnects with back-off when the network drops.

import { utf8 } from '../../shared/encoding';
import { signBytes } from '../../shared/e2ee';
import { authMessage, type BackupMeta, type ClientMsg, type ErrorCode, type ServerMsg, type UploadBundle } from '../../shared/protocol';

export type ConnStatus = 'connecting' | 'online' | 'offline';

export class ServerError extends Error {
  constructor(public code: ErrorCode | 'offline' | 'timeout') {
    super(code);
  }
}

export type Login =
  | { kind: 'auth'; handle: string; signPriv: string }
  | { kind: 'register'; handle: string; signPriv: string; bundle: UploadBundle };

interface Handlers {
  status: (status: ConnStatus, error?: ErrorCode) => void;
  ready: (info: { handle: string; opkCount: number; backup?: BackupMeta }) => void;
  message: (m: ServerMsg) => void;
}

type WithoutRid<T> = T extends { rid: number } ? Omit<T, 'rid'> : never;
const FATAL: ErrorCode[] = ['bad_signature', 'not_found', 'handle_taken', 'invalid_handle', 'replaced'];

/** Default relay address: same host as the page (dev server talks to port 8787). */
export function defaultServerUrl(): string {
  const secure = location.protocol === 'https:';
  if (import.meta.env.DEV) return `${secure ? 'wss' : 'ws'}://${location.hostname}:8787/ws`;
  return `${secure ? 'wss' : 'ws'}://${location.host}/ws`;
}

export class Connection {
  private ws: WebSocket | null = null;
  private nextRid = 1;
  private waiting = new Map<number, { resolve: (m: ServerMsg) => void; reject: (e: Error) => void; timer: number }>();
  private retries = 0;
  private stopped = true;
  private retryTimer: number | undefined;
  private pingTimer: number | undefined;
  status: ConnStatus = 'offline';

  constructor(
    private url: string,
    private login: Login,
    private on: Handlers,
  ) {}

  start() {
    this.stopped = false;
    this.open();
  }

  stop() {
    this.stopped = true;
    window.clearTimeout(this.retryTimer);
    window.clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = null;
    this.failAll('offline');
    this.setStatus('offline');
  }

  setLogin(login: Login) {
    this.login = login;
  }

  private setStatus(s: ConnStatus, error?: ErrorCode) {
    this.status = s;
    this.on.status(s, error);
  }

  private open() {
    this.setStatus('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onmessage = (ev) => {
      try {
        this.handle(JSON.parse(String(ev.data)) as ServerMsg);
      } catch (err) {
        console.error('bad server message', err);
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      window.clearInterval(this.pingTimer);
      this.failAll('offline');
      if (this.stopped) return;
      this.setStatus('offline');
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (this.stopped) return;
    const delay = Math.min(15_000, 800 * 2 ** this.retries) + Math.random() * 400;
    this.retries += 1;
    this.retryTimer = window.setTimeout(() => this.open(), delay);
  }

  private handle(m: ServerMsg) {
    if (m.t === 'challenge') {
      const { kind, handle, signPriv } = this.login;
      const sig = signBytes(signPriv, utf8(authMessage(kind, m.nonce, handle)));
      this.raw(this.login.kind === 'register' ? { t: 'register', handle, bundle: this.login.bundle, sig } : { t: 'auth', handle, sig });
      return;
    }
    if (m.t === 'ready') {
      this.retries = 0;
      if (this.login.kind === 'register') this.login = { kind: 'auth', handle: m.handle, signPriv: this.login.signPriv };
      window.clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.raw({ t: 'ping' }), 25_000);
      this.setStatus('online');
      this.on.ready({ handle: m.handle, opkCount: m.opkCount, backup: m.backup });
      return;
    }
    if (m.t === 'error') {
      const w = m.rid !== undefined ? this.waiting.get(m.rid) : undefined;
      if (w && m.rid !== undefined) {
        window.clearTimeout(w.timer);
        this.waiting.delete(m.rid);
        w.reject(new ServerError(m.code));
      } else if (FATAL.includes(m.code)) {
        this.stopped = true;
        this.ws?.close();
        this.setStatus('offline', m.code);
      }
      return;
    }
    if ('rid' in m) {
      const w = this.waiting.get(m.rid);
      if (w) {
        window.clearTimeout(w.timer);
        this.waiting.delete(m.rid);
        w.resolve(m);
      }
      return;
    }
    if (m.t !== 'pong') this.on.message(m);
  }

  private raw(m: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  /** Fire-and-forget (acks, prekey uploads). Dropped while offline. */
  send(m: ClientMsg) {
    if (this.status === 'online') this.raw(m);
  }

  request<R extends ServerMsg>(m: WithoutRid<ClientMsg>, timeoutMs = 20_000): Promise<R> {
    if (this.status !== 'online') return Promise.reject(new ServerError('offline'));
    const rid = this.nextRid++;
    return new Promise<R>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.waiting.delete(rid);
        reject(new ServerError('timeout'));
      }, timeoutMs);
      this.waiting.set(rid, { resolve: resolve as (m: ServerMsg) => void, reject, timer });
      this.raw({ ...m, rid } as ClientMsg);
    });
  }

  private failAll(code: 'offline') {
    for (const w of this.waiting.values()) {
      window.clearTimeout(w.timer);
      w.reject(new ServerError(code));
    }
    this.waiting.clear();
  }
}

/** Registers a brand-new account and disconnects. Resolves once the server accepted the keys. */
export function registerAccount(url: string, handle: string, signPriv: string, bundle: UploadBundle): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      conn.stop();
      if (err) reject(err);
      else resolve();
    };
    const conn = new Connection(url, { kind: 'register', handle, signPriv, bundle }, {
      status: (s, error) => {
        if (error) finish(new ServerError(error));
        else if (s === 'offline') finish(new ServerError('offline'));
      },
      ready: () => finish(),
      message: () => {},
    });
    const timer = window.setTimeout(() => finish(new ServerError('timeout')), 12_000);
    conn.start();
  });
}

/**
 * Asks the relay for an account's encrypted backup, proving the password with the login key.
 * Works before signing in (a new device has no keys yet). Rejects with ServerError:
 * bad_login, not_found, no_backup, locked_out, offline or timeout.
 */
export function fetchBackup(url: string, handle: string, auth: string, timeoutMs = 10_000, by?: 'recovery'): Promise<{ blob: string; wrap?: string; meta: BackupMeta }> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    let done = false;
    const finish = (err: Error | null, value?: { blob: string; wrap?: string; meta: BackupMeta }) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
      if (err) reject(err);
      else resolve(value!);
    };
    const timer = window.setTimeout(() => finish(new ServerError('timeout')), timeoutMs);
    try {
      ws = new WebSocket(url);
    } catch {
      finish(new ServerError('offline'));
      return;
    }
    ws.onerror = () => finish(new ServerError('offline'));
    ws.onclose = () => finish(new ServerError('offline'));
    ws.onmessage = (ev) => {
      let m: ServerMsg;
      try {
        m = JSON.parse(String(ev.data)) as ServerMsg;
      } catch {
        return;
      }
      if (m.t === 'challenge') ws.send(JSON.stringify({ t: 'backup-get', rid: 1, handle, auth, by } satisfies ClientMsg));
      else if (m.t === 'backup') finish(null, { blob: m.blob, wrap: m.wrap, meta: m.meta });
      else if (m.t === 'error') finish(new ServerError(m.code));
    };
  });
}
