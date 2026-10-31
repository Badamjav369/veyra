import { LANGS, useI18n } from '../i18n';

/** Compact EN | МН switch. */
export function LanguageSwitch() {
  const { lang, setLang, t } = useI18n();
  return (
    <div className="segmented segmented--small" role="group" aria-label={t('lang.label')}>
      {LANGS.map((l) => (
        <button
          key={l.id}
          type="button"
          className="segmented__item"
          aria-pressed={lang === l.id}
          aria-label={t(l.labelKey)}
          title={t(l.labelKey)}
          onClick={() => setLang(l.id)}
        >
          {l.short}
        </button>
      ))}
    </div>
  );
}
