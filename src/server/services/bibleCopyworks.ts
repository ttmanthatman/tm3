import type { BibleCopywork } from "@prisma/client";
import {
  COPYWORK_MAX_CHARACTERS,
  copyworkCharacters,
  layoutCopywork,
  type CopyworkDTO,
  type CopyworkSource,
  type CopyworkSpacing,
  type InkBounds
} from "../../shared/bibleCopywork.js";
import { bibleTranslations, lookupBibleChapter } from "../bible/lookup.js";

export function copyworkSource(input: {
  translation: string;
  bookCode: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
}): CopyworkSource {
  const translation = bibleTranslations().find((item) => item.id === input.translation);
  if (!translation) throw new Error("请选择有效译本");
  const chapter = lookupBibleChapter(input.bookCode, input.chapter, input.translation);
  const verses = chapter.verses.filter(
    (v) => v.verse >= input.verseStart && v.verse <= input.verseEnd
  );
  if (
    !verses.length ||
    verses[0].verse !== input.verseStart ||
    (verses.at(-1)!.endVerse || verses.at(-1)!.verse) !== input.verseEnd ||
    verses.some((v, i) => i > 0 && v.verse !== (verses[i - 1].endVerse || verses[i - 1].verse) + 1)
  )
    throw new Error("请选择同一章内连续的完整经节");
  const text = verses.map((v) => v.text).join("");
  const count = copyworkCharacters(text).length;
  if (!count || count > COPYWORK_MAX_CHARACTERS)
    throw new Error("每份抄写最多 500 字，请减少所选经节");
  return {
    translation: input.translation,
    chapter: input.chapter,
    verseStart: input.verseStart,
    verseEnd: input.verseEnd,
    bookCode: chapter.bookCode,
    translationName: chapter.translation,
    copyright: translation.copyright || "",
    text,
    reference: `${chapter.bookName} ${input.chapter}:${input.verseStart}${input.verseEnd === input.verseStart ? "" : `–${input.verseEnd}`}`
  };
}
export function copyworkManifest(work: BibleCopywork) {
  return work.source as unknown as CopyworkSource & { bounds?: InkBounds[] };
}
export function copyworkDTO(
  work: BibleCopywork & { account: { displayName: string } }
): CopyworkDTO {
  const { bounds = [], ...source } = copyworkManifest(work);
  return {
    id: work.id,
    accountId: work.accountId,
    author: work.account.displayName,
    source,
    spacing: work.spacing as CopyworkSpacing,
    completedAt: work.completedAt?.toISOString() || "",
    publishedAt: work.publishedAt?.toISOString() || null,
    pageCount: layoutCopywork(bounds, source.text, work.spacing as CopyworkSpacing).length
  };
}
