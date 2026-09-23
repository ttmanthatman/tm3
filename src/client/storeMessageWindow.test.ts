import assert from "node:assert/strict";
import test from "node:test";
import { createPinia, setActivePinia } from "pinia";
import type { AccountDTO, ChannelDTO, MessageDTO } from "../shared/types";
import { HANDWRITING_DEFAULT_PREFERENCES } from "../shared/handwriting";
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
    handwritingPreferences: HANDWRITING_DEFAULT_PREFERENCES,
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

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function jsonResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? "application/json" : null) },
    json: async () => data,
    text: async () => JSON.stringify(data)
  } as unknown as Response;
}

function jsonError(status: number, messageText: string): Response {
  return {
    ok: false,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? "application/json" : null) },
    json: async () => ({ success: false, message: messageText }),
    text: async () => JSON.stringify({ success: false, message: messageText })
  } as unknown as Response;
}

function channel(id: number): ChannelDTO {
  return {
    id,
    name: `Channel ${id}`,
    kind: "standard",
    description: "",
    icon: "",
    isPrivate: false,
    isDefault: id === 1,
    memberCount: 1,
    lastMessageId: 0
  } as ChannelDTO;
}

async function waitFor(predicate: () => boolean, label: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

type MessageGate = { url: string; gate: Deferred<Response> };

// Every /api/messages request parks on a controllable gate; members and read
// receipts resolve immediately so only the message window races are scripted.
function installFetchMock() {
  const gates: MessageGate[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/messages?")) {
      const gate = deferred<Response>();
      gates.push({ url, gate });
      return gate.promise;
    }
    if (url.includes("/members")) return jsonResponse({ members: [] });
    if (url.includes("/read")) return jsonResponse({ channelId: 1, lastReadMessageId: 0, unreadCount: 0 });
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  return { gates, restore: () => { globalThis.fetch = originalFetch; } };
}

function messageGates(gates: MessageGate[], channelId: number, prayers: boolean) {
  return gates.filter((entry) => entry.url.includes(`channelId=${channelId}`) && entry.url.includes("prayers=1") === prayers && (prayers || !entry.url.includes("grace=1")) && !entry.url.includes("before=") && !entry.url.includes("after="));
}

function graceMessageGates(gates: MessageGate[], channelId: number) {
  return gates.filter((entry) => entry.url.includes(`channelId=${channelId}`) && entry.url.includes("grace=1") && !entry.url.includes("before=") && !entry.url.includes("after="));
}

function pagedGates(gates: MessageGate[], channelId: number) {
  return gates.filter((entry) => entry.url.includes(`channelId=${channelId}`) && entry.url.includes("before="));
}

test("stale first-page load cannot overwrite a newer load of the same view", async () => {
  storage.clear();
  seedSession(1);
  const { gates, restore } = installFetchMock();
  try {
    const store = freshStore();
    store.channels = [channel(1)];
    store.currentChannelId = 1;

    const first = store.loadMessages();
    await waitFor(() => messageGates(gates, 1, false).length === 1, "first load request");
    const second = store.loadMessages();
    await waitFor(() => messageGates(gates, 1, false).length === 2, "second load request");

    // R2 starts later and returns first with the fresh page.
    messageGates(gates, 1, false)[1].gate.resolve(jsonResponse({ messages: [message(2)] }));
    await second;
    // R1 returns last with the stale page; it must not commit.
    messageGates(gates, 1, false)[0].gate.resolve(jsonResponse({ messages: [message(1)] }));
    await first;

    assert.deepEqual(store.messages.map((row) => row.id), [2]);
    assert.equal(store.loading, false);
    assert.equal(store.loadingInitialMessages, false);
    assert.equal(store.messageLoadError, "");
    assert.deepEqual(store.messageCache["1:chat"]?.messages.map((row) => row.id), [2]);
  } finally {
    restore();
  }
});

test("A→B→A: a stale success from the first visit cannot overwrite the returned-to view", async () => {
  storage.clear();
  seedSession(1);
  const { gates, restore } = installFetchMock();
  try {
    const store = freshStore();
    store.channels = [channel(1), channel(2)];
    store.currentChannelId = 1;

    const firstVisit = store.loadMessages();
    await waitFor(() => messageGates(gates, 1, false).length === 1, "first visit request");
    const toB = store.switchChannel(2);
    await waitFor(() => messageGates(gates, 2, false).length === 1, "channel B request");
    const backToA = store.switchChannel(1);
    await waitFor(() => messageGates(gates, 1, false).length === 2, "return visit request");

    // The return visit commits first with fresh data.
    messageGates(gates, 1, false)[1].gate.resolve(jsonResponse({ messages: [message(10)] }));
    await backToA;
    // B's load resolves after the user already left; no commit either way.
    messageGates(gates, 2, false)[0].gate.resolve(jsonResponse({ messages: [message(20, 2)] }));
    await toB;
    // The stale first-visit response passes the old channel/mode identity check.
    messageGates(gates, 1, false)[0].gate.resolve(jsonResponse({ messages: [message(1)] }));
    await firstVisit;

    assert.deepEqual(store.messages.map((row) => row.id), [10]);
    assert.equal(store.loading, false);
    assert.equal(store.loadingInitialMessages, false);
    assert.equal(store.messageLoadError, "");
    assert.deepEqual(store.messageCache["1:chat"]?.messages.map((row) => row.id), [10]);
  } finally {
    restore();
  }
});

test("A→B→A: a stale error and stale finally do not touch the current view", async () => {
  storage.clear();
  seedSession(1);
  const { gates, restore } = installFetchMock();
  try {
    const store = freshStore();
    store.channels = [channel(1), channel(2)];
    store.currentChannelId = 1;

    const firstVisit = store.loadMessages();
    await waitFor(() => messageGates(gates, 1, false).length === 1, "first visit request");
    const toB = store.switchChannel(2);
    await waitFor(() => messageGates(gates, 2, false).length === 1, "channel B request");
    const backToA = store.switchChannel(1);
    await waitFor(() => messageGates(gates, 1, false).length === 2, "return visit request");

    // The stale request fails while the return visit is still pending.
    messageGates(gates, 1, false)[0].gate.resolve(jsonError(500, "旧频道错误"));
    await firstVisit.catch(() => undefined);
    assert.equal(store.messageLoadError, "");
    assert.equal(store.loadingInitialMessages, true);
    assert.equal(store.loading, true);

    messageGates(gates, 1, false)[1].gate.resolve(jsonResponse({ messages: [message(10)] }));
    await backToA;
    messageGates(gates, 2, false)[0].gate.resolve(jsonResponse({ messages: [message(20, 2)] }));
    await toB;

    assert.deepEqual(store.messages.map((row) => row.id), [10]);
    assert.equal(store.messageLoadError, "");
    assert.equal(store.loadingInitialMessages, false);
    assert.equal(store.loading, false);
  } finally {
    restore();
  }
});

test("chat→prayer→chat: stale responses from earlier modes cannot commit", async () => {
  storage.clear();
  seedSession(1);
  const { gates, restore } = installFetchMock();
  try {
    const store = freshStore();
    store.channels = [channel(1)];
    store.currentChannelId = 1;

    const firstChat = store.loadMessages();
    await waitFor(() => messageGates(gates, 1, false).length === 1, "first chat request");
    const toPrayer = store.switchPrayerView(1);
    await waitFor(() => messageGates(gates, 1, true).length === 1, "prayer request");
    const backToChat = store.switchChatView();
    await waitFor(() => messageGates(gates, 1, false).length === 2, "return chat request");

    messageGates(gates, 1, false)[1].gate.resolve(jsonResponse({ messages: [message(30)] }));
    await backToChat;
    messageGates(gates, 1, true)[0].gate.resolve(jsonResponse({ messages: [{ ...message(31), type: "prayer" }] }));
    await toPrayer;
    messageGates(gates, 1, false)[0].gate.resolve(jsonResponse({ messages: [message(3)] }));
    await firstChat;

    assert.deepEqual(store.messages.map((row) => row.id), [30]);
    assert.equal(store.loadingInitialMessages, false);
    assert.equal(store.messageLoadError, "");
    assert.deepEqual(store.messageCache["1:chat"]?.messages.map((row) => row.id), [30]);
  } finally {
    restore();
  }
});

test("chat→grace→chat: the grace subchannel has its own request and cache window", async () => {
  storage.clear();
  seedSession(1);
  const { gates, restore } = installFetchMock();
  try {
    const store = freshStore();
    store.channels = [channel(1)];
    store.currentChannelId = 1;

    const firstChat = store.loadMessages();
    await waitFor(() => messageGates(gates, 1, false).length === 1, "first chat request");
    const toGrace = store.switchGraceView(1);
    await waitFor(() => graceMessageGates(gates, 1).length === 1, "grace request");
    graceMessageGates(gates, 1)[0].gate.resolve(jsonResponse({ messages: [{ ...message(41), type: "grace" }] }));
    await toGrace;
    const backToChat = store.switchChatView();
    await waitFor(() => messageGates(gates, 1, false).length === 2, "return chat request");

    messageGates(gates, 1, false)[1].gate.resolve(jsonResponse({ messages: [message(40)] }));
    await backToChat;
    messageGates(gates, 1, false)[0].gate.resolve(jsonResponse({ messages: [message(4)] }));
    await firstChat;

    assert.deepEqual(store.messages.map((row) => row.id), [40]);
    assert.deepEqual(store.messageCache["1:chat"]?.messages.map((row) => row.id), [40]);
    assert.deepEqual(store.messageCache["1:grace"]?.messages.map((row) => row.id), [41]);
  } finally {
    restore();
  }
});

test("A→B→A: a stale prefetch cannot commit rows or the newer prefetch's state", async () => {
  storage.clear();
  seedSession(1);
  const { gates, restore } = installFetchMock();
  try {
    const store = freshStore();
    store.channels = [channel(1), channel(2)];
    store.currentChannelId = 1;
    store.messages = [message(100)];
    store.hasOlderMessages = true;

    const firstPrefetch = store.prefetchOlderMessages();
    await waitFor(() => pagedGates(gates, 1).length === 1, "first prefetch request");
    const toB = store.switchChannel(2);
    await waitFor(() => messageGates(gates, 2, false).length === 1, "channel B request");
    const backToA = store.switchChannel(1);
    await waitFor(() => messageGates(gates, 1, false).length === 1, "return visit request");
    messageGates(gates, 1, false)[0].gate.resolve(jsonResponse({ messages: [message(100)] }));
    await backToA;
    messageGates(gates, 2, false)[0].gate.resolve(jsonResponse({ messages: [message(50, 2)] }));
    await toB;

    // The user scrolls again after returning: a second prefetch for the same view.
    store.hasOlderMessages = true;
    const secondPrefetch = store.prefetchOlderMessages();
    await waitFor(() => pagedGates(gates, 1).length === 2, "second prefetch request");

    pagedGates(gates, 1)[1].gate.resolve(jsonResponse({ messages: [message(90)] }));
    await secondPrefetch;
    assert.deepEqual(store.prefetchedOlderMessages.map((row) => row.id), [90]);
    pagedGates(gates, 1)[0].gate.resolve(jsonResponse({ messages: [message(80)] }));
    await firstPrefetch;

    assert.deepEqual(store.prefetchedOlderMessages.map((row) => row.id), [90]);
    assert.equal(store.prefetchingOlderMessages, false);
    assert.deepEqual(store.messageCache["1:chat"]?.prefetchedOlder.map((row) => row.id), [90]);
  } finally {
    restore();
  }
});

test("a request in flight during logout cannot commit into the next session", async () => {
  storage.clear();
  seedSession(1);
  const { gates, restore } = installFetchMock();
  try {
    const store = freshStore();
    store.channels = [channel(1)];
    store.currentChannelId = 1;
    store.account = account(7);

    const pending = store.loadMessages();
    await waitFor(() => messageGates(gates, 1, false).length === 1, "pending load request");
    await store.logout(false);
    messageGates(gates, 1, false)[0].gate.resolve(jsonResponse({ messages: [message(1)] }));
    await pending;

    assert.deepEqual(store.messages, []);
    assert.equal(store.loading, false);
    assert.equal(store.loadingInitialMessages, false);
    assert.equal(store.messageLoadError, "");
    assert.deepEqual(store.messageCache, {});
  } finally {
    restore();
  }
});

test("initial load commit honors socket removals and updates received in flight", async () => {
  storage.clear();
  seedSession(1);
  const { gates, restore } = installFetchMock();
  try {
    const store = freshStore();
    store.channels = [channel(1)];
    store.currentChannelId = 1;
    store.messages = [message(1), message(2)];

    const pending = store.loadMessages();
    await waitFor(() => messageGates(gates, 1, false).length === 1, "pending load request");
    store.removeMessage(1);
    store.replaceMessage({ ...message(2), content: "edited" });
    store.appendLocalMessage(message(3));
    // The HTTP snapshot still carries the retracted message and the old text.
    messageGates(gates, 1, false)[0].gate.resolve(jsonResponse({ messages: [message(1), message(2)] }));
    await pending;

    assert.deepEqual(store.messages.map((row) => row.id), [2, 3]);
    assert.equal(store.messages[0].content, "edited");
    assert.deepEqual(store.messageCache["1:chat"]?.messages.map((row) => row.id), [2, 3]);
  } finally {
    restore();
  }
});

test("loadOlderMessages re-arms the prefetch chain after committing a page", async () => {
  storage.clear();
  seedSession(1);
  const { gates, restore } = installFetchMock();
  try {
    const store = freshStore();
    store.channels = [channel(1)];
    store.currentChannelId = 1;
    store.messages = [message(1000)];
    store.hasOlderMessages = true;

    const loadOlder = store.loadOlderMessages();
    await waitFor(() => pagedGates(gates, 1).length === 1, "user pagination request");
    // A full page keeps hasOlderMessages true so the chain should continue.
    const fullPage = Array.from({ length: 80 }, (_, index) => message(841 + index));
    pagedGates(gates, 1)[0].gate.resolve(jsonResponse({ messages: fullPage }));
    assert.equal(await loadOlder, true);
    assert.equal(store.loadingOlderMessages, false);
    assert.equal(store.hasOlderMessages, true);

    // Completing the page immediately prefetches the next one anchored at the
    // new window head instead of waiting for the next user scroll.
    await waitFor(() => pagedGates(gates, 1).length === 2, "chained prefetch request");
    assert.equal(store.prefetchingOlderMessages, true);
    assert.ok(pagedGates(gates, 1)[1].url.includes(`before=${fullPage[0].id}`));

    pagedGates(gates, 1)[1].gate.resolve(jsonResponse({ messages: [message(800)] }));
    await waitFor(() => !store.prefetchingOlderMessages, "prefetch completion");
    assert.deepEqual(store.prefetchedOlderMessages.map((row) => row.id), [800]);
  } finally {
    restore();
  }
});

test("user pagination interleaved with an in-flight prefetch drops the stale-anchored prefetch", async () => {
  storage.clear();
  seedSession(1);
  const { gates, restore } = installFetchMock();
  try {
    const store = freshStore();
    store.channels = [channel(1)];
    store.currentChannelId = 1;
    store.messages = [message(100)];
    store.hasOlderMessages = true;

    const prefetch = store.prefetchOlderMessages();
    await waitFor(() => pagedGates(gates, 1).length === 1, "prefetch request");
    const loadOlder = store.loadOlderMessages();
    await waitFor(() => pagedGates(gates, 1).length === 2, "user pagination request");

    pagedGates(gates, 1)[1].gate.resolve(jsonResponse({ messages: [message(90)] }));
    assert.equal(await loadOlder, true);
    assert.deepEqual(store.messages.map((row) => row.id), [90, 100]);
    // The prefetch anchored at the old window head resolves late; its rows
    // would interleave incorrectly with the committed page and are dropped.
    pagedGates(gates, 1)[0].gate.resolve(jsonResponse({ messages: [message(95)] }));
    await prefetch;

    assert.deepEqual(store.prefetchedOlderMessages, []);
    assert.equal(store.prefetchingOlderMessages, false);
    assert.equal(store.loadingOlderMessages, false);
    assert.equal(store.hasOlderMessages, false);
    assert.equal(store.oldestMessageReached, true);
    assert.deepEqual(store.messageCache["1:chat"]?.messages.map((row) => row.id), [90, 100]);
  } finally {
    restore();
  }
});
