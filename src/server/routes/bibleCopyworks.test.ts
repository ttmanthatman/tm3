import assert from "node:assert/strict";
import test from "node:test";
import Fastify, { type FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import { readableCopywork, registerBibleCopyworkRoutes } from "./bibleCopyworks.js";
test("private ink requires ownership or a live channel share; recalled shares cannot grant access", async () => {
  let publishedAt: Date | null = null;
  let type = "bible_copywork";
  let completedAt: Date | null = new Date();
  const prisma = {
    bibleCopywork: {
      findUnique: async () => ({
        id: "test",
        accountId: 1,
        publishedAt,
        completedAt,
        shares: [{ message: { channelId: 2, type } }]
      })
    }
  } as unknown as PrismaClient;
  await assert.rejects(
    readableCopywork(prisma, "test", 3, async () => false),
    /不可查看/
  );
  assert.ok(await readableCopywork(prisma, "test", 1, async () => false));
  assert.ok(await readableCopywork(prisma, "test", 3, async () => true));
  type = "system";
  await assert.rejects(readableCopywork(prisma, "test", 3, async () => true));
  publishedAt = new Date();
  assert.ok(await readableCopywork(prisma, "test", 3, async () => false));
  completedAt = null;
  await assert.rejects(readableCopywork(prisma, "test", 1, async () => true));
});
test("source and upload transport reject malformed input before touching storage", async () => {
  const app = Fastify();
  registerBibleCopyworkRoutes(app, {
    prisma: {} as PrismaClient,
    requireAuth: async (request: FastifyRequest) => {
      Object.assign(request, { auth: { accountId: 1, actorId: 1 } });
    },
    canAccessChannel: async () => false,
    canWriteChannel: async () => false,
    emitMessage: async () => undefined,
    sendMessagePush: async () => undefined,
    hydrateMessage: async () => null
  });
  try {
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/bible/copyworks/source",
          payload: { text: "injected" }
        })
      ).statusCode,
      400
    );
    assert.equal(
      (await app.inject({ method: "PUT", url: "/api/bible/copyworks/test/glyphs/0", payload: {} }))
        .statusCode,
      400
    );
    assert.equal(
      (
        await app.inject({
          method: "PATCH",
          url: "/api/bible/copyworks/test",
          payload: { published: true, accountId: 99 }
        })
      ).statusCode,
      400
    );
  } finally {
    await app.close();
  }
});
