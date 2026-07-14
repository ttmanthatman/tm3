import assert from "node:assert/strict";
import test from "node:test";
import {
  MUSIC_LYRICS_TICK_MS,
  shouldRenderMessageEffect,
  shouldRunFlashEffectTimer,
  shouldRunMusicLyricsClock
} from "./animationPolicy.js";

test("karaoke clock runs at a bounded rate only while visible lyrics need it", () => {
  assert.equal(MUSIC_LYRICS_TICK_MS, 100);
  assert.equal(shouldRunMusicLyricsClock({ playing: true, cueCount: 3, suppressed: false, documentVisible: true }), true);
  assert.equal(shouldRunMusicLyricsClock({ playing: false, cueCount: 3, suppressed: false, documentVisible: true }), false);
  assert.equal(shouldRunMusicLyricsClock({ playing: true, cueCount: 0, suppressed: false, documentVisible: true }), false);
  assert.equal(shouldRunMusicLyricsClock({ playing: true, cueCount: 3, suppressed: true, documentVisible: true }), false);
  assert.equal(shouldRunMusicLyricsClock({ playing: true, cueCount: 3, suppressed: false, documentVisible: false }), false);
});

test("message effects render only while their observed bubble is visible", () => {
  assert.equal(shouldRenderMessageEffect({ manuallyPaused: false, visibilityKnown: false, visible: false, documentVisible: true }), true);
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
