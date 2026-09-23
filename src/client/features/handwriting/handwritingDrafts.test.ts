import assert from "node:assert/strict";
import test from "node:test";
import {
  HANDWRITING_DRAFT_CHANNEL_LIMIT,
  createHandwritingDraftRepository,
  handwritingDraftKey,
  type HandwritingDraftRecord,
  type HandwritingDraftStorage
} from "./handwritingDrafts.js";

class MemoryStorage implements HandwritingDraftStorage {
  values = new Map<string, HandwritingDraftRecord>();
  failWrites = false;

  async list() { return [...this.values.values()]; }
  async put(record: HandwritingDraftRecord) {
    if (this.failWrites) throw new Error("persistence failed");
    this.values.set(record.key, structuredClone(record));
  }
  async delete(key: string) { this.values.delete(key); }
}

const payload = { kind: "handwriting", version: 1, characters: [{ strokes: [{ points: [[1, 2, 0]] }] }] };
const scope = { accountId: 1, actorId: 2, channelId: 3 };

test("draft and frozen pending snapshots share one account/actor/channel record", async () => {
  const storage = new MemoryStorage();
  const repository = createHandwritingDraftRepository(storage);
  await repository.saveDraft(scope, payload, 4, 10);
  await repository.savePending(scope, { clientRequestId: "request-1", revision: 4, payload, replyToId: 8, createdAt: 20 });
  const row = await repository.record(scope);
  assert.equal(row?.key, handwritingDraftKey(scope));
  assert.equal(row?.draft?.revision, 4);
  assert.equal(row?.pending?.clientRequestId, "request-1");
  assert.notEqual(row?.pending?.payload, payload);
});

test("confirm removes only the frozen revision and preserves later edits", async () => {
  const storage = new MemoryStorage();
  const repository = createHandwritingDraftRepository(storage);
  await repository.saveDraft(scope, payload, 1);
  await repository.savePending(scope, { clientRequestId: "request-1", revision: 1, payload, replyToId: null, createdAt: 1 });
  await repository.saveDraft(scope, payload, 2);
  assert.equal(await repository.confirmPending(scope, "request-1"), true);
  assert.equal((await repository.record(scope))?.draft?.revision, 2);
  assert.equal((await repository.record(scope))?.pending, undefined);
});

test("one channel cannot silently replace a different unconfirmed send", async () => {
  const repository = createHandwritingDraftRepository(new MemoryStorage());
  await repository.savePending(scope, { clientRequestId: "request-1", revision: 1, payload, replyToId: null, createdAt: 1 });
  await assert.rejects(
    repository.savePending(scope, { clientRequestId: "request-2", revision: 1, payload, replyToId: null, createdAt: 2 }),
    /已有一条未确认/
  );
});

test("combined draft and pending quota refuses a ninth channel without evicting records", async () => {
  const storage = new MemoryStorage();
  const repository = createHandwritingDraftRepository(storage);
  for (let channelId = 1; channelId <= HANDWRITING_DRAFT_CHANNEL_LIMIT; channelId += 1) {
    await repository.saveDraft({ accountId: 1, actorId: 2, channelId }, payload, 1);
  }
  await assert.rejects(repository.saveDraft({ accountId: 1, actorId: 2, channelId: 99 }, payload, 1), /最多保留/);
  assert.equal(storage.values.size, HANDWRITING_DRAFT_CHANNEL_LIMIT);
});

test("persistence errors stay visible to callers and account cleanup is scoped", async () => {
  const storage = new MemoryStorage();
  const repository = createHandwritingDraftRepository(storage);
  await repository.saveDraft(scope, payload, 1);
  await repository.saveDraft({ accountId: 2, actorId: 4, channelId: 3 }, payload, 1);
  storage.failWrites = true;
  await assert.rejects(repository.saveDraft(scope, payload, 2), /persistence failed/);
  storage.failWrites = false;
  await repository.clearAccount(1);
  assert.equal(storage.values.size, 1);
  assert.equal([...storage.values.values()][0]?.accountId, 2);
});
