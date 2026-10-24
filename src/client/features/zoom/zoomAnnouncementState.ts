import type { MessageDTO } from "@shared/types";
import { zoomAnnouncementPayload, zoomMeetingId, zoomMeetingStatus, type ZoomSettings } from "@shared/zoom";

export function zoomAnnouncementEnded(message: MessageDTO, messages: readonly MessageDTO[], settings: ZoomSettings | null, now = Date.now()) {
  const announcement = zoomAnnouncementPayload(message.payload);
  if (announcement?.status !== "active") return false;
  // Any subsequent Zoom event in this channel supersedes this start notice,
  // including when another meeting has already started at the same URL.
  if (messages.some(candidate => candidate.channelId === message.channelId && candidate.id > message.id && candidate.type === "system" && zoomAnnouncementPayload(candidate.payload))) return true;
  // Keep the link disabled until a current meeting is confirmed.
  if (!settings || zoomMeetingStatus(settings, now) !== "active") return true;
  if (zoomMeetingId(settings.url) !== zoomMeetingId(announcement.url || "")) return true;
  // Covers historical notices when the newer event is outside loaded history.
  return !!settings.live?.updatedAt && Date.parse(settings.live.updatedAt) > Date.parse(message.createdAt);
}
