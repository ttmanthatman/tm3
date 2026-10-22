import type { Actor, PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { ChannelDTO } from "../../shared/types.js";

type Auth = { accountId: number; isGuest?: boolean; isAdmin: boolean; canPinMessages: boolean };

export function registerVirtualDirectChannelRoutes(app: FastifyInstance, deps: {
  prisma: PrismaClient;
  requireAuth: preHandlerHookHandler;
  ensureBuiltIn(username: string): Promise<Actor | null>;
  channelDto(channelId: number, auth: Auth): Promise<ChannelDTO | null>;
  joined(accountId: number, channelId: number, channel: ChannelDTO | null): void;
}) {
  app.post("/api/direct-virtual-channels", { preHandler: deps.requireAuth }, async (request, reply) => {
    const auth = (request as FastifyRequest & { auth: Auth }).auth;
    if (auth.isGuest) return reply.code(403).send({ success: false, message: "来访者不能发起私聊" });
    const parsed = z.object({ username: z.string().min(1).max(80) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ success: false, message: "角色参数无效" });
    await deps.ensureBuiltIn(parsed.data.username);
    const [me, character] = await Promise.all([
      deps.prisma.account.findUnique({ where: { id: auth.accountId }, include: { actor: true } }),
      deps.prisma.virtualCharacter.findFirst({ where: { enabled: true, actor: { username: parsed.data.username, kind: "virtual", status: "active" } }, include: { actor: true } })
    ]);
    if (!me?.actor || !character) return reply.code(404).send({ success: false, message: "角色不存在或未启用" });
    const name = `私聊：${me.displayName}、${character.actor.displayName}`.slice(0, 80);
    const channel = await deps.prisma.channel.upsert({
      where: { directKey: `virtual:${auth.accountId}:${character.actor.username}` },
      update: { name, isPrivate: true },
      create: {
        kind: "direct", name, description: "一对一私聊", icon: "", isPrivate: true,
        directKey: `virtual:${auth.accountId}:${character.actor.username}`,
        members: { create: [{ accountId: auth.accountId, role: "owner" }] }
      }
    });
    await deps.prisma.channelMember.createMany({ data: [{ accountId: auth.accountId, channelId: channel.id, role: "owner" }], skipDuplicates: true });
    const dto = await deps.channelDto(channel.id, auth);
    deps.joined(auth.accountId, channel.id, dto);
    return { success: true, channel: dto };
  });
}
