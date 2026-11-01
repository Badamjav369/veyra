import { Fragment, useCallback, useEffect, useRef, useState, type Dispatch, type FormEvent, type KeyboardEvent } from 'react';
import { useI18n } from '../i18n';
import type { MessageKey } from '../i18n/en';
import { hex, sha256 } from '../lib/crypto';
import { formatDay, sameDay } from '../lib/time';
import { useToast } from '../lib/toast';
import { readableAccent, usePrefs } from '../prefs';
import { activeId, convoMeta, nameOf, type ChatAction } from '../state/chat';
import type { ChatState, FileInfo, Message, Timer } from '../types';
import { TIMERS } from '../types';
import { BinaryRain } from './BinaryRain';
import { BackIcon, ClipIcon, ClockIcon, EyeOffIcon, LockIcon, PanelIcon, PlusIcon, SendIcon, ShieldIcon, UserPlusIcon, WarnIcon } from './Icons';
import { Identicon, IdenticonStack } from './Identicon';
import { MessageItem } from './MessageItem';
import { copyText } from './dialogs';

export const MAX_FILE_MB = 0.5; // after encryption + base64 this still fits in one 1 MiB frame

function readFile(file: File): Promise<{ dataUrl: string; buffer: ArrayBuffer }> {
  return Promise.all([
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    }),
    file.arrayBuffer(),
  ]).then(([dataUrl, buffer]) => ({ dataUrl, buffer }));
}

interface Props {
  state: ChatState;
  dispatch: Dispatch<ChatAction>;
  now: number;
  onSend: (text: string, file?: FileInfo) => void;
  onTyping: () => void;
  onBack: () => void;
  onToggleDetails: () => void;
  detailsOpen: boolean;
  onVerify: () => void;
  onAddContact: () => void;
  onNewGroup: () => void;
}

