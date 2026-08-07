export interface PrayerUpdateEntry {
  [key: string]: string | undefined;
  content: string;
  at: string;
  by?: string;
}

export const PRAYER_UPDATE_HISTORY_LIMIT = 20;

function cleanPrayerUpdateEntry(input: unknown): PrayerUpdateEntry | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  if (typeof record.content !== "string" || !record.content) return null;
  return {
    content: record.content,
    at: typeof record.at === "string" ? record.at : "",
    ...(typeof record.by === "string" && record.by ? { by: record.by } : {})
  };
}

// Builds the prayer card's update history with the content being replaced
// moved to the front, so the newest entry always renders on top.
export function prependPrayerUpdateHistory(
  rawPayload: Record<string, unknown>,
  currentContent: string,
  currentContentAt: string,
  currentContentBy?: string
): PrayerUpdateEntry[] {
  const previous = Array.isArray(rawPayload.updates) ? rawPayload.updates : [];
  const sanitized = previous
    .map(cleanPrayerUpdateEntry)
    .filter((entry): entry is PrayerUpdateEntry => entry !== null);
  const replaced: PrayerUpdateEntry = {
    content: currentContent,
    at: currentContentAt,
    ...(currentContentBy ? { by: currentContentBy } : {})
  };
  return [replaced, ...sanitized].slice(0, PRAYER_UPDATE_HISTORY_LIMIT);
}
