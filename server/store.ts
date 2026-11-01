// Tiny persistent store: one JSON file, written atomically a moment after each change.
// It holds only public keys and sealed (unreadable) envelopes waiting for delivery.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { OneTimePreKeyPublic } from '../shared/protocol';
import type { BackupRecord, Envelope, RelayStore, UserRecord } from './relay';

interface Data {
  users: Record<string, UserRecord>;
  mail: Record<string, Envelope[]>;
  backups?: Record<string, BackupRecord>;
}

/** File-backed store for the Node relay (Cloudflare uses Durable Object storage instead). */
export class Store implements RelayStore {
  private data: Data = { users: {}, mail: {} };
  private timer: NodeJS.Timeout | null = null;

  constructor(private file: string) {
    if (existsSync(file)) {
      try {
        this.data = JSON.parse(readFileSync(file, 'utf8')) as Data;
      } catch (err) {
        console.error('Could not read store, starting empty:', err);
      }
    }
  }

  user(handle: string): UserRecord | undefined {
    return this.data.users[handle];
  }

  addUser(handle: string, record: UserRecord) {
    this.data.users[handle] = record;
    this.changed();
  }

  deleteUser(handle: string) {
    delete this.data.users[handle];
    delete this.data.mail[handle];
    delete this.data.backups?.[handle];
    this.changed();
  }

  /** Removes and returns one one-time prekey (each may be used only once). */
  takeOneTimePreKey(handle: string): OneTimePreKeyPublic | undefined {
    const u = this.data.users[handle];
    const k = u?.opks.shift();
    if (k) this.changed();
    return k;
  }

  countOneTimePreKeys(handle: string): number {
    return this.data.users[handle]?.opks.length ?? 0;
  }

  addOneTimePreKeys(handle: string, keys: OneTimePreKeyPublic[]) {
    const u = this.data.users[handle];
    if (!u) return;
    const known = new Set(u.opks.map((k) => k.id));
    u.opks.push(...keys.filter((k) => !known.has(k.id)));
    u.opks = u.opks.slice(-200);
    this.changed();
  }

  enqueue(handle: string, env: Envelope) {
    (this.data.mail[handle] ??= []).push(env);
    this.changed();
  }

  touch(handle: string) {
    const u = this.data.users[handle];
    if (u) {
      u.lastSeen = Date.now();
      this.changed();
    }
  }

  inactive(before: number): string[] {
    return Object.entries(this.data.users)
      .filter(([, u]) => (u.lastSeen ?? u.createdAt) < before)
      .map(([h]) => h);
  }

  backup(handle: string): BackupRecord | undefined {
    return this.data.backups?.[handle];
  }

  setBackup(handle: string, record: BackupRecord) {
    (this.data.backups ??= {})[handle] = record;
    this.changed();
  }

  mailbox(handle: string): Envelope[] {
    return this.data.mail[handle] ?? [];
  }

  ack(handle: string, ids: string[]) {
    const box = this.data.mail[handle];
    if (!box) return;
    const drop = new Set(ids);
    this.data.mail[handle] = box.filter((e) => !drop.has(e.id));
    this.changed();
  }

  /** Forget undelivered envelopes older than `maxAgeMs`. */
  purge(maxAgeMs: number) {
    const cutoff = Date.now() - maxAgeMs;
    let changed = false;
    for (const [h, box] of Object.entries(this.data.mail)) {
      const kept = box.filter((e) => e.ts >= cutoff);
      if (kept.length !== box.length) {
        this.data.mail[h] = kept;
        changed = true;
      }
    }
    if (changed) this.changed();
  }

  stats() {
    return {
      users: Object.keys(this.data.users).length,
      queued: Object.values(this.data.mail).reduce((n, b) => n + b.length, 0),
    };
  }

  private changed() {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), 250);
  }

  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data));
    renameSync(tmp, this.file);
  }
}
