import { useEffect, useState, type Dispatch, type FormEvent } from 'react';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n/en';
import { fingerprint } from '../../shared/e2ee';
import { useToast } from '../lib/toast';
import { activeId, contactOf, convoMeta, nameOf, type ChatAction } from '../state/chat';
import type { ChatState, Timer } from '../types';
import { PALETTE, TIMERS } from '../types';
import { ColorPicker, Segmented, SwitchRow } from './controls';
import { BroomIcon, CloseIcon, EditIcon, KeyIcon, LogoutIcon, MinusCircleIcon, PlusIcon, ShieldIcon, TrashIcon, WarnIcon } from './Icons';
import { Identicon, ProfileAvatar } from './Identicon';

interface Props {
  state: ChatState;
  dispatch: Dispatch<ChatAction>;
  onClose: () => void;
  onVerify: () => void;
  onInvite: () => void;
  onConfirm: (action: 'leave' | 'delete' | 'clear') => void;
  onRotate: () => void;
  onRemoveMember: (handle: string) => void;
  onSaveGroup: (name: string, description: string, color: string) => void;
}

export function DetailsPanel({ state, dispatch, onClose, onVerify, onInvite, onConfirm, onRotate, onRemoveMember, onSaveGroup }: Props) {
  const { t } = useI18n();
  const notify = useToast();
  const id = activeId(state);
  const meta = convoMeta(state, id);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('');

  useEffect(() => setEditing(false), [id]);

  if (!meta) return null;
  const isGroup = meta.kind === 'group';
  const timer = state.timers[id] ?? 'off';
  const contact = isGroup ? undefined : state.contacts[contactOf(id)];

  const startEdit = () => {
    setName(isGroup ? meta.name : contact?.nickname ?? '');
    setDescription(meta.description && isGroup ? meta.description : '');
    setColor(meta.color);
    setEditing(true);
  };

  const saveEdit = (e: FormEvent) => {
    e.preventDefault();
    if (isGroup) {
      const clean = name.trim().replace(/^#+/, '').replace(/\s+/g, '-').slice(0, 32);
      if (!clean) return;
      onSaveGroup(clean, description.trim(), color);
    } else if (contact) {
      dispatch({ type: 'updateContact', id: contact.id, nickname: name, color });
    }
    setEditing(false);
    notify(t('info.saved'));
  };

  return (
    <aside className="details" aria-labelledby="details-title">
      <header className="details__header">
        <h2 id="details-title">{t('info.title')}</h2>
        <button type="button" className="icon-btn" aria-label={t('info.close')} onClick={onClose}>
          <CloseIcon />
        </button>
      </header>

      <div className="details__body">
        {editing ? (
          <form className="form edit-card" onSubmit={saveEdit}>
            <div className="form__row">
              <label htmlFor="ed-name" className="label">
                {isGroup ? t('info.groupName') : t('info.nickname')}
              </label>
              <div className="field">
                <span className="field__prefix" aria-hidden="true">
                  {isGroup ? '#' : ''}
                </span>
                <input
                  id="ed-name"
                  value={name}
                  maxLength={32}
                  placeholder={isGroup ? '' : t('info.nicknamePh')}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
            {isGroup && (
              <div className="form__row">
                <label htmlFor="ed-desc" className="label">
                  {t('info.description')}
                </label>
                <textarea
                  id="ed-desc"
                  className="textarea"
                  rows={2}
                  maxLength={120}
                  value={description}
                  placeholder={t('info.descriptionPh')}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
            )}
            <div className="form__row">
              <span className="label">{t('info.color')}</span>
              <ColorPicker label={t('info.color')} value={color} colors={PALETTE} onChange={setColor} />
            </div>
            <div className="form__actions">
              <button type="button" className="btn btn--outline btn--small" onClick={() => setEditing(false)}>
                {t('info.cancel')}
              </button>
              <button type="submit" className="btn btn--primary btn--small">
                {t('info.save')}
              </button>
            </div>
          </form>
        ) : (
          <div className="profile">
            <Identicon seed={meta.seed} color={meta.color} size={64} shape={isGroup ? 'square' : 'circle'} />
            <div className="profile__text">
              <div className="profile__name">
                <span className="sigil" style={isGroup ? { color: meta.color } : undefined}>
                  {isGroup ? '#' : '@'}
                </span>
                {meta.name}
              </div>
              {meta.description && <p className="profile__desc">{meta.description}</p>}
              {meta.verified ? (
                <span className="pill pill--ok">
                  <ShieldIcon size={13} />
                  {t('chat.verified')}
                </span>
              ) : (
                <span className="pill pill--warn">
                  <WarnIcon size={13} />
                  {isGroup ? t('chat.groupSubUnverified', { n: meta.members.length + 1, u: meta.unverifiedCount }) : t('chat.unverifiedIcon')}
                </span>
              )}
            </div>
            <button type="button" className="icon-btn" aria-label={t('info.edit')} title={t('info.edit')} onClick={startEdit}>
              <EditIcon size={17} />
            </button>
          </div>
        )}

        <section className="section" aria-labelledby="enc-title">
          <h3 id="enc-title">{t('info.encryption')}</h3>
          <dl className="facts">
            <div>
              <dt>{t('info.protocol')}</dt>
              <dd>{isGroup ? t('info.protocolGroup') : t('info.protocolDirect')}</dd>
            </div>
            {contact ? (
              <>
                <div>
                  <dt>{t('info.ratchet')}</dt>
                  <dd className="mono">{state.crypto.sessions[contact.id] ? state.crypto.sessions[contact.id].ratchet.steps : <small>{t('info.notStarted')}</small>}</dd>
                </div>
                <div>
                  <dt>{t('info.theirKey')}</dt>
                  <dd className="mono">{fingerprint(contact.publicKey)}</dd>
                </div>
              </>
            ) : (
              <>
                <div>
                  <dt>{t('info.epoch')}</dt>
                  <dd className="mono">#{meta.epoch}</dd>
                </div>
                <div>
                  <dt>{t('info.members')}</dt>
                  <dd className="mono">{meta.members.length + 1}</dd>
                </div>
              </>
            )}
            <div>
              <dt>{t('info.sealed')}</dt>
              <dd>{t('info.sealedOn')}</dd>
            </div>
          </dl>
        </section>

        {contact && (
          <section className="section" aria-labelledby="sn-title">
            <h3 id="sn-title">{t('info.safetyNumber')}</h3>
            <div className="safety-grid">
              {contact.safety.map((g, i) => (
                <span key={i}>{g}</span>
              ))}
            </div>
            <p className="help">{t('info.safetyHelp', { name: nameOf(contact) })}</p>
            <button type="button" className="btn btn--outline btn--block" onClick={onVerify}>
              <ShieldIcon size={16} />
              {t('info.compare')}
            </button>
          </section>
        )}

        {isGroup && (
          <section className="section" aria-labelledby="members-title">
            <h3 id="members-title">
              {t('info.members')} · {meta.members.length + 1}
            </h3>
            <ul className="members">
              <li>
                <ProfileAvatar avatar={state.profile.avatar} size={32} />
                <span className="members__name">{state.profile.displayName}</span>
                <span className="members__tag">{t('info.you')}</span>
              </li>
              {meta.members.map((cid) => {
                const c = state.contacts[cid];
                if (!c) return null;
                return (
                  <li key={cid}>
                    <Identicon seed={cid} color={c.color} size={32} />
                    <span className="members__name">{nameOf(c)}</span>
                    <span className={`members__tag ${c.verified ? '' : 'is-warn'}`}>{c.verified ? t('info.tagVerified') : t('info.tagUnverified')}</span>
                    <button
                      type="button"
                      className="icon-btn icon-btn--tiny"
                      aria-label={t('info.removeMember', { name: nameOf(c) })}
                      title={t('info.removeMember', { name: nameOf(c) })}
                      onClick={() => onRemoveMember(cid)}
                    >
                      <MinusCircleIcon size={16} />
                    </button>
                  </li>
                );
              })}
            </ul>
            <button type="button" className="btn btn--dashed btn--block" onClick={onInvite}>
              <PlusIcon size={14} />
              {t('info.invite')}
            </button>
          </section>
        )}

        <section className="section" aria-labelledby="timer-title">
          <h3 id="timer-title">{t('info.disappearing')}</h3>
          <Segmented<Timer>
            label={t('info.disappearing')}
            value={timer}
            onChange={(v) => dispatch({ type: 'timer', value: v, at: Date.now() })}
            options={TIMERS.map((v) => ({ value: v, label: t(`timer.${v}` as MessageKey) }))}
          />
          <p className="help">{timer === 'off' ? t('timer.noteOff') : t('timer.noteOn', { v: t(`timer.${timer}` as MessageKey) })}</p>
        </section>

        <section className="section" aria-labelledby="privacy-title">
          <h3 id="privacy-title">{t('info.privacy')}</h3>
          <SwitchRow
            id="sw-blur"
            label={t('toggle.hideOnBlur')}
            hint={t('toggle.hideOnBlurHint')}
            checked={state.toggles.hideOnBlur}
            onChange={() => dispatch({ type: 'toggle', key: 'hideOnBlur' })}
          />
          <SwitchRow
            id="sw-receipts"
            label={t('toggle.receipts')}
            hint={t('toggle.receiptsHint')}
            checked={state.toggles.receipts}
            onChange={() => dispatch({ type: 'toggle', key: 'receipts' })}
          />
          <SwitchRow
            id="sw-typing"
            label={t('toggle.typing')}
            hint={t('toggle.typingHint')}
            checked={state.toggles.typing}
            onChange={() => dispatch({ type: 'toggle', key: 'typing' })}
          />
        </section>

        <div className="details__actions">
          <button type="button" className="btn btn--outline btn--block" onClick={onRotate}>
            <KeyIcon size={16} />
            {isGroup ? t('info.rotateGroup') : t('info.resetSession')}
          </button>
          <button type="button" className="btn btn--outline btn--block" onClick={() => onConfirm('clear')}>
            <BroomIcon size={16} />
            {t('info.clearChat')}
          </button>
          <button type="button" className="btn btn--danger btn--block" onClick={() => onConfirm(isGroup ? 'leave' : 'delete')}>
            {isGroup ? <LogoutIcon size={16} /> : <TrashIcon size={16} />}
            {isGroup ? t('info.leaveGroup') : t('info.deleteChat')}
          </button>
        </div>
      </div>
    </aside>
  );
}
