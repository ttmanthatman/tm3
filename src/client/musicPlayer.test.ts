import assert from "node:assert/strict";
import test from "node:test";
import { nextMusicTrackIndex, shouldAdvanceMusic } from "./musicPlayer.js";

test("playlist navigation wraps in both directions", () => {
  assert.equal(nextMusicTrackIndex(3, 0, -1), 2);
  assert.equal(nextMusicTrackIndex(3, 2, 1), 0);
  assert.equal(nextMusicTrackIndex(3, 1, 1), 2);
  assert.equal(nextMusicTrackIndex(0, 0, 1), -1);
});

test("only playlist mode advances after a track ends", () => {
  assert.equal(shouldAdvanceMusic("playlist"), true);
  assert.equal(shouldAdvanceMusic("single"), false);
});
