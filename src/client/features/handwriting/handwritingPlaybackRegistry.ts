import { parseStoredHandwritingPayload } from "@shared/handwriting";
import type { MessageDTO } from "@shared/types";

export const HANDWRITING_PLAYBACK_QUEUE_LIMIT = 20;
export const HANDWRITING_PLAYBACK_TTL_MS = 5000;
const SEEN_ID_LIMIT = 200;

type PlaybackEntry = {
  key: string;
  accountId: number;
  channelId: number;
  messageId: number;
  senderActorId: number;
  expiresAt: number;
};

type SeenState = { watermark: number; ids: Set<number>; order: number[] };

function entryKey(accountId: number, channelId: number, messageId: number) {
  return `${accountId}:${channelId}:${messageId}`;
}

function seenKey(accountId: number, channelId: number) {
  return `${accountId}:${channelId}`;
}

export function createHandwritingPlaybackRegistry(options: { now?: () => number } = {}) {
  const queue = new Map<string, PlaybackEntry>();
  const seen = new Map<string, SeenState>();
  const now = () => options.now?.() ?? Date.now();

  function pruneExpired() {
    const current = now();
    for (const [key, entry] of queue) {
      if (entry.expiresAt <= current) queue.delete(key);
    }
  }

  function noteSeen(accountId: number, channelId: number, messageId: number) {
    const key = seenKey(accountId, channelId);
    const state = seen.get(key) || { watermark: 0, ids: new Set<number>(), order: [] };
    if (state.ids.has(messageId) || messageId <= state.watermark) return false;
    state.watermark = Math.max(state.watermark, messageId);
    state.ids.add(messageId);
    state.order.push(messageId);
    while (state.order.length > SEEN_ID_LIMIT) {
      const stale = state.order.shift();
      if (stale !== undefined) state.ids.delete(stale);
    }
    seen.set(key, state);
    return true;
  }

  function receive(message: MessageDTO, accountId: number, ownActorId: number | null | undefined) {
    pruneExpired();
    if (!accountId || message.type !== "handwriting" || message.sender.id === ownActorId) return false;
    if (!parseStoredHandwritingPayload(message.payload)) return false;
    if (!noteSeen(accountId, message.channelId, message.id)) return false;
    if (queue.size >= HANDWRITING_PLAYBACK_QUEUE_LIMIT) return false;
    const key = entryKey(accountId, message.channelId, message.id);
    queue.set(key, {
      key,
      accountId,
      channelId: message.channelId,
      messageId: message.id,
      senderActorId: message.sender.id,
      expiresAt: now() + HANDWRITING_PLAYBACK_TTL_MS
    });
    return true;
  }

  function claim(input: {
    accountId: number;
    channelId: number;
    messageId: number;
    currentChannelId: number;
    visible: boolean;
    documentVisible: boolean;
    reducedMotion: boolean;
  }) {
    pruneExpired();
    const key = entryKey(input.accountId, input.channelId, input.messageId);
    const entry = queue.get(key);
    if (!entry) return false;
    if (input.reducedMotion) {
      queue.delete(key);
      return false;
    }
    if (input.currentChannelId !== input.channelId || !input.visible || !input.documentVisible) return false;
    queue.delete(key);
    return true;
  }

  function discard(accountId: number, channelId: number, messageId: number) {
    queue.delete(entryKey(accountId, channelId, messageId));
  }

  function clearAccount(accountId: number) {
    for (const [key, entry] of queue) if (entry.accountId === accountId) queue.delete(key);
    for (const key of seen.keys()) if (key.startsWith(`${accountId}:`)) seen.delete(key);
  }

  function reset() {
    queue.clear();
    seen.clear();
  }

  return { receive, claim, discard, clearAccount, reset, get size() { pruneExpired(); return queue.size; } };
}

export const handwritingPlaybackRegistry = createHandwritingPlaybackRegistry();
