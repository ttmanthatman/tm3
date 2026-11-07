import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import { registerSocialRoutes } from "./social.js";

function harness() {
  const settings = new Map<string, string>();
  const poll = { kind: "poll", question: "何时聚会？", options: ["周六", "周日"] };
  const message = { id: 10, channelId: 3, type: "text", payload: poll };
  let accountId = 7;
  let allowed = true;
  let writable = true;
  const events: unknown[] = [];
  const setting = {
    findMany: async ({ where }: { where: { key: { startsWith: string } } }) => [...settings].filter(([key]) => key.startsWith(where.key.startsWith)).map(([key, value]) => ({ key, value })),
    findUnique: async ({ where }: { where: { key: string } }) => settings.has(where.key) ? { key: where.key, value: settings.get(where.key)! } : null,
    upsert: async ({ where, create, update }: { where: { key: string }; create: { value: string }; update: { value: string } }) => { settings.set(where.key, settings.has(where.key) ? update.value : create.value); },
    create: async ({ data }: { data: { key: string; value: string } }) => { settings.set(data.key, data.value); },
    delete: async ({ where }: { where: { key: string } }) => { settings.delete(where.key); }
  };
  const tx = { setting, $queryRaw: async () => [] };
  const prisma = { setting, message: { findUnique: async () => message, upsert: async () => message }, $transaction: async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx) } as unknown as PrismaClient;
  const app = Fastify();
  registerSocialRoutes(app, { prisma, requireAuth: async (request) => { Object.assign(request, { auth: { accountId, actorId: 8 } }); }, canAccessChannel: async () => allowed, canWriteChannel: async () => writable, emitMessage: async () => {}, changed: (...event) => { events.push(event); } });
  return { app, settings, events, asReader: () => { accountId = 9; }, deny: () => { allowed = false; writable = false; }, readOnly: () => { writable = false; } };
}
test("repeat votes are idempotent and changing option moves the single vote", async (t) => {
  const h = harness(); t.after(() => h.app.close());
  for (const option of [0, 0, 1]) assert.equal((await h.app.inject({ method: "PUT", url: "/api/polls/10/vote", payload: { option } })).statusCode, 200);
  const response = await h.app.inject("/api/polls/10");
  assert.deepEqual(response.json(), { counts: [0, 1], total: 1, selected: 1 });
  assert.equal(h.settings.size, 1); assert.equal(h.events.length, 3);
});
test("foreign channels and read-only members cannot vote or throw bottles", async (t) => {
  const h = harness(); t.after(() => h.app.close()); h.deny();
  assert.equal((await h.app.inject("/api/polls/10")).statusCode, 403);
  assert.equal((await h.app.inject("/api/channels/3/bottles")).statusCode, 403);
  assert.equal((await h.app.inject({ method: "POST", url: "/api/channels/3/bottles", payload: { text: "秘密" } })).statusCode, 403);
  assert.equal(h.settings.size, 0);
});
test("invalid options cannot create votes", async (t) => {
  const h = harness(); t.after(() => h.app.close());
  for (const option of [-1, 2, .5, "0"]) assert.equal((await h.app.inject({ method: "PUT", url: "/api/polls/10/vote", payload: { option } })).statusCode, 400);
  assert.equal(h.settings.size, 0);
});
test("bottles list hides text and identity, all twelve appearances differ, and opening consumes once", async (t) => {
  const h = harness(); t.after(() => h.app.close());
  for (let i = 0; i < 12; i++) assert.equal((await h.app.inject({ method: "POST", url: "/api/channels/3/bottles", payload: { text: `秘密 ${i}` } })).statusCode, 200);
  const list = (await h.app.inject("/api/channels/3/bottles")).json().bottles as { id: string; style: number }[];
  assert.equal(list.length, 12); assert.equal(new Set(list.map((b) => b.style)).size, 12);
  assert.deepEqual(Object.keys(list[0]).sort(), ["id", "style"]);
  for (const [key, value] of h.settings) if (key.startsWith("bottle:")) assert.deepEqual(Object.keys(JSON.parse(value)).sort(), ["style", "text"]);
  assert.equal((await h.app.inject({ method: "POST", url: "/api/channels/3/bottles", payload: { text: "满了" } })).statusCode, 409);
  const url = `/api/channels/3/bottles/${list[0].id}/open`;
  h.asReader();
  const opened = await h.app.inject({ method: "POST", url });
  assert.equal(opened.statusCode, 200); assert.match(opened.json().text, /秘密/);
  assert.equal((await h.app.inject({ method: "POST", url })).statusCode, 410);
  assert.equal(h.settings.size, 23);
  const audit = JSON.parse(h.settings.get(`bottle-log:${list[0].id}`)!);
  assert.equal(audit.senderAccountId, 7);
  assert.equal(audit.readerAccountId, 9);
  assert.equal(audit.text, opened.json().text);
  assert.ok(audit.sentAt && audit.openedAt);
  assert.deepEqual(Object.keys(opened.json()).sort(), ["id", "style", "text"]);
  assert.deepEqual(h.events.at(-1), [3, undefined, list[0].id], "broadcast only the consumed bottle ID, never its text or reader");
});
test("read-only users can see shells but cannot consume bottles", async (t) => {
  const h = harness(); t.after(() => h.app.close()); h.readOnly();
  assert.equal((await h.app.inject("/api/channels/3/bottles")).statusCode, 200);
  assert.equal((await h.app.inject({ method: "POST", url: "/api/channels/3/bottles/00000000-0000-4000-8000-000000000000/open" })).statusCode, 403);
});

test("legacy bottles keep unknown senders and persist only the successful reader", async (t) => {
  const h = harness(); t.after(() => h.app.close());
  const id = "00000000-0000-4000-8000-000000000000";
  h.settings.set(`bottle:3:${id}`, JSON.stringify({ text: "旧瓶子", style: 2 }));
  const url = `/api/channels/3/bottles/${id}/open`;
  assert.equal((await h.app.inject({ method: "POST", url })).statusCode, 200);
  const audit = JSON.parse(h.settings.get(`bottle-log:${id}`)!);
  assert.equal(audit.senderAccountId, null);
  assert.equal(audit.sentAt, null);
  assert.equal(audit.readerAccountId, 7);
  h.asReader();
  assert.equal((await h.app.inject({ method: "POST", url })).statusCode, 410);
  assert.deepEqual(JSON.parse(h.settings.get(`bottle-log:${id}`)!), audit);
});
