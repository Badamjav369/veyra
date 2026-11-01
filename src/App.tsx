import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ChatView } from './components/ChatView';
import { DetailsPanel } from './components/DetailsPanel';
import { AddContactDialog, ConfirmDialog, InviteDialog, NewGroupDialog, VerifyDialog } from './components/dialogs';
import { LogoMark } from './components/Logo';
import { ProfileDialog } from './components/ProfileDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { Sidebar } from './components/Sidebar';
import { AuthScreen } from './components/AuthScreen';
import { useI18n } from './i18n';
import { useToast } from './lib/toast';
import { makeBackup, makeRecovery } from './lib/account';
import { RecoveryDialog } from './components/RecoveryCode';
import { deriveAccountKeys, deviceId, forgetAccount, markSynced, saveVault, type VaultSession } from './lib/vault';
import { defaultServerUrl, type ConnStatus } from './net/connection';
import { Engine, newGroupId, newMessageId } from './net/engine';
import { usePrefs } from './prefs';
import { activeId, chatReducer, contactOf, convoMeta, isGroupId, nameOf, type ChatAction } from './state/chat';
import type { ChatState, Contact, FileInfo, Group, Profile } from './types';
import { PALETTE } from './types';

type Dialog =
  | { kind: 'group' }
  | { kind: 'verify' }
  | { kind: 'settings' }
  | { kind: 'profile' }
  | { kind: 'contact' }
  | { kind: 'invite' }
  | { kind: 'recovery' }
  | { kind: 'confirm'; action: 'leave' | 'delete' | 'clear' | 'erase' }
  | null;

const WIDE = '(min-width: 1200px)';

export type SignOutReason = 'lock' | 'erase' | 'replaced' | 'conflict';

export default function App() {
  const [vault, setVault] = useState<{ session: VaultSession; state: ChatState } | null>(null);
  const [lastOut, setLastOut] = useState<{ handle: string; reason: SignOutReason } | null>(null);

  if (!vault)
    return (
      <AuthScreen
        signedOut={lastOut}
        onReady={(session, state) => {
          setLastOut(null);
          setVault({ session, state });
        }}
      />
    );

  return (
    <ChatApp
      key={vault.state.profile.publicKey}
      initial={vault.state}
      session={vault.session}
      onLocked={(reason) => {
        setLastOut({ handle: vault.session.handle, reason });
        setVault(null); // the sign-in screen explains what happened
      }}
    />
  );
}

/** What gets written to the vault (transient UI bits are dropped). */
const persistable = (s: ChatState): ChatState => ({ ...s, typing: null, tick: 0 });

export interface NetState {
  status: ConnStatus;
  error?: string;
}

