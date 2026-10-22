import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { createAssistantToolRegistry } from "../services/assistantTools.js";
import { createAssistantToolsSettingsStore, registerAssistantToolsRoutes } from "./assistantTools.js";

test("admin settings persist global policy, discover additions automatically, and deny non-admins", async () => {
  const rows = new Map<string, string>();
  const prisma = { setting: {
    findMany: async () => [...rows].map(([key, value]) => ({ key, value })),
    upsert: async ({ create }: { create: { key: string; value: string } }) => { rows.set(create.key, create.value); return create; }
  }, $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations) } as unknown as PrismaClient;
  const app = Fastify();
  const registry = createAssistantToolRegistry(async () => true);
  registerAssistantToolsRoutes(app, { registry, settings: createAssistantToolsSettingsStore(prisma), requireAdmin: async (request, reply) => {
    if (request.headers.authorization !== "admin") return reply.code(request.headers.authorization ? 403 : 401).send({ success: false });
  } });
  const headers = { authorization: "admin" };
  try {
    assert.equal((await app.inject({ url: "/api/admin/assistant-tools" })).statusCode, 401);
    assert.equal((await app.inject({ url: "/api/admin/assistant-tools", headers: { authorization: "member" } })).statusCode, 403);
    assert.deepEqual((await app.inject({ url: "/api/admin/assistant-tools", headers })).json(), { enabled: true, maxCalls: 8, functions: [] });
    for (const payload of [{ enabled: true, maxCalls: 0 }, { enabled: true, maxCalls: 13 }, { enabled: true, maxCalls: 1.5 }, { enabled: false, maxCalls: 3, allowDelete: true }])
      assert.equal((await app.inject({ method: "POST", url: "/api/admin/assistant-tools", headers, payload })).statusCode, 400);
    assert.equal(rows.size, 0);
    assert.equal((await app.inject({ method: "POST", url: "/api/admin/assistant-tools", headers, payload: { enabled: false, maxCalls: 3 } })).statusCode, 200);
    registry.register({ name: "read_future_feature", description: "新功能", kind: "read", input: {}, schema: z.object({}), execute: async () => ({ data: [] }) });
    const saved = (await app.inject({ url: "/api/admin/assistant-tools", headers })).json();
    assert.equal(saved.enabled, false);
    assert.equal(saved.maxCalls, 3);
    assert.equal(saved.functions[0].name, "read_future_feature");
  } finally { await app.close(); }
});
