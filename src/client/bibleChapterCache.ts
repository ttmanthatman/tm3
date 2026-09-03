import type { BibleBookCatalogDTO, BibleChapterDTO } from "@shared/types";
import { api } from "./api";

export const DEFAULT_BIBLE_TRANSLATION_ID = "cmn-cu89s";

const chapterCache = new Map<string, BibleChapterDTO>();
const chapterLoadPromises = new Map<string, Promise<BibleChapterDTO>>();

export function bibleChapterCacheKey(bookCode: string, chapter: number, translation = DEFAULT_BIBLE_TRANSLATION_ID) {
  return `${translation}:${bookCode.toUpperCase()}:${chapter}`;
}

export async function fetchBibleChapter(book: BibleBookCatalogDTO, chapter: number, translation = DEFAULT_BIBLE_TRANSLATION_ID) {
  const key = bibleChapterCacheKey(book.code, chapter, translation);
  const cached = chapterCache.get(key);
  if (cached) return cached;
  const pending = chapterLoadPromises.get(key);
  if (pending) return pending;
  const promise = api<{ success: boolean; result?: BibleChapterDTO; message?: string }>(
    `/api/bible/chapter?book=${encodeURIComponent(book.code)}&chapter=${chapter}&translation=${encodeURIComponent(translation)}`
  ).then((response) => {
    if (!response.success || !response.result) throw new Error(response.message || "章节加载失败");
    chapterCache.set(key, response.result);
    return response.result;
  }).finally(() => chapterLoadPromises.delete(key));
  chapterLoadPromises.set(key, promise);
  return promise;
}
