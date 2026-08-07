import assert from "node:assert/strict";
import test from "node:test";
import { createPinia, setActivePinia } from "pinia";
import type { AccountDTO, MessageDTO } from "../shared/types";
import { flushPendingPersists, messageWindowStorageKey, persistWindowNow } from "./messageWindowCache";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });

const { useChatStore } = await import("./store");

function account(id: number): AccountDTO {
  return {
    id,
    username: `user-${id}`,
    displayName: `User ${id}`,
    avatarPath: null,
    isAdmin: false,
    canPinMessages: false,
    actorId: id,
    theme: "default",
    biblePreferences: { outputFormat: "referenceVerseLines", referenceLabelMode: "normalizedFull", combinedPassageMode: "compactEllipsis", quotationStyle: "fullWidth" }
  };
}

function message(id: number, channelId = 1): MessageDTO {
  return { id, channelId, type: "text", content: `message-${id}` } as MessageDTO;
}

function seedSession(channelId = 1) {
  storage.setItem("team-chat-token", "token-1");
  storage.setItem("team-chat-current-channel", String(channelId));
  storage.setItem("team-chat-message-view", "chat");
}

function freshStore() {
  setActivePinia(createPinia());
  return useChatStore();
}

test("store hydrates the persisted newest window synchronously at creation", () => {
  seedSession(1);
  persistWindowNow(7, "1:chat", [message(1), message(2), message(3)], true, storage);
  storage.setItem("team-chat-msgwin-account", "7");
  const store = freshStore();
  assert.deepEqual(store.messages.map((row) => row.id), [1, 2, 3]);
  assert.equal(store.hasOlderMessages, true);
  assert.equal(store.hasNewerMessages, false);
  assert.equal(store.hydratedPersistedAccountId, 7);
});

test("store does not hydrate without a token or without a persisted window", () => {
  storage.clear();
  storage.setItem("team-chat-msgwin-account", "7");
  persistWindowNow(7, "1:chat", [message(1)], true, storage);
  let store = freshStore();
  assert.equal(store.messages.length, 0);
  assert.equal(store.hydratedPersistedAccountId, 0);

  storage.clear();
  seedSession(1);
  storage.setItem("team-chat-msgwin-account", "7");
  store = freshStore();
  assert.equal(store.messages.length, 0);
});

test("store ignores persisted windows of another account", () => {
  storage.clear();
  seedSession(1);
  persistWindowNow(8, "1:chat", [message(1), message(2)], true, storage);
  storage.setItem("team-chat-msgwin-account", "7");
  const store = freshStore();
  assert.equal(store.messages.length, 0);
});

test("restoreCachedMessages skips windows parked mid-history", () => {
  storage.clear();
  seedSession(1);
  const store = freshStore();
  store.currentChannelId = 1;
  store.messages = [message(10)];
  store.hasOlderMessages = true;
  store.hasNewerMessages = true;
  store.cacheCurrentMessages();

  store.messages = [];
  store.hasOlderMessages = false;
  store.hasNewerMessages = false;
  store.restoreCachedMessages(1, false);
  assert.equal(store.messages.length, 0);

  store.messages = [message(20)];
  store.hasOlderMessages = true;
  store.hasNewerMessages = false;
  store.cacheCurrentMessages();
  store.messages = [];
  store.restoreCachedMessages(1, false);
  assert.deepEqual(store.messages.map((row) => row.id), [20]);
});

test("cacheCurrentMessages persists newest-anchored windows for the signed-in account", () => {
  storage.clear();
  seedSession(1);
  const store = freshStore();
  store.currentChannelId = 1;
  store.account = account(7);
  store.messages = [message(1), message(2)];
  store.hasNewerMessages = false;
  store.cacheCurrentMessages();
  flushPendingPersists(storage);
  const raw = JSON.parse(storage.getItem(messageWindowStorageKey(7)) || "null");
  assert.deepEqual(raw.windows["1:chat"].messages.map((row: MessageDTO) => row.id), [1, 2]);

  store.messages = [message(3)];
  store.hasNewerMessages = true;
  store.cacheCurrentMessages();
  flushPendingPersists(storage);
  const after = JSON.parse(storage.getItem(messageWindowStorageKey(7)) || "null");
  assert.deepEqual(after.windows["1:chat"].messages.map((row: MessageDTO) => row.id), [1, 2]);
});
