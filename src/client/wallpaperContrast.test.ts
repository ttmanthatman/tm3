import assert from "node:assert/strict";
import test from "node:test";
import { wallpaperLabelTone, wallpaperLabelToneFromPixels } from "./wallpaperContrast";

test("wallpaper labels choose light text on dark colors and dark text on light colors", () => {
  assert.equal(wallpaperLabelTone("#111827"), "light");
  assert.equal(wallpaperLabelTone("#f6f5ef"), "dark");
});

test("wallpaper image sampling ignores transparent pixels", () => {
  assert.equal(wallpaperLabelToneFromPixels(new Uint8ClampedArray([10, 10, 10, 255, 255, 255, 255, 0])), "light");
  assert.equal(wallpaperLabelToneFromPixels(new Uint8ClampedArray([240, 230, 220, 255, 0, 0, 0, 0])), "dark");
});
