import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { createStage } from "./stage.js";

test("the polling stage checks the exact latest human message and excludes opt-out context", async () => {
  const queries: unknown[] = [];
  let latest: { content: string; payload?: unknown } | null = { content: "问题？", payload: { aiActivationSuppressed: true } };
  const row = (id: number, content: string, kind = "human", payload?: unknown) => ({
    id, content, payload, senderActorId: id, createdAt: new Date(), sender: { displayName: `用户${id}`, kind }
  });
  const stage = createStage({ message: {
    findFirst: async (query: unknown) => { queries.push(query); return latest; },
    findMany: async () => [row(5, "普通后续"), row(4, "被清理的问题？", "human", { aiActivationSuppressed: true }), row(3, "历史问题？ "), row(2, "角色回答", "virtual"), row(1, "保留的历史")]
  } } as unknown as PrismaClient);
  assert.equal(await stage.activationSuppressed(7, 4), true);
  assert.deepEqual(queries[0], { where: { channelId: 7, id: 4, sender: { kind: "human" } }, select: { content: true, payload: true } });
  latest = { content: "旧消息？ " };
  assert.equal(await stage.activationSuppressed(7, 4), true);
  latest = null;
  assert.equal(await stage.activationSuppressed(7, 0), false);
  assert.deepEqual((await stage.getSnapshot(7, 5)).messages.map(message => message.id), [1, 2, 5]);
});
