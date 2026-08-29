import assert from "node:assert/strict";
import test from "node:test";
import { SERMON_BG_PRESETS, sermonBackgroundPaint, sermonThemePatch } from "./sermonThemes.js";

test("background themes include several gradients with paired text colors", () => {
  const gradients = SERMON_BG_PRESETS.filter((preset) => preset.chip.includes("gradient"));
  assert.ok(gradients.length >= 4);
  for (const preset of SERMON_BG_PRESETS) {
    assert.match(preset.textColor, /^#[0-9a-fA-F]{6}$/);
    assert.deepEqual(sermonThemePatch(preset), { background: preset.value, textColor: preset.textColor });
  }
});

test("preview frame paint matches preset and custom backgrounds", () => {
  assert.equal(sermonBackgroundPaint("sepia"), "#f3ead7");
  assert.match(sermonBackgroundPaint("dawn"), /^linear-gradient/);
  assert.equal(sermonBackgroundPaint("#123456"), "#123456");
});
