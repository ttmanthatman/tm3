import assert from "node:assert/strict";
import test from "node:test";
import type { BibleVerseLineDTO } from "@shared/types";
import { bibleVerseGroupReference, bibleVerseKey, formatBibleVersesForCopy, groupContinuousBibleVerses, selectBibleVerseKeys } from "./bibleVerseActions";

const verse = (chapter: number, number: number, text: string): BibleVerseLineDTO => ({
  book: "约翰福音",
  chapter,
  verse: number,
  endVerse: number,
  reference: `约翰福音 ${chapter}:${number}`,
  text
});

test("Shift range selection crosses a chapter boundary and keeps earlier selections", () => {
  const ordered = [verse(1, 50, "甲"), verse(1, 51, "乙"), verse(2, 1, "丙"), verse(2, 2, "丁")]
    .map((item) => bibleVerseKey("JHN", item));
  const selected = new Set(["JHN:1:1"]);
  const result = selectBibleVerseKeys(ordered, selected, "JHN:2:2", "JHN:1:51", true);
  assert.deepEqual([...result], ["JHN:1:1", "JHN:1:51", "JHN:2:1", "JHN:2:2"]);
});

test("ordinary click toggles one verse", () => {
  const result = selectBibleVerseKeys(["JHN:1:1"], new Set(["JHN:1:1"]), "JHN:1:1", null, false);
  assert.equal(result.size, 0);
});

test("copy output groups contiguous verses and separates chapters", () => {
  const text = formatBibleVersesForCopy([verse(1, 1, "太初有道。"), verse(1, 2, "这道太初与神同在。"), verse(2, 1, "第三日，在加利利的迦拿有娶亲的筵席。")], "新标点和合本（简体）");
  assert.match(text, /约翰福音 1:1-2\n1 太初有道。\n2 这道太初与神同在。/);
  assert.match(text, /约翰福音 2:1\n1 第三日/);
  assert.match(text, /—— 新标点和合本（简体）$/);
});

test("groupContinuousBibleVerses merges adjacent verses and splits gaps and chapters", () => {
  const groups = groupContinuousBibleVerses([
    verse(1, 1, "甲"), verse(1, 2, "乙"), verse(1, 3, "丙"),
    verse(1, 8, "丁"),
    verse(2, 1, "戊"), verse(2, 2, "己")
  ]);
  assert.deepEqual(groups.map((group) => group.map((item) => item.verse)), [[1, 2, 3], [8], [1, 2]]);
});

test("bibleVerseGroupReference collapses a continuous range into one reference", () => {
  assert.equal(bibleVerseGroupReference([verse(1, 1, "甲")]), "约翰福音 1:1");
  assert.equal(bibleVerseGroupReference([verse(1, 1, "甲"), verse(1, 2, "乙"), verse(1, 3, "丙")]), "约翰福音 1:1-3");
});
