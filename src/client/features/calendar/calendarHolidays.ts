import { CHINESE_LUNAR_HOLIDAYS } from "./calendarHolidayDates";

export type HolidayCategory = "church" | "hebrew" | "china";

export interface CalendarHoliday {
  id: string;
  date: string;
  title: string;
  category: HolidayCategory;
  description: string;
}

const DAY = 86_400_000;
const hebrew = new Intl.DateTimeFormat("en-US-u-ca-hebrew", {
  month: "long", day: "numeric", timeZone: "UTC"
});

// One April day per year, 1901–2100, from the HKO's Bright & Clear solar term.
// https://www.hko.gov.hk/en/gts/time/conversion.htm
// Source files: /en/gts/time/calendar/text/files/T{year}e.txt
// Keep the published civil dates instead of approximating the solar term.
const QINGMING_APRIL_DAYS =
  "5665566556655565556555655565556555655565556555555555555555555555555555555554555455545554555455545554" +
  "5554555445544554455445544554455445544554445444544454445444544454445444544444444444444444444444444445";

type Festival = { key: string; title: string; description: string };
const lunarFestivals: Festival[] = [
  { key: "spring", title: "春节", description: "农历正月初一" },
  { key: "lantern", title: "元宵节", description: "农历正月十五" },
  { key: "dragon-boat", title: "端午节", description: "农历五月初五" },
  { key: "mid-autumn", title: "中秋节", description: "农历八月十五" },
  { key: "double-ninth", title: "重阳节", description: "农历九月初九" }
];
// Hebrew festival dates follow the conventional Jewish calendar, rather than
// projecting Christian Easter or a weekly recurrence onto the Hebrew year.
// https://www.hebcal.com/holidays/2026
const hebrewFestivals: Record<string, Festival> = {
  "Nisan-15": { key: "passover", title: "逾越节（无酵节）", description: "尼散月十五日" },
  "Sivan-6": { key: "shavuot", title: "七七节（五旬节）", description: "西弯月初六" },
  "Tishri-1": { key: "trumpets", title: "吹角节（犹太新年）", description: "提斯利月初一" },
  "Tishri-10": { key: "atonement", title: "赎罪日", description: "提斯利月初十" },
  "Tishri-15": { key: "tabernacles", title: "住棚节", description: "提斯利月十五日" },
  "Kislev-25": { key: "dedication", title: "修殿节", description: "基斯流月二十五日" }
};

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && dateKey(date) === value ? date : null;
}

function calendarDay(formatter: Intl.DateTimeFormat, date: Date) {
  const parts = formatter.formatToParts(date);
  return `${parts.find(p => p.type === "month")?.value}-${parts.find(p => p.type === "day")?.value}`;
}

// Oudin's Gregorian Easter algorithm, using integer division throughout.
// https://aa.usno.navy.mil/faq/easter
function easter(year: number) {
  const c = Math.trunc(year / 100);
  const n = year % 19;
  const k = Math.trunc((c - 17) / 25);
  let i = (c - Math.trunc(c / 4) - Math.trunc((c - k) / 3) + 19 * n + 15) % 30;
  i -= Math.trunc(i / 28) * (1 - Math.trunc(i / 28) * Math.trunc(29 / (i + 1)) * Math.trunc((21 - n) / 11));
  const j = (year + Math.trunc(year / 4) + i + 2 - c + Math.trunc(c / 4)) % 7;
  const l = i - j;
  const month = 3 + Math.trunc((l + 40) / 44);
  const day = l + 28 - 31 * Math.trunc(month / 4);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

/** Built-in festival dates in an inclusive civil-date window, independent of the device's time zone. */
export function calendarHolidays(from: string, to: string): CalendarHoliday[] {
  const first = parseDay(from), last = parseDay(to);
  if (!first || !last || first > last) return [];
  const holidays: CalendarHoliday[] = [];
  function add(date: string, category: HolidayCategory, festival: Festival) {
    if (date < from || date > to) return;
    holidays.push({ id: `${category}:${festival.key}:${date}`, date, category, title: festival.title, description: festival.description });
  }

  for (let year = first.getUTCFullYear(); year <= last.getUTCFullYear(); year++) {
    const yearKey = String(year).padStart(4, "0");
    if (year >= 1583) {
      const sunday = easter(year);
      for (const [offset, key, title] of [
        [-7, "palm-sunday", "棕枝主日"], [-2, "good-friday", "受难日"],
        [0, "easter", "复活节"], [39, "ascension", "升天日"], [49, "pentecost", "圣灵降临节"]
      ] as const) {
        add(dateKey(new Date(sunday.getTime() + offset * DAY)), "church", {
          key, title, description: "按公历西方教会历计算，各教会纪念安排可能不同。"
        });
      }
    }
    add(`${yearKey}-12-25`, "church", { key: "christmas", title: "圣诞节", description: "纪念耶稣基督降生。" });
    for (const [suffix, key, title] of [["01-01", "new-year", "元旦"], ["05-01", "labour", "劳动节"], ["10-01", "national", "国庆节"]] as const) {
      add(`${yearKey}-${suffix}`, "china", { key, title, description: "节日日期供参考，放假调休以官方公告为准。" });
    }
    const qingming = QINGMING_APRIL_DAYS[year - 1901];
    if (year >= 1901 && qingming) add(`${year}-04-0${qingming}`, "china", {
      key: "qingming", title: "清明节", description: "清明节气当日（北京时间），日期参考香港天文台；放假调休以官方公告为准。"
    });
    const lunarDates = CHINESE_LUNAR_HOLIDAYS[year - 1901];
    if (year >= 1901 && lunarDates) {
      lunarDates.forEach((ordinal, index) => {
        const festival = lunarFestivals[index];
        add(dateKey(new Date(Date.UTC(year, 0, ordinal, 12))), "china", {
          ...festival, description: `${festival.description}。节日日期供参考，放假调休以官方公告为准。`
        });
      });
      add(dateKey(new Date(Date.UTC(year, 0, lunarDates[0] - 1, 12))), "china", {
        key: "new-year-eve", title: "除夕", description: "农历岁末最后一天。放假调休以官方公告为准。"
      });
    }
  }

  for (let time = first.getTime(); time <= last.getTime(); time += DAY) {
    const date = new Date(time), day = dateKey(date);
    const festival = hebrewFestivals[calendarDay(hebrew, date)];
    if (festival) add(day, "hebrew", {
      ...festival, description: `${festival.description}。标记节期首日的白天日期，从前一日日落开始；节期长度因地区传统而异。`
    });
  }
  return holidays.sort((a, b) => a.date.localeCompare(b.date) || a.category.localeCompare(b.category) || a.id.localeCompare(b.id));
}
