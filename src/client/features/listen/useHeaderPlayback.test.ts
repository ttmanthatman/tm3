import assert from "node:assert/strict";
import test from "node:test";
import { effectScope, reactive, ref } from "vue";
import type { MusicPlayer } from "../music/useMusicPlayer.js";
import type { FriendPlayer } from "../friend/useFriendPlayer.js";
import { useHeaderPlayback } from "./useHeaderPlayback.js";

test("header playback follows the active source, remembers paused radio and respects mixed-session boundaries", () => {
  const calls: string[] = [];
  const currentTrack = ref<{ title: string } | null>({ title: "恩典" });
  const music = {
    state: { playing: ref(true), currentTrack, playableTracks: ref([1, 2]) },
    controls: { togglePlayback: () => calls.push("song-toggle"), shiftTrack: (delta: number) => calls.push(`song:${delta}`) }
  } as unknown as MusicPlayer;
  const friend = {
    state: { playing: ref(false), currentProgram: ref({ title: "节目" }), canShiftProgram: ref(true) },
    controls: { toggleProgram: () => calls.push("radio-toggle"), shiftProgram: (delta: number) => calls.push(`radio:${delta}`) }
  } as unknown as FriendPlayer;
  const bible = reactive({ active: false, playing: false, canPreviousChapter: false, canNextChapter: true,
    toggle: () => calls.push("bible-toggle"), previousChapter: () => calls.push("bible-previous"), nextChapter: () => calls.push("bible-next") });
  let session = false;
  const scope = effectScope();
  const playback = scope.run(() => useHeaderPlayback({ music, friend, bible: () => bible,
    canShiftSession: delta => session ? delta > 0 : null,
    shiftSession: delta => { if (!session) return false; calls.push(`session:${delta}`); return true; }
  }))!;
  try {
    assert.equal(playback.title.value, "恩典");
    playback.toggle();
    playback.shift(1);
    music.state.playing.value = false;
    friend.state.playing.value = true;
    assert.equal(playback.title.value, "节目");
    playback.shift(-1);
    friend.state.playing.value = false;
    assert.equal(playback.playing.value, false);
    playback.toggle();
    bible.active = true;
    bible.playing = true;
    playback.toggle();
    assert.equal(playback.canShift(-1), false);
    playback.shift(-1);
    playback.shift(1);
    session = true;
    playback.shift(1);
    assert.equal(playback.canShift(-1), false);
    assert.deepEqual(calls, ["song-toggle", "song:1", "radio:-1", "radio-toggle", "bible-toggle", "bible-next", "session:1"]);
    bible.playing = false;
    bible.active = false;
    currentTrack.value = null;
    assert.equal(playback.available.value, false);
    playback.toggle();
    assert.equal(calls.length, 7);
  } finally { scope.stop(); }
});
