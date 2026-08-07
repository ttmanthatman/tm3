export interface PrayerUpdateEntry {
  [key: string]: string | number | undefined;
  content: string;
  at: string;
  by?: string;
  imageMessageId?: number;
}

export const PRAYER_UPDATE_HISTORY_LIMIT = 20;

function cleanPrayerUpdateEntry(input: unknown): PrayerUpdateEntry | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  if (typeof record.content !== "string" || !record.content) return null;
  const imageMessageId = Number(record.imageMessageId || 0);
  return {
    content: record.content,
    at: typeof record.at === "string" ? record.at : "",
    ...(typeof record.by === "string" && record.by ? { by: record.by } : {}),
    ...(Number.isInteger(imageMessageId) && imageMessageId > 0 ? { imageMessageId } : {})
  };
}

// Builds the prayer card's update history with the content being replaced
// moved to the front, so the newest entry always renders on top.
export function prependPrayerUpdateHistory(
  rawPayload: Record<string, unknown>,
  currentContent: string,
  currentContentAt: string,
  currentContentBy?: string,
  currentImageMessageId?: number
): PrayerUpdateEntry[] {
  const previous = Array.isArray(rawPayload.updates) ? rawPayload.updates : [];
  const sanitized = previous
    .map(cleanPrayerUpdateEntry)
    .filter((entry): entry is PrayerUpdateEntry => entry !== null);
  const replaced: PrayerUpdateEntry = {
    content: currentContent,
    at: currentContentAt,
    ...(currentContentBy ? { by: currentContentBy } : {}),
    ...(currentImageMessageId && currentImageMessageId > 0 ? { imageMessageId: currentImageMessageId } : {})
  };
  return [replaced, ...sanitized].slice(0, PRAYER_UPDATE_HISTORY_LIMIT);
}
