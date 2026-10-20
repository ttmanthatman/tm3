import assert from "node:assert/strict";
import test from "node:test";
import { nextTick } from "vue";
import type { BibleAudioChapterIndex, BibleAudioVersionManifest } from "@shared/bibleAudio";
import type { BibleBookCatalogDTO, BibleLookupDTO, BibleVerseLineDTO } from "@shared/types";
import { useBibleAudioPlayer, type BibleAudioPlayerRuntime } from "./useBibleAudioPlayer";

class FakeAudio extends EventTarget {
  preload = "";
  currentTime = 0;
  duration = 0;
  paused = true;
  playbackRate = 1;
  src = "";
  playCalls = 0;
  loadCalls = 0;

  async play() {
    this.playCalls += 1;
    this.paused = false;
    this.dispatchEvent(new Event("play"));
  }

  pause() {
    const wasPlaying = !this.paused;
    this.paused = true;
    if (wasPlaying) this.dispatchEvent(new Event("pause"));
  }

  load() {
    this.loadCalls += 1;
  }

  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }

  /** 模拟元数据就绪（触发待处理 seek）后再推进时间 */
  ready(durationSeconds: number) {
    this.duration = durationSeconds;
    this.dispatchEvent(new Event("loadedmetadata"));
  }

  tick(seconds: number) {
    this.currentTime = seconds;
    this.dispatchEvent(new Event("timeupdate"));
  }

  end() {
    this.dispatchEvent(new Event("ended"));
  }
}

const books: BibleBookCatalogDTO[] = [
  { code: "JUD", name: "犹大书", chapterCount: 1 },
  { code: "REV", name: "启示录", chapterCount: 22 }
];

function chapter(book: string, number: number, verseCount: number, verseSeconds = 10): BibleAudioChapterIndex {
  const verses = [{ verse: 0, startMs: 0, endMs: 4_000 }];
  for (let verse = 1; verse <= verseCount; verse += 1) {
    const startMs = 4_000 + (verse - 1) * verseSeconds * 1000;
    verses.push({ verse, startMs, endMs: startMs + verseSeconds * 1000 });
  }
  return { book, chapter: number, durationMs: verses[verses.length - 1].endMs, verses };
}

function version(chapters: BibleAudioChapterIndex[]): BibleAudioVersionManifest {
  return {
    versionId: "cuvmpt-drama",
    name: "华语有声戏剧圣经",
    language: "zh-Hans",
    dialect: "zh",
    style: "drama",
    translation: "cmn-cu89s",
    copyright: "©",
    bookCount: 2,
    chapterCount: chapters.length,
    totalBytes: 0,
    completed: false,
    chapters
  };
}

const line = (book: string, chapterNumber: number, verse: number, endVerse = verse): BibleVerseLineDTO => ({
  book,
  chapter: chapterNumber,
  verse,
  endVerse,
  reference: `${book} ${chapterNumber}:${verse}`,
  text: ""
});

const lookup = (verses: BibleVerseLineDTO[]): BibleLookupDTO => ({ reference: "", normalizedReference: "", translation: "和合本", sourceId: "cmn-cu89s", verses });

function createHarness(chapters: BibleAudioChapterIndex[] = [chapter("JUD", 1, 25), chapter("REV", 1, 20), chapter("REV", 2, 29), chapter("REV", 22, 21)]) {
  const audio = new FakeAudio();
  const storage = new Map<string, string>();
  const toasts: string[] = [];
  const manifest = version(chapters);
  const runtime: BibleAudioPlayerRuntime = {
    createAudio: () => audio as unknown as HTMLAudioElement,
    storage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key)
    },
    token: () => "tok-1"
  };
  const player = useBibleAudioPlayer({
    accountId: () => 7,
    books: () => books,
    version: () => manifest,
    onToast: (message) => toasts.push(message),
    runtime
  });
  return { audio, storage, toasts, player };
}

