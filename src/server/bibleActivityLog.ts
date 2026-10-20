import type { PrismaClient } from "@prisma/client";

// 圣经使用日志：进程内环形缓冲（重启即清），供 /log 后台页直接读取。
// 刻意不入库：这是轻量观测页，不是审计记录；需要持久化的行为走 AdminLoginLog 体系。

export type BibleActivityEntry = { at: number; account: string; action: string; detail: string };

const MAX_ENTRIES = 500;
const entries: BibleActivityEntry[] = [];
const accountNameCache = new Map<number, string>();

export function pushBibleActivity(action: string, detail: string, account: string) {
  entries.push({ at: Date.now(), account, action, detail });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
}

/** 账号显示名（displayName 优先，带 #id 兜底重名），小缓存避免每次查库。 */
export async function bibleActivityAccountLabel(prisma: PrismaClient, accountId: number) {
  const cached = accountNameCache.get(accountId);
  if (cached) return cached;
  const account = await prisma.account.findUnique({ where: { id: accountId }, select: { username: true, displayName: true } });
  const label = account ? account.displayName || account.username || `账号#${accountId}` : `账号#${accountId}`;
  accountNameCache.set(accountId, label);
  if (accountNameCache.size > 1000) accountNameCache.clear();
  return label;
}

export function recentBibleActivity(): BibleActivityEntry[] {
  return [...entries].reverse();
}
