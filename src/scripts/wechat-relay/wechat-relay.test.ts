import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { MessageDTO } from "../../shared/types.js";
import { loadRelayConfig, parsePoint, parseRectangle } from "./config.js";
import { formatRelayMessage } from "./formatter.js";
import { RelayProcessLock } from "./processLock.js";
import { RelayQueue } from "./queue.js";
import { ManagedTeamChatSource } from "./managedSource.js";
import { TeamChatSource } from "./source.js";
import { parseWindowGeometry } from "./x11Driver.js";

function message(id: number, overrides: Partial<MessageDTO> = {}): MessageDTO {
  return {
    id,
    channelId: 7,
    sender: { id: 3, kind: "human", username: "sender", displayName: "发送者" },
    content: `<p>第 ${id} 条<br>通知</p>`,
    type: "text",
    createdAt: new Date(1_700_000_000_000 + id * 1000).toISOString(),
    ...overrides
  };
}

function temporaryDatabase() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-relay-test-"));
  return { directory, databasePath: path.join(directory, "relay.sqlite") };
}

function validEnvironment(): NodeJS.ProcessEnv {
  return {
    RELAY_BASE_URL: "https://chat.example.com/",
    RELAY_USERNAME: "relay",
    RELAY_PASSWORD: "test-only",
    RELAY_CHANNEL_ID: "7",
    RELAY_TARGET_GROUP: "测试通知群"
  };
}

test("configuration parses coordinates and protects source transport", () => {
  assert.deepEqual(parsePoint("12,34"), { x: 12, y: 34 });
  assert.deepEqual(parseRectangle("1,2,30,40"), { x: 1, y: 2, width: 30, height: 40 });
  assert.throws(() => parsePoint("1.5,2"), /integers/);
  assert.throws(() => parseRectangle("1,2,0,4"), /positive/);
  assert.throws(
    () => loadRelayConfig({ ...validEnvironment(), RELAY_BASE_URL: "http://chat.example.com" }),
    /must use HTTPS/
  );
  const config = loadRelayConfig(validEnvironment());
  assert.equal(config.baseUrl, "https://chat.example.com");
  assert.equal(config.driver, "dry-run");
  assert.equal(config.channelId, 7);
  const managed = loadRelayConfig({ RELAY_BASE_URL: "https://chat.example.com", RELAY_AGENT_TOKEN: "managed-token" });
  assert.equal(managed.agentToken, "managed-token");
  assert.equal(managed.channelId, 0);
});

