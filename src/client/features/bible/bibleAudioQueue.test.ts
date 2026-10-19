import assert from "node:assert/strict";
import test from "node:test";
import type { BibleAudioChapterIndex } from "@shared/bibleAudio";
import type { BibleBookCatalogDTO, BibleLookupDTO, BibleVerseLineDTO } from "@shared/types";
import {
  bibleAudioItemBounds,
  bibleAudioResumeStorageKey,
  bibleAudioStreamPath,
  bibleAudioVerseAtTime,
  indexBibleAudioChapters,
  nextBibleAudioRate,
  nextBibleChapterLocation,
  parseBibleAudioResume,
  previousBibleChapterLocation,
  queueFromChapter,
  queueFromLookups
} from "./bibleAudioQueue";

const books: BibleBookCatalogDTO[] = [
  { code: "MAL", name: "玛拉基书", chapterCount: 4 },
  { code: "MAT", name: "马太福音", chapterCount: 28 },
  { code: "MRK", name: "马可福音", chapterCount: 16 },
  { code: "REV", name: "启示录", chapterCount: 22 }
];

const line = (book: string, chapter: number, verse: number, endVerse = verse): BibleVerseLineDTO => ({
  book,
  chapter,
  verse,
  endVerse,
  reference: `${book} ${chapter}:${verse}`,
  text: `${book}${chapter}:${verse}`
});

const lookup = (verses: BibleVerseLineDTO[]): BibleLookupDTO => ({
  reference: verses[0]?.reference || "",
  normalizedReference: verses[0]?.reference || "",
  translation: "和合本",
  sourceId: "cmn-cu89s",
  verses
});

const chapter: BibleAudioChapterIndex = {
  book: "MRK",
  chapter: 12,
  durationMs: 100_000,
  verses: [
    { verse: 0, startMs: 0, endMs: 4_000 },
    { verse: 1, startMs: 4_000, endMs: 10_000 },
    { verse: 2, startMs: 10_000, endMs: 17_000 },
    { verse: 3, startMs: 17_000, endMs: 25_000 },
    { verse: 5, startMs: 25_000, endMs: 40_000 }
  ]
};

test("queueFromChapter plays the whole chapter from the chapter introduction", () => {
  assert.deepEqual(queueFromChapter("mrk", 12), [{ book: "MRK", chapter: 12, verseStart: 0, verseEnd: null }]);
});

test("queueFromLookups keeps passage order, merges continuous verses and splits across chapters", () => {
  const items = queueFromLookups(
    [
      lookup([line("马可福音", 12, 1), line("马可福音", 12, 2, 3), line("马可福音", 12, 4)]),
      lookup([line("马太福音", 5, 3), line("马太福音", 5, 7)]),
      lookup([line("马可福音", 1, 44), line("马可福音", 1, 45), line("马可福音", 2, 1)])
    ],
    books
  );
  assert.deepEqual(items, [
    { book: "MRK", chapter: 12, verseStart: 1, verseEnd: 4 },
    { book: "MAT", chapter: 5, verseStart: 3, verseEnd: 3 },
    { book: "MAT", chapter: 5, verseStart: 7, verseEnd: 7 },
    { book: "MRK", chapter: 1, verseStart: 44, verseEnd: 45 },
    { book: "MRK", chapter: 2, verseStart: 1, verseEnd: 1 }
  ]);
});

test("queueFromLookups drops verses whose book is not in the catalog", () => {
  assert.deepEqual(queueFromLookups([lookup([line("未知书", 1, 1), line("启示录", 22, 21)])], books), [
    { book: "REV", chapter: 22, verseStart: 21, verseEnd: 21 }
  ]);
});

test("chapter navigation crosses book boundaries and stops at both ends of the canon", () => {
  assert.deepEqual(nextBibleChapterLocation(books, "MAT", 27), { book: "MAT", chapter: 28 });
  assert.deepEqual(nextBibleChapterLocation(books, "MAT", 28), { book: "MRK", chapter: 1 });
  assert.equal(nextBibleChapterLocation(books, "REV", 22), null);
  assert.deepEqual(previousBibleChapterLocation(books, "MRK", 1), { book: "MAT", chapter: 28 });
  assert.deepEqual(previousBibleChapterLocation(books, "MRK", 2), { book: "MRK", chapter: 1 });
  assert.equal(previousBibleChapterLocation(books, "MAL", 1), null);
  assert.equal(nextBibleChapterLocation(books, "XXX", 1), null);
});

test("verse lookup by time returns the verse whose window contains the time", () => {
  assert.equal(bibleAudioVerseAtTime(chapter.verses, 0)?.verse, 0);
  assert.equal(bibleAudioVerseAtTime(chapter.verses, 3_999)?.verse, 0);
  assert.equal(bibleAudioVerseAtTime(chapter.verses, 4_000)?.verse, 1);
  assert.equal(bibleAudioVerseAtTime(chapter.verses, 24_999)?.verse, 3);
  assert.equal(bibleAudioVerseAtTime(chapter.verses, 90_000)?.verse, 5);
  assert.equal(bibleAudioVerseAtTime([], 10), null);
});

test("item bounds use verse timestamps and fall back to neighbours or chapter edges", () => {
  assert.deepEqual(bibleAudioItemBounds(chapter, { book: "MRK", chapter: 12, verseStart: 0, verseEnd: null }), { startMs: 0, endMs: 100_000 });
  assert.deepEqual(bibleAudioItemBounds(chapter, { book: "MRK", chapter: 12, verseStart: 2, verseEnd: 3 }), { startMs: 10_000, endMs: 25_000 });
  // 第 4 节没有时间戳：起点落到后一节、终点落到前一节的结束
  assert.deepEqual(bibleAudioItemBounds(chapter, { book: "MRK", chapter: 12, verseStart: 4, verseEnd: 4 }), { startMs: 25_000, endMs: 25_000 });
  assert.deepEqual(bibleAudioItemBounds(chapter, { book: "MRK", chapter: 12, verseStart: 3, verseEnd: 9 }), { startMs: 17_000, endMs: 40_000 });
});

test("manifest chapter index is keyed by uppercase book and chapter", () => {
  const map = indexBibleAudioChapters({ chapters: [chapter] });
  assert.equal(map.get("MRK:12"), chapter);
  assert.equal(map.size, 1);
});

test("resume state parsing rejects malformed entries", () => {
  assert.equal(bibleAudioResumeStorageKey(42), "team-chat-bible-audio-resume:42");
  assert.deepEqual(parseBibleAudioResume(JSON.stringify({ versionId: "cuvmpt-drama", book: "mrk", chapter: 3, verse: 0 })), {
    versionId: "cuvmpt-drama",
    book: "MRK",
    chapter: 3,
    verse: 0
  });
  assert.equal(parseBibleAudioResume(null), null);
  assert.equal(parseBibleAudioResume("{"), null);
  assert.equal(parseBibleAudioResume(JSON.stringify({ versionId: "x", book: "MRK", chapter: 0, verse: 1 })), null);
  assert.equal(parseBibleAudioResume(JSON.stringify({ versionId: "x", book: "MRK", chapter: 1, verse: -1 })), null);
});

test("stream path encodes identifiers and rates cycle through the preset list", () => {
  assert.equal(bibleAudioStreamPath("cuvmpt-drama", "mrk", 12), "/api/bible-audio/cuvmpt-drama/MRK/12/stream");
  assert.equal(nextBibleAudioRate(1), 1.25);
  assert.equal(nextBibleAudioRate(1.5), 2);
  assert.equal(nextBibleAudioRate(2), 1);
  assert.equal(nextBibleAudioRate(0.7), 1);
});
