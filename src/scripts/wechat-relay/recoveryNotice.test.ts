import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadRelayConfig } from "./config.js";
import { SafeRelayError } from "./errors.js";
import { RelayQueue } from "./queue.js";
import { WeChatRelay } from "./relay.js";
import type { MessageDTO } from "../../shared/types.js";

function message(id: number): MessageDTO {
  return { id, channelId: 7, type: "text", content: `private ${id}`, createdAt: new Date().toISOString(),
    sender: { id: 1, kind: "human", username: "sender", displayName: "Sender" } };
}

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "relay-recovery-"));
  const database = path.join(directory, "queue.sqlite");
  return { directory, database, queue: new RelayQueue(database) };
}

test("outage backlog becomes one exact notice and survives a restart", () => {
  const f = fixture();
  let queue = f.queue;
  try {
    queue.ingest([message(1), message(2)], (item) => item.content);
    queue.noteOutage();
    queue.close();
    queue = new RelayQueue(f.database);
    const notice = queue.claimNext()!;
    assert.equal(notice.formattedText, "因转发故障，积压了2条消息，请回聊天室查看");
    assert.equal(queue.item(1)?.state, "expired");
    assert.equal(queue.item(2)?.state, "expired");
    assert.equal(queue.cursor(), 2);
    queue.markSent(notice.sourceId);
    queue.ingest([message(3)], (item) => item.content);
    assert.equal(queue.claimNext()?.formattedText, "private 3");
  } finally { queue.close(); fs.rmSync(f.directory, { recursive: true, force: true }); }
});

test("a deferred notice merges later backlog without counting itself or resetting its retry time", () => {
  const f = fixture();
  try {
    f.queue.ingest([message(1), message(2)], (item) => item.content);
    f.queue.noteOutage();
    const first = f.queue.claimNext()!;
    const retryAt = Date.now() + 60_000;
    f.queue.markDeferred(first.sourceId, "offline", retryAt);
    f.queue.ingest([message(3)], (item) => item.content);
    assert.equal(f.queue.claimNext(), null);
    const notice = f.queue.claimNext(retryAt)!;
    assert.equal(notice.sourceId, first.sourceId);
    assert.equal(notice.formattedText, "因转发故障，积压了3条消息，请回聊天室查看");
    f.queue.markSent(notice.sourceId);
    assert.equal(f.queue.claimNext(retryAt), null);
  } finally { f.queue.close(); fs.rmSync(f.directory, { recursive: true, force: true }); }
});

test("uncertain messages stay blocked until explicitly resolved and sent messages are not counted", () => {
  const f = fixture();
  try {
    f.queue.ingest([message(1), message(2), message(3)], (item) => item.content);
    f.queue.claimNext();
    f.queue.markUncertain(1, "unknown");
    f.queue.recoverInterruptedDelivery();
    assert.equal(f.queue.claimNext(), null);
    f.queue.resolve(1, "sent");
    assert.equal(f.queue.claimNext()?.formattedText, "因转发故障，积压了2条消息，请回聊天室查看");
  } finally { f.queue.close(); fs.rmSync(f.directory, { recursive: true, force: true }); }
});

test("the relay only sends one summary after initial catch-up, including a safe delivery retry", async () => {
  const f = fixture();
  const attempts: string[] = [];
  const config = { ...loadRelayConfig({ RELAY_BASE_URL: "https://example.com", RELAY_AGENT_TOKEN: "test" }), idleIntervalMs: 1, retryBaseMs: 1, pollIntervalMs: 1 };
  let supplied = false;
  const relay = new WeChatRelay(config, f.queue, {
    close() {}, async ensureSubscription() {},
    async catchUp(after, ingest) {
      if (!supplied) { supplied = true; ingest([message(1), message(2), message(3)]); }
      return { cursor: Math.max(3, after), total: 3 };
    }
  }, {
    async doctor() { return []; },
    async send(item) {
      attempts.push(item.formattedText);
      if (attempts.length === 1) throw new SafeRelayError("desktop offline");
      relay.stop();
      return { summary: "confirmed" };
    }
  }, { info() {}, warn() {}, error() {} });
  const timeout = setTimeout(() => relay.stop(), 2000);
  try {
    await relay.run();
    assert.deepEqual(attempts, ["因转发故障，积压了3条消息，请回聊天室查看", "因转发故障，积压了3条消息，请回聊天室查看"]);
    assert.equal(f.queue.counts().sent, 1);
    assert.equal(f.queue.counts().expired, 3);
  } finally { clearTimeout(timeout); relay.stop(); f.queue.close(); fs.rmSync(f.directory, { recursive: true, force: true }); }
});

test("a failure during normal live delivery summarizes the failed item and the following backlog", async () => {
  const f = fixture();
  const attempts: string[] = [];
  let polls = 0;
  const relay = new WeChatRelay({ ...loadRelayConfig({ RELAY_BASE_URL: "https://example.com", RELAY_AGENT_TOKEN: "test" }), idleIntervalMs: 1, retryBaseMs: 1, pollIntervalMs: 1 }, f.queue, {
    close() {}, async ensureSubscription() {},
    async catchUp(after, ingest) {
      polls += 1;
      if (polls === 2) ingest([message(1), message(2), message(3)]);
      return { cursor: after, total: polls === 2 ? 3 : 0 };
    }
  }, {
    async doctor() { return []; },
    async send(item) {
      attempts.push(item.formattedText);
      if (attempts.length === 1) throw new SafeRelayError("desktop offline");
      relay.stop(); return { summary: "confirmed" };
    }
  }, { info() {}, warn() {}, error() {} });
  const timeout = setTimeout(() => relay.stop(), 2000);
  try {
    await relay.run();
    assert.equal(attempts.length, 2);
    assert.equal(attempts[1], "因转发故障，积压了3条消息，请回聊天室查看");
    assert.equal(f.queue.counts().sent, 1);
  } finally { clearTimeout(timeout); relay.stop(); f.queue.close(); fs.rmSync(f.directory, { recursive: true, force: true }); }
});

test("an interrupted recovery notice is never resent without an explicit resolution", () => {
  const f = fixture();
  let queue = f.queue;
  try {
    queue.ingest([message(1)], (item) => item.content);
    queue.noteOutage();
    const notice = queue.claimNext()!;
    queue.close(); queue = new RelayQueue(f.database);
    queue.recoverInterruptedDelivery();
    queue.ingest([message(2)], (item) => item.content);
    assert.equal(queue.claimNext(), null);
    queue.resolve(notice.sourceId, "sent");
    assert.equal(queue.claimNext()?.formattedText, "因转发故障，积压了1条消息，请回聊天室查看");
  } finally { queue.close(); fs.rmSync(f.directory, { recursive: true, force: true }); }
});

test("discarding backlog also discards an outstanding recovery notice", () => {
  const f = fixture();
  try {
    f.queue.ingest([message(1)], (item) => item.content);
    f.queue.noteOutage();
    const notice = f.queue.claimNext()!;
    f.queue.markDeferred(notice.sourceId, "offline", 0);
    f.queue.discardBacklogThrough(1);
    f.queue.ingest([message(2)], (item) => item.content);
    assert.equal(f.queue.claimNext()?.formattedText, "private 2");
  } finally { f.queue.close(); fs.rmSync(f.directory, { recursive: true, force: true }); }
});
