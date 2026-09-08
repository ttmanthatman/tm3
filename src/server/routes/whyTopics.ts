import type { FastifyInstance, preHandlerHookHandler } from "fastify";

// The “为什么” channel was removed; these stubs keep old clients on a
// well-defined 410/empty contract instead of falling into the SPA fallback.
export function registerWhyTopicsRoutes(app: FastifyInstance, deps: { requireAuth: preHandlerHookHandler }) {
  const { requireAuth } = deps;

  app.get("/api/why/topics", { preHandler: requireAuth }, async (request) => {
    void request;
    return { topics: [] };
  });

  app.get("/api/why/summary", { preHandler: requireAuth }, async (request) => {
    void request;
    const unreadCount = 0;
    const pendingRequestCount = 0;
    return { unreadCount, pendingRequestCount };
  });

  app.post("/api/why/topics", { preHandler: requireAuth }, async (request, reply) => {
    void request;
    return reply.code(410).send({ success: false, message: "为什么频道已移除，请和为什么助手私聊继续研究话题" });
  });

  app.get("/api/why/topics/:id", { preHandler: requireAuth }, async (request, reply) => {
    void request;
    return reply.code(410).send({ success: false, message: "为什么频道已移除，请和为什么助手私聊继续研究话题" });
  });

  app.post("/api/why/topics/:id/messages", { preHandler: requireAuth }, async (request, reply) => {
    void request;
    return reply.code(410).send({ success: false, message: "为什么频道已移除，请和为什么助手私聊继续研究话题" });
  });

  app.post("/api/why/topics/:id/request", { preHandler: requireAuth }, async (request, reply) => {
    void request;
    return reply.code(410).send({ success: false, message: "为什么频道已移除，请和为什么助手私聊继续研究话题" });
  });

  app.post("/api/why/topics/:id/requests/:accountId", { preHandler: requireAuth }, async (request, reply) => {
    void request;
    return reply.code(410).send({ success: false, message: "为什么频道已移除，请和为什么助手私聊继续研究话题" });
  });

  app.patch("/api/why/topics/:id", { preHandler: requireAuth }, async (request, reply) => {
    void request;
    return reply.code(410).send({ success: false, message: "为什么频道已移除，请和为什么助手私聊继续研究话题" });
  });

  app.post("/api/why/topics/:id/complete", { preHandler: requireAuth }, async (request, reply) => {
    void request;
    return reply.code(410).send({ success: false, message: "为什么频道已移除，请和为什么助手私聊继续研究话题" });
  });

  app.post("/api/why/topics/:id/retry-assistant", { preHandler: requireAuth }, async (request, reply) => {
    void request;
    return reply.code(410).send({ success: false, message: "为什么频道已移除，请和为什么助手私聊继续研究话题" });
  });

  app.delete("/api/why/topics/:id", { preHandler: requireAuth }, async (request, reply) => {
    void request;
    return reply.code(410).send({ success: false, message: "为什么频道已移除，请和为什么助手私聊继续研究话题" });
  });
}
