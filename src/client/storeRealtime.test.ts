import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createPinia, setActivePinia } from "pinia";
import { Server as SocketIOServer } from "socket.io";
import { toRaw } from "vue";
import type { ChannelDTO, MessageDTO, PinnedDTO } from "../shared/types";

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

function message(id: number): MessageDTO {
  return { id, channelId: 1, type: "text", content: `message-${id}` } as MessageDTO;
}

async function waitFor(predicate: () => boolean, label: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

test("transport reconnect reports offline state and reloads messages missed while disconnected", async (context) => {
  const httpServer = createServer();
  const ioServer = new SocketIOServer(httpServer);
  let releaseInitialReady: (() => void) | undefined;
  let connectionCount = 0;
  ioServer.on("connection", (socket) => {
    connectionCount += 1;
    socket.join("ch:1");
    socket.on("channel:join", ({ channelId }: { channelId: number }) => socket.join(`ch:${channelId}`));
    if (connectionCount === 1) releaseInitialReady = () => socket.emit("session:ready");
    else socket.emit("session:ready");
  });
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const port = (httpServer.address() as AddressInfo).port;
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { protocol: "http:", host: `127.0.0.1:${port}`, hostname: "127.0.0.1", port: String(port) }
  });

  const history = [message(1)];
  const originalFetch = globalThis.fetch;
  let clientSocket: { disconnect: () => unknown } | undefined;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ messages: history }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  context.after(async () => {
    clientSocket?.disconnect();
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve) => ioServer.close(() => resolve()));
    httpServer.close();
  });

  storage.clear();
  storage.setItem("team-chat-token", "test-token");
  storage.setItem("team-chat-current-channel", "1");
  setActivePinia(createPinia());
  const { useChatStore } = await import("./store");
  const store = useChatStore();
  store.messages = [...history];
  store.connectSocket();
  await waitFor(() => Boolean(toRaw(store.socket)?.connected && releaseInitialReady), "transport connection before session readiness");
  assert.equal(store.connectionState, "connecting");
  releaseInitialReady!();
  await waitFor(() => store.connectionState === "connected", "initial socket connection");

  const socket = toRaw(store.socket)!;
  clientSocket = socket;
  socket.io.engine.close();
  await waitFor(() => !socket.connected, "transport disconnection");
  assert.equal(store.connectionState, "offline");

  const missedMessage = message(2);
  history.push(missedMessage);
  ioServer.to("ch:1").emit("message:new", missedMessage);
  await waitFor(() => socket.connected, "transport reconnection");
  await waitFor(() => store.messages.some((row) => row.id === missedMessage.id), "missed message reload");

  assert.equal(store.connectionState, "connected");
  assert.deepEqual(store.messages.map((row) => row.id), [1, 2]);
  socket.disconnect();
});

