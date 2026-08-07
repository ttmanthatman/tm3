import type { MessageDTO } from "@shared/types";

export const MESSAGE_WINDOW_CACHE_KEY_LIMIT = 8;
export const MESSAGE_WINDOW_CACHE_MESSAGES = 80;
export const MESSAGE_WINDOW_CACHE_BYTES = 2_000_000;
const MESSAGE_WINDOW_PERSIST_THROTTLE_MS = 1000;
const LAST_ACCOUNT_KEY = "team-chat-msgwin-account";

export type PersistedMessageWindow = {
  messages: MessageDTO[];
  hasOlder: boolean;
  savedAt: number;
};

type PersistedMessageStore = {
  windows: Record<string, PersistedMessageWindow>;
  order: string[];
};

type MessageWindowStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function messageWindowStorageKey(accountId: number) {
  return `team-chat-msgwin-${accountId}`;
}

export function lastMsgwinAccount(storage: MessageWindowStorage = localStorage) {
  const value = Math.floor(Number(storage.getItem(LAST_ACCOUNT_KEY) || 0));
  return Number.isInteger(value) && value > 0 ? value : 0;
}

export function rememberMsgwinAccount(accountId: number, storage: MessageWindowStorage = localStorage) {
  if (accountId > 0) storage.setItem(LAST_ACCOUNT_KEY, String(accountId));
  else storage.removeItem(LAST_ACCOUNT_KEY);
}

function normalizePersistedWindow(value: unknown): PersistedMessageWindow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Partial<PersistedMessageWindow>;
  if (!Array.isArray(raw.messages)) return null;
  const messages = raw.messages.filter(
    (message): message is MessageDTO =>
      !!message && typeof message === "object" && Number.isInteger((message as MessageDTO).id) && (message as MessageDTO).id > 0 && typeof (message as MessageDTO).content === "string"
  );
  if (!messages.length) return null;
  return { messages, hasOlder: raw.hasOlder !== false, savedAt: Number(raw.savedAt) || 0 };
}

function normalizePersistedStore(value: unknown): PersistedMessageStore {
  const store: PersistedMessageStore = { windows: {}, order: [] };
  if (!value || typeof value !== "object" || Array.isArray(value)) return store;
  const raw = value as Partial<PersistedMessageStore>;
  if (raw.windows && typeof raw.windows === "object" && !Array.isArray(raw.windows)) {
    for (const [key, windowValue] of Object.entries(raw.windows)) {
      const normalized = normalizePersistedWindow(windowValue);
      if (normalized) store.windows[key] = normalized;
    }
  }
  const order = Array.isArray(raw.order) ? raw.order.filter((key): key is string => typeof key === "string" && key in store.windows) : [];
  store.order = [...order, ...Object.keys(store.windows).filter((key) => !order.includes(key))].slice(0, MESSAGE_WINDOW_CACHE_KEY_LIMIT);
  for (const key of Object.keys(store.windows)) {
    if (!store.order.includes(key)) delete store.windows[key];
  }
  return store;
}

function readStore(accountId: number, storage: MessageWindowStorage): PersistedMessageStore {
  try {
    return normalizePersistedStore(JSON.parse(storage.getItem(messageWindowStorageKey(accountId)) || "null"));
  } catch {
    return { windows: {}, order: [] };
  }
}

function evictOldest(store: PersistedMessageStore) {
  const stale = store.order.pop();
  if (stale) delete store.windows[stale];
}

function writeStore(accountId: number, store: PersistedMessageStore, storage: MessageWindowStorage) {
  let json = JSON.stringify(store);
  while (json.length > MESSAGE_WINDOW_CACHE_BYTES && store.order.length > 1) {
    evictOldest(store);
    json = JSON.stringify(store);
  }
  try {
    storage.setItem(messageWindowStorageKey(accountId), json);
  } catch {
    // Quota exceeded: drop half of the cached windows and retry once.
    const keep = Math.max(1, Math.ceil(store.order.length / 2));
    while (store.order.length > keep) evictOldest(store);
    try {
      storage.setItem(messageWindowStorageKey(accountId), JSON.stringify(store));
    } catch {
      // Persistence is best-effort; ignore storage failures.
    }
  }
}

export function loadPersistedWindow(accountId: number, cacheKey: string, storage: MessageWindowStorage = localStorage): PersistedMessageWindow | null {
  if (!accountId || !cacheKey) return null;
  return readStore(accountId, storage).windows[cacheKey] || null;
}

export function persistWindowNow(accountId: number, cacheKey: string, messages: MessageDTO[], hasOlder: boolean, storage: MessageWindowStorage = localStorage) {
  if (!accountId || !cacheKey) return;
  const persistable = messages.filter((message) => message.id > 0).slice(-MESSAGE_WINDOW_CACHE_MESSAGES);
  const store = readStore(accountId, storage);
  if (!persistable.length) {
    if (store.windows[cacheKey]) {
      delete store.windows[cacheKey];
      store.order = store.order.filter((key) => key !== cacheKey);
      writeStore(accountId, store, storage);
    }
    return;
  }
  store.windows[cacheKey] = { messages: persistable, hasOlder, savedAt: Date.now() };
  store.order = [cacheKey, ...store.order.filter((key) => key !== cacheKey)].slice(0, MESSAGE_WINDOW_CACHE_KEY_LIMIT);
  for (const key of Object.keys(store.windows)) {
    if (!store.order.includes(key)) delete store.windows[key];
  }
  writeStore(accountId, store, storage);
}

type PendingPersist = { messages: MessageDTO[]; hasOlder: boolean; timer: ReturnType<typeof setTimeout> | null };
const pendingPersists = new Map<string, PendingPersist>();

function pendingKey(accountId: number, cacheKey: string) {
  return `${accountId}::${cacheKey}`;
}

export function persistWindowThrottled(accountId: number, cacheKey: string, messages: MessageDTO[], hasOlder: boolean, storage: MessageWindowStorage = localStorage) {
  if (!accountId || !cacheKey) return;
  const key = pendingKey(accountId, cacheKey);
  const existing = pendingPersists.get(key);
  if (existing) {
    existing.messages = messages;
    existing.hasOlder = hasOlder;
    return;
  }
  const pending: PendingPersist = { messages, hasOlder, timer: null };
  pending.timer = setTimeout(() => {
    pendingPersists.delete(key);
    persistWindowNow(accountId, cacheKey, pending.messages, pending.hasOlder, storage);
  }, MESSAGE_WINDOW_PERSIST_THROTTLE_MS);
  if (typeof pending.timer === "object" && pending.timer && "unref" in pending.timer) pending.timer.unref();
  pendingPersists.set(key, pending);
}

export function flushPendingPersists(storage: MessageWindowStorage = localStorage) {
  for (const [key, pending] of pendingPersists) {
    if (pending.timer) clearTimeout(pending.timer);
    const [accountIdRaw, cacheKey] = key.split("::");
    persistWindowNow(Number(accountIdRaw), cacheKey, pending.messages, pending.hasOlder, storage);
  }
  pendingPersists.clear();
}

export function clearPersistedWindows(accountId: number, storage: MessageWindowStorage = localStorage) {
  if (!accountId) return;
  for (const key of [...pendingPersists.keys()]) {
    if (key.startsWith(`${accountId}::`)) {
      const pending = pendingPersists.get(key);
      if (pending?.timer) clearTimeout(pending.timer);
      pendingPersists.delete(key);
    }
  }
  storage.removeItem(messageWindowStorageKey(accountId));
}
