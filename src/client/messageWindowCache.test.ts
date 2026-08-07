import assert from "node:assert/strict";
import test from "node:test";
import type { MessageDTO } from "../shared/types";
import {
  MESSAGE_WINDOW_CACHE_BYTES,
  MESSAGE_WINDOW_CACHE_KEY_LIMIT,
  MESSAGE_WINDOW_CACHE_MESSAGES,
  clearPersistedWindows,
  flushPendingPersists,
  lastMsgwinAccount,
  loadPersistedWindow,
  messageWindowStorageKey,
  persistWindowNow,
  persistWindowThrottled,
  rememberMsgwinAccount
} from "./messageWindowCache";

class MemoryStorage {
  readonly values = new Map<string, string>();
  failWrites = false;

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error("QuotaExceededError");
    this.values.set(key, String(value));
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

function message(id: number, content = `message-${id}`): MessageDTO {
  return { id, channelId: 1, type: "text", content } as MessageDTO;
}

function messages(range: number, start = 1) {
  return Array.from({ length: range }, (_, index) => message(start + index));
}

test("persistWindowNow + loadPersistedWindow round-trips a newest-anchored window", () => {
  const storage = new MemoryStorage();
  persistWindowNow(7, "1:chat", messages(5), true, storage);
  const loaded = loadPersistedWindow(7, "1:chat", storage);
  assert.equal(loaded?.messages.length, 5);
  assert.equal(loaded?.messages[0]?.id, 1);
  assert.equal(loaded?.hasOlder, true);
});

test("persistWindowNow drops pending negative-id messages and keeps only the newest page", () => {
  const storage = new MemoryStorage();
  const rows = [...messages(MESSAGE_WINDOW_CACHE_MESSAGES + 10), { id: -3, channelId: 1, type: "text", content: "pending" } as MessageDTO];
  persistWindowNow(7, "1:chat", rows, false, storage);
  const loaded = loadPersistedWindow(7, "1:chat", storage);
  assert.equal(loaded?.messages.length, MESSAGE_WINDOW_CACHE_MESSAGES);
  assert.equal(loaded?.messages[0]?.id, 11);
  assert.equal(loaded?.messages.some((row) => row.id < 0), false);
  assert.equal(loaded?.hasOlder, false);
});

test("persisted windows are evicted least-recently-used beyond the key limit", () => {
  const storage = new MemoryStorage();
  for (let channelId = 1; channelId <= MESSAGE_WINDOW_CACHE_KEY_LIMIT + 2; channelId += 1) {
    persistWindowNow(7, `${channelId}:chat`, messages(3), true, storage);
  }
  assert.equal(loadPersistedWindow(7, "1:chat", storage), null);
  assert.equal(loadPersistedWindow(7, "2:chat", storage), null);
  assert.equal(loadPersistedWindow(7, "3:chat", storage)?.messages.length, 3);
  assert.equal(loadPersistedWindow(7, `${MESSAGE_WINDOW_CACHE_KEY_LIMIT + 2}:chat`, storage)?.messages.length, 3);
});

test("touching a window refreshes its LRU position", () => {
  const storage = new MemoryStorage();
  for (let channelId = 1; channelId <= MESSAGE_WINDOW_CACHE_KEY_LIMIT; channelId += 1) {
    persistWindowNow(7, `${channelId}:chat`, messages(2), true, storage);
  }
  persistWindowNow(7, "1:chat", messages(2), true, storage);
  persistWindowNow(7, "99:chat", messages(2), true, storage);
  assert.equal(loadPersistedWindow(7, "1:chat", storage)?.messages.length, 2);
  assert.equal(loadPersistedWindow(7, "2:chat", storage), null);
});

test("oversized payloads evict older windows until the byte budget fits", () => {
  const storage = new MemoryStorage();
  const big = "x".repeat(Math.floor(MESSAGE_WINDOW_CACHE_BYTES / 2));
  persistWindowNow(7, "1:chat", [message(1, big)], true, storage);
  persistWindowNow(7, "2:chat", [message(2, big)], true, storage);
  persistWindowNow(7, "3:chat", [message(3, big)], true, storage);
  const raw = storage.getItem(messageWindowStorageKey(7)) || "";
  assert.equal(raw.length <= MESSAGE_WINDOW_CACHE_BYTES, true);
  assert.equal(loadPersistedWindow(7, "3:chat", storage)?.messages.length, 1);
  assert.equal(loadPersistedWindow(7, "1:chat", storage), null);
});

test("storage write failures are swallowed and windows stay readable", () => {
  const storage = new MemoryStorage();
  persistWindowNow(7, "1:chat", messages(3), true, storage);
  storage.failWrites = true;
  persistWindowNow(7, "2:chat", messages(3), true, storage);
  storage.failWrites = false;
  assert.equal(loadPersistedWindow(7, "1:chat", storage)?.messages.length, 3);
});

test("windows are isolated per account", () => {
  const storage = new MemoryStorage();
  persistWindowNow(7, "1:chat", messages(3), true, storage);
  persistWindowNow(8, "1:chat", messages(4), false, storage);
  assert.equal(loadPersistedWindow(7, "1:chat", storage)?.messages.length, 3);
  assert.equal(loadPersistedWindow(8, "1:chat", storage)?.messages.length, 4);
});

test("clearPersistedWindows removes only that account's cache", () => {
  const storage = new MemoryStorage();
  persistWindowNow(7, "1:chat", messages(3), true, storage);
  persistWindowNow(8, "1:chat", messages(3), true, storage);
  clearPersistedWindows(7, storage);
  assert.equal(loadPersistedWindow(7, "1:chat", storage), null);
  assert.equal(loadPersistedWindow(8, "1:chat", storage)?.messages.length, 3);
});

test("corrupted payloads normalize to an empty result instead of throwing", () => {
  const storage = new MemoryStorage();
  storage.setItem(messageWindowStorageKey(7), "{not json");
  assert.equal(loadPersistedWindow(7, "1:chat", storage), null);
  storage.setItem(messageWindowStorageKey(7), JSON.stringify({ windows: { "1:chat": { messages: [{ id: -1 }] } }, order: ["1:chat"] }));
  assert.equal(loadPersistedWindow(7, "1:chat", storage), null);
});

test("rememberMsgwinAccount and lastMsgwinAccount track the last account", () => {
  const storage = new MemoryStorage();
  assert.equal(lastMsgwinAccount(storage), 0);
  rememberMsgwinAccount(42, storage);
  assert.equal(lastMsgwinAccount(storage), 42);
  rememberMsgwinAccount(0, storage);
  assert.equal(lastMsgwinAccount(storage), 0);
});

test("throttled persists coalesce and flush writes the latest snapshot", () => {
  const storage = new MemoryStorage();
  persistWindowThrottled(7, "1:chat", messages(3), true, storage);
  persistWindowThrottled(7, "1:chat", messages(5), false, storage);
  assert.equal(loadPersistedWindow(7, "1:chat", storage), null);
  flushPendingPersists(storage);
  const loaded = loadPersistedWindow(7, "1:chat", storage);
  assert.equal(loaded?.messages.length, 5);
  assert.equal(loaded?.hasOlder, false);
  assert.equal(loadPersistedWindow(7, "1:chat", storage)?.messages.length, 5);
});

test("clearPersistedWindows also drops queued throttled writes for that account", () => {
  const storage = new MemoryStorage();
  persistWindowThrottled(7, "1:chat", messages(3), true, storage);
  persistWindowThrottled(8, "1:chat", messages(3), true, storage);
  clearPersistedWindows(7, storage);
  flushPendingPersists(storage);
  assert.equal(loadPersistedWindow(7, "1:chat", storage), null);
  assert.equal(loadPersistedWindow(8, "1:chat", storage)?.messages.length, 3);
});
