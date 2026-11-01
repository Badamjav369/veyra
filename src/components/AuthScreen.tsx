import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { fingerprint, generateIdentity, generateOneTimePreKeys, generateSignedPreKey, uploadBundle } from '../../shared/e2ee';
import { HANDLE_RE } from '../../shared/protocol';
import type { SignOutReason } from '../App';
import { useI18n } from '../i18n';
import { makeRecovery, recoverAccount, signIn, SignInFailure, type SignInStep } from '../lib/account';
import { isWebCryptoAvailable } from '../lib/crypto';
import { deriveAccountKeys, forgetAccount, hasLocal, knownAccounts, newDataKey, rememberAccount, saveVault, type VaultSession } from '../lib/vault';
import { defaultServerUrl, registerAccount, ServerError } from '../net/connection';
import { readableAccent, usePrefs } from '../prefs';
import { createState } from '../state/init';
import type { ChatState, Profile } from '../types';
import { BinaryRain } from './BinaryRain';
import { EyeIcon, EyeOffIcon, KeyIcon, ShieldIcon, WarnIcon } from './Icons';
import { LogoMark, LogoShapes } from './Logo';
import { Modal } from './Modal';
import { RecoveryCodeView } from './RecoveryCode';
import { TermsDialog } from './Terms';

interface Props {
  onReady: (session: VaultSession, state: ChatState) => void;
  /** Set right after signing out, so the form can say why and keep the handle filled in. */
  signedOut: { handle: string; reason: SignOutReason } | null;
}

type Tab = 'signin' | 'create' | 'recover';

