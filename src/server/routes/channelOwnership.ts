import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";

type ChannelOwnershipAuthContext = {
  accountId: number;
};

export type ChannelOwnershipRouteDependencies = {
  prisma: PrismaClient;
  requireAuth: preHandlerHookHandler;
  authFor: (request: FastifyRequest) => ChannelOwnershipAuthContext;
  leaveAccountChannel: (accountId: number, channelId: number) => void;
  emitMemberLeft: (channelId: number, previousOwnerId: number, nextOwnerId: number | null) => Promise<void>;
  emitSystemMessage: (messageId: number) => Promise<void>;
};

class OwnershipTransferConflict extends Error {}

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });
const leaveBodySchema = z.object({ successorAccountId: z.number().int().positive().optional() });

async function leaveChannel(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: ChannelOwnershipRouteDependencies,
  requireOwnershipTransfer: boolean
) {
  const params = paramsSchema.safeParse(request.params);
  const body = leaveBodySchema.safeParse(request.body ?? {});
  if (!params.success || !body.success || (requireOwnershipTransfer && !body.data.successorAccountId)) {
    return reply.code(400).send({ success: false, message: "负责人选择无效" });
  }

  const channelId = params.data.id;
  const leavingAccountId = deps.authFor(request).accountId;
  const successorAccountId = body.data.successorAccountId ?? null;
  if (successorAccountId === leavingAccountId) {
    return reply.code(400).send({ success: false, message: "请选择另一位频道成员接任负责人" });
  }

  const channel = await deps.prisma.channel.findUnique({
    where: { id: channelId },
    select: { kind: true, isPrivate: true, isDefault: true, directKey: true }
  });
  if (!channel) return reply.code(404).send({ success: false, message: "频道不存在" });
  if (channel.kind !== "standard" || !channel.isPrivate || channel.isDefault || channel.directKey) {
    return reply.code(400).send({ success: false, message: "此频道不支持退出" });
  }

  const leavingMembership = await deps.prisma.channelMember.findUnique({
    where: { channelId_accountId: { channelId, accountId: leavingAccountId } },
    select: {
      role: true,
      account: { select: { displayName: true, actor: { select: { id: true } } } }
    }
  });
  if (!leavingMembership) return reply.code(404).send({ success: false, message: "你已经不在这个频道中" });
  if (!leavingMembership.account.actor) {
    return reply.code(409).send({ success: false, message: "账号资料不完整，暂时无法退出频道" });
  }
  const leavingActorId = leavingMembership.account.actor.id;

  if (requireOwnershipTransfer && leavingMembership.role !== "owner") {
    return reply.code(403).send({ success: false, message: "只有当前频道负责人可以移交频道并退出" });
  }
  if (leavingMembership.role === "owner" && !successorAccountId) {
    return reply.code(400).send({ success: false, message: "频道负责人退出前必须指定新的频道负责人" });
  }
  if (leavingMembership.role !== "owner" && successorAccountId) {
    return reply.code(400).send({ success: false, message: "只有频道负责人退出时才能指定接任者" });
  }

  if (successorAccountId) {
    const successorMembership = await deps.prisma.channelMember.findUnique({
      where: { channelId_accountId: { channelId, accountId: successorAccountId } },
      select: { role: true }
    });
    if (!successorMembership) {
      return reply.code(404).send({ success: false, message: "接任者必须是频道中的现有成员" });
    }
  }

  let systemMessageId = 0;
  try {
    await deps.prisma.$transaction(async (transaction) => {
      if (successorAccountId) {
        const promotedSuccessor = await transaction.channelMember.updateMany({
          where: { channelId, accountId: successorAccountId },
          data: { role: "owner" }
        });
        if (promotedSuccessor.count !== 1) throw new OwnershipTransferConflict();
      }

      const notice = await transaction.message.create({
        data: {
          channelId,
          senderActorId: leavingActorId,
          type: "system",
          content: `${leavingMembership.account.displayName} 退出了频道`,
          payload: { systemKind: "channel-membership", action: "left", accountId: leavingAccountId }
        },
        select: { id: true }
      });
      systemMessageId = notice.id;

      const removedMembership = await transaction.channelMember.deleteMany({
        where: {
          channelId,
          accountId: leavingAccountId,
          ...(leavingMembership.role === "owner" ? { role: "owner" } : {})
        }
      });
      if (removedMembership.count !== 1) throw new OwnershipTransferConflict();
    });
  } catch (error) {
    if (error instanceof OwnershipTransferConflict) {
      return reply.code(409).send({ success: false, message: "频道成员状态已经变化，请刷新后重试" });
    }
    throw error;
  }

  deps.leaveAccountChannel(leavingAccountId, channelId);
  await deps.emitSystemMessage(systemMessageId);
  await deps.emitMemberLeft(channelId, leavingAccountId, successorAccountId);
  return { success: true, channelId, successorAccountId };
}

export function registerChannelOwnershipRoutes(app: FastifyInstance, deps: ChannelOwnershipRouteDependencies) {
  app.post("/api/channels/:id/leave", { preHandler: deps.requireAuth }, (request, reply) =>
    leaveChannel(request, reply, deps, false)
  );
  app.post("/api/channels/:id/transfer-and-leave", { preHandler: deps.requireAuth }, (request, reply) =>
    leaveChannel(request, reply, deps, true)
  );
}