test("formatter emits readable text, attachment labels, links, and source ids", () => {
  const formatted = formatRelayMessage(message(42), {
    maxContentLength: 1000,
    messageUrlTemplate: "https://chat.example.com/ch/{channelId}/message/{messageId}"
  });
  assert.match(formatted, /【通知 #42】/);
  assert.match(formatted, /发送者：发送者/);
  assert.match(formatted, /第 42 条\n通知/);
  assert.doesNotMatch(formatted, /<p>|<br>/);
  assert.match(formatted, /\/ch\/7\/message\/42/);

  const attachment = formatRelayMessage(message(43, { type: "image", content: "", fileName: "photo.jpg" }), {
    maxContentLength: 1000
  });
  assert.match(attachment, /【图片】photo\.jpg/);
});

test("queue ingests atomically, deduplicates, retries, and advances its cursor", () => {
  const temporary = temporaryDatabase();
  const queue = new RelayQueue(temporary.databasePath);
  try {
    assert.throws(() => queue.ingest([message(1), message(2)], (item) => {
      if (item.id === 2) throw new Error("format failed");
      return `message ${item.id}`;
    }), /format failed/);
    assert.equal(queue.cursor(), 0);
    assert.deepEqual(queue.counts(), {});

    assert.deepEqual(queue.ingest([message(1), message(2)], (item) => `message ${item.id}`), { inserted: 2, cursor: 2 });
    assert.deepEqual(queue.ingest([message(2)], (item) => `message ${item.id}`), { inserted: 0, cursor: 2 });
    assert.deepEqual(queue.ingest([message(10)], (item) => `message ${item.id}`, { advanceCursor: false }), { inserted: 1, cursor: 2 });
    assert.equal(queue.cursor(), 2);
    const first = queue.claimNext();
    assert.equal(first?.sourceId, 1);
    assert.equal(first?.attemptCount, 1);
    queue.markDeferred(1, "WeChat is logged out", 0);
    assert.equal(queue.claimNext()?.attemptCount, 1);
    queue.markRetry(1, "temporary", 2, 0);
    const retry = queue.claimNext();
    assert.equal(retry?.sourceId, 1);
    assert.equal(retry?.attemptCount, 2);
    assert.equal(queue.markRetry(1, "still failing", 2, 0), "failed");
    assert.equal(queue.resolve(1, "retry"), true);
    assert.equal(queue.claimNext()?.sourceId, 1);
  } finally {
    queue.close();
    fs.rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test("an interrupted in-flight delivery becomes uncertain instead of being resent", () => {
  const temporary = temporaryDatabase();
  const firstQueue = new RelayQueue(temporary.databasePath);
  firstQueue.ingest([message(9)], () => "notification");
  assert.equal(firstQueue.claimNext()?.state, "processing");
  firstQueue.close();

  const recoveredQueue = new RelayQueue(temporary.databasePath);
  try {
    recoveredQueue.recoverInterruptedDelivery();
    assert.equal(recoveredQueue.item(9)?.state, "uncertain");
    assert.deepEqual(recoveredQueue.attention(), [{
      sourceId: 9,
      state: "uncertain",
      lastError: "Relay stopped while delivery was in progress; manual resolution required"
    }]);
    assert.equal(recoveredQueue.claimNext(), null);
    assert.equal(recoveredQueue.resolve(9, "sent"), true);
    assert.equal(recoveredQueue.item(9)?.state, "sent");
  } finally {
    recoveredQueue.close();
    fs.rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test("process lock refuses a concurrent relay and can be reacquired after release", () => {
  const temporary = temporaryDatabase();
  const first = new RelayProcessLock(temporary.databasePath);
  const second = new RelayProcessLock(temporary.databasePath);
  try {
    first.acquire();
    assert.throws(() => second.acquire(), /already running/);
    first.release();
    second.acquire();
  } finally {
    first.release();
    second.release();
    fs.rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test("process lock recovers a stale directory created before its PID file", () => {
  const temporary = temporaryDatabase();
  const lock = new RelayProcessLock(temporary.databasePath);
  fs.mkdirSync(`${temporary.databasePath}.run-lock`);
  try {
    lock.acquire();
  } finally {
    lock.release();
    fs.rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test("source login and catch-up page through more than 200 messages", async () => {
  const available = Array.from({ length: 205 }, (_, index) => message(index + 1));
  const requests: Array<{ url: string; authorization: string | null }> = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.endsWith("/api/auth/login")) {
      return Response.json({ token: "relay-token" });
    }
    const parsed = new URL(url);
    const after = Number(parsed.searchParams.get("after") || 0);
    const limit = Number(parsed.searchParams.get("limit") || 200);
    const headers = new Headers(init?.headers);
    requests.push({ url, authorization: headers.get("authorization") });
    return Response.json({ messages: available.filter((item) => item.id > after).slice(0, limit) });
  };
  const source = new TeamChatSource({
    baseUrl: "https://chat.example.com",
    username: "relay",
    password: "test-only",
    channelId: 7
  }, fakeFetch);
  const batches: number[][] = [];
  try {
    const result = await source.catchUp(0, (items) => {
      batches.push(items.map((item) => item.id));
    });
    assert.deepEqual(result, { cursor: 205, total: 205 });
    assert.deepEqual(batches.map((batch) => batch.length), [200, 5]);
    assert.equal(requests.length, 2);
    assert.ok(requests.every((request) => request.authorization === "Bearer relay-token"));
  } finally {
    source.close();
  }
});

test("managed source authenticates with its device token and reports control state", async () => {
  const requests: Array<{ path: string; authorization: string | null; method: string }> = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    requests.push({ path: `${url.pathname}${url.search}`, authorization: new Headers(init?.headers).get("authorization"), method: init?.method || "GET" });
    if (url.pathname.endsWith("/config")) {
      return Response.json({ config: { enabled: true, channelId: 7, targetGroup: "XGS", startAfterId: 10, pendingAction: null } });
    }
    if (url.pathname.endsWith("/messages")) return Response.json({ messages: [message(11)] });
    return Response.json({ success: true });
  };
  const source = new ManagedTeamChatSource("https://chat.example.com", "managed-token", fakeFetch);
  assert.equal((await source.control()).targetGroup, "XGS");
  assert.deepEqual((await source.fetchAfter(10)).map((item) => item.id), [11]);
  await source.heartbeat({ deviceName: "NAS 微信虚拟机", driverReady: true, calibratedTarget: "XGS", queue: {}, attention: 0 });
  assert.ok(requests.every((request) => request.authorization === "Bearer managed-token"));
  assert.deepEqual(requests.map((request) => request.method), ["GET", "GET", "POST"]);
});

test("X11 geometry parser rejects incomplete window data", () => {
  assert.deepEqual(
    parseWindowGeometry("X=10\nY=20\nWIDTH=1280\nHEIGHT=720\n", "123"),
    { id: "123", x: 10, y: 20, width: 1280, height: 720 }
  );
  assert.throws(() => parseWindowGeometry("X=10\nY=20\n", "123"), /geometry/);
});
