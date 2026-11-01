import type { ChatState, Contact, CryptoStore, FileInfo, Group, Message, MsgStatus, Profile, Section, SystemEvent, Timer } from '../types';
import { TIMER_MS } from '../types';

export type ChatAction =
  | { type: 'section'; section: Section }
  | { type: 'account'; account: NonNullable<ChatState['account']> }
  | { type: 'open'; id: string }
  | { type: 'send'; convo: string; mid: string; text: string; file?: FileInfo; at: number }
  | { type: 'status'; mid: string; status: MsgStatus }
  | { type: 'receive'; convo: string; who: string; mid: string; text: string; at: number; timer: Timer; file?: FileInfo }
  | { type: 'receipt'; who: string; mids: string[]; s: 'delivered' | 'read' }
  | { type: 'readSent'; convo: string; ids: number[] }
  | { type: 'typing'; convo: string; who: string; until: number }
  | { type: 'reveal' }
  | { type: 'seen'; now: number }
  | { type: 'expire'; now: number }
  | { type: 'timer'; value: Timer; at: number }
  | { type: 'timerSync'; convo: string; who: string; timer: Timer; at: number }
  | { type: 'toggle'; key: keyof ChatState['toggles'] }
  | { type: 'hidePreviews' }
  | { type: 'privacyScreen' }
  | { type: 'sessionReset'; at: number }
  | { type: 'verify'; contactId: string; verified: boolean; at: number }
  | { type: 'groupLocal'; group: Group; event?: SystemEvent; at: number; open?: boolean }
  | { type: 'groupSync'; group: Group; from: string; at: number }
  | { type: 'groupRemoved'; gid: string; by: string; at: number }
  | { type: 'memberLeft'; gid: string; who: string; at: number }
  | { type: 'leaveGroup' }
  | { type: 'addContact'; contact: Contact; at: number }
  | { type: 'ensureContacts'; contacts: Contact[]; direct?: boolean }
  | { type: 'identityChanged'; handle: string; publicKey: string; safety: string[]; at: number }
  | { type: 'peerProfile'; handle: string; displayName: string; bio: string; avatar?: string; color: string }
  | { type: 'updateContact'; id: string; nickname: string; color: string }
  | { type: 'deleteContact' }
  | { type: 'clearChat'; at: number }
  | { type: 'deleteMessage'; convo: string; id: number }
  | { type: 'decryptFailed'; handle: string; at: number }
  | { type: 'updateProfile'; profile: Profile }
  | { type: 'crypto'; crypto: CryptoStore };

export const activeId = (s: ChatState): string => (s.section === 'direct' ? s.activeDirect : s.activeGroup);
export const isGroupId = (id: string) => id.startsWith('g:');
export const contactOf = (directId: string) => directId.slice(2);
export const nameOf = (c: Contact | undefined) => (c ? c.nickname.trim() || c.displayName.trim() || c.handle : '');

export interface ConvoMeta {
  id: string;
  kind: Section;
  name: string;
  color: string;
  seed: string;
  members: string[];
  verified: boolean;
  unverifiedCount: number;
  description: string;
  epoch: number;
}

export function convoMeta(s: ChatState, id: string): ConvoMeta | null {
  if (!id) return null;
  if (!isGroupId(id)) {
    const h = contactOf(id);
    const c = s.contacts[h];
    if (!c) return null;
    return {
      id,
      kind: 'direct',
      name: nameOf(c),
      color: c.color,
      seed: h,
      members: [h],
      verified: c.verified,
      unverifiedCount: c.verified ? 0 : 1,
      description: c.bio,
      epoch: 0,
    };
  }
  const g = s.groups.find((x) => x.id === id);
  if (!g) return null;
  const members = g.members.filter((m) => s.contacts[m]);
  const unverifiedCount = members.filter((m) => !s.contacts[m].verified).length;
  return {
    id: g.id,
    kind: 'group',
    name: g.name,
    color: g.color,
    seed: g.id,
    members,
    verified: unverifiedCount === 0,
    unverifiedCount,
    description: g.description,
    epoch: g.epoch,
  };
}

const RANK: Record<MsgStatus, number> = { pending: 0, failed: 0, sent: 1, delivered: 2, read: 3 };
const expiry = (timer: Timer | undefined, from: number) => (timer && timer !== 'off' ? from + TIMER_MS[timer] : undefined);

