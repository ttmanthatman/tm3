import assert from "node:assert/strict";
import test from "node:test";
import { bibleTopicMessagePayload } from "./bibleTopics.js";

test("bibleTopicMessagePayload accepts only well-formed topic card payloads", () => {
  const valid = { kind: "bible_topic", name: "我们在神面前都是穷人", translation: "新标点和合本（简体）", passages: [{ reference: "诗篇 49:6-9", text: "6 …\n7 …" }] };
  assert.deepEqual(bibleTopicMessagePayload(valid), valid);
  assert.equal(bibleTopicMessagePayload(null), null);
  assert.equal(bibleTopicMessagePayload([]), null);
  assert.equal(bibleTopicMessagePayload({ ...valid, kind: "bible_note" }), null);
  assert.equal(bibleTopicMessagePayload({ ...valid, name: 7 }), null);
  assert.equal(bibleTopicMessagePayload({ ...valid, passages: [] }), null);
  assert.equal(bibleTopicMessagePayload({ ...valid, passages: [{ reference: "x" }] }), null);
  assert.equal(bibleTopicMessagePayload({ ...valid, passages: [{ reference: "x", text: 1 }] }), null);
  // 超长名称与超量段落按上限截断/拒绝，防止伪造的巨型消息卡
  const tooMany = { ...valid, passages: Array.from({ length: 201 }, () => valid.passages[0]) };
  assert.equal(bibleTopicMessagePayload(tooMany), null);
  const longName = { ...valid, name: "长".repeat(80) };
  assert.equal(bibleTopicMessagePayload(longName)!.name.length, 60);
});
