import assert from "node:assert/strict";
import test from "node:test";
import type { BibleVerseLineDTO } from "@shared/types";
import { sermonContextVerseIsCurrent } from "./sermonContext";

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
