import assert from "node:assert/strict";
import test from "node:test";
import { parseSermonInput } from "./sermonInput";

test("空输入与纯空白返回空数组", () => {
  assert.deepEqual(parseSermonInput("", false), []);
  assert.deepEqual(parseSermonInput("  \n\n ", false), []);
  assert.deepEqual(parseSermonInput("", true), []);
});

test("纯文字输入为一屏文字块，勾选分屏不改变结果", () => {
  const text = "一、引言\n\n二、正文";
  assert.deepEqual(parseSermonInput(text, false), [{ blocks: [{ type: "text", content: "一、引言\n\n二、正文" }] }]);
  assert.deepEqual(parseSermonInput(text, true), [{ blocks: [{ type: "text", content: "一、引言\n\n二、正文" }] }]);
});

test("多行经文默认合并为一屏多处经文", () => {
  const slides = parseSermonInput("约3:16\n诗篇23:1", false);
  assert.equal(slides.length, 1);
  assert.deepEqual(slides[0].blocks, [
    { type: "reference", reference: "约3:16" },
    { type: "reference", reference: "诗篇23:1" }
  ]);
});

test("每处经文一屏：每个出处独立成屏，顺序保持", () => {
  const slides = parseSermonInput("约3:16\n引言说明\n诗篇23:1", true);
  assert.equal(slides.length, 3);
  assert.deepEqual(slides[0].blocks, [{ type: "reference", reference: "约3:16" }]);
  assert.deepEqual(slides[1].blocks, [{ type: "text", content: "引言说明" }]);
  assert.deepEqual(slides[2].blocks, [{ type: "reference", reference: "诗篇23:1" }]);
});

test("同一行逗号分隔的出处默认进同一屏，分隔符不生成文字块", () => {
  const slides = parseSermonInput("约3:16，诗篇23:1", false);
  assert.equal(slides.length, 1);
  assert.deepEqual(slides[0].blocks, [
    { type: "reference", reference: "约3:16" },
    { type: "reference", reference: "诗篇23:1" }
  ]);
});

test("同行混排：经文识别为经文，前后文字保持文字", () => {
  const slides = parseSermonInput("请大家看 罗马书 3:23 这里", false);
  assert.equal(slides.length, 1);
  assert.deepEqual(slides[0].blocks, [
    { type: "text", content: "请大家看" },
    { type: "reference", reference: "罗马书 3:23" },
    { type: "text", content: "这里" }
  ]);
});

test("逗号连续节视为一处经文（罗3:23,24）", () => {
  const slides = parseSermonInput("罗3:23,24", false);
  assert.equal(slides.length, 1);
  assert.deepEqual(slides[0].blocks, [{ type: "reference", reference: "罗3:23,24" }]);
});

test("全角冒号与书名号出处可识别", () => {
  const slides = parseSermonInput("《约翰福音》3：16", false);
  assert.equal(slides.length, 1);
  assert.deepEqual(slides[0].blocks, [{ type: "reference", reference: "约翰福音3：16" }]);
});

test("超长文字块按行边界拆分（服务端单块 ≤4000 字）", () => {
  const longLine = "行".repeat(5000);
  const slides = parseSermonInput(longLine, false);
  assert.equal(slides.length, 1);
  assert.ok(slides[0].blocks.length > 1, "拆成多个文字块");
  for (const block of slides[0].blocks) {
    assert.ok(block.type !== "text" || block.content.length <= 4000);
  }
});

test("文字块跨行合并保留空行分段", () => {
  const slides = parseSermonInput("引子\n\n\n正文结尾", false);
  assert.deepEqual(slides, [{ blocks: [{ type: "text", content: "引子\n\n\n正文结尾" }] }]);
});
