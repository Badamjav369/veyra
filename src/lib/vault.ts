// The vault: all app data, encrypted with AES-256-GCM using a key derived from the passphrase
// (PBKDF2-SHA-256). Only ciphertext is written to localStorage.

import { fromB64, randomBytes, toB64, utf8 } from './crypto';

const STORAGE_KEY = 'shivnee.vault.v1';
const ITERATIONS = 310_000;

interface StoredVault {
  v: 1;
  salt: string;
  iv: string;
  ct: string;
  iter: number;
}

export interface VaultSession {
  key: CryptoKey;
  salt: string;
  iter: number;
}

export class WrongPassphraseError extends Error {
  constructor() {
    super('wrong passphrase');
  }
}

export function hasVault(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

async function deriveKey(passphrase: string, salt: string, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', utf8(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: fromB64(salt), iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function createVault(passphrase: string, data: unknown): Promise<VaultSession> {
  const salt = toB64(randomBytes(16));
  const session = { key: await deriveKey(passphrase, salt, ITERATIONS), salt, iter: ITERATIONS };
  await saveVault(session, data);
  return session;
}

/** Re-encrypts and stores the data. A fresh IV is used for every save. */
export async function saveVault(session: VaultSession, data: unknown): Promise<void> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, session.key, utf8(JSON.stringify(data)));
  const stored: StoredVault = { v: 1, salt: session.salt, iv: toB64(iv), ct: toB64(ct), iter: session.iter };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored)); // throws when storage is full
}

export async function openVault<T>(passphrase: string): Promise<{ session: VaultSession; data: T }> {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) throw new Error('no vault');
  const stored = JSON.parse(raw) as StoredVault;
  const key = await deriveKey(passphrase, stored.salt, stored.iter);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(stored.iv) }, key, fromB64(stored.ct));
  } catch {
    throw new WrongPassphraseError();
  }
  return {
    session: { key, salt: stored.salt, iter: stored.iter },
    data: JSON.parse(new TextDecoder().decode(plain)) as T,
  };
}

export function eraseVault(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to erase */
  }
}
