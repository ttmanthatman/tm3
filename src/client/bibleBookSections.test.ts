import assert from "node:assert/strict";
import test from "node:test";
import { BIBLE_BOOK_SECTIONS, bibleBookSection } from "./bibleBookSections.js";

test("classifies all 66 Protestant Bible books into the nine catalog sections", () => {
  assert.deepEqual(BIBLE_BOOK_SECTIONS.map((section) => section.bookCodes.length), [5, 12, 5, 5, 12, 4, 1, 21, 1]);

  const bookCodes = BIBLE_BOOK_SECTIONS.flatMap((section) => section.bookCodes);
  assert.equal(bookCodes.length, 66);
  assert.equal(new Set(bookCodes).size, 66);
  assert.equal(new Set(BIBLE_BOOK_SECTIONS.map((section) => section.color)).size, BIBLE_BOOK_SECTIONS.length);
});

test("keeps the traditional section boundaries and treats all New Testament letters as one literary group", () => {
  assert.equal(bibleBookSection("GEN")?.label, "摩西五经");
  assert.equal(bibleBookSection("JOS")?.label, "历史书");
  assert.equal(bibleBookSection("JOB")?.label, "智慧书");
  assert.equal(bibleBookSection("ISA")?.label, "大先知书");
  assert.equal(bibleBookSection("HOS")?.label, "小先知书");
  assert.equal(bibleBookSection("MAT")?.label, "福音书");
  assert.equal(bibleBookSection("ACT")?.label, "使徒行传");
  assert.equal(bibleBookSection("ROM")?.label, "书信");
  assert.equal(bibleBookSection("JUD")?.label, "书信");
  assert.equal(bibleBookSection("REV")?.label, "启示录");
  assert.equal(bibleBookSection("unknown"), null);
});
