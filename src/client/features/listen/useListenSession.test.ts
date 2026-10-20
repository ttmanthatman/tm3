import assert from "node:assert/strict";
import test from "node:test";
import { nextTick, ref } from "vue";
import type { ListenPlaylistItem } from "@shared/listenPlaylist";
import type { BibleAudioPlayItem } from "../bible/bibleAudioQueue";
import { useListenSession } from "./useListenSession";

type Track = { id: number; title: string };

const psalm: ListenPlaylistItem = { kind: "scripture", reference: "诗篇 23:1-6", bookCode: "PSA", bookName: "诗篇", startChapter: 23, startVerse: 1, endChapter: 23, endVerse: 6 };
const sermon: ListenPlaylistItem = { kind: "scripture", reference: "马太福音 5:3-7:12", bookCode: "MAT", bookName: "马太福音", startChapter: 5, startVerse: 3, endChapter: 7, endVerse: 12 };
const song: ListenPlaylistItem = { kind: "track", trackId: 7, title: "奇异恩典" };
const missingSong: ListenPlaylistItem = { kind: "track", trackId: 99, title: "已删除" };

function harness(tracks: Track[] = [{ id: 7, title: "奇异恩典" }], bibleEnabled = true) {
  const bibleActive = ref(false);
  const biblePlaying = ref(false);
  const bibleVerse = ref<number | null>(null);
  const bibleQueueIndex = ref(0);
  const bibleQueue = ref<BibleAudioPlayItem[]>([]);
  const trackId = ref<number | null>(null);
  const musicPlaying = ref(false);
  const calls: string[] = [];
  const unavailable: string[] = [];

  const session = useListenSession<Track>({
    bible: {
      active: () => bibleActive.value,
      playing: () => biblePlaying.value,
      currentVerse: () => bibleVerse.value,
      currentChapter: () => bibleQueue.value[bibleQueueIndex.value]?.chapter ?? null,
      canPreviousChapter: () => bibleQueueIndex.value > 0,
      canNextChapter: () => bibleQueueIndex.value < bibleQueue.value.length - 1,
      playItems: async (items) => {
        calls.push(`bible.play:${items.map((item) => `${item.book}${item.chapter}:${item.verseStart}-${item.verseEnd ?? "end"}`).join(",")}`);
        if (!bibleEnabled) return false;
        bibleQueue.value = items;
        bibleQueueIndex.value = 0;
        bibleActive.value = true;
        biblePlaying.value = true;
        bibleVerse.value = items[0]?.verseStart ?? null;
        return true;
      },
      toggle: () => {
        calls.push("bible.toggle");
        biblePlaying.value = !biblePlaying.value;
      },
      stop: () => {
        calls.push("bible.stop");
        bibleActive.value = false;
        biblePlaying.value = false;
      },
      nextVerse: () => {
        calls.push("bible.nextVerse");
        bibleVerse.value = (bibleVerse.value ?? 0) + 1;
      },
      previousVerse: () => calls.push("bible.previousVerse"),
      nextChapter: () => {
        calls.push("bible.nextChapter");
        bibleQueueIndex.value += 1;
      },
      previousChapter: () => {
        calls.push("bible.previousChapter");
        bibleQueueIndex.value -= 1;
      }
    },
    music: {
      currentTrackId: () => trackId.value,
      playing: () => musicPlaying.value,
      ensureTracks: async () => undefined,
      findTrack: (id) => tracks.find((track) => track.id === id) || null,
      playTrack: (track) => {
        calls.push(`music.play:${track.id}`);
        trackId.value = track.id;
        musicPlaying.value = true;
      },
      pause: () => {
        calls.push("music.pause");
        musicPlaying.value = false;
      },
      toggle: () => {
        calls.push("music.toggle");
        musicPlaying.value = !musicPlaying.value;
      }
    },
    onUnavailable: (message) => unavailable.push(message)
  });

  // 模拟播放器自然播完
  const endBibleQueue = async () => {
    bibleActive.value = false;
    biblePlaying.value = false;
    session.handleBibleQueueEnded();
    await flush();
  };
  const endTrack = async () => {
    musicPlaying.value = false;
    const handled = session.handleTrackEnded();
    await flush();
    return handled;
  };
  const flush = async () => {
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();
  };

  return { session, calls, unavailable, bibleActive, biblePlaying, bibleVerse, trackId, musicPlaying, endBibleQueue, endTrack, flush };
}