function PassField({
  id,
  value,
  onChange,
  autoComplete,
  describedBy,
  autoFocus,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  describedBy?: string;
  autoFocus?: boolean;
  invalid?: boolean;
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
        aria-invalid={invalid || undefined}
        autoFocus={autoFocus}
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
      />
      <button type="button" className="icon-btn" aria-label={shown ? t('auth.hide') : t('auth.show')} aria-pressed={shown} onClick={() => setShown(!shown)}>
        {shown ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}

function HandleField({ id, value, onChange, autoFocus, describedBy, invalid, list }: { id: string; value: string; onChange: (v: string) => void; autoFocus?: boolean; describedBy?: string; invalid?: boolean; list?: string }) {
  return (
    <div className="field field--large">
      <span className="field__prefix" aria-hidden="true">
        @
      </span>
      <input
        id={id}
        value={value}
        maxLength={24}
        onChange={(e) => onChange(e.target.value.toLowerCase().replace(/[\s@]/g, ''))}
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        autoFocus={autoFocus}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        list={list}
      />
    </div>
  );
}

function ServerSetting({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  return (
    <details className="advanced">
      <summary>{t('auth.server')}</summary>
      <div className="field">
        <input aria-label={t('auth.server')} value={value} onChange={(e) => onChange(e.target.value.trim())} spellCheck={false} />
      </div>
      <p className="help help--small">{t('auth.serverHint')}</p>
    </details>
  );
}

function Notice({ tone, children }: { tone: 'ok' | 'warn'; children: ReactNode }) {
  return (
    <p className={`callout callout--${tone} auth__notice`} role="status">
      {tone === 'ok' ? <ShieldIcon size={16} /> : <WarnIcon size={16} />}
      <span>{children}</span>
    </p>
  );
}

export function AuthScreen({ onReady, signedOut }: Props) {
  const { t } = useI18n();
  const { prefs, setPrefs } = usePrefs();
  const accounts = useRef(knownAccounts()).current;
  const [tab, setTab] = useState<Tab>(() => (signedOut || accounts.length ? 'signin' : 'create'));
  const [server, setServer] = useState(() => prefs.server || defaultServerUrl());
  const [busy, setBusy] = useState<SignInStep | 'create' | null>(null);
  const [error, setError] = useState('');
  const [forgot, setForgot] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [showTerms, setShowTerms] = useState(false);

  // sign in
  const [handle, setHandle] = useState(() => signedOut?.handle ?? accounts[0] ?? '');
  const [password, setPassword] = useState('');
  const passRef = useRef<HTMLDivElement>(null);

  // create
  const [displayName, setDisplayName] = useState('');
  const [newHandle, setNewHandle] = useState('');
  const [pass1, setPass1] = useState('');
  const [pass2, setPass2] = useState('');
  const [created, setCreated] = useState<{ session: VaultSession; state: ChatState; code: string } | null>(null);

  // recover
  const [rcCode, setRcCode] = useState('');
  const [rcPass1, setRcPass1] = useState('');
  const [rcPass2, setRcPass2] = useState('');

  useEffect(() => setError(''), [tab]);

  // With the handle already known, put the cursor straight into the password.
  useEffect(() => {
    if (tab === 'signin' && handle) passRef.current?.querySelector('input')?.focus();
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveServer = () => setPrefs({ server: server === defaultServerUrl() ? '' : server });

  const doSignIn = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!HANDLE_RE.test(handle)) return setError(t('auth.err.handle'));
    if (!password) return setError(t('auth.err.noPassword'));
    if (!isWebCryptoAvailable()) return setError(t('auth.err.unsupported'));
    setError('');
    setBusy('keys');
    try {
      const r = await signIn(server, handle, password, setBusy);
      saveServer();
      onReady(r.session, r.state);
    } catch (err) {
      const reason = err instanceof SignInFailure ? err.reason : 'failed';
      setError(t(`auth.err.${reason}` as 'auth.err.failed'));
      setBusy(null);
    }
  };

  const handleOk = HANDLE_RE.test(newHandle);
  const strength = pass1.length === 0 ? 'empty' : pass1.length < 8 ? 'short' : pass1.length < 16 ? 'ok' : 'great';
  const canCreate = displayName.trim() && handleOk && pass1.length >= 8 && pass1 === pass2 && agreed;

  const doCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!canCreate || busy) return;
    if (!isWebCryptoAvailable()) return setError(t('auth.err.unsupported'));
    setBusy('create');
    setError('');
    try {
      // 1. Keys are made here. Only the public halves are ever sent anywhere.
      const identity = generateIdentity();
      const spk = generateSignedPreKey(1, identity);
      const opks = generateOneTimePreKeys(1, 100);
      const keys = await deriveAccountKeys(newHandle, pass1);
      // 2. Claim the handle on the relay by signing its challenge with the new identity key.
      await registerAccount(server, newHandle, identity.sign.priv, uploadBundle(identity, spk, opks));
      saveServer();
      const profile: Profile = {
        displayName: displayName.trim(),
        handle: newHandle,
        bio: '',
        presence: 'online',
        avatar: { kind: 'identicon', seed: newHandle, color: readableAccent(prefs.accent) },
        publicKey: identity.sign.pub,
        fingerprint: fingerprint(identity.sign.pub),
        createdAt: Date.now(),
        version: 1,
      };
      // 3. Lock everything with the password. The encrypted backup is uploaded once the app connects.
      const dek = newDataKey();
      const { code, recovery } = await makeRecovery(newHandle, dek);
      const state = { ...createState(profile, { identity, spk, opks, nextOpkId: 101 }), account: { dek, recovery } };
      const session: VaultSession = { ...keys, syncedRev: 0 };
      await saveVault(session, state);
      rememberAccount(newHandle);
      setCreated({ session, state, code }); // show the recovery code before going in
    } catch (err) {
      const code = err instanceof ServerError ? err.code : '';
      setError(
        code === 'handle_taken'
          ? t('auth.err.taken')
          : code === 'offline' || code === 'timeout'
            ? t('auth.err.unreachable')
            : code === 'invalid_handle'
              ? t('auth.handleHint')
              : t('auth.err.failed'),
      );
      setBusy(null);
    }
  };

  const rcOk = rcCode.replace(/[^0-9a-z]/gi, '').length >= 24 && rcPass1.length >= 8 && rcPass1 === rcPass2;
  const doRecover = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!HANDLE_RE.test(handle)) return setError(t('auth.err.handle'));
    if (!rcOk) return;
    setError('');
    setBusy('keys');
    try {
      const r = await recoverAccount(server, handle, rcCode, rcPass1, setBusy);
      saveServer();
      onReady(r.session, r.state);
    } catch (err) {
      const reason = err instanceof SignInFailure ? err.reason : 'failed';
      setError(t(`auth.err.${reason}` as 'auth.err.failed'));
      setBusy(null);
    }
  };

  const banner =
    signedOut?.reason === 'replaced' ? (
      <Notice tone="warn">{t('auth.out.replaced')}</Notice>
    ) : signedOut?.reason === 'conflict' ? (
      <Notice tone="warn">{t('auth.out.conflict')}</Notice>
    ) : signedOut?.reason === 'lock' ? (
      <Notice tone="ok">{t('auth.out.lock')}</Notice>
    ) : signedOut?.reason === 'erase' ? (
      <Notice tone="ok">{t('auth.out.erase')}</Notice>
    ) : null;

  const stepText = busy === 'create' ? t('auth.step.create') : busy ? t(`auth.step.${busy}` as 'auth.step.keys') : '';

  return (
    <div className="unlock">
      {prefs.binary && <BinaryRain color={readableAccent(prefs.accent)} density={22} />}
      <header className="unlock__top">
        <span className="logo">
          <LogoMark size={28} />
          <span className="logo__word">VEYRA</span>
        </span>
        <div className="unlock__top-right">
        </div>
      </header>

      <main className="unlock__card auth">
        <svg className="unlock__emblem" width="96" height="96" viewBox="0 0 176 176" fill="none" aria-hidden="true">
          <circle cx="88" cy="88" r="86" stroke="#1A2124" />
          <circle className="spin" cx="88" cy="88" r="72" stroke="#2A3539" strokeDasharray="1 7" strokeLinecap="round" />
          <g transform="translate(40 40)">
            <rect width="96" height="96" rx="28" fill="#161C1F" stroke="#2A3539" />
            <svg x="8" y="8" width="80" height="80" viewBox="0 0 64 64">
              <LogoShapes id="veyra-emblem" />
            </svg>
          </g>
        </svg>

        {created ? (
          <section className="auth__panel">
            <h1>{t('rc.title')}</h1>
            <p className="unlock__body">{t('rc.intro')}</p>
            <RecoveryCodeView handle={created.state.profile.handle} code={created.code} doneLabel={t('rc.continue')} onDone={() => onReady(created.session, created.state)} />
          </section>
        ) : tab === 'recover' ? (
          <section className="auth__panel">
            <h1>{t('auth.recoverTitle')}</h1>
            <p className="unlock__body">{t('auth.recoverBody')}</p>
            <form className="unlock__form" onSubmit={doRecover} noValidate>
              <label htmlFor="rc-handle" className="label">
                {t('auth.handle')}
              </label>
              <HandleField id="rc-handle" value={handle} onChange={setHandle} autoFocus={!handle} />
              <label htmlFor="rc-code" className="label">
                {t('auth.code')}
              </label>
              <div className="field field--large">
                <input id="rc-code" value={rcCode} onChange={(e) => setRcCode(e.target.value.toUpperCase())} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" autoComplete="off" spellCheck={false} autoFocus={!!handle} />
              </div>
              <label htmlFor="rc-pass" className="label">
                {t('auth.newPassword')}
              </label>
              <PassField id="rc-pass" value={rcPass1} onChange={setRcPass1} autoComplete="new-password" />
              <label htmlFor="rc-pass2" className="label">
                {t('auth.confirm')}
              </label>
              <PassField id="rc-pass2" value={rcPass2} onChange={setRcPass2} autoComplete="new-password" invalid={!!rcPass2 && rcPass1 !== rcPass2} />
              {rcPass1 && rcPass1.length < 8 && <p className="help is-error">{t('auth.hint.short')}</p>}
              {rcPass2 && rcPass1 !== rcPass2 && <p className="help is-error">{t('auth.mismatch')}</p>}
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <button type="submit" className="btn btn--primary btn--block btn--large" disabled={!rcOk || !!busy}>
                <KeyIcon size={18} />
                {busy ? stepText : t('auth.recoverSubmit')}
              </button>
              <ServerSetting value={server} onChange={setServer} />
            </form>
            <p className="auth__switch">
              <button type="button" className="link-btn" onClick={() => setTab('signin')} disabled={!!busy}>
                {t('auth.backToSignin')}
              </button>
            </p>
          </section>
        ) : (
          <>
        <div className="auth__tabs" role="tablist" aria-label={t('auth.tabs')}>
          <button type="button" role="tab" id="tab-signin" aria-controls="panel-signin" aria-selected={tab === 'signin'} onClick={() => setTab('signin')} disabled={!!busy}>
            {t('auth.signin')}
          </button>
          <button type="button" role="tab" id="tab-create" aria-controls="panel-create" aria-selected={tab === 'create'} onClick={() => setTab('create')} disabled={!!busy}>
            {t('auth.create')}
          </button>
        </div>

        {tab === 'signin' ? (
          <section id="panel-signin" role="tabpanel" aria-labelledby="tab-signin" className="auth__panel">
            <h1>{t('auth.signinTitle')}</h1>
            <p className="unlock__body">{t('auth.signinBody')}</p>
            {banner}
            <form className="unlock__form" onSubmit={doSignIn} noValidate>
              <label htmlFor="si-handle" className="label">
                {t('auth.handle')}
              </label>
              <HandleField id="si-handle" value={handle} onChange={setHandle} autoFocus={!handle} list={accounts.length ? 'si-known' : undefined} />
              {accounts.length > 0 && (
                <datalist id="si-known">
                  {accounts.map((h) => (
                    <option key={h} value={h} />
                  ))}
                </datalist>
              )}
              {accounts.length > 1 && (
                <div className="auth__accounts" aria-label={t('auth.onDevice')}>
                  {accounts.map((h) => (
                    <button key={h} type="button" className={`chip ${h === handle ? 'is-active' : ''}`} onClick={() => setHandle(h)}>
                      @{h}
                    </button>
                  ))}
                </div>
              )}

              <div className="auth__label-row">
                <label htmlFor="si-pass" className="label">
                  {t('auth.password')}
                </label>
                <button type="button" className="link-btn" onClick={() => setForgot(true)}>
                  {t('auth.forgot')}
                </button>
              </div>
              <div ref={passRef}>
                <PassField id="si-pass" value={password} onChange={setPassword} autoComplete="current-password" invalid={!!error} />
              </div>

              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}

              <button type="submit" className="btn btn--primary btn--block btn--large" disabled={!!busy}>
                <KeyIcon size={18} />
                {busy ? stepText : t('auth.signinSubmit')}
              </button>
              <ServerSetting value={server} onChange={setServer} />
            </form>
            <p className="auth__switch">
              {t('auth.noAccount')}{' '}
              <button type="button" className="link-btn" onClick={() => setTab('create')} disabled={!!busy}>
                {t('auth.create')}
              </button>
            </p>
          </section>
        ) : (
          <section id="panel-create" role="tabpanel" aria-labelledby="tab-create" className="auth__panel">
            <h1>{t('auth.createTitle')}</h1>
            <p className="unlock__body">{t('auth.createBody')}</p>
            <form className="unlock__form" onSubmit={doCreate} noValidate>
              <label htmlFor="c-name" className="label">
                {t('auth.displayName')}
              </label>
              <div className="field field--large">
                <input id="c-name" value={displayName} maxLength={32} onChange={(e) => setDisplayName(e.target.value)} placeholder={t('auth.displayNamePh')} autoComplete="nickname" autoFocus />
              </div>

              <label htmlFor="c-handle" className="label">
                {t('auth.handle')}
              </label>
              <HandleField id="c-handle" value={newHandle} onChange={setNewHandle} describedBy="c-handle-hint" invalid={newHandle.length > 0 && !handleOk} />
              <p id="c-handle-hint" className={`help ${newHandle && !handleOk ? 'is-error' : ''}`}>
                {t('auth.handleHint')}
              </p>

              <label htmlFor="c-pass" className="label">
                {t('auth.password')}
              </label>
              <PassField id="c-pass" value={pass1} onChange={setPass1} autoComplete="new-password" describedBy="c-pass-hint" />
              <div className={`meter meter--${strength}`} aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
              <p id="c-pass-hint" className="help">
                {t(`auth.hint.${strength}` as 'auth.hint.ok')}
              </p>

              <label htmlFor="c-pass2" className="label">
                {t('auth.confirm')}
              </label>
              <PassField id="c-pass2" value={pass2} onChange={setPass2} autoComplete="new-password" invalid={!!pass2 && pass1 !== pass2} />
              {pass2 && pass1 !== pass2 && <p className="help is-error">{t('auth.mismatch')}</p>}

              <label className="rc__confirm auth__terms">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                <span>
                  I agree to the{' '}
                  <button type="button" className="link-btn" onClick={() => setShowTerms(true)}>
                    Terms of Service
                  </button>
                </span>
              </label>

              <p className="callout callout--warn auth__warning">
                <WarnIcon size={16} />
                <span>{t('auth.noReset')}</span>
              </p>

              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}

              <button type="submit" className="btn btn--primary btn--block btn--large" disabled={!canCreate || !!busy}>
                <KeyIcon size={18} />
                {busy ? stepText : t('auth.createSubmit')}
              </button>
              <ServerSetting value={server} onChange={setServer} />
            </form>
            <p className="auth__switch">
              {t('auth.haveAccount')}{' '}
              <button type="button" className="link-btn" onClick={() => setTab('signin')} disabled={!!busy}>
                {t('auth.signin')}
              </button>
            </p>
          </section>
        )}
          </>
        )}

        <p className="unlock__footer">
          {t('auth.footer')}{' '}
          <button type="button" className="link-btn" onClick={() => setShowTerms(true)}>
            Terms of Service
          </button>
        </p>
      </main>

      {showTerms && <TermsDialog onClose={() => setShowTerms(false)} />}
      {forgot && (
        <ForgotDialog
          handle={HANDLE_RE.test(handle) ? handle : ''}
          onClose={() => setForgot(false)}
          onRecover={() => (setForgot(false), setTab('recover'))}
          onCreate={() => (setForgot(false), setTab('create'))}
        />
      )}
    </div>
  );
}

