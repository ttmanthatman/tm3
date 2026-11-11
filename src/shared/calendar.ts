import { z } from "zod";

export const calendarInputSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    description: z.string().max(5000).default(""),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    timeZone: z
      .string()
      .max(80)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }),
    allDay: z.boolean().default(false),
    visibility: z.enum(["private", "members", "group"]).default("private"),
    memberIds: z.array(z.number().int().positive()).max(200).default([]),
    repeat: z.enum(["none", "daily", "weekly"]).default("none"),
    weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    untilAt: z.string().datetime().nullable().default(null),
    reminders: z
      .array(z.number().int().min(0).max(43200))
      .min(1)
      .max(5)
      .default([0])
      .transform((values) => [...new Set(values)].sort((a, b) => b - a)),
    reminderMode: z.enum(["off", "private", "text", "chain"]).default("private"),
    reminderText: z.string().trim().max(3000).default(""),
    publicReminderConfirmed: z.boolean().default(false),
    chainConfig: z
      .object({
        requiredSelection: z.boolean(),
        allowMultiple: z.boolean(),
        options: z.array(z.string().trim().min(1).max(20)).max(10)
      })
      .nullable()
      .default(null),
    paused: z.boolean().default(false)
  })
  .strict()
  .superRefine((v, ctx) => {
    if (Date.parse(v.endAt) < Date.parse(v.startAt))
      ctx.addIssue({ code: "custom", message: "结束时间不能早于开始时间", path: ["endAt"] });
    if (Date.parse(v.endAt) - Date.parse(v.startAt) > 366 * 86400000)
      ctx.addIssue({ code: "custom", message: "单次日程不能超过一年", path: ["endAt"] });
    if (v.untilAt && Date.parse(v.untilAt) < Date.parse(v.startAt))
      ctx.addIssue({ code: "custom", message: "重复截止时间不能早于开始时间", path: ["untilAt"] });
    if (v.repeat === "weekly" && !v.weekdays.length)
      ctx.addIssue({ code: "custom", message: "请选择重复星期", path: ["weekdays"] });
    if (v.visibility === "members" && !v.memberIds.length)
      ctx.addIssue({ code: "custom", message: "请选择可见成员", path: ["memberIds"] });
    if (
      ["text", "chain"].includes(v.reminderMode) &&
      (!v.reminderText || (v.visibility !== "group" && !v.publicReminderConfirmed))
    )
      ctx.addIssue({
        code: "custom",
        message: "请填写公开提醒正文，并确认将其发送到全群",
        path: ["reminderText"]
      });
    if (v.chainConfig?.requiredSelection && !v.chainConfig.options.length)
      ctx.addIssue({ code: "custom", message: "请填写接龙选项", path: ["chainConfig"] });
  });
export type CalendarInput = z.infer<typeof calendarInputSchema>;
export interface CalendarEventDTO extends CalendarInput {
  id: number;
  channelId: number;
  ownerAccountId: number;
  ownerName: string;
  canManage: boolean;
  revision: number;
  occurrenceAt?: string;
  occurrenceEndAt?: string;
}
export interface CalendarNoticeDTO {
  id: number;
  eventId: number;
  channelId: number;
  title: string;
  description: string;
  occurrenceAt: string;
  allDay: boolean;
  timeZone: string;
}

/** Calendar arithmetic uses wall-clock days in the event zone, including DST. */
export function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const get = (name: string) => Number(parts.find((p) => p.type === name)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second")
  };
}
export function wallTimeToDate(value: string, timeZone: string) {
  const target = Date.parse(`${value}${value.length === 16 ? ":00" : ""}Z`);
  let result = target;
  for (let i = 0; i < 4; i++) {
    const p = zonedParts(new Date(result), timeZone);
    const represented = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const delta = target - represented;
    if (!delta) return new Date(result);
    result += delta;
  }
  throw new Error("该时区不存在这个时间，请调整时间");
}
export function wallTime(date: Date, timeZone: string) {
  const p = zonedParts(date, timeZone);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}
export function occurrenceStarts(
  event: {
    startAt: Date;
    repeat: string;
    weekdays: unknown;
    untilAt: Date | null;
    timeZone: string;
    excludedDates?: unknown;
  },
  from: Date,
  to: Date
): Date[] {
  if (event.repeat === "none")
    return event.startAt >= from &&
      event.startAt < to &&
      !(
        Array.isArray(event.excludedDates) &&
        event.excludedDates.includes(event.startAt.toISOString())
      )
      ? [event.startAt]
      : [];
  const result: Date[] = [];
  const first = zonedParts(event.startAt, event.timeZone);
  const begin = zonedParts(
    new Date(Math.max(from.getTime(), event.startAt.getTime())),
    event.timeZone
  );
  let day = Date.UTC(begin.year, begin.month - 1, begin.day);
  const end = to.getTime() + 86400000;
  for (let count = 0; day < end && count < 800; day += 86400000, count++) {
    const d = new Date(day);
    if (
      event.repeat === "weekly" &&
      !(Array.isArray(event.weekdays) && event.weekdays.includes(d.getUTCDay()))
    )
      continue;
    let at: Date;
    try {
      at = wallTimeToDate(
        `${d.toISOString().slice(0, 10)}T${String(first.hour).padStart(2, "0")}:${String(first.minute).padStart(2, "0")}:${String(first.second).padStart(2, "0")}`,
        event.timeZone
      );
    } catch {
      continue;
    }
    at.setUTCMilliseconds(event.startAt.getUTCMilliseconds());
    if (at < event.startAt || at < from || at >= to || (event.untilAt && at > event.untilAt))
      continue;
    if (Array.isArray(event.excludedDates) && event.excludedDates.includes(at.toISOString()))
      continue;
    result.push(at);
  }
  return result;
}
