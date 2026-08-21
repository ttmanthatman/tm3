import assert from "node:assert/strict";
import test from "node:test";
import { createPinia, setActivePinia } from "pinia";
import type { AccountDTO, ChannelDTO } from "../shared/types";

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

function jsonResponse(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? "application/json" : null) },
    json: async () => data,
    text: async () => JSON.stringify(data)
  } as unknown as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function jsonError(status: number, message: string): Response {
  return {
    ok: false,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? "application/json" : null) },
    json: async () => ({ success: false, message }),
    text: async () => JSON.stringify({ success: false, message })
  } as unknown as Response;
}

test("bootstrap resolves after the identity phase while channel data loads in the background", async () => {
  storage.clear();
  storage.setItem("team-chat-token", "token-1");
  storage.setItem("team-chat-current-channel", "1");
  storage.setItem("team-chat-message-view", "chat");

  const channelsGate = deferred<Response>();
  let initialMessageRequests = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/settings/appearance")) return jsonResponse({});
    if (url.includes("/api/auth/me")) return jsonResponse({ account: account(7) });
    if (url.includes("/api/like-notifications")) return jsonResponse({ notifications: [] });
    if (url.includes("/api/channels/1/members")) return jsonResponse({ members: [] });
    if (url.includes("/api/channels")) return channelsGate.promise;
    if (url.includes("/api/messages")) {
      if (!url.includes("after=") && !url.includes("before=")) initialMessageRequests += 1;
      return jsonResponse({ messages: [] });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;

  setActivePinia(createPinia());
  const store = useChatStore();
  store.connectSocket = (() => undefined) as unknown as typeof store.connectSocket;

  await store.bootstrap();
  // Identity is ready and the shell can render, but the channel list request
  // is still in flight: bootstrap must not wait for it.
  assert.equal(store.account?.id, 7);
  assert.equal(store.channels.length, 0);
  // The first message page started in parallel with the identity request.
  assert.equal(initialMessageRequests, 1);

  const channel = {
    id: 1,
    name: "General",
    kind: "standard",
    description: "",
    icon: "",
    isPrivate: false,
    isDefault: true,
    memberCount: 1,
    lastMessageId: 0
  } as ChannelDTO;
  channelsGate.resolve(jsonResponse({ channels: [channel] }));
  await store.whenChannelsReady();
  assert.deepEqual(store.channels.map((row) => row.id), [1]);
  assert.equal(store.currentChannelId, 1);
  assert.equal(store.loadingInitialMessages, false);
  // loadChannels reused the in-flight page instead of requesting it again.
  assert.equal(initialMessageRequests, 1);
});

test("concurrent channel refreshes share one weak-network request", async () => {
  storage.clear();
  storage.setItem("team-chat-token", "token-1");
  storage.setItem("team-chat-current-channel", "1");
  const channelsGate = deferred<Response>();
  let channelRequests = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/channels/1/members")) return jsonResponse({ members: [] });
    if (url.includes("/api/channels")) {
      channelRequests += 1;
      return channelsGate.promise;
    }
    if (url.includes("/api/messages")) return jsonResponse({ messages: [] });
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;

  setActivePinia(createPinia());
  const store = useChatStore();
  store.currentChannelId = 1;
  const refreshes = [store.loadChannels(), store.loadChannels(), store.loadChannels()];
  await Promise.resolve();
  const observedChannelRequests = channelRequests;

  channelsGate.resolve(jsonResponse({
    channels: [{ id: 1, name: "General", kind: "standard", description: "", icon: "", isPrivate: false, isDefault: true, memberCount: 1, lastMessageId: 0 }]
  }));
  await Promise.all(refreshes);
  assert.equal(observedChannelRequests, 1);
});

test("re-login after a failed bootstrap fetches messages instead of reusing the stale early request", async () => {
  storage.clear();
  storage.setItem("team-chat-token", "expired-token");
  storage.setItem("team-chat-current-channel", "1");
  storage.setItem("team-chat-message-view", "chat");

  let initialMessageRequests = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/settings/appearance")) return jsonResponse({});
    if (url.includes("/api/messages")) {
      initialMessageRequests += 1;
      if (!getTokenOk()) return jsonError(401, "认证失败");
      return jsonResponse({ messages: [] });
    }
    if (url.includes("/api/auth/me")) return jsonError(401, "认证失败");
    if (url.includes("/api/like-notifications")) return jsonResponse({ notifications: [] });
    if (url.includes("/api/channels/1/members")) return jsonResponse({ members: [] });
    if (url.includes("/api/channels")) {
      return jsonResponse({ channels: [{ id: 1, name: "General", kind: "standard", description: "", icon: "", isPrivate: false, isDefault: true, memberCount: 1, lastMessageId: 0 }] });
    }
    if (url.includes("/api/auth/logout")) return jsonResponse({});
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;

  let tokenOk = false;
  function getTokenOk() {
    return tokenOk;
  }

  setActivePinia(createPinia());
  const store = useChatStore();
  store.connectSocket = (() => undefined) as unknown as typeof store.connectSocket;

  await store.bootstrap();
  // The expired token dropped the session: one failed early message request.
  assert.equal(store.account, null);
  assert.equal(initialMessageRequests, 1);

  tokenOk = true;
  await store.afterLogin(account(7));
  // The stale early request must not be reused: a fresh page was fetched.
  assert.equal(initialMessageRequests, 2);
  assert.equal(store.currentChannelId, 1);
});

test("whenChannelsReady resolves immediately when no bootstrap ran", async () => {
  setActivePinia(createPinia());
  const store = useChatStore();
  await store.whenChannelsReady();
});


test("seedUnreadCounts batches per-channel recounts into one grouped request", async () => {
  storage.clear();
  storage.setItem("team-chat-token", "token-1");
  storage.setItem("team-chat-current-channel", "1");
  storage.setItem("team-chat-message-view", "chat");
  storage.setItem("team-chat-unread-7", JSON.stringify({ lastRead: { "1": 10, "2": 5 }, counts: {} }));

  const channel = (id: number, lastMessageId: number) => ({
    id,
    name: `Channel ${id}`,
    kind: "standard",
    description: "",
    icon: "",
    isPrivate: false,
    isDefault: id === 1,
    memberCount: 1,
    lastMessageId
  }) as ChannelDTO;
  const unreadRequests: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/settings/appearance")) return jsonResponse({});
    if (url.includes("/api/auth/me")) return jsonResponse({ account: account(7) });
    if (url.includes("/api/like-notifications")) return jsonResponse({ notifications: [] });
    if (url.includes("/api/channels/1/members")) return jsonResponse({ members: [] });
    if (url.includes("/api/channels")) return jsonResponse({ channels: [channel(1, 42), channel(2, 20), channel(3, 7)] });
    if (url.includes("/api/messages/unread-counts")) {
      unreadRequests.push(url);
      return jsonResponse({ counts: { "1": 3, "2": 150 } });
    }
    if (url.includes("/api/messages")) return jsonResponse({ messages: [] });
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;

  setActivePinia(createPinia());
  const store = useChatStore();
  store.connectSocket = (() => undefined) as unknown as typeof store.connectSocket;

  await store.bootstrap();
  await store.whenChannelsReady();
  // seedUnreadCounts runs detached after the channel data; give it a tick.
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(unreadRequests.length, 1);
  const sent = JSON.parse(new URL(unreadRequests[0], "http://localhost").searchParams.get("lastRead") || "{}");
  assert.deepEqual(sent, { "1": 10, "2": 5 });
  assert.equal(store.unreadCounts[1], 3);
  assert.equal(store.unreadCounts[2], 99); // capped at UNREAD_COUNT_CAP
  assert.equal(store.unreadCounts[3], 0); // first-seen channel treated as read locally
});
