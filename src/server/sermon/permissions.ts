export type SermonPresenterAccount = {
  isAdmin: boolean;
  sermonPresenterUntil: Date | null;
};

// "永久"权限没有真实截止日，数据库里用一个远未来哨兵日期表示。
export const SERMON_PERMANENT_UNTIL = new Date("9999-12-31T23:59:59.999Z");

export function canPresentSermon(account: SermonPresenterAccount, now = new Date()): boolean {
  if (account.isAdmin) return true;
  return !!account.sermonPresenterUntil && account.sermonPresenterUntil.getTime() > now.getTime();
}

export function isPermanentSermonUntil(until: Date): boolean {
  return until.getTime() >= SERMON_PERMANENT_UNTIL.getTime();
}

export type SermonGrantDuration = "24h" | "7d" | "30d" | "permanent";

export function sermonUntilForDuration(duration: SermonGrantDuration, now = new Date()): Date {
  if (duration === "permanent") return SERMON_PERMANENT_UNTIL;
  const days = duration === "24h" ? 1 : duration === "7d" ? 7 : 30;
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}
