import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { AssistantToolRegistry } from "../services/assistantTools.js";

const settingsSchema = z.object({ enabled: z.boolean(), maxCalls: z.number().int().min(1).max(12) }).strict();

export function createAssistantToolsSettingsStore(prisma: PrismaClient) {
  async function load() {
    const rows = await prisma.setting.findMany({ where: { key: { in: ["assistantToolsEnabled", "assistantToolsMaxCalls"] } } });
    const values = new Map(rows.map(row => [row.key, row.value]));
    const maxCalls = Number(values.get("assistantToolsMaxCalls") || 8);
    return { enabled: values.get("assistantToolsEnabled") !== "false", maxCalls: Number.isInteger(maxCalls) && maxCalls >= 1 && maxCalls <= 12 ? maxCalls : 8 };
  }
  async function save(input: z.infer<typeof settingsSchema>) {
    const settings = settingsSchema.parse(input);
    await prisma.$transaction(Object.entries({ assistantToolsEnabled: String(settings.enabled), assistantToolsMaxCalls: String(settings.maxCalls) }).map(([key, value]) =>
      prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } })));
    return settings;
  }
  return { load, save };
}

export function registerAssistantToolsRoutes(app: FastifyInstance, deps: {
  registry: AssistantToolRegistry; settings: ReturnType<typeof createAssistantToolsSettingsStore>; requireAdmin: preHandlerHookHandler;
}) {
  app.get("/api/admin/assistant-tools", { preHandler: deps.requireAdmin }, async () => ({ ...await deps.settings.load(), functions: deps.registry.list() }));
  app.post("/api/admin/assistant-tools", { preHandler: deps.requireAdmin }, async (request, reply) => {
    const parsed = settingsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ success: false, message: "功能调用设置无效" });
    return { ...await deps.settings.save(parsed.data), functions: deps.registry.list() };
  });
}
