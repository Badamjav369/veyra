// Small deterministic helpers for the look of the app (no real cryptography here).

const CIPHER_CHARS = '0123456789abcdef#%&*+=/<>ABCDEFXZ';

/** Turns text into same-length "ciphertext" noise. Spaces are kept so line breaks don't jump. */
export function scramble(text: string, seed: number): string {
  let x = Math.imul(seed, 2654435761) >>> 0;
  let out = '';
  for (const ch of text) {
    if (ch === ' ' || ch === '\n') {
      out += ch;
      continue;
    }
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    out += CIPHER_CHARS[(x >>> 16) % CIPHER_CHARS.length];
  }
  return out;
}

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/** 5×5 mirrored pattern (25 booleans) derived from a seed — a visual fingerprint for each contact. */
export function identiconCells(seed: string): boolean[] {
  const h = hash(seed);
  const cells: boolean[] = [];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      const mirrored = col < 3 ? col : 4 - col;
      cells.push(((h >>> (row * 3 + mirrored)) & 1) === 1);
    }
  }
  return cells;
}

/** A QR-like 21×21 pattern for the verify screen (placeholder until real key exchange exists). */
export function codePattern(seed: string): boolean[] {
  const N = 21;
  const finders: [number, number][] = [
    [0, 0],
    [0, 14],
    [14, 0],
  ];
  let x = hash(seed) || 1;
  const cells: boolean[] = [];
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      let on = false;
      let fixed = false;
      for (const [R, C] of finders) {
        if (r >= R - 1 && r <= R + 7 && c >= C - 1 && c <= C + 7) {
          fixed = true;
          if (r >= R && r < R + 7 && c >= C && c < C + 7) {
            const ring = Math.min(r - R, c - C, R + 6 - r, C + 6 - c);
            on = ring !== 1;
          }
        }
      }
      if (!fixed) {
        if (r === 6 || c === 6) on = (r + c) % 2 === 0;
        else {
          x = (Math.imul(x, 1103515245) + 12345) >>> 0;
          on = ((x >>> 16) & 3) < 2;
        }
      }
      cells.push(on);
    }
  }
  return cells;
}
