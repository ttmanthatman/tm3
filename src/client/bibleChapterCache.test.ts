import assert from "node:assert/strict";
import test from "node:test";
import { bibleChapterCacheKey, DEFAULT_BIBLE_TRANSLATION_ID } from "./bibleChapterCache";

test("bible chapter cache keys are scoped by translation", () => {
  assert.equal(bibleChapterCacheKey("mat", 3), `${DEFAULT_BIBLE_TRANSLATION_ID}:MAT:3`);
  assert.equal(bibleChapterCacheKey("MAT", 3, "cmncbs"), "cmncbs:MAT:3");
  assert.notEqual(bibleChapterCacheKey("MAT", 3), bibleChapterCacheKey("MAT", 3, "cmncbs"));
});
