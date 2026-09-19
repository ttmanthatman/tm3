import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pipeline } from "node:stream/promises";
import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyRequest, FastifyReply, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import { STORY_LIMITS, STORY_BIO_MAX, STORY_DEFAULT_BIO, validStoryMedia, type StoryActivityDTO, type StoryNotificationDTO, type StoryPersonDTO } from "../../shared/stories.js";
import { createStoryService, storyDto, storyFeedDto, storyFeedInclude, storyInclude, storyInteractionsDto } from "../services/stories.js";
import { prepareStoryMedia, storyMediaPath, StoryInputError, type StoredStoryMedia } from "../services/storyMedia.js";

type AuthRequest = FastifyRequest & { auth: { accountId: number; actorId: number } };
const positiveId = z.coerce.number().int().positive();
const mediaInclude = { media: { orderBy: { position: "asc" as const } } };

function uploadLifetime(request: FastifyRequest, reply: FastifyReply) {
  const controller = new AbortController();
  const aborted = () => controller.abort();
  const closed = () => { if (!reply.raw.writableEnded) controller.abort(); };
  request.raw.once("aborted", aborted);
  reply.raw.once("close", closed);
  // Auth/database awaits may outlive the connection. A completed request may
  // normally be destroyed; the response/socket is authoritative in that case.
  if (request.raw.aborted || (request.raw.destroyed && !request.raw.complete) || reply.raw.destroyed) controller.abort();
  return { signal: controller.signal, dispose: () => { request.raw.removeListener("aborted", aborted); reply.raw.removeListener("close", closed); } };
}

