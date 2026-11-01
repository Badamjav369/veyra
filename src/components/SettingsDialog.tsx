import { useState, type FormEvent } from 'react';
import { LANGS, useI18n } from '../i18n';
import type { MessageKey } from '../i18n/en';
import { defaultServerUrl } from '../net/connection';
import { ACCENT_PRESETS, usePrefs, type Prefs } from '../prefs';
import { ColorPicker, Segmented, SwitchRow } from './controls';
import { LockIcon, TrashIcon } from './Icons';
import { Modal } from './Modal';

type Tab = 'general' | 'appearance' | 'security';

export function SettingsDialog({
  onChangePassphrase,
  recoveryAt,
  onRecovery,
  onLock,
  onErase,
  onClose,
}: {
  onChangePassphrase: (current: string, next: string) => Promise<'ok' | 'wrong' | 'offline'>;
  recoveryAt?: number;
  onRecovery: () => void;
  onLock: () => void;
  onErase: () => void;
  onClose: () => void;
}) {
  const { t, lang, setLang } = useI18n();
  const { prefs, setPrefs } = usePrefs();
  const [tab, setTab] = useState<Tab>('general');

  const tabs: { id: Tab; label: MessageKey }[] = [
    { id: 'general', label: 'settings.tabGeneral' },
    { id: 'appearance', label: 'settings.tabAppearance' },
    { id: 'security', label: 'settings.tabSecurity' },
  ];

  return (
    <Modal title={t('settings.title')} labelId="settings-title" onClose={onClose} width={540}>
      <div className="settings">
        <div className="tabs tabs--inline" role="tablist" aria-label={t('settings.title')}>
          {tabs.map((x) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              id={`st-${x.id}`}
              aria-selected={tab === x.id}
              aria-controls={`sp-${x.id}`}
              className="tabs__tab"
              onClick={() => setTab(x.id)}
            >
              {t(x.label)}
            </button>
          ))}
        </div>

        <div role="tabpanel" id={`sp-${tab}`} aria-labelledby={`st-${tab}`} className="settings__panel">
          {tab === 'general' && (
            <>
              <Field label={t('settings.language')}>
                <Segmented label={t('settings.language')} value={lang} onChange={setLang} options={LANGS.map((l) => ({ value: l.id, label: t(l.labelKey) }))} />
              </Field>
              <Field label={t('settings.clock')}>
                <Segmented<Prefs['clock']>
                  label={t('settings.clock')}
                  value={prefs.clock}
                  onChange={(clock) => setPrefs({ clock })}
                  options={[
                    { value: '24h', label: t('clock.24h') },
                    { value: '12h', label: t('clock.12h') },
                  ]}
                />
              </Field>
              <ServerField />
              <SwitchRow
                id="sw-enter"
                label={t('settings.enterToSend')}
                hint={t('settings.enterToSendHint')}
                checked={prefs.enterToSend}
                onChange={(enterToSend) => setPrefs({ enterToSend })}
              />
            </>
          )}

          {tab === 'appearance' && (
            <>
              <Field label={t('settings.accent')}>
                <ColorPicker
                  label={t('settings.accent')}
                  value={prefs.accent}
                  colors={ACCENT_PRESETS.map((a) => a.hex)}
                  names={ACCENT_PRESETS.map((a) => t(`accent.${a.id}` as MessageKey))}
                  customLabel={t('settings.custom')}
                  onChange={(accent) => setPrefs({ accent })}
                />
              </Field>
              <Field label={t('settings.textSize')}>
                <Segmented<Prefs['textSize']>
                  label={t('settings.textSize')}
                  value={prefs.textSize}
                  onChange={(textSize) => setPrefs({ textSize })}
                  options={(['sm', 'md', 'lg'] as const).map((v) => ({ value: v, label: t(`size.${v}`) }))}
                />
              </Field>
              <Field label={t('settings.bubbles')}>
                <Segmented<Prefs['bubbles']>
                  label={t('settings.bubbles')}
                  value={prefs.bubbles}
                  onChange={(bubbles) => setPrefs({ bubbles })}
                  options={(['round', 'soft', 'square'] as const).map((v) => ({
                    value: v,
                    label: (
                      <span className="shape-option">
                        <i className={`shape-sample shape-sample--${v}`} aria-hidden="true" />
                        {t(`bubbles.${v}`)}
                      </span>
                    ),
                  }))}
                />
              </Field>
              <Field label={t('settings.density')}>
                <Segmented<Prefs['density']>
                  label={t('settings.density')}
                  value={prefs.density}
                  onChange={(density) => setPrefs({ density })}
                  options={(['comfy', 'compact'] as const).map((v) => ({ value: v, label: t(`density.${v}`) }))}
                />
              </Field>
              <SwitchRow
                id="sw-binary"
                label={t('settings.binary')}
                hint={t('settings.binaryHint')}
                checked={prefs.binary}
                onChange={(binary) => setPrefs({ binary })}
              />
              {prefs.binary && (
                <Field label={t('settings.binaryLevel')}>
                  <Segmented<Prefs['binaryLevel']>
                    label={t('settings.binaryLevel')}
                    value={prefs.binaryLevel}
                    onChange={(binaryLevel) => setPrefs({ binaryLevel })}
                    options={(['low', 'medium', 'high'] as const).map((v) => ({ value: v, label: t(`level.${v}`) }))}
                  />
                </Field>
              )}
            </>
          )}

          {tab === 'security' && (
            <>
              <Field label={t('settings.autoLock')} hint={t('settings.autoLockHint')}>
                <Segmented<Prefs['autoLock']>
                  label={t('settings.autoLock')}
                  value={prefs.autoLock}
                  onChange={(autoLock) => setPrefs({ autoLock })}
                  options={([0, 1, 5, 15, 60] as const).map((v) => ({ value: v, label: t(`lock.${v}`) }))}
                />
              </Field>
              <ChangePassphrase onChange={onChangePassphrase} />
              <div className="pass-change">
                <span className="label">{t('rc.title')}</span>
                {recoveryAt ? (
                  <p className="help">{t('rc.set', { date: new Date(recoveryAt).toLocaleDateString(lang) })}</p>
                ) : (
                  <p className="callout callout--warn">{t('rc.missing')}</p>
                )}
                <button type="button" className="btn btn--outline" onClick={onRecovery}>
                  {recoveryAt ? t('rc.new') : t('rc.create')}
                </button>
              </div>
              <div className="btn-row">
                <button type="button" className="btn btn--outline" onClick={onLock}>
                  <LockIcon size={16} />
                  {t('settings.lockNow')}
                </button>
                <button type="button" className="btn btn--danger" onClick={onErase}>
                  <TrashIcon size={16} />
                  {t('settings.erase')}
                </button>
              </div>
              <p className="help help--small">{t('settings.eraseHint')}</p>
            </>
          )}
        </div>

        <div className="form__actions">
          <button type="button" className="btn btn--primary" onClick={onClose}>
            {t('settings.done')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="form__row">
      <span className="label">{label}</span>
      {children}
      {hint && <small className="help help--small">{hint}</small>}
    </div>
  );
}

