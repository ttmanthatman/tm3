import type { MessageDTO } from "@shared/types";

export interface VersionTimelineNotice {
  version: string;
  createdAt: number;
}

export function versionTimelineStorageKey(accountId: number) {
  return `team-chat-version-timeline:${accountId}`;
}

export function rememberVersionTimelineNotice(raw: string | null, version: string, now: number): VersionTimelineNotice[] {
  let saved: unknown;
  try { saved = raw ? JSON.parse(raw) : []; }
  catch { saved = []; }
  const notices = new Map<string, VersionTimelineNotice>();
  if (Array.isArray(saved)) {
    for (const item of saved) {
      if (!item || typeof item !== "object" || typeof item.version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(item.version)
        || typeof item.createdAt !== "number" || !Number.isFinite(item.createdAt) || item.createdAt <= 0) continue;
      if (!notices.has(item.version)) notices.set(item.version, { version: item.version, createdAt: item.createdAt });
    }
  }
  if (!notices.has(version)) notices.set(version, { version, createdAt: now });
  return [...notices.values()].sort((left, right) => left.createdAt - right.createdAt);
}

// A notice belongs between its neighbouring messages, including after history
// prepends and reloads. Omit notices outside the currently loaded window.
export function versionTimelineInsertions(
  notices: VersionTimelineNotice[],
  messages: Pick<MessageDTO, "createdAt">[],
  hasOlderMessages: boolean,
  hasNewerMessages: boolean
): Map<number, VersionTimelineNotice[]> {
  const insertions = new Map<number, VersionTimelineNotice[]>();
  const times = messages.map((message) => Date.parse(message.createdAt));
  for (const notice of notices) {
    if (hasOlderMessages && (!times.length || notice.createdAt < times[0])) continue;
    if (hasNewerMessages && (!times.length || notice.createdAt > times[times.length - 1])) continue;
    const next = times.findIndex((time) => time > notice.createdAt);
    const index = next < 0 ? messages.length : next;
    const group = insertions.get(index) || [];
    group.push(notice);
    insertions.set(index, group);
  }
  return insertions;
}
