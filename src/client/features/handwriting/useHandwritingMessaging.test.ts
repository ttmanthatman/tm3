import assert from "node:assert/strict";
import test from "node:test";
import type { MessageSendResult } from "../../messageSending.js";
import {
  createHandwritingDraftRepository,
  type HandwritingDraftRecord,
  type HandwritingDraftStorage
} from "./handwritingDrafts.js";
import { useHandwritingMessaging, type HandwritingSendPayload } from "./useHandwritingMessaging.js";

class MemoryStorage implements HandwritingDraftStorage {
  values = new Map<string, HandwritingDraftRecord>();
  fail = false;
  async list() { return [...this.values.values()]; }
  async put(record: HandwritingDraftRecord) {
    if (this.fail) throw new Error("本机存储已满");
    this.values.set(record.key, structuredClone(record));
  }
  async delete(key: string) { this.values.delete(key); }
}

const scope = { accountId: 1, actorId: 2, channelId: 3 };
const strokes = { kind: "handwriting", version: 1, characters: [{ strokes: [{ points: [[1, 2, 0]] }] }] };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test("submit persists the frozen UUID/payload before send and ACK clears the matching revision", async () => {
  const storage = new MemoryStorage();
  const repository = createHandwritingDraftRepository(storage);
  await repository.saveDraft(scope, strokes, 4);
  const sent: HandwritingSendPayload[] = [];
  const coordinator = useHandwritingMessaging({
    repository,
    createRequestId: () => "request-1",
    send: async (payload) => { sent.push(payload); return { ok: true }; },
    checkStatus: async () => ({ state: "unknown" })
  });
  assert.deepEqual(await coordinator.submit({ scope, payload: strokes, revision: 4, replyToId: 9 }), { ok: true });
  assert.deepEqual(sent[0], {
    channelId: 3,
    type: "handwriting",
    content: "[手写消息]",
    payload: strokes,
    replyToId: 9,
    clientRequestId: "request-1"
  });
  assert.equal(await repository.record(scope), undefined);
});

test("timeout and refresh recovery retry the exact same snapshot and status can confirm it", async () => {
  const storage = new MemoryStorage();
  const repository = createHandwritingDraftRepository(storage);
  const payloads: HandwritingSendPayload[] = [];
  let result: MessageSendResult = { ok: false, reason: "timeout", message: "发送结果未确认" };
  const coordinator = useHandwritingMessaging({
    repository,
    createRequestId: () => "request-1",
    send: async (payload) => { payloads.push(payload); return result; },
    checkStatus: async () => ({ state: "sent", messageId: 88 })
  });
  await coordinator.submit({ scope, payload: strokes, revision: 1, replyToId: null });
  assert.equal((await repository.record(scope))?.pending?.clientRequestId, "request-1");
  result = { ok: false, reason: "timeout", message: "still unknown" };
  await coordinator.retry(scope, "request-1");
  assert.deepEqual(payloads[1], payloads[0]);
  assert.deepEqual(await coordinator.checkStatus(scope, "request-1"), { state: "sent", messageId: 88 });
  assert.equal(await repository.record(scope), undefined);
});

test("an old ACK cannot clear a newer draft revision", async () => {
  const storage = new MemoryStorage();
  const repository = createHandwritingDraftRepository(storage);
  const gate = deferred<MessageSendResult>();
  const coordinator = useHandwritingMessaging({
    repository,
    createRequestId: () => "request-1",
    send: async () => gate.promise,
    checkStatus: async () => ({ state: "unknown" })
  });
  await repository.saveDraft(scope, strokes, 1);
  const send = coordinator.submit({ scope, payload: strokes, revision: 1, replyToId: null });
  while (!(await repository.record(scope))?.pending) await new Promise((resolve) => setTimeout(resolve, 0));
  await repository.saveDraft(scope, strokes, 2);
  gate.resolve({ ok: true });
  await send;
  assert.equal((await repository.record(scope))?.draft?.revision, 2);
});

test("persistence failure is visible and prevents any network send", async () => {
  const storage = new MemoryStorage();
  storage.fail = true;
  let sends = 0;
  const coordinator = useHandwritingMessaging({
    repository: createHandwritingDraftRepository(storage),
    send: async () => { sends += 1; return { ok: true }; },
    checkStatus: async () => ({ state: "unknown" })
  });
  const result = await coordinator.submit({ scope, payload: strokes, revision: 1, replyToId: null });
  assert.equal(result.ok, false);
  assert.match(coordinator.statusMessage.value, /存储已满/);
  assert.equal(sends, 0);
});

test("stop prevents a late send result from mutating local records", async () => {
  const storage = new MemoryStorage();
  const repository = createHandwritingDraftRepository(storage);
  const gate = deferred<MessageSendResult>();
  const coordinator = useHandwritingMessaging({
    repository,
    createRequestId: () => "request-1",
    send: async () => gate.promise,
    checkStatus: async () => ({ state: "unknown" })
  });
  const send = coordinator.submit({ scope, payload: strokes, revision: 1, replyToId: null });
  while (!(await repository.record(scope))?.pending) await new Promise((resolve) => setTimeout(resolve, 0));
  coordinator.stop();
  gate.resolve({ ok: true });
  await send;
  assert.equal((await repository.record(scope))?.pending?.clientRequestId, "request-1");
});
