import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import { bottleTextSchema, pollPayload, pollSchema } from "../../shared/social.js";

type Auth = { accountId: number; actorId: number };
type Dependencies = {
  prisma: PrismaClient;
  requireAuth: preHandlerHookHandler;
  canAccessChannel(accountId: number, channelId: number): Promise<boolean>;
  canWriteChannel(accountId: number, channelId: number): Promise<boolean>;
  emitMessage(id: number): Promise<unknown>;
  changed(channelId: number, pollId?: number): void;
};
const fail = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });
function validate<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw fail(400, "请求参数无效");
  return result.data;
}
const authFor = (request: FastifyRequest) => (request as FastifyRequest & { auth: Auth }).auth;
const channelParams = z.object({ channelId: z.coerce.number().int().positive() });
const pollParams = z.object({ id: z.coerce.number().int().positive() });
const bottleParams = channelParams.extend({ id: z.string().uuid() });
type StoredBottle = { text: string; style: number };

export function registerSocialRoutes(app: FastifyInstance, deps: Dependencies) {
  const { prisma } = deps;
  const preHandler = deps.requireAuth;
  async function access(request: FastifyRequest, channelId: number, write = false) {
    const auth = authFor(request);
    const permitted = write ? await deps.canWriteChannel(auth.accountId, channelId) : await deps.canAccessChannel(auth.accountId, channelId);
    if (!permitted) throw fail(403, "无权访问或操作此频道");
    return auth;
  }
  async function loadPoll(request: FastifyRequest, write = false) {
    const { id } = validate(pollParams, request.params);
    const message = await prisma.message.findUnique({ where: { id } });
    const poll = pollPayload(message?.payload);
    if (!message || message.type !== "text" || !poll) throw fail(404, "投票不存在");
    await access(request, message.channelId, write);
    return { message, poll };
  }
  app.post("/api/channels/:channelId/polls", { preHandler }, async (request) => {
    const { channelId } = validate(channelParams, request.params);
    const auth = await access(request, channelId, true);
    const body = validate(z.object({ poll: pollSchema, requestId: z.string().uuid() }).strict(), request.body);
    const message = await prisma.message.upsert({
      where: { senderActorId_clientRequestId: { senderActorId: auth.actorId, clientRequestId: body.requestId } },
      create: { channelId, senderActorId: auth.actorId, clientRequestId: body.requestId, type: "text", content: `投票：${body.poll.question}`, payload: body.poll },
      update: {}
    });
    if (message.channelId !== channelId || JSON.stringify(pollPayload(message.payload)) !== JSON.stringify(body.poll)) throw fail(409, "请求编号已被使用");
    await deps.emitMessage(message.id);
    return { id: message.id };
  });
  app.get("/api/polls/:id", { preHandler }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const { message, poll } = await loadPoll(request);
    const prefix = `poll-vote:${message.id}:`;
    const votes = await prisma.setting.findMany({ where: { key: { startsWith: prefix } } });
    const counts = poll.options.map(() => 0);
    for (const vote of votes) {
      const option = Number(vote.value);
      if (Number.isInteger(option) && option >= 0 && option < counts.length) counts[option]++;
    }
    const mine = votes.find((vote) => vote.key === `${prefix}${authFor(request).accountId}`);
    return { counts, total: counts.reduce((a, b) => a + b, 0), selected: mine ? Number(mine.value) : null };
  });
  app.put("/api/polls/:id/vote", { preHandler }, async (request) => {
    const { message, poll } = await loadPoll(request, true);
    const { option } = validate(z.object({ option: z.number().int().min(0).max(poll.options.length - 1) }).strict(), request.body);
    const key = `poll-vote:${message.id}:${authFor(request).accountId}`;
    await prisma.setting.upsert({ where: { key }, create: { key, value: String(option) }, update: { value: String(option) } });
    deps.changed(message.channelId, message.id);
    return { success: true };
  });
  app.get("/api/channels/:channelId/bottles", { preHandler }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const { channelId } = validate(channelParams, request.params);
    await access(request, channelId);
    const prefix = `bottle:${channelId}:`;
    const rows = await prisma.setting.findMany({ where: { key: { startsWith: prefix } }, orderBy: { key: "asc" } });
    return { bottles: rows.map((row) => ({ id: row.key.slice(prefix.length), style: (JSON.parse(row.value) as StoredBottle).style })) };
  });
  app.post("/api/channels/:channelId/bottles", { preHandler }, async (request) => {
    const { channelId } = validate(channelParams, request.params);
    await access(request, channelId, true);
    const { text } = validate(z.object({ text: bottleTextSchema }).strict(), request.body);
    const bottle = await prisma.$transaction(async (tx) => {
      // Serialize capacity and appearance allocation across processes. No author is stored.
      await tx.$queryRaw`SELECT id FROM channels WHERE id = ${channelId} FOR UPDATE`;
      const rows = await tx.setting.findMany({ where: { key: { startsWith: `bottle:${channelId}:` } } });
      const used = new Set(rows.map((row) => (JSON.parse(row.value) as StoredBottle).style));
      const styles = Array.from({ length: 12 }, (_, i) => i).filter((i) => !used.has(i));
      if (!styles.length) throw fail(409, "岸边已有 12 个瓶子，先打开几个再扔吧");
      const style = styles[Math.floor(Math.random() * styles.length)];
      const id = randomUUID();
      await tx.setting.create({ data: { key: `bottle:${channelId}:${id}`, value: JSON.stringify({ text, style }) } });
      return { id, style };
    });
    deps.changed(channelId);
    return bottle;
  });
  app.post("/api/channels/:channelId/bottles/:id/open", { preHandler }, async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    const { channelId, id } = validate(bottleParams, request.params);
    await access(request, channelId, true);
    const key = `bottle:${channelId}:${id}`;
    const bottle = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM channels WHERE id = ${channelId} FOR UPDATE`;
      const row = await tx.setting.findUnique({ where: { key } });
      if (!row) throw fail(410, "这个瓶子已被捡走");
      await tx.setting.delete({ where: { key } });
      return JSON.parse(row.value) as StoredBottle;
    });
    deps.changed(channelId);
    return { id, ...bottle };
  });
}
