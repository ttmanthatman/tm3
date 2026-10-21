export const BIBLE_PASSAGE_MAX = 200;
export const BIBLE_PASSAGE_CONTENT_MAX = 10000;
export const BIBLE_PASSAGE_REFERENCE_MAX = 120;

export type BiblePassageDraft = {
  kind: "bible_passage";
  sourceId: string;
  showTranslation: boolean;
  references: string[];
};

export type BiblePassageMessagePayload = {
  kind: "bible_passage";
  sourceId: string;
  translation: string;
  showTranslation: boolean;
  passages: { reference: string; text: string }[];
};

function boundedText(value: unknown, limit: number): value is string {
  return typeof value === "string" && !!value.trim() && value.length <= limit;
}

/** Stored messages are self-contained; malformed or incomplete cards fall back to their normal message content. */
export function biblePassageMessagePayload(value: unknown): BiblePassageMessagePayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    row.kind !== "bible_passage" ||
    !boundedText(row.sourceId, 30) ||
    !boundedText(row.translation, 200) ||
    typeof row.showTranslation !== "boolean" ||
    !Array.isArray(row.passages) ||
    !row.passages.length ||
    row.passages.length > BIBLE_PASSAGE_MAX
  ) return null;
  const passages: BiblePassageMessagePayload["passages"] = [];
  for (const item of row.passages) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const passage = item as Record<string, unknown>;
    if (!boundedText(passage.reference, BIBLE_PASSAGE_REFERENCE_MAX) || !boundedText(passage.text, BIBLE_PASSAGE_CONTENT_MAX)) return null;
    passages.push({ reference: passage.reference.trim(), text: passage.text.trim() });
  }
  const payload: BiblePassageMessagePayload = {
    kind: "bible_passage",
    sourceId: row.sourceId.trim(),
    translation: row.translation.trim(),
    showTranslation: row.showTranslation,
    passages
  };
  return biblePassageMessageContent(payload).length <= BIBLE_PASSAGE_CONTENT_MAX ? payload : null;
}

function escapeContent(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/\r\n?|\n/g, "<br>");
}

/** Complete escaped HTML for search, notifications, replies, and clients without the card renderer. */
export function biblePassageMessageContent(payload: BiblePassageMessagePayload): string {
  const sections = payload.passages.map((passage) => `${escapeContent(passage.reference)}<br>${escapeContent(passage.text)}`);
  if (payload.showTranslation) sections.push(escapeContent(payload.translation));
  return sections.join("<br><br>");
}
