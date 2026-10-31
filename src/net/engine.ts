// The engine sits between the UI and the relay. It owns the encryption state (sessions, prekeys),
// encrypts everything before it leaves, decrypts everything that arrives, and reports results to the
// UI as reducer actions. Every crypto operation runs one at a time, in order, so the ratchets stay in sync.

import { randomId, unb64 } from '../../shared/encoding';
import {
  decodeJson,
  encodeJson,
  generateOneTimePreKeys,
  publicOpk,
  ratchetDecrypt,
  ratchetEncrypt,
  ratchetInitAlice,
  ratchetInitBob,
  safetyNumber,
  seal,
  unseal,
  uploadBundle,
  verifyBundle,
  verifyBytes,
  x3dhInitiate,
  x3dhRespond,
  type InnerEnvelope,
} from '../../shared/e2ee';
import type { AppMessage, PreKeyBundle, ServerMsg, Timer, WireFile, WireGroup } from '../../shared/protocol';
import type { ChatAction } from '../state/chat';
import { contactOf, isGroupId } from '../state/chat';
import type { ChatState, Contact, CryptoStore, FileInfo, Group, Session } from '../types';
import { colorFor } from '../types';
import { Connection, ServerError, type ConnStatus } from './connection';

export interface EngineDeps {
  url: string;
  getState: () => ChatState;
  dispatch: (a: ChatAction) => void;
  onStatus: (status: ConnStatus, error?: string) => void;
  /** Writes the vault now. Called before acknowledging or sending, so a crash can't desync the ratchets. */
  saveNow: () => Promise<void>;
}

export interface OutgoingText {
  mid: string;
  text: string;
  at: number;
  timer: Timer;
  file?: FileInfo;
}

const OPK_BATCH = 50;

export class Engine {
  private conn: Connection;
  private store: CryptoStore;
  private chain: Promise<unknown> = Promise.resolve();
  private inFlight = new Set<string>();
  private lastTyping = 0;

  constructor(private d: EngineDeps) {
    const s = d.getState();
    // Private copy: the engine mutates it, React gets snapshots via persist().
    this.store = { ...s.crypto, sessions: { ...s.crypto.sessions }, profileShared: { ...s.crypto.profileShared }, opks: [...s.crypto.opks] };
    this.conn = new Connection(d.url, { kind: 'auth', handle: s.profile.handle, signPriv: this.store.identity.sign.priv }, {
      status: (st, err) => this.onStatus(st, err),
      ready: (info) => this.onReady(info.opkCount),
      message: (m) => this.onServer(m),
    });
  }

  start() {
    this.conn.start();
  }

  stop() {
    this.conn.stop();
  }

  get online() {
    return this.conn.status === 'online';
  }

  /* ------------------------------------------------------------ plumbing */

