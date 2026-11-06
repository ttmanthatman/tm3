import assert from "node:assert/strict";
import test from "node:test";
import { defaultWallpaper, effectiveWallpaper, wallpaperFitPresentation, type WallpaperState } from "../../../shared/wallpaper.js";

test("personal wallpaper survives shared updates, off stays off, following resolves latest", () => {
  const shared = { ...defaultWallpaper, wallpaperPath: "shared.webp" };
  const personal = { ...defaultWallpaper, wallpaperPath: "mine.webp" };
  const state: WallpaperState = { images: [], shared, version: "1", updatedBy: "friend", preference: { mode: "personal", config: personal } };
  assert.equal(effectiveWallpaper(state, defaultWallpaper), personal);
  state.shared = { ...shared, wallpaperPath: "new.webp" };
  assert.equal(effectiveWallpaper(state, defaultWallpaper), personal);
  state.preference = { mode: "off" }; assert.equal(effectiveWallpaper(state, shared).wallpaperPath, null);
  state.preference = { mode: "follow" }; assert.equal(effectiveWallpaper(state, shared).wallpaperPath, "new.webp");
  state.images = [{ id: "1", fileName: "new.webp", contributorId: 1, contributorName: "friend", createdAt: "", banned: true }];
  assert.equal(effectiveWallpaper(state, shared).wallpaperPath, null);
  assert.equal(effectiveWallpaper(null, shared), shared);
  assert.deepEqual(wallpaperFitPresentation("pan"), { size: "auto 100%", repeat: "no-repeat" });
});
