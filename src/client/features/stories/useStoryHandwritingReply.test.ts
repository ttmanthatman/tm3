import assert from "node:assert/strict";
import test from "node:test";
import { effectScope, ref } from "vue";
import type { HandwritingPayload } from "@shared/handwriting";
import type { StoryCommentDTO, StoryInteractionsDTO } from "@shared/stories";
import { createHandwritingDraftRepository, type HandwritingDraftRecord, type HandwritingDraftStorage } from "../handwriting/handwritingDrafts";
import { createStoryHandwritingDraftRepository } from "./storyHandwritingDrafts";
import { useStoryHandwritingReply } from "./useStoryHandwritingReply";
import type { StoryCommentInput } from "./storyClient";

const payload: HandwritingPayload = { kind: "handwriting", version: 1, characters: [{ strokes: [{ points: [[0, 0, 0], [20, 20, 200]] }] }] };
const interactions: StoryInteractionsDTO = { liked: false, likeCount: 0, likes: [], commentCount: 1, comments: [] };
const parent: StoryCommentDTO = { id: 9, text: "阿们", author: { accountId: 3, actorId: 4, displayName: "作者", avatarPath: null }, replyTo: null, canDelete: false, createdAt: "2026-10-08T00:00:00Z" };
function memoryStorage() {
  const records = new Map<string, HandwritingDraftRecord>();
  const storage: HandwritingDraftStorage = {
    list: async () => [...records.values()],
    put: async (record) => { records.set(record.key, record); },
    delete: async (key) => { records.delete(key); }
  };
  return { storage, records };
}

test("story drafts share the existing storage without exposing or overwriting chat drafts", async () => {
  const { storage, records } = memoryStorage();
  const scope = { accountId: 1, actorId: 17, channelId: 9 };
  const chat = createHandwritingDraftRepository(storage);
  const story = createStoryHandwritingDraftRepository(storage);
  await chat.saveDraft(scope, payload, 4);
  await story.saveDraft(scope, payload, 8);
  assert.equal((await chat.record(scope))?.draft?.revision, 4);
  assert.equal((await story.record(scope))?.draft?.revision, 8);
  assert.equal((await chat.records(scope)).length, 1);
  assert.equal(records.size, 2);
  await story.clearDraft(scope);
  assert.equal((await chat.record(scope))?.draft?.revision, 4);
  assert.equal(records.size, 1);
});

test("cancelled drafts reopen independently for each account, story, and parent comment", async () => {
  const storyId = ref(17);
  const accountId = ref(1);
  const scope = effectScope();
  const repository = createStoryHandwritingDraftRepository(memoryStorage().storage);
  const f = scope.run(() => useStoryHandwritingReply({ accountId: () => accountId.value, storyId: () => storyId.value, repository, onUpdated() {} }))!;
  await f.open(parent);
  await f.saveDraft(payload, 7);
  f.close();
  await f.open(null);
  assert.equal(f.draftState.value.payload, null);
  f.close();
  await f.open(parent);
  assert.deepEqual(f.draftState.value.payload, payload);
  assert.equal(f.draftState.value.revision, 7);
  accountId.value = 2;
  assert.equal(f.handwritingOpen.value, false);
  await f.open(parent);
  assert.equal(f.draftState.value.payload, null);
  storyId.value = 18;
  await f.open(parent);
  assert.equal(f.draftState.value.payload, null);
  scope.stop();
});

test("refreshing interactions for the same story keeps the active writer and draft", async () => {
  const story = ref({ id: 17, likes: 0 });
  const scope = effectScope();
  const f = scope.run(() => useStoryHandwritingReply({ accountId: () => 1, storyId: () => story.value.id, repository: createStoryHandwritingDraftRepository(memoryStorage().storage), onUpdated() {} }))!;
  await f.open(parent);
  await f.saveDraft(payload, 7);
  story.value = { id: 17, likes: 1 };
  assert.equal(f.handwritingOpen.value, true);
  assert.equal(f.handwritingBusy.value, false);
  scope.stop();
});

test("a failed handwritten reply keeps its payload and parent, then clears the draft after success", async () => {
  const repository = createStoryHandwritingDraftRepository(memoryStorage().storage);
  const posted: { storyId: number; body: string | StoryCommentInput }[] = [];
  const applied: StoryInteractionsDTO[] = [];
  const f = useStoryHandwritingReply({ accountId: () => 1, storyId: () => 17, repository, onUpdated: (value) => applied.push(value), post: async (storyId, body) => {
    posted.push({ storyId, body });
    if (posted.length === 1) throw new Error("网络失败");
    return { interactions };
  } });
  await f.open(parent);
  await f.submit(payload, 3);
  assert.equal(f.handwritingOpen.value, true);
  assert.equal(f.handwritingError.value, "网络失败");
  assert.deepEqual((await repository.record({ accountId: 1, actorId: 17, channelId: 9 }))?.draft?.payload, payload);
  await Promise.all([f.submit(payload, 3), f.submit(payload, 3)]);
  assert.equal(posted.length, 2);
  assert.deepEqual(posted[0], posted[1]);
  assert.equal(posted[1].storyId, 17);
  assert.deepEqual((posted[1].body as StoryCommentInput).handwriting, payload);
  assert.equal((posted[1].body as StoryCommentInput).replyToId, 9);
  assert.match((posted[1].body as StoryCommentInput).clientRequestId || "", /^[0-9a-f-]{36}$/);
  assert.equal(f.handwritingOpen.value, false);
  assert.deepEqual(applied, [interactions]);
  assert.equal(await repository.record({ accountId: 1, actorId: 17, channelId: 9 }), undefined);
});

