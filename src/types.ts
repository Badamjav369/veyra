import type { IdentityKeys, PreKey, RatchetState, SignedPreKey, X3dhHeader } from '../shared/e2ee';
import type { Timer } from '../shared/protocol';
import type { MessageKey } from './i18n/en';

export type { Timer };
export type Section = 'direct' | 'group';
export type Presence = 'online' | 'away' | 'dnd' | 'hidden';
export type MsgStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

export const TIMERS: Timer[] = ['off', '30s', '5m', '1h', '1d'];
export const TIMER_MS: Record<Timer, number> = {
  off: 0,
  '30s': 30_000,
  '5m': 5 * 60_000,
  '1h': 60 * 60_000,
  '1d': 24 * 60 * 60_000,
};

export type Avatar =
  | { kind: 'identicon'; seed: string; color: string }
  | { kind: 'image'; dataUrl: string; color: string; seed: string };

export interface Profile {
  displayName: string;
  handle: string; // registered on the server; can't change
  bio: string;
  presence: Presence;
  avatar: Avatar;
  publicKey: string; // Ed25519 identity key (public)
  fingerprint: string;
  createdAt: number;
  version: number; // bumps on every edit so contacts get the update
}

export interface Contact {
  id: string; // = handle
  handle: string;
  nickname: string; // set by you, only you see it
  displayName: string; // set by them (shared over the encrypted channel)
  bio: string;
  avatar?: string; // their photo, if they shared one
  color: string;
  publicKey: string; // their identity key
  safety: string[];
  verified: boolean;
  addedAt: number;
}

export interface Group {
  id: string; // "g:<random>"
  name: string;
  description: string;
  members: string[]; // handles, not including you
  epoch: number; // version of the group's settings/membership
  color: string;
}

export interface FileInfo {
  name: string;
  size: number;
  type: string;
  checksum: string;
  dataUrl?: string;
}

export interface SystemEvent {
  key: MessageKey;
  /** `name` may be a handle or "me"; `names` a list of handles; `timer` a Timer id. */
  params?: { name?: string; names?: string[]; timer?: Timer; n?: number; group?: string };
}

export interface Message {
  id: number; // local
  mid?: string; // global id (shared with the other side, used for receipts)
  from: 'me' | 'them' | 'system';
  who?: string; // sender handle when from === 'them'
  text: string;
  at: number;
  timer?: Timer;
  expiresAt?: number;
  revealed: number; // characters decrypted so far (drives the decrypt animation)
  status?: MsgStatus;
  readSent?: boolean;
  file?: FileInfo;
  system?: SystemEvent;
}

/** One end-to-end encrypted session with one person. Lives only inside the encrypted vault. */
export interface Session {
  ik: string;
  ikDh: string;
  ratchet: RatchetState;
  pending?: X3dhHeader; // sent along until they reply, so they can build the same session
  initiator: boolean;
  createdAt: number;
}

export interface CryptoStore {
  identity: IdentityKeys;
  spk: SignedPreKey;
  opks: PreKey[]; // private halves of the one-time prekeys we uploaded
  nextOpkId: number;
  sessions: Record<string, Session>;
  profileShared: Record<string, number>; // handle → profile version they have
}

export interface ChatState {
  v: 3;
  profile: Profile;
  crypto: CryptoStore;
  contacts: Record<string, Contact>;
  directIds: string[]; // handles with a direct conversation, newest first
  section: Section;
  activeDirect: string; // "d:<handle>" or ""
  activeGroup: string; // "g:<id>" or ""
  groups: Group[];
  threads: Record<string, Message[]>;
  unread: Record<string, number>;
  timers: Record<string, Timer>;
  typing: { convo: string; who: string; until: number } | null;
  tick: number;
  nextId: number;
  hidePreviews: boolean;
  privacyScreen: boolean;
  toggles: { hideOnBlur: boolean; receipts: boolean; typing: boolean };
}

export const PALETTE = ['#8FD9B6', '#9DB8F2', '#E2B67F', '#C3A8F0', '#E7A3B4', '#7FD1D9', '#D9D27F'];

export function colorFor(handle: string): string {
  let h = 0;
  for (let i = 0; i < handle.length; i++) h = (h * 31 + handle.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
