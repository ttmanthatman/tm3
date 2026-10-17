import assert from "node:assert/strict";
import test from "node:test";
import type { BibleLookupDTO } from "@shared/types";
import { mergedBiblePassageContent, shouldMergeBiblePassages } from "./biblePassageSharing";

function passage(start: number, end = start): BibleLookupDTO {
  return { reference: `约翰福音 1:${start}-${end}`, normalizedReference: `约翰福音 1:${start}-${end}`, translation: "和合本", sourceId: "cmn-cu89s",
    verses: [{ book: "约翰福音", chapter: 1, verse: start, endVerse: end, reference: `约翰福音 1:${start}-${end}`, text: "太初有道。" }] };
}

test("merge only when more than three verses are selected, including verse ranges", () => {
  assert.equal(shouldMergeBiblePassages([passage(1), passage(2), passage(3)]), false);
  assert.equal(shouldMergeBiblePassages([passage(1), passage(2), passage(3), passage(4)]), true);
  assert.equal(shouldMergeBiblePassages([passage(1, 4)]), true);
  assert.equal(shouldMergeBiblePassages([passage(1, 3), passage(2)]), true);
});

test("merged verses use one ordinary text body and honor the version option", () => {
  const lookups = [passage(1), passage(2)];
  lookups[1].verses[0].text = "文字包含 <b> & 引号。";
  const content = mergedBiblePassageContent(lookups, false);
  assert.match(content, /约翰福音 1:1-1\n1 太初有道。\n\n约翰福音 1:2-2/);
  assert.match(content, /&lt;b&gt; &amp;/);
  assert.doesNotMatch(content, /<br>|和合本/);
  assert.match(mergedBiblePassageContent(lookups, true), /—— 和合本/);
});
