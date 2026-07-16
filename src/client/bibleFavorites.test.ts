import assert from "node:assert/strict";
import test from "node:test";
import type { BibleFavoriteDTO } from "../shared/types.js";
import { groupBibleFavoritePassages } from "./bibleFavorites.js";

function favorite(id: number, verse: number, savedAt = "2026-07-16T08:00:00.000Z"): BibleFavoriteDTO {
  return {
    id,
    bookCode: "DEU",
    chapter: 33,
    verse,
    savedAt,
    verseLine: {
      book: "申命记",
      chapter: 33,
      verse,
      endVerse: verse,
      reference: `申命记 33:${verse}`,
      text: `第 ${verse} 节正文`
    }
  };
}

test("groups contiguous favorite verses into one expanded passage", () => {
  const passages = groupBibleFavoritePassages([favorite(3, 31), favorite(1, 29), favorite(2, 30)]);
  assert.equal(passages.length, 1);
  assert.equal(passages[0].lookup.normalizedReference, "申命记 33:29-31");
  assert.deepEqual(passages[0].favoriteIds, [1, 2, 3]);
  assert.deepEqual(passages[0].lookup.verses.map((verse) => verse.verse), [29, 30, 31]);
});

test("keeps non-contiguous favorites as separate passages", () => {
  const passages = groupBibleFavoritePassages([favorite(1, 29), favorite(2, 31)]);
  assert.deepEqual(passages.map((passage) => passage.lookup.normalizedReference), ["申命记 33:29", "申命记 33:31"]);
});
