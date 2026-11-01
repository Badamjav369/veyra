import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { en, type MessageKey } from './en';

// The app is English only. Strings still live in en.ts so they're easy to find and change.
export type Lang = 'en';
export type Params = Record<string, string | number>;
export type Translate = (key: MessageKey, params?: Params) => string;

function format(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

interface I18nValue {
  lang: Lang;
  t: Translate;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    document.documentElement.lang = 'en';
  }, []);
  const t = useCallback<Translate>((key, params) => format(en[key], params), []);
  const value = useMemo(() => ({ lang: 'en' as const, t }), [t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}
