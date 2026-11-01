// Signing in and keeping the server backup in step.
//
// Sign-in looks at two copies of your account — the one on this device (if any) and the encrypted
// backup on the server — and picks the newer one. Both are opened with keys derived from your
// password; the server only checks the separate login key.

import type { BackupMeta } from '../../shared/protocol';
import { fetchBackup, ServerError } from '../net/connection';
import { normalizeLoaded, OldVaultError } from '../state/init';
import type { ChatState } from '../types';
import {
  dataKeys,
  deriveAccountKeys,
  newDataKey,
  newRecoveryCode,
  recoveryKeys,
  deviceId,
  eraseLegacyVault,
  hasLegacyVault,
  hasLocal,
  openData,
  openLegacyVault,
  openLocal,
  rememberAccount,
  saveVault,
  sealData,
  WrongPassphraseError,
  type AccountKeys,
  type VaultSession,
} from './vault';

export type SignInStep = 'keys' | 'server' | 'restore';

export type SignInError =
  | 'wrong' // wrong password
  | 'noAccount' // no such handle
  | 'locked' // too many wrong passwords
  | 'unreachable' // server down and nothing on this device
  | 'noBackup' // account made on another device before backups existed
  | 'passwordChanged' // this device's copy opens, but the server wants a newer password
  | 'oldVault'
  | 'noRecovery' // no recovery code was set up for this account
  | 'wrongCode' // wrong recovery code
  | 'failed';

export class SignInFailure extends Error {
  constructor(public reason: SignInError) {
    super(reason);
  }
}

export interface SignedIn {
  session: VaultSession;
  state: ChatState;
  /** Where the data came from: this device, the server backup, or a pre-sign-in vault. */
  source: 'device' | 'server' | 'legacy';
  offline: boolean;
}

/**
 * Restored sessions may be a little behind (the other device kept chatting after its last upload).
 * They're kept for *reading* messages that are already on their way, but never used to send: the next
 * message to each person starts a fresh key agreement, so no message key can ever be used twice.
 */
function markSessionsStale(s: ChatState): ChatState {
  const sessions: ChatState['crypto']['sessions'] = {};
  for (const [h, sess] of Object.entries(s.crypto.sessions)) sessions[h] = { ...sess, stale: true };
  return { ...s, crypto: { ...s.crypto, sessions } };
}

/** Takes the server copy, but keeps file contents this device still has (backups leave them out). */
function adopt(remote: ChatState, local: ChatState | null): ChatState {
  const next = markSessionsStale(remote);
  if (!local) return next;
  const files = new Map<string, string>();
  for (const list of Object.values(local.threads)) for (const m of list) if (m.mid && m.file?.dataUrl) files.set(m.mid, m.file.dataUrl);
  const threads: ChatState['threads'] = {};
  for (const [k, list] of Object.entries(next.threads)) {
    threads[k] = list.map((m) => (m.mid && m.file && !m.file.dataUrl && files.has(m.mid) ? { ...m, file: { ...m.file, dataUrl: files.get(m.mid) } } : m));
  }
  return { ...next, threads };
}

/** Opens a server backup: newer ones lock the data key with the password (or recovery code). */
async function openRemote(keys: AccountKeys, remote: { blob: string; wrap?: string }): Promise<ChatState> {
  if (!remote.wrap) return openData<ChatState>(keys, remote.blob); // first backups were locked with the password directly
  const { dek } = await openData<{ dek: string }>(keys, remote.wrap);
  return openData<ChatState>(await dataKeys(keys.handle, dek), remote.blob);
}

/** Accounts from before data keys existed get one now. */
const withAccount = (s: ChatState): ChatState => (s.account?.dek ? s : { ...s, account: { dek: newDataKey() } });

