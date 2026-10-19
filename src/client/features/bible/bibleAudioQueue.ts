import type { BibleAudioChapterIndex, BibleAudioVerseTimestamp, BibleAudioVersionManifest } from "@shared/bibleAudio";
import type { BibleBookCatalogDTO, BibleLookupDTO } from "@shared/types";

// 有声圣经播放队列的纯逻辑：队列项构建（整章 / 选集 / 消息引用）、章节前后导航、
// 时间戳 ↔ 经节定位、断点记忆序列化。useBibleAudioPlayer 只负责驾驭 <audio>。

/** 一段连续经文；verseEnd 为 null 表示播到本章结束（整章模式） */
export type BibleAudioPlayItem = {
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number | null;
};

export type BibleAudioChapterMap = Map<string, BibleAudioChapterIndex>;

export type BibleAudioResumeState = {
  versionId: string;
  book: string;
  chapter: number;
  verse: number;
};

export function bibleAudioChapterKey(book: string, chapter: number) {
  return `${book.toUpperCase()}:${chapter}`;
}

export function indexBibleAudioChapters(version: Pick<BibleAudioVersionManifest, "chapters">): BibleAudioChapterMap {
  const map: BibleAudioChapterMap = new Map();
  for (const chapter of version.chapters) map.set(bibleAudioChapterKey(chapter.book, chapter.chapter), chapter);
  return map;
}

export function bibleBookCodeByName(books: BibleBookCatalogDTO[], name: string) {
  const trimmed = name.trim();
  const match = books.find((book) => book.name === trimmed || book.code === trimmed.toUpperCase());
  return match?.code || null;
}

/** 整章播放：从章题引子（verse 0）开始，播到章末。 */
export function queueFromChapter(book: string, chapter: number): BibleAudioPlayItem[] {
  return [{ book: book.toUpperCase(), chapter, verseStart: 0, verseEnd: null }];
}

/**
 * 选集 / 消息引用 → 队列：按传入顺序保留每段，段内跨章时按章切开；
 * 同章内不连续的经节会拆成多段，依次播放。
 */
export function queueFromLookups(lookups: BibleLookupDTO[], books: BibleBookCatalogDTO[]): BibleAudioPlayItem[] {
  const items: BibleAudioPlayItem[] = [];
  for (const lookup of lookups) {
    let current: BibleAudioPlayItem | null = null;
    for (const verse of lookup.verses) {
      const code = bibleBookCodeByName(books, verse.book);
      if (!code) continue;
      const end = Math.max(verse.verse, verse.endVerse);
      if (current && current.book === code && current.chapter === verse.chapter && current.verseEnd !== null && verse.verse <= current.verseEnd + 1) {
        current.verseEnd = Math.max(current.verseEnd, end);
        continue;
      }
      current = { book: code, chapter: verse.chapter, verseStart: verse.verse, verseEnd: end };
      items.push(current);
    }
  }
  return items;
}

export function sameBibleAudioItem(left: BibleAudioPlayItem | null, right: BibleAudioPlayItem | null) {
  if (!left || !right) return left === right;
  return left.book === right.book && left.chapter === right.chapter && left.verseStart === right.verseStart && left.verseEnd === right.verseEnd;
}

export function nextBibleChapterLocation(books: BibleBookCatalogDTO[], book: string, chapter: number): { book: string; chapter: number } | null {
  const index = books.findIndex((item) => item.code === book.toUpperCase());
  if (index < 0) return null;
  if (chapter < books[index].chapterCount) return { book: books[index].code, chapter: chapter + 1 };
  const next = books[index + 1];
  return next ? { book: next.code, chapter: 1 } : null;
}

export function previousBibleChapterLocation(books: BibleBookCatalogDTO[], book: string, chapter: number): { book: string; chapter: number } | null {
  const index = books.findIndex((item) => item.code === book.toUpperCase());
  if (index < 0) return null;
  if (chapter > 1) return { book: books[index].code, chapter: chapter - 1 };
  const previous = books[index - 1];
  return previous ? { book: previous.code, chapter: previous.chapterCount } : null;
}

/** 当前时间所在的经节：最后一个 startMs <= timeMs 的时间戳（时间戳按 startMs 递增）。 */
export function bibleAudioVerseAtTime(verses: BibleAudioVerseTimestamp[], timeMs: number): BibleAudioVerseTimestamp | null {
  let low = 0;
  let high = verses.length - 1;
  let result: BibleAudioVerseTimestamp | null = null;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (verses[middle].startMs <= timeMs) {
      result = verses[middle];
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}

export function bibleAudioVerseTimestamp(verses: BibleAudioVerseTimestamp[], verse: number) {
  return verses.find((item) => item.verse === verse) || null;
}

/** 队列项在本章音频里的起止毫秒；缺少对应时间戳时从章首 / 到章尾兜底。 */
export function bibleAudioItemBounds(chapter: BibleAudioChapterIndex, item: BibleAudioPlayItem) {
  const start = item.verseStart <= 0 ? 0 : bibleAudioVerseTimestamp(chapter.verses, item.verseStart)?.startMs ?? firstVerseStart(chapter, item.verseStart);
  const end = item.verseEnd === null ? chapter.durationMs : bibleAudioVerseTimestamp(chapter.verses, item.verseEnd)?.endMs ?? lastVerseEnd(chapter, item.verseEnd);
  return { startMs: Math.max(0, Math.min(start, chapter.durationMs)), endMs: Math.max(0, Math.min(end, chapter.durationMs)) };
}

function firstVerseStart(chapter: BibleAudioChapterIndex, verse: number) {
  const later = chapter.verses.find((item) => item.verse >= verse);
  return later?.startMs ?? chapter.durationMs;
}

function lastVerseEnd(chapter: BibleAudioChapterIndex, verse: number) {
  let end: number | null = null;
  for (const item of chapter.verses) if (item.verse <= verse) end = item.endMs;
  return end ?? chapter.durationMs;
}

export function bibleAudioResumeStorageKey(accountId: number) {
  return `team-chat-bible-audio-resume:${accountId}`;
}

export function parseBibleAudioResume(raw: string | null): BibleAudioResumeState | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<BibleAudioResumeState>;
    if (!value || typeof value.versionId !== "string" || typeof value.book !== "string") return null;
    const chapter = Number(value.chapter);
    const verse = Number(value.verse);
    if (!Number.isInteger(chapter) || chapter < 1 || !Number.isInteger(verse) || verse < 0) return null;
    return { versionId: value.versionId, book: value.book.toUpperCase(), chapter, verse };
  } catch {
    return null;
  }
}

export function bibleAudioStreamPath(versionId: string, book: string, chapter: number) {
  return `/api/bible-audio/${encodeURIComponent(versionId)}/${encodeURIComponent(book.toUpperCase())}/${chapter}/stream`;
}

export const BIBLE_AUDIO_RATES = [1, 1.25, 1.5, 2] as const;

export function nextBibleAudioRate(current: number) {
  const index = BIBLE_AUDIO_RATES.findIndex((rate) => Math.abs(rate - current) < 0.001);
  return BIBLE_AUDIO_RATES[(index + 1) % BIBLE_AUDIO_RATES.length];
}
