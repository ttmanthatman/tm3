import { computed, ref, shallowRef, watch } from "vue";
import type { BibleAudioVersionManifest } from "@shared/bibleAudio";
import type { BibleBookCatalogDTO, BibleLookupDTO } from "@shared/types";
import { getToken } from "../../api";
import {
  BIBLE_AUDIO_RATES,
  bibleAudioChapterKey,
  bibleAudioItemBounds,
  bibleAudioResumeStorageKey,
  bibleAudioStreamPath,
  bibleAudioVerseAtTime,
  bibleAudioVerseTimestamp,
  indexBibleAudioChapters,
  nextBibleAudioRate,
  nextBibleChapterLocation,
  parseBibleAudioResume,
  previousBibleChapterLocation,
  queueFromChapter,
  queueFromLookups,
  type BibleAudioChapterMap,
  type BibleAudioPlayItem,
  type BibleAudioResumeState
} from "./bibleAudioQueue";

// 有声圣经播放器：单个 <audio> 元素驾驭一个播放队列。
// - continuous（整章）模式：章尾自动续下一章，REV 22 之后停止；
// - selection（选集 / 消息引用）模式：逐段播放，段尾跳到下一段起点（跨章则换源），全部播完停止。
// 队列构建与时间戳定位的纯逻辑在 bibleAudioQueue.ts；这里只管状态机与 DOM 音频。

export type BibleAudioPlayMode = "continuous" | "selection";

export interface BibleAudioPlayerRuntime {
  createAudio: () => HTMLAudioElement;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  token: () => string;
}

export interface UseBibleAudioPlayerOptions {
  accountId: () => number;
  books: () => BibleBookCatalogDTO[];
  version: () => BibleAudioVersionManifest | null;
  onToast?: (message: string) => void;
  /** 队列自然播完（选集最后一段结束 / 连播到正典末尾）时触发；用户主动 stop 不触发。 */
  onQueueEnded?: () => void;
  runtime?: BibleAudioPlayerRuntime;
}

const RESUME_SAVE_INTERVAL_MS = 5_000;
const SEGMENT_END_TOLERANCE_MS = 40;
const MAX_SKIPPED_CHAPTERS = 1200;

function browserRuntime(): BibleAudioPlayerRuntime {
  return {
    createAudio: () => new Audio(),
    storage: localStorage,
    token: getToken
  };
}

function rateStorageKey(accountId: number) {
  return `team-chat-bible-audio-rate:${accountId}`;
}

