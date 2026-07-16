import assert from "node:assert/strict";
import test from "node:test";
import { nearbyBibleChapterPreloadOrder, preservedScrollTop } from "./bibleReaderLoading.js";

test("preloads the visible chapter first, then alternates forward and backward", () => {
  assert.deepEqual(nearbyBibleChapterPreloadOrder(10, 20, 5), [10, 11, 9, 12, 8]);
  assert.deepEqual(nearbyBibleChapterPreloadOrder(1, 3, 5), [1, 2, 3]);
  assert.deepEqual(nearbyBibleChapterPreloadOrder(3, 3, 5), [3, 2, 1]);
});

test("preserves an existing chapter anchor without counting content appended below it", () => {
  assert.equal(preservedScrollTop(420, 80, 680), 1020);
  assert.equal(preservedScrollTop(420, 80, 80), 420);
});
