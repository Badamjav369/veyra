// Small byte helpers that work the same in the browser and in Node.

export type Bytes = Uint8Array;

const enc = new TextEncoder();
const dec = new TextDecoder();

export const utf8 = (s: string): Bytes => enc.encode(s);
export const fromUtf8 = (b: Bytes): string => dec.decode(b);

export function b64(bytes: Bytes): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function unb64(s: string): Bytes {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function concat(...parts: Bytes[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function randomBytes(n: number): Bytes {
  return (globalThis as unknown as { crypto: { getRandomValues<T extends Uint8Array>(a: T): T } }).crypto.getRandomValues(new Uint8Array(n));
}

/** Random URL-safe id, e.g. for message ids. */
export function randomId(bytes = 12): string {
  return b64(randomBytes(bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** True if `s` is base64 that decodes to exactly `len` bytes. */
export function isB64Len(s: unknown, len: number): s is string {
  if (typeof s !== 'string' || s.length > 4 * Math.ceil(len / 3) + 4) return false;
  try {
    return unb64(s).length === len;
  } catch {
    return false;
  }
}