export function useBibleAudioPlayer(options: UseBibleAudioPlayerOptions) {
  const runtime = options.runtime || browserRuntime();

  const queue = shallowRef<BibleAudioPlayItem[]>([]);
  const queueIndex = ref(-1);
  const mode = ref<BibleAudioPlayMode>("continuous");
  const playing = ref(false);
  const loading = ref(false);
  const error = ref("");
  const positionMs = ref(0);
  const currentVerse = ref<number | null>(null);
  const rate = ref(1);
  const resumeState = ref<BibleAudioResumeState | null>(null);

  let audio: HTMLAudioElement | null = null;
  let currentSourceKey = "";
  let pendingSeekMs: number | null = null;
  let segmentEndMs: number | null = null;
  let playbackIntended = false;
  let lastResumeSavedAt = 0;
  let skippedChapters = 0;
  let disposed = false;
  let detachAudio: (() => void) | null = null;

  const chapterMap = computed<BibleAudioChapterMap>(() => {
    const version = options.version();
    return version ? indexBibleAudioChapters(version) : new Map();
  });
  const currentItem = computed(() => queue.value[queueIndex.value] || null);
  const currentChapter = computed(() => {
    const item = currentItem.value;
    return item ? chapterMap.value.get(bibleAudioChapterKey(item.book, item.chapter)) || null : null;
  });
  const active = computed(() => currentItem.value !== null);
  const durationMs = computed(() => currentChapter.value?.durationMs || 0);
  const playingVerseKey = computed(() => {
    const item = currentItem.value;
    if (!item || currentVerse.value === null || currentVerse.value <= 0) return null;
    return `${item.book}-${item.chapter}-${currentVerse.value}`;
  });
  const currentBookName = computed(() => (currentItem.value ? bookName(currentItem.value.book) : ""));
  const currentReference = computed(() => {
    const item = currentItem.value;
    if (!item) return "";
    const verse = currentVerse.value;
    return verse === null || verse <= 0 ? `${currentBookName.value} ${item.chapter} · 引言` : `${currentBookName.value} ${item.chapter}:${verse}`;
  });
  const canPreviousChapter = computed(() => {
    const item = currentItem.value;
    if (!item) return false;
    return mode.value === "selection" ? queueIndex.value > 0 : previousBibleChapterLocation(options.books(), item.book, item.chapter) !== null;
  });
  const canNextChapter = computed(() => {
    const item = currentItem.value;
    if (!item) return false;
    return mode.value === "selection" ? queueIndex.value < queue.value.length - 1 : nextBibleChapterLocation(options.books(), item.book, item.chapter) !== null;
  });

  function bookName(code: string) {
    return options.books().find((book) => book.code === code)?.name || code;
  }

  function toast(message: string) {
    options.onToast?.(message);
  }

  function loadPersisted(accountId: number) {
    resumeState.value = parseBibleAudioResume(runtime.storage.getItem(bibleAudioResumeStorageKey(accountId)));
    const storedRate = Number(runtime.storage.getItem(rateStorageKey(accountId)));
    rate.value = BIBLE_AUDIO_RATES.find((preset) => Math.abs(preset - storedRate) < 0.001) || 1;
    if (audio) audio.playbackRate = rate.value;
  }

  watch(options.accountId, loadPersisted, { immediate: true });

  function saveResume(force = false) {
    const item = currentItem.value;
    const version = options.version();
    if (!item || !version) return;
    const now = Date.now();
    if (!force && now - lastResumeSavedAt < RESUME_SAVE_INTERVAL_MS) return;
    lastResumeSavedAt = now;
    const state: BibleAudioResumeState = { versionId: version.versionId, book: item.book, chapter: item.chapter, verse: currentVerse.value ?? 0 };
    resumeState.value = state;
    runtime.storage.setItem(bibleAudioResumeStorageKey(options.accountId()), JSON.stringify(state));
  }

  function ensureAudio() {
    if (audio) return audio;
    const element = runtime.createAudio();
    element.preload = "auto";
    element.playbackRate = rate.value;
    const onTimeUpdate = () => handleTimeUpdate(element);
    const onEnded = () => advance(queueIndex.value);
    const onLoadedMetadata = () => {
      loading.value = false;
      if (pendingSeekMs !== null) {
        element.currentTime = pendingSeekMs / 1000;
        pendingSeekMs = null;
      }
    };
    const onPlay = () => {
      playing.value = true;
      error.value = "";
    };
    const onPause = () => {
      playing.value = false;
      saveResume(true);
    };
    const onWaiting = () => {
      loading.value = true;
    };
    const onPlaying = () => {
      loading.value = false;
    };
    const onError = () => {
      loading.value = false;
      const item = currentItem.value;
      if (!item) return;
      error.value = "音频加载失败";
      toast(`${bookName(item.book)} ${item.chapter} 音频加载失败，已跳过`);
      advance(queueIndex.value);
    };
    element.addEventListener("timeupdate", onTimeUpdate);
    element.addEventListener("ended", onEnded);
    element.addEventListener("loadedmetadata", onLoadedMetadata);
    element.addEventListener("play", onPlay);
    element.addEventListener("pause", onPause);
    element.addEventListener("waiting", onWaiting);
    element.addEventListener("playing", onPlaying);
    element.addEventListener("error", onError);
    detachAudio = () => {
      element.removeEventListener("timeupdate", onTimeUpdate);
      element.removeEventListener("ended", onEnded);
      element.removeEventListener("loadedmetadata", onLoadedMetadata);
      element.removeEventListener("play", onPlay);
      element.removeEventListener("pause", onPause);
      element.removeEventListener("waiting", onWaiting);
      element.removeEventListener("playing", onPlaying);
      element.removeEventListener("error", onError);
    };
    audio = element;
    return element;
  }

  function handleTimeUpdate(element: HTMLAudioElement) {
    if (pendingSeekMs !== null) return;
    const chapter = currentChapter.value;
    positionMs.value = Math.max(0, Math.round(element.currentTime * 1000));
    currentVerse.value = chapter ? bibleAudioVerseAtTime(chapter.verses, positionMs.value)?.verse ?? null : null;
    saveResume();
    if (segmentEndMs !== null && positionMs.value >= segmentEndMs - SEGMENT_END_TOLERANCE_MS) advance(queueIndex.value);
  }

  function streamUrl(item: BibleAudioPlayItem) {
    const version = options.version();
    const token = runtime.token();
    return `${bibleAudioStreamPath(version?.versionId || "", item.book, item.chapter)}${token ? `?token=${encodeURIComponent(token)}` : ""}`;
  }

  function finish() {
    playbackIntended = false;
    segmentEndMs = null;
    pendingSeekMs = null;
    if (audio) audio.pause();
    playing.value = false;
    loading.value = false;
    queue.value = [];
    queueIndex.value = -1;
    currentVerse.value = null;
    positionMs.value = 0;
  }

  function loadItem(index: number, startVerse?: number, autoplay = true) {
    if (disposed) return;
    const item = queue.value[index];
    if (!item) {
      finish();
      return;
    }
    const chapter = chapterMap.value.get(bibleAudioChapterKey(item.book, item.chapter));
    if (!chapter) {
      toast(`${bookName(item.book)} ${item.chapter} 音频缺失，已跳过`);
      queueIndex.value = index;
      skip(index);
      return;
    }
    const bounds = bibleAudioItemBounds(chapter, startVerse === undefined ? item : { ...item, verseStart: startVerse });
    if (bounds.endMs <= bounds.startMs) {
      queueIndex.value = index;
      skip(index);
      return;
    }
    skippedChapters = 0;
    queueIndex.value = index;
    segmentEndMs = item.verseEnd === null ? null : bounds.endMs;
    const element = ensureAudio();
    const sourceKey = bibleAudioChapterKey(item.book, item.chapter);
    error.value = "";
    if (currentSourceKey !== sourceKey) {
      currentSourceKey = sourceKey;
      pendingSeekMs = bounds.startMs;
      loading.value = true;
      element.src = streamUrl(item);
      element.load();
    } else {
      pendingSeekMs = null;
      element.currentTime = bounds.startMs / 1000;
    }
    positionMs.value = bounds.startMs;
    currentVerse.value = bibleAudioVerseAtTime(chapter.verses, bounds.startMs)?.verse ?? null;
    playbackIntended = autoplay;
    if (autoplay) {
      void element.play().catch(() => {
        playing.value = false;
        loading.value = false;
        error.value = "浏览器阻止了自动播放，请再点一次播放";
      });
    }
  }

  function skip(fromIndex: number) {
    skippedChapters += 1;
    if (skippedChapters > MAX_SKIPPED_CHAPTERS) {
      finish();
      return;
    }
    advance(fromIndex);
  }

  /** 当前段播完：选集模式进入下一段；整章模式续下一章，正典末尾停止。 */
  function advance(fromIndex: number) {
    if (disposed) return;
    const item = queue.value[fromIndex];
    if (!item) {
      finish();
      return;
    }
    if (mode.value === "selection") {
      if (fromIndex + 1 < queue.value.length) loadItem(fromIndex + 1, undefined, playbackIntended);
      else endQueue();
      return;
    }
    const next = nextBibleChapterLocation(options.books(), item.book, item.chapter);
    if (!next) {
      endQueue();
      return;
    }
    queue.value = queueFromChapter(next.book, next.chapter);
    loadItem(0, undefined, playbackIntended);
  }

  function endQueue() {
    finish();
    options.onQueueEnded?.();
  }

  function startFromChapter(book: string, chapter: number, verse = 0) {
    mode.value = "continuous";
    queue.value = queueFromChapter(book, chapter);
    loadItem(0, verse);
  }

  /** 选集模式起播一组已切好的段（消息 /听 清单等由调用方构建）。 */
  function startFromItems(items: BibleAudioPlayItem[]) {
    if (!items.length) {
      toast("没有可播放的经文");
      return false;
    }
    mode.value = "selection";
    queue.value = items;
    loadItem(0);
    return true;
  }

  function startFromLookups(lookups: BibleLookupDTO[]) {
    return startFromItems(queueFromLookups(lookups, options.books()));
  }

  /** 长按「连播到底」起播：定位到选集首节，但按整章连播（不受选集终点约束）。 */
  function startFromLookupsThrough(lookups: BibleLookupDTO[]) {
    const first = queueFromLookups(lookups, options.books())[0];
    if (!first) {
      toast("没有可播放的经文");
      return false;
    }
    mode.value = "continuous";
    queue.value = queueFromChapter(first.book, first.chapter);
    loadItem(0, first.verseStart);
    return true;
  }

  /** 进行中的选集会话当场转为整章连播（长按开启「连播到底」时调用）。 */
  function continueAll() {
    const item = currentItem.value;
    if (!item || mode.value !== "selection") return;
    mode.value = "continuous";
    queue.value = queueFromChapter(item.book, item.chapter);
    queueIndex.value = 0;
    segmentEndMs = null;
  }

  function resume() {
    const state = resumeState.value;
    const version = options.version();
    if (!state || !version || state.versionId !== version.versionId) return false;
    startFromChapter(state.book, state.chapter, state.verse);
    return true;
  }

  function play() {
    if (!audio || !currentItem.value) return;
    playbackIntended = true;
    void audio.play().catch(() => {
      playing.value = false;
      error.value = "播放失败，请重试";
    });
  }

  function pause() {
    playbackIntended = false;
    audio?.pause();
  }

  function toggle() {
    if (!currentItem.value) return false;
    if (playing.value) pause();
    else play();
    return true;
  }

  function stop() {
    saveResume(true);
    finish();
  }

  /** 选集模式下跳出当前段 → 转为从该处起的整章连播（prs.app 同款：点哪节播哪节）。 */
  function releaseSegmentIfOutside(targetMs: number) {
    const item = currentItem.value;
    const chapter = currentChapter.value;
    if (!item || !chapter || mode.value !== "selection") return;
    const bounds = bibleAudioItemBounds(chapter, item);
    if (targetMs >= bounds.startMs && targetMs < bounds.endMs) return;
    mode.value = "continuous";
    queue.value = queueFromChapter(item.book, item.chapter);
    queueIndex.value = 0;
    segmentEndMs = null;
  }

  function seekChapterMs(targetMs: number) {
    const chapter = currentChapter.value;
    if (!audio || !chapter) return;
    const clamped = Math.max(0, Math.min(targetMs, chapter.durationMs));
    releaseSegmentIfOutside(clamped);
    if (pendingSeekMs !== null) pendingSeekMs = clamped;
    else audio.currentTime = clamped / 1000;
    positionMs.value = clamped;
    currentVerse.value = bibleAudioVerseAtTime(chapter.verses, clamped)?.verse ?? null;
  }

  function seekToVerse(book: string, chapter: number, verse: number) {
    const item = currentItem.value;
    const code = book.toUpperCase();
    if (!item || item.book !== code || item.chapter !== chapter) {
      startFromChapter(code, chapter, verse);
      return;
    }
    const timestamp = currentChapter.value ? bibleAudioVerseTimestamp(currentChapter.value.verses, verse) : null;
    if (!timestamp) return;
    seekChapterMs(timestamp.startMs);
  }

  function stepVerse(direction: 1 | -1) {
    const chapter = currentChapter.value;
    const item = currentItem.value;
    if (!chapter || !item) return;
    const verses = chapter.verses;
    const index = verses.findIndex((entry) => entry.verse === currentVerse.value);
    const target = verses[(index < 0 ? 0 : index) + direction];
    if (target) {
      seekChapterMs(target.startMs);
      return;
    }
    if (direction > 0) nextChapter();
    else previousChapter();
  }

  function nextVerse() {
    stepVerse(1);
  }

  function previousVerse() {
    stepVerse(-1);
  }

  function nextChapter() {
    const item = currentItem.value;
    if (!item) return;
    if (mode.value === "selection") {
      if (queueIndex.value + 1 < queue.value.length) loadItem(queueIndex.value + 1, undefined, playbackIntended || playing.value);
      return;
    }
    const next = nextBibleChapterLocation(options.books(), item.book, item.chapter);
    if (!next) return;
    queue.value = queueFromChapter(next.book, next.chapter);
    loadItem(0, undefined, playbackIntended || playing.value);
  }

  function previousChapter() {
    const item = currentItem.value;
    if (!item) return;
    if (mode.value === "selection") {
      if (queueIndex.value > 0) loadItem(queueIndex.value - 1, undefined, playbackIntended || playing.value);
      return;
    }
    const previous = previousBibleChapterLocation(options.books(), item.book, item.chapter);
    if (!previous) return;
    queue.value = queueFromChapter(previous.book, previous.chapter);
    loadItem(0, undefined, playbackIntended || playing.value);
  }

  function setRate(value: number) {
    rate.value = value;
    if (audio) audio.playbackRate = value;
    runtime.storage.setItem(rateStorageKey(options.accountId()), String(value));
  }

  function cycleRate() {
    setRate(nextBibleAudioRate(rate.value));
  }

  function dispose() {
    disposed = true;
    finish();
    detachAudio?.();
    detachAudio = null;
    if (audio) {
      audio.removeAttribute("src");
      audio.load();
    }
    audio = null;
  }

  return {
    queue,
    queueIndex,
    mode,
    playing,
    loading,
    error,
    active,
    positionMs,
    durationMs,
    currentVerse,
    currentItem,
    currentChapter,
    currentBookName,
    currentReference,
    playingVerseKey,
    rate,
    resumeState,
    canPreviousChapter,
    canNextChapter,
    startFromChapter,
    startFromItems,
    startFromLookups,
    startFromLookupsThrough,
    continueAll,
    resume,
    play,
    pause,
    toggle,
    stop,
    seekChapterMs,
    seekToVerse,
    nextVerse,
    previousVerse,
    nextChapter,
    previousChapter,
    setRate,
    cycleRate,
    dispose
  };
}

export type BibleAudioPlayer = ReturnType<typeof useBibleAudioPlayer>;
