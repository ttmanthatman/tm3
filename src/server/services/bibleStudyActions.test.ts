import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { bibleStudyBranchIds, type BibleStudyQuestion } from "../../shared/bibleStudy.js";
import { changeStudyQuestion } from "./bibleStudyActions.js";

const question = (id: number, parentId?: number): BibleStudyQuestion => ({ id, parentId, stage: "observe", text: `题目${id}`, relation: parentId ? "deepen" : "opening", purpose: "观察", evidence: [] });
const checkpoint = (q?: BibleStudyQuestion) => ({ kind: "bible_study_turn", stage: "observe", reference: "马可福音 4:35-41", sessionStartId: 1, ...(q ? { question: q } : { responseOnly: true, currentQuestionId: 20 }) });
function fixture(questions = [question(10), question(20, 10), question(30, 20), question(40)]) {
  const rows = [
    { id: 10, senderActorId: 99, replyToId: 1, content: "题目10", payload: checkpoint(questions[0]) },
    { id: 11, senderActorId: 7, replyToId: null, content: "保留的根题回答", payload: null },
    { id: 20, senderActorId: 99, replyToId: 11, content: "待删除题目20", payload: checkpoint(questions[1]) },
    { id: 21, senderActorId: 7, replyToId: null, content: "删除的私密回答", payload: null },
    { id: 30, senderActorId: 99, replyToId: 21, content: "待删除题目30", payload: checkpoint(questions[2]) },
    { id: 31, senderActorId: 7, replyToId: null, content: "删除的另一回答", payload: null },
    { id: 40, senderActorId: 99, replyToId: 31, content: "关于已删除回答的承接。题目40", payload: checkpoint(questions[3]) },
    { id: 41, senderActorId: 7, replyToId: null, content: "定向追加秘密", payload: { kind: "bible_study_answer", questionId: 20, mode: "answer" } },
    { id: 50, senderActorId: 99, replyToId: 41, content: "定向追加秘密的助手回应", payload: checkpoint() }
  ];
  const updates = new Map<number, { content?: string; type?: string; payload: unknown }>();
  const controls: unknown[] = [];
  const tx = { message: {
    findMany: async (query: { where: { channelId: number; senderActorId: { in: number[] } } }) => {
      assert.equal(query.where.channelId, 70); assert.deepEqual(query.where.senderActorId.in, [7, 99]); return rows;
    },
    update: async ({ where, data }: { where: { id: number }; data: { content?: string; type?: string; payload: unknown } }) => { updates.set(where.id, data); return data; },
    createMany: async (data: unknown) => { controls.push(data); return { count: 1 }; }
  } };
  const prisma = { $transaction: async (run: (database: typeof tx) => Promise<unknown>) => run(tx) } as unknown as PrismaClient;
  return { input: { prisma, channelId: 70, actorId: 7, assistantId: 99, checkpoint: rows.at(-1)!, questions }, updates, controls };
}
test("deletion scrubs the selected branch and its answers but preserves siblings and resume cursors", async () => {
  const f = fixture();
  assert.deepEqual(bibleStudyBranchIds(f.input.questions, 20), [20, 30]);
  assert.deepEqual(await changeStudyQuestion({ ...f.input, questionId: 20, action: "delete", expectedIds: [20, 30] }), { resume: false });
  for (const id of [20, 21, 30, 31, 41, 50]) assert.equal(f.updates.get(id)?.content, "");
  assert.equal(f.updates.has(11), false);
  assert.equal(f.updates.get(40)?.content, "题目40");
  assert.deepEqual(f.updates.get(50)?.payload, { kind: "bible_study_turn", stage: "observe", reference: "马可福音 4:35-41", sessionStartId: 1, questionSequence: 4, responseOnly: true, deleted: true, currentQuestionId: 40 });
  assert.doesNotMatch(JSON.stringify([...f.updates.values()]), /私密|秘密|删除的另一回答/);
});
test("a stale confirmation never deletes newly added descendants", async () => {
  const f = fixture();
  assert.equal(await changeStudyQuestion({ ...f.input, questionId: 20, action: "delete", expectedIds: [20] }), null);
  assert.equal(f.updates.size, 0);
});
test("skipping preserves the branch, records no answer, and only resumes an active target", async () => {
  const f = fixture();
  assert.deepEqual(await changeStudyQuestion({ ...f.input, questionId: 20, action: "skip" }), { resume: true });
  assert.equal(f.updates.size, 1); assert.equal(f.updates.get(20)?.content, undefined);
  assert.match(JSON.stringify(f.updates.get(20)?.payload), /"skipped":true/);
  assert.equal(f.controls.length, 1);
  const old = fixture();
  assert.deepEqual(await changeStudyQuestion({ ...old.input, questionId: 10, action: "skip" }), { resume: false });
  assert.equal(old.controls.length, 0);
});

test("deleting the last branch resets the latest checkpoint without replaying erased answers", async () => {
  const f = fixture([question(10), question(20, 10), question(30, 20), question(40, 10)]);
  await changeStudyQuestion({ ...f.input, questionId: 10, action: "delete", expectedIds: [10, 20, 30, 40] });
  const checkpoint = f.updates.get(50)?.payload;
  assert.match(JSON.stringify(checkpoint), /"stage":"choose"/);
  assert.match(JSON.stringify(checkpoint), /"reference":null/);
  assert.doesNotMatch(JSON.stringify(checkpoint), /currentQuestionId/);
  for (const id of [10, 11, 20, 21, 30, 31, 40, 41, 50]) assert.equal(f.updates.get(id)?.content, "");
});