export function ChatView({ state, dispatch, now, onSend, onTyping, onBack, onToggleDetails, detailsOpen, onVerify, onAddContact, onNewGroup }: Props) {
  const { t, lang } = useI18n();
  const { prefs } = usePrefs();
  const notify = useToast();
  const [draft, setDraft] = useState('');
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const id = activeId(state);
  const meta = convoMeta(state, id);
  const thread = state.threads[id] ?? [];
  const timer = state.timers[id] ?? 'off';
  const typingWho = state.typing?.convo === id && state.typing.until > now ? state.contacts[state.typing.who] : undefined;
  const accent = readableAccent(prefs.accent);

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [id, thread.length, typingWho]);

  useEffect(() => setDraft(''), [id]);

  // Grow the composer with its content (up to a limit).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  const onCopy = useCallback(
    async (m: Message) => {
      if (await copyText(m.text)) notify(t('msg.copied'));
    },
    [notify, t],
  );
  const onDelete = useCallback(
    (m: Message) => {
      dispatch({ type: 'deleteMessage', convo: id, id: m.id });
      notify(t('msg.deleted'));
    },
    [dispatch, id, notify, t],
  );
  const onSave = useCallback(
    (m: Message) => {
      if (!m.file?.dataUrl) return notify(t('file.unavailable'), 'error');
      const a = document.createElement('a');
      a.href = m.file.dataUrl;
      a.download = m.file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      notify(t('file.saved'));
    },
    [notify, t],
  );

  if (!meta) {
    const isGroupSection = state.section === 'group';
    return (
      <main className="chat chat--empty">
        <div className="chat__stage">
          {prefs.binary && <BinaryRain color={accent} />}
          <div className="empty">
            <span className="empty__icon">{isGroupSection ? <PlusIcon size={22} /> : <UserPlusIcon size={22} />}</span>
            <h1>{t('chat.emptyTitle')}</h1>
            <p>{isGroupSection ? t('chat.emptyGroup') : t('chat.emptyDirect')}</p>
            <button type="button" className="btn btn--primary" onClick={isGroupSection ? onNewGroup : onAddContact}>
              {isGroupSection ? t('list.newGroup') : t('list.addContact')}
            </button>
          </div>
        </div>
      </main>
    );
  }

  const isGroup = meta.kind === 'group';

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft('');
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    send();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    const wantsSend = prefs.enterToSend ? !e.shiftKey : e.ctrlKey || e.metaKey;
    if (wantsSend) {
      e.preventDefault();
      send();
    }
  };

  const attach = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_FILE_MB * 1024 * 1024) return notify(t('file.tooBig', { n: MAX_FILE_MB }), 'error');
    try {
      const { dataUrl, buffer } = await readFile(file);
      const checksum = hex(await sha256(buffer));
      onSend(draft.trim(), { name: file.name, size: file.size, type: file.type || 'application/octet-stream', checksum, dataUrl });
      setDraft('');
    } catch {
      notify(t('file.readError'), 'error');
    }
  };

  const cycleTimer = () => {
    const next: Timer = TIMERS[(TIMERS.indexOf(timer) + 1) % TIMERS.length];
    dispatch({ type: 'timer', value: next, at: Date.now() });
  };

  const timerLabel = timer === 'off' ? t('timer.chipOff') : t(`timer.${timer}` as MessageKey);
  const subtitle = isGroup
    ? meta.description ||
      (meta.unverifiedCount > 0
        ? t('chat.groupSubUnverified', { n: meta.members.length + 1, u: meta.unverifiedCount })
        : t('chat.groupSub', { n: meta.members.length + 1 }))
    : meta.verified
      ? t('chat.directSub')
      : t('chat.directSubChanged');

  return (
    <main className="chat" aria-label={meta.name}>
      <header className="chat__header">
        <button type="button" className="icon-btn chat__back" aria-label={t('chat.back')} onClick={onBack}>
          <BackIcon />
        </button>
        {isGroup ? (
          <IdenticonStack people={meta.members.map((p) => ({ seed: p, color: state.contacts[p]?.color ?? '#93A19C' }))} size={36} />
        ) : (
          <Identicon seed={meta.seed} color={meta.color} size={42} photo={state.contacts[meta.seed]?.avatar} />
        )}
        <div className="chat__title">
          <h1>
            <span className="chat__handle">
              <span className="sigil" style={isGroup ? { color: meta.color } : undefined}>
                {isGroup ? '#' : '@'}
              </span>
              {meta.name}
            </span>
            {meta.verified ? (
              <span className="verified-icon" title={t('chat.verified')}>
                <ShieldIcon size={15} />
                <span className="sr-only">{t('chat.verified')}</span>
              </span>
            ) : (
              <span className="warn-icon" title={t('chat.unverifiedIcon')}>
                <WarnIcon size={14} />
                <span className="sr-only">{t('chat.unverifiedIcon')}</span>
              </span>
            )}
          </h1>
          <p className={meta.verified || (isGroup && meta.description) ? '' : 'is-warn'}>{subtitle}</p>
        </div>
        <div className="chat__actions">
          <button
            type="button"
            className="icon-btn icon-btn--bordered hide-phone"
            aria-pressed={state.privacyScreen}
            aria-label={t('chat.privacyScreen')}
            title={t('chat.privacyScreen')}
            onClick={() => dispatch({ type: 'privacyScreen' })}
          >
            <EyeOffIcon size={17} />
          </button>
          <button type="button" className="chip-btn" aria-label={t('chat.timer', { v: timerLabel })} title={t('chat.timer', { v: timerLabel })} onClick={cycleTimer}>
            <ClockIcon size={15} />
            <span className="hide-phone">{timerLabel}</span>
          </button>
          {!isGroup && (
            <button type="button" className="icon-btn" aria-label={t('chat.verify')} title={t('chat.verify')} onClick={onVerify}>
              <ShieldIcon />
            </button>
          )}
          <button
            type="button"
            className="icon-btn"
            aria-expanded={detailsOpen}
            aria-label={t('chat.details')}
            title={t('chat.details')}
            onClick={onToggleDetails}
          >
            <PanelIcon />
          </button>
        </div>
      </header>

      <div className="chat__stage">
        {prefs.binary && <BinaryRain color={accent} />}
        <div ref={threadRef} className="thread">
          <div className="thread__inner" role="log" aria-label={t('chat.messages')}>
            <div className="notice">
              <span className="notice__icon">
                <LockIcon size={16} />
              </span>
              <p>{isGroup ? t('chat.notice.group') : t('chat.notice.direct')}</p>
            </div>

            {thread.map((m, i) => {
              const prev = thread[i - 1];
              const newDay = !prev || !sameDay(prev.at, m.at);
              const showSender = !prev || prev.from !== 'them' || prev.who !== m.who || newDay;
              return (
                <Fragment key={m.id}>
                  {newDay && (
                    <div className="day-sep">
                      <span>{formatDay(m.at, lang, t)}</span>
                    </div>
                  )}
                  <MessageItem
                    message={m}
                    tick={m.revealed < m.text.length ? state.tick : 0}
                    now={m.expiresAt ? now : 0}
                    isGroup={isGroup}
                    showSender={showSender}
                    privacyScreen={state.privacyScreen}
                    contacts={state.contacts}
                    onCopy={onCopy}
                    onDelete={onDelete}
                    onSave={onSave}
                  />
                </Fragment>
              );
            })}

            {typingWho && (
              <div className="typing">
                <span className="typing__dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                {t('msg.typing', { name: nameOf(typingWho) })}
              </div>
            )}
          </div>
        </div>
      </div>

      <form className="composer" onSubmit={submit}>
        {state.privacyScreen && <p className="composer__privacy">{t('chat.privacyScreenOn')}</p>}
        <div className="composer__field field">
          <button type="button" className="icon-btn" aria-label={t('composer.attach')} title={t('composer.attach')} onClick={() => fileRef.current?.click()}>
            <ClipIcon />
          </button>
          <input
            ref={fileRef}
            type="file"
            hidden
            onChange={(e) => {
              void attach(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <label htmlFor="composer-input" className="sr-only">
            {t('composer.label')}
          </label>
          <textarea
            id="composer-input"
            ref={inputRef}
            rows={1}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (e.target.value) onTyping();
            }}
            onKeyDown={onKeyDown}
            placeholder={t(isGroup ? 'composer.placeholderGroup' : 'composer.placeholderDirect', { name: meta.name })}
            autoComplete="off"
            aria-describedby="composer-note"
          />
          <button type="submit" className="send-btn" aria-label={t('composer.send')} title={t('composer.send')} disabled={!draft.trim()}>
            <SendIcon />
          </button>
        </div>
        <p className="composer__note" id="composer-note">
          <LockIcon size={12} />
          <span>{isGroup ? t('composer.noteGroup') : t('composer.noteDirect')}</span>
          <span className="composer__keys hide-phone">{prefs.enterToSend ? t('composer.enterHint') : t('composer.ctrlHint')}</span>
        </p>
      </form>
    </main>
  );
}
