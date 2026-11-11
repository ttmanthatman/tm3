import assert from "node:assert/strict";
import test from "node:test";
import { calendarInputSchema, occurrenceStarts, wallTimeToDate, wallTime } from "./calendar.js";
const input = {
  title: "聚会",
  startAt: "2026-11-12T01:00:00.000Z",
  endAt: "2026-11-12T02:00:00.000Z",
  timeZone: "Asia/Shanghai"
};
test("private reminders are default; group reminders require public text and explicit disclosure", () => {
  const value = calendarInputSchema.parse(input);
  assert.equal(value.visibility, "private");
  assert.equal(value.reminderMode, "private");
  assert.equal(
    calendarInputSchema.safeParse({ ...input, reminderMode: "chain", reminderText: "报名" })
      .success,
    false
  );
  assert.equal(
    calendarInputSchema.safeParse({
      ...input,
      reminderMode: "chain",
      reminderText: "报名",
      publicReminderConfirmed: true
    }).success,
    true
  );
  for (const extra of [
    { endAt: "2026-11-11T00:00:00.000Z" },
    { timeZone: "bad" },
    { weekdays: [], repeat: "weekly" },
    { visibility: "members" },
    { reminders: [-1] },
    { ownerAccountId: 5 }
  ])
    assert.equal(calendarInputSchema.safeParse({ ...input, ...extra }).success, false);
});
test("weekly occurrences honor exclusions, range and the series cutoff", () => {
  const event = {
    startAt: new Date(input.startAt),
    repeat: "weekly",
    weekdays: [4],
    untilAt: new Date("2026-12-01"),
    timeZone: input.timeZone,
    excludedDates: ["2026-11-19T01:00:00.000Z"]
  };
  assert.deepEqual(
    occurrenceStarts(event, new Date("2026-11-01"), new Date("2026-12-10")).map((d) =>
      d.toISOString()
    ),
    [input.startAt, "2026-11-26T01:00:00.000Z"]
  );
});
test("daily recurrence keeps wall-clock time across daylight saving", () => {
  const event = {
    startAt: new Date("2026-03-07T14:00:00Z"),
    repeat: "daily",
    weekdays: [],
    untilAt: null,
    timeZone: "America/New_York"
  };
  const dates = occurrenceStarts(event, new Date("2026-03-07"), new Date("2026-03-10"));
  assert.deepEqual(
    dates.map((d) => d.toISOString()),
    ["2026-03-07T14:00:00.000Z", "2026-03-08T13:00:00.000Z", "2026-03-09T13:00:00.000Z"]
  );
  assert.equal(wallTime(dates[1], event.timeZone), "2026-03-08T09:00");
  assert.throws(() => wallTimeToDate("2026-03-08T02:30", event.timeZone), /不存在/);
});
test("recurrence preserves the first occurrence when the original timestamp has milliseconds", () => {
  const startAt = new Date("2026-11-12T01:00:00.123Z");
  assert.deepEqual(
    occurrenceStarts(
      { startAt, repeat: "daily", weekdays: [], untilAt: null, timeZone: "Asia/Shanghai" },
      startAt,
      new Date(startAt.getTime() + 1)
    ),
    [startAt]
  );
});