test("whole-chapter playback streams with a token, tracks the current verse and continues into the next chapter", async () => {
  const { audio, player } = createHarness();
  player.startFromChapter("JUD", 1, 3);
  assert.equal(audio.src, "/api/bible-audio/cuvmpt-drama/JUD/1/stream?token=tok-1");
  assert.equal(audio.loadCalls, 1);
  assert.equal(audio.playCalls, 1);
  assert.equal(player.mode.value, "continuous");
  assert.equal(player.currentVerse.value, 3, "starts on the requested verse before metadata arrives");
  audio.ready(254);
  assert.equal(audio.currentTime, 24, "seeks to the start of verse 3 once metadata is ready");

  audio.tick(35);
  await nextTick();
  assert.equal(player.currentVerse.value, 4);
  assert.equal(player.playingVerseKey.value, "JUD-1-4");
  assert.equal(player.currentReference.value, "犹大书 1:4");
  assert.equal(player.playing.value, true);

  audio.tick(2);
  assert.equal(player.playingVerseKey.value, null, "chapter introduction (verse 0) is not highlighted");
  assert.equal(player.currentReference.value, "犹大书 1 · 引言");

  audio.end();
  assert.equal(audio.src, "/api/bible-audio/cuvmpt-drama/REV/1/stream?token=tok-1", "continues into the next book");
  assert.deepEqual(player.currentItem.value, { book: "REV", chapter: 1, verseStart: 0, verseEnd: null });
  assert.equal(audio.playCalls, 2);
});

test("selection playback walks each passage, swaps source across chapters and stops at the end", async () => {
  const { audio, player } = createHarness();
  const started = player.startFromLookups([
    lookup([line("启示录", 1, 2), line("启示录", 1, 3)]),
    lookup([line("启示录", 1, 10)]),
    lookup([line("启示录", 2, 1)])
  ]);
  assert.equal(started, true);
  assert.equal(player.mode.value, "selection");
  assert.equal(player.queue.value.length, 3);
  assert.equal(audio.src, "/api/bible-audio/cuvmpt-drama/REV/1/stream?token=tok-1");
  audio.ready(204);
  assert.equal(audio.currentTime, 14, "verse 2 starts at 14s");

  audio.tick(33.99);
  assert.equal(player.queueIndex.value, 1, "reaching the end of verse 3 jumps to the next passage");
  assert.equal(audio.currentTime, 94, "same chapter: seeks directly to verse 10");
  assert.equal(audio.loadCalls, 1, "no reload within the same chapter");

  audio.tick(104);
  assert.equal(player.queueIndex.value, 2);
  assert.equal(audio.src, "/api/bible-audio/cuvmpt-drama/REV/2/stream?token=tok-1");
  assert.equal(audio.loadCalls, 2);
  audio.ready(294);
  assert.equal(audio.currentTime, 4, "verse 1 of chapter 2");

  audio.tick(14);
  await nextTick();
  assert.equal(player.active.value, false, "queue finished: playback stops instead of continuing the chapter");
  assert.equal(player.playingVerseKey.value, null);
  assert.equal(audio.paused, true);
});

test("missing chapters are skipped with a toast and the canon end stops playback", () => {
  const { audio, player, toasts } = createHarness([chapter("JUD", 1, 25), chapter("REV", 22, 21)]);
  player.startFromChapter("JUD", 1);
  audio.ready(254);
  audio.end();
  assert.deepEqual(toasts, ["启示录 1 音频缺失，已跳过", "启示录 2 音频缺失，已跳过", ...Array.from({ length: 19 }, (_, index) => `启示录 ${index + 3} 音频缺失，已跳过`)]);
  assert.deepEqual(player.currentItem.value, { book: "REV", chapter: 22, verseStart: 0, verseEnd: null });
  audio.ready(214);
  audio.end();
  assert.equal(player.active.value, false, "after Revelation 22 there is nothing left to play");
});

test("seeking to a verse outside the current passage releases the selection into whole-chapter play", () => {
  const { audio, player } = createHarness();
  player.startFromLookups([lookup([line("启示录", 1, 2), line("启示录", 1, 3)]), lookup([line("启示录", 2, 5)])]);
  audio.ready(204);
  player.seekToVerse("REV", 1, 3);
  assert.equal(player.mode.value, "selection", "seeking inside the passage keeps the selection");
  assert.equal(audio.currentTime, 24);

  player.seekToVerse("REV", 1, 12);
  assert.equal(player.mode.value, "continuous");
  assert.deepEqual(player.queue.value, [{ book: "REV", chapter: 1, verseStart: 0, verseEnd: null }]);
  assert.equal(audio.currentTime, 114);

  player.seekToVerse("REV", 2, 7);
  assert.equal(audio.src, "/api/bible-audio/cuvmpt-drama/REV/2/stream?token=tok-1");
  assert.equal(player.currentVerse.value, 7);
});

