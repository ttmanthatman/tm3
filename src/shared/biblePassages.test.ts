import assert from "node:assert/strict";
import test from "node:test";
import {
  BIBLE_PASSAGE_CONTENT_MAX,
  BIBLE_PASSAGE_MAX,
  biblePassageMessageContent,
  biblePassageMessagePayload,
  type BiblePassageMessagePayload
} from "./biblePassages.js";

const payload: BiblePassageMessagePayload = {
  kind: "bible_passage", sourceId: "cmn-cu89s", translation: "和合本", showTranslation: true,
  passages: [{ reference: "约翰福音 3:16", text: "3:16 神爱世人" }, { reference: "诗篇 23:1", text: "23:1 耶和华是我的牧者" }]
};

test("Bible passage payload normalizes without mutating, reordering or discarding passages", () => {
  const input = { ...payload, passages: payload.passages.map((passage) => ({ reference: ` ${passage.reference} `, text: ` ${passage.text} ` })) };
  assert.deepEqual(biblePassageMessagePayload(input), payload);
  assert.equal(input.passages[0].reference, " 约翰福音 3:16 ");
  assert.notEqual(biblePassageMessagePayload(input)?.passages, input.passages);
});

test("Bible passage payload rejects incomplete, empty, over-limit and malformed cards", () => {
  for (const input of [
    null, [], { ...payload, kind: "bible_topic" }, { ...payload, sourceId: "" }, { ...payload, translation: "" },
    { ...payload, showTranslation: "false" }, { ...payload, passages: [] },
    { ...payload, passages: Array.from({ length: BIBLE_PASSAGE_MAX + 1 }, () => payload.passages[0]) },
    { ...payload, passages: [payload.passages[0], { reference: "诗篇 23:1", text: 1 }] },
    { ...payload, passages: [{ reference: "", text: "正文" }] },
    { ...payload, passages: [{ reference: "经文", text: "字".repeat(BIBLE_PASSAGE_CONTENT_MAX) }] }
  ]) assert.equal(biblePassageMessagePayload(input), null);
});

test("Bible passage fallback keeps the full text and safely escapes every content field", () => {
  const content = biblePassageMessageContent({
    ...payload, translation: "译本 <script>",
    passages: [{ reference: "<b>约 3:16</b>", text: "神爱 & 世人\n\"<img src=x>\" '文字'" }]
  });
  assert.equal(content, "&lt;b&gt;约 3:16&lt;/b&gt;<br>神爱 &amp; 世人<br>&quot;&lt;img src=x&gt;&quot; &#39;文字&#39;<br><br>译本 &lt;script&gt;");
  assert.equal(biblePassageMessageContent({ ...payload, showTranslation: false }), "约翰福音 3:16<br>3:16 神爱世人<br><br>诗篇 23:1<br>23:1 耶和华是我的牧者");
});

test("Bible passage size limit counts escaped HTML without truncating the content", () => {
  const exact = { ...payload, showTranslation: false, passages: [{ reference: "经", text: "文".repeat(BIBLE_PASSAGE_CONTENT_MAX - 5) }] };
  assert.equal(biblePassageMessageContent(exact).length, BIBLE_PASSAGE_CONTENT_MAX);
  assert.ok(biblePassageMessagePayload(exact));
  assert.equal(biblePassageMessagePayload({ ...exact, passages: [{ reference: "经", text: exact.passages[0].text + "文" }] }), null);
});
