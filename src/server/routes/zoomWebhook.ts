import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ZoomMeetingEvent } from "../services/zoomWebhook.js";

const challengeSchema = z.object({ event: z.literal("endpoint.url_validation"), payload: z.object({ plainToken: z.string().min(1).max(1024) }) });
const eventSchema = z.object({
  event: z.enum(["meeting.started", "meeting.ended"]),
  event_ts: z.number().int().nonnegative().max(8_640_000_000_000_000),
  payload: z.object({ object: z.object({
    id: z.union([z.string().regex(/^\d{9,11}$/), z.number().int().positive()]).transform(String),
    uuid: z.string().min(1).max(256)
  }) })
});

function validSignature(body: Buffer, timestamp: unknown, signature: unknown, secret: string, now: number) {
  if (typeof timestamp !== "string" || !/^\d{10}$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  if (typeof signature !== "string" || !/^v0=[a-f0-9]{64}$/.test(signature)) return false;
  const expected = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:`).update(body).digest("hex")}`;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export function registerZoomWebhookRoutes(app: FastifyInstance, deps: {
  secretToken: string;
  accept: (event: ZoomMeetingEvent) => Promise<void>;
  now?: () => number;
}) {
  // Raw parsing is encapsulated here so every existing JSON route keeps its parser.
  app.register(async webhook => {
    webhook.removeContentTypeParser("application/json");
    webhook.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) => done(null, body));
    webhook.post("/api/zoom/webhook", { bodyLimit: 64 * 1024 }, async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      if (!deps.secretToken) return reply.code(503).send({ message: "Zoom 自动同步尚未启用" });
      const body = request.body;
      const now = (deps.now || Date.now)();
      if (!Buffer.isBuffer(body) || !validSignature(body, request.headers["x-zm-request-timestamp"], request.headers["x-zm-signature"], deps.secretToken, now)) {
        return reply.code(401).send({ message: "无效的 Zoom 通知签名" });
      }
      let payload: unknown;
      try { payload = JSON.parse(body.toString("utf8")); }
      catch { return reply.code(400).send({ message: "无效的 Zoom 通知" }); }
      const challenge = challengeSchema.safeParse(payload);
      if (challenge.success) {
        const plainToken = challenge.data.payload.plainToken;
        return { plainToken, encryptedToken: createHmac("sha256", deps.secretToken).update(plainToken).digest("hex") };
      }
      const envelope = z.object({ event: z.string() }).safeParse(payload);
      if (!envelope.success) return reply.code(400).send({ message: "无效的 Zoom 通知" });
      if (envelope.data.event === "endpoint.url_validation") return reply.code(400).send({ message: "无效的 Zoom 验证请求" });
      if (!["meeting.started", "meeting.ended"].includes(envelope.data.event)) return reply.code(204).send();
      const event = eventSchema.safeParse(payload);
      if (!event.success || event.data.event_ts > now + 300_000) return reply.code(400).send({ message: "无效的 Zoom 会议通知" });
      await deps.accept({
        meetingId: event.data.payload.object.id, instanceId: event.data.payload.object.uuid,
        status: event.data.event === "meeting.started" ? "active" : "inactive", eventTs: event.data.event_ts
      });
      return reply.code(204).send();
    });
  });
}
