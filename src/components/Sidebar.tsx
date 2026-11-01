import { useMemo, useState, type Dispatch } from 'react';
import { useI18n } from '../i18n';
import { formatListTime } from '../lib/time';
import { scramble } from '../lib/visual';
import { usePrefs } from '../prefs';
import { activeId, convoMeta, nameOf, type ChatAction } from '../state/chat';
import type { ChatState } from '../types';
import type { NetState } from '../App';
import { EyeIcon, EyeOffIcon, LogoutIcon, PlusIcon, SearchIcon, SettingsIcon, UserIcon, UserPlusIcon, UsersIcon, WarnIcon } from './Icons';
import { Identicon, ProfileAvatar } from './Identicon';
import { LanguageSwitch } from './LanguageSwitch';
import { Logo } from './Logo';

interface Props {
  state: ChatState;
  dispatch: Dispatch<ChatAction>;
  net: NetState;
  onOpen: (id: string) => void;
  onNewGroup: () => void;
  onAddContact: () => void;
  onSettings: () => void;
  onProfile: () => void;
  onLock: () => void;
}

export function Sidebar({ state, dispatch, net, onOpen, onNewGroup, onAddContact, onSettings, onProfile, onLock }: Props) {
  const { t, lang } = useI18n();
  const { prefs } = usePrefs();
  const [query, setQuery] = useState('');
  const current = activeId(state);
  const profile = state.profile;

  const directIds = state.directIds.map((p) => `d:${p}`);
  const groupIds = state.groups.map((g) => g.id);
  const unreadIn = (ids: string[]) => ids.reduce((sum, id) => sum + (id === current ? 0 : state.unread[id] ?? 0), 0);
  const directUnread = unreadIn(directIds);
  const groupUnread = unreadIn(groupIds);
  const ids = state.section === 'direct' ? directIds : groupIds;

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ids
      .map((id) => {
        const meta = convoMeta(state, id);
        if (!meta) return null;
        const thread = state.threads[id] ?? [];
        const last = [...thread].reverse().find((m) => m.from !== 'system');
        let preview = '';
        if (last) {
          if (last.file) preview = `${t('list.file')} · ${last.file.name}`;
          else if (last.from === 'me') preview = `${t('list.you')}: ${last.text}`;
          else if (meta.kind === 'group' && last.who) preview = `${nameOf(state.contacts[last.who]) || '?'}: ${last.text}`;
          else preview = last.text;
        }
        const handle = meta.kind === 'direct' ? state.contacts[meta.seed]?.handle ?? '' : '';
        return { id, meta, preview, handle, at: last?.at ?? thread[thread.length - 1]?.at ?? 0 };
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
      .filter((item) => !q || item.meta.name.toLowerCase().includes(q) || item.handle.includes(q));
  }, [ids, query, state, t]);

  return (
    <aside className="sidebar" aria-label={t('search.label')}>
      <div className="sidebar__top">
        <Logo size={26} />
        <div className="sidebar__top-actions">
          <LanguageSwitch />
          <button type="button" className="icon-btn" aria-label={t('vault.lock')} title={t('vault.lock')} onClick={onLock}>
            <LogoutIcon />
          </button>
        </div>
      </div>
      <p className={`vault-status vault-status--${net.status}`} role="status">
        <span className="dot" aria-hidden="true" />
        {net.error === 'replaced'
          ? t('net.replaced')
          : net.error
            ? t('net.rejected')
            : net.status === 'online'
              ? `${t('vault.open')} · ${t('net.online')}`
              : net.status === 'connecting'
                ? t('net.connecting')
                : t('net.offline')}
      </p>

      <div className="sidebar__search">
        <label htmlFor="search" className="sr-only">
          {t('search.label')}
        </label>
        <div className="field">
          <SearchIcon size={15} />
          <input
            id="search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('search.placeholder')}
            autoComplete="off"
          />
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label={t('tabs.label')}>
        {(['direct', 'group'] as const).map((sec) => (
          <button
            key={sec}
            type="button"
            role="tab"
            className="tabs__tab"
            aria-selected={state.section === sec}
            onClick={() => dispatch({ type: 'section', section: sec })}
          >
            {sec === 'direct' ? <UserIcon size={16} /> : <UsersIcon size={17} />}
            {sec === 'direct' ? t('tabs.direct') : t('tabs.groups')}
            {(sec === 'direct' ? directUnread : groupUnread) > 0 && (
              <span className="badge" aria-label={t('list.unread', { n: sec === 'direct' ? directUnread : groupUnread })}>
                {sec === 'direct' ? directUnread : groupUnread}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="list-head">
        <span className="list-head__count">
          {state.section === 'direct'
            ? t('list.directCount', { n: directIds.length })
            : t('list.groupCount', { n: groupIds.length })}
        </span>
        <div className="list-head__actions">
          {state.section === 'direct' ? (
            <>
              <button
                type="button"
                className="icon-btn icon-btn--small"
                aria-pressed={state.hidePreviews}
                aria-label={state.hidePreviews ? t('list.showPreviews') : t('list.hidePreviews')}
                title={state.hidePreviews ? t('list.showPreviews') : t('list.hidePreviews')}
                onClick={() => dispatch({ type: 'hidePreviews' })}
              >
                {state.hidePreviews ? <EyeIcon size={16} /> : <EyeOffIcon size={16} />}
              </button>
              <button type="button" className="text-btn text-btn--outline" onClick={onAddContact}>
                <UserPlusIcon size={15} />
                {t('list.addContact')}
              </button>
            </>
          ) : (
            <button type="button" className="text-btn text-btn--outline" onClick={onNewGroup}>
              <PlusIcon size={14} />
              {t('list.newGroup')}
            </button>
          )}
        </div>
      </div>

      <nav className="convo-list" aria-label={state.section === 'direct' ? t('tabs.direct') : t('tabs.groups')}>
        {ids.length === 0 && (
          <p className="convo-list__empty">{state.section === 'direct' ? t('list.noDirect') : t('list.noGroups')}</p>
        )}
        {ids.length > 0 && items.length === 0 && <p className="convo-list__empty">{t('list.empty')}</p>}
        {items.map(({ id, meta, preview, at }) => {
          const isActive = id === current;
          const unread = isActive ? 0 : state.unread[id] ?? 0;
          const shown = state.hidePreviews ? scramble(preview, id.length * 31 + 7) : preview;
          return (
            <button key={id} type="button" className="convo" aria-current={isActive ? 'true' : undefined} onClick={() => onOpen(id)}>
              <Identicon seed={meta.seed} color={meta.color} size={42} shape={meta.kind === 'group' ? 'square' : 'circle'} />
              <span className="convo__body">
                <span className="convo__row">
                  <span className="convo__name">
                    <span className="convo__handle">
                      <span className="sigil" style={meta.kind === 'group' ? { color: meta.color } : undefined}>
                        {meta.kind === 'group' ? '#' : '@'}
                      </span>
                      {meta.name}
                    </span>
                    {!meta.verified && (
                      <span className="warn-icon" title={t('chat.unverifiedIcon')}>
                        <WarnIcon size={12} />
                      </span>
                    )}
                  </span>
                  <span className="convo__time">{at ? formatListTime(at, lang, t, prefs.clock) : ''}</span>
                </span>
                <span className="convo__row">
                  <span className={`convo__preview ${state.hidePreviews ? 'is-masked' : ''}`}>
                    {meta.kind === 'group' && (
                      <span className="convo__members">
                        {t('list.members', { n: meta.members.length + 1 })}
                        {shown ? ' · ' : ''}
                      </span>
                    )}
                    {shown}
                  </span>
                  {unread > 0 && (
                    <span className="badge" aria-label={t('list.unread', { n: unread })}>
                      {unread}
                    </span>
                  )}
                </span>
              </span>
            </button>
          );
        })}
      </nav>

      <div className="me">
        <button type="button" className="me__profile" onClick={onProfile} aria-label={t('me.profile')} title={t('me.profile')}>
          <span className="me__avatar">
            <ProfileAvatar avatar={profile.avatar} size={38} />
            <span className={`presence-dot presence-dot--${profile.presence}`} aria-hidden="true" />
          </span>
          <span className="me__text">
            <span className="me__name">{profile.displayName}</span>
            <span className="me__key">{profile.bio || `@${profile.handle}`}</span>
          </span>
        </button>
        <button type="button" className="icon-btn" aria-label={t('me.settings')} title={t('me.settings')} onClick={onSettings}>
          <SettingsIcon />
        </button>
      </div>
    </aside>
  );
}
