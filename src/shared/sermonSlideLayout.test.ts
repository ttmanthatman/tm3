import assert from "node:assert/strict";
import test from "node:test";
import { defaultSermonSlideLayout, resolveSermonSlideLayout } from "./sermonSlideLayout.js";

test("slide layout defaults scripture to paragraphs and text to centered", () => {
  assert.deepEqual(defaultSermonSlideLayout("bible"), { paragraph: true, centered: false });
  assert.deepEqual(defaultSermonSlideLayout("text"), { paragraph: true, centered: true });
});

test("persisted slide layout overrides defaults field by field", () => {
  assert.deepEqual(resolveSermonSlideLayout({ kind: "bible", layout: { paragraph: false, centered: true } }), {
    paragraph: false,
    centered: true
  });
});
