import { useState, type FormEvent } from 'react';
import { fingerprint, generateIdentity, generateOneTimePreKeys, generateSignedPreKey, uploadBundle } from '../../shared/e2ee';
import { useI18n } from '../i18n';
import { isWebCryptoAvailable } from '../lib/crypto';
import { createVault, eraseVault, hasVault, openVault, WrongPassphraseError, type VaultSession } from '../lib/vault';
import { defaultServerUrl, registerAccount, ServerError } from '../net/connection';
import { createState, normalizeLoaded, OldVaultError } from '../state/init';
import { readableAccent, usePrefs } from '../prefs';
import type { ChatState, Profile } from '../types';
import { BinaryRain } from './BinaryRain';
import { EyeIcon, EyeOffIcon, KeyIcon } from './Icons';
import { LanguageSwitch } from './LanguageSwitch';
import { LogoMark } from './Logo';
import { ConfirmDialog } from './dialogs';

export const HANDLE_RE = /^[a-z0-9._-]{2,24}$/;

interface Props {
  onReady: (session: VaultSession, state: ChatState) => void;
}

function PassField({
  id,
  value,
  onChange,
  autoComplete,
  describedBy,
  autoFocus,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  describedBy?: string;
  autoFocus?: boolean;
}) {
  const { t } = useI18n();
  const [shown, setShown] = useState(false);
  return (
    <div className="field field--large">
      <input
        id={id}
        type={shown ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        aria-describedby={describedBy}
        autoFocus={autoFocus}
      />
      <button
        type="button"
        className="icon-btn"
        aria-label={shown ? t('unlock.hide') : t('unlock.show')}
        aria-pressed={shown}
        onClick={() => setShown(!shown)}
      >
        {shown ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}

export function UnlockScreen({ onReady }: Props) {
  const { t } = useI18n();
  const { prefs, setPrefs } = usePrefs();
  const [mode, setMode] = useState<'unlock' | 'create'>(() => (hasVault() ? 'unlock' : 'create'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmErase, setConfirmErase] = useState(false);

  // unlock
  const [passphrase, setPassphrase] = useState('');
  // create
  const [displayName, setDisplayName] = useState('');
  const [handle, setHandle] = useState('');
  const [pass1, setPass1] = useState('');
  const [pass2, setPass2] = useState('');
  const [server, setServer] = useState(() => prefs.server || defaultServerUrl());
  const [oldVault, setOldVault] = useState(false);

  const unlock = async (e: FormEvent) => {
    e.preventDefault();
    if (!passphrase || busy) return;
    setBusy(true);
    setError('');
    try {
      const { session, data } = await openVault<ChatState>(passphrase);
      onReady(session, normalizeLoaded(data));
    } catch (err) {
      if (err instanceof OldVaultError) setOldVault(true);
      setError(err instanceof WrongPassphraseError ? t('unlock.wrong') : err instanceof OldVaultError ? t('unlock.oldVault') : t('create.error'));
      setBusy(false);
    }
  };

  const handleOk = HANDLE_RE.test(handle);
  const strength = pass1.length === 0 ? 'empty' : pass1.length < 8 ? 'short' : pass1.length < 16 ? 'ok' : 'great';
  const canCreate = displayName.trim() && handleOk && pass1.length >= 8 && pass1 === pass2;

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!canCreate || busy) return;
    if (!isWebCryptoAvailable()) {
      setError(t('create.unsupported'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      // 1. Make all keys on this device. Only the public halves will ever be sent anywhere.
      const identity = generateIdentity();
      const spk = generateSignedPreKey(1, identity);
      const opks = generateOneTimePreKeys(1, 100);
      // 2. Claim the handle on the relay by signing its challenge with the new identity key.
      await registerAccount(server, handle, identity.sign.priv, uploadBundle(identity, spk, opks));
      setPrefs({ server: server === defaultServerUrl() ? '' : server });
      const profile: Profile = {
        displayName: displayName.trim(),
        handle,
        bio: '',
        presence: 'online',
        avatar: { kind: 'identicon', seed: handle, color: readableAccent(prefs.accent) },
        publicKey: identity.sign.pub,
        fingerprint: fingerprint(identity.sign.pub),
        createdAt: Date.now(),
        version: 1,
      };
      // 3. Lock everything (including the private keys) in the vault with the passphrase.
      const state = createState(profile, { identity, spk, opks, nextOpkId: 101 });
      const session = await createVault(pass1, state);
      onReady(session, state);
    } catch (err) {
      const code = err instanceof ServerError ? err.code : '';
      setError(
        code === 'handle_taken' ? t('create.taken') : code === 'offline' || code === 'timeout' ? t('create.unreachable') : code === 'invalid_handle' ? t('create.handleHint') : t('create.error'),
      );
      setBusy(false);
    }
  };

  return (
    <div className="unlock">
      {prefs.binary && <BinaryRain color={readableAccent(prefs.accent)} density={22} />}
      <header className="unlock__top">
        <span className="logo">
          <LogoMark size={28} />
          <span className="logo__word">SHIVNEE</span>
        </span>
        <div className="unlock__top-right">
          <span className="status-pill">
            <span className="dot dot--warn" aria-hidden="true" />
            {t('unlock.offline')}
          </span>
          <LanguageSwitch />
        </div>
      </header>

      <main className="unlock__card">
        <svg className="unlock__emblem" width="132" height="132" viewBox="0 0 176 176" fill="none" aria-hidden="true">
          <circle cx="88" cy="88" r="86" stroke="#1A2124" />
          <circle className="spin" cx="88" cy="88" r="72" stroke="#2A3539" strokeDasharray="1 7" strokeLinecap="round" />
          <g transform="translate(40 40)">
            <rect width="96" height="96" rx="28" fill="#161C1F" stroke="#2A3539" />
            <g transform="translate(24 22)">
              <LogoMarkPaths />
            </g>
          </g>
        </svg>

        {mode === 'unlock' ? (
          <>
            <h1>{t('unlock.title')}</h1>
            <p className="unlock__body">{t('unlock.body')}</p>
            <form className="unlock__form" onSubmit={unlock}>
              <label htmlFor="passphrase" className="label">
                {t('unlock.passphrase')}
              </label>
              <PassField id="passphrase" value={passphrase} onChange={setPassphrase} autoComplete="current-password" autoFocus />
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <button type="submit" className="btn btn--primary btn--block btn--large" disabled={!passphrase || busy}>
                <KeyIcon size={18} />
                {busy ? t('unlock.working') : t('unlock.submit')}
              </button>
              <button type="button" className={`btn btn--block ${oldVault ? 'btn--danger' : 'btn--ghost'}`} onClick={() => setConfirmErase(true)}>
                {oldVault ? t('unlock.eraseConfirm') : t('unlock.forgot')}
              </button>
            </form>
          </>
        ) : (
          <>
            <h1>{t('create.title')}</h1>
            <p className="unlock__body">{t('create.body')}</p>
            <form className="unlock__form" onSubmit={create}>
              <label htmlFor="c-name" className="label">
                {t('create.displayName')}
              </label>
              <div className="field">
                <input
                  id="c-name"
                  value={displayName}
                  maxLength={32}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={t('create.displayNamePh')}
                  autoComplete="nickname"
                  autoFocus
                />
              </div>

              <label htmlFor="c-handle" className="label">
                {t('create.handle')}
              </label>
              <div className="field">
                <span className="field__prefix" aria-hidden="true">
                  @
                </span>
                <input
                  id="c-handle"
                  value={handle}
                  maxLength={24}
                  onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/\s/g, ''))}
                  aria-describedby="c-handle-hint"
                  aria-invalid={handle.length > 0 && !handleOk}
                  autoComplete="username"
                  spellCheck={false}
                />
              </div>
              <p id="c-handle-hint" className={`help ${handle && !handleOk ? 'is-error' : ''}`}>
                {t('create.handleHint')}
              </p>

              <label htmlFor="c-pass" className="label">
                {t('create.passphrase')}
              </label>
              <PassField id="c-pass" value={pass1} onChange={setPass1} autoComplete="new-password" describedBy="c-pass-hint" />
              <div className={`meter meter--${strength}`} aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
              <p id="c-pass-hint" className="help">
                {t(`create.hint.${strength}` as 'create.hint.ok')}
              </p>

              <label htmlFor="c-pass2" className="label">
                {t('create.confirm')}
              </label>
              <PassField id="c-pass2" value={pass2} onChange={setPass2} autoComplete="new-password" />
              {pass2 && pass1 !== pass2 && <p className="help is-error">{t('create.mismatch')}</p>}

              <details className="advanced">
                <summary>{t('create.server')}</summary>
                <div className="field">
                  <input id="c-server" aria-label={t('create.server')} value={server} onChange={(e) => setServer(e.target.value.trim())} spellCheck={false} />
                </div>
                <p className="help help--small">{t('create.serverHint')}</p>
              </details>

              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}

              <button type="submit" className="btn btn--primary btn--block btn--large" disabled={!canCreate || busy}>
                <KeyIcon size={18} />
                {busy ? t('create.working') : t('create.submit')}
              </button>
            </form>
          </>
        )}

        <p className="unlock__footer">{t('unlock.footer')}</p>
      </main>

      {confirmErase && (
        <ConfirmDialog
          title={t('unlock.eraseTitle')}
          body={t('unlock.eraseBody')}
          confirmLabel={t('unlock.eraseConfirm')}
          danger
          onClose={() => setConfirmErase(false)}
          onConfirm={() => {
            eraseVault();
            setConfirmErase(false);
            setPassphrase('');
            setError('');
            setOldVault(false);
            setMode('create');
          }}
        />
      )}
    </div>
  );
}

/** The logo paths, reused inside the bigger emblem. */
function LogoMarkPaths() {
  return (
    <g transform="scale(1.0)">
      <path
        d="M17 6h14c6.6 0 11 4.4 11 11v7c0 6.6-4.4 11-11 11H20.5l-7.7 6.4c-1 .8-2.3.1-2.3-1.1V34.3C7.8 32.5 6 29 6 24v-7C6 10.4 10.4 6 17 6z"
        fill="var(--accent-deep)"
        stroke="var(--accent)"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <circle cx="24" cy="18.2" r="4.3" fill="var(--accent)" />
      <path d="M22.1 21.2h3.8l1.3 7.6c.1.6-.3 1.2-1 1.2h-4.4c-.7 0-1.1-.6-1-1.2z" fill="var(--accent)" />
    </g>
  );
}
