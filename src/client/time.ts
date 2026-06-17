export function formatSeparator(iso: string, now = new Date()) {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === now.getFullYear();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((startToday.getTime() - startDate.getTime()) / 86400000);
  const hhmm = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (diffDays === 0) return hhmm;
  if (diffDays === 1) return `昨天 ${hhmm}`;
  if (diffDays > 1 && diffDays < 7) return `${["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()]} ${hhmm}`;
  if (sameYear) return `${date.getMonth() + 1}月${date.getDate()}日 ${hhmm}`;
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${hhmm}`;
}

export function shouldShowSeparator(prevIso: string | undefined, currentIso: string) {
  if (!prevIso) return true;
  return new Date(currentIso).getTime() - new Date(prevIso).getTime() > 5 * 60 * 1000;
}

export function compactBytes(size?: number | null) {
  if (!size) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
