import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import Fastify, { type FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { MessageDTO } from "../../shared/types.js";
import { registerStoryGraceRoutes } from "./storyGrace.js";

async function harness(options: { unauthenticated?: boolean; guest?: boolean; actorKind?: string; channelKind?: string; noChannel?: boolean; canWrite?: boolean; ownerId?: number; failure?: boolean } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "story-grace-route-"));
  const cards: Array<MessageDTO & { clientRequestId: string; clientRequestHash: string }> = [];
  const broadcasts: number[] = [];
  const pushes: number[] = [];
  const tx = { message: { create: async ({ data }: { data: { clientRequestId: string; clientRequestHash: string; channelId: number; content: string; payload: unknown } }) => {
    if (options.failure) throw new Error("private storage details");
    const card = { ...data, id: cards.length + 1, type: "grace" as const, sender: { id: 22, kind: "human" as const, username: "writer", displayName: "作者" }, createdAt: new Date().toISOString() };
    cards.push(card);
    return card;
  } } };
  const prisma = {
    account: { findUnique: async () => ({ isGuest: !!options.guest, actor: { id: 22, kind: options.actorKind || "human" } }) },
    channel: { findUnique: async () => options.noChannel ? null : { kind: options.channelKind || "standard" } },
    story: { findFirst: async ({ where }: { where: { id: number; accountId: number } }) => where.id === 17 && where.accountId === (options.ownerId ?? 2) ? { id: 17, text: "今天 & 明天\n平安", media: [] } : null },
    message: { findUnique: async ({ where }: { where: { senderActorId_clientRequestId: { clientRequestId: string } } }) => cards.find((card) => card.clientRequestId === where.senderActorId_clientRequestId.clientRequestId) || null },
    $transaction: async (action: (transaction: typeof tx) => Promise<unknown>) => action(tx)
  } as unknown as PrismaClient;
  const app = Fastify();
  app.addHook("onClose", () => fs.rm(root, { recursive: true, force: true }));
  registerStoryGraceRoutes(app, {
    prisma, directories: { stories: path.join(root, "stories"), uploads: path.join(root, "uploads") },
    requireAuth: async (request, reply) => {
      if (options.unauthenticated) return reply.code(401).send({ message: "请先登录" });
      (request as FastifyRequest & { auth: { accountId: number; actorId: number } }).auth = { accountId: 2, actorId: 22 };
    },
    canWriteChannel: async () => options.canWrite !== false,
    hydrateMessage: async (id) => cards.find((card) => card.id === id) || null,
    emitMessage: async (id) => { broadcasts.push(id); },
    sendMessagePush: async (id) => { pushes.push(id); }
  });
  return { app, cards, broadcasts, pushes };
}
const body = () => ({ channelId: 7, clientRequestId: crypto.randomUUID() });

test("forward returns one grace DTO and only broadcasts/notifies newly created cards", async () => {
  for (const channelKind of ["standard", "direct"]) {
    const h = await harness({ channelKind });
    try {
      const payload = body();
      const first = await h.app.inject({ method: "POST", url: "/api/stories/17/forward-grace", payload });
      assert.equal(first.statusCode, 200, first.body);
      assert.equal(first.json().success, true);
      assert.equal(first.json().message.type, "grace");
      assert.equal(first.json().message.content, "今天 &amp; 明天<br />平安");
      const retry = await h.app.inject({ method: "POST", url: "/api/stories/17/forward-grace", payload });
      assert.equal(retry.json().message.id, first.json().message.id);
      assert.equal(h.cards.length, 1);
      assert.deepEqual(h.broadcasts, [1]);
      assert.deepEqual(h.pushes, [1]);
      assert.equal((await h.app.inject({ method: "POST", url: "/api/stories/18/forward-grace", payload })).statusCode, 409);
    } finally { await h.app.close(); }
  }
});

test("forward enforces identity, own-story access, target kinds and write permission", async () => {
  const scenarios = [
    { options: { unauthenticated: true }, status: 401 }, { options: { guest: true }, status: 403 },
    { options: { actorKind: "virtual" }, status: 403 }, { options: { ownerId: 3 }, status: 404 },
    { options: { canWrite: false }, status: 403 }, { options: { noChannel: true }, status: 400 },
    ...["music", "aiLounge", "reception"].map((channelKind) => ({ options: { channelKind }, status: 400 }))
  ];
  for (const { options, status } of scenarios) {
    const h = await harness(options);
    try {
      assert.equal((await h.app.inject({ method: "POST", url: "/api/stories/17/forward-grace", payload: body() })).statusCode, status);
      assert.equal(h.cards.length, 0);
      assert.deepEqual(h.broadcasts, []);
    } finally { await h.app.close(); }
  }
});

test("malformed requests fail before saving, and unexpected failures stay public-safe", async () => {
  const h = await harness();
  try {
    for (const payload of [{ channelId: 7 }, { ...body(), clientRequestId: "bad" }, { ...body(), channelId: -1 }, { ...body(), channelId: Number.MAX_SAFE_INTEGER + 1 }, { ...body(), content: "forged" }]) {
      assert.equal((await h.app.inject({ method: "POST", url: "/api/stories/17/forward-grace", payload })).statusCode, 400);
    }
    assert.equal((await h.app.inject({ method: "POST", url: "/api/stories/bad/forward-grace", payload: body() })).statusCode, 400);
    assert.equal(h.cards.length, 0);
  } finally { await h.app.close(); }
  const failed = await harness({ failure: true });
  try {
    const response = await failed.app.inject({ method: "POST", url: "/api/stories/17/forward-grace", payload: body() });
    assert.equal(response.statusCode, 500);
    assert.equal(response.json().message, "转发失败，请稍后重试");
    assert.deepEqual(failed.broadcasts, []);
  } finally { await failed.app.close(); }
});
