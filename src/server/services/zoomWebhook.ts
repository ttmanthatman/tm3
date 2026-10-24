import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { zoomMeetingId, type ZoomLiveStatus } from "../../shared/zoom.js";
import { existingZoomAnnouncements, writeZoomAnnouncements } from "./zoomAnnouncements.js";

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

function readState(raw: string | undefined) {
  if (!raw) return null;
  // Invalid stored data must surface as an error instead of a false status.
  return stateSchema.nullable().parse(JSON.parse(raw));
}

export function createZoomWebhookStore(prisma: PrismaClient, now = Date.now, publish?: (messageId: number) => Promise<unknown>) {
  function status(url: string, raw: string | undefined): ZoomLiveStatus {
    const state = readState(raw);
    if (!state || state.meetingId !== zoomMeetingId(url)) return { status: "unknown" };
    const updatedAt = new Date(state.eventTs).toISOString();
    if (state.status === "active" && now() - state.eventTs > MAX_ACTIVE_AGE_MS) return { status: "unknown", updatedAt };
    return { status: state.status, updatedAt };
  }

  async function applyEvent(tx: Prisma.TransactionClient, event: ZoomMeetingEvent) {
    const rows = await tx.setting.findMany({ where: { key: { in: ["zoom.link", ZOOM_WEBHOOK_SETTING] } } });
    const settings = new Map(rows.map(row => [row.key, row.value]));
    const url = settings.get("zoom.link") || "";
    if (zoomMeetingId(url) !== event.meetingId) return [];
    const raw = settings.get(ZOOM_WEBHOOK_SETTING);
    const previous = readState(raw);
    if (previous?.meetingId === event.meetingId) {
      if (event.eventTs < previous.eventTs) return [];
      if (previous.instanceId === event.instanceId && previous.status === event.status) return existingZoomAnnouncements(tx, event);
      // Ends win timestamp ties; retries and late starts cannot reopen them.
      if (event.eventTs === previous.eventTs && (previous.status === "inactive" || event.status === previous.status)) return [];
      if (previous.status === "inactive" && event.status === "active" && previous.instanceId === event.instanceId) return [];
      if (event.status === "inactive" && previous.status === "active" && event.instanceId !== previous.instanceId) return [];
    }
    if (raw === undefined) {
      await tx.setting.upsert({ where: { key: ZOOM_WEBHOOK_SETTING }, create: { key: ZOOM_WEBHOOK_SETTING, value: "null" }, update: {} });
      return null;
    }
    const updated = await tx.setting.updateMany({
      where: { key: ZOOM_WEBHOOK_SETTING, value: raw }, data: { value: JSON.stringify(event) }
    });
    if (!updated.count) return null;
    return writeZoomAnnouncements(tx, event, url);
  }

  async function accept(event: ZoomMeetingEvent) {
    for (let attempt = 0; attempt < 5; attempt++) {
      let result: { id: number }[] | null;
      try {
        result = await prisma.$transaction(tx => applyEvent(tx, event));
      } catch (error) {
        // Concurrent first deliveries can race when creating the state or system
        // actor. Retry the rolled-back transaction just like a write conflict.
        if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2034" || error.code === "P2002")) continue;
        throw error;
      }
      if (result) {
        // Broadcast only committed rows. A retry can re-emit the same IDs if
        // broadcasting fails; clients merge message:new by message ID.
        for (const message of result) await publish?.(message.id);
        return;
      }
    }
    throw new Error("Zoom meeting status update conflicted; retry the notification");
  }
  return { status, accept };
}
