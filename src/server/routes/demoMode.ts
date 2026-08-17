import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { DemoModeService } from "../demo/service.js";

type DemoModeRouteDeps = {
  requireAdmin: preHandlerHookHandler;
  service: DemoModeService;
};

type DemoAuthedRequest = {
  auth: {
    accountId: number;
    username: string;
  };
};

export function registerDemoModeRoutes(app: FastifyInstance, deps: DemoModeRouteDeps) {
  app.get("/api/admin/demo/status", { preHandler: deps.requireAdmin }, async () => deps.service.status(false));

  app.post("/api/admin/demo/check", { preHandler: deps.requireAdmin }, async () => deps.service.status(true));

  app.post("/api/admin/demo/reset", { preHandler: deps.requireAdmin }, async (request, reply) => {
    const body = z.object({ confirmation: z.literal("RESET DEMO") }).strict().safeParse(request.body);
    if (!body.success) return reply.code(400).send({ success: false, message: "请确认复位演示数据" });
    const auth = (request as typeof request & DemoAuthedRequest).auth;
    try {
      return await deps.service.reset({ accountId: auth.accountId, username: auth.username });
    } catch (error) {
      const message = error instanceof Error ? error.message : "演示数据复位失败";
      const status = /正在复位/.test(message) ? 409 : 500;
      return reply.code(status).send({ success: false, message });
    }
  });
}
