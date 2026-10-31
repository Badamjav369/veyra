import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { usePersistentState } from './lib/usePersistentState';

// Look-and-feel preferences. Stored unencrypted because the unlock screen needs them before the vault opens;
// nothing personal lives here.

export interface Prefs {
  accent: string; // hex
  binary: boolean;
  binaryLevel: 'low' | 'medium' | 'high';
  textSize: 'sm' | 'md' | 'lg';
  bubbles: 'round' | 'soft' | 'square';
  density: 'comfy' | 'compact';
  clock: '24h' | '12h';
  enterToSend: boolean;
  autoLock: 0 | 1 | 5 | 15 | 60; // minutes, 0 = never
  server: string; // relay WebSocket URL; empty = default
}

export const DEFAULT_PREFS: Prefs = {
  accent: '#8FD9B6',
  binary: true,
  binaryLevel: 'medium',
  textSize: 'md',
  bubbles: 'round',
  density: 'comfy',
  clock: '24h',
  enterToSend: true,
  autoLock: 15,
  server: '',
};

export const ACCENT_PRESETS = [
  { id: 'mint', hex: '#8FD9B6' },
  { id: 'blue', hex: '#9DB8F2' },
  { id: 'amber', hex: '#E2B67F' },
  { id: 'lilac', hex: '#C3A8F0' },
  { id: 'rose', hex: '#E7A3B4' },
] as const;

const BG = '#0D1012';

function parseHex(hex: string): [number, number, number] {
  const v = hex.replace('#', '');
  const full = v.length === 3 ? v.split('').map((c) => c + c).join('') : v;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Blend `hex` toward the app background; t = 0 → hex, t = 1 → background. */
export function mix(hex: string, t: number, toward = BG): string {
  const a = parseHex(hex);
  const b = parseHex(toward);
  return (
    '#' +
    a
      .map((c, i) => Math.max(0, Math.min(255, Math.round(c + (b[i] - c) * t))).toString(16).padStart(2, '0'))
      .join('')
  );
}

/** Make sure a custom accent is light enough to read on the dark background. */
export function readableAccent(hex: string): string {
  if (!/^#?[0-9a-f]{6}$/i.test(hex)) return DEFAULT_PREFS.accent;
  const [r, g, b] = parseHex(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum < 0.28 ? mix(hex.startsWith('#') ? hex : `#${hex}`, -0.6, '#000000') : hex.startsWith('#') ? hex : `#${hex}`;
}

const SCALE = { sm: 0.93, md: 1, lg: 1.12 };
const RADIUS = { round: [18, 6], soft: [12, 4], square: [6, 2] };
const BINARY = { low: 0.22, medium: 0.4, high: 0.6 };

interface PrefsValue {
  prefs: Prefs;
  setPrefs: (patch: Partial<Prefs>) => void;
}

const PrefsContext = createContext<PrefsValue | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = usePersistentState<Partial<Prefs>>('shivnee.prefs', DEFAULT_PREFS);
  const prefs = useMemo(() => ({ ...DEFAULT_PREFS, ...stored }), [stored]);

  const setPrefs = useCallback((patch: Partial<Prefs>) => setStored({ ...prefs, ...patch }), [prefs, setStored]);

  useEffect(() => {
    const root = document.documentElement;
    const accent = readableAccent(prefs.accent);
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--accent-deep', mix(accent, 0.8));
    root.style.setProperty('--accent-line', mix(accent, 0.62));
    root.style.setProperty('--text-scale', String(SCALE[prefs.textSize]));
    root.style.setProperty('--bubble-r', `${RADIUS[prefs.bubbles][0]}px`);
    root.style.setProperty('--bubble-tail', `${RADIUS[prefs.bubbles][1]}px`);
    root.style.setProperty('--binary-opacity', String(BINARY[prefs.binaryLevel]));
    root.dataset.density = prefs.density;
  }, [prefs]);

  const value = useMemo(() => ({ prefs, setPrefs }), [prefs, setPrefs]);
  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): PrefsValue {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error('usePrefs must be used inside <PrefsProvider>');
  return ctx;
}
