import { useMemo, useState, type FormEvent } from 'react';
import { useI18n } from '../i18n';
import { contactCode, parseContactCode } from '../lib/crypto';
import { useToast } from '../lib/toast';
import { codePattern } from '../lib/visual';
import { nameOf } from '../state/chat';
import type { Contact, Profile } from '../types';
import { CheckIcon, CopyIcon, LockIcon, ShieldIcon, WarnIcon } from './Icons';
import { Identicon, ProfileAvatar } from './Identicon';
import { Modal } from './Modal';

const HANDLE_RE = /^[a-z0-9._-]{2,24}$/;

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------- Confirm */

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <Modal title={title} labelId="confirm-title" onClose={onClose} width={400}>
      <div className="form">
        <p className="help help--body">{body}</p>
        <div className="form__actions">
          <button type="button" className="btn btn--outline" onClick={onClose} autoFocus>
            {t('confirm.cancel')}
          </button>
          <button type="button" className={`btn ${danger ? 'btn--danger-solid' : 'btn--primary'}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- Verify */

export function VerifyDialog({
  profile,
  contact,
  onSetVerified,
  onClose,
}: {
  profile: Profile;
  contact: Contact;
  onSetVerified: (verified: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const notify = useToast();
  const [pasted, setPasted] = useState('');
  const [result, setResult] = useState<'match' | 'mismatch' | null>(null);
  const cells = useMemo(() => codePattern(contact.safety.join('')), [contact.safety]);
  const name = nameOf(contact);

  const compare = (e: FormEvent) => {
    e.preventDefault();
    const digits = pasted.replace(/\D/g, '');
    setResult(digits === contact.safety.join('') ? 'match' : 'mismatch');
  };

  return (
    <Modal title={t('verify.title')} labelId="verify-title" onClose={onClose} width={460}>
      <div className="verify">
        <div className="verify__pair" aria-hidden="true">
          <span className="verify__who">
            <ProfileAvatar avatar={profile.avatar} size={52} />
            <small>{profile.handle}</small>
          </span>
          <span className="verify__link">
            <i />
            <span className="verify__lock">
              <LockIcon size={15} />
            </span>
            <i />
          </span>
          <span className="verify__who">
            <Identicon seed={contact.id} color={contact.color} size={52} />
            <small>{contact.handle}</small>
          </span>
        </div>

        <p className="help help--center">{t('verify.body', { name })}</p>

        <div className="code" role="img" aria-label={t('verify.code', { name })}>
          <svg viewBox="0 0 21 21" width="150" height="150" shapeRendering="crispEdges" aria-hidden="true">
            {cells.map((on, i) => (on ? <rect key={i} x={i % 21} y={Math.floor(i / 21)} width={1} height={1} /> : null))}
          </svg>
        </div>

        <div className="safety-grid safety-grid--4">
          {contact.safety.map((g, i) => (
            <span key={i}>{g}</span>
          ))}
        </div>

        <button
          type="button"
          className="btn btn--ghost btn--small"
          onClick={async () => {
            if (await copyText(contact.safety.join(' '))) notify(t('verify.copied'));
          }}
        >
          <CopyIcon size={15} />
          {t('verify.copy')}
        </button>

        <form className="paste-compare" onSubmit={compare}>
          <label htmlFor="paste-number" className="label">
            {t('verify.pasteLabel')}
          </label>
          <div className="field">
            <input
              id="paste-number"
              value={pasted}
              onChange={(e) => {
                setPasted(e.target.value);
                setResult(null);
              }}
              placeholder={t('verify.pastePh')}
              inputMode="numeric"
              autoComplete="off"
            />
            <button type="submit" className="btn btn--outline btn--small" disabled={!pasted.trim()}>
              {t('verify.check')}
            </button>
          </div>
          {result && (
            <p className={`callout ${result === 'match' ? 'callout--ok' : 'callout--warn'}`} role="status">
              {result === 'match' ? <CheckIcon size={15} /> : <WarnIcon size={15} />}
              {result === 'match' ? t('verify.match') : t('verify.mismatch')}
            </p>
          )}
        </form>

        {contact.verified ? (
          <button
            type="button"
            className="btn btn--outline btn--block"
            onClick={() => {
              onSetVerified(false);
              onClose();
            }}
          >
            {t('verify.unmark')}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--primary btn--block"
            disabled={result === 'mismatch'}
            onClick={() => {
              onSetVerified(true);
              onClose();
            }}
          >
            <ShieldIcon size={17} />
            {t('verify.mark')}
          </button>
        )}
        <p className="help help--center help--small">{t('verify.footer')}</p>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------- Member picker (shared) */

function MemberPicker({
  contacts,
  picked,
  onToggle,
}: {
  contacts: Contact[];
  picked: string[];
  onToggle: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="pick-list">
      {contacts.map((c) => (
        <label key={c.id} className={`pick ${picked.includes(c.id) ? 'is-picked' : ''}`}>
          <input type="checkbox" checked={picked.includes(c.id)} onChange={() => onToggle(c.id)} />
          <Identicon seed={c.id} color={c.color} size={32} />
          <span className="pick__name">{nameOf(c)}</span>
          <span className={`pick__tag ${c.verified ? '' : 'is-warn'}`}>{c.verified ? t('info.tagVerified') : t('info.tagUnverified')}</span>
        </label>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- New group */

export function NewGroupDialog({
  contacts,
  onCreate,
  onClose,
}: {
  contacts: Contact[];
  onCreate: (name: string, members: string[]) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>([]);

  const cleanName = name.trim().replace(/^#+/, '').replace(/\s+/g, '-').slice(0, 32);
  const canCreate = cleanName.length > 0 && picked.length > 0;
  const pickedUnverified = contacts.some((c) => picked.includes(c.id) && !c.verified);
  const toggle = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <Modal title={t('group.title')} labelId="group-title" onClose={onClose}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (canCreate) onCreate(cleanName, contacts.filter((c) => picked.includes(c.id)).map((c) => c.id));
        }}
      >
        <p className="help">{t('group.body')}</p>
        <div className="form__row">
          <label htmlFor="group-name" className="label">
            {t('group.name')}
          </label>
          <div className="field">
            <span className="field__prefix" aria-hidden="true">
              #
            </span>
            <input
              id="group-name"
              value={name}
              maxLength={32}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('group.namePlaceholder')}
              autoComplete="off"
              autoFocus
            />
          </div>
        </div>
        <fieldset className="form__row">
          <legend className="label">
            {t('group.members')} · {t('group.selected', { n: picked.length })}
          </legend>
          {contacts.length === 0 ? (
            <p className="help">{t('group.noContacts')}</p>
          ) : (
            <MemberPicker contacts={contacts} picked={picked} onToggle={toggle} />
          )}
        </fieldset>
        {pickedUnverified && (
          <p className="callout callout--warn">
            <WarnIcon size={15} />
            {t('group.warn')}
          </p>
        )}
        <div className="form__actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>
            {t('group.cancel')}
          </button>
          <button type="submit" className="btn btn--primary" disabled={!canCreate}>
            {t('group.create')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------------------------------------------------------- Invite */

export function InviteDialog({
  groupName,
  candidates,
  onInvite,
  onClose,
}: {
  groupName: string;
  candidates: Contact[];
  onInvite: (members: string[]) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <Modal title={t('group.inviteTitle', { name: groupName })} labelId="invite-title" onClose={onClose}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (picked.length) onInvite(picked);
        }}
      >
        <p className="help">{t('group.inviteBody')}</p>
        {candidates.length === 0 ? (
          <p className="help">{t('group.noneLeft')}</p>
        ) : (
          <MemberPicker contacts={candidates} picked={picked} onToggle={toggle} />
        )}
        <div className="form__actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>
            {t('group.cancel')}
          </button>
          <button type="submit" className="btn btn--primary" disabled={picked.length === 0}>
            {t('group.inviteSubmit')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ----------------------------------------------------------- Add contact */

export function AddContactDialog({
  profile,
  existing,
  online,
  lookup,
  onAdd,
  onClose,
}: {
  profile: Profile;
  existing: Contact[];
  online: boolean;
  lookup: (handle: string) => Promise<Contact>;
  onAdd: (contact: Contact) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const notify = useToast();
  const [handle, setHandle] = useState('');
  const [code, setCode] = useState('');
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const myCode = contactCode(profile.handle, profile.publicKey);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    let h = handle.trim().replace(/^@/, '').toLowerCase();
    let publicKey: string | undefined;
    if (code.trim()) {
      const parsed = parseContactCode(code);
      if (!parsed) return setError(t('contact.invalidCode'));
      h = h || parsed.handle;
      publicKey = parsed.publicKey;
    }
    if (!HANDLE_RE.test(h)) return setError(t('contact.invalidHandle'));
    if (h === profile.handle) return setError(t('contact.self'));
    if (existing.some((c) => c.handle === h)) return setError(t('contact.exists'));
    if (!online) return setError(t('contact.offline'));
    setBusy(true);
    try {
      // Ask the server for their public identity key (nothing secret is involved).
      const found = await lookup(h);
      if (publicKey && publicKey !== found.publicKey) {
        setBusy(false);
        return setError(t('contact.codeMismatch'));
      }
      onAdd({ ...found, nickname: nickname.trim() });
    } catch (err) {
      setBusy(false);
      setError((err as { code?: string }).code === 'not_found' ? t('contact.notFound') : t('contact.offline'));
    }
  };

  return (
    <Modal title={t('contact.title')} labelId="contact-title" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <p className="help">{t('contact.body')}</p>
        <div className="form__row">
          <label htmlFor="ct-handle" className="label">
            {t('contact.handle')}
          </label>
          <div className="field">
            <span className="field__prefix" aria-hidden="true">
              @
            </span>
            <input
              id="ct-handle"
              value={handle}
              maxLength={25}
              onChange={(e) => setHandle(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
          </div>
        </div>
        <div className="form__row">
          <label htmlFor="ct-code" className="label">
            {t('contact.code')}
          </label>
          <textarea
            id="ct-code"
            className="textarea mono"
            rows={2}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t('contact.codePh')}
            spellCheck={false}
          />
        </div>
        <div className="form__row">
          <label htmlFor="ct-nick" className="label">
            {t('contact.nickname')}
          </label>
          <div className="field">
            <input id="ct-nick" value={nickname} maxLength={32} onChange={(e) => setNickname(e.target.value)} autoComplete="off" />
          </div>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <div className="my-code">
          <div className="my-code__head">
            <span className="label">{t('contact.myCode')}</span>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={async () => {
                if (await copyText(myCode)) notify(t('contact.copied'));
              }}
            >
              <CopyIcon size={14} />
              {t('contact.copy')}
            </button>
          </div>
          <code>{myCode}</code>
          <small>{t('contact.myCodeHint')}</small>
        </div>

        <div className="form__actions">
          <button type="button" className="btn btn--outline" onClick={onClose}>
            {t('group.cancel')}
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy || (!handle.trim() && !code.trim())}>
            {busy ? t('contact.looking') : t('contact.submit')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export { copyText };
