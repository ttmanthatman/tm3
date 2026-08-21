import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { Prisma, type Account, type AccountSession, type Actor, type PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AccountDTO, AdminReceptionRoomDTO, ChannelDTO } from "../../shared/types.js";

type ReceptionAuth = {
  accountId: number;
  isAdmin: boolean;
  isGuest: boolean;
};

type AccountWithActor = Account & { actor: Actor | null };

export type ReceptionRouteDeps = {
  prisma: PrismaClient;
  tokenSecret: string;
  requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  authFor: (request: FastifyRequest) => ReceptionAuth;
  createAuthSession: (accountId: number, request: FastifyRequest, deviceName?: string, appVersion?: string) => Promise<AccountSession>;
  signToken: (account: AccountWithActor, session: Pick<AccountSession, "id">) => string;
  authDto: (account: AccountWithActor) => AccountDTO;
  channelDto: (channelId: number, viewer: { accountId: number; isAdmin: boolean; canPinMessages: boolean }) => Promise<ChannelDTO | null>;
  joinAccountChannel: (accountId: number, channelId: number) => void;
  emitRoomUpdated: (channelId: number, action: string) => Promise<void>;
  deleteRoom: (channelId: number) => Promise<boolean>;
};

export const roomSchema = z.object({
  name: z.string().trim().min(1, "请输入会客厅名称").max(80),
  code: z.string().trim().min(1, "请输入来访口令").max(32),
  durationHours: z.number().int().min(1).max(24 * 30)
});

export const roomUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  code: z.string().trim().min(1, "请输入来访口令").max(32).optional(),
  durationHours: z.number().int().min(1).max(24 * 30).optional()
}).refine((body) => body.name !== undefined || body.code !== undefined || body.durationHours !== undefined, "没有要更新的内容");

const joinSchema = z.object({
  code: z.string().trim().min(1).max(32),
  displayName: z.string().trim().min(1).max(80),
  deviceName: z.string().max(120).optional(),
  appVersion: z.string().max(32).optional()
});

export function normalizeReceptionCode(input: string) {
  const code = input.trim().normalize("NFC").toLowerCase();
  if (!/^[\p{L}\p{N}]+$/u.test(code)) throw new Error("来访口令只能使用文字或数字");
  if (/^\d+$/.test(code) && code.length < 6) throw new Error("纯数字口令至少需要 6 位");
  if (!/^\d+$/.test(code) && [...code].length < 2) throw new Error("文字口令至少需要 2 个字");
  return code;
}

export function receptionCodeHash(code: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(normalizeReceptionCode(code)).digest("hex");
}

