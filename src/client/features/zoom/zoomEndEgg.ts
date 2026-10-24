export const ZOOM_END_REPLIES = [
  "Zoom会议结束了", "确实结束了", "真的别点了", "你要信", "想参加吗？", "下次吧……", "别试了真没了"
] as const;

export interface ExplorationDate { year: bigint; month: number; day: number }

export function explorationToday(now = new Date()): ExplorationDate {
  return { year: BigInt(now.getFullYear()), month: now.getMonth() + 1, day: now.getDate() };
}

export function previousExplorationDay(date: ExplorationDate): ExplorationDate {
  if (date.day > 1) return { ...date, day: date.day - 1 };
  const month = date.month === 1 ? 12 : date.month - 1;
  const year = date.month === 1 ? date.year - 1n : date.year;
  const leap = year % 4n === 0n && (year % 100n !== 0n || year % 400n === 0n);
  const day = month === 2 ? (leap ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31;
  return { year, month, day };
}

export function explorationDateLabel(date: ExplorationDate) {
  const year = date.year > 0n ? `${date.year}年` : `公元前${1n - date.year}年`;
  return `${year}${date.month}月${date.day}日`;
}
