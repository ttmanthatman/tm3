import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { MulticharManager } from "./index.js";
import type { MulticharDeps } from "./types.js";

export function registerMulticharRoutes(
  app: FastifyInstance,
  deps: MulticharDeps,
  manager: MulticharManager,
  requireAdmin: (request: FastifyRequest, reply: any) => Promise<void>
) {

  app.get("/api/admin/multichar/status", { preHandler: requireAdmin }, async (request) => {
    const channelId = Number((request.query as { channelId?: string }).channelId || 0);
    if (channelId) {
      return { success: true, session: await manager.getSessionStatus(channelId) };
    }
    return { success: true, sessions: manager.getAllStatus() };
  });

  app.post("/api/admin/multichar/start", { preHandler: requireAdmin }, async (request, reply) => {
    const body = z.object({
      channelId: z.number().int().positive(),
      characterIds: z.array(z.number().int().positive()).min(1).max(10),
    }).parse(request.body);

    const channel = await deps.prisma.channel.findUnique({ where: { id: body.channelId } });
    if (!channel) return reply.code(404).send({ success: false, message: "频道不存在" });

    const validChars: number[] = [];
    for (const charId of body.characterIds) {
      const vc = await deps.prisma.virtualCharacter.findUnique({
        where: { id: charId },
        include: { actor: true },
      });
      if (!vc || !vc.enabled) {
        return reply.code(400).send({ success: false, message: `角色 ${charId} 不存在或未启用` });
      }
      validChars.push(charId);
    }

    const session = await manager.startSession(body.channelId, validChars);
    return { success: true, session };
  });

  app.post("/api/admin/multichar/stop", { preHandler: requireAdmin }, async (request) => {
    const body = z.object({ channelId: z.number().int().positive() }).parse(request.body);
    await manager.stopSession(body.channelId);
    return { success: true };
  });

  app.post("/api/admin/multichar/stop-all", { preHandler: requireAdmin }, async () => {
    manager.stopAll();
    return { success: true };
  });

  app.put("/api/admin/multichar/characters/:id/config", { preHandler: requireAdmin }, async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const body = z.object({
      bio: z.unknown().optional(),
      emotionBaseline: z.string().max(500).optional(),
      modelHints: z.object({
        urgeModel: z.string().optional(),
        mainModel: z.string().optional(),
        impressionModel: z.string().optional(),
      }).optional(),
    }).parse(request.body);

    const vc = await deps.prisma.virtualCharacter.findUnique({ where: { id } });
    if (!vc) return reply.code(404).send({ success: false, message: "角色不存在" });

    const existingConfig = (vc.config as Record<string, unknown>) ?? {};
    const existingMc = (existingConfig.multichar as Record<string, unknown>) ?? {};

    const newMc: Record<string, unknown> = { ...existingMc };
    if (body.bio !== undefined) newMc.bio = body.bio;
    if (body.emotionBaseline !== undefined) newMc.emotionBaseline = body.emotionBaseline;
    if (body.modelHints !== undefined) newMc.modelHints = body.modelHints;

    const updated = await deps.prisma.virtualCharacter.update({
      where: { id },
      data: { config: { ...existingConfig, multichar: newMc } as any },
      include: { actor: true },
    });

    return { success: true, character: updated };
  });

  app.get("/api/admin/multichar/characters/:id/memories", { preHandler: requireAdmin }, async (request) => {
    const id = Number((request.params as { id: string }).id);
    const type = (request.query as { type?: string }).type;
    const { MEMORY_TYPES } = await import("./types.js");
    const validTypes = Object.values(MEMORY_TYPES);
    const memType = type && validTypes.includes(type as any) ? (type as any) : undefined;

    const where = memType
      ? { characterId: id, subjectType: memType }
      : { characterId: id, subjectType: { in: validTypes as string[] } };

    const memories = await deps.prisma.characterMemory.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: 50,
    });

    return { success: true, memories };
  });
}
