/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import Fastify, { type FastifyRequest } from "fastify";
import type { MessageDTO } from "../../shared/types.js";
import { registerBibleRoutes } from "./bible.js";

type HarnessOptions = {
  channelKind?: "standard" | "direct" | "music" | null;
  canWrite?: boolean;
};

function createBibleRouteHarness(options: HarnessOptions = {}) {
  const state = {
    created: null as Record<string, unknown> | null,
    emitted: [] as number[],
    pushed: [] as number[]
  };
  const prisma = {
    channel: {
      findUnique: async () => (options.channelKind === null ? null : { kind: options.channelKind || "standard" })
    },
    message: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.created = data;
        return { id: 99, ...data };
      }
    }
  };
  const app = Fastify();
  const requireAuth = async (request: FastifyRequest) => {
    (request as FastifyRequest & { auth: { accountId: number; actorId: number } }).auth = { accountId: 1, actorId: 7 };
  };
  registerBibleRoutes(app, {
    prisma: prisma as unknown as PrismaClient,
    requireAuth,
    canWriteChannel: async () => options.canWrite !== false,
    emitMessage: async (id: number) => {
      state.emitted.push(id);
    },
    sendMessagePush: async (id: number) => {
      state.pushed.push(id);
    },
    hydrateMessage: async (id: number) => ({ id }) as unknown as MessageDTO
  });
  return { app, state };
}

const validBody = {
  channelId: 10,
  panes: [
    { bookCode: "MAT", chapter: 3, verseStart: 13, verseEnd: 17 },
    { bookCode: "MRK", chapter: 1, verseStart: 9, verseEnd: 11 }
  ],
  orientation: "columns",
  receivingIndex: 1
};

test("bible session share creates a message with a server-cleaned payload", async () => {
  const { app, state } = createBibleRouteHarness();
  const response = await app.inject({ method: "POST", url: "/api/bible/share", payload: validBody });
  assert.equal(response.statusCode, 200);
  const created = state.created as { type: string; content: string; channelId: number; senderActorId: number; payload: Record<string, unknown> };
  assert.equal(created.type, "bible_session");
  assert.equal(created.channelId, 10);
  assert.equal(created.senderActorId, 7);
  assert.equal(created.payload.kind, "bible_session");
  const panes = created.payload.panes as Array<{ bookCode: string; bookName: string; chapter: number; verseStart: number }>;
  // bookName 以服务端目录为准
  assert.deepEqual(panes.map((pane) => [pane.bookCode, pane.bookName, pane.chapter]), [
    ["MAT", "马太福音", 3],
    ["MRK", "马可福音", 1]
  ]);
  assert.equal(created.payload.receivingIndex, 1);
  assert.match(created.content, /2 个圣经窗格/);
  assert.deepEqual(state.emitted, [99]);
  assert.deepEqual(state.pushed, [99]);
});

test("bible session share uses the description as message content when provided", async () => {
  const { app, state } = createBibleRouteHarness();
  const response = await app.inject({ method: "POST", url: "/api/bible/share", payload: { ...validBody, description: "今晚一起读这段" } });
  assert.equal(response.statusCode, 200);
  assert.equal((state.created as { content: string }).content, "今晚一起读这段");
  assert.equal(((state.created as { payload: { description?: string } }).payload.description), "今晚一起读这段");
});

test("bible session share rejects malformed payloads", async () => {
  const { app } = createBibleRouteHarness();
  for (const payload of [
    {},
    { channelId: 10, panes: [] },
    { channelId: 10, panes: [{ bookCode: "MAT", chapter: 0 }] },
    { channelId: 10, panes: [{ bookCode: "MAT", chapter: 3, verseStart: 17, verseEnd: 13 }] },
    { channelId: 10, panes: Array.from({ length: 5 }, () => ({ bookCode: "MAT", chapter: 3 })) }
  ]) {
    const response = await app.inject({ method: "POST", url: "/api/bible/share", payload });
    assert.equal(response.statusCode, 400, JSON.stringify(payload));
  }
});

test("bible session share rejects unknown books and out-of-range chapters", async () => {
  const { app } = createBibleRouteHarness();
  for (const pane of [{ bookCode: "XYZ", chapter: 1 }, { bookCode: "MAT", chapter: 29 }]) {
    const response = await app.inject({ method: "POST", url: "/api/bible/share", payload: { channelId: 10, panes: [pane] } });
    assert.equal(response.statusCode, 400, JSON.stringify(pane));
  }
});

test("bible session share requires a writable chat channel", async () => {
  for (const options of [{ channelKind: null }, { channelKind: "music" as const }, { canWrite: false }]) {
    const { app, state } = createBibleRouteHarness(options);
    const response = await app.inject({ method: "POST", url: "/api/bible/share", payload: validBody });
    assert.equal(response.statusCode, 400, JSON.stringify(options));
    assert.equal(state.created, null);
  }
});

test("bible session share normalizes an out-of-range receiving index", async () => {
  const { app, state } = createBibleRouteHarness();
  const response = await app.inject({ method: "POST", url: "/api/bible/share", payload: { channelId: 10, panes: [{ bookCode: "MAT", chapter: 3 }], receivingIndex: 3 } });
  assert.equal(response.statusCode, 200);
  assert.equal((state.created as { payload: { receivingIndex: number | null } }).payload.receivingIndex, null);
});
