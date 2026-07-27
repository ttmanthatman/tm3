import type { AccountDTO, ActorDTO } from "@shared/types";

export const UNREAD_COUNT_CAP = 99;

export type UnreadState = {
  lastRead: Record<number, number>;
  counts: Record<number, number>;
};

export type ChannelSeedPlan = { action: "treat-as-read"; lastMessageId: number } | { action: "recount"; after: number } | { action: "none" };

type UnreadStorage = Pick<Storage, "getItem" | "setItem">;

export function unreadStorageKey(accountId: number) {
  return `team-chat-unread-${accountId}`;
}

export function emptyUnreadState(): UnreadState {
  return { lastRead: {}, counts: {} };
}

function normalizeIdMap(value: unknown, cap = 0): Record<number, number> {
  const result: Record<number, number> = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  for (const [key, raw] of Object.entries(value)) {
    const channelId = Number(key);
    const messageId = Math.floor(Number(raw));
    if (!Number.isInteger(channelId) || channelId <= 0) continue;
    if (!Number.isFinite(messageId) || messageId < 0) continue;
    result[channelId] = cap > 0 ? Math.min(messageId, cap) : messageId;
  }
  return result;
}

export function normalizeUnreadState(value: unknown): UnreadState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyUnreadState();
  const raw = value as Partial<UnreadState>;
  return {
    lastRead: normalizeIdMap(raw.lastRead),
    counts: normalizeIdMap(raw.counts, UNREAD_COUNT_CAP)
  };
}

export function loadUnreadState(accountId: number, storage: UnreadStorage = localStorage): UnreadState {
  try {
    return normalizeUnreadState(JSON.parse(storage.getItem(unreadStorageKey(accountId)) || "null"));
  } catch {
    return emptyUnreadState();
  }
}

export function saveUnreadState(accountId: number, state: UnreadState, storage: UnreadStorage = localStorage) {
  storage.setItem(unreadStorageKey(accountId), JSON.stringify(state));
}

export function formatUnreadCount(count: number) {
  const value = Math.max(0, Math.floor(Number(count) || 0));
  return value >= UNREAD_COUNT_CAP ? `${UNREAD_COUNT_CAP}+` : String(value);
}

export function isOwnMessage(sender: Pick<ActorDTO, "id" | "username"> | null | undefined, account: Pick<AccountDTO, "actorId" | "username"> | null | undefined) {
  if (!sender || !account) return false;
  return sender.id === account.actorId || (!!sender.username && sender.username === account.username);
}

export function noteUnreadIncoming(state: UnreadState, input: { channelId: number; messageId: number; own: boolean; current: boolean; chatCapable: boolean }) {
  if (!input.chatCapable) return state;
  if (input.own || input.current) {
    if (input.messageId > (state.lastRead[input.channelId] ?? 0)) state.lastRead[input.channelId] = input.messageId;
    state.counts[input.channelId] = 0;
    return state;
  }
  state.counts[input.channelId] = Math.min((state.counts[input.channelId] ?? 0) + 1, UNREAD_COUNT_CAP);
  return state;
}

export function recordChannelRead(state: UnreadState, channelId: number, lastMessageId: number) {
  state.counts[channelId] = 0;
  if (lastMessageId > (state.lastRead[channelId] ?? 0)) state.lastRead[channelId] = lastMessageId;
  return state;
}

export function planChannelSeed(lastRead: number | undefined, lastMessageId: number | null | undefined): ChannelSeedPlan {
  const newest = lastMessageId ?? 0;
  if (newest <= 0) return { action: "none" };
  if (lastRead === undefined) return { action: "treat-as-read", lastMessageId: newest };
  if (newest <= lastRead) return { action: "none" };
  return { action: "recount", after: lastRead };
}