function ForgotDialog({ handle, onClose, onRecover, onCreate }: { handle: string; onClose: () => void; onRecover: () => void; onCreate: () => void }) {
  const { t } = useI18n();
  const [removed, setRemoved] = useState(false);
  const local = handle && hasLocal(handle);
  return (
    <Modal title={t('auth.forgotTitle')} labelId="forgot-title" onClose={onClose} width={440}>
      <div className="form">
        <p className="help help--body">{t('auth.forgotBody')}</p>
        <button type="button" className="btn btn--primary btn--block" onClick={onRecover} autoFocus>
          <KeyIcon size={16} />
          {t('auth.recover')}
        </button>
        <ul className="auth__tips">
          <li>{t('auth.forgotTip1')}</li>
          <li>{t('auth.forgotTip2')}</li>
        </ul>
        {local && !removed && (
          <div className="auth__remove">
            <p className="help">{t('auth.removeBody', { handle })}</p>
            <button
              type="button"
              className="btn btn--outline btn--danger"
              onClick={() => {
                forgetAccount(handle);
                setRemoved(true);
              }}
            >
              {t('auth.remove', { handle })}
            </button>
          </div>
        )}
        {removed && <p className="callout callout--ok">{t('auth.removed', { handle })}</p>}
        <div className="form__actions">
          <button type="button" className="btn btn--outline" onClick={onCreate}>
            {t('auth.create')}
          </button>
          <button type="button" className="btn btn--outline" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
