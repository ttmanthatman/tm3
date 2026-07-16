import assert from "node:assert/strict";
import test from "node:test";
import {
  MUSIC_LYRICS_TICK_MS,
  shouldAdvanceWallpaperPan,
  shouldRenderMessageEffect,
  shouldRunFlashEffectTimer,
  shouldRunMusicLyricsClock,
  shouldTriggerIncomingRainEffect
} from "./animationPolicy.js";

test("freezes wallpaper pan while music is playing or the Bible is open", () => {
  assert.equal(shouldAdvanceWallpaperPan({ musicPlaying: false, bibleOpen: false, documentVisible: true }), true);
  assert.equal(shouldAdvanceWallpaperPan({ musicPlaying: true, bibleOpen: false, documentVisible: true }), false);
  assert.equal(shouldAdvanceWallpaperPan({ musicPlaying: false, bibleOpen: true, documentVisible: true }), false);
  assert.equal(shouldAdvanceWallpaperPan({ musicPlaying: false, bibleOpen: false, documentVisible: false }), false);
});

test("karaoke clock runs at a bounded rate only while visible lyrics need it", () => {
  assert.equal(MUSIC_LYRICS_TICK_MS, 100);
  assert.equal(shouldRunMusicLyricsClock({ playing: true, cueCount: 3, suppressed: false, documentVisible: true }), true);
  assert.equal(shouldRunMusicLyricsClock({ playing: false, cueCount: 3, suppressed: false, documentVisible: true }), false);
  assert.equal(shouldRunMusicLyricsClock({ playing: true, cueCount: 0, suppressed: false, documentVisible: true }), false);
  assert.equal(shouldRunMusicLyricsClock({ playing: true, cueCount: 3, suppressed: true, documentVisible: true }), false);
  assert.equal(shouldRunMusicLyricsClock({ playing: true, cueCount: 3, suppressed: false, documentVisible: false }), false);
});

test("message effects render only while their observed bubble is visible", () => {
  assert.equal(shouldRenderMessageEffect({ manuallyPaused: false, visibilityKnown: false, visible: false, documentVisible: true }), false);
  assert.equal(shouldRenderMessageEffect({ manuallyPaused: false, visibilityKnown: true, visible: true, documentVisible: true }), true);
  assert.equal(shouldRenderMessageEffect({ manuallyPaused: false, visibilityKnown: true, visible: false, documentVisible: true }), false);
  assert.equal(shouldRenderMessageEffect({ manuallyPaused: true, visibilityKnown: true, visible: true, documentVisible: true }), false);
  assert.equal(shouldRenderMessageEffect({ manuallyPaused: false, visibilityKnown: true, visible: true, documentVisible: false }), false);
});

test("flash timer sleeps unless a visible bubble or the admin preview needs it", () => {
  assert.equal(shouldRunFlashEffectTimer({ visibleFlashMessage: true, previewVisible: false, documentVisible: true }), true);
  assert.equal(shouldRunFlashEffectTimer({ visibleFlashMessage: false, previewVisible: true, documentVisible: true }), true);
  assert.equal(shouldRunFlashEffectTimer({ visibleFlashMessage: false, previewVisible: false, documentVisible: true }), false);
  assert.equal(shouldRunFlashEffectTimer({ visibleFlashMessage: true, previewVisible: true, documentVisible: false }), false);
});

test("incoming rain runs only for a message visible in the active channel view", () => {
  const visible = { messageChannelId: 3, currentChannelId: 3, prayerOnly: false, messageType: "text", activeView: true, messageVisible: true, documentVisible: true };
  assert.equal(shouldTriggerIncomingRainEffect({ ...visible, effect: "rain" }), true);
  assert.equal(shouldTriggerIncomingRainEffect({ ...visible, effect: "rain", messageChannelId: 4 }), false);
  assert.equal(shouldTriggerIncomingRainEffect({ ...visible, effect: "rain", prayerOnly: true }), false);
  assert.equal(shouldTriggerIncomingRainEffect({ ...visible, effect: "fly" }), false);
  assert.equal(shouldTriggerIncomingRainEffect({ ...visible, effect: "rain", activeView: false }), false);
  assert.equal(shouldTriggerIncomingRainEffect({ ...visible, effect: "rain", messageVisible: false }), false);
  assert.equal(shouldTriggerIncomingRainEffect({ ...visible, effect: "rain", documentVisible: false }), false);
});
