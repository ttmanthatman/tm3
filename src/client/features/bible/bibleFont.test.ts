import assert from "node:assert/strict";
import test from "node:test";
import { BIBLE_FONT_DEFAULT, BIBLE_FONT_MAX, BIBLE_FONT_MIN, bibleFontSizeStorageKey, clampBibleFontSize } from "./bibleFont";

test("clampBibleFontSize rounds and keeps the readable range", () => {
  assert.equal(clampBibleFontSize(Number.NaN), BIBLE_FONT_DEFAULT);
  assert.equal(clampBibleFontSize(0), BIBLE_FONT_MIN);
  assert.equal(clampBibleFontSize(99), BIBLE_FONT_MAX);
  assert.equal(clampBibleFontSize(20.4), 20);
  assert.equal(clampBibleFontSize(20.6), 21);
});

test("bibleFontSizeStorageKey stays per account", () => {
  assert.equal(bibleFontSizeStorageKey(7), "team-chat-bible-font-size:7");
});
