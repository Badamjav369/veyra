import { memo, useState } from 'react';
import { useI18n, type Translate } from '../i18n';
import type { MessageKey } from '../i18n/en';
import { formatBytes, formatClock, formatRemaining } from '../lib/time';
import { scramble } from '../lib/visual';
import { usePrefs } from '../prefs';
import { nameOf } from '../state/chat';
import type { Contact, Message } from '../types';
import { CheckIcon, ClockIcon, CopyIcon, DoubleCheckIcon, DownloadIcon, FileLockIcon, TrashIcon, WarnIcon } from './Icons';
import { Identicon } from './Identicon';

export function systemText(message: Message, t: Translate, contacts: Record<string, Contact>): string {
  const ev = message.system;
  if (!ev) return '';
  const p = ev.params ?? {};
  const who = (id: string) => (id === 'me' ? t('sys.you') : nameOf(contacts[id]) || id);
  return t(ev.key, {
    name: p.name ? who(p.name) : '',
    names: (p.names ?? []).map(who).join(', '),
    timer: p.timer ? t(`timer.${p.timer}` as MessageKey) : '',
    n: p.n ?? 0,
    group: p.group ?? '',
  });
}

interface Props {
  message: Message;
  tick: number;
  now: number;
  isGroup: boolean;
  showSender: boolean;
  privacyScreen: boolean;
  contacts: Record<string, Contact>;
  onCopy: (m: Message) => void;
  onDelete: (m: Message) => void;
  onSave: (m: Message) => void;
}

function MessageItemImpl({ message: m, tick, now, isGroup, showSender, privacyScreen, contacts, onCopy, onDelete, onSave }: Props) {
  const { t, lang } = useI18n();
  const { prefs } = usePrefs();
  const [peek, setPeek] = useState(false);

  if (m.from === 'system') {
    return (
      <div className="msg-system">
        <span>
          {systemText(m, t, contacts)} · {formatClock(m.at, lang, prefs.clock)}
        </span>
      </div>
    );
  }

  const decrypting = m.revealed < m.text.length;
  const hidden = privacyScreen && !peek && !decrypting;
  const plain = hidden ? '' : m.text.slice(0, m.revealed);
  const noise = hidden ? scramble(m.text, m.id) : decrypting ? scramble(m.text.slice(m.revealed), m.id + tick * 17) : '';
  const mine = m.from === 'me';
  const sender = m.who ? contacts[m.who] : undefined;
  const time = formatClock(m.at, lang, prefs.clock);
  const isImage = !!m.file?.dataUrl && m.file.type.startsWith('image/');

  const peekHandlers = privacyScreen
    ? { onMouseEnter: () => setPeek(true), onMouseLeave: () => setPeek(false), onFocus: () => setPeek(true), onBlur: () => setPeek(false) }
    : {};

  const body = m.file ? (
    <div className={`file-card ${hidden ? 'is-hidden' : ''}`} {...peekHandlers}>
      {isImage && !hidden && <img className="file-card__image" src={m.file.dataUrl} alt={m.file.name} />}
      <div className="file-card__top">
        <span className="file-card__icon">
          <FileLockIcon size={20} />
        </span>
        <span className="file-card__text">
          <span className="file-card__name">{hidden ? scramble(m.file.name, m.id) : m.file.name}</span>
          <span className="file-card__meta">{formatBytes(m.file.size)}</span>
        </span>
      </div>
      <div className="file-card__sum">
        {t('file.checksum')}: {m.file.checksum.length > 24 ? `${m.file.checksum.slice(0, 12)}…${m.file.checksum.slice(-8)}` : m.file.checksum}
      </div>
      <button type="button" className="btn btn--outline" onClick={() => onSave(m)}>
        <DownloadIcon size={16} />
        {t('file.save')}
      </button>
      {m.text && <p className="file-card__caption">{hidden ? scramble(m.text, m.id) : m.text}</p>}
    </div>
  ) : (
    <div className={`bubble ${mine ? 'bubble--mine' : 'bubble--theirs'}`} {...peekHandlers}>
      {/* The animated text is visual only; screen readers get the message once, in full. */}
      <span aria-hidden="true">
        {plain}
        {noise && <span className={`bubble__noise ${hidden ? 'is-hidden' : ''}`}>{noise}</span>}
      </span>
      <span className="sr-only">{hidden ? t('chat.privacyScreen') : m.text}</span>
    </div>
  );

  const remaining = m.expiresAt ? m.expiresAt - now : null;
  const timerLabel = remaining !== null ? formatRemaining(remaining, t) : m.timer && m.timer !== 'off' ? t(`timer.${m.timer}` as MessageKey) : null;

  const statusIcon =
    m.status === 'pending' ? (
      <ClockIcon size={13} />
    ) : m.status === 'failed' ? (
      <WarnIcon size={13} />
    ) : m.status === 'sent' ? (
      <CheckIcon size={14} />
    ) : (
      <DoubleCheckIcon size={16} />
    );

  return (
    <div className={`msg ${mine ? 'msg--mine' : 'msg--theirs'}`}>
      {isGroup && !mine && (
        <span className="msg__avatar">{showSender && sender && <Identicon seed={sender.id} color={sender.color} size={30} photo={sender.avatar} />}</span>
      )}
      <div className="msg__col">
        {isGroup && !mine && showSender && (
          <span className="msg__sender" style={{ color: sender?.color }}>
            {sender ? nameOf(sender) : '?'}
          </span>
        )}
        <div className="msg__line">
          {body}
          <div className="msg__tools" role="group" aria-label={time}>
            {!m.file && m.text && (
              <button type="button" className="icon-btn icon-btn--tiny" aria-label={t('msg.copy')} title={t('msg.copy')} onClick={() => onCopy(m)}>
                <CopyIcon size={14} />
              </button>
            )}
            <button type="button" className="icon-btn icon-btn--tiny" aria-label={t('msg.delete')} title={t('msg.delete')} onClick={() => onDelete(m)}>
              <TrashIcon size={14} />
            </button>
          </div>
        </div>
        <div className="meta">
          {timerLabel && (
            <span className="meta__timer" title={remaining !== null ? t('msg.expiresIn', { v: timerLabel }) : undefined}>
              <ClockIcon size={12} />
              {timerLabel}
            </span>
          )}
          <span>{time}</span>
          {decrypting && <span className="meta__status">{mine ? t('msg.encrypting') : t('msg.decrypting')}</span>}
          {mine && !decrypting && m.status && (
            <span className={`meta__check meta__check--${m.status}`} title={t(`msg.${m.status}` as MessageKey)}>
              {statusIcon}
              <span className="sr-only">{t(`msg.${m.status}` as MessageKey)}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export const MessageItem = memo(MessageItemImpl);