  /** Runs crypto work strictly one after another. */
  private serial<T>(fn: () => Promise<T> | T): Promise<T> {
    const run = this.chain.then(fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private persist() {
    this.d.dispatch({ type: 'crypto', crypto: { ...this.store, sessions: { ...this.store.sessions }, profileShared: { ...this.store.profileShared } } });
  }

  private get me() {
    return this.d.getState().profile;
  }

  private onStatus(status: ConnStatus, error?: string) {
    if (error === 'not_found') {
      // The server forgot us (e.g. it was reset). We still hold our keys, so register again.
      const opks = generateOneTimePreKeys(this.store.nextOpkId, OPK_BATCH);
      this.store = { ...this.store, opks: [...this.store.opks, ...opks].slice(-300), nextOpkId: this.store.nextOpkId + OPK_BATCH };
      this.persist();
      this.conn.setLogin({ kind: 'register', handle: this.me.handle, signPriv: this.store.identity.sign.priv, bundle: uploadBundle(this.store.identity, this.store.spk, opks) });
      this.conn.start();
      return;
    }
    this.d.onStatus(status, error);
  }

  private onReady(opkCount: number) {
    if (opkCount < 20) this.replenish();
    void this.flushPending();
  }

  private replenish() {
    const keys = generateOneTimePreKeys(this.store.nextOpkId, OPK_BATCH);
    this.store = { ...this.store, opks: [...this.store.opks, ...keys].slice(-300), nextOpkId: this.store.nextOpkId + OPK_BATCH };
    this.persist();
    this.conn.send({ t: 'opks', opks: keys.map(publicOpk) });
  }

  private makeContact(handle: string, ik: string): Contact {
    return {
      id: handle,
      handle,
      nickname: '',
      displayName: '',
      bio: '',
      color: colorFor(handle),
      publicKey: ik,
      safety: safetyNumber(this.store.identity.sign.pub, ik),
      verified: false,
      addedAt: Date.now(),
    };
  }

  /* ---------------------------------------------------------- directory */

  /** Looks someone up by handle (doesn't use up their one-time prekeys). */
  async lookup(handle: string): Promise<Contact> {
    const r = await this.conn.request<Extract<ServerMsg, { t: 'identity' }>>({ t: 'identity', handle });
    if (!verifyBytes(r.ik, unb64(r.ikDh), r.ikDhSig)) throw new ServerError('bad_signature');
    return this.makeContact(handle, r.ik);
  }

  /* ----------------------------------------------------------- outgoing */

  private checkIdentity(handle: string, ik: string) {
    const c = this.d.getState().contacts[handle];
    if (c && c.publicKey !== ik) {
      this.d.dispatch({ type: 'identityChanged', handle, publicKey: ik, safety: safetyNumber(this.store.identity.sign.pub, ik), at: Date.now() });
    }
  }

  private async ensureSession(handle: string): Promise<Session> {
    const existing = this.store.sessions[handle];
    if (existing) return existing;
    const r = await this.conn.request<Extract<ServerMsg, { t: 'bundle' }>>({ t: 'bundle', handle });
    const b: PreKeyBundle = r.bundle;
    if (!verifyBundle(b)) throw new ServerError('bad_signature');
    this.checkIdentity(handle, b.ik);
    const x = x3dhInitiate(this.store.identity, b);
    const session: Session = {
      ik: b.ik,
      ikDh: b.ikDh,
      ratchet: ratchetInitAlice(x.sk, b.spk.pub, x.ad),
      pending: x.header,
      initiator: true,
      createdAt: Date.now(),
    };
    this.store.sessions[handle] = session;
    this.persist();
    return session;
  }

  /** Encrypts one app message for one person and hands the sealed envelope to the relay. */
  private async sendTo(handle: string, app: AppMessage): Promise<void> {
    const session = await this.ensureSession(handle);
    const me = this.me;

    // Share our profile (name, status, photo) the first time and whenever it changes.
    if (app.k !== 'profile' && this.store.profileShared[handle] !== me.version) {
      await this.sendTo(handle, this.profileMessage());
      this.store.profileShared[handle] = me.version;
      this.persist();
    }

    const current = this.store.sessions[handle] ?? session;
    const enc = ratchetEncrypt(current.ratchet, encodeJson(app));
    const inner: InnerEnvelope = { v: 1, from: me.handle, ik: this.store.identity.sign.pub, x3dh: current.pending, h: enc.header, ct: enc.ct };
    this.store.sessions[handle] = { ...current, ratchet: enc.state };
    this.persist();
    await this.d.saveNow(); // the used-up key must be on disk before the message leaves
    await this.conn.request({ t: 'send', to: handle, body: seal(current.ikDh, encodeJson(inner)) });
  }

  private profileMessage(): AppMessage {
    const p = this.me;
    return {
      k: 'profile',
      displayName: p.displayName,
      bio: p.presence === 'hidden' ? '' : p.bio,
      color: p.avatar.color,
      avatar: p.avatar.kind === 'image' ? p.avatar.dataUrl : undefined,
    };
  }

  private recipients(convo: string): string[] {
    const s = this.d.getState();
    if (!isGroupId(convo)) return [contactOf(convo)];
    return s.groups.find((g) => g.id === convo)?.members ?? [];
  }

  /** Sends a chat message to a person or (one copy per member) to a group. */
  sendText(convo: string, m: OutgoingText): Promise<void> {
    if (this.inFlight.has(m.mid)) return Promise.resolve();
    this.inFlight.add(m.mid);
    const g = isGroupId(convo) ? convo : undefined;
    const file: WireFile | undefined = m.file?.dataUrl ? { name: m.file.name, size: m.file.size, type: m.file.type, checksum: m.file.checksum, data: m.file.dataUrl } : undefined;
    return this.serial(async () => {
      try {
        let failed = false;
        for (const h of this.recipients(convo)) {
          try {
            await this.sendTo(h, { k: 'text', mid: m.mid, text: m.text, at: m.at, timer: m.timer, file, g });
          } catch (err) {
            if (err instanceof ServerError && (err.code === 'offline' || err.code === 'timeout')) throw err;
            failed = true; // e.g. that person deleted their account
          }
        }
        this.d.dispatch({ type: 'status', mid: m.mid, status: failed ? 'failed' : 'sent' });
      } catch {
        /* offline: stays "pending" and is retried after reconnecting */
      } finally {
        this.inFlight.delete(m.mid);
      }
    });
  }

  /** Best-effort control messages (typing, receipts, timer…). Skipped while offline. */
  private control(handles: string[], app: AppMessage) {
    if (!this.online) return Promise.resolve();
    return this.serial(async () => {
      for (const h of handles) {
        try {
          await this.sendTo(h, app);
        } catch {
          /* ignore */
        }
      }
    });
  }

  sendTyping(convo: string) {
    const now = Date.now();
    if (now - this.lastTyping < 3000) return;
    this.lastTyping = now;
    void this.control(this.recipients(convo), { k: 'typing', g: isGroupId(convo) ? convo : undefined });
  }

  sendReceipts(byPerson: Record<string, string[]>, s: 'delivered' | 'read') {
    for (const [h, mids] of Object.entries(byPerson)) if (mids.length) void this.control([h], { k: 'receipt', mids, s });
  }

  sendTimer(convo: string, timer: Timer) {
    void this.control(this.recipients(convo), { k: 'timer', timer, g: isGroupId(convo) ? convo : undefined });
  }

  broadcastProfile() {
    const handles = Object.keys(this.store.sessions);
    void this.control(handles, this.profileMessage()).then(() => {
      for (const h of handles) this.store.profileShared[h] = this.me.version;
      this.persist();
    });
  }

  /** Sends the full group state (name, members, keys) to the given members. */
  sendGroup(group: Group, to: string[]) {
    const s = this.d.getState();
    const wire: WireGroup = {
      id: group.id,
      name: group.name,
      description: group.description,
      color: group.color,
      epoch: group.epoch,
      members: [
        { handle: s.profile.handle, ik: this.store.identity.sign.pub },
        ...group.members.filter((h) => s.contacts[h]).map((h) => ({ handle: h, ik: s.contacts[h].publicKey })),
      ],
    };
    return this.control(to, { k: 'group', group: wire });
  }

  sendGroupRemoved(handle: string, gid: string) {
    return this.control([handle], { k: 'group-removed', g: gid });
  }

  sendGroupLeave(group: Group) {
    return this.control(group.members, { k: 'group-leave', g: group.id });
  }

  /** Throws the session away; the next message starts a fresh key agreement. */
  resetSession(handle: string) {
    return this.serial(() => {
      delete this.store.sessions[handle];
      this.persist();
    });
  }

  async deleteAccount() {
    await this.conn.request({ t: 'delete-account' });
    this.conn.stop();
  }

  /** Re-sends anything that was written while offline. */
  private async flushPending() {
    const s = this.d.getState();
    for (const [convo, list] of Object.entries(s.threads)) {
      for (const m of list) {
        if (m.from === 'me' && m.status === 'pending' && m.mid) {
          void this.sendText(convo, { mid: m.mid, text: m.text, at: m.at, timer: m.timer ?? 'off', file: m.file });
        }
      }
    }
  }

  /* ----------------------------------------------------------- incoming */

  private onServer(m: ServerMsg) {
    if (m.t === 'msg') void this.serial(() => this.receive(m.id, m.ts, m.body));
    else if (m.t === 'opk-low') this.replenish();
  }

  private async receive(id: string, ts: number, body: string) {
    const ack = () => this.conn.send({ t: 'ack', ids: [id] });
    let inner: InnerEnvelope;
    try {
      inner = decodeJson<InnerEnvelope>(unseal(this.store.identity.dh, body));
    } catch {
      return ack(); // not for us / corrupted
    }
    const from = inner.from;
    const existing = this.store.sessions[from];
    let session: Session | undefined;
    let plaintext: Uint8Array | undefined;

    // 1) Try the session we already have with them.
    if (existing && existing.ik === inner.ik) {
      try {
        const r = ratchetDecrypt(existing.ratchet, inner.h, inner.ct);
        plaintext = r.plaintext;
        session = { ...existing, ratchet: r.state, pending: undefined }; // they replied → they have the session
      } catch {
        /* maybe they started a new session */
      }
    }

    // 2) A first message (X3DH): build the matching session from our prekeys.
    if (!plaintext && inner.x3dh && inner.x3dh.ik === inner.ik) {
      try {
        const spk = this.store.spk.id === inner.x3dh.spkId ? this.store.spk : undefined;
        const opk = inner.x3dh.opkId !== undefined ? this.store.opks.find((k) => k.id === inner.x3dh!.opkId) : undefined;
        if (!spk) throw new Error('unknown signed prekey');
        const { sk, ad } = x3dhRespond(this.store.identity, spk, opk, inner.x3dh);
        const r = ratchetDecrypt(ratchetInitBob(sk, spk, ad), inner.h, inner.ct);
        plaintext = r.plaintext;
        if (opk) this.store = { ...this.store, opks: this.store.opks.filter((k) => k.id !== opk.id) }; // one-time means one time
        const fresh: Session = { ik: inner.ik, ikDh: inner.x3dh.ikDh, ratchet: r.state, initiator: false, createdAt: Date.now() };
        // If we both started at the same moment, the smaller identity key keeps its session.
        const keepMine = existing?.pending && existing.ik === inner.ik && this.store.identity.sign.pub < inner.ik;
        session = keepMine ? existing : fresh;
      } catch {
        /* fall through */
      }
    }

    if (!plaintext || !session) {
      this.d.dispatch({ type: 'decryptFailed', handle: from, at: Date.now() });
      return ack();
    }

    // 3) Make sure the handle really belongs to this key (the server is the directory; safety numbers verify it).
    const contact = this.d.getState().contacts[from];
    if (!contact || contact.publicKey !== inner.ik) {
      try {
        const known = await this.lookup(from);
        if (known.publicKey !== inner.ik) return ack(); // someone pretending to be @from — drop it
      } catch {
        return; // can't check right now; the server will deliver it again
      }
      if (contact) this.checkIdentity(from, inner.ik);
    }

    this.store.sessions[from] = session;
    this.persist();
    this.apply(from, inner.ik, decodeJson<AppMessage>(plaintext), ts);
    await this.d.saveNow(); // only tell the server to delete it once it's safely in our vault
    ack();
  }

  private ensureContact(handle: string, ik: string, direct: boolean) {
    const s = this.d.getState();
    if (handle === s.profile.handle) return;
    if (!s.contacts[handle] || (direct && !s.directIds.includes(handle))) {
      this.d.dispatch({ type: 'ensureContacts', contacts: [s.contacts[handle] ?? this.makeContact(handle, ik)], direct });
    }
  }

  private apply(from: string, ik: string, app: AppMessage, ts: number) {
    const now = Date.now();
    const s = this.d.getState();
    switch (app.k) {
      case 'text': {
        const convo = app.g ?? `d:${from}`;
        if (app.g && !s.groups.some((g) => g.id === app.g)) return; // not (or no longer) in that group
        this.ensureContact(from, ik, !app.g);
        const file: FileInfo | undefined = app.file
          ? { name: String(app.file.name).slice(0, 200), size: Number(app.file.size) || 0, type: String(app.file.type), checksum: String(app.file.checksum), dataUrl: String(app.file.data) }
          : undefined;
        this.d.dispatch({ type: 'receive', convo, who: from, mid: app.mid, text: String(app.text ?? '').slice(0, 20_000), at: Math.min(app.at, ts, now), timer: app.timer ?? 'off', file });
        void this.control([from], { k: 'receipt', mids: [app.mid], s: 'delivered' });
        return;
      }
      case 'receipt':
        return this.d.dispatch({ type: 'receipt', who: from, mids: app.mids, s: app.s });
      case 'typing':
        return this.d.dispatch({ type: 'typing', convo: app.g ?? `d:${from}`, who: from, until: now + 5000 });
      case 'timer':
        this.ensureContact(from, ik, !app.g);
        return this.d.dispatch({ type: 'timerSync', convo: app.g ?? `d:${from}`, who: from, timer: app.timer, at: now });
      case 'profile':
        this.ensureContact(from, ik, false);
        return this.d.dispatch({ type: 'peerProfile', handle: from, displayName: app.displayName ?? '', bio: app.bio ?? '', avatar: app.avatar, color: app.color });
      case 'group': {
        const myHandle = s.profile.handle;
        const members = app.group.members.filter((m) => m.handle !== myHandle);
        if (!app.group.members.some((m) => m.handle === myHandle)) {
          return this.d.dispatch({ type: 'groupRemoved', gid: app.group.id, by: from, at: now });
        }
        const known = this.d.getState().contacts;
        const add = members
          .filter((m) => !known[m.handle])
          .map((m) => (m.handle === from ? this.makeContact(from, ik) : this.makeContact(m.handle, m.ik)));
        if (add.length) this.d.dispatch({ type: 'ensureContacts', contacts: add });
        const group: Group = {
          id: app.group.id,
          name: String(app.group.name).slice(0, 32),
          description: String(app.group.description ?? '').slice(0, 120),
          color: app.group.color,
          epoch: app.group.epoch,
          members: members.map((m) => m.handle),
        };
        return this.d.dispatch({ type: 'groupSync', group, from, at: now });
      }
      case 'group-removed':
        return this.d.dispatch({ type: 'groupRemoved', gid: app.g, by: from, at: now });
      case 'group-leave':
        return this.d.dispatch({ type: 'memberLeft', gid: app.g, who: from, at: now });
    }
  }
}

export const newMessageId = () => randomId(12);
export const newGroupId = () => `g:${randomId(9)}`;
