import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { en, type Dictionary, type MessageKey } from './en';
import { mn } from './mn';
import { usePersistentState } from '../lib/usePersistentState';

export type Lang = 'en' | 'mn';
export type Params = Record<string, string | number>;
export type Translate = (key: MessageKey, params?: Params) => string;

export const LANGS: { id: Lang; short: string; labelKey: MessageKey }[] = [
  { id: 'en', short: 'EN', labelKey: 'lang.en' },
  { id: 'mn', short: 'МН', labelKey: 'lang.mn' },
];

const dictionaries: Record<Lang, Dictionary> = { en, mn };

function format(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: Translate;
}

const I18nContext = createContext<I18nValue | null>(null);

function initialLang(): Lang {
  // English is the default; only switch on the first visit if the browser prefers Mongolian.
  if (typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('mn')) return 'mn';
  return 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = usePersistentState<Lang>('shivnee.lang', initialLang());

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const t = useCallback<Translate>(
    (key, params) => format(dictionaries[lang][key] ?? en[key], params),
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}