test("initial message load preserves realtime messages received while the request is pending", async () => {
  storage.clear();
  storage.setItem("team-chat-current-channel", "1");
  setActivePinia(createPinia());
  const { useChatStore } = await import("./store");
  const store = useChatStore();
  store.messages = [message(1)];

  const originalFetch = globalThis.fetch;
  let releaseResponse: ((response: Response) => void) | undefined;
  globalThis.fetch = () => new Promise<Response>((resolve) => (releaseResponse = resolve));
  try {
    const loading = store.loadMessages();
    await waitFor(() => Boolean(releaseResponse), "pending message request");
    store.appendLocalMessage(message(2));
    releaseResponse!(
      new Response(JSON.stringify({ messages: [message(1)] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    await loading;

    assert.deepEqual(store.messages.map((row) => row.id), [1, 2]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("pinned:updated applies only to its own channel", async (context) => {
  const httpServer = createServer();
  const ioServer = new SocketIOServer(httpServer);
  let serverSocket: { emit: (event: string, payload: unknown) => unknown } | undefined;
  ioServer.on("connection", (socket) => {
    serverSocket = socket;
    socket.on("channel:join", ({ channelId }: { channelId: number }) => socket.join(`ch:${channelId}`));
    socket.emit("session:ready");
  });
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const port = (httpServer.address() as AddressInfo).port;
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { protocol: "http:", host: `127.0.0.1:${port}`, hostname: "127.0.0.1", port: String(port) }
  });

  const originalFetch = globalThis.fetch;
  let clientSocket: { disconnect: () => unknown } | undefined;
  globalThis.fetch = async () =>
    new Response(JSON.stringify([]), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  context.after(async () => {
    clientSocket?.disconnect();
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve) => ioServer.close(() => resolve()));
    httpServer.close();
  });

  storage.clear();
  storage.setItem("team-chat-token", "test-token");
  storage.setItem("team-chat-current-channel", "1");
  setActivePinia(createPinia());
  const { useChatStore } = await import("./store");
  const store = useChatStore();
  const pinnedOne = { id: 11, kind: "notice", title: "One", version: 1 } as PinnedDTO;
  const pinnedTwo = { id: 22, kind: "notice", title: "Two", version: 1 } as PinnedDTO;
  store.channels = [
    { id: 1, name: "General", pinned: pinnedOne },
    { id: 2, name: "Other", pinned: null }
  ] as unknown as ChannelDTO[];
  store.pinned = pinnedOne;
  store.connectSocket();
  await waitFor(() => store.connectionState === "connected", "initial socket connection");
  clientSocket = toRaw(store.socket)!;

  // Another channel's pinned update must not touch the current view.
  serverSocket!.emit("pinned:updated", { channelId: 2, pinned: pinnedTwo });
  await waitFor(() => store.channels.find((ch) => ch.id === 2)?.pinned?.id === pinnedTwo.id, "channel 2 pinned update");
  assert.equal(store.pinned?.id, pinnedOne.id);

  // A live chain refresh must not undo a user's acknowledgement of this pin.
  store.pinned = { ...pinnedOne, dismissed: true };
  store.channels[0].pinned = store.pinned;
  serverSocket!.emit("pinned:updated", { channelId: 1, pinned: { ...pinnedOne, message: message(42) } });
  await waitFor(() => store.pinned?.message?.id === 42, "live pinned message refreshed");
  assert.equal(store.pinned?.dismissed, true);
  assert.equal(store.channels[0].pinned?.dismissed, true);

  // The current channel's update applies to both the view and the list entry.
  serverSocket!.emit("pinned:updated", { channelId: 1, pinned: null });
  await waitFor(() => store.pinned === null, "current channel pinned cleared");
  assert.equal(store.channels.find((ch) => ch.id === 1)?.pinned, null);
  assert.equal(store.channels.find((ch) => ch.id === 2)?.pinned?.id, pinnedTwo.id);

  clientSocket?.disconnect();
});

test("transport reconnect reloads channels and backfills the pinned notice", async (context) => {
  const httpServer = createServer();
  const ioServer = new SocketIOServer(httpServer);
  ioServer.on("connection", (socket) => {
    socket.on("channel:join", ({ channelId }: { channelId: number }) => socket.join(`ch:${channelId}`));
    socket.emit("session:ready");
  });
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const port = (httpServer.address() as AddressInfo).port;
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { protocol: "http:", host: `127.0.0.1:${port}`, hostname: "127.0.0.1", port: String(port) }
  });

  const pinned = { id: 5, kind: "notice", title: "Pinned", version: 1 } as PinnedDTO;
  const originalFetch = globalThis.fetch;
  let clientSocket: { disconnect: () => unknown } | undefined;
  let channelRequests = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = (data: unknown) =>
      new Response(JSON.stringify(data), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    if (url.includes("/api/sermon/directory")) return body([]);
    if (url.includes("/api/channels/1/members")) return body({ members: [] });
    if (url.includes("/api/channels")) {
      channelRequests += 1;
      return body({
        channels: [{ id: 1, name: "General", kind: "standard", description: "", icon: "", isPrivate: false, isDefault: true, memberCount: 1, lastMessageId: 0, pinned }]
      });
    }
    if (url.includes("/api/messages")) return body({ messages: [] });
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  context.after(async () => {
    clientSocket?.disconnect();
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve) => ioServer.close(() => resolve()));
    httpServer.close();
  });

  storage.clear();
  storage.setItem("team-chat-token", "test-token");
  storage.setItem("team-chat-current-channel", "1");
  setActivePinia(createPinia());
  const { useChatStore } = await import("./store");
  const store = useChatStore();
  store.connectSocket();
  await waitFor(() => store.connectionState === "connected", "initial socket connection");
  assert.equal(channelRequests, 0);
  assert.equal(store.pinned, null);

  const socket = toRaw(store.socket)!;
  clientSocket = socket;
  socket.io.engine.close();
  await waitFor(() => !socket.connected, "transport disconnection");
  await waitFor(() => socket.connected, "transport reconnection");
  await waitFor(() => channelRequests === 1, "channel list reload after reconnect");
  await waitFor(() => store.pinned?.id === pinned.id, "pinned backfill after reconnect");
  assert.equal(store.channels.find((ch) => ch.id === 1)?.pinned?.id, pinned.id);
  socket.disconnect();
});
