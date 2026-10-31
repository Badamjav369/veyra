import type { IdentityKeys, PreKey, SignedPreKey } from '../../shared/e2ee';
import type { ChatState, Profile } from '../types';

// Builds the starting state for a brand-new identity, and checks vaults loaded from storage.

export function createState(profile: Profile, keys: { identity: IdentityKeys; spk: SignedPreKey; opks: PreKey[]; nextOpkId: number }): ChatState {
  return {
    v: 3,
    profile,
    crypto: { identity: keys.identity, spk: keys.spk, opks: keys.opks, nextOpkId: keys.nextOpkId, sessions: {}, profileShared: {} },
    contacts: {},
    directIds: [],
    section: 'direct',
    activeDirect: '',
    activeGroup: '',
    groups: [],
    threads: {},
    unread: {},
    timers: {},
    typing: null,
    tick: 0,
    nextId: 1,
    hidePreviews: false,
    privacyScreen: false,
    toggles: { hideOnBlur: false, receipts: true, typing: true },
  };
}

export class OldVaultError extends Error {
  constructor() {
    super('old vault');
  }
}

/** After unlocking: refuse vaults from older versions, finish half-played animations, clear transient state. */
export function normalizeLoaded(state: ChatState): ChatState {
  if ((state as { v?: number }).v !== 3 || !state.crypto) throw new OldVaultError();
  const threads: ChatState['threads'] = {};
  for (const [k, list] of Object.entries(state.threads)) threads[k] = list.map((m) => ({ ...m, revealed: m.text.length }));
  return { ...state, threads, typing: null, tick: 0 };
}
