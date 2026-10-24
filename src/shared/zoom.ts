export const DEFAULT_MEETING_TIME_ZONE = "Asia/Shanghai";

export function zoomMeetingId(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (!["zoom.us", "zoomgov.com"].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return null;
    return /^\/(?:j|wc\/join)\/(\d{9,11})\/?$/.exec(url.pathname)?.[1] || null;
  } catch { return null; }
}

export interface ZoomAnnouncementPayload {
  kind: "zoom_meeting";
  status: "active" | "inactive";
  url?: string;
}

export function zoomAnnouncementPayload(value: unknown): ZoomAnnouncementPayload | null {
  if (!value || typeof value !== "object" || !("kind" in value) || value.kind !== "zoom_meeting" || !("status" in value)) return null;
  if (value.status === "inactive") return { kind: "zoom_meeting", status: "inactive" };
  if (value.status !== "active" || !("url" in value) || typeof value.url !== "string" || !zoomMeetingId(value.url)) return null;
  return { kind: "zoom_meeting", status: "active", url: value.url };
}

export interface ZoomMeeting {
  endsAt: string;
  timeZone: string;
}

export interface ZoomSettings {
  url: string;
  meeting: ZoomMeeting | null;
  live?: ZoomLiveStatus;
}

export interface ZoomLiveStatus {
  status: "active" | "inactive" | "unknown";
  updatedAt?: string;
}

export function zoomMeetingStatus(settings: ZoomSettings, now = Date.now()): ZoomLiveStatus["status"] {
  return settings.live?.status ?? (meetingIsActive(settings.meeting, now) ? "active" : "inactive");
}

export function meetingIsActive(meeting: ZoomMeeting | null, now = Date.now()) {
  return !!meeting && Date.parse(meeting.endsAt) > now;
}

export function validMeetingTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("zh-CN", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function meetingEndLabel(meeting: ZoomMeeting) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: meeting.timeZone, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).format(new Date(meeting.endsAt));
}
