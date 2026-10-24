import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { ZoomMeetingEvent } from "./zoomWebhook.js";

// ':' cannot occur in an account username, keeping this identity server-owned.
const SYSTEM_USERNAME = "system:zoom";

function eventPrefix(event: ZoomMeetingEvent) {
  return createHash("sha256").update(JSON.stringify([event.meetingId, event.instanceId, event.status])).digest("hex").slice(0, 48) + "_";
}

export async function existingZoomAnnouncements(tx: Prisma.TransactionClient, event: ZoomMeetingEvent) {
  return tx.message.findMany({
    where: { type: "system", sender: { username: SYSTEM_USERNAME, kind: "system" }, clientRequestId: { startsWith: eventPrefix(event) } },
    select: { id: true }, orderBy: { id: "asc" }
  });
}

export async function writeZoomAnnouncements(tx: Prisma.TransactionClient, event: ZoomMeetingEvent, url: string) {
  const channels = await tx.channel.findMany({ where: { kind: "standard", isPrivate: false }, select: { id: true }, orderBy: { id: "asc" } });
  if (!channels.length) return [];
  const sender = await tx.actor.upsert({
    where: { username: SYSTEM_USERNAME }, update: {},
    create: { username: SYSTEM_USERNAME, kind: "system", displayName: "Zoom" }, select: { id: true, kind: true }
  });
  if (sender.kind !== "system") throw new Error("Zoom announcement identity is not a system actor");
  const messages: { id: number }[] = [];
  for (const channel of channels) {
    const clientRequestId = eventPrefix(event) + channel.id;
    messages.push(await tx.message.upsert({
      where: { senderActorId_clientRequestId: { senderActorId: sender.id, clientRequestId } }, update: {},
      create: {
        channelId: channel.id, senderActorId: sender.id, clientRequestId, type: "system",
        content: event.status === "active" ? "Zoom会议开始了" : "Zoom会议结束了",
        payload: { kind: "zoom_meeting", status: event.status, ...(event.status === "active" ? { url } : {}) }
      }, select: { id: true }
    }));
  }
  return messages;
}
