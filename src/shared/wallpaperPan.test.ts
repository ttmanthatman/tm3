import assert from "node:assert/strict";
import test from "node:test";
import { advanceWallpaperPan, initialWallpaperPanOffset, wallpaperPanBounds } from "./wallpaperPan.js";

test("scales the wallpaper to the viewport height and aligns the chosen image coordinate with the viewport center", () => {
  const bounds = wallpaperPanBounds(1000, 500, 3000, 1000);
  assert.deepEqual(bounds, { imageWidth: 1500, minOffset: -500, maxOffset: 0, viewportWidth: 1000 });
  assert.equal(initialWallpaperPanOffset(bounds, 0.5), -250);
  assert.equal(initialWallpaperPanOffset(bounds, 0), 0);
  assert.equal(initialWallpaperPanOffset(bounds, 1), -500);
});

test("centers a height-fitted wallpaper when it is narrower than the viewport", () => {
  const bounds = wallpaperPanBounds(1000, 500, 1000, 1000);
  assert.equal(bounds.imageWidth, 500);
  assert.equal(bounds.minOffset, 250);
  assert.equal(bounds.maxOffset, 250);
  assert.equal(initialWallpaperPanOffset(bounds, 0.8), 250);
});

test("reverses at both edges and keeps the unconsumed movement", () => {
  const bounds = { minOffset: -500, maxOffset: 0 };
  assert.deepEqual(advanceWallpaperPan(-480, "left", 50, bounds), { offset: -470, direction: "right" });
  assert.deepEqual(advanceWallpaperPan(-20, "right", 50, bounds), { offset: -30, direction: "left" });
  assert.deepEqual(advanceWallpaperPan(-250, "left", 1250, bounds), { offset: -500, direction: "right" });
});
