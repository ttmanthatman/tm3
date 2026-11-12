import assert from "node:assert/strict";
import test from "node:test";
import { calendarLunar } from "./calendarLunar";
import { calendarHolidays } from "./calendarHolidays";

test("lunar dates cover new years, leap months and Gregorian year boundaries", () => {
  for (const [date, full] of [
    ["2026-02-17", "农历正月初一"], ["2027-02-06", "农历正月初一"],
    ["2025-07-25", "农历闰六月初一"], ["2025-08-22", "农历闰六月廿九"],
    ["2027-01-01", "农历冬月廿四"], ["1901-01-01", "农历冬月十一"]
  ]) assert.equal(calendarLunar(date)?.full, full, date);
  assert.equal(calendarLunar("2027-02-06")?.short, "正月");
  assert.equal(calendarLunar("2027-02-07")?.short, "初二");
  for (const date of ["1900-12-31", "2101-01-01", "2026-02-30", "invalid"]) assert.equal(calendarLunar(date), null);
});

test("displayed lunar dates agree with the existing official festival dates across all supported years", () => {
  const names: Record<string, string> = { 春节: "农历正月初一", 元宵节: "农历正月十五", 端午节: "农历五月初五", 中秋节: "农历八月十五", 重阳节: "农历九月初九" };
  for (let year = 1901; year <= 2100; year++) {
    for (const holiday of calendarHolidays(`${year}-01-01`, `${year}-12-31`)) {
      if (names[holiday.title]) assert.equal(calendarLunar(holiday.date)?.full, names[holiday.title], holiday.date);
    }
  }
});
