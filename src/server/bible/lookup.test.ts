import assert from "node:assert/strict";
import test from "node:test";
import { bibleCatalog, lookupBibleChapter, lookupBibleReference, searchBibleText } from "./lookup.js";

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

test("legacy Bible lookups keep the chat-facing verse shape unchanged", () => {
  assert.deepEqual(lookupBibleReference("约翰福音 1:1"), {
    reference: "约翰福音 1:1",
    normalizedReference: "约翰福音 1:1",
    translation: "新标点和合本（简体）",
    sourceId: "cmn-cu89s",
    verses: [{
      book: "约翰福音",
      chapter: 1,
      verse: 1,
      endVerse: 1,
      reference: "约翰福音 1:1",
      text: "太初有道，道与神同在，道就是神。"
    }]
  });
});

test("structured chapters expose headings and source paragraph boundaries", () => {
  const chapter = lookupBibleChapter("JHN", 1);
  assert.equal(chapter.verses.length, 51);
  assert.deepEqual(
    chapter.blocks.filter((block) => block.type === "heading").slice(0, 3),
    [
      { type: "heading", level: 1, text: "道成肉身" },
      { type: "heading", level: 1, text: "施洗约翰的见证" },
      { type: "heading", level: 1, text: "神的羔羊" }
    ]
  );
  const firstParagraph = chapter.blocks.find((block) => block.type === "paragraph");
  assert.equal(firstParagraph?.type, "paragraph");
  if (firstParagraph?.type === "paragraph") {
    assert.deepEqual(firstParagraph.fragments.map((fragment) => fragment.verse.verse), [1, 2, 3, 4, 5]);
  }
});

test("structured chapters separate Psalm descriptions and poetry lines from canonical verses", () => {
  const chapter = lookupBibleChapter("PSA", 3);
  const description = chapter.blocks.find((block) => block.type === "description");
  assert.deepEqual(description, { type: "description", text: "大卫逃避他儿子押沙龙的时候作的诗。" });
  const poetry = chapter.blocks.filter((block) => block.type === "paragraph" && block.style === "poetry");
  assert.ok(poetry.length > chapter.verses.length);
  const firstFragment = poetry[0]?.type === "paragraph" ? poetry[0].fragments[0] : undefined;
  assert.equal(firstFragment?.showVerseNumber, true);
  assert.equal(firstFragment?.text, "耶和华啊，我的敌人何其加增；");
  assert.ok(chapter.verses[0].text.startsWith("大卫逃避他儿子押沙龙的时候作的诗。"));
});

test("structured chapters place mid-verse speaker labels without changing the canonical verse", () => {
  const chapter = lookupBibleChapter("SNG", 5);
  const speaker = chapter.blocks.find((block) => block.type === "speaker" && block.text === "〔耶路撒冷的众女子〕");
  assert.ok(speaker);
  const verse = chapter.verses.find((item) => item.verse === 1);
  assert.ok(verse?.text.includes("〔耶路撒冷的众女子〕"));
  const fragments = chapter.blocks.flatMap((block) => block.type === "paragraph" ? block.fragments : []).filter((fragment) => fragment.verse.verse === 1);
  assert.ok(fragments.every((fragment) => !fragment.text.includes("〔耶路撒冷的众女子〕")));
});
