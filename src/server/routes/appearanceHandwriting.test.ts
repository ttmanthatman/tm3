import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { createAppearanceService, registerAppearanceRoutes } from "./appearance.js";

test("handwriting settings are public to read but only an admin can change them", async () => {
  const settings = new Map<string, string>();
  const broadcasts: unknown[] = [];
  const prisma = {
    setting: {
      findMany: async () => [...settings].map(([key, value]) => ({ key, value })),
      upsert: async ({ where, update }: { where: { key: string }; update: { value: string } }) => {
        settings.set(where.key, update.value);
      }
    }
  } as unknown as PrismaClient;
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ success: false });
    return reply.send(error);
  });
  registerAppearanceRoutes(app, {
    requireAdmin: async (request, reply) => {
      if (request.headers.authorization !== "admin") return reply.code(403).send({ success: false });
    },
    appearance: createAppearanceService({ prisma }),
    io: { emit: (_event, payload) => { broadcasts.push(payload); } },
    applyFileValidation: () => false
  });

  try {
    const initial = await app.inject({ method: "GET", url: "/api/settings/appearance" });
    assert.equal(initial.statusCode, 200);
    assert.deepEqual(initial.json().handwritingSettings, {
      sensitivity: 65, lag: 35, glow: { color: "#ffffff", density: 65, width: 60 }
    });

    const body = { handwritingSettings: { sensitivity: 75, lag: 40, glow: { color: "#aabbcc", density: 72, width: 48 } } };
    const denied = await app.inject({ method: "POST", url: "/api/admin/appearance", payload: body });
    assert.equal(denied.statusCode, 403);
    assert.equal(settings.has("handwritingSettings"), false);

    const malformed = await app.inject({ method: "POST", url: "/api/admin/appearance", headers: { authorization: "admin" }, payload: { handwritingSettings: { ...body.handwritingSettings, lag: 101 } } });
    assert.equal(malformed.statusCode, 400);
    assert.equal(settings.has("handwritingSettings"), false);

    const saved = await app.inject({ method: "POST", url: "/api/admin/appearance", headers: { authorization: "admin" }, payload: body });
    assert.equal(saved.statusCode, 200);
    assert.deepEqual(saved.json().appearance.handwritingSettings, body.handwritingSettings);
    assert.deepEqual(broadcasts.at(-1), saved.json().appearance);
    const reloaded = await app.inject({ method: "GET", url: "/api/settings/appearance" });
    assert.deepEqual(reloaded.json().handwritingSettings, body.handwritingSettings);
  } finally {
    await app.close();
  }
});
