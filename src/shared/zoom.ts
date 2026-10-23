export const DEFAULT_MEETING_TIME_ZONE = "Asia/Shanghai";

export interface ZoomMeeting {
  endsAt: string;
  timeZone: string;
}

export interface ZoomSettings {
  url: string;
  meeting: ZoomMeeting | null;
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
