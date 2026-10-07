import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { createAppearanceService, registerAppearanceRoutes } from "./appearance.js";

test("Bible swipe settings default on, validate booleans, require admin and broadcast persisted changes", async () => {
  const settings = new Map<string, string>();
  const broadcasts: unknown[] = [];
  const prisma = { setting: {
    findMany: async () => [...settings].map(([key, value]) => ({ key, value })),
    upsert: async ({ where, update }: { where: { key: string }; update: { value: string } }) => { settings.set(where.key, update.value); }
  } } as unknown as PrismaClient;
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ success: false });
    return reply.send(error);
  });
  registerAppearanceRoutes(app, {
    requireAdmin: async (request, reply) => { if (request.headers.authorization !== "admin") return reply.code(403).send({ success: false }); },
    appearance: createAppearanceService({ prisma }),
    io: { emit: (_event, payload) => { broadcasts.push(payload); } },
    applyFileValidation: () => false
  });
  try {
    const initial = (await app.inject({ method: "GET", url: "/api/settings/appearance" })).json();
    assert.equal(initial.bibleSwipeEnabled, true);
    assert.equal(initial.bibleSwipeProtectInteractions, true);
    const update = (payload: Record<string, unknown>, admin = true) => app.inject({ method: "POST", url: "/api/admin/appearance", headers: admin ? { authorization: "admin" } : {}, payload });
    assert.equal((await update({ bibleSwipeEnabled: false }, false)).statusCode, 403);
    for (const key of ["bibleSwipeEnabled", "bibleSwipeProtectInteractions"]) {
      assert.equal((await update({ [key]: "false" })).statusCode, 400);
    }
    assert.equal(settings.size, 0);
    const saved = await update({ bibleSwipeEnabled: false, bibleSwipeProtectInteractions: false });
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.json().appearance.bibleSwipeEnabled, false);
    assert.equal(saved.json().appearance.bibleSwipeProtectInteractions, false);
    assert.deepEqual(broadcasts.at(-1), saved.json().appearance);
    await update({ appTitle: "New title" });
    const reloaded = (await app.inject({ method: "GET", url: "/api/settings/appearance" })).json();
    assert.equal(reloaded.bibleSwipeEnabled, false);
    assert.equal(reloaded.bibleSwipeProtectInteractions, false);
    await update({ bibleSwipeEnabled: true });
    const enabled = (await app.inject({ method: "GET", url: "/api/settings/appearance" })).json();
    assert.equal(enabled.bibleSwipeEnabled, true);
    assert.equal(enabled.bibleSwipeProtectInteractions, false);
  } finally { await app.close(); }
});
