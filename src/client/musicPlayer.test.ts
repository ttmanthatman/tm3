import assert from "node:assert/strict";
import test from "node:test";
import { nextMusicTrackIndex, shouldAdvanceMusic, shouldKeepMusicScoreForTrack, shouldShowMusicScoreTrigger } from "./musicPlayer.js";

test("playlist navigation wraps in both directions", () => {
  assert.equal(nextMusicTrackIndex(3, 0, -1), 2);
  assert.equal(nextMusicTrackIndex(3, 2, 1), 0);
  assert.equal(nextMusicTrackIndex(3, 1, 1), 2);
  assert.equal(nextMusicTrackIndex(0, 0, 1), -1);
});

test("only playlist mode advances after a track ends", () => {
  assert.equal(shouldAdvanceMusic("playlist"), true);
  assert.equal(shouldAdvanceMusic("single"), false);
  assert.equal(shouldAdvanceMusic("playlist", true), false);
});

test("score trigger appears only for a playing track with pages, then remains available while open", () => {
  assert.equal(shouldShowMusicScoreTrigger({ playing: true, scoreOpen: false, pageCount: 2 }), true);
  assert.equal(shouldShowMusicScoreTrigger({ playing: true, scoreOpen: false, pageCount: 0 }), false);
  assert.equal(shouldShowMusicScoreTrigger({ playing: false, scoreOpen: false, pageCount: 2 }), false);
  assert.equal(shouldShowMusicScoreTrigger({ playing: false, scoreOpen: true, pageCount: 2 }), true);
});

test("open score follows manual track changes only when the next track has pages", () => {
  assert.equal(shouldKeepMusicScoreForTrack(3), true);
  assert.equal(shouldKeepMusicScoreForTrack(0), false);
});
