import type { Message, PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type {
  MessageDTO,
  SermonPresenterStatusDTO,
  SermonRequestPayloadDTO,
  SermonWatchAccountDTO
} from "../../shared/types.js";
import {
  canPresentSermon,
  isPermanentSermonUntil,
  sermonUntilForDuration
} from "../sermon/permissions.js";
import type { SermonPresentationService } from "../sermon/presentations.js";

type SermonSocketEmitter = {
  to(room: string): { emit(event: string, payload: unknown): unknown };
};

export type SermonRouteDependencies = {
  prisma: PrismaClient;
  io: SermonSocketEmitter;
  requireAuth: preHandlerHookHandler;
  requireAdmin: preHandlerHookHandler;
  hydrateMessage(id: number, viewerAccountId?: number): Promise<MessageDTO | null>;
  service: SermonPresentationService;
  /** 观众选择器候选：全部注册账号（路由侧过滤访客）。 */
  listWatchAccounts(): Promise<Array<{ id: number; displayName: string; avatarPath: string | null; isGuest: boolean }>>;
  isOnline(accountId: number): boolean;
};

type SermonRouteAuth = {
  accountId: number;
};
type SermonAuthedRequest = FastifyRequest & { auth: SermonRouteAuth };

const decideSchema = z.object({
  approve: z.boolean(),
  duration: z.enum(["24h", "7d", "30d", "permanent"]).optional()
});

function presenterUntilDto(until: Date | null): string | null {
  if (!until) return null;
  return isPermanentSermonUntil(until) ? null : until.toISOString();
}

function sermonRequestPayloadRaw(message: Message): Record<string, unknown> {
  return message.payload && typeof message.payload === "object" && !Array.isArray(message.payload)
    ? (message.payload as Record<string, unknown>)
    : {};
}

export function registerSermonRoutes(app: FastifyInstance, deps: SermonRouteDependencies) {
  app.get("/api/sermon/presenter-status", { preHandler: deps.requireAuth }, async (request, reply) => {
    const auth = (request as SermonAuthedRequest).auth;
    const account = await deps.prisma.account.findUnique({
      where: { id: auth.accountId },
      select: { role: true, sermonPresenterUntil: true }
    });
    if (!account) return reply.code(404).send({ success: false, message: "用户不存在" });
    const status: SermonPresenterStatusDTO = {
      canPresent: canPresentSermon({
        isAdmin: account.role === "admin",
        sermonPresenterUntil: account.sermonPresenterUntil
      }),
      until: presenterUntilDto(account.sermonPresenterUntil),
      isAdmin: account.role === "admin"
    };
    return status;
  });

  app.get("/api/sermon/directory", { preHandler: deps.requireAuth }, async (request) => {
    const auth = (request as SermonAuthedRequest).auth;
    return deps.service.directory(auth.accountId);
  });

  app.get("/api/sermon/accounts", { preHandler: deps.requireAuth }, async (request, reply) => {
    const auth = (request as SermonAuthedRequest).auth;
    const account = await deps.prisma.account.findUnique({
      where: { id: auth.accountId },
      select: { role: true, sermonPresenterUntil: true }
    });
    if (!account) return reply.code(404).send({ success: false, message: "用户不存在" });
    if (!canPresentSermon({ isAdmin: account.role === "admin", sermonPresenterUntil: account.sermonPresenterUntil })) {
      return reply.code(403).send({ success: false, message: "无讲道权限" });
    }
    const rows = await deps.listWatchAccounts();
    const accounts: SermonWatchAccountDTO[] = rows
      .filter((row) => !row.isGuest)
      .map((row) => ({
        id: row.id,
        displayName: row.displayName,
        avatarPath: row.avatarPath,
        online: deps.isOnline(row.id),
        seatedPresentation: deps.service.seatOf(row.id)
      }));
    return accounts;
  });

  app.post(
    "/api/messages/:id/sermon-request/decide",
    { preHandler: deps.requireAdmin },
    async (request, reply) => {
      const auth = (request as SermonAuthedRequest).auth;
      const messageId = Number((request.params as { id: string }).id);
      if (!Number.isInteger(messageId) || messageId <= 0) {
        return reply.code(400).send({ success: false, message: "申请编号无效" });
      }
      const parsed = decideSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ success: false, message: "参数无效", issues: parsed.error.issues });
      }
      const message = await deps.prisma.message.findUnique({
        where: { id: messageId },
        include: { sender: true }
      });
      if (!message || message.type !== "sermon_request") {
        return reply.code(404).send({ success: false, message: "讲道权限申请不存在" });
      }
      const raw = sermonRequestPayloadRaw(message);
      if (raw.status !== "pending") {
        return reply.code(409).send({ success: false, message: "此申请已处理" });
      }
      const decidedAt = new Date();
      const grantedUntilDate = parsed.data.approve
        ? sermonUntilForDuration(parsed.data.duration || "7d", decidedAt)
        : null;
      const grantedUntil =
        grantedUntilDate && !isPermanentSermonUntil(grantedUntilDate) ? grantedUntilDate.toISOString() : null;
      const admin = await deps.prisma.account.findUnique({
        where: { id: auth.accountId },
        select: { displayName: true }
      });
      const payload: SermonRequestPayloadDTO = {
        note: typeof raw.note === "string" ? raw.note : "",
        status: parsed.data.approve ? "approved" : "rejected",
        decidedById: auth.accountId,
        decidedByName: admin?.displayName || null,
        decidedAt: decidedAt.toISOString(),
        grantedUntil
      };
      if (parsed.data.approve) {
        if (!message.sender.accountId) {
          return reply.code(409).send({ success: false, message: "申请人账号无效" });
        }
        await deps.prisma.account.update({
          where: { id: message.sender.accountId },
          data: { sermonPresenterUntil: grantedUntilDate }
        });
      }
      await deps.prisma.message.update({
        where: { id: message.id },
        data: { payload: payload as unknown as Prisma.InputJsonObject }
      });
      const dto = await deps.hydrateMessage(message.id, auth.accountId);
      if (dto) deps.io.to(`ch:${message.channelId}`).emit("message:updated", dto);
      if (message.sender.accountId) {
        deps.io.to(`acct:${message.sender.accountId}`).emit("sermon:request:decided", {
          messageId: message.id,
          approve: parsed.data.approve,
          until: grantedUntil
        });
      }
      return { success: true, message: dto };
    }
  );
}
