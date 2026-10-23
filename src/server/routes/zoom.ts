import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import { meetingIsActive, validMeetingTimeZone, type ZoomSettings } from "../../shared/zoom.js";

const linkSchema = z.object({
  url: z.string().trim().max(2048).refine(value => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return ["https:", "http:"].includes(url.protocol) && !!url.hostname && !url.username && !url.password;
    } catch { return false; }
  })
}).strict();
const timeZoneSchema = z.string().min(1).max(100).refine(validMeetingTimeZone);
const meetingSchema = z.object({ active: z.boolean(), durationMinutes: z.number().int().min(1).max(10080), timeZone: timeZoneSchema }).strict();
const storedMeetingSchema = z.object({ endsAt: z.string().datetime(), timeZone: timeZoneSchema });

export function createZoomSettingsStore(prisma: PrismaClient, now = Date.now) {
  async function load(): Promise<ZoomSettings> {
    const rows = await prisma.setting.findMany({ where: { key: { in: ["zoom.link", "zoom.meeting"] } } });
    const settings = new Map(rows.map(row => [row.key, row.value]));
    const url = linkSchema.parse({ url: settings.get("zoom.link") || "" }).url;
    const raw = settings.get("zoom.meeting");
    const meeting = raw ? storedMeetingSchema.nullable().parse(JSON.parse(raw)) : null;
    return { url, meeting: meetingIsActive(meeting, now()) ? meeting : null };
  }
  async function save(key: string, value: string) {
    await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
    return load();
  }
  return {
    load,
    saveLink: (url: string) => save("zoom.link", linkSchema.parse({ url }).url),
    saveMeeting: (input: z.infer<typeof meetingSchema>) => {
      const value = meetingSchema.parse(input);
      return save("zoom.meeting", JSON.stringify(value.active ? {
        endsAt: new Date(now() + value.durationMinutes * 60_000).toISOString(), timeZone: value.timeZone
      } : null));
    }
  };
}

export function registerZoomRoutes(app: FastifyInstance, deps: {
  settings: ReturnType<typeof createZoomSettingsStore>;
  requireAuth: preHandlerHookHandler;
  requireAdmin: preHandlerHookHandler;
}) {
  app.get("/api/zoom", { preHandler: deps.requireAuth }, () => deps.settings.load());
  app.put("/api/admin/zoom/link", { preHandler: deps.requireAdmin }, async (request, reply) => {
    const result = linkSchema.safeParse(request.body);
    if (!result.success) return reply.code(400).send({ success: false, message: "请输入有效的 HTTP 或 HTTPS 会议链接" });
    return deps.settings.saveLink(result.data.url);
  });
  app.put("/api/admin/zoom/meeting", { preHandler: deps.requireAdmin }, async (request, reply) => {
    const result = meetingSchema.safeParse(request.body);
    if (!result.success) return reply.code(400).send({ success: false, message: "请检查会议时长（1–10080 分钟）和时区" });
    return deps.settings.saveMeeting(result.data);
  });
}