function ChatApp({ initial, session: initialSession, onLocked }: { initial: ChatState; session: VaultSession; onLocked: (reason: SignOutReason) => void }) {
  const { t } = useI18n();
  const { prefs } = usePrefs();
  const notify = useToast();
  const [state, rawDispatch] = useReducer(chatReducer, initial);
  // Accounts without a recovery code are asked to make one right away.
  const [dialog, setDialog] = useState<Dialog>(() => (initial.account?.recovery ? null : { kind: 'recovery' }));
  const [detailsOpen, setDetailsOpen] = useState(() => window.matchMedia(WIDE).matches);
  const [pane, setPane] = useState<'list' | 'chat'>('list'); // phones only
  const [now, setNow] = useState(() => Date.now());
  const [away, setAway] = useState(false);
  const [net, setNet] = useState<NetState>({ status: 'connecting' });
  const session = useRef(initialSession);
  const engine = useRef<Engine | null>(null);
  const lastActivity = useRef(Date.now());

  // The latest state, updated synchronously on every action so the engine never reads stale data.
  const stateRef = useRef(initial);
  const act = useCallback((a: ChatAction) => {
    stateRef.current = chatReducer(stateRef.current, a);
    rawDispatch(a);
  }, []);

  /** Dispatch for the UI: some actions also need to reach the other side. */
  const uiDispatch = useCallback(
    (a: ChatAction) => {
      act(a);
      if (a.type === 'timer') engine.current?.sendTimer(activeId(stateRef.current), a.value);
    },
    [act],
  );

  const current = activeId(state);
  const meta = convoMeta(state, current);
  const thread = state.threads[current] ?? [];
  const pending = thread.some((m) => m.revealed < m.text.length);

  /* ---- save the vault ---- */
  const saving = useRef<Promise<void>>(Promise.resolve());
  const saveNow = useCallback((): Promise<void> => {
    // Saves run one after another so an older snapshot can never overwrite a newer one.
    saving.current = saving.current.then(async () => {
      try {
        await saveVault(session.current, persistable(stateRef.current));
      } catch {
        notify(t('toast.saveFailed'), 'error');
      }
      engine.current?.scheduleBackup();
    });
    return saving.current;
  }, [notify, t]);

  /* ---- the network engine ---- */
  const serverUrl = prefs.server || defaultServerUrl();
  useEffect(() => {
    const e = new Engine({
      url: serverUrl,
      getState: () => stateRef.current,
      dispatch: act,
      onStatus: (status, error) => setNet({ status, error }),
      saveNow,
      backup: {
        device: deviceId(),
        auth: () => session.current.auth,
        syncedRev: () => session.current.syncedRev,
        make: () => makeBackup(session.current, persistable(stateRef.current)),
        saved: (meta) => markSynced(session.current, meta.rev),
        conflict: () => onLockedRef.current('conflict'),
      },
    });
    engine.current = e;
    e.start();
    return () => {
      e.stop();
      engine.current = null;
    };
  }, [serverUrl, act, saveNow]);

  useEffect(() => {
    if (pending) return;
    const id = window.setTimeout(() => void saveNow(), 500);
    return () => window.clearTimeout(id);
  }, [state, pending, saveNow]);

  const onLockedRef = useRef(onLocked);
  onLockedRef.current = onLocked;

  const lock = useCallback(async () => {
    await saveNow();
    // Upload the latest backup before leaving, so signing in elsewhere picks up where you left off.
    await Promise.race([engine.current?.syncNow(), new Promise((r) => window.setTimeout(r, 5000))]);
    onLocked('lock');
  }, [onLocked, saveNow]);

  /* ---- signed in somewhere else: this device steps aside ---- */
  useEffect(() => {
    if (net.error !== 'replaced') return;
    void saveNow().then(() => onLockedRef.current('replaced'));
  }, [net.error, saveNow]);

  /* ---- decrypt animation ---- */
  useEffect(() => {
    if (!pending) return;
    const id = window.setInterval(() => act({ type: 'reveal' }), 45);
    return () => window.clearInterval(id);
  }, [pending, current, act]);

  /* ---- clock: disappearing messages, countdowns, typing timeout, auto-lock ---- */
  useEffect(() => {
    const id = window.setInterval(() => {
      const n = Date.now();
      setNow(n);
      act({ type: 'expire', now: n });
      if (prefs.autoLock > 0 && n - lastActivity.current > prefs.autoLock * 60_000) void lock();
    }, 1000);
    return () => window.clearInterval(id);
  }, [prefs.autoLock, lock, act]);

  useEffect(() => {
    const mark = () => (lastActivity.current = Date.now());
    const events = ['pointerdown', 'keydown', 'pointermove', 'wheel'] as const;
    events.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, mark));
  }, []);

  /* ---- when you look at a chat: start disappearing timers, send read receipts ---- */
  useEffect(() => {
    if (away || !current) return;
    act({ type: 'seen', now: Date.now() });
    const unread = (stateRef.current.threads[current] ?? []).filter((m) => m.from === 'them' && !m.readSent && m.mid && m.who);
    if (!unread.length) return;
    if (stateRef.current.toggles.receipts) {
      const byPerson: Record<string, string[]> = {};
      for (const m of unread) (byPerson[m.who!] ??= []).push(m.mid!);
      engine.current?.sendReceipts(byPerson, 'read');
    }
    act({ type: 'readSent', convo: current, ids: unread.map((m) => m.id) });
  }, [current, thread.length, away, act, net.status]);

  /* ---- cover the app when the window loses focus (if enabled) ---- */
  useEffect(() => {
    const blur = () => setAway(true);
    const focus = () => setAway(false);
    const vis = () => setAway(document.hidden);
    window.addEventListener('blur', blur);
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', vis);
    return () => {
      window.removeEventListener('blur', blur);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', vis);
    };
  }, []);

  /* ---- actions that talk to the other side ---- */

  const send = useCallback(
    (text: string, file?: FileInfo) => {
      const convo = activeId(stateRef.current);
      if (!convo) return;
      const mid = newMessageId();
      const at = Date.now();
      const timer = stateRef.current.timers[convo] ?? 'off';
      act({ type: 'send', convo, mid, text, file, at });
      void engine.current?.sendText(convo, { mid, text, at, timer, file });
    },
    [act],
  );

  const typing = useCallback(() => {
    const convo = activeId(stateRef.current);
    if (convo && stateRef.current.toggles.typing) engine.current?.sendTyping(convo);
  }, []);

  const currentGroup = (): Group | undefined => stateRef.current.groups.find((g) => g.id === activeId(stateRef.current));

  const groupOps = {
    create(name: string, members: string[]) {
      const group: Group = { id: newGroupId(), name, description: '', members, epoch: 1, color: PALETTE[(stateRef.current.groups.length + 4) % PALETTE.length] };
      act({ type: 'groupLocal', group, event: { key: 'sys.groupCreated' }, at: Date.now(), open: true });
      void engine.current?.sendGroup(group, members);
    },
    invite(members: string[]) {
      const g = currentGroup();
      if (!g) return;
      const next = { ...g, members: [...g.members, ...members.filter((m) => !g.members.includes(m))], epoch: g.epoch + 1 };
      act({ type: 'groupLocal', group: next, event: { key: 'sys.added', params: { names: members } }, at: Date.now() });
      void engine.current?.sendGroup(next, next.members);
    },
    remove(handle: string) {
      const g = currentGroup();
      if (!g) return;
      const next = { ...g, members: g.members.filter((m) => m !== handle), epoch: g.epoch + 1 };
      act({ type: 'groupLocal', group: next, event: { key: 'sys.removed', params: { name: handle } }, at: Date.now() });
      void engine.current?.sendGroup(next, next.members);
      void engine.current?.sendGroupRemoved(handle, g.id);
    },
    save(name: string, description: string, color: string) {
      const g = currentGroup();
      if (!g) return;
      const next = { ...g, name, description, color, epoch: g.epoch + 1 };
      act({ type: 'groupLocal', group: next, event: name !== g.name ? { key: 'sys.renamed', params: { group: name } } : undefined, at: Date.now() });
      void engine.current?.sendGroup(next, next.members);
    },
  };

  const rotate = () => {
    const convo = activeId(stateRef.current);
    if (!convo) return;
    if (isGroupId(convo)) {
      const g = currentGroup();
      if (!g) return;
      // Fresh key agreement with every member, then announce the new version.
      for (const m of g.members) void engine.current?.resetSession(m);
      const next = { ...g, epoch: g.epoch + 1 };
      act({ type: 'groupLocal', group: next, event: { key: 'sys.groupKeyRotated' }, at: Date.now() });
      void engine.current?.sendGroup(next, next.members);
    } else {
      void engine.current?.resetSession(contactOf(convo));
      act({ type: 'sessionReset', at: Date.now() });
    }
  };

  const saveProfile = (profile: Profile) => {
    act({ type: 'updateProfile', profile });
    engine.current?.broadcastProfile();
  };

  const changePassphrase = async (currentPass: string, next: string): Promise<'ok' | 'wrong' | 'offline'> => {
    const handle = session.current.handle;
    const check = await deriveAccountKeys(handle, currentPass);
    if (check.auth !== session.current.auth) return 'wrong';
    if (!engine.current?.online) return 'offline';
    const before = session.current;
    // The server copy and the login key must change together with this device's copy.
    session.current = { ...(await deriveAccountKeys(handle, next)), syncedRev: before.syncedRev };
    engine.current.scheduleBackup(0);
    const ok = await engine.current.syncNow();
    if (!ok) {
      session.current = before;
      return 'offline';
    }
    await saveNow();
    return 'ok';
  };

  /** A new recovery code: the server learns only its login-key hash and the data key locked with it. */
  const newRecovery = async () => {
    const account = stateRef.current.account!;
    const { code, recovery } = await makeRecovery(session.current.handle, account.dek);
    act({ type: 'account', account: { ...account, recovery } });
    await saveNow(); // also schedules the upload
    return code;
  };

  const open = (id: string) => {
    act({ type: 'open', id });
    setPane('chat');
  };

  const allContacts = Object.values(state.contacts);
  const directContact = !isGroupId(current) && current ? state.contacts[contactOf(current)] : undefined;
  const group = isGroupId(current) ? state.groups.find((g) => g.id === current) : undefined;

  const confirmCopy = (action: 'leave' | 'delete' | 'clear' | 'erase') => {
    switch (action) {
      case 'leave':
        return { title: t('confirm.leaveTitle', { name: group?.name ?? '' }), body: t('confirm.leaveBody'), label: t('confirm.leave') };
      case 'delete':
        return { title: t('confirm.deleteTitle', { name: nameOf(directContact) }), body: t('confirm.deleteBody'), label: t('confirm.delete') };
      case 'clear':
        return { title: t('confirm.clearTitle'), body: t('confirm.clearBody'), label: t('confirm.clear') };
      case 'erase':
        return { title: t('account.eraseTitle'), body: t('account.eraseBody'), label: t('account.eraseConfirm') };
    }
  };

  const runConfirm = async (action: 'leave' | 'delete' | 'clear' | 'erase') => {
    setDialog(null);
    if (action === 'leave' && group) {
      void engine.current?.sendGroupLeave(group);
      act({ type: 'leaveGroup' });
    }
    if (action === 'delete' && directContact) {
      void engine.current?.resetSession(directContact.id);
      act({ type: 'deleteContact' });
    }
    if (action === 'clear') act({ type: 'clearChat', at: Date.now() });
    if (action === 'erase') {
      try {
        await engine.current?.deleteAccount();
      } catch {
        /* offline: the account stays on the server, but the keys are gone */
      }
      forgetAccount(session.current.handle);
      onLocked('erase');
    }
  };

  const hidden = away && state.toggles.hideOnBlur;

  return (
    <div className={`app ${hidden ? 'is-away' : ''}`} data-details={detailsOpen && meta ? 'open' : 'closed'} data-pane={pane}>
      <Sidebar
        state={state}
        dispatch={uiDispatch}
        net={net}
        onOpen={open}
        onNewGroup={() => setDialog({ kind: 'group' })}
        onAddContact={() => setDialog({ kind: 'contact' })}
        onSettings={() => setDialog({ kind: 'settings' })}
        onProfile={() => setDialog({ kind: 'profile' })}
        onLock={() => void lock()}
      />

      <ChatView
        state={state}
        dispatch={uiDispatch}
        now={now}
        onSend={send}
        onTyping={typing}
        onBack={() => setPane('list')}
        onToggleDetails={() => setDetailsOpen((o) => !o)}
        detailsOpen={detailsOpen}
        onVerify={() => setDialog({ kind: 'verify' })}
        onAddContact={() => setDialog({ kind: 'contact' })}
        onNewGroup={() => setDialog({ kind: 'group' })}
      />

      {detailsOpen && meta && (
        <>
          <button type="button" className="details-backdrop" aria-hidden="true" tabIndex={-1} onClick={() => setDetailsOpen(false)} />
          <DetailsPanel
            state={state}
            dispatch={uiDispatch}
            onClose={() => setDetailsOpen(false)}
            onVerify={() => setDialog({ kind: 'verify' })}
            onInvite={() => setDialog({ kind: 'invite' })}
            onConfirm={(action) => setDialog({ kind: 'confirm', action })}
            onRotate={rotate}
            onRemoveMember={groupOps.remove}
            onSaveGroup={groupOps.save}
          />
        </>
      )}

      {hidden && (
        <div className="away" role="status">
          <LogoMark size={56} />
          <strong>{t('away.title')}</strong>
          <span>{t('away.body')}</span>
        </div>
      )}

      {dialog?.kind === 'group' && (
        <NewGroupDialog
          contacts={allContacts}
          onClose={() => setDialog(null)}
          onCreate={(name, members) => {
            groupOps.create(name, members);
            setDialog(null);
            setPane('chat');
          }}
        />
      )}

      {dialog?.kind === 'invite' && group && (
        <InviteDialog
          groupName={group.name}
          candidates={allContacts.filter((c) => !group.members.includes(c.id))}
          onClose={() => setDialog(null)}
          onInvite={(members) => {
            groupOps.invite(members);
            setDialog(null);
          }}
        />
      )}

      {dialog?.kind === 'verify' && directContact && (
        <VerifyDialog
          profile={state.profile}
          contact={directContact}
          onSetVerified={(verified) => act({ type: 'verify', contactId: directContact.id, verified, at: Date.now() })}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'contact' && (
        <AddContactDialog
          profile={state.profile}
          existing={allContacts.filter((c) => state.directIds.includes(c.id))}
          online={net.status === 'online'}
          lookup={async (handle): Promise<Contact> => {
            if (!engine.current) throw new Error('offline');
            return stateRef.current.contacts[handle] ?? engine.current.lookup(handle);
          }}
          onClose={() => setDialog(null)}
          onAdd={(contact) => {
            act({ type: 'addContact', contact, at: Date.now() });
            setDialog(null);
            setPane('chat');
          }}
        />
      )}

      {dialog?.kind === 'profile' && <ProfileDialog profile={state.profile} onSave={saveProfile} onClose={() => setDialog(null)} />}

      {dialog?.kind === 'settings' && (
        <SettingsDialog
          onChangePassphrase={changePassphrase}
          recoveryAt={state.account?.recovery?.at}
          onRecovery={() => setDialog({ kind: 'recovery' })}
          onLock={() => void lock()}
          onErase={() => setDialog({ kind: 'confirm', action: 'erase' })}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'recovery' && (
        <RecoveryDialog handle={state.profile.handle} hasCode={!!state.account?.recovery} onCreate={newRecovery} onClose={() => setDialog(null)} />
      )}

      {dialog?.kind === 'confirm' &&
        (() => {
          const c = confirmCopy(dialog.action);
          return (
            <ConfirmDialog
              title={c.title}
              body={c.body}
              confirmLabel={c.label}
              danger
              onClose={() => setDialog(null)}
              onConfirm={() => void runConfirm(dialog.action)}
            />
          );
        })()}
    </div>
  );
}
