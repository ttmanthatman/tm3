import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import Fastify, { type FastifyRequest } from "fastify";
import type { BibleNote, Prisma, PrismaClient } from "@prisma/client";
import type { MessageDTO } from "../../shared/types.js";
import { readableBibleNote, registerBibleNoteRoutes } from "./bibleNotes.js";

const selection = { translation: "cmn-cu89s", bookCode: "JHN", chapter: 11, verse: 35 };
type Row = BibleNote & { account: { displayName: string }; shares: Array<{ message: { channelId: number; type: string } }> };
type Filter = { accountId?: number; publishedAt?: { not: null }; translation?: string; bookCode?: string; chapter?: number; verse?: number; OR?: Filter[] };
function matches(row: Row, where: Filter): boolean {
  return (!where.accountId || row.accountId === where.accountId) && (!where.publishedAt || !!row.publishedAt) &&
    (!where.translation || row.translation === where.translation) && (!where.bookCode || row.bookCode === where.bookCode) &&
    (!where.chapter || row.chapter === where.chapter) && (!where.verse || row.verse === where.verse) && (!where.OR || where.OR.some((clause) => matches(row, clause)));
}
async function harness() {
  const rows: Row[] = [];
  const messages: Array<{ id: number; channelId: number; type: string; payload: Prisma.JsonValue; senderActorId: number; clientRequestId: string }> = [];
  const preferences = new Map<number, Prisma.JsonValue>();
  let channelAccess = false;
  let writable = true;
  let pushes = 0;
  const prisma = {
    account: {
      findUnique: async ({ where }: { where: { id: number } }) => ({ isGuest: where.id === 3, actor: { id: where.id, kind: where.id === 4 ? "virtual" : "human", status: "active" }, biblePreferences: preferences.get(where.id) || null }),
      findUniqueOrThrow: async ({ where }: { where: { id: number } }) => ({ biblePreferences: preferences.get(where.id) || null }),
      update: async ({ where, data }: { where: { id: number }; data: { biblePreferences: Prisma.JsonValue } }) => { preferences.set(where.id, data.biblePreferences); }
    },
    bibleNote: {
      upsert: async ({ where, create }: { where: { id: string }; create: Omit<BibleNote, "createdAt" | "updatedAt"> }) => {
        const existing = rows.find((row) => row.id === where.id);
        if (existing) return existing;
        const row = { ...create, createdAt: new Date(), updatedAt: new Date(), account: { displayName: `Member ${create.accountId}` }, shares: [] };
        rows.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { id: string } }) => rows.find((row) => row.id === where.id) || null,
      findFirst: async ({ where }: { where: { id: string; accountId: number } }) => rows.find((row) => row.id === where.id && row.accountId === where.accountId) || null,
      findMany: async ({ where, skip = 0, take = 100 }: { where: Filter; skip?: number; take?: number }) => rows.filter((row) => matches(row, where)).slice(skip, skip + take),
      update: async ({ where, data }: { where: { id: string }; data: { text?: string; publishedAt?: Date | null } }) => {
        const row = rows.find((item) => item.id === where.id)!;
        if (data.text !== undefined) row.text = data.text;
        if (data.publishedAt !== undefined) row.publishedAt = data.publishedAt;
        row.updatedAt = new Date();
        return row;
      },
      deleteMany: async ({ where }: { where: { id: string; accountId: number } }) => { const index = rows.findIndex((row) => row.id === where.id && row.accountId === where.accountId); if (index >= 0) rows.splice(index, 1); return { count: index >= 0 ? 1 : 0 }; }
    },
    channel: { findUnique: async () => ({ id: 1, kind: "standard" }) },
    message: {
      findUnique: async ({ where }: { where: { senderActorId_clientRequestId: { senderActorId: number; clientRequestId: string } } }) => messages.find((message) => message.senderActorId === where.senderActorId_clientRequestId.senderActorId && message.clientRequestId === where.senderActorId_clientRequestId.clientRequestId) || null,
      create: async ({ data }: { data: Omit<(typeof messages)[number], "id"> & { bibleNoteShare: { create: { noteId: string } } } }) => {
        const message = { ...data, id: messages.length + 1 };
        messages.push(message);
        rows.find((row) => row.id === data.bibleNoteShare.create.noteId)!.shares.push({ message });
        return message;
      }
    },
    $queryRaw: async () => [],
    $transaction: async (run: (tx: Prisma.TransactionClient) => Promise<unknown>) => run(prisma as unknown as Prisma.TransactionClient)
  };
  const app = Fastify();
  registerBibleNoteRoutes(app, {
    prisma: prisma as unknown as PrismaClient,
    requireAuth: async (request: FastifyRequest, reply) => { if (request.headers["x-account"] === "none") { reply.code(401).send({ message: "请登录" }); return; } const id = Number(request.headers["x-account"] || 1); Object.assign(request, { auth: { accountId: id, actorId: id } }); },
    canAccessChannel: async () => channelAccess,
    canWriteChannel: async () => writable,
    emitMessage: async () => undefined,
    sendMessagePush: async () => { pushes++; },
    hydrateMessage: async (id) => messages.find((message) => message.id === id) as unknown as MessageDTO
  });
  return { app, rows, messages, preferences, prisma: prisma as unknown as PrismaClient, pushes: () => pushes, setAccess: (value: boolean) => { channelAccess = value; }, setWritable: (value: boolean) => { writable = value; } };
}

