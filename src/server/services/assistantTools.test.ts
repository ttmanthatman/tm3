import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { createAssistantToolRegistry } from "./assistantTools.js";
import { registerAssistantChatFunctions } from "./assistantChatFunctions.js";

const context = { accountId: 7, channelId: 20, triggerMessageId: 30, assistantActorId: 9 };

test("new registered capabilities are discovered automatically and unauthorized/invalid calls never execute", async () => {
  let allowed = true;
  let executions = 0;
  const registry = createAssistantToolRegistry(async input => { assert.deepEqual(input, context); return allowed; });
  registry.register({ name: "read_new_feature", description: "未来功能", kind: "read", input: { query: "文字" },
    schema: z.object({ query: z.string() }).strict(), execute: async ({ query }) => { executions++; return { data: query }; } });
  assert.equal(registry.list()[0].name, "read_new_feature");
  await assert.rejects(registry.execute("read_new_feature", { query: "ok", accountId: 99 }, context));
  assert.equal(executions, 0);
  assert.deepEqual(await registry.execute("read_new_feature", { query: "ok" }, context), { data: "ok" });
  allowed = false;
  await assert.rejects(registry.execute("read_new_feature", { query: "ok" }, context), /无权/);
  await assert.rejects(registry.execute("delete_channel", {}, context), /不允许/);
  await assert.rejects(registry.execute("https://example.invalid/api", {}, context), /不允许/);
  assert.equal(executions, 1);
  for (const name of ["delete_channel", "leave_channel", "logout", "account_settings", "admin_backup"]) {
    assert.throws(() => registry.register({ name, description: "禁止", kind: "present", input: {}, schema: z.object({}), execute: async () => ({ data: null }) }), /cannot be delegated/);
  }
});

test("channel searches cannot select another channel; books omit private progress and internal paths", async () => {
  const queries: unknown[] = [];
  const prisma = {
    message: { findMany: async (query: unknown) => { queries.push(query); return [{ id: 1, content: "<p>本频道的内容</p>", type: "text", createdAt: new Date(0), sender: { displayName: "用户" } }]; } },
    book: { findMany: async (query: unknown) => { queries.push(query); return [{ id: 1, title: "书", author: "作者", language: "zh" }]; } }
  } as unknown as PrismaClient;
  const registry = createAssistantToolRegistry(async () => true);
  registerAssistantChatFunctions(registry, { prisma, searchMusic: async () => ({}), friendPrograms: async () => [] });
  await assert.rejects(registry.execute("search_current_channel", { query: "秘密", channelId: 99 }, context));
  assert.equal(queries.length, 0);
  const result = await registry.execute("search_current_channel", { query: "内容" }, context);
  assert.deepEqual(result.data, [{ id: 1, type: "text", sender: "用户", text: "本频道的内容", at: new Date(0).toISOString() }]);
  assert.deepEqual((queries[0] as { where: unknown }).where, { channelId: 20, id: { lte: 30 }, type: { in: ["text", "prayer", "grace", "chain"] }, content: { contains: "内容" } });
  await registry.execute("search_books", {}, context);
  assert.deepEqual((queries[1] as { select: unknown }).select, { id: true, title: true, author: true, language: true });
  const presented = await registry.execute("open_feature", { feature: "help" }, context);
  assert.deepEqual(presented.messages?.[0].payload, { assistantActions: [{ feature: "help", label: "打开使用说明" }] });
  await assert.rejects(registry.execute("open_feature", { feature: "delete_channel" }, context));
  await assert.rejects(registry.execute("open_feature", { feature: "channels", url: "/api/channels/1" }, context));
});