export function registerStoryRoutes(app: FastifyInstance, deps: {
  prisma: PrismaClient;
  requireAuth: preHandlerHookHandler;
  requireMediaAuth: preHandlerHookHandler;
  directory: string;
  announceStory?: (input: { channelId: number; actorId: number; storyId: number; displayName: string }) => Promise<void>;
  notifyStoryPublished?: (accountIds: number[], event: { storyId: number; createdAt: string }) => void;
  notifyStoryInteraction?: (accountId: number, notification: StoryNotificationDTO) => void;
}) {
  const { prisma, requireAuth, requireMediaAuth, directory } = deps;
  const service = createStoryService(prisma);

  async function notificationPerson(accountId: number): Promise<StoryPersonDTO> {
    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true, displayName: true, avatarPath: true, actor: { select: { id: true } } }
    });
    return { accountId, actorId: account?.actor?.id || 0, displayName: account?.displayName || "一位成员", avatarPath: account?.avatarPath || null };
  }

  async function storyActivity(accountId: number): Promise<StoryActivityDTO> {
    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: { storyFeedReadAt: true, storyInteractionReadAt: true }
    });
    if (!account) return { hasUnreadStories: false, notifications: [] };
    const visibleIds = await service.visibleAuthorAccountIds(accountId);
    const [unreadStory, likes, comments] = await Promise.all([
      prisma.story.findFirst({
        where: { accountId: { in: visibleIds, not: accountId }, createdAt: { gt: account.storyFeedReadAt } },
        select: { id: true }
      }),
      prisma.storyLike.findMany({
        where: { accountId: { not: accountId }, createdAt: { gt: account.storyInteractionReadAt }, story: { accountId } },
        include: { account: { select: { id: true, displayName: true, avatarPath: true, actor: { select: { id: true } } } } },
        orderBy: { createdAt: "desc" },
        take: 20
      }),
      prisma.storyComment.findMany({
        where: { accountId: { not: accountId }, createdAt: { gt: account.storyInteractionReadAt }, story: { accountId } },
        include: { account: { select: { id: true, displayName: true, avatarPath: true, actor: { select: { id: true } } } } },
        orderBy: { createdAt: "desc" },
        take: 20
      })
    ]);
    const notifications: StoryNotificationDTO[] = [
      ...likes.map((like) => ({ id: `like:${like.id}`, kind: "like" as const, storyId: like.storyId, actor: {
        accountId: like.account.id, actorId: like.account.actor?.id || 0, displayName: like.account.displayName, avatarPath: like.account.avatarPath
      }, text: null, createdAt: like.createdAt.toISOString() })),
      ...comments.map((comment) => ({ id: `comment:${comment.id}`, kind: "comment" as const, storyId: comment.storyId, actor: {
        accountId: comment.account.id, actorId: comment.account.actor?.id || 0, displayName: comment.account.displayName, avatarPath: comment.account.avatarPath
      }, text: comment.text, createdAt: comment.createdAt.toISOString() }))
    ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 20);
    return { hasUnreadStories: !!unreadStory, notifications };
  }

  async function currentInteractions(storyId: number, accountId: number) {
    const [story, role] = await Promise.all([
      prisma.story.findUnique({ where: { id: storyId }, include: storyInclude }),
      service.viewerRole(accountId)
    ]);
    return story ? storyInteractionsDto(story, accountId, role) : null;
  }

  app.patch("/api/stories/profile", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthRequest).auth;
    if (!(await service.authorFor(auth.accountId, auth.actorId))) return reply.code(403).send({ message: "无法编辑故事签名" });
    const body = z.object({ bio: z.string().trim().max(STORY_BIO_MAX) }).strict().safeParse(request.body);
    if (!body.success) return reply.code(400).send({ message: "签名最多 160 字" });
    const bio = body.data.bio || STORY_DEFAULT_BIO;
    await prisma.account.update({ where: { id: auth.accountId }, data: { storyBio: bio } });
    return { bio };
  });

  // Conversion is authenticated but does not publish or retain a draft upload.
  app.post("/api/stories/prepare-image", { preHandler: requireAuth, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const auth = (request as AuthRequest).auth;
    if (!(await service.authorFor(auth.accountId, auth.actorId))) return reply.code(403).send({ message: "访客不能上传故事照片" });
    const scratch = await fsp.mkdtemp(path.join(os.tmpdir(), "story-image-"));
    const lifetime = uploadLifetime(request, reply);
    try {
      lifetime.signal.throwIfAborted();
      let prepared: StoredStoryMedia | null = null;
      for await (const part of request.parts({ limits: { files: 1, fields: 0, parts: 1, fileSize: STORY_LIMITS.fileBytes } })) {
        if (part.type !== "file" || part.fieldname !== "image") throw new StoryInputError("请选择一张图片");
        const input = path.join(scratch, "photo.input");
        await pipeline(part.file, fs.createWriteStream(input), { signal: lifetime.signal });
        if (part.file.truncated) throw new StoryInputError("每个文件不能超过 10 MB");
        prepared = await prepareStoryMedia(input, scratch, "image", 0, lifetime.signal);
      }
      if (!prepared) throw new StoryInputError("请选择一张图片");
      const bytes = await fsp.readFile(path.join(scratch, prepared.fileName));
      reply.header("Cache-Control", "private, no-store");
      return { base64: bytes.toString("base64"), contentType: "image/webp" };
    } catch (error) {
      if (error instanceof StoryInputError) Object.assign(error, { statusCode: 400 });
      throw error;
    } finally { lifetime.dispose(); await fsp.rm(scratch, { recursive: true, force: true }); }
  });

  app.get("/api/stories/authors/:actorId", { preHandler: requireAuth }, async (request, reply) => {
    const id = positiveId.safeParse((request.params as { actorId: string }).actorId);
    if (!id.success) return reply.code(400).send({ message: "用户参数无效" });
    const author = await service.authorFor((request as AuthRequest).auth.accountId, id.data);
    if (!author) return reply.code(404).send({ message: "暂时无法查看这个人的故事" });
    return { author };
  });

  app.get("/api/stories", { preHandler: requireAuth }, async (request, reply) => {
    const query = z.object({ actorId: positiveId, before: positiveId.optional() }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ message: "故事参数无效" });
    const author = await service.authorFor((request as AuthRequest).auth.accountId, query.data.actorId);
    if (!author) return reply.code(404).send({ message: "暂时无法查看这个人的故事" });
    const role = await service.viewerRole((request as AuthRequest).auth.accountId);
    const rows = await prisma.story.findMany({ where: { accountId: author.accountId, ...(query.data.before ? { id: { lt: query.data.before } } : {}) },
      include: storyInclude, orderBy: { id: "desc" }, take: 21 });
    return { author, stories: rows.slice(0, 20).map((story) => storyDto(story, (request as AuthRequest).auth.accountId, role)), nextCursor: rows.length > 20 ? rows[19].id : null };
  });

  app.get("/api/stories/feed", { preHandler: requireAuth }, async (request, reply) => {
    const query = z.object({ before: positiveId.optional() }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ message: "故事参数无效" });
    const auth = (request as AuthRequest).auth;
    const [viewer, role, visibleIds] = await Promise.all([
      service.authorFor(auth.accountId, auth.actorId),
      service.viewerRole(auth.accountId),
      service.visibleAuthorAccountIds(auth.accountId)
    ]);
    if (!viewer) return reply.code(403).send({ message: "访客不能查看大家的故事" });
    const rows = await prisma.story.findMany({
      where: { accountId: { in: visibleIds }, ...(query.data.before ? { id: { lt: query.data.before } } : {}) },
      include: storyFeedInclude,
      orderBy: { id: "desc" },
      take: 21
    });
    return { viewer, stories: rows.slice(0, 20).map((story) => storyFeedDto(story, auth.accountId, role)), nextCursor: rows.length > 20 ? rows[19].id : null };
  });

  app.get("/api/stories/activity", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthRequest).auth;
    if (!(await service.authorFor(auth.accountId, auth.actorId))) return reply.code(403).send({ message: "访客没有故事提醒" });
    return storyActivity(auth.accountId);
  });

  app.patch("/api/stories/activity/read", { preHandler: requireAuth }, async (request, reply) => {
    const auth = (request as AuthRequest).auth;
    const body = z.object({ scope: z.enum(["feed", "interactions", "all"]) }).strict().safeParse(request.body);
    if (!body.success) return reply.code(400).send({ message: "故事已读参数无效" });
    const now = new Date();
    await prisma.account.update({ where: { id: auth.accountId }, data: {
      ...(body.data.scope === "feed" || body.data.scope === "all" ? { storyFeedReadAt: now } : {}),
      ...(body.data.scope === "interactions" || body.data.scope === "all" ? { storyInteractionReadAt: now } : {})
    } });
    return storyActivity(auth.accountId);
  });

  app.post("/api/stories", { preHandler: requireAuth, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const auth = (request as AuthRequest).auth;
    if (!(await service.authorFor(auth.accountId, auth.actorId))) return reply.code(403).send({ message: "访客不能发布故事" });
    await fsp.mkdir(directory, { recursive: true });
    const folder = crypto.randomUUID();
    const scratch = path.join(directory, folder);
    await fsp.mkdir(scratch);
    let committed = false;
    const media: StoredStoryMedia[] = [];
    const fields: Record<string, string> = {};
    const lifetime = uploadLifetime(request, reply);
    try {
      lifetime.signal.throwIfAborted();
      for await (const part of request.parts({ limits: { files: 10, fields: 3, parts: 13, fileSize: STORY_LIMITS.fileBytes, fieldSize: 12_000 } })) {
        if (part.type === "field") {
          if (!(["text", "requestId", "channelId"] as string[]).includes(part.fieldname) || typeof part.value !== "string" || part.valueTruncated || fields[part.fieldname] !== undefined) throw new StoryInputError("发布参数无效");
          fields[part.fieldname] = part.value;
          continue;
        }
        const kind = part.fieldname === "image" ? "image" : part.fieldname === "voice" ? "voice" : null;
        if (!kind || (kind === "image" && !part.mimetype.startsWith("image/")) || (kind === "voice" && !/^(audio\/|video\/webm)/.test(part.mimetype))) {
          part.file.resume();
          throw new StoryInputError("只支持图片和语音");
        }
        if (!validStoryMedia([...media.map((item) => item.kind), kind])) throw new StoryInputError("每篇最多 9 张图片和 1 段语音");
        const input = path.join(scratch, `${crypto.randomUUID()}.input`);
        await pipeline(part.file, fs.createWriteStream(input), { signal: lifetime.signal });
        if (part.file.truncated) throw new StoryInputError("每个文件不能超过 10 MB");
        const prepared = await prepareStoryMedia(input, scratch, kind, media.length, lifetime.signal);
        await fsp.unlink(input);
        media.push({ ...prepared, fileName: `${folder}/${prepared.fileName}` });
      }
      const parsed = z.object({ requestId: z.string().uuid(), text: z.string().trim().max(STORY_LIMITS.text).default(""), channelId: positiveId.optional() }).safeParse(fields);
      if (!parsed.success) throw new StoryInputError("文字最多 2000 字，请检查后重试");
      if (!validStoryMedia(media.map((item) => item.kind))) throw new StoryInputError("请至少添加一张图片或一段语音，不能只发文字");
      lifetime.signal.throwIfAborted();
      const existing = await prisma.story.findUnique({ where: { accountId_requestId: { accountId: auth.accountId, requestId: parsed.data.requestId } }, include: storyInclude });
      if (existing) return { story: storyDto(existing, auth.accountId, await service.viewerRole(auth.accountId)) };
      // Concurrent retries share a unique request key; their private upload
      // directories never overwrite or delete a successful request's files.
      try {
        const { channelId, ...storyData } = parsed.data;
        const story = await prisma.story.create({ data: { accountId: auth.accountId, ...storyData, media: { create: media } }, include: storyInclude });
        committed = true;
        const author = await service.authorFor(auth.accountId, auth.actorId);
        if (author) {
          if (channelId && deps.announceStory) {
            await deps.announceStory({ channelId, actorId: auth.actorId, storyId: story.id, displayName: author.displayName })
              .catch((error) => request.log.error({ error, storyId: story.id }, "story announcement failed"));
          }
          if (deps.notifyStoryPublished) {
            const audience = (await service.visibleAuthorAccountIds(auth.accountId)).filter((accountId) => accountId !== auth.accountId);
            deps.notifyStoryPublished(audience, { storyId: story.id, createdAt: story.createdAt.toISOString() });
          }
        }
        reply.code(201);
        return { story: storyDto(story, auth.accountId, await service.viewerRole(auth.accountId)) };
      } catch (error) {
        if ((error as { code?: string }).code !== "P2002") throw error;
        const existing = await prisma.story.findUnique({ where: { accountId_requestId: { accountId: auth.accountId, requestId: parsed.data.requestId } }, include: storyInclude });
        if (!existing) throw error;
        return { story: storyDto(existing, auth.accountId, await service.viewerRole(auth.accountId)) };
      }
    } catch (error) {
      if (error instanceof StoryInputError) Object.assign(error, { statusCode: 400 });
      throw error;
    } finally {
      lifetime.dispose();
      if (!committed) await fsp.rm(scratch, { recursive: true, force: true });
    }
  });

  app.put("/api/stories/:id/like", { preHandler: requireAuth, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
    const id = positiveId.safeParse((request.params as { id: string }).id);
    const body = z.object({ liked: z.boolean() }).strict().safeParse(request.body);
    if (!id.success || !body.success) return reply.code(400).send({ message: "点赞参数无效" });
    const auth = (request as AuthRequest).auth;
    const access = await service.accessFor(auth.accountId, id.data);
    if (!access) return reply.code(404).send({ message: "故事不存在或不可见" });
    const key = { storyId_accountId: { storyId: id.data, accountId: auth.accountId } };
    const existing = await prisma.storyLike.findUnique({ where: key });
    if (body.data.liked) {
      const like = await prisma.storyLike.upsert({ where: key, update: {}, create: key.storyId_accountId });
      if (!existing && access.author.accountId !== auth.accountId && deps.notifyStoryInteraction) {
        deps.notifyStoryInteraction(access.author.accountId, { id: `like:${like.id}`, kind: "like", storyId: id.data,
          actor: await notificationPerson(auth.accountId), text: null, createdAt: like.createdAt.toISOString() });
      }
    } else {
      await prisma.storyLike.deleteMany({ where: key.storyId_accountId });
    }
    const interactions = await currentInteractions(id.data, auth.accountId);
    return interactions ? { interactions } : reply.code(404).send({ message: "故事不存在或不可见" });
  });

  app.post("/api/stories/:id/comments", { preHandler: requireAuth, config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    const id = positiveId.safeParse((request.params as { id: string }).id);
    const body = z.object({ text: z.string().trim().min(1).max(STORY_LIMITS.comment) }).strict().safeParse(request.body);
    if (!id.success || !body.success) return reply.code(400).send({ message: "评论需为 1–500 字" });
    const auth = (request as AuthRequest).auth;
    const access = await service.accessFor(auth.accountId, id.data);
    if (!access) return reply.code(404).send({ message: "故事不存在或不可见" });
    const comment = await prisma.storyComment.create({ data: { storyId: id.data, accountId: auth.accountId, text: body.data.text } });
    if (access.author.accountId !== auth.accountId && deps.notifyStoryInteraction) {
      deps.notifyStoryInteraction(access.author.accountId, { id: `comment:${comment.id}`, kind: "comment", storyId: id.data,
        actor: await notificationPerson(auth.accountId), text: comment.text, createdAt: comment.createdAt.toISOString() });
    }
    const interactions = await currentInteractions(id.data, auth.accountId);
    reply.code(201);
    return interactions ? { interactions } : reply.code(404).send({ message: "故事不存在或不可见" });
  });

  app.delete("/api/stories/:storyId/comments/:commentId", { preHandler: requireAuth }, async (request, reply) => {
    const params = z.object({ storyId: positiveId, commentId: positiveId }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ message: "评论参数无效" });
    const auth = (request as AuthRequest).auth;
    const access = await service.accessFor(auth.accountId, params.data.storyId);
    if (!access) return reply.code(404).send({ message: "评论不存在或无权删除" });
    const [comment, role] = await Promise.all([
      prisma.storyComment.findFirst({ where: { id: params.data.commentId, storyId: params.data.storyId } }),
      service.viewerRole(auth.accountId)
    ]);
    if (!comment || (comment.accountId !== auth.accountId && access.author.accountId !== auth.accountId && role !== "admin")) {
      return reply.code(404).send({ message: "评论不存在或无权删除" });
    }
    await prisma.storyComment.deleteMany({ where: { id: comment.id, storyId: params.data.storyId } });
    const interactions = await currentInteractions(params.data.storyId, auth.accountId);
    return interactions ? { interactions } : reply.code(404).send({ message: "故事不存在或不可见" });
  });

  app.delete("/api/stories/:id", { preHandler: requireAuth }, async (request, reply) => {
    const id = positiveId.safeParse((request.params as { id: string }).id);
    if (!id.success) return reply.code(400).send({ message: "故事参数无效" });
    const story = await prisma.story.findFirst({ where: { id: id.data, accountId: (request as AuthRequest).auth.accountId }, include: mediaInclude });
    if (!story) return reply.code(404).send({ message: "故事不存在或无权删除" });
    await prisma.story.deleteMany({ where: { id: story.id, accountId: story.accountId } });
    for (const item of story.media) {
      const file = storyMediaPath(directory, item.fileName);
      try { await fsp.rm(file, { force: true }); await fsp.rm(`${file}.thumb.webp`, { force: true }); }
      catch (error) { request.log.error({ error, storyId: story.id }, "story file cleanup failed"); }
    }
    return { success: true };
  });

  app.get("/api/stories/media/:id", { preHandler: requireMediaAuth }, async (request, reply) => {
    const id = positiveId.safeParse((request.params as { id: string }).id);
    if (!id.success) return reply.code(400).send({ message: "媒体参数无效" });
    const media = await prisma.storyMedia.findUnique({ where: { id: id.data }, include: { story: { include: { account: { select: { actor: { select: { id: true } } } } } } } });
    const actorId = media?.story.account.actor?.id;
    if (!media || !actorId || !(await service.authorFor((request as AuthRequest).auth.accountId, actorId))) return reply.code(404).send({ message: "故事媒体不可用" });
    let file = storyMediaPath(directory, media.fileName);
    if (media.kind === "image" && (request.query as { thumb?: string }).thumb === "1") file += ".thumb.webp";
    let stat;
    try { stat = await fsp.stat(file); } catch { return reply.code(404).send({ message: "媒体文件不存在" }); }
    reply.header("Cache-Control", "private, no-store").header("X-Content-Type-Options", "nosniff").header("Accept-Ranges", "bytes").type(media.contentType);
    const range = request.headers.range;
    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      const start = match ? Number(match[1]) : NaN;
      const end = match?.[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
      if (!Number.isSafeInteger(start) || start < 0 || start > end || start >= stat.size) return reply.code(416).header("Content-Range", `bytes */${stat.size}`).send();
      return reply.code(206).header("Content-Range", `bytes ${start}-${end}/${stat.size}`).header("Content-Length", end - start + 1).send(fs.createReadStream(file, { start, end }));
    }
    return reply.header("Content-Length", stat.size).send(fs.createReadStream(file));
  });
}
