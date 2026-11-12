import { LUNAR_MONTH_STARTS } from "./calendarLunarDates";

const DAY = 86_400_000;
const months = ["正月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "冬月", "腊月"];
const digits = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

/** Civil-date lookup uses published dates, avoiding browser ICU lunar-calendar discrepancies. */
export function calendarLunar(date: string): { short: string; full: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const time = Date.parse(`${date}T12:00:00Z`), year = Number(date.slice(0, 4));
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date || year < 1901 || year > 2100) return null;
  const ordinal = Math.round((time - Date.UTC(year, 0, 1, 12)) / DAY) + 1;
  const start = [...LUNAR_MONTH_STARTS[year - 1901]].reverse().find(value => Math.floor(value / 32) <= ordinal);
  let month: number, day: number;
  if (start !== undefined) {
    month = start % 32;
    day = ordinal - Math.floor(start / 32) + 1;
  } else if (year > 1901) {
    const previous = LUNAR_MONTH_STARTS[year - 1902].at(-1)!;
    month = previous % 32;
    day = Math.round((time - Date.UTC(year - 1, 0, Math.floor(previous / 32), 12)) / DAY) + 1;
  } else {
    // The first published row is 1901-01-01 = lunar eleventh month, day eleven.
    month = 11;
    day = ordinal + 10;
  }
  const monthName = `${month > 16 ? "闰" : ""}${months[(month % 16) - 1]}`;
  const dayName = day === 10 ? "初十" : day === 20 ? "二十" : day === 30 ? "三十" : `${day < 10 ? "初" : day < 20 ? "十" : "廿"}${digits[(day - 1) % 10]}`;
  return { short: day === 1 ? monthName : dayName, full: `农历${monthName}${dayName}` };
}
