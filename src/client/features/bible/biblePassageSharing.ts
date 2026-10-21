import type { BibleLookupDTO } from "@shared/types";
import { biblePassageMessageContent, type BiblePassageDraft, type BiblePassageMessagePayload } from "@shared/biblePassages";

export type BibleShareTextSender = (content: string, requestId: string, payload: BiblePassageDraft) => Promise<void>;

/** One selection always becomes one self-contained scripture card, in selection order. */
export function biblePassageDraft(lookups: BibleLookupDTO[], showTranslation: boolean) {
  if (!lookups.length) throw new Error("请先选择经文");
  const first = lookups[0];
  if (!first.sourceId || lookups.some(lookup => lookup.sourceId !== first.sourceId)) throw new Error("请使用同一译本分享经文");
  const payload: BiblePassageDraft = {
    kind: "bible_passage", sourceId: first.sourceId, showTranslation,
    references: lookups.map(lookup => lookup.normalizedReference)
  };
  const preview: BiblePassageMessagePayload = {
    kind: "bible_passage", sourceId: first.sourceId, translation: first.translation, showTranslation,
    passages: lookups.map(lookup => ({ reference: lookup.normalizedReference, text: lookup.verses.map(verse => `${verse.chapter}:${verse.verse}${verse.endVerse === verse.verse ? "" : `-${verse.endVerse}`} ${verse.text}`).join("\n") }))
  };
  return { content: biblePassageMessageContent(preview), payload };
}
