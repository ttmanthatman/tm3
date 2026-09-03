import assert from "node:assert/strict";
import test from "node:test";
import type { BibleCatalogDTO, BibleVerseLineDTO } from "@shared/types";
import {
  sermonContextBookForVerse,
  sermonContextInitialChapterNumbers,
  sermonContextScrollChapterTargets,
  sermonContextVerseIsCurrent
} from "./sermonContext";

function verse(chapter: number, start: number, end = start): BibleVerseLineDTO {
  return {
    book: "约翰福音",
    chapter,
    verse: start,
    endVerse: end,
    reference: `约翰福音 ${chapter}:${start}`,
    text: "经文"
  };
}

test("context highlights every projected verse that overlaps the displayed chapter line", () => {
  assert.equal(sermonContextVerseIsCurrent(verse(3, 16), [verse(3, 16)]), true);
  assert.equal(sermonContextVerseIsCurrent(verse(3, 16, 17), [verse(3, 17)]), true);
  assert.equal(sermonContextVerseIsCurrent(verse(3, 15), [verse(3, 16)]), false);
  assert.equal(sermonContextVerseIsCurrent(verse(4, 16), [verse(3, 16)]), false);
});

test("context resolves the projected book from either its Chinese name or code", () => {
  const catalog: BibleCatalogDTO = {
    translation: "新标点和合本（简体）",
    sourceId: "cmn-cu89s",
    oldTestament: [{ code: "GEN", name: "创世记", chapterCount: 50 }],
    newTestament: [{ code: "JHN", name: "约翰福音", chapterCount: 21 }],
    translations: [{ id: "cmn-cu89s", name: "新标点和合本（简体）", shortName: "和合本" }]
  };

  assert.equal(sermonContextBookForVerse(catalog, "创世记")?.code, "GEN");
  assert.equal(sermonContextBookForVerse(catalog, "jhn")?.name, "约翰福音");
  assert.equal(sermonContextBookForVerse(catalog, "不存在"), undefined);
});

test("context initially loads the target chapter and available neighbors", () => {
  assert.deepEqual(sermonContextInitialChapterNumbers(1, 50), [1, 2]);
  assert.deepEqual(sermonContextInitialChapterNumbers(27, 50), [26, 27, 28]);
  assert.deepEqual(sermonContextInitialChapterNumbers(50, 50), [49, 50]);
});

test("context requests adjacent chapters only near a scroll boundary", () => {
  assert.deepEqual(sermonContextScrollChapterTargets({
    scrollTop: 100,
    scrollHeight: 1800,
    clientHeight: 400,
    firstChapter: 12,
    lastChapter: 14,
    chapterCount: 50
  }), { previous: 11, next: null });

  assert.deepEqual(sermonContextScrollChapterTargets({
    scrollTop: 1100,
    scrollHeight: 1800,
    clientHeight: 500,
    firstChapter: 12,
    lastChapter: 14,
    chapterCount: 50
  }), { previous: null, next: 15 });

  assert.deepEqual(sermonContextScrollChapterTargets({
    scrollTop: 0,
    scrollHeight: 400,
    clientHeight: 400,
    firstChapter: 1,
    lastChapter: 50,
    chapterCount: 50
  }), { previous: null, next: null });
});
