import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { insertWechatEmoji, wechatEmojis, wechatEmojiByToken } from "./wechatEmoji";

test("the complete emoji catalog has unique tokens and local assets", () => {
  assert.equal(wechatEmojis.length, 109);
  assert.equal(wechatEmojiByToken.size, 109);
  for (const emoji of wechatEmojis) {
    assert.equal(emoji.token, `[${emoji.name}]`);
    assert.ok(existsSync(new URL(`../../../../public${emoji.src}`, import.meta.url)), emoji.name);
  }
});

test("inserts an emoji at the caret without replacing the surrounding draft", () => {
  assert.deepEqual(insertWechatEmoji("你好世界", "[微笑]", 2), { value: "你好[微笑]世界", caret: 6 });
});

test("replaces only the selected text and places the caret after the emoji", () => {
  assert.deepEqual(insertWechatEmoji("你好世界", "[拥抱]", 1, 3), { value: "你[拥抱]界", caret: 5 });
});

test("supports an emoji-only message and sequential insertion", () => {
  const first = insertWechatEmoji("", "[微笑]", 0);
  assert.deepEqual(insertWechatEmoji(first.value, "[合十]", first.caret), { value: "[微笑][合十]", caret: 8 });
});

test("clamps stale selection positions to the current draft", () => {
  assert.deepEqual(insertWechatEmoji("你好", "[微笑]", 99, 100), { value: "你好[微笑]", caret: 6 });
});
