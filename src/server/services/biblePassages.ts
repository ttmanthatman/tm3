import {
  BIBLE_PASSAGE_CONTENT_MAX,
  BIBLE_PASSAGE_MAX,
  BIBLE_PASSAGE_REFERENCE_MAX,
  biblePassageMessageContent,
  type BiblePassageMessagePayload
} from "../../shared/biblePassages.js";
import { bibleTranslations, lookupBibleReference } from "../bible/lookup.js";

export class BiblePassageValidationError extends Error {
  readonly statusCode = 400;
}

/** Accept references from a new draft or a forwarded card, and always rebuild the text from the selected source. */
export function cleanBiblePassagePayload(input: unknown): BiblePassageMessagePayload {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new BiblePassageValidationError("经文消息无效");
  const raw = input as Record<string, unknown>;
  if (raw.kind !== "bible_passage" || typeof raw.sourceId !== "string" || typeof raw.showTranslation !== "boolean") {
    throw new BiblePassageValidationError("经文消息无效");
  }
  const sourceId = raw.sourceId.trim();
  if (!bibleTranslations().some((source) => source.id === sourceId)) throw new BiblePassageValidationError("所选圣经译本不存在");
  const references = Array.isArray(raw.references)
    ? raw.references
    : Array.isArray(raw.passages)
      ? raw.passages.map((passage: unknown) => passage && typeof passage === "object" && !Array.isArray(passage) ? (passage as Record<string, unknown>).reference : null)
      : null;
  if (!references?.length) throw new BiblePassageValidationError("请至少选择一段经文");
  if (references.length > BIBLE_PASSAGE_MAX) throw new BiblePassageValidationError(`经文消息最多 ${BIBLE_PASSAGE_MAX} 段`);
  const passages: BiblePassageMessagePayload["passages"] = [];
  let translation = "";
  for (const reference of references) {
    if (typeof reference !== "string" || !reference.trim() || reference.length > BIBLE_PASSAGE_REFERENCE_MAX) {
      throw new BiblePassageValidationError("经文引用无效");
    }
    let lookup;
    try {
      lookup = lookupBibleReference(reference.trim(), sourceId);
    } catch {
      throw new BiblePassageValidationError(`无法识别经文「${reference.trim()}」`);
    }
    if (!lookup.verses.length) throw new BiblePassageValidationError("经文引用无效");
    if (lookup.normalizedReference.length > BIBLE_PASSAGE_REFERENCE_MAX) throw new BiblePassageValidationError("经文引用过长，请分段发送");
    translation = lookup.translation;
    passages.push({
      reference: lookup.normalizedReference,
      text: lookup.verses.map((verse) => `${verse.chapter}:${verse.verse}${verse.endVerse === verse.verse ? "" : `-${verse.endVerse}`} ${verse.text}`).join("\n")
    });
  }
  const payload: BiblePassageMessagePayload = { kind: "bible_passage", sourceId, translation, showTranslation: raw.showTranslation, passages };
  if (biblePassageMessageContent(payload).length > BIBLE_PASSAGE_CONTENT_MAX) {
    throw new BiblePassageValidationError("经文内容过长，请分开发送");
  }
  return payload;
}
