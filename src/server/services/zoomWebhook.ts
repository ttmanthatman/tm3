import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { ZoomLiveStatus } from "../../shared/zoom.js";

export const ZOOM_WEBHOOK_SETTING = "zoom.webhook";
const MAX_ACTIVE_AGE_MS = 24 * 60 * 60 * 1000;
const stateSchema = z.object({
  meetingId: z.string(), instanceId: z.string(),
  status: z.enum(["active", "inactive"]), eventTs: z.number().int().nonnegative()
});
export interface ZoomMeetingEvent {
  meetingId: string;
  instanceId: string;
  status: "active" | "inactive";
  eventTs: number;
}

export function zoomMeetingId(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (!["zoom.us", "zoomgov.com"].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return null;
    return /^\/(?:j|wc\/join)\/(\d{9,11})\/?$/.exec(url.pathname)?.[1] || null;
  } catch { return null; }
}

function readState(raw: string | undefined) {
  if (!raw) return null;
  // Invalid stored data must surface as an error instead of a false status.
  return stateSchema.nullable().parse(JSON.parse(raw));
}

export function createZoomWebhookStore(prisma: PrismaClient, now = Date.now) {
  function status(url: string, raw: string | undefined): ZoomLiveStatus {
    const state = readState(raw);
    if (!state || state.meetingId !== zoomMeetingId(url)) return { status: "unknown" };
    const updatedAt = new Date(state.eventTs).toISOString();
    if (state.status === "active" && now() - state.eventTs > MAX_ACTIVE_AGE_MS) return { status: "unknown", updatedAt };
    return { status: state.status, updatedAt };
  }

  async function accept(event: ZoomMeetingEvent) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const rows = await prisma.setting.findMany({ where: { key: { in: ["zoom.link", ZOOM_WEBHOOK_SETTING] } } });
      const settings = new Map(rows.map(row => [row.key, row.value]));
      if (zoomMeetingId(settings.get("zoom.link") || "") !== event.meetingId) return;
      const raw = settings.get(ZOOM_WEBHOOK_SETTING);
      const previous = readState(raw);
      if (previous?.meetingId === event.meetingId) {
        if (event.eventTs < previous.eventTs) return;
        // Ends win timestamp ties; retries and late starts cannot reopen them.
        if (event.eventTs === previous.eventTs && (previous.status === "inactive" || event.status === previous.status)) return;
        if (event.status === "inactive" && previous.status === "active" && event.instanceId !== previous.instanceId) return;
      }
      if (raw === undefined) {
        await prisma.setting.upsert({ where: { key: ZOOM_WEBHOOK_SETTING }, create: { key: ZOOM_WEBHOOK_SETTING, value: "null" }, update: {} });
        continue;
      }
      const updated = await prisma.setting.updateMany({
        where: { key: ZOOM_WEBHOOK_SETTING, value: raw }, data: { value: JSON.stringify(event) }
      });
      if (updated.count) return;
    }
    throw new Error("Zoom meeting status update conflicted; retry the notification");
  }
  return { status, accept };
}