test("switching stories aborts the request and ignores its late response", async () => {
  const storyId = ref(17);
  const scope = effectScope();
  let signal: AbortSignal | undefined;
  let finish: ((value: { interactions: StoryInteractionsDTO }) => void) | undefined;
  let applied = false;
  const f = scope.run(() => useStoryHandwritingReply({ accountId: () => 1, storyId: () => storyId.value, repository: createStoryHandwritingDraftRepository(memoryStorage().storage), onUpdated: () => { applied = true; }, post: async (_story, _body, _reply, requestSignal) => {
    signal = requestSignal;
    return new Promise((resolve) => { finish = resolve; });
  } }))!;
  await f.open(parent);
  const request = f.submit(payload, 5);
  while (!finish) await new Promise((resolve) => setImmediate(resolve));
  storyId.value = 18;
  assert.equal(signal?.aborted, true);
  assert.equal(f.handwritingOpen.value, false);
  await f.submit(payload, 5);
  finish({ interactions });
  await request;
  assert.equal(applied, false);
  await f.open(null);
  assert.equal(f.draftState.value.payload, null);
  scope.stop();
});

test("storage errors remain visible and a cancelled writer retains an in-memory draft", async () => {
  const storage: HandwritingDraftStorage = { list: async () => [], put: async () => { throw new Error("空间不足"); }, delete: async () => {} };
  const f = useStoryHandwritingReply({ accountId: () => 1, storyId: () => 17, repository: createStoryHandwritingDraftRepository(storage), onUpdated() {} });
  await f.open(null);
  await f.saveDraft(payload, 2);
  assert.match(f.persistenceError.value, /空间不足/);
  f.close();
  await f.open(null);
  assert.deepEqual(f.draftState.value.payload, payload);
  assert.match(f.persistenceError.value, /空间不足/);
});

test("a committed reply with a lost response reuses its persisted request ID after reopening the page", async () => {
  const repository = createStoryHandwritingDraftRepository(memoryStorage().storage);
  const committed = new Set<string>();
  const requests: string[] = [];
  let applied = 0;
  const post: typeof import("./storyClient").addStoryComment = async (_storyId, body) => {
    assert.equal(typeof body, "object");
    const id = (body as StoryCommentInput).clientRequestId!;
    requests.push(id);
    committed.add(id);
    if (requests.length === 1) throw new Error("响应丢失");
    return { interactions };
  };
  const firstScope = effectScope();
  const first = firstScope.run(() => useStoryHandwritingReply({ accountId: () => 1, storyId: () => 17, repository, post, onUpdated: () => applied++ }))!;
  await first.open(parent);
  await first.submit(payload, 3);
  firstScope.stop();
  const second = useStoryHandwritingReply({ accountId: () => 1, storyId: () => 17, repository, post, onUpdated: () => applied++ });
  await second.open(parent);
  assert.deepEqual(second.draftState.value.payload, payload);
  await second.submit(second.draftState.value.payload!, second.draftState.value.revision);
  assert.equal(requests.length, 2);
  assert.equal(requests[0], requests[1]);
  assert.equal(committed.size, 1);
  assert.equal(applied, 1);
});

test("editing a failed payload starts a fresh request, while cancellation preserves an unchanged attempt", async () => {
  const requests: string[] = [];
  const f = useStoryHandwritingReply({ accountId: () => 1, storyId: () => 17, repository: createStoryHandwritingDraftRepository(memoryStorage().storage), onUpdated() {}, post: async (_story, body) => {
    requests.push((body as StoryCommentInput).clientRequestId!);
    throw new Error("网络失败");
  } });
  await f.open(parent);
  await f.submit(payload, 3);
  f.close();
  await f.open(parent);
  assert.equal(f.handwritingError.value, "网络失败");
  await f.submit(payload, 3);
  const edited: HandwritingPayload = { ...payload, characters: [...payload.characters, ...payload.characters] };
  await f.submit(edited, 4);
  assert.equal(requests[0], requests[1]);
  assert.notEqual(requests[1], requests[2]);
});
