import assert from "node:assert/strict";
import test from "node:test";
import {
  BIBLE_FAVORITE_COLOR_PRESETS,
  DEFAULT_BIBLE_FAVORITE_COLOR,
  normalizeBibleFavoriteColor
} from "./bibleFavoriteColors.js";

test("Bible favorite colors expose seven saturated presets with pale red as default", () => {
  assert.equal(BIBLE_FAVORITE_COLOR_PRESETS.length, 7);
  assert.equal(DEFAULT_BIBLE_FAVORITE_COLOR, "#f28b82");
  assert.equal(new Set(BIBLE_FAVORITE_COLOR_PRESETS.map((preset) => preset.color)).size, 7);
  assert.ok(BIBLE_FAVORITE_COLOR_PRESETS.every((preset) => /^#[0-9a-f]{6}$/.test(preset.color)));
});

test("Bible favorite colors reject arbitrary or achromatic values", () => {
  assert.equal(normalizeBibleFavoriteColor("#4285F4"), "#4285f4");
  assert.equal(normalizeBibleFavoriteColor("#ffffff"), DEFAULT_BIBLE_FAVORITE_COLOR);
  assert.equal(normalizeBibleFavoriteColor("#777777"), DEFAULT_BIBLE_FAVORITE_COLOR);
  assert.equal(normalizeBibleFavoriteColor("#123456"), DEFAULT_BIBLE_FAVORITE_COLOR);
});
