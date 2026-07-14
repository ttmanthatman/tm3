import assert from "node:assert/strict";
import test from "node:test";
import {
  moveMusicTrack,
  musicFadeVolume,
  musicMentionTokenAtCursor,
  nextMusicTrackIndex,
  shouldAdvanceMusic,
  shouldKeepMusicScoreForTrack,
  shouldRestartOnlyTrack,
  shouldShowMusicScoreTrigger,
  sortMusicTracks
} from "./musicPlayer.js";
import { creditedMusicListenMs, isQualifiedMusicPlay } from "../shared/musicPlayback.js";

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

test("previous restarts the current song when the playlist contains only one track", () => {
  assert.equal(shouldRestartOnlyTrack(1, -1), true);
  assert.equal(shouldRestartOnlyTrack(1, 1), false);
  assert.equal(shouldRestartOnlyTrack(2, -1), false);
});

test("music pause fade decreases smoothly to silence", () => {
  assert.equal(musicFadeVolume(0), 1);
  assert.equal(musicFadeVolume(0.5), 0.5);
  assert.equal(musicFadeVolume(1), 0);
  assert.equal(musicFadeVolume(2), 0);
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

test("double at opens a music mention token at the caret", () => {
  assert.deepEqual(musicMentionTokenAtCursor("听这首 @@晨", 7), { start: 4, end: 7, query: "晨" });
  assert.deepEqual(musicMentionTokenAtCursor("@@", 2), { start: 0, end: 2, query: "" });
  assert.deepEqual(musicMentionTokenAtCursor("一起听@@song", 9), { start: 3, end: 9, query: "song" });
});

test("playlist tracks sort by manual order, heat, upload time, and filename", () => {
  const tracks = [
    { id: 1, title: "10", fileName: "10.mp3", createdAt: "2025-01-01T00:00:00.000Z", heat: 2, manualOrder: 1 },
    { id: 2, title: "2", fileName: "2.mp3", createdAt: "2026-01-01T00:00:00.000Z", heat: 9, manualOrder: 0 }
  ];
  assert.deepEqual(sortMusicTracks(tracks, "manual").map((track) => track.id), [2, 1]);
  assert.deepEqual(sortMusicTracks(tracks, "heat").map((track) => track.id), [2, 1]);
  assert.deepEqual(sortMusicTracks(tracks, "uploaded").map((track) => track.id), [2, 1]);
  assert.deepEqual(sortMusicTracks(tracks, "filename").map((track) => track.id), [2, 1]);
  assert.deepEqual(moveMusicTrack(tracks, 1, -1).map((track) => track.id), [2, 1]);
});

test("music heat only counts natural playback beyond half of the song", () => {
  assert.equal(creditedMusicListenMs(1_000, 2_000, 1_000), 1_000);
  assert.equal(creditedMusicListenMs(1_000, 31_000, 200), 0);
  assert.equal(creditedMusicListenMs(2_000, 1_000, 1_000), 0);
  assert.equal(isQualifiedMusicPlay(120_000, 60_000), false);
  assert.equal(isQualifiedMusicPlay(120_000, 60_001), true);
  assert.equal(isQualifiedMusicPlay(4_000, 3_000), false);
});