test("Bible note transport validates canonical verse and regular account, with retry-safe creation", async () => {
  const h = await harness();
  try {
    const body = { ...selection, id: crypto.randomUUID(), text: "  记住神的爱  ", public: false };
    for (const payload of [{ ...body, verse: 999 }, { ...body, translation: "injected" }, { ...body, verseEnd: 36 }, { ...body, text: " " }, { ...body, text: "x".repeat(10001) }]) assert.equal((await h.app.inject({ method: "POST", url: "/api/bible/notes", payload })).statusCode, 400);
    for (const account of ["3", "4"]) assert.equal((await h.app.inject({ method: "POST", url: "/api/bible/notes", headers: { "x-account": account }, payload: body })).statusCode, 403);
    assert.equal((await h.app.inject({ url: "/api/bible/notes", headers: { "x-account": "none" } })).statusCode, 401);
    const first = await h.app.inject({ method: "POST", url: "/api/bible/notes", payload: body });
    assert.equal(first.statusCode, 200, first.body);
    assert.match(first.json().note.source.text, /耶稣哭了/);
    assert.equal(first.json().note.text, "记住神的爱");
    assert.equal(first.json().note.publishedAt, null);
    assert.equal((await h.app.inject({ method: "POST", url: "/api/bible/notes", payload: body })).statusCode, 200);
    assert.equal(h.rows.length, 1);
    assert.equal((await h.app.inject({ method: "POST", url: "/api/bible/notes", payload: { ...body, text: "different" } })).statusCode, 409);
    assert.equal((await h.app.inject({ method: "POST", url: "/api/bible/notes", headers: { "x-account": "2" }, payload: body })).statusCode, 409);
    const publicNote = await h.app.inject({ method: "POST", url: "/api/bible/notes", payload: { ...selection, id: crypto.randomUUID(), text: "公开笔记" } });
    assert.ok(publicNote.json().note.publishedAt);
  } finally { await h.app.close(); }
});

test("private notes stay out of lists and markers; owners can publish, edit and delete", async () => {
  const h = await harness();
  try {
    const id = crypto.randomUUID();
    await h.app.inject({ method: "POST", url: "/api/bible/notes", payload: { ...selection, id, text: "私密", public: false } });
    const markers = `/api/bible/notes/markers?translation=${selection.translation}&bookCode=JHN&chapter=11`;
    const asReader = { "x-account": "2" };
    assert.deepEqual((await h.app.inject({ url: markers })).json().verses, [35]);
    assert.deepEqual((await h.app.inject({ url: markers, headers: asReader })).json().verses, []);
    assert.equal((await h.app.inject({ url: `/api/bible/notes/${id}`, headers: asReader })).statusCode, 404);
    assert.deepEqual((await h.app.inject({ url: "/api/bible/notes?scope=public" })).json().notes, []);
    assert.equal((await h.app.inject({ url: "/api/bible/notes?scope=mine" })).json().notes.length, 1);
    assert.equal((await h.app.inject({ method: "PATCH", url: `/api/bible/notes/${id}`, headers: asReader, payload: { public: true } })).statusCode, 404);
    const updated = await h.app.inject({ method: "PATCH", url: `/api/bible/notes/${id}`, payload: { public: true, text: "大家一起看" } });
    assert.equal(updated.statusCode, 200, updated.body);
    assert.equal(updated.json().note.text, "大家一起看");
    assert.deepEqual((await h.app.inject({ url: markers, headers: asReader })).json().verses, [35]);
    assert.equal((await h.app.inject({ url: `/api/bible/notes/${id}`, headers: asReader })).statusCode, 200);
    await h.app.inject({ method: "DELETE", url: `/api/bible/notes/${id}`, headers: asReader });
    assert.equal(h.rows.length, 1);
    await h.app.inject({ method: "DELETE", url: `/api/bible/notes/${id}` });
    assert.equal((await h.app.inject({ url: `/api/bible/notes/${id}` })).statusCode, 404);
  } finally { await h.app.close(); }
});

