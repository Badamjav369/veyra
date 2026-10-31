import type { Lang, Translate } from '../i18n';

const locale = (lang: Lang) => (lang === 'mn' ? 'mn-MN' : 'en-GB');

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function formatClock(at: number, lang: Lang, clock: '24h' | '12h' = '24h'): string {
  if (clock === '12h') {
    return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).format(at);
  }
  return new Intl.DateTimeFormat(locale(lang), { hour: '2-digit', minute: '2-digit', hour12: false }).format(at);
}

export function formatDay(at: number, lang: Lang, t: Translate, now = Date.now()): string {
  const diff = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);
  if (diff === 0) return t('chat.today');
  if (diff === 1) return t('chat.yesterday');
  return new Intl.DateTimeFormat(locale(lang), { month: 'short', day: 'numeric' }).format(at);
}

export function formatListTime(at: number, lang: Lang, t: Translate, clock: '24h' | '12h', now = Date.now()): string {
  return startOfDay(at) === startOfDay(now) ? formatClock(at, lang, clock) : formatDay(at, lang, t, now);
}

export function sameDay(a: number, b: number): boolean {
  return startOfDay(a) === startOfDay(b);
}

/** "45s", "18m", "3h", "2d" (translated units). */
export function formatRemaining(ms: number, t: Translate): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return t('unit.s', { n: s });
  const m = Math.ceil(s / 60);
  if (m < 60) return t('unit.m', { n: m });
  const h = Math.ceil(m / 60);
  if (h < 24) return t('unit.h', { n: h });
  return t('unit.d', { n: Math.ceil(h / 24) });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