function ServerField() {
  const { t } = useI18n();
  const { prefs, setPrefs } = usePrefs();
  const [value, setValue] = useState(prefs.server);
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="form__row"
      onSubmit={(e) => {
        e.preventDefault();
        setPrefs({ server: value.trim() === defaultServerUrl() ? '' : value.trim() });
        setSaved(true);
      }}
    >
      <label htmlFor="server-url" className="label">
        {t('settings.server')}
      </label>
      <div className="field">
        <input id="server-url" value={value} placeholder={defaultServerUrl()} spellCheck={false} onChange={(e) => { setValue(e.target.value); setSaved(false); }} />
        <button type="submit" className="btn btn--outline btn--small" disabled={value.trim() === prefs.server}>
          {t('settings.serverSave')}
        </button>
      </div>
      <small className="help help--small">{saved ? t('settings.serverSaved') : t('settings.serverHint', { url: defaultServerUrl() })}</small>
    </form>
  );
}

function ChangePassphrase({ onChange }: { onChange: (current: string, next: string) => Promise<'ok' | 'wrong' | 'offline'> }) {
  const { t } = useI18n();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next.length < 8) return setMsg({ tone: 'error', text: t('settings.passShort') });
    if (next !== again) return setMsg({ tone: 'error', text: t('settings.passMismatch') });
    setBusy(true);
    const result = await onChange(current, next);
    setBusy(false);
    if (result === 'ok') {
      setCurrent('');
      setNext('');
      setAgain('');
      setMsg({ tone: 'ok', text: t('settings.passChanged') });
    } else setMsg({ tone: 'error', text: result === 'wrong' ? t('settings.passWrong') : t('settings.passOffline') });
  };

  return (
    <form className="pass-change" onSubmit={submit}>
      <span className="label">{t('settings.changePass')}</span>
      <label className="sr-only" htmlFor="pc-cur">
        {t('settings.currentPass')}
      </label>
      <div className="field">
        <input id="pc-cur" type="password" autoComplete="current-password" placeholder={t('settings.currentPass')} value={current} onChange={(e) => setCurrent(e.target.value)} />
      </div>
      <label className="sr-only" htmlFor="pc-new">
        {t('settings.newPass')}
      </label>
      <div className="field">
        <input id="pc-new" type="password" autoComplete="new-password" placeholder={t('settings.newPass')} value={next} onChange={(e) => setNext(e.target.value)} />
      </div>
      <label className="sr-only" htmlFor="pc-again">
        {t('settings.confirmPass')}
      </label>
      <div className="field">
        <input id="pc-again" type="password" autoComplete="new-password" placeholder={t('settings.confirmPass')} value={again} onChange={(e) => setAgain(e.target.value)} />
      </div>
      {msg && (
        <p className={msg.tone === 'ok' ? 'callout callout--ok' : 'form-error'} role="status">
          {msg.text}
        </p>
      )}
      <button type="submit" className="btn btn--outline" disabled={busy || !current || !next}>
        {busy ? t('common.working') : t('settings.changePass')}
      </button>
    </form>
  );
}
