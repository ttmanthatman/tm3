import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import { registerBibleStudyRoutes } from "./bibleStudy.js";
import type { BibleStudyAnswerRequest } from "../../shared/bibleStudy.js";

test("inline answers validate input and authorize the participant's own writable room", async () => {
  const app = Fastify();
  let canWrite = true;
  let accepted = true;
  const submitted: Array<{ channelId: number; actorId: number; input: BibleStudyAnswerRequest }> = [];
  const managed: unknown[] = [];
  registerBibleStudyRoutes(app, {
    prisma: { channel: { findUnique: async ({ where }: { where: { directKey: string } }) => {
      assert.equal(where.directKey, "virtual:bible-study:7"); return { id: 70 };
    } } } as unknown as PrismaClient,
    requireAuth: async () => {}, requireAdmin: async () => {},
    authFor: () => ({ accountId: 7, actorId: 8, isAdmin: false, canPinMessages: false }),
    enter: async () => 70, progress: async () => ({ progress: null, latest: null }),
    manageQuestion: async (...args) => { managed.push(args); return accepted; },
    retry: () => {}, requestHelp: async () => false,
    canAccessChannel: async () => true, canWriteChannel: async () => canWrite,
    submitAnswer: async (channelId, actorId, input) => { submitted.push({ channelId, actorId, input }); return accepted; }
  });
  try {
    const input = { questionId: 12, content: "另一个问题", mode: "followup", clientRequestId: "6abc68d4-0a44-4c71-8b0c-9b37b7abedfd" };
    const send = (payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/api/bible-study/answer", payload });
    assert.equal((await send({ ...input, questionId: -1 })).statusCode, 400);
    assert.equal((await send({ ...input, content: " " })).statusCode, 400);
    assert.equal((await send({ ...input, parentId: 1 })).statusCode, 400);
    canWrite = false;
    assert.equal((await send(input)).statusCode, 403);
    assert.equal(submitted.length, 0);
    canWrite = true;
    assert.equal((await send(input)).statusCode, 202);
    assert.deepEqual(submitted[0], { channelId: 70, actorId: 8, input });
    accepted = false;
    assert.equal((await send(input)).statusCode, 409);
    const change = (action: string, payload: Record<string, unknown>) => app.inject({ method: "POST", url: `/api/bible-study/questions/${action}`, payload });
    assert.equal((await change("delete", { questionId: 12 })).statusCode, 400);
    assert.equal((await change("skip", { questionId: 12, expectedIds: [12] })).statusCode, 400);
    canWrite = false;
    assert.equal((await change("delete", { questionId: 12, expectedIds: [12] })).statusCode, 403);
    assert.equal(managed.length, 0);
    canWrite = true;
    assert.equal((await change("delete", { questionId: 12, expectedIds: [12] })).statusCode, 409);
    accepted = true;
    assert.equal((await change("skip", { questionId: 12 })).statusCode, 200);
    assert.deepEqual(managed.at(-1), [70, 8, 12, "skip", undefined]);
  } finally { await app.close(); }
});
