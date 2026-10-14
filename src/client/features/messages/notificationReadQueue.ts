import type { NotificationRead } from "@shared/notificationRead";

function key(accountId: number) { return `team-chat-notification-read-pending-${accountId}`; }

function storedReads(storageKey: string): NotificationRead[] {
  try {
    const rows: unknown = JSON.parse(localStorage.getItem(storageKey) || "[]");
    if (!Array.isArray(rows)) return [];
    return rows.filter((row): row is NotificationRead => row && ["mention", "like", "favorite"].includes(row.kind) && Number.isSafeInteger(row.id) && row.id > 0);
  } catch { return []; }
}

export function pendingNotificationReads(accountId: number) { return accountId ? storedReads(key(accountId)) : []; }
export function knownNotificationReads(accountId: number) { return accountId ? storedReads(`team-chat-notification-read-${accountId}`) : []; }
export function rememberNotificationRead(accountId: number, read: NotificationRead) {
  if (!accountId) return;
  const rows = knownNotificationReads(accountId);
  if (rows.some((row) => row.kind === read.kind && row.id === read.id)) return;
  localStorage.setItem(`team-chat-notification-read-${accountId}`, JSON.stringify([...rows, read]));
}

export function queueNotificationRead(accountId: number, read: NotificationRead) {
  if (!accountId) return;
  const rows = pendingNotificationReads(accountId);
  if (!rows.some((row) => row.kind === read.kind && row.id === read.id)) rows.push(read);
  localStorage.setItem(key(accountId), JSON.stringify(rows));
}

export function completeNotificationRead(accountId: number, read: NotificationRead) {
  const rows = pendingNotificationReads(accountId).filter((row) => row.kind !== read.kind || row.id !== read.id);
  localStorage.setItem(key(accountId), JSON.stringify(rows));
}
