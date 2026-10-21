import assert from "node:assert/strict";
import test from "node:test";
import type { BibleLookupDTO } from "@shared/types";
import { biblePassageDraft } from "./biblePassageSharing";

function passage(start: number, end = start): BibleLookupDTO {
  return { reference: `约翰福音 1:${start}-${end}`, normalizedReference: `约翰福音 1:${start}-${end}`, translation: "和合本", sourceId: "cmn-cu89s",
    verses: [{ book: "约翰福音", chapter: 1, verse: start, endVerse: end, reference: `约翰福音 1:${start}-${end}`, text: "太初有道。" }] };
}

test("one verse, long passage and multiple selections all produce one ordered scripture draft", () => {
  for (const lookups of [[passage(1)], [passage(1, 8)], [passage(3), passage(1), passage(5, 9)]]) {
    const { content, payload } = biblePassageDraft(lookups, false);
    assert.deepEqual(payload, { kind: "bible_passage", sourceId: "cmn-cu89s", showTranslation: false, references: lookups.map(lookup => lookup.normalizedReference) });
    for (const lookup of lookups) assert.ok(content.includes(lookup.normalizedReference));
    assert.doesNotMatch(content, /和合本/);
  }
});

test("preview escapes scripture text and keeps the selected translation option", () => {
  const lookup = passage(1, 3);
  lookup.verses[0].text = "文字包含 <b> & 引号。";
  const { content, payload } = biblePassageDraft([lookup], true);
  assert.match(content, /1:1-3 文字包含 &lt;b&gt; &amp;/);
  assert.match(content, /和合本$/);
  assert.equal(payload.showTranslation, true);
  const contemporary = { ...lookup, sourceId: "cmncbs", translation: "当代译本" };
  assert.equal(biblePassageDraft([contemporary], false).payload.sourceId, "cmncbs");
});

test("empty and mixed-translation selections fail explicitly", () => {
  assert.throws(() => biblePassageDraft([], false), /选择经文/);
  assert.throws(() => biblePassageDraft([passage(1), { ...passage(2), sourceId: "cmncbs" }], false), /同一译本/);
});