function expiresAfterHours(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

function guestUsername() {
  return `guest_${crypto.randomBytes(12).toString("hex")}`;
}

function viewer(auth: ReceptionAuth) {
  return { accountId: auth.accountId, isAdmin: auth.isAdmin, canPinMessages: false };
}

async function ownedRoom(deps: ReceptionRouteDeps, channelId: number, accountId: number) {
  return deps.prisma.channel.findFirst({
    where: { id: channelId, kind: "reception", receptionOwnerAccountId: accountId }
  });
}

export function registerReceptionRoutes(app: FastifyInstance, deps: ReceptionRouteDeps) {
  app.post(
    "/api/reception/rooms",
    { preHandler: deps.requireAuth },
    async (request, reply) => {
      const auth = deps.authFor(request);
      if (auth.isGuest) return reply.code(403).send({ success: false, message: "来访者不能创建会客厅" });
      const parsed = roomSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ success: false, message: parsed.error.issues[0]?.message || "会客厅资料无效" });
      let tokenHash: string;
      try {
        tokenHash = receptionCodeHash(parsed.data.code, deps.tokenSecret);
      } catch (error) {
        return reply.code(400).send({ success: false, message: error instanceof Error ? error.message : "来访口令无效" });
      }
      const expiresAt = expiresAfterHours(parsed.data.durationHours);
      try {
        const channel = await deps.prisma.channel.create({
          data: {
            kind: "reception",
            name: parsed.data.name,
            description: "邀请制会客厅",
            icon: "",
            isPrivate: true,
            receptionOwnerAccountId: auth.accountId,
            receptionTokenHash: tokenHash,
            receptionExpiresAt: expiresAt,
            members: { create: [{ accountId: auth.accountId, role: "owner" }] }
          }
        });
        deps.joinAccountChannel(auth.accountId, channel.id);
        const dto = await deps.channelDto(channel.id, viewer(auth));
        await deps.emitRoomUpdated(channel.id, "reception-created");
        return { success: true, channel: dto };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          return reply.code(409).send({ success: false, message: "这个来访口令已被使用，请换一个" });
        }
        throw error;
      }
    }
  );

  app.patch(
    "/api/reception/rooms/:id",
    { preHandler: deps.requireAuth },
    async (request, reply) => {
      const auth = deps.authFor(request);
      if (auth.isGuest) return reply.code(403).send({ success: false, message: "来访者不能管理会客厅" });
      const channelId = Number((request.params as { id: string }).id);
      if (!Number.isInteger(channelId) || channelId <= 0) return reply.code(400).send({ success: false, message: "会客厅编号无效" });
      if (!(await ownedRoom(deps, channelId, auth.accountId))) return reply.code(403).send({ success: false, message: "只有创建者可以管理这个会客厅" });
      const parsed = roomUpdateSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ success: false, message: parsed.error.issues[0]?.message || "会客厅资料无效" });
      const data: Prisma.ChannelUpdateInput = {};
      if (parsed.data.name !== undefined) data.name = parsed.data.name;
      if (parsed.data.durationHours !== undefined) data.receptionExpiresAt = expiresAfterHours(parsed.data.durationHours);
      if (parsed.data.code !== undefined) {
        try {
          data.receptionTokenHash = receptionCodeHash(parsed.data.code, deps.tokenSecret);
        } catch (error) {
          return reply.code(400).send({ success: false, message: error instanceof Error ? error.message : "来访口令无效" });
        }
      }
      try {
        const updated = await deps.prisma.channel.update({ where: { id: channelId }, data });
        if (parsed.data.durationHours !== undefined && updated.receptionExpiresAt) {
          const guestAccounts = await deps.prisma.channelMember.findMany({
            where: { channelId, account: { isGuest: true, guestExpiresAt: { gt: new Date() } } },
            select: { accountId: true }
          });
          if (guestAccounts.length) {
            await deps.prisma.account.updateMany({
              where: { id: { in: guestAccounts.map((row) => row.accountId) }, isGuest: true },
              data: { guestExpiresAt: updated.receptionExpiresAt }
            });
          }
        }
        await deps.emitRoomUpdated(channelId, "reception-updated");
        return { success: true, channel: await deps.channelDto(channelId, viewer(auth)) };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          return reply.code(409).send({ success: false, message: "这个来访口令已被使用，请换一个" });
        }
        throw error;
      }
    }
  );

  app.delete(
    "/api/reception/rooms/:id",
    { preHandler: deps.requireAuth },
    async (request, reply) => {
      const auth = deps.authFor(request);
      const channelId = Number((request.params as { id: string }).id);
      if (!Number.isInteger(channelId) || channelId <= 0) return reply.code(400).send({ success: false, message: "会客厅编号无效" });
      if (auth.isGuest || !(await ownedRoom(deps, channelId, auth.accountId))) {
        return reply.code(403).send({ success: false, message: "只有创建者可以回收这个会客厅" });
      }
      await deps.deleteRoom(channelId);
      return { success: true };
    }
  );

  app.post(
    "/api/reception/join",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = joinSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ success: false, message: "请输入来访口令和昵称" });
      let tokenHash: string;
      try {
        tokenHash = receptionCodeHash(parsed.data.code, deps.tokenSecret);
      } catch {
        return reply.code(400).send({ success: false, message: "来访口令无效" });
      }
      const room = await deps.prisma.channel.findUnique({ where: { receptionTokenHash: tokenHash } });
      if (!room || room.kind !== "reception") return reply.code(404).send({ success: false, message: "会客厅不存在或口令无效" });
      if (!room.receptionExpiresAt || room.receptionExpiresAt <= new Date()) {
        void deps.deleteRoom(room.id).catch((error) => request.log.warn({ error, channelId: room.id }, "Failed to collect expired reception room"));
        return reply.code(410).send({ success: false, message: "这个会客厅已经过期并开始回收" });
      }
      const username = guestUsername();
      const passwordHash = await bcrypt.hash(crypto.randomBytes(24).toString("hex"), 12);
      const account = await deps.prisma.account.create({
        data: {
          username,
          passwordHash,
          displayName: parsed.data.displayName,
          role: "user",
          isGuest: true,
          guestExpiresAt: room.receptionExpiresAt,
          actor: { create: { kind: "human", username, displayName: parsed.data.displayName } },
          memberships: { create: [{ channelId: room.id, role: "member" }] }
        },
        include: { actor: true }
      });
      const session = await deps.createAuthSession(account.id, request, parsed.data.deviceName, parsed.data.appVersion);
      deps.joinAccountChannel(account.id, room.id);
      await deps.emitRoomUpdated(room.id, "reception-guest-joined");
      return {
        success: true,
        token: deps.signToken(account, session),
        account: deps.authDto(account),
        channel: await deps.channelDto(room.id, { accountId: account.id, isAdmin: false, canPinMessages: false })
      };
    }
  );

  app.get(
    "/api/admin/reception-rooms",
    { preHandler: deps.requireAdmin },
    async () => {
      const rooms = await deps.prisma.channel.findMany({
        where: { kind: "reception" },
        include: {
          _count: { select: { members: true, messages: true } },
          members: { select: { account: { select: { isGuest: true, guestExpiresAt: true } } } },
          messages: { orderBy: { id: "desc" }, take: 1, select: { createdAt: true } }
        },
        orderBy: { createdAt: "desc" }
      });
      const ownerIds = [...new Set(rooms.map((room) => room.receptionOwnerAccountId).filter((id): id is number => !!id))];
      const owners = await deps.prisma.account.findMany({ where: { id: { in: ownerIds } }, select: { id: true, displayName: true } });
      const ownerNames = new Map(owners.map((owner) => [owner.id, owner.displayName]));
      const attachmentSums = await deps.prisma.message.groupBy({
        by: ["channelId"],
        where: { channelId: { in: rooms.map((room) => room.id) }, fileSize: { not: null } },
        _sum: { fileSize: true }
      });
      const attachmentBytes = new Map(attachmentSums.map((row) => [row.channelId, row._sum.fileSize || 0]));
      return {
        rooms: rooms.map((room): AdminReceptionRoomDTO => ({
          id: room.id,
          name: `会客厅 #${room.id}`,
          ownerAccountId: room.receptionOwnerAccountId || 0,
          ownerName: ownerNames.get(room.receptionOwnerAccountId || 0) || "账号已删除",
          createdAt: room.createdAt.toISOString(),
          expiresAt: (room.receptionExpiresAt || room.createdAt).toISOString(),
          memberCount: room.members.filter((member) => !member.account.isGuest || !!member.account.guestExpiresAt && member.account.guestExpiresAt > new Date()).length,
          guestCount: room.members.filter((member) => member.account.isGuest && !!member.account.guestExpiresAt && member.account.guestExpiresAt > new Date()).length,
          messageCount: room._count.messages,
          attachmentBytes: attachmentBytes.get(room.id) || 0,
          lastMessageAt: room.messages[0]?.createdAt.toISOString() || null
        }))
      };
    }
  );

  app.delete(
    "/api/admin/reception-rooms/:id",
    { preHandler: deps.requireAdmin },
    async (request, reply) => {
      const channelId = Number((request.params as { id: string }).id);
      const room = await deps.prisma.channel.findFirst({ where: { id: channelId, kind: "reception" }, select: { id: true } });
      if (!room) return reply.code(404).send({ success: false, message: "会客厅不存在" });
      await deps.deleteRoom(channelId);
      return { success: true };
    }
  );
}
