import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { createVirtualAssistantSessions } from "./virtualAssistantSessions.js";

const trigger = { id: 10, channelId: 3, senderActorId: 4, content: "为什么？", createdAt: new Date() };

test("stop stamps only the same user's latest reply and preserves its media metadata", async () => {
  const calls: unknown[] = [];
  const prisma = { message: {
    findFirst: async (input: unknown) => { calls.push(input); return { id: 9, payload: { musicTrackId: 7 } }; },
    update: async (input: unknown) => { calls.push(input); }
  } } as unknown as PrismaClient;
  const sessions = createVirtualAssistantSessions(prisma, async (id, channelId) => { calls.push({ id, channelId }); });
  await sessions.stop(trigger, { id: 8, username: "ai_slmm" });
  assert.deepEqual(calls[0], { where: { channelId: 3, senderActorId: 8, replyTo: { senderActorId: 4, id: { lt: 10 } } }, orderBy: { id: "desc" } });
  const update = calls[1] as { data: { payload: Record<string, unknown> } };
  assert.equal(update.data.payload.musicTrackId, 7);
  assert.deepEqual(update.data.payload.aiSessionEnded, { at: trigger.createdAt.toISOString(), byMessageId: 10, username: "ai_slmm" });
  assert.deepEqual(calls[2], { id: 9, channelId: 3 });
});

test("durable stop detection scopes the user and channel and does not confuse discussion with a command", async () => {
  let rows: Array<{ content: string; payload?: unknown }> = [{ content: "为什么说闭嘴？" }];
  let query: unknown;
  const prisma = { message: { findMany: async (input: unknown) => { query = input; return rows; } } } as unknown as PrismaClient;
  const sessions = createVirtualAssistantSessions(prisma, async () => undefined);
  assert.equal(await sessions.stoppedSince(trigger, "ai_slmm", "所罗没门"), false);
  assert.deepEqual(query, { where: { channelId: 3, senderActorId: 4, type: "text", id: { gt: 10 } }, select: { content: true, payload: true }, orderBy: { id: "asc" } });
  rows = [{ content: "@所罗没门 你去睡觉吧", payload: { aiActivationSuppressed: true } }, { content: "闭嘴 " }];
  assert.equal(await sessions.stoppedSince(trigger, "ai_slmm", "所罗没门"), false);
  rows = [{ content: "@所罗没门 你去睡觉吧" }];
  assert.equal(await sessions.stoppedSince(trigger, "ai_slmm", "所罗没门"), true);
});

test("session publication and stop serialize, while different users run independently and failures release the lock", async () => {
  const sessions = createVirtualAssistantSessions({} as PrismaClient, async () => undefined);
  const events: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const first = sessions.exclusive(trigger, "ai_slmm", async () => { events.push("first"); await gate; });
  const next = sessions.exclusive(trigger, "ai_slmm", async () => { events.push("stop"); });
  await sessions.exclusive({ ...trigger, senderActorId: 5 }, "ai_slmm", async () => { events.push("other"); });
  assert.deepEqual(events, ["first", "other"]);
  release();
  await Promise.all([first, next]);
  assert.deepEqual(events, ["first", "other", "stop"]);
  await assert.rejects(sessions.exclusive(trigger, "ai_slmm", async () => { throw new Error("failed"); }), /failed/);
  assert.equal(await sessions.exclusive(trigger, "ai_slmm", async () => "recovered"), "recovered");
});