test("play-through starts at the selection's first verse but continues past the selection end", () => {
  const { audio, player } = createHarness();
  const started = player.startFromLookupsThrough([
    lookup([line("启示录", 1, 2), line("启示录", 1, 3)]),
    lookup([line("启示录", 2, 1)])
  ]);
  assert.equal(started, true);
  assert.equal(player.mode.value, "continuous");
  assert.deepEqual(player.queue.value, [{ book: "REV", chapter: 1, verseStart: 0, verseEnd: null }]);
  audio.ready(204);
  assert.equal(audio.currentTime, 14, "starts at verse 2 of the selection");

  audio.tick(100);
  assert.equal(player.mode.value, "continuous", "passing the selection end keeps playing the chapter");
  audio.tick(203.99);
  assert.equal(player.currentVerse.value, 20);
  audio.end();
  assert.equal(audio.src, "/api/bible-audio/cuvmpt-drama/REV/2/stream?token=tok-1", "chapter end chains into the next chapter instead of the next passage");
});

test("continueAll converts a running selection session into whole-chapter play on the spot", () => {
  const { audio, player } = createHarness();
  player.startFromLookups([lookup([line("启示录", 1, 2), line("启示录", 1, 3)]), lookup([line("启示录", 2, 1)])]);
  audio.ready(204);
  assert.equal(audio.currentTime, 14);

  player.continueAll();
  assert.equal(player.mode.value, "continuous");
  assert.deepEqual(player.queue.value, [{ book: "REV", chapter: 1, verseStart: 0, verseEnd: null }]);
  assert.equal(audio.currentTime, 14, "playback position is untouched by the conversion");

  audio.tick(100);
  assert.equal(player.queueIndex.value, 0, "no passage boundary stop after the conversion");
  audio.tick(203.99);
  audio.end();
  assert.equal(audio.src, "/api/bible-audio/cuvmpt-drama/REV/2/stream?token=tok-1");
});

test("verse and chapter stepping, playback rate and resume memory", async () => {
  const { audio, player, storage } = createHarness();
  player.startFromChapter("REV", 1, 5);
  audio.ready(204);
  audio.tick(44);
  assert.equal(player.currentVerse.value, 5);
  player.nextVerse();
  assert.equal(audio.currentTime, 54);
  assert.equal(player.currentVerse.value, 6);
  player.previousVerse();
  player.previousVerse();
  assert.equal(player.currentVerse.value, 4);

  player.nextChapter();
  assert.deepEqual(player.currentItem.value, { book: "REV", chapter: 2, verseStart: 0, verseEnd: null });
  player.previousChapter();
  assert.deepEqual(player.currentItem.value, { book: "REV", chapter: 1, verseStart: 0, verseEnd: null });
  assert.equal(player.canPreviousChapter.value, true);

  player.cycleRate();
  assert.equal(player.rate.value, 1.25);
  assert.equal(audio.playbackRate, 1.25);
  assert.equal(storage.get("team-chat-bible-audio-rate:7"), "1.25");

  audio.ready(204);
  audio.tick(64);
  assert.equal(player.toggle(), true);
  assert.equal(audio.paused, true);
  assert.deepEqual(JSON.parse(storage.get("team-chat-bible-audio-resume:7") || "null"), { versionId: "cuvmpt-drama", book: "REV", chapter: 1, verse: 7 });
  assert.deepEqual(player.resumeState.value, { versionId: "cuvmpt-drama", book: "REV", chapter: 1, verse: 7 });

  player.stop();
  assert.equal(player.active.value, false);
  assert.equal(player.resume(), true);
  assert.deepEqual(player.currentItem.value, { book: "REV", chapter: 1, verseStart: 0, verseEnd: null });
  assert.equal(player.currentVerse.value, 7);
  await nextTick();
  player.dispose();
  assert.equal(audio.src, "");
});
