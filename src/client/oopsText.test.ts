import assert from "node:assert/strict";
import test from "node:test";
import {
  OOPS_MAX_GLYPHS_PER_MESSAGE,
  OOPS_MAX_GLYPHS_PER_PAGE,
  sampleWithoutReplacement,
  segmentTextGraphemes
} from "./oopsText";

test("segments Chinese, combining marks, and emoji by grapheme", () => {
  const slices = segmentTextGraphemes("哎呀e\u0301👨‍👩‍👧‍👦！");
  assert.deepEqual(slices.map((slice) => slice.text), ["哎", "呀", "e\u0301", "👨‍👩‍👧‍👦", "！"]);
  assert.equal(slices[2].start, 2);
  assert.equal(slices.at(-1)?.end, "哎呀e\u0301👨‍👩‍👧‍👦！".length);
});

test("samples the requested number without duplicates", () => {
  const values = Array.from({ length: 300 }, (_, index) => index);
  let seed = 17;
  const random = () => {
    seed = (seed * 48271) % 2147483647;
    return seed / 2147483647;
  };
  const selected = sampleWithoutReplacement(values, OOPS_MAX_GLYPHS_PER_MESSAGE, random);
  assert.equal(selected.length, 160);
  assert.equal(new Set(selected).size, 160);
  assert.ok(selected.every((value) => values.includes(value)));
});

test("keeps all items when the message is below the rigid-body limit", () => {
  const values = ["甲", "乙", "丙"];
  assert.deepEqual(sampleWithoutReplacement(values, OOPS_MAX_GLYPHS_PER_MESSAGE, () => 0.5), values);
  assert.equal(OOPS_MAX_GLYPHS_PER_PAGE, 240);
});
