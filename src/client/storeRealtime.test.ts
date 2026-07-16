import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createPinia, setActivePinia } from "pinia";
import { Server as SocketIOServer } from "socket.io";
import { toRaw } from "vue";
import type { MessageDTO } from "../shared/types";

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
  ioServer.on("connection", (socket) => {
    socket.join("ch:1");
    socket.on("channel:join", ({ channelId }: { channelId: number }) => socket.join(`ch:${channelId}`));
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