test("note sharing grants only live channel access, revokes on recall, and deduplicates retries", async () => {
  const h = await harness();
  try {
    const id = crypto.randomUUID();
    await h.app.inject({ method: "POST", url: "/api/bible/notes", payload: { ...selection, id, text: "私密内容不要出现在消息中", public: false } });
    const url = `/api/bible/notes/${id}/share`;
    const body = { channelId: 1, clientRequestId: crypto.randomUUID() };
    assert.equal((await h.app.inject({ method: "POST", url, headers: { "x-account": "2" }, payload: body })).statusCode, 404);
    h.setWritable(false);
    assert.equal((await h.app.inject({ method: "POST", url, payload: body })).statusCode, 403);
    h.setWritable(true);
    const shared = await h.app.inject({ method: "POST", url, payload: body });
    assert.equal(shared.statusCode, 200, shared.body);
    assert.equal(shared.json().message.type, "bible_note");
    assert.deepEqual(shared.json().message.payload, { kind: "bible_note", noteId: id, reference: "约翰福音 11:35" });
    assert.equal(JSON.stringify(shared.json().message).includes("私密内容"), false);
    assert.equal((await h.app.inject({ method: "POST", url, payload: body })).statusCode, 200);
    assert.equal(h.messages.length, 1);
    assert.equal(h.pushes(), 1);
    await assert.rejects(readableBibleNote(h.prisma, id, 2, async () => false));
    h.setAccess(true);
    assert.equal((await h.app.inject({ url: `/api/bible/notes/${id}`, headers: { "x-account": "2" } })).statusCode, 200);
    assert.deepEqual((await h.app.inject({ url: "/api/bible/notes/markers?translation=cmn-cu89s&bookCode=JHN&chapter=11", headers: { "x-account": "2" } })).json().verses, []);
    h.messages[0].type = "system";
    assert.equal((await h.app.inject({ url: `/api/bible/notes/${id}`, headers: { "x-account": "2" } })).statusCode, 404);
    assert.equal((await h.app.inject({ method: "POST", url, payload: body })).statusCode, 409);
  } finally { await h.app.close(); }
});

test("always-public preference is merged with existing Bible reader preferences", async () => {
  const h = await harness();
  try {
    h.preferences.set(1, { outputFormat: "numberedVerses", quotationStyle: "square" });
    assert.deepEqual((await h.app.inject({ url: "/api/bible/notes/preferences" })).json(), { alwaysPublic: false });
    const saved = await h.app.inject({ method: "PATCH", url: "/api/bible/notes/preferences", payload: { alwaysPublic: true } });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.deepEqual((await h.app.inject({ url: "/api/bible/notes/preferences" })).json(), { alwaysPublic: true });
    assert.equal((h.preferences.get(1) as Prisma.JsonObject).outputFormat, "numberedVerses");
    assert.equal((h.preferences.get(1) as Prisma.JsonObject).quotationStyle, "square");
    assert.equal((await h.app.inject({ method: "PATCH", url: "/api/bible/notes/preferences", payload: { alwaysPublic: "yes" } })).statusCode, 400);
  } finally { await h.app.close(); }
});

test("note recovery returns only the owner's note without exposing other owners or missing notes", async () => {
  const h = await harness();
  try {
    const id = crypto.randomUUID();
    const url = `/api/bible/notes/${id}/recovery`;
    const missing = await h.app.inject({ url });
    assert.equal(missing.statusCode, 200, missing.body);
    assert.deepEqual(missing.json(), { note: null });
    assert.equal(missing.headers["cache-control"], "private, no-store");
    await h.app.inject({ method: "POST", url: "/api/bible/notes", payload: { ...selection, id, text: "可恢复的草稿", public: false } });
    const own = await h.app.inject({ url });
    assert.equal(own.statusCode, 200, own.body);
    assert.equal(own.json().note.id, id);
    assert.equal(own.json().note.accountId, 1);
    assert.equal(own.json().note.text, "可恢复的草稿");
    assert.equal(own.headers["cache-control"], "private, no-store");
    const otherOwner = await h.app.inject({ url, headers: { "x-account": "2" } });
    assert.equal(otherOwner.statusCode, 200, otherOwner.body);
    assert.deepEqual(otherOwner.json(), { note: null });
    await h.app.inject({ method: "PATCH", url: `/api/bible/notes/${id}`, payload: { public: true } });
    assert.deepEqual((await h.app.inject({ url, headers: { "x-account": "2" } })).json(), { note: null });
    assert.equal((await h.app.inject({ url, headers: { "x-account": "3" } })).statusCode, 403);
    assert.equal((await h.app.inject({ url, headers: { "x-account": "none" } })).statusCode, 401);
    assert.equal(h.rows.length, 1);
  } finally { await h.app.close(); }
});
