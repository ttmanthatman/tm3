export const BIBLE_TOPIC_NAME_MAX = 60;
export const BIBLE_TOPIC_REFERENCE_MAX = 2000;
export const BIBLE_TOPIC_PASSAGE_MAX = 200;

export type BibleTopicPassageDTO = {
  id: number;
  bookCode: string;
  bookName: string;
  startChapter: number;
  startVerse: number;
  endChapter: number;
  endVerse: number;
  reference: string;
};

export type BibleTopicDTO = {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  passages: BibleTopicPassageDTO[];
};

/** 主题转发消息里单段经文：引用 + 已展开的正文（消息自包含，收信人无需再查经） */
export type BibleTopicSharePassage = {
  reference: string;
  text: string;
};

export type BibleTopicMessagePayload = {
  kind: "bible_topic";
  name: string;
  translation: string;
  passages: BibleTopicSharePassage[];
};

export function bibleTopicMessagePayload(value: unknown): BibleTopicMessagePayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.kind !== "bible_topic" || typeof row.name !== "string" || typeof row.translation !== "string" || !Array.isArray(row.passages)) return null;
  const passages: BibleTopicSharePassage[] = [];
  for (const item of row.passages) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const passage = item as Record<string, unknown>;
    if (typeof passage.reference !== "string" || typeof passage.text !== "string") return null;
    passages.push({ reference: passage.reference, text: passage.text });
  }
  if (!passages.length || passages.length > BIBLE_TOPIC_PASSAGE_MAX) return null;
  return { kind: "bible_topic", name: row.name.slice(0, BIBLE_TOPIC_NAME_MAX), translation: row.translation, passages };
}
