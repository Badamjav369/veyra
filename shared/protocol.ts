// Everything that travels over the wire. The server only ever sees the types in the "Wire" section;
// the "App" section is what's inside the encrypted envelope and only the two ends can read it.

export const HANDLE_RE = /^[a-z0-9._-]{2,24}$/;
export const MAX_BODY_CHARS = 1_000_000; // must fit in one WebSocket frame (Cloudflare: 1 MiB)

/* ------------------------------------------------------------------ Keys */

/** Public half of a signed prekey. */
export interface SignedPreKeyPublic {
  id: number;
  pub: string; // X25519, base64
  sig: string; // Ed25519 signature over `pub` by the identity key
}

export interface OneTimePreKeyPublic {
  id: number;
  pub: string; // X25519
}

/** What a user uploads when registering. Only public keys — private keys never leave the device. */
export interface UploadBundle {
  ik: string; // Ed25519 identity (signing) key
  ikDh: string; // X25519 identity key for key agreement
  ikDhSig: string; // ikDh signed by ik
  spk: SignedPreKeyPublic;
  opks: OneTimePreKeyPublic[];
}

/** What someone downloads to start a conversation with you. */
export interface PreKeyBundle {
  handle: string;
  ik: string;
  ikDh: string;
  ikDhSig: string;
  spk: SignedPreKeyPublic;
  opk?: OneTimePreKeyPublic;
}

/* ----------------------------------------------------------------- Wire */

export type ClientMsg =
  | { t: 'register'; handle: string; bundle: UploadBundle; sig: string } // sig over `register|<nonce>|<handle>`
  | { t: 'auth'; handle: string; sig: string } // sig over `auth|<nonce>|<handle>`
  | { t: 'identity'; rid: number; handle: string }
  | { t: 'bundle'; rid: number; handle: string }
  | { t: 'send'; rid: number; to: string; body: string } // body = sealed envelope (base64)
  | { t: 'ack'; ids: string[] }
  | { t: 'opks'; opks: OneTimePreKeyPublic[] }
  | { t: 'delete-account'; rid: number }
  // Encrypted account backup (lets you sign in on another device with handle + password).
  // `auth` is a key derived from the password; the server keeps only its hash.
  | { t: 'backup-get'; rid: number; handle: string; auth: string; by?: 'recovery' } // allowed before signing in
  | {
      t: 'backup-put';
      rid: number;
      blob: string; // the account, encrypted with a random data key
      device: string;
      auth?: string; // login key — sets / changes the password
      wrap?: string; // the data key, encrypted with the password
      recovery?: { auth: string; wrap: string }; // same, for the recovery code
    }
  | { t: 'ping' };

/** What the server knows about a backup (never its contents). */
export interface BackupMeta {
  rev: number; // increases by one on every upload
  device: string; // random id of the device that uploaded it
  at: number;
}

export type ServerMsg =
  | { t: 'challenge'; nonce: string }
  | { t: 'ready'; handle: string; opkCount: number; backup?: BackupMeta }
  | { t: 'error'; rid?: number; code: ErrorCode; message?: string }
  | { t: 'identity'; rid: number; handle: string; ik: string; ikDh: string; ikDhSig: string }
  | { t: 'bundle'; rid: number; bundle: PreKeyBundle }
  | { t: 'sent'; rid: number; id: string }
  | { t: 'msg'; id: string; ts: number; body: string }
  | { t: 'opk-low'; count: number }
  | { t: 'deleted'; rid: number }
  | { t: 'backup'; rid: number; blob: string; wrap?: string; meta: BackupMeta }
  | { t: 'backup-saved'; rid: number; meta: BackupMeta }
  | { t: 'pong' };

export type ErrorCode =
  | 'bad_request'
  | 'bad_signature'
  | 'handle_taken'
  | 'invalid_handle'
  | 'not_found'
  | 'not_authenticated'
  | 'too_large'
  | 'rate_limited'
  | 'bad_login' // wrong password (or no such account)
  | 'no_backup' // the account exists but never uploaded a backup
  | 'no_recovery' // no recovery code was set up
  | 'locked_out' // too many wrong passwords; try again later
  | 'replaced'; // you signed in somewhere else

export const authMessage = (kind: 'register' | 'auth', nonce: string, handle: string) => `${kind}|${nonce}|${handle}`;

/* ------------------------------------------------------------------ App */

export type Timer = 'off' | '30s' | '5m' | '1h' | '1d';

export interface WireFile {
  name: string;
  size: number;
  type: string;
  checksum: string;
  data: string; // data: URL
}

export interface WireGroup {
  id: string;
  name: string;
  description: string;
  color: string;
  epoch: number; // version — higher wins
  members: { handle: string; ik: string }[]; // everyone, including the sender
}

/** Decrypted content. Nothing in here is visible to the server. */
export type AppMessage =
  | { k: 'text'; mid: string; text: string; at: number; timer: Timer; file?: WireFile; g?: string }
  | { k: 'receipt'; mids: string[]; s: 'delivered' | 'read' }
  | { k: 'typing'; g?: string }
  | { k: 'timer'; timer: Timer; g?: string }
  | { k: 'profile'; displayName: string; bio: string; color: string; avatar?: string }
  | { k: 'group'; group: WireGroup }
  | { k: 'group-removed'; g: string }
  | { k: 'group-leave'; g: string };