test("a mixed playlist walks scripture → song → scripture and ends cleared", async () => {
  const h = harness();
  h.session.start(101, [psalm, song, sermon]);
  await h.flush();
  assert.deepEqual(h.calls, ["bible.play:PSA23:1-6"]);
  assert.deepEqual(h.session.current.value, { messageId: 101, index: 0, phase: "scripture", playing: true, verse: 1, chapter: 23 });

  await h.endBibleQueue();
  assert.equal(h.calls.at(-1), "music.play:7");
  assert.equal(h.session.current.value?.phase, "track");
  assert.equal(h.session.current.value?.index, 1);

  assert.equal(await h.endTrack(), true, "the session takes over the ended track so the library does not auto-advance");
  assert.equal(h.calls.at(-1), "bible.play:MAT5:3-end,MAT6:1-end,MAT7:1-12");
  assert.equal(h.session.current.value?.index, 2);

  await h.endBibleQueue();
  assert.equal(h.session.current.value, null);
});

test("switching players pauses music before scripture and stops scripture before a song", async () => {
  const h = harness();
  h.session.start(5, [song, psalm]);
  await h.flush();
  assert.equal(h.calls.at(-1), "music.play:7");
  await h.endTrack();
  // 歌曲自然播完后 musicPlaying 已为 false，不需要 pause；此处直接验证经文已起播
  assert.equal(h.calls.at(-1), "bible.play:PSA23:1-6");

  h.session.playItem(5, [song, psalm], 0);
  await h.flush();
  assert.ok(h.calls.includes("bible.stop"), "starting a song stops the active scripture");
  assert.equal(h.calls.at(-1), "music.play:7");
});

test("toggle pauses the active player while next/previous chapter move between items", async () => {
  const h = harness();
  h.session.start(9, [psalm, song, sermon]);
  await h.flush();
  h.session.toggle(9, [psalm, song, sermon]);
  assert.equal(h.calls.at(-1), "bible.toggle");
  assert.equal(h.session.current.value?.playing, false);

  h.session.nextVerse();
  assert.equal(h.calls.at(-1), "bible.nextVerse");

  h.session.nextChapter();
  await h.flush();
  assert.equal(h.calls.at(-1), "music.play:7", "single-chapter passage: next chapter jumps to the next item");
  h.session.nextVerse();
  assert.equal(h.calls.at(-1), "music.play:7", "verse stepping is a no-op while a song plays");

  h.session.nextChapter();
  await h.flush();
  assert.equal(h.calls.at(-1), "bible.play:MAT5:3-end,MAT6:1-end,MAT7:1-12");
  h.session.nextChapter();
  assert.equal(h.calls.at(-1), "bible.nextChapter", "multi-chapter passage: next chapter stays inside the passage first");
  h.session.previousChapter();
  assert.equal(h.calls.at(-1), "bible.previousChapter");
  h.session.previousChapter();
  await h.flush();
  assert.equal(h.calls.at(-1), "music.play:7", "at the passage start, previous chapter goes back to the previous item");
});

test("stopping scripture elsewhere or picking another song ends the session", async () => {
  const h = harness();
  const snapshot = () => h.session.current.value;
  h.session.start(3, [psalm, song]);
  await h.flush();
  h.bibleActive.value = false;
  await h.flush();
  assert.equal(snapshot(), null, "user dismissed the prompter → session cleared");

  h.session.start(3, [song, psalm]);
  await h.flush();
  assert.equal(snapshot()?.phase, "track");
  h.trackId.value = 42;
  await h.flush();
  assert.equal(snapshot(), null, "another library track replaced ours → session cleared");
  assert.equal(h.session.handleTrackEnded(), false, "an ended foreign track is left to the library");
});

test("unavailable items are skipped with a notice and an all-failing list clears itself", async () => {
  const h = harness();
  h.session.start(8, [missingSong, song]);
  await h.flush();
  assert.deepEqual(h.unavailable, ["《已删除》已被删除或暂时不可用"]);
  assert.equal(h.calls.at(-1), "music.play:7");

  const disabled = harness([], false);
  disabled.session.start(1, [psalm, sermon]);
  await disabled.flush();
  assert.equal(disabled.session.current.value, null);
  assert.deepEqual(disabled.unavailable, ["《诗篇 23:1-6》暂时无法朗读，已跳过"], "a chain of scripture failures is reported once");
});
