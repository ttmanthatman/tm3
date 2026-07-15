import assert from "node:assert/strict";
import test from "node:test";
import { bibleCatalog, lookupBibleReference, searchBibleText } from "./lookup.js";

test("Bible catalog exposes all 66 books and 1189 chapters", () => {
  const catalog = bibleCatalog();
  assert.equal(catalog.oldTestament.length, 39);
  assert.equal(catalog.newTestament.length, 27);
  assert.equal([...catalog.oldTestament, ...catalog.newTestament].reduce((total, book) => total + book.chapterCount, 0), 1189);
  assert.deepEqual(catalog.oldTestament[0], { code: "GEN", name: "创世记", chapterCount: 50 });
  assert.deepEqual(catalog.newTestament.at(-1), { code: "REV", name: "启示录", chapterCount: 22 });
});

test("Bible text search returns phrase matches with safe character ranges", () => {
  const result = searchBibleText("神爱世人");
  assert.equal(result.mode, "phrase");
  assert.ok(result.total >= 1);
  const john = result.items.find((item) => item.verse.reference === "约翰福音 3:16");
  assert.ok(john);
  assert.ok(john.matches.some((range) => john.verse.text.slice(range.start, range.end) === "神爱世人"));
});

test("Bible text search falls back to all supplied keywords and paginates", () => {
  const firstPage = searchBibleText("神 世人", 0, 1);
  assert.equal(firstPage.mode, "allTerms");
  assert.equal(firstPage.limit, 1);
  assert.equal(firstPage.items.length, 1);
  assert.ok(firstPage.total >= 1);
  assert.match(firstPage.items[0].verse.text, /神/);
  assert.match(firstPage.items[0].verse.text, /世人/);
  assert.ok(firstPage.items[0].matches.length >= 2);
});

test("cross-chapter lookups preserve canonical chapter and verse order", () => {
  const lookup = lookupBibleReference("创世记 1:31-2:2");
  assert.deepEqual(lookup.verses.map((verse) => verse.reference), ["创世记 1:31", "创世记 2:1", "创世记 2:2"]);
});