function sys(s: ChatState, convo: string, at: number, system: SystemEvent): ChatState {
  const m: Message = { id: s.nextId, from: 'system', text: '', at, revealed: 0, system };
  return { ...s, nextId: s.nextId + 1, threads: { ...s.threads, [convo]: [...(s.threads[convo] ?? []), m] } };
}

function mapMessages(s: ChatState, fn: (m: Message) => Message): ChatState {
  let changed = false;
  const threads: ChatState['threads'] = {};
  for (const [k, list] of Object.entries(s.threads)) {
    const next = list.map((m) => {
      const r = fn(m);
      if (r !== m) changed = true;
      return r;
    });
    threads[k] = next;
  }
  return changed ? { ...s, threads } : s;
}

function addContacts(s: ChatState, contacts: Contact[], direct: boolean): ChatState {
  let next = s;
  for (const c of contacts) {
    if (!next.contacts[c.id]) next = { ...next, contacts: { ...next.contacts, [c.id]: c } };
    if (direct && !next.directIds.includes(c.id)) next = { ...next, directIds: [c.id, ...next.directIds] };
  }
  return next;
}

export function chatReducer(s: ChatState, a: ChatAction): ChatState {
  const current = activeId(s);

  switch (a.type) {
    case 'section': {
      const id = a.section === 'direct' ? s.activeDirect : s.activeGroup;
      return { ...s, section: a.section, unread: id ? { ...s.unread, [id]: 0 } : s.unread };
    }

    case 'open': {
      const patch = isGroupId(a.id) ? { activeGroup: a.id, section: 'group' as const } : { activeDirect: a.id, section: 'direct' as const };
      return { ...s, ...patch, unread: { ...s.unread, [a.id]: 0 } };
    }

    case 'send': {
      const timer = s.timers[a.convo] ?? 'off';
      const m: Message = {
        id: s.nextId,
        mid: a.mid,
        from: 'me',
        text: a.text,
        at: a.at,
        timer,
        expiresAt: expiry(timer, a.at),
        revealed: 0,
        status: 'pending',
        file: a.file,
      };
      const directIds = isGroupId(a.convo) ? s.directIds : [contactOf(a.convo), ...s.directIds.filter((x) => x !== contactOf(a.convo))];
      return { ...s, nextId: s.nextId + 1, directIds, threads: { ...s.threads, [a.convo]: [...(s.threads[a.convo] ?? []), m] } };
    }

    case 'status':
      return mapMessages(s, (m) =>
        m.mid === a.mid && m.from === 'me' && (RANK[a.status] > RANK[m.status ?? 'pending'] || a.status === 'failed') ? { ...m, status: a.status } : m,
      );

    case 'receive': {
      if (s.threads[a.convo]?.some((m) => m.mid === a.mid)) return s; // duplicate
      const m: Message = { id: s.nextId, mid: a.mid, from: 'them', who: a.who, text: a.text, at: a.at, timer: a.timer, revealed: 0, file: a.file };
      const isActive = current === a.convo;
      const directIds = isGroupId(a.convo) ? s.directIds : [a.who, ...s.directIds.filter((x) => x !== a.who)];
      return {
        ...s,
        nextId: s.nextId + 1,
        directIds,
        typing: s.typing?.who === a.who ? null : s.typing,
        threads: { ...s.threads, [a.convo]: [...(s.threads[a.convo] ?? []), m] },
        unread: isActive ? s.unread : { ...s.unread, [a.convo]: (s.unread[a.convo] ?? 0) + 1 },
      };
    }

    case 'receipt': {
      const set = new Set(a.mids);
      return mapMessages(s, (m) => (m.from === 'me' && m.mid && set.has(m.mid) && RANK[a.s] > RANK[m.status ?? 'pending'] ? { ...m, status: a.s } : m));
    }

    case 'readSent': {
      const list = s.threads[a.convo];
      if (!list) return s;
      const ids = new Set(a.ids);
      return { ...s, threads: { ...s.threads, [a.convo]: list.map((m) => (ids.has(m.id) ? { ...m, readSent: true } : m)) } };
    }

    case 'typing':
      return { ...s, typing: { convo: a.convo, who: a.who, until: a.until } };

    case 'reveal': {
      const thread = s.threads[current] ?? [];
      if (!thread.some((m) => m.revealed < m.text.length)) return s;
      const next = thread.map((m) =>
        m.revealed < m.text.length ? { ...m, revealed: Math.min(m.text.length, m.revealed + Math.max(1, Math.ceil(m.text.length / 26))) } : m,
      );
      return { ...s, tick: s.tick + 1, threads: { ...s.threads, [current]: next } };
    }

    case 'seen': {
      const thread = s.threads[current];
      if (!thread || !thread.some((m) => m.from === 'them' && !m.expiresAt && m.timer && m.timer !== 'off')) return s;
      const next = thread.map((m) => (m.from === 'them' && !m.expiresAt && m.timer && m.timer !== 'off' ? { ...m, expiresAt: expiry(m.timer, a.now) } : m));
      return { ...s, threads: { ...s.threads, [current]: next } };
    }

    case 'expire': {
      let changed = false;
      const threads: ChatState['threads'] = {};
      for (const [k, list] of Object.entries(s.threads)) {
        const kept = list.filter((m) => !m.expiresAt || m.expiresAt > a.now);
        if (kept.length !== list.length) changed = true;
        threads[k] = kept;
      }
      const typing = s.typing && s.typing.until < a.now ? null : s.typing;
      return changed || typing !== s.typing ? { ...s, threads, typing } : s;
    }

    case 'timer': {
      if (!current || (s.timers[current] ?? 'off') === a.value) return s;
      const next = { ...s, timers: { ...s.timers, [current]: a.value } };
      return sys(next, current, a.at, a.value === 'off' ? { key: 'sys.timerOff', params: { name: 'me' } } : { key: 'sys.timerSet', params: { name: 'me', timer: a.value } });
    }

    case 'timerSync': {
      if ((s.timers[a.convo] ?? 'off') === a.timer) return s;
      const next = { ...s, timers: { ...s.timers, [a.convo]: a.timer } };
      return sys(next, a.convo, a.at, a.timer === 'off' ? { key: 'sys.timerOff', params: { name: a.who } } : { key: 'sys.timerSet', params: { name: a.who, timer: a.timer } });
    }

    case 'toggle':
      return { ...s, toggles: { ...s.toggles, [a.key]: !s.toggles[a.key] } };

    case 'hidePreviews':
      return { ...s, hidePreviews: !s.hidePreviews };

    case 'privacyScreen':
      return { ...s, privacyScreen: !s.privacyScreen };

    case 'sessionReset':
      return current ? sys(s, current, a.at, { key: 'sys.sessionReset' }) : s;

    case 'verify': {
      const c = s.contacts[a.contactId];
      if (!c || c.verified === a.verified) return s;
      const next = { ...s, contacts: { ...s.contacts, [a.contactId]: { ...c, verified: a.verified } } };
      return sys(next, `d:${a.contactId}`, a.at, { key: a.verified ? 'sys.verified' : 'sys.unverified', params: { name: a.contactId } });
    }

    case 'groupLocal': {
      const exists = s.groups.some((g) => g.id === a.group.id);
      let next: ChatState = {
        ...s,
        groups: exists ? s.groups.map((g) => (g.id === a.group.id ? a.group : g)) : [...s.groups, a.group],
        threads: s.threads[a.group.id] ? s.threads : { ...s.threads, [a.group.id]: [] },
      };
      if (a.open) next = { ...next, section: 'group', activeGroup: a.group.id };
      return a.event ? sys(next, a.group.id, a.at, a.event) : next;
    }

    case 'groupSync': {
      const old = s.groups.find((g) => g.id === a.group.id);
      if (old && a.group.epoch < old.epoch) return s; // stale update
      let next: ChatState = {
        ...s,
        groups: old ? s.groups.map((g) => (g.id === a.group.id ? a.group : g)) : [...s.groups, a.group],
        threads: s.threads[a.group.id] ? s.threads : { ...s.threads, [a.group.id]: [] },
      };
      if (!old) return sys(next, a.group.id, a.at, { key: 'sys.addedYou', params: { name: a.from, group: a.group.name } });
      const added = a.group.members.filter((m) => !old.members.includes(m) && m !== a.from);
      const removed = old.members.filter((m) => !a.group.members.includes(m) && m !== a.from);
      if (added.length) next = sys(next, a.group.id, a.at, { key: 'sys.memberAdded', params: { name: a.from, names: added } });
      if (removed.length) next = sys(next, a.group.id, a.at, { key: 'sys.memberRemoved', params: { name: a.from, names: removed } });
      if (old.name !== a.group.name) next = sys(next, a.group.id, a.at, { key: 'sys.renamedBy', params: { name: a.from, group: a.group.name } });
      if (!added.length && !removed.length && old.name === a.group.name && a.group.epoch > old.epoch)
        next = sys(next, a.group.id, a.at, { key: 'sys.groupUpdated', params: { name: a.from } });
      return next;
    }

    case 'groupRemoved': {
      if (!s.groups.some((g) => g.id === a.gid)) return s;
      const next = { ...s, groups: s.groups.filter((g) => g.id !== a.gid), activeGroup: s.activeGroup === a.gid ? '' : s.activeGroup };
      const threads = { ...next.threads };
      delete threads[a.gid];
      return { ...next, threads };
    }

    case 'memberLeft': {
      const g = s.groups.find((x) => x.id === a.gid);
      if (!g || !g.members.includes(a.who)) return s;
      const next = { ...s, groups: s.groups.map((x) => (x.id === a.gid ? { ...x, members: x.members.filter((m) => m !== a.who) } : x)) };
      return sys(next, a.gid, a.at, { key: 'sys.left', params: { name: a.who } });
    }

    case 'leaveGroup': {
      if (!isGroupId(current)) return s;
      const groups = s.groups.filter((g) => g.id !== current);
      const threads = { ...s.threads };
      delete threads[current];
      return { ...s, groups, threads, activeGroup: groups[0]?.id ?? '' };
    }

    case 'addContact': {
      const c = a.contact;
      const convo = `d:${c.id}`;
      const next = { ...addContacts(s, [c], true), section: 'direct' as const, activeDirect: convo };
      return next.threads[convo]?.length ? next : sys(next, convo, a.at, { key: 'sys.contactAdded', params: { name: c.id } });
    }

    case 'ensureContacts':
      return addContacts(s, a.contacts, !!a.direct);

    case 'identityChanged': {
      const c = s.contacts[a.handle];
      if (!c) return s;
      const next = { ...s, contacts: { ...s.contacts, [a.handle]: { ...c, publicKey: a.publicKey, safety: a.safety, verified: false } } };
      return sys(next, `d:${a.handle}`, a.at, { key: 'sys.safetyChanged', params: { name: a.handle } });
    }

    case 'peerProfile': {
      const c = s.contacts[a.handle];
      if (!c) return s;
      return {
        ...s,
        contacts: { ...s.contacts, [a.handle]: { ...c, displayName: a.displayName.slice(0, 32), bio: a.bio.slice(0, 140), avatar: a.avatar, color: c.color } },
      };
    }

    case 'updateContact': {
      const c = s.contacts[a.id];
      if (!c) return s;
      return { ...s, contacts: { ...s.contacts, [a.id]: { ...c, nickname: a.nickname.trim(), color: a.color } } };
    }

    case 'deleteContact': {
      if (isGroupId(current) || !current) return s;
      const h = contactOf(current);
      const threads = { ...s.threads };
      delete threads[current];
      const directIds = s.directIds.filter((x) => x !== h);
      const inGroups = s.groups.some((g) => g.members.includes(h));
      const contacts = { ...s.contacts };
      if (!inGroups) delete contacts[h];
      return { ...s, contacts, threads, directIds, activeDirect: directIds[0] ? `d:${directIds[0]}` : '' };
    }

    case 'clearChat':
      return current ? sys({ ...s, threads: { ...s.threads, [current]: [] } }, current, a.at, { key: 'sys.cleared' }) : s;

    case 'deleteMessage': {
      const list = s.threads[a.convo];
      return list ? { ...s, threads: { ...s.threads, [a.convo]: list.filter((m) => m.id !== a.id) } } : s;
    }

    case 'decryptFailed':
      return s.contacts[a.handle] ? sys(s, `d:${a.handle}`, a.at, { key: 'sys.decryptFailed', params: { name: a.handle } }) : s;

    case 'updateProfile':
      return { ...s, profile: { ...a.profile, version: s.profile.version + 1 } };

    case 'crypto':
      return { ...s, crypto: a.crypto };
    case 'account':
      return { ...s, account: a.account };
  }
}
