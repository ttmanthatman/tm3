import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import { BIBLE_STUDY_ROOM_KEY_PREFIX, bibleStudyRoomKey, type BibleStudyWorkspaceState, type BibleStudyRecordPage, type BibleStudyAnswerRequest } from "../../shared/bibleStudy.js";
import { studyQuestionFromMessage, plainStudyText, studyAnswerSchema } from "../services/bibleStudyQuestions.js";
import { BIBLE_STUDY_ASSISTANT, BIBLE_STUDY_RETRY_PREFIX } from "../../shared/bibleStudy.js";

const pageQuery = z.object({ before: z.coerce.number().int().positive().optional() });
const roomParams = z.object({ id: z.coerce.number().int().positive() });
const pageSize = 50;

type StudyAuth = { accountId: number; actorId: number; isAdmin: boolean; canPinMessages: boolean };

export function registerBibleStudyRoutes(app: FastifyInstance, deps: {
  prisma: PrismaClient;
  requireAuth: preHandlerHookHandler;
  requireAdmin: preHandlerHookHandler;
  authFor(request: FastifyRequest): StudyAuth;
  enter(auth: StudyAuth): Promise<number>;
  progress(channelId: number, actorId: number): Promise<BibleStudyWorkspaceState>;
  retry(channelId: number, actorId: number): void;
  requestHelp(channelId: number, actorId: number, questionId: number): Promise<boolean>;
  submitAnswer(channelId: number, actorId: number, input: BibleStudyAnswerRequest): Promise<boolean>;
  manageQuestion(channelId: number, actorId: number, questionId: number, action: "delete" | "skip", expectedIds?: number[]): Promise<boolean>;
  canWriteChannel(accountId: number, channelId: number): Promise<boolean>;
  canAccessChannel(accountId: number, channelId: number): Promise<boolean>;
}) {
  const { prisma } = deps;

  async function records(channelId: number, before?: number, summariesOnly = false, participant = false): Promise<BibleStudyRecordPage> {
    const rows = await prisma.message.findMany({
      where: {
        channelId, content: { not: "" }, ...(before ? { id: { lt: before } } : {}),
        ...(participant ? { OR: [{ clientRequestId: null }, { NOT: { clientRequestId: { startsWith: BIBLE_STUDY_RETRY_PREFIX } } }] } : {}),
        ...(summariesOnly ? { payload: { path: "$.stage", equals: "complete" }, sender: { kind: "virtual" } } : {})
      },
      select: { id: true, content: true, createdAt: true, payload: true, sender: { select: { displayName: true, kind: true, username: true } } },
      orderBy: { id: "desc" }, take: pageSize + 1
    });
    return {
      records: rows.slice(0, pageSize).map(row => ({
        id: row.id,
        content: plainStudyText(row.content, 65_535),
        question: row.sender.username === BIBLE_STUDY_ASSISTANT.username ? studyQuestionFromMessage(row) : undefined,
        sender: row.sender.displayName,
        createdAt: row.createdAt.toISOString(),
        summary: row.sender.kind === "virtual" && !!row.payload && typeof row.payload === "object" &&
          !Array.isArray(row.payload) && row.payload.kind === "bible_study_turn" && row.payload.stage === "complete"
      })),
      nextBefore: rows.length > pageSize ? rows[pageSize - 1].id : null
    };
  }

  async function ownedRoom(accountId: number) {
    const room = await prisma.channel.findUnique({ where: { directKey: bibleStudyRoomKey(accountId) }, select: { id: true } });
    return room && await deps.canAccessChannel(accountId, room.id) ? room : null;
  }

  app.post("/api/bible-study/enter", { preHandler: deps.requireAuth }, async request => {
    const channelId = await deps.enter(deps.authFor(request));
    return { channelId };
  });

  app.get("/api/bible-study/progress", { preHandler: deps.requireAuth }, async (request, reply) => {
    const { accountId, actorId } = deps.authFor(request);
    const room = await ownedRoom(accountId);
    if (!room) return reply.code(404).send({ message: "问答式查经不存在" });
    return deps.progress(room.id, actorId);
  });

  app.post("/api/bible-study/retry", { preHandler: deps.requireAuth }, async (request, reply) => {
    const { accountId, actorId } = deps.authFor(request);
    const room = await ownedRoom(accountId);
    if (!room) return reply.code(404).send({ message: "问答式查经不存在" });
    deps.retry(room.id, actorId);
    return { accepted: true };
  });

  app.post("/api/bible-study/help", { preHandler: deps.requireAuth }, async (request, reply) => {
    const body = z.object({ questionId: z.number().int().positive() }).strict().safeParse(request.body);
    if (!body.success) return reply.code(400).send({ message: "问题参数无效" });
    const { accountId, actorId } = deps.authFor(request);
    const room = await ownedRoom(accountId);
    if (!room) return reply.code(404).send({ message: "问答式查经不存在" });
    if (!await deps.requestHelp(room.id, actorId, body.data.questionId)) {
      return reply.code(409).send({ message: "查经进度已变化，请看当前问题" });
    }
    return reply.code(202).send({ accepted: true });
  });

  app.post("/api/bible-study/answer", { preHandler: deps.requireAuth }, async (request, reply) => {
    const body = studyAnswerSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ message: "答复参数无效" });
    const { accountId, actorId } = deps.authFor(request);
    const room = await ownedRoom(accountId);
    if (!room) return reply.code(404).send({ message: "问答式查经不存在" });
    if (!await deps.canWriteChannel(accountId, room.id)) return reply.code(403).send({ message: "无权在此书房发言" });
    if (!await deps.submitAnswer(room.id, actorId, body.data)) return reply.code(409).send({ message: "查经进度已变化或问题不可用，请刷新后重试" });
    return reply.code(202).send({ accepted: true });
  });

  for (const action of ["delete", "skip"] as const) {
    app.post(`/api/bible-study/questions/${action}`, { preHandler: deps.requireAuth }, async (request, reply) => {
      const body = z.object({ questionId: z.number().int().positive(), expectedIds: z.array(z.number().int().positive()).min(1).max(10_000).optional() }).strict().safeParse(request.body);
      if (!body.success || (action === "delete" ? !body.data.expectedIds : !!body.data.expectedIds)) return reply.code(400).send({ message: "问题参数无效" });
      const { accountId, actorId } = deps.authFor(request);
      const room = await ownedRoom(accountId);
      if (!room) return reply.code(404).send({ message: "问答式查经不存在" });
      if (!await deps.canWriteChannel(accountId, room.id)) return reply.code(403).send({ message: "无权修改查经问题" });
      const expectedIds = body.data.expectedIds;
      if (!await deps.manageQuestion(room.id, actorId, body.data.questionId, action, expectedIds)) return reply.code(409).send({ message: "问题或进度已变化，请刷新后重试" });
      return reply.code(200).send({ accepted: true });
    });
  }

  app.get("/api/bible-study/records", { preHandler: deps.requireAuth }, async (request, reply) => {
    const query = pageQuery.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ message: "记录页码无效" });
    const room = await ownedRoom(deps.authFor(request).accountId);
    if (!room) return reply.code(404).send({ message: "问答式查经不存在" });
    return records(room.id, query.data.before, false, true);
  });

  app.get("/api/bible-study/summaries", { preHandler: deps.requireAuth }, async (request, reply) => {
    const query = pageQuery.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ message: "小结页码无效" });
    const { accountId } = deps.authFor(request);
    const room = await ownedRoom(accountId);
    if (!room) return reply.code(404).send({ message: "问答式查经不存在" });
    return records(room.id, query.data.before, true);
  });

  app.get("/api/admin/bible-study/rooms", { preHandler: deps.requireAdmin }, async (request, reply) => {
    const query = pageQuery.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ message: "记录页码无效" });
    const before = query.data.before;
    const rows = await prisma.channel.findMany({
      where: { directKey: { startsWith: BIBLE_STUDY_ROOM_KEY_PREFIX }, ...(before ? { id: { lt: before } } : {}) },
      orderBy: { id: "desc" }, take: pageSize + 1,
      select: {
        id: true, directKey: true,
        messages: {
          where: { sender: { kind: "human" } }, orderBy: { id: "desc" }, take: 1,
          select: { sender: { select: { displayName: true } } }
        },
        members: { take: 1, select: { account: { select: { displayName: true, username: true } } } }
      }
    });
    return {
      rooms: rows.slice(0, pageSize).map(row => ({
        id: row.id,
        label: row.members[0]?.account.displayName || row.messages[0]?.sender.displayName || "已移除账号",
        username: row.members[0]?.account.username || null,
        accountId: Number(row.directKey?.slice(BIBLE_STUDY_ROOM_KEY_PREFIX.length))
      })),
      nextBefore: rows.length > pageSize ? rows[pageSize - 1].id : null
    };
  });

  app.get("/api/admin/bible-study/rooms/:id", { preHandler: deps.requireAdmin }, async (request, reply) => {
    const params = roomParams.safeParse(request.params);
    const query = pageQuery.safeParse(request.query);
    if (!params.success || !query.success) return reply.code(400).send({ message: "查经记录参数无效" });
    const room = await prisma.channel.findFirst({
      where: { id: params.data.id, directKey: { startsWith: BIBLE_STUDY_ROOM_KEY_PREFIX } }, select: { id: true }
    });
    if (!room) return reply.code(404).send({ message: "问答式查经不存在" });
    return records(room.id, query.data.before);
  });
}
