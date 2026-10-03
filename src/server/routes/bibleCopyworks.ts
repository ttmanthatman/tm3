import { Prisma, type PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  COPYWORK_MAX_BYTES,
  COPYWORK_MAX_POINTS,
  copyworkCharacters,
  layoutCopywork,
  normalizeCopyworkGlyph,
  type CopyworkSpacing
} from "../../shared/bibleCopywork.js";
import { copyworkDTO, copyworkManifest, copyworkSource } from "../services/bibleCopyworks.js";
import type { AuthedBibleRequest, BibleRouteDependencies } from "./bible.js";
import { pushOriginFromHeaders } from "../pushOrigin.js";

export type CopyworkDependencies = BibleRouteDependencies & {
  canAccessChannel(accountId: number, channelId: number): Promise<boolean>;
};
const selectionSchema = z
  .object({
    translation: z.string().max(30),
    bookCode: z.string().length(3),
    chapter: z.number().int().positive(),
    verseStart: z.number().int().positive(),
    verseEnd: z.number().int().positive()
  })
  .strict();
const createSchema = selectionSchema.extend({
  id: z.string().uuid(),
  spacing: z.enum(["compact", "normal", "loose"])
});
const querySchema = z.object({
  scope: z.enum(["mine", "public"]).default("public"),
  translation: z.string().max(30).optional(),
  bookCode: z.string().length(3).optional(),
  chapter: z.coerce.number().int().positive().optional(),
  verse: z.coerce.number().int().positive().optional(),
  offset: z.coerce.number().int().min(0).max(100000).default(0)
});
const asJson = (value: unknown) => value as Prisma.InputJsonValue;
const fail = (statusCode: number, message: string) =>
  Object.assign(new Error(message), { statusCode });
