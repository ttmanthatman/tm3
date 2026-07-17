import assert from "node:assert/strict";
import test from "node:test";
import {
  bindMusicMediaSession,
  moveMusicTrack,
  musicFadeVolume,
  musicMentionTokenAtCursor,
  nextMusicTrackIndex,
  nextMusicTrackIndexForMode,
  pushMusicPlaybackHistory,
  shouldAdvanceMusic,
  shouldKeepMusicScoreForTrack,
  shouldRestartOnlyTrack,
  shouldRepeatCurrentMusic,
  shouldShowMusicScoreTrigger,
  syncMusicMediaSession,
  sortMusicTracks,
  takePreviousMusicTrack
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
  assert.equal(shouldAdvanceMusic("shuffle"), true);
  assert.equal(shouldAdvanceMusic("single"), false);
  assert.equal(shouldAdvanceMusic("playlist", true), false);
});

test("single mode repeats while shuffle chooses another track", () => {
  assert.equal(shouldRepeatCurrentMusic("single"), true);
  assert.equal(shouldRepeatCurrentMusic("single", true), false);
  assert.equal(nextMusicTrackIndexForMode(4, 1, 1, "shuffle", () => 0), 0);
  assert.equal(nextMusicTrackIndexForMode(4, 1, 1, "shuffle", () => 0.99), 3);
  assert.equal(nextMusicTrackIndexForMode(1, 0, 1, "shuffle", () => 0.5), 0);
  assert.equal(nextMusicTrackIndexForMode(4, 1, -1, "playlist", () => 0.5), 0);
});

test("previous restarts the current song when the playlist contains only one track", () => {
  assert.equal(shouldRestartOnlyTrack(1, -1), true);
  assert.equal(shouldRestartOnlyTrack(1, 1), false);
  assert.equal(shouldRestartOnlyTrack(2, -1), false);
});

test("manual track changes preserve playback history independently of the new playlist queue", () => {
  assert.deepEqual(pushMusicPlaybackHistory([3], 8, 12), [3, 8]);
  assert.deepEqual(pushMusicPlaybackHistory([3], 8, 8), [3]);
  assert.deepEqual(pushMusicPlaybackHistory([1, 2, 3], 4, 5, 3), [2, 3, 4]);
  assert.deepEqual(takePreviousMusicTrack([3, 8, 99], [3, 8, 12]), { trackId: 8, history: [3] });
  assert.deepEqual(takePreviousMusicTrack([99], [3, 8, 12]), { trackId: null, history: [] });
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

test("music heat counts natural playback after reaching one third of the song", () => {
  assert.equal(creditedMusicListenMs(1_000, 2_000, 1_000), 1_000);
  assert.equal(creditedMusicListenMs(1_000, 31_000, 200), 0);
  assert.equal(creditedMusicListenMs(2_000, 1_000, 1_000), 0);
  assert.equal(isQualifiedMusicPlay(120_000, 39_599), false);
  assert.equal(isQualifiedMusicPlay(120_000, 39_600), true);
  assert.equal(isQualifiedMusicPlay(4_000, 3_000), false);
});

test("system media controls drive playback and track navigation", () => {
  const registered = new Map<string, (() => void) | null>();
  const calls: string[] = [];
  const session = {
    setActionHandler(action: string, handler: (() => void) | null) {
      registered.set(action, handler);
    }
  };

  const unbind = bindMusicMediaSession(session, {
    play: () => calls.push("play"),
    pause: () => calls.push("pause"),
    previousTrack: () => calls.push("previous"),
    nextTrack: () => calls.push("next")
  });

  registered.get("play")?.();
  registered.get("pause")?.();
  registered.get("previoustrack")?.();
  registered.get("nexttrack")?.();
  assert.deepEqual(calls, ["play", "pause", "previous", "next"]);

  unbind();
  assert.equal(registered.get("play"), null);
  assert.equal(registered.get("pause"), null);
  assert.equal(registered.get("previoustrack"), null);
  assert.equal(registered.get("nexttrack"), null);
});

test("media controls tolerate browser-specific unsupported actions", () => {
  const registered: string[] = [];
  const session = {
    setActionHandler(action: string) {
      if (action === "previoustrack") throw new TypeError("unsupported");
      registered.push(action);
    }
  };

  assert.doesNotThrow(() =>
    bindMusicMediaSession(session, {
      play: () => undefined,
      pause: () => undefined,
      previousTrack: () => undefined,
      nextTrack: () => undefined
    })
  );
  assert.deepEqual(registered, ["play", "pause", "nexttrack"]);
});

test("media session metadata and playback state follow the current song", () => {
  const session: {
    playbackState: "none" | "paused" | "playing";
    metadata: { title: string; artist: string } | null;
  } = { playbackState: "none", metadata: null };

  syncMusicMediaSession(session, { title: "晨光", playing: true }, (metadata) => metadata);
  assert.equal(session.playbackState, "playing");
  assert.deepEqual(session.metadata, { title: "晨光", artist: "聊天室音乐" });

  syncMusicMediaSession(session, { title: "晨光", playing: false }, (metadata) => metadata);
  assert.equal(session.playbackState, "paused");

  syncMusicMediaSession(session, { title: "", playing: false }, (metadata) => metadata);
  assert.equal(session.playbackState, "none");
  assert.equal(session.metadata, null);
});
