import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { spawnSync } from "node:child_process";
import test from "node:test";
import type { MessageDTO } from "../../shared/types.js";
import { loadRelayConfig, parsePoint, parseRectangle } from "./config.js";
import { formatRelayMessage } from "./formatter.js";
import { RelayProcessLock } from "./processLock.js";
import { RelayQueue } from "./queue.js";
import { ManagedTeamChatSource } from "./managedSource.js";
import { runManagedControl } from "./main.js";
import { WeChatRelay } from "./relay.js";
import { RelayDriverOperations, type WeChatDriver } from "./driver.js";
import { TeamChatSource } from "./source.js";
import { pasteClipboardText, parseWindowGeometry, selectUsableWindow } from "./x11Driver.js";

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

test("relay CLI runs through the managed current symlink", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-relay-cli-test-"));
  try {
    const entry = path.join(directory, "main.ts");
    fs.symlinkSync(path.resolve("src/scripts/wechat-relay/main.ts"), entry);
    const result = spawnSync(process.execPath, ["--import", "tsx", entry, "--help"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage:[\s\S]*discard-backlog/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

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

test("formatter emits only conversational reminders and prefers server-selected wording", () => {
  const formatted = formatRelayMessage(message(42));
  assert.match(formatted, /发送者/);
  assert.doesNotMatch(formatted, /通知 #42|第 42 条|2026|<p>|<br>|查看原消息/);

  const attachment = formatRelayMessage(message(43, { type: "image", content: "", fileName: "photo.jpg" }));
  assert.match(attachment, /发送者/);
  assert.doesNotMatch(attachment, /photo\.jpg/);

  const managed = message(44) as MessageDTO & { relayText: string };
  managed.relayText = "发送者刚刚说话了";
  assert.equal(formatRelayMessage(managed), "发送者刚刚说话了");
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

test("managed system events are observed once and queued only after a real change", () => {
  const temporary = temporaryDatabase();
  const queue = new RelayQueue(temporary.databasePath);
  try {
    const current = { slot: "version", key: "version:1.12.3", message: message(1, { type: "system", relayText: "current" }) };
    assert.deepEqual(queue.syncManagedEvent(current, true, formatRelayMessage), { changed: true, inserted: 0 });
    assert.deepEqual(queue.syncManagedEvent(current, true, formatRelayMessage), { changed: false, inserted: 0 });
    const next = { slot: "version", key: "version:1.13.0", message: message(2, { type: "system", relayText: "upgraded" }) };
    assert.deepEqual(queue.syncManagedEvent(next, false, formatRelayMessage), { changed: true, inserted: 0 });
    const later = { slot: "version", key: "version:1.13.1", message: message(3, { type: "system", relayText: "upgraded again" }) };
    assert.deepEqual(queue.syncManagedEvent(later, true, formatRelayMessage), { changed: true, inserted: 1 });
    const queued = queue.claimNext();
    assert.ok(queued && queued.sourceId > 4_000_000_000_000_000);
    assert.equal(queued.formattedText, "upgraded again");
    assert.equal(queue.cursor(), 0);
  } finally {
    queue.close();
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
      return Response.json({ config: { enabled: true, channelId: 7, targetGroup: "XGS", startAfterId: 10, pendingAction: null, templates: {} } });
    }
    if (url.pathname.endsWith("/messages")) return Response.json({ messages: [{ ...message(11), relayText: "发送者说话了" }] });
    return Response.json({ success: true });
  };
  const source = new ManagedTeamChatSource("https://chat.example.com", "managed-token", fakeFetch);
  assert.equal((await source.control()).targetGroup, "XGS");
  const received = await source.fetchAfter(10) as Array<MessageDTO & { relayText?: string }>;
  assert.deepEqual(received.map((item) => item.id), [11]);
  assert.equal(received[0]?.relayText, "发送者说话了");
  await source.heartbeat({ deviceName: "NAS 微信虚拟机", driverReady: true, calibratedTarget: "XGS", queue: {}, attention: 0 });
  assert.ok(requests.every((request) => request.authorization === "Bearer managed-token"));
  assert.deepEqual(requests.map((request) => request.method), ["GET", "GET", "POST"]);
});

test("managed source accepts mixed handwriting and ordinary messages in one batch", async () => {
  const fakeFetch: typeof fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    if (url.pathname.endsWith("/messages")) {
      return Response.json({ messages: [
        { ...message(21), type: "handwriting", content: "[手写消息]", payload: { kind: "handwriting", version: 1, characters: [{ strokes: [{ points: [[1, 2, 0]] }] }] } },
        message(22)
      ] });
    }
    return Response.json({ success: true });
  };
  const source = new ManagedTeamChatSource("https://chat.example.com", "managed-token", fakeFetch);
  const received = await source.fetchAfter(20);
  assert.deepEqual(received.map((item) => [item.id, item.type]), [[21, "handwriting"], [22, "text"]]);
  assert.equal(formatRelayMessage(received[0]), "发送者：[手写消息]");
  source.close();
});

test("managed source accepts current and future reminder types without blocking the batch", async () => {
  const types = ["grace", "sermon_request", "bible_session", "bible_copywork", "bible_note", "chat_record", "future_type"];
  const source = new ManagedTeamChatSource("https://chat.example.com", "token", async () => Response.json({
    messages: types.map((type, index) => ({ ...message(index + 1), type, relayText: `reminder ${index + 1}` }))
  }));
  try {
    const received = await source.fetchAfter(0);
    assert.equal(received.length, types.length);
    assert.deepEqual(received.slice(0, -1).map((item) => item.type), types.slice(0, -1));
    assert.equal(received.at(-1)?.type, "text");
    assert.deepEqual(received.map(formatRelayMessage), types.map((_, index) => `reminder ${index + 1}`));
  } finally {
    source.close();
  }
});

test("discarding backlog preserves sent records and advances the cursor past all old work", () => {
  const temporary = temporaryDatabase();
  const queue = new RelayQueue(temporary.databasePath);
  try {
    queue.ingest([message(1), message(2), message(3), message(4)], formatRelayMessage);
    queue.claimNext();
    queue.markSent(1);
    queue.claimNext();
    queue.markUncertain(2, "send outcome unknown");
    queue.claimNext();
    assert.equal(queue.discardBacklogThrough(100), 3);
    assert.equal(queue.cursor(), 100);
    assert.deepEqual(queue.counts(), { expired: 3, sent: 1 });
    assert.equal(queue.claimNext(), null);
    assert.equal(queue.hasUncertain(), false);
    assert.equal(queue.discardBacklogThrough(50), 0);
    assert.equal(queue.cursor(), 100);
    assert.throws(() => queue.discardBacklogThrough(-1), /cursor/);
    queue.ingest([message(101)], formatRelayMessage);
    assert.equal(queue.claimNext()?.sourceId, 101);
  } finally {
    queue.close();
    fs.rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test("stopping cancels a hanging managed request and never ingests its response", async () => {
  let requestStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => { requestStarted = resolve; });
  const source = new ManagedTeamChatSource("https://chat.example.com", "token", async (_input, init) => {
    requestStarted?.();
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    });
  });
  let ingested = false;
  const running = source.catchUp(0, () => { ingested = true; });
  await started;
  source.close();
  await assert.rejects(running, /abort/i);
  assert.equal(ingested, false);
});

test("managed source rejects a non-advancing full batch instead of polling forever", async () => {
  const source = new ManagedTeamChatSource("https://chat.example.com", "token", async () => Response.json({
    messages: Array.from({ length: 200 }, () => message(10))
  }));
  try {
    await assert.rejects(source.catchUp(10, () => undefined), /without advancing/);
  } finally {
    source.close();
  }
});

test("shutdown wakes polling and returns a throttled message without sending it", async () => {
  const temporary = temporaryDatabase();
  const queue = new RelayQueue(temporary.databasePath);
  const sent: number[] = [];
  const config = { ...loadRelayConfig(validEnvironment()), pollIntervalMs: 60000, idleIntervalMs: 10 };
  const relay = new WeChatRelay(config, queue, {
    close() {},
    async ensureSubscription() {},
    async catchUp(after) { return { cursor: after, total: 0 }; }
  }, {
    async doctor() { return []; },
    async send(item) { sent.push(item.sourceId); return { summary: "verified" }; }
  }, { info() {}, warn() {}, error() {} });
  queue.ingest([message(1, { createdAt: new Date().toISOString() }), message(2, { createdAt: new Date().toISOString() })], formatRelayMessage);
  const running = relay.run();
  try {
    const deadline = Date.now() + 500;
    while (queue.item(2)?.state !== "processing" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(queue.item(2)?.state, "processing");
    const stoppedAt = Date.now();
    relay.stop();
    await running;
    assert.ok(Date.now() - stoppedAt < 400);
    assert.deepEqual(sent, [1]);
    assert.equal(queue.item(2)?.state, "pending");
    assert.equal(queue.item(2)?.attemptCount, 0);
  } finally {
    relay.stop();
    await running;
    queue.close();
    fs.rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test("disabled forwarding also pauses the local outbox", async () => {
  const temporary = temporaryDatabase();
  const queue = new RelayQueue(temporary.databasePath);
  let enabled = false;
  let sent = 0;
  const relay = new WeChatRelay({ ...loadRelayConfig(validEnvironment()), idleIntervalMs: 5 }, queue, {
    close() {},
    deliveryEnabled() { return enabled; },
    async ensureSubscription() {},
    async catchUp(after) { return { cursor: after, total: 0 }; }
  }, {
    async doctor() { return []; },
    async send() { sent += 1; relay.stop(); return { summary: "verified" }; }
  }, { info() {}, warn() {}, error() {} });
  queue.ingest([message(1, { createdAt: new Date().toISOString() })], formatRelayMessage);
  const running = relay.run();
  try {
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(sent, 0);
    assert.equal(queue.item(1)?.attemptCount, 0);
    enabled = true;
    await running;
    assert.equal(sent, 1);
    assert.equal(queue.item(1)?.state, "sent");
  } finally {
    relay.stop();
    await running;
    queue.close();
    fs.rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test("desktop operations serialize and recover after an operation fails", async () => {
  const gate = new RelayDriverOperations();
  const calls: string[] = [];
  let finishFirst: (() => void) | undefined;
  const first = gate.run(async () => {
    calls.push("send");
    await new Promise<void>((resolve) => { finishFirst = resolve; });
    calls.push("sent");
  });
  const second = gate.run(async () => { calls.push("calibrate"); throw new Error("not ready"); });
  const rejected = assert.rejects(second, /not ready/);
  const third = gate.run(async () => { calls.push("doctor"); });
  await Promise.resolve();
  assert.deepEqual(calls, ["send"]);
  finishFirst?.();
  await Promise.all([first, rejected, third]);
  assert.deepEqual(calls, ["send", "sent", "calibrate", "doctor"]);
});

test("a sent control test is not repeated after restart when its acknowledgement failed", async () => {
  const temporary = temporaryDatabase();
  const targetPath = path.join(temporary.directory, "target");
  fs.writeFileSync(targetPath, "Target");
  let sendCount = 0;
  const driver: WeChatDriver = {
    async doctor() { return []; },
    async send() { sendCount += 1; return { summary: "verified" }; }
  };
  const actionId = "a721f781-71ee-4229-90c7-b019cf97f503";
  try {
    for (const failAcknowledgement of [true, false]) {
      const queue = new RelayQueue(temporary.databasePath);
      let source: ManagedTeamChatSource;
      source = new ManagedTeamChatSource("https://chat.example.com", "token", async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/config")) return Response.json({ config: {
          enabled: true, channelId: 7, targetGroup: "Target", startAfterId: 0,
          pendingAction: { id: actionId, type: "test", targetGroup: "Target", text: "test", createdAt: new Date().toISOString() }
        } });
        if (url.pathname.endsWith("/action-result")) {
          source.close();
          return Response.json({ success: !failAcknowledgement }, { status: failAcknowledgement ? 503 : 200 });
        }
        return Response.json({ success: true });
      });
      const relay = new WeChatRelay(loadRelayConfig(validEnvironment()), queue, source, driver);
      try {
        await runManagedControl(source, driver, queue, 5000, targetPath, relay);
        assert.equal(queue.managedActionResult(actionId)?.success, true);
      } finally {
        source.close();
        queue.close();
      }
    }
    assert.equal(sendCount, 1);
  } finally {
    fs.rmSync(temporary.directory, { recursive: true, force: true });
  }
});

test("X11 geometry parser rejects incomplete window data", () => {
  assert.deepEqual(
    parseWindowGeometry("X=10\nY=20\nWIDTH=1280\nHEIGHT=720\n", "123"),
    { id: "123", x: 10, y: 20, width: 1280, height: 720 }
  );
  assert.throws(() => parseWindowGeometry("X=10\nY=20\n", "123"), /geometry/);
});

test("X11 window selection skips a stale larger window", async () => {
  const activated: string[] = [];
  const selected = await selectUsableWindow(
    ["stable", "stale"],
    "WeChat",
    async (id) => ({
      id,
      title: "WeChat",
      geometry: {
        id,
        x: 0,
        y: 0,
        width: id === "stale" ? 1200 : 980,
        height: id === "stale" ? 800 : 693
      }
    }),
    async (candidate) => {
      activated.push(candidate.id);
      if (candidate.id === "stale") throw new Error("BadWindow");
      return candidate.geometry;
    }
  );

  assert.equal(selected?.id, "stable");
  assert.deepEqual(activated, ["stale", "stable"]);
});

test("X11 clipboard stays owned until the target requests the paste", async () => {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stderr: PassThrough;
    kill: (signal?: NodeJS.Signals | number) => boolean;
  };
  child.stdin = new PassThrough();
  child.stderr = new PassThrough();
  let killed = false;
  child.kill = () => {
    killed = true;
    return true;
  };
  let spawnArgs: string[] = [];
  const spawnClipboard = ((_: string, args: readonly string[]) => {
    spawnArgs = [...args];
    queueMicrotask(() => child.emit("spawn"));
    return child;
  }) as unknown as typeof import("node:child_process").spawn;

  await pasteClipboardText("relay text", { DISPLAY: ":0" }, async () => {
    assert.equal(killed, false);
    queueMicrotask(() => child.emit("close", 0, null));
  }, { spawnClipboard, readyWaitMs: 0, requestTimeoutMs: 50 });

  assert.deepEqual(spawnArgs, ["-selection", "clipboard", "-loops", "1", "-silent"]);
  assert.equal(killed, false);
});

test("X11 clipboard rejects an unconsumed paste instead of reporting delivery", async () => {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stderr: PassThrough;
    kill: (signal?: NodeJS.Signals | number) => boolean;
  };
  child.stdin = new PassThrough();
  child.stderr = new PassThrough();
  let killed = false;
  child.kill = () => {
    killed = true;
    queueMicrotask(() => child.emit("close", null, "SIGTERM"));
    return true;
  };
  const spawnClipboard = (() => {
    queueMicrotask(() => child.emit("spawn"));
    return child;
  }) as unknown as typeof import("node:child_process").spawn;

  await assert.rejects(
    pasteClipboardText("relay text", { DISPLAY: ":0" }, async () => undefined, {
      spawnClipboard,
      readyWaitMs: 0,
      requestTimeoutMs: 5
    }),
    /did not request the clipboard contents/
  );
  assert.equal(killed, true);
});
