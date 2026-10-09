import assert from "node:assert/strict";
import test from "node:test";
import { bookNoteInSection, bookNotePageFraction, buildBookNoteText, findBookNoteQuote, findBookNoteQuotes } from "./bookNoteHighlights";

test("quotes retain source offsets across inline nodes, paragraphs, indentation and emoji", () => {
  const result = buildBookNoteText([
    { text: "  他问：" }, { text: "你" }, { text: "好😊？  \n " },
    { text: "  下一段。", breakBefore: true }
  ]);
  assert.equal(result.text, "他问：你好😊？ 下一段。");
  const match = findBookNoteQuote(result.text, "你好😊？\n\n下一段。", .5)!;
  assert.deepEqual(result.starts[match.start], { part: 1, offset: 0 });
  assert.deepEqual(result.ends[match.end - 1], { part: 3, offset: 6 });
  assert.equal(findBookNoteQuote(result.text, "不存在", .5), null);
  assert.equal(findBookNoteQuote(result.text, " \n ", .5), null);
});

test("repeated quotes choose the location nearest the reader's section fraction", () => {
  const text = "相同句子。中间的段落还有很多文字。相同句子。";
  assert.deepEqual(findBookNoteQuote(text, "相同句子。", .1), { start: 0, end: 5 });
  assert.deepEqual(findBookNoteQuote(text, "相同句子。", .95), { start: 17, end: 22 });
  assert.deepEqual(findBookNoteQuote("aaaa", "aaa", 1), { start: 1, end: 4 });
});

test("all repeated ranges remain available for geometry matching, including overlapping text", () => {
  assert.deepEqual(findBookNoteQuotes("aaaa", "aaa"), [{ start: 0, end: 3 }, { start: 1, end: 4 }]);
});

test("paginated note positions restore their page and distinguish quotes within that page", () => {
  for (const pages of [1, 2, 3, 20, 200]) {
    for (let page = 0; page < pages; page += 1) {
      const early = bookNotePageFraction(page, pages, .1);
      const late = bookNotePageFraction(page, pages, .9);
      assert.ok(early < late);
      for (const fraction of [early, late]) assert.equal(Math.round(fraction * (pages - 1)), page);
    }
  }
});

test("only the matching EPUB section receives notes, including the final end position", () => {
  assert.equal(bookNoteInSection(.25, .25, .5), true);
  assert.equal(bookNoteInSection(.5, .25, .5), false);
  assert.equal(bookNoteInSection(.1, .25, .5), false);
  assert.equal(bookNoteInSection(1, .5, 1), true);
  assert.equal(bookNoteInSection(Number.NaN, 0, 1), false);
  assert.equal(bookNoteInSection(.5, .5, .5), false);
});

test("whitespace boundaries keep original text positions for a quote ending before the next node", () => {
  const result = buildBookNoteText([{ text: "first \n " }, { text: " word " }, { text: "next", breakBefore: true }]);
  assert.equal(result.text, "first word next");
  const match = findBookNoteQuote(result.text, "first\n word", 0)!;
  assert.deepEqual(result.starts[match.start], { part: 0, offset: 0 });
  assert.deepEqual(result.ends[match.end - 1], { part: 1, offset: 5 });
});
