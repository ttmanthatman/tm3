import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceWallpaperPan,
  initialWallpaperPanOffset,
  wallpaperPanBounds,
  wallpaperPanLayerPresentation,
  wallpaperPanTransform
} from "./wallpaperPan.js";

test("scales the wallpaper to the viewport height and aligns the chosen image coordinate with the viewport center", () => {
  const bounds = wallpaperPanBounds(1000, 500, 3000, 1000);
  assert.deepEqual(bounds, { imageWidth: 1500, minOffset: -500, maxOffset: 0, viewportWidth: 1000 });
  assert.equal(initialWallpaperPanOffset(bounds, 0.5), -250);
  assert.equal(initialWallpaperPanOffset(bounds, 0), 0);
  assert.equal(initialWallpaperPanOffset(bounds, 1), -500);
});

test("keeps a portrait wallpaper wide enough to cover a resized viewport", () => {
  const bounds = wallpaperPanBounds(1000, 500, 1000, 1000);
  assert.equal(bounds.imageWidth, 1000);
  assert.equal(bounds.minOffset, 0);
  assert.equal(bounds.maxOffset, 0);
  assert.equal(initialWallpaperPanOffset(bounds, 0.8), 0);
});

test("reverses at both edges and keeps the unconsumed movement", () => {
  const bounds = { minOffset: -500, maxOffset: 0 };
  assert.deepEqual(advanceWallpaperPan(-480, "left", 50, bounds), { offset: -470, direction: "right" });
  assert.deepEqual(advanceWallpaperPan(-20, "right", 50, bounds), { offset: -30, direction: "left" });
  assert.deepEqual(advanceWallpaperPan(-250, "left", 1250, bounds), { offset: -500, direction: "right" });
});

test("moves the wallpaper on its own compositor layer", () => {
  assert.equal(wallpaperPanTransform(-125.678), "translate3d(-125.68px, 0, 0)");
  assert.equal(wallpaperPanTransform(Number.NaN), "translate3d(0.00px, 0, 0)");
});

test("gives the compositor layer the same scaled width used by the pan bounds", () => {
  const bounds = wallpaperPanBounds(630, 841, 1774, 887);
  assert.deepEqual(wallpaperPanLayerPresentation(bounds.imageWidth, -213.909), {
    width: "1682.00px",
    transform: "translate3d(-213.91px, 0, 0)"
  });
});
