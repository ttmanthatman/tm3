import assert from "node:assert/strict";
import test from "node:test";
import { calendarHolidays } from "./calendarHolidays";
import { CHINESE_LUNAR_HOLIDAYS } from "./calendarHolidayDates";

test("Western church dates follow Gregorian Easter, including exceptional earliest/latest Sundays", () => {
  const church = calendarHolidays("2026-01-01", "2026-12-31").filter(h => h.category === "church");
  assert.deepEqual(church.map(h => [h.date, h.title]), [
    ["2026-03-29", "棕枝主日"], ["2026-04-03", "受难日"], ["2026-04-05", "复活节"],
    ["2026-05-14", "升天日"], ["2026-05-24", "圣灵降临节"], ["2026-12-25", "圣诞节"]
  ]);
  for (const day of ["2027-03-28", "1818-03-22", "1943-04-25", "2000-04-23"]) {
    assert.equal(calendarHolidays(day, day).find(h => h.title === "复活节")?.date, day);
  }
});

test("Chinese festivals use the lunar date and Qingming's published Beijing civil date", () => {
  const chinese = calendarHolidays("2026-01-01", "2026-12-31").filter(h => h.category === "china");
  assert.deepEqual(chinese.map(h => [h.date, h.title]), [
    ["2026-01-01", "元旦"], ["2026-02-16", "除夕"], ["2026-02-17", "春节"],
    ["2026-03-03", "元宵节"], ["2026-04-05", "清明节"], ["2026-05-01", "劳动节"],
    ["2026-06-19", "端午节"], ["2026-09-25", "中秋节"], ["2026-10-01", "国庆节"],
    ["2026-10-18", "重阳节"]
  ]);
  assert.ok(chinese.every(h => h.description.includes("放假调休以官方公告为准")));
  const next = calendarHolidays("2027-01-01", "2027-12-31");
  assert.equal(next.find(h => h.title === "春节")?.date, "2027-02-06");
  assert.equal(next.find(h => h.title === "端午节")?.date, "2027-06-09");
});

test("leap lunar months do not repeat traditional festivals", () => {
  assert.deepEqual(calendarHolidays("2009-05-01", "2009-07-31").filter(h => h.title === "端午节").map(h => h.date), ["2009-05-28"]);
  assert.deepEqual(calendarHolidays("1995-08-01", "1995-10-31").filter(h => h.title === "中秋节").map(h => h.date), ["1995-09-09"]);
});

test("Hebrew festivals use the first daytime date and explain the previous sunset", () => {
  const holidays = calendarHolidays("2026-01-01", "2026-12-31").filter(h => h.category === "hebrew");
  assert.deepEqual(holidays.map(h => [h.date, h.title]), [
    ["2026-04-02", "逾越节（无酵节）"], ["2026-05-22", "七七节（五旬节）"],
    ["2026-09-12", "吹角节（犹太新年）"], ["2026-09-21", "赎罪日"],
    ["2026-09-26", "住棚节"], ["2026-12-05", "修殿节"]
  ]);
  assert.ok(holidays.every(h => h.description.includes("前一日日落开始")));
  const next = calendarHolidays("2027-01-01", "2027-12-31").filter(h => h.category === "hebrew");
  assert.deepEqual(next.map(h => [h.date, h.title]), [
    ["2027-04-22", "逾越节（无酵节）"], ["2027-06-11", "七七节（五旬节）"],
    ["2027-10-02", "吹角节（犹太新年）"], ["2027-10-11", "赎罪日"],
    ["2027-10-16", "住棚节"], ["2027-12-25", "修殿节"]
  ]);
});

test("inclusive windows cross years without duplicating festivals or changing event IDs", () => {
  const window = calendarHolidays("2026-12-25", "2027-01-01");
  assert.deepEqual(window.map(h => [h.date, h.title]), [["2026-12-25", "圣诞节"], ["2027-01-01", "元旦"]]);
  assert.deepEqual(window[0], calendarHolidays("2026-12-01", "2026-12-31").find(h => h.title === "圣诞节"));
  const april = calendarHolidays("2026-04-01", "2026-04-30");
  assert.equal(new Set(april.map(h => h.id)).size, april.length);
  assert.deepEqual(april.filter(h => h.date === "2026-04-05").map(h => h.category).sort(), ["china", "church"]);
});

test("Qingming covers the published 1901–2100 table without guessing outside it", () => {
  for (const [year, day] of [[1901, "05"], [1928, "05"], [2000, "04"], [2024, "04"], [2025, "04"], [2026, "05"], [2027, "05"], [2100, "05"]] as const) {
    const holiday = calendarHolidays(`${year}-04-01`, `${year}-04-07`).find(h => h.title === "清明节");
    assert.equal(holiday?.date, `${year}-04-${day}`);
  }
  assert.equal(calendarHolidays("2101-04-01", "2101-04-07").some(h => h.title === "清明节"), false);
});

test("the Chinese lunar source table covers 200 complete years with unique ordered dates", () => {
  assert.equal(CHINESE_LUNAR_HOLIDAYS.length, 200);
  CHINESE_LUNAR_HOLIDAYS.forEach((ordinals, index) => {
    const year = 1901 + index;
    assert.equal(ordinals.length, 5, `${year}`);
    assert.deepEqual([...ordinals].sort((a, b) => a - b), ordinals);
    assert.equal(new Set(ordinals).size, 5);
    assert.ok(ordinals.every(day => Number.isInteger(day) && day >= 21 && day <= 365));
    assert.ok(ordinals[0] <= 51, `${year} lunar new year`);
    assert.equal(ordinals[1] - ordinals[0], 14, `${year} lantern festival`);
    const festivals = calendarHolidays(`${year}-01-01`, `${year}-12-31`).filter(h => h.category === "china");
    assert.equal(festivals.length, 10, `${year}`);
    const spring = festivals.find(h => h.title === "春节")!, eve = festivals.find(h => h.title === "除夕")!;
    assert.equal(Date.parse(spring.date) - Date.parse(eve.date), 86_400_000);
  });
  assert.equal(calendarHolidays("1900-01-01", "1900-12-31").some(h => h.title === "春节"), false);
  assert.equal(calendarHolidays("2101-01-01", "2101-12-31").some(h => h.title === "春节"), false);
});

test("invalid or reversed civil-date windows return no dates", () => {
  for (const [from, to] of [["2026-02-30", "2026-03-02"], ["2026-4-1", "2026-04-30"], ["2026-04-03", "2026-04-02"], ["invalid", "2026-12-31"]]) {
    assert.deepEqual(calendarHolidays(from, to), []);
  }
});
