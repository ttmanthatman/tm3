import { Prisma, type PrismaClient } from "@prisma/client";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import { BIBLE_NOTE_TEXT_MAX } from "../../shared/bibleNotes.js";
import { biblePreferencesJson, cleanBiblePreferences } from "../biblePreferences.js";
import { bibleNoteDTO, bibleNoteSource } from "../services/bibleNotes.js";
import { pushOriginFromHeaders } from "../pushOrigin.js";
import type { AuthedBibleRequest, BibleRouteDependencies } from "./bible.js";

export type BibleNoteDependencies = BibleRouteDependencies & {
  canAccessChannel(accountId: number, channelId: number): Promise<boolean>;
};
const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
const selectionSchema = z.object({
  translation: z.string().min(1).max(30),
  bookCode: z.string().length(3),
  chapter: z.number().int().positive(),
  verse: z.number().int().positive()
});
const textSchema = z.string().trim().min(1).max(BIBLE_NOTE_TEXT_MAX);
const createSchema = selectionSchema.extend({ id: z.string().uuid(), text: textSchema, public: z.boolean().default(true) }).strict();
const querySchema = z.object({
  scope: z.enum(["mine", "public"]).default("public"),
  translation: z.string().min(1).max(30).optional(),
  bookCode: z.string().length(3).optional(),
  chapter: z.coerce.number().int().positive().optional(),
  verse: z.coerce.number().int().positive().optional(),
  offset: z.coerce.number().int().min(0).max(100000).default(0)
}).strict();
const noteInclude = { account: { select: { displayName: true } } };
async function lockNote(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM bible_notes WHERE id = ${id} FOR UPDATE`;
  return tx.bibleNote.findUnique({ where: { id }, include: noteInclude });
}

export async function readableBibleNote(prisma: PrismaClient, id: string, accountId: number, canAccess: BibleNoteDependencies["canAccessChannel"]) {
  const note = await prisma.bibleNote.findUnique({
    where: { id },
    include: { ...noteInclude, shares: { select: { message: { select: { channelId: true, type: true } } } } }
  });
  if (!note) throw fail(404, "笔记已删除或不可查看");
  if (note.accountId === accountId || note.publishedAt) return note;
  for (const share of note.shares)
    if (share.message.type === "bible_note" && await canAccess(accountId, share.message.channelId)) return note;
  throw fail(404, "笔记已删除或不可查看");
}

export function registerBibleNoteRoutes(app: FastifyInstance, deps: BibleNoteDependencies) {
  const { prisma } = deps;
  const requireRegular: preHandlerHookHandler = async (request) => {
    const { accountId, actorId } = (request as AuthedBibleRequest).auth;
    const account = await prisma.account.findUnique({ where: { id: accountId }, select: { isGuest: true, actor: { select: { id: true, kind: true, status: true } } } });
    if (!account || account.isGuest || account.actor?.id !== actorId || account.actor.kind !== "human" || account.actor.status !== "active") throw fail(403, "请使用成员账号查看笔记");
  };
  const preHandler = [deps.requireAuth, requireRegular];

  app.get("/api/bible/notes/preferences", { preHandler }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const account = await prisma.account.findUniqueOrThrow({ where: { id: (request as AuthedBibleRequest).auth.accountId }, select: { biblePreferences: true } });
    return { alwaysPublic: cleanBiblePreferences(account.biblePreferences).notesAlwaysPublic === true };
  });
  app.patch("/api/bible/notes/preferences", { preHandler }, async (request) => {
    const parsed = z.object({ alwaysPublic: z.boolean() }).strict().safeParse(request.body);
    if (!parsed.success) throw fail(400, "笔记公开设置无效");
    const { accountId } = (request as AuthedBibleRequest).auth;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM accounts WHERE id = ${accountId} FOR UPDATE`;
      const account = await tx.account.findUniqueOrThrow({ where: { id: accountId }, select: { biblePreferences: true } });
      await tx.account.update({ where: { id: accountId }, data: { biblePreferences: biblePreferencesJson({ ...cleanBiblePreferences(account.biblePreferences), notesAlwaysPublic: parsed.data.alwaysPublic }) } });
    });
    return { alwaysPublic: parsed.data.alwaysPublic };
  });
  app.get("/api/bible/notes/markers", { preHandler }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const q = querySchema.safeParse(request.query);
    if (!q.success || !q.data.translation || !q.data.bookCode || !q.data.chapter) throw fail(400, "章节无效");
    const { accountId } = (request as AuthedBibleRequest).auth;
    const rows = await prisma.bibleNote.findMany({ where: { translation: q.data.translation, bookCode: q.data.bookCode, chapter: q.data.chapter, OR: [{ accountId }, { publishedAt: { not: null } }] }, select: { verse: true } });
    return { verses: [...new Set(rows.map((row) => row.verse))].sort((a, b) => a - b) };
  });
  app.get("/api/bible/notes", { preHandler }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) throw fail(400, "查询条件无效");
    const q = parsed.data;
    const { accountId } = (request as AuthedBibleRequest).auth;
    const rows = await prisma.bibleNote.findMany({
      where: { ...(q.scope === "mine" ? { accountId } : { publishedAt: { not: null } }), translation: q.translation, bookCode: q.bookCode, chapter: q.chapter, verse: q.verse },
      include: noteInclude, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], skip: q.offset, take: 21
    });
    return { notes: rows.slice(0, 20).map(bibleNoteDTO), nextOffset: rows.length > 20 ? q.offset + 20 : null };
  });
  app.post("/api/bible/notes", { preHandler }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) throw fail(400, "笔记信息无效");
    const { id, text, public: published, ...selection } = parsed.data;
    let source;
    try { source = bibleNoteSource(selection); }
    catch (error) { throw fail(400, error instanceof Error ? error.message : "请选择一节经文"); }
    const { accountId } = (request as AuthedBibleRequest).auth;
    let note;
    try { note = await prisma.bibleNote.upsert({ where: { id }, update: {}, create: { id, accountId, ...selection, source: source as unknown as Prisma.InputJsonValue, text, publishedAt: published ? new Date() : null }, include: noteInclude }); }
    catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      note = await prisma.bibleNote.findUniqueOrThrow({ where: { id }, include: noteInclude });
    }
    if (note.accountId !== accountId || note.text !== text || !!note.publishedAt !== published || note.translation !== selection.translation || note.bookCode !== selection.bookCode || note.chapter !== selection.chapter || note.verse !== selection.verse) throw fail(409, "保存编号已用于另一篇笔记，请重新保存");
    reply.header("Cache-Control", "private, no-store");
    return { note: bibleNoteDTO(note) };
  });
  app.get<{ Params: { id: string } }>("/api/bible/notes/:id/recovery", { preHandler }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const { accountId } = (request as unknown as AuthedBibleRequest).auth;
    const note = await prisma.bibleNote.findFirst({ where: { id: request.params.id, accountId }, include: noteInclude });
    return { note: note ? bibleNoteDTO(note) : null };
  });
  app.get<{ Params: { id: string } }>("/api/bible/notes/:id", { preHandler }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    return { note: bibleNoteDTO(await readableBibleNote(prisma, request.params.id, (request as unknown as AuthedBibleRequest).auth.accountId, deps.canAccessChannel)) };
  });
  app.patch<{ Params: { id: string } }>("/api/bible/notes/:id", { preHandler }, async (request, reply) => {
    const parsed = z.object({ text: textSchema.optional(), public: z.boolean().optional() }).strict().refine((value) => value.text !== undefined || value.public !== undefined).safeParse(request.body);
    if (!parsed.success) throw fail(400, "笔记信息无效");
    const { accountId } = (request as unknown as AuthedBibleRequest).auth;
    const note = await prisma.$transaction(async (tx) => {
      const row = await lockNote(tx, request.params.id);
      if (!row || row.accountId !== accountId) throw fail(404, "笔记不存在");
      return tx.bibleNote.update({ where: { id: row.id }, data: { text: parsed.data.text, ...(parsed.data.public !== undefined ? { publishedAt: parsed.data.public ? row.publishedAt || new Date() : null } : {}) }, include: noteInclude });
    });
    reply.header("Cache-Control", "private, no-store");
    return { note: bibleNoteDTO(note) };
  });
  app.delete<{ Params: { id: string } }>("/api/bible/notes/:id", { preHandler }, async (request) => {
    await prisma.bibleNote.deleteMany({ where: { id: request.params.id, accountId: (request as unknown as AuthedBibleRequest).auth.accountId } });
    return { success: true };
  });
  app.post<{ Params: { id: string } }>("/api/bible/notes/:id/share", { preHandler }, async (request) => {
    const parsed = z.object({ channelId: z.number().int().positive(), clientRequestId: z.string().uuid() }).strict().safeParse(request.body);
    if (!parsed.success) throw fail(400, "分享请求无效");
    const { accountId, actorId } = (request as unknown as AuthedBibleRequest).auth;
    const channel = await prisma.channel.findUnique({ where: { id: parsed.data.channelId }, select: { id: true, kind: true } });
    if (!channel || !["standard", "direct"].includes(channel.kind) || !await deps.canWriteChannel(accountId, channel.id)) throw fail(403, "无权在该聊天室分享");
    const result = await prisma.$transaction(async (tx) => {
      const note = await lockNote(tx, request.params.id);
      if (!note || note.accountId !== accountId) throw fail(404, "笔记不存在或无权分享");
      const existing = await tx.message.findUnique({ where: { senderActorId_clientRequestId: { senderActorId: actorId, clientRequestId: parsed.data.clientRequestId } } });
      if (existing) return { message: existing, created: false };
      const source = bibleNoteDTO(note).source;
      const message = await tx.message.create({ data: { channelId: channel.id, senderActorId: actorId, clientRequestId: parsed.data.clientRequestId, type: "bible_note", content: `经文笔记 · ${source.reference}`, payload: { kind: "bible_note", noteId: note.id, reference: source.reference }, bibleNoteShare: { create: { noteId: note.id } } } });
      return { message, created: true };
    });
    const payload = result.message.payload as { noteId?: string } | null;
    if (result.message.channelId !== channel.id || result.message.type !== "bible_note" || payload?.noteId !== request.params.id) throw fail(409, "该请求已用于另一条消息");
    const message = await deps.hydrateMessage(result.message.id, accountId);
    if (!message) throw fail(404, "分享消息不存在");
    await deps.emitMessage(result.message.id);
    if (result.created) void deps.sendMessagePush(result.message.id, pushOriginFromHeaders(request.headers)).catch((error) => request.log.warn({ error, messageId: result.message.id }, "note push failed"));
    return { message };
  });
}