export async function signIn(server: string, handle: string, password: string, onStep: (s: SignInStep) => void): Promise<SignedIn> {
  onStep('keys');
  const keys = await deriveAccountKeys(handle, password);

  // This device's copy, if there is one.
  let local: { data: ChatState; syncedRev: number } | null = null;
  let localWrong = false;
  if (hasLocal(handle)) {
    try {
      local = await openLocal<ChatState>(keys);
    } catch (err) {
      if (err instanceof WrongPassphraseError) localWrong = true;
      else throw new SignInFailure('failed');
    }
  }

  onStep('server');
  let remote: { blob: string; meta: BackupMeta } | null = null;
  let remoteError = '';
  try {
    remote = await fetchBackup(server, handle, keys.auth);
  } catch (err) {
    remoteError = err instanceof ServerError ? err.code : 'offline';
  }

  const done = async (state: ChatState, syncedRev: number, source: SignedIn['source']): Promise<SignedIn> => {
    let normalized: ChatState;
    try {
      normalized = withAccount(normalizeLoaded(state));
    } catch (err) {
      throw new SignInFailure(err instanceof OldVaultError ? 'oldVault' : 'failed');
    }
    if (normalized.profile.handle !== handle) throw new SignInFailure('failed');
    const session: VaultSession = { ...keys, syncedRev };
    if (source !== 'device' || !state.account?.dek) await saveVault(session, normalized);
    rememberAccount(handle);
    return { session, state: normalized, source, offline: remoteError === 'offline' || remoteError === 'timeout' };
  };

  if (remote) {
    const mine = remote.meta.device === deviceId();
    if (local && (mine || remote.meta.rev <= local.syncedRev)) return done(local.data, Math.max(local.syncedRev, mine ? remote.meta.rev : 0), 'device');
    onStep('restore');
    let data: ChatState;
    try {
      data = await openRemote(keys, remote);
    } catch {
      throw new SignInFailure('failed');
    }
    return done(adopt(data, local?.data ?? null), remote.meta.rev, 'server');
  }

  switch (remoteError) {
    case 'bad_login':
      throw new SignInFailure(local ? 'passwordChanged' : 'wrong');
    case 'locked_out':
      throw new SignInFailure('locked');
    case 'not_found':
    case 'no_backup':
    case 'offline':
    case 'timeout':
      if (local) return done(local.data, local.syncedRev, 'device'); // offline, or the server was reset (the app re-registers)
      if (localWrong) throw new SignInFailure('wrong');
      // A vault from before sign-in existed: same browser, same passphrase.
      if (hasLegacyVault()) {
        try {
          const old = await openLegacyVault<ChatState>(password);
          if (old.profile?.handle === handle) {
            const r = await done(old, 0, 'legacy');
            eraseLegacyVault();
            return r;
          }
        } catch (err) {
          if (err instanceof SignInFailure) throw err;
          /* not this one */
        }
      }
      if (remoteError === 'not_found') throw new SignInFailure('noAccount');
      if (remoteError === 'no_backup') throw new SignInFailure('noBackup');
      throw new SignInFailure('unreachable');
    default:
      throw new SignInFailure('failed');
  }
}

/* ------------------------------------------------------------ recovery */

/** Signs in with the recovery code and sets a new password. */
export async function recoverAccount(server: string, handle: string, code: string, newPassword: string, onStep: (s: SignInStep) => void): Promise<SignedIn> {
  onStep('keys');
  const rc = await recoveryKeys(handle, code);
  onStep('server');
  let remote: { blob: string; wrap?: string; meta: BackupMeta };
  try {
    remote = await fetchBackup(server, handle, rc.auth, 10_000, 'recovery');
  } catch (err) {
    const code = err instanceof ServerError ? err.code : 'offline';
    throw new SignInFailure(
      code === 'bad_login' ? 'wrongCode' : code === 'not_found' ? 'noAccount' : code === 'no_backup' || code === 'no_recovery' ? 'noRecovery' : code === 'locked_out' ? 'locked' : code === 'offline' || code === 'timeout' ? 'unreachable' : 'failed',
    );
  }
  onStep('restore');
  let data: ChatState;
  try {
    data = withAccount(normalizeLoaded(adopt(await openRemote(rc, remote), null)));
  } catch {
    throw new SignInFailure('failed');
  }
  if (data.profile.handle !== handle) throw new SignInFailure('failed');
  // The new password takes over once the app connects and uploads (it always sends the login key).
  const session: VaultSession = { ...(await deriveAccountKeys(handle, newPassword)), syncedRev: remote.meta.rev };
  await saveVault(session, data);
  rememberAccount(handle);
  return { session, state: data, source: 'server', offline: false };
}

/** A fresh recovery code and what the server needs to accept it. Show the code once. */
export async function makeRecovery(handle: string, dek: string): Promise<{ code: string; recovery: { auth: string; wrap: string; at: number } }> {
  const code = newRecoveryCode();
  const rc = await recoveryKeys(handle, code);
  return { code, recovery: { auth: rc.auth, wrap: await sealData(rc, { dek }), at: Date.now() } };
}

/* -------------------------------------------------------------- backup */

const MAX_BLOB = 900_000; // base64 characters; the relay accepts up to 960 000

/**
 * What goes to the server: everything except file contents (they can be large), and only the most
 * recent messages if the history is too big for one upload.
 */
export async function makeBackup(session: VaultSession, state: ChatState): Promise<{ blob: string; wrap: string; recovery?: { auth: string; wrap: string } }> {
  const dek = state.account!.dek;
  const blob = await makeBackupBlob(await dataKeys(session.handle, dek), state);
  const rc = state.account!.recovery;
  return { blob, wrap: await sealData(session, { dek }), recovery: rc ? { auth: rc.auth, wrap: rc.wrap } : undefined };
}

async function makeBackupBlob(session: AccountKeys, state: ChatState): Promise<string> {
  for (const keep of [1000, 300, 100, 30, 0]) {
    for (const dropPhotos of [false, true]) {
      const threads: ChatState['threads'] = {};
      for (const [k, list] of Object.entries(state.threads)) {
        const kept = keep === 0 ? [] : list.slice(-keep);
        threads[k] = kept.map((m) => (m.file?.dataUrl ? { ...m, file: { ...m.file, dataUrl: undefined } } : m));
      }
      const contacts: ChatState['contacts'] = {};
      for (const [h, c] of Object.entries(state.contacts)) contacts[h] = dropPhotos ? { ...c, avatar: undefined } : c;
      const blob = await sealData(session, { ...state, threads, contacts, typing: null, tick: 0 });
      if (blob.length <= MAX_BLOB) return blob;
    }
  }
  throw new Error('backup too large');
}
