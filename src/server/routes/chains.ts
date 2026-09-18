import type { Message, Prisma, PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { ChainPayload } from "../../shared/types.js";
import { endChainPayload } from "../services/chainService.js";

type ChainAuthContext = {
  accountId: number;
  actorId: number;
  isAdmin: boolean;
};

export type ChainRouteDependencies = {
  prisma: PrismaClient;
  requireAuth: preHandlerHookHandler;
  canAccessChannel(accountId: number, channelId: number): Promise<boolean>;
  refreshChannel(channelId: number): void;
};

function storedChainPayload(message: Pick<Message, "content" | "payload">): ChainPayload {
  const raw = message.payload && typeof message.payload === "object" && !Array.isArray(message.payload)
    ? (message.payload as unknown as Partial<ChainPayload>)
    : {};
  return {
    ...raw,
    topic: typeof raw.topic === "string" ? raw.topic : message.content || "接龙",
    participants: Array.isArray(raw.participants) ? raw.participants : []
  };
}

export function registerChainRoutes(app: FastifyInstance, deps: ChainRouteDependencies) {
  app.post("/api/chains/:rootId/end", { preHandler: deps.requireAuth }, async (request, reply) => {
    const auth = (request as FastifyRequest & { auth: ChainAuthContext }).auth;
    const params = z.object({ rootId: z.coerce.number().int().positive() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ success: false, message: "接龙参数无效" });

    const root = await deps.prisma.message.findFirst({
      where: { id: params.data.rootId, type: "chain" },
      include: { sender: { select: { accountId: true } } }
    });
    if (!root || !(await deps.canAccessChannel(auth.accountId, root.channelId))) {
      return reply.code(404).send({ success: false, message: "接龙不存在" });
    }
    if (!auth.isAdmin && root.sender.accountId !== auth.accountId) {
      return reply.code(403).send({ success: false, message: "只有接龙发起人或管理员可以终止接龙" });
    }

    const versions = await deps.prisma.message.findMany({
      where: {
        channelId: root.channelId,
        type: "chain",
        OR: [{ id: root.id }, { chainRootId: root.id }]
      },
      orderBy: { id: "asc" }
    });
    const latest = versions.at(-1);
    if (!latest) return reply.code(404).send({ success: false, message: "接龙不存在" });
    if (storedChainPayload(latest).ended) {
      return reply.code(409).send({ success: false, message: "接龙已经结束" });
    }

    const actor = await deps.prisma.actor.findUnique({ where: { id: auth.actorId }, select: { displayName: true } });
    if (!actor) return reply.code(404).send({ success: false, message: "操作账号不存在" });
    const at = new Date().toISOString();
    await deps.prisma.$transaction(
      versions.map((message) =>
        deps.prisma.message.update({
          where: { id: message.id },
          data: {
            payload: endChainPayload(storedChainPayload(message), {
              actorId: auth.actorId,
              displayName: actor.displayName,
              at
            }) as unknown as Prisma.InputJsonObject
          }
        })
      )
    );
    deps.refreshChannel(root.channelId);
    return { success: true, ended: { at, byActorId: auth.actorId, byName: actor.displayName } };
  });
}