async function lockWork(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM bible_copyworks WHERE id = ${id} FOR UPDATE`;
  return tx.bibleCopywork.findUnique({ where: { id } });
}
export async function readableCopywork(
  prisma: PrismaClient,
  id: string,
  accountId: number,
  canAccess: CopyworkDependencies["canAccessChannel"]
) {
  const work = await prisma.bibleCopywork.findUnique({
    where: { id },
    include: {
      account: { select: { displayName: true } },
      shares: { select: { message: { select: { channelId: true, type: true } } } }
    }
  });
  if (!work?.completedAt) throw fail(404, "作品已删除或不可查看");
  if (work.accountId === accountId || work.publishedAt) return work;
  for (const share of work.shares)
    if (
      share.message.type === "bible_copywork" &&
      (await canAccess(accountId, share.message.channelId))
    )
      return work;
  throw fail(404, "作品已删除或不可查看");
}
export function registerBibleCopyworkRoutes(app: FastifyInstance, deps: CopyworkDependencies) {
  const { prisma, requireAuth } = deps;
  app.post("/api/bible/copyworks/source", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = selectionSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "经文选择无效" });
    try {
      return { source: copyworkSource(parsed.data) };
    } catch (e) {
      return reply.code(400).send({ message: e instanceof Error ? e.message : "经文选择无效" });
    }
  });
  app.post("/api/bible/copyworks", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: "抄写信息无效" });
    const { accountId } = (request as AuthedBibleRequest).auth;
    const { id, spacing, ...selection } = parsed.data;
    let source;
    try {
      source = copyworkSource(selection);
    } catch (e) {
      return reply.code(400).send({ message: e instanceof Error ? e.message : "经文选择无效" });
    }
    const work = await prisma.bibleCopywork.upsert({
      where: { id },
      update: {},
      create: { id, accountId, ...selection, spacing, source: asJson(source) }
    });
    if (
      work.accountId !== accountId ||
      work.spacing !== spacing ||
      JSON.stringify(copyworkManifest(work).text) !== JSON.stringify(source.text) ||
      work.translation !== selection.translation ||
      work.bookCode !== selection.bookCode ||
      work.chapter !== selection.chapter ||
      work.verseStart !== selection.verseStart ||
      work.verseEnd !== selection.verseEnd
    )
      throw fail(409, "保存编号已用于另一份作品，请重新保存");
    return { id: work.id, completed: !!work.completedAt };
  });
  app.put<{ Params: { id: string; position: string } }>(
    "/api/bible/copyworks/:id/glyphs/:position",
    { preHandler: requireAuth, bodyLimit: 1_400_000 },
    async (request) => {
      let glyph;
      try {
        glyph = normalizeCopyworkGlyph(request.body);
      } catch (e) {
        throw fail(400, e instanceof Error ? e.message : "字迹无效");
      }
      const position = Number(request.params.position);
      const { accountId } = (request as unknown as AuthedBibleRequest).auth;
      return prisma.$transaction(async (tx) => {
        const work = await lockWork(tx, request.params.id);
        if (!work || work.accountId !== accountId) throw fail(404, "作品不存在");
        if (
          !Number.isInteger(position) ||
          position < 0 ||
          position >= copyworkCharacters(copyworkManifest(work).text).length
        )
          throw fail(400, "字符位置无效");
        if (work.completedAt) return { success: true };
        await tx.bibleCopyworkGlyph.upsert({
          where: { workId_position: { workId: work.id, position } },
          create: { workId: work.id, position, ink: asJson(glyph) },
          update: { ink: asJson(glyph) }
        });
        return { success: true };
      });
    }
  );
  app.post<{ Params: { id: string } }>(
    "/api/bible/copyworks/:id/complete",
    { preHandler: requireAuth },
    async (request) => {
      const { accountId } = (request as unknown as AuthedBibleRequest).auth;
      return prisma.$transaction(
        async (tx) => {
          const work = await lockWork(tx, request.params.id);
          if (!work || work.accountId !== accountId) throw fail(404, "作品不存在");
          if (!work.completedAt) {
            const rows = await tx.bibleCopyworkGlyph.findMany({
              where: { workId: work.id },
              orderBy: { position: "asc" }
            });
            if (
              rows.length !== copyworkCharacters(copyworkManifest(work).text).length ||
              rows.some((r, i) => r.position !== i)
            )
              throw fail(400, "还有字迹未上传，请重试保存");
            const glyphs = rows.map((r) => normalizeCopyworkGlyph(r.ink));
            const points = glyphs.reduce(
              (sum, g) => sum + g.character.strokes.reduce((n, s) => n + s.points.length, 0),
              0
            );
            if (
              points > COPYWORK_MAX_POINTS ||
              Buffer.byteLength(JSON.stringify(glyphs)) > COPYWORK_MAX_BYTES
            )
              throw fail(400, "笔迹数据超出作品容量");
            await tx.bibleCopywork.update({
              where: { id: work.id },
              data: {
                completedAt: new Date(),
                source: asJson({ ...copyworkManifest(work), bounds: glyphs.map((g) => g.bounds) })
              }
            });
          }
          return {
            work: copyworkDTO(
              await tx.bibleCopywork.findUniqueOrThrow({
                where: { id: work.id },
                include: { account: { select: { displayName: true } } }
              })
            )
          };
        },
        { timeout: 15000 }
      );
    }
  );
  app.get("/api/bible/copyworks", { preHandler: requireAuth }, async (request) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) throw fail(400, "查询条件无效");
    const q = parsed.data;
    const { accountId } = (request as AuthedBibleRequest).auth;
    const rows = await prisma.bibleCopywork.findMany({
      where: {
        completedAt: { not: null },
        ...(q.scope === "mine" ? { accountId } : { publishedAt: { not: null } }),
        translation: q.translation,
        bookCode: q.bookCode,
        chapter: q.chapter,
        ...(q.verse ? { verseStart: { lte: q.verse }, verseEnd: { gte: q.verse } } : {})
      },
      include: { account: { select: { displayName: true } } },
      orderBy: q.scope === "mine" ? { completedAt: "desc" } : { publishedAt: "desc" },
      skip: q.offset,
      take: 21
    });
    return { works: rows.slice(0, 20).map(copyworkDTO), hasMore: rows.length > 20 };
  });
  app.get("/api/bible/copyworks/markers", { preHandler: requireAuth }, async (request) => {
    const q = querySchema.safeParse(request.query);
    if (!q.success || !q.data.translation || !q.data.bookCode || !q.data.chapter)
      throw fail(400, "章节无效");
    const { accountId } = (request as AuthedBibleRequest).auth;
    const rows = await prisma.bibleCopywork.findMany({
      where: {
        translation: q.data.translation,
        bookCode: q.data.bookCode,
        chapter: q.data.chapter,
        completedAt: { not: null },
        OR: [{ accountId }, { publishedAt: { not: null } }]
      },
      select: { verseStart: true, verseEnd: true }
    });
    return {
      verses: [
        ...new Set(
          rows.flatMap((r) =>
            Array.from({ length: r.verseEnd - r.verseStart + 1 }, (_, i) => r.verseStart + i)
          )
        )
      ]
    };
  });
  app.get<{ Params: { id: string } }>(
    "/api/bible/copyworks/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const work = await readableCopywork(
        prisma,
        request.params.id,
        (request as unknown as AuthedBibleRequest).auth.accountId,
        deps.canAccessChannel
      );
      const bounds = copyworkManifest(work).bounds || [];
      return {
        work: copyworkDTO(work),
        pages: layoutCopywork(bounds, copyworkManifest(work).text, work.spacing as CopyworkSpacing)
      };
    }
  );
  app.get<{ Params: { id: string; page: string } }>(
    "/api/bible/copyworks/:id/pages/:page",
    { preHandler: requireAuth },
    async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      const work = await readableCopywork(
        prisma,
        request.params.id,
        (request as unknown as AuthedBibleRequest).auth.accountId,
        deps.canAccessChannel
      );
      const page = Number(request.params.page);
      const pages = layoutCopywork(
        copyworkManifest(work).bounds || [],
        copyworkManifest(work).text,
        work.spacing as CopyworkSpacing
      );
      if (!Number.isInteger(page) || !pages[page]) throw fail(404, "册页不存在");
      const rows = await prisma.bibleCopyworkGlyph.findMany({
        where: { workId: work.id, position: { in: pages[page].map((p) => p.index) } },
        orderBy: { position: "asc" }
      });
      return { glyphs: rows.map((r) => ({ index: r.position, ...normalizeCopyworkGlyph(r.ink) })) };
    }
  );
  app.patch<{ Params: { id: string } }>(
    "/api/bible/copyworks/:id",
    { preHandler: requireAuth },
    async (request) => {
      const parsed = z.object({ published: z.boolean() }).strict().safeParse(request.body);
      if (!parsed.success) throw fail(400, "公开设置无效");
      const result = await prisma.bibleCopywork.updateMany({
        where: {
          id: request.params.id,
          accountId: (request as unknown as AuthedBibleRequest).auth.accountId,
          completedAt: { not: null }
        },
        data: { publishedAt: parsed.data.published ? new Date() : null }
      });
      if (!result.count) throw fail(404, "作品不存在");
      return { success: true };
    }
  );
  app.delete<{ Params: { id: string } }>(
    "/api/bible/copyworks/:id",
    { preHandler: requireAuth },
    async (request) => {
      await prisma.bibleCopywork.deleteMany({
        where: {
          id: request.params.id,
          accountId: (request as unknown as AuthedBibleRequest).auth.accountId
        }
      });
      return { success: true };
    }
  );
  app.post<{ Params: { id: string } }>(
    "/api/bible/copyworks/:id/share",
    { preHandler: requireAuth },
    async (request) => {
      const parsed = z
        .object({ channelId: z.number().int().positive(), clientRequestId: z.string().uuid() })
        .strict()
        .safeParse(request.body);
      if (!parsed.success) throw fail(400, "分享请求无效");
      const { accountId, actorId } = (request as unknown as AuthedBibleRequest).auth;
      const work = await readableCopywork(
        prisma,
        request.params.id,
        accountId,
        deps.canAccessChannel
      );
      if (work.accountId !== accountId) throw fail(403, "只能分享自己的抄写");
      const channel = await prisma.channel.findUnique({ where: { id: parsed.data.channelId } });
      if (
        !channel ||
        !["standard", "direct"].includes(channel.kind) ||
        !(await deps.canWriteChannel(accountId, channel.id))
      )
        throw fail(403, "无权在该聊天室分享");
      const source = copyworkManifest(work);
      const result = await prisma.$transaction(async (tx) => {
        const locked = await lockWork(tx, work.id);
        if (!locked?.completedAt) throw fail(404, "作品已删除");
        const existing = await tx.message.findUnique({
          where: {
            senderActorId_clientRequestId: {
              senderActorId: actorId,
              clientRequestId: parsed.data.clientRequestId
            }
          }
        });
        if (existing) return { message: existing, created: false };
        const message = await tx.message.create({
          data: {
            channelId: channel.id,
            senderActorId: actorId,
            clientRequestId: parsed.data.clientRequestId,
            type: "bible_copywork",
            content: `经文抄写 · ${source.reference}`,
            payload: { kind: "bible_copywork", workId: work.id, reference: source.reference },
            copyworkShare: { create: { workId: work.id } }
          }
        });
        return { message, created: true };
      });
      const { message } = result;
      const payload = message.payload as { workId?: string } | null;
      if (
        message.channelId !== channel.id ||
        payload?.workId !== work.id ||
        message.type !== "bible_copywork"
      )
        throw fail(409, "该请求已用于另一条消息");
      await deps.emitMessage(message.id);
      if (result.created)
        void deps
          .sendMessagePush(message.id, pushOriginFromHeaders(request.headers))
          .catch((error) =>
            request.log.warn({ error, messageId: message.id }, "copywork push failed")
          );
      return { success: true, messageId: message.id, channelId: channel.id };
    }
  );
}
