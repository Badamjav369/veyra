// Real cryptography (Web Crypto) for identity keys, fingerprints, safety numbers and checksums.

export type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();

export function toB64(data: ArrayBuffer | Bytes): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

export function fromB64(b64: string): Bytes {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function utf8(text: string): Bytes {
  return encoder.encode(text) as Bytes;
}

export function randomBytes(n: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(n));
}

export async function sha256(data: Bytes | ArrayBuffer | string): Promise<Bytes> {
  const input = typeof data === 'string' ? utf8(data) : data;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', input));
}

export function hex(bytes: Bytes): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A contact code people can share: veyra:<handle>:<public key> (older codes start with shivnee:). */
export function contactCode(handle: string, publicKey: string): string {
  return `veyra:${handle}:${publicKey}`;
}

export function parseContactCode(code: string): { handle: string; publicKey: string } | null {
  const m = code.trim().match(/^(?:veyra|shivnee):([a-z0-9._-]{2,24}):([A-Za-z0-9+/=]{40,200})$/i);
  if (!m) return null;
  try {
    fromB64(m[2]);
  } catch {
    return null;
  }
  return { handle: m[1].toLowerCase(), publicKey: m[2] };
}

export function isWebCryptoAvailable(): boolean {
  return typeof crypto !== 'undefined' && !!crypto.subtle;
}
