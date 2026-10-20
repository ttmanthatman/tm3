import { computed, ref, shallowRef, watch } from "vue";
import type { ListenPlaylistItem } from "@shared/listenPlaylist";
import { queueFromPassage, type BibleAudioPlayItem } from "../bible/bibleAudioQueue";

// 「/听」清单播放会话：按顺序把经文段交给有声圣经播放器、歌曲交给音乐播放器，
// 一项自然播完就接着下一项；两边播放器各自保持原有职责，这里只做编排与状态汇总。
// 用户在别处主动停掉圣经朗读或切了别的歌，会话随之结束（卡片回到未播放态）。

export type ListenSessionPhase = "scripture" | "track";

export interface ListenBibleAdapter {
  active: () => boolean;
  playing: () => boolean;
  currentVerse: () => number | null;
  currentChapter: () => number | null;
  canPreviousChapter: () => boolean;
  canNextChapter: () => boolean;
  playItems: (items: BibleAudioPlayItem[]) => Promise<boolean>;
  /** 经文起播失败时给用户的解释（如「有声圣经暂未开放」）；返回 null 用默认文案 */
  unavailableMessage?: () => string | null;
  toggle: () => void;
  stop: () => void;
  nextVerse: () => void;
  previousVerse: () => void;
  nextChapter: () => void;
  previousChapter: () => void;
}

export interface ListenMusicAdapter<Track extends { id: number }> {
  currentTrackId: () => number | null;
  playing: () => boolean;
  ensureTracks: () => Promise<void>;
  findTrack: (trackId: number) => Track | null;
  playTrack: (track: Track) => void;
  pause: () => void;
  toggle: () => void;
}

export interface UseListenSessionOptions<Track extends { id: number }> {
  bible: ListenBibleAdapter;
  music: ListenMusicAdapter<Track>;
  onUnavailable?: (message: string) => void;
}

export type ListenSessionSnapshot = {
  messageId: number;
  index: number;
  phase: ListenSessionPhase;
  playing: boolean;
  verse: number | null;
  chapter: number | null;
};

export function useListenSession<Track extends { id: number }>(options: UseListenSessionOptions<Track>) {
  const messageId = ref<number | null>(null);
  const items = shallowRef<ListenPlaylistItem[]>([]);
  const index = ref(-1);
  const phase = ref<ListenSessionPhase | null>(null);
  let transitioning = false;
  let expectedTrackId: number | null = null;
  let generation = 0;

  const current = computed<ListenSessionSnapshot | null>(() => {
    if (messageId.value === null || phase.value === null) return null;
    const scripture = phase.value === "scripture";
    return {
      messageId: messageId.value,
      index: index.value,
      phase: phase.value,
      playing: scripture ? options.bible.playing() : options.music.playing(),
      verse: scripture ? options.bible.currentVerse() : null,
      chapter: scripture ? options.bible.currentChapter() : null
    };
  });

  function clear() {
    generation += 1;
    messageId.value = null;
    items.value = [];
    index.value = -1;
    phase.value = null;
    expectedTrackId = null;
    transitioning = false;
  }

  function isCurrentMessage(id: number) {
    return messageId.value === id;
  }

  async function playIndex(target: number, failures = 0): Promise<void> {
    const item = items.value[target];
    if (!item) {
      clear();
      return;
    }
    if (failures >= items.value.length) {
      clear();
      return;
    }
    const myGeneration = generation;
    transitioning = true;
    index.value = target;
    try {
      if (item.kind === "scripture") {
        phase.value = "scripture";
        expectedTrackId = null;
        if (options.music.playing()) options.music.pause();
        const started = await options.bible.playItems(queueFromPassage(item));
        if (myGeneration !== generation) return;
        if (!started) {
          // 一串连续失败只提示一次（有声圣经未开放时清单里每段经文都会失败）
          if (failures === 0) options.onUnavailable?.(options.bible.unavailableMessage?.() || `《${item.reference}》暂时无法朗读，已跳过`);
          await playIndex(target + 1, failures + 1);
          return;
        }
      } else {
        phase.value = "track";
        if (options.bible.active()) options.bible.stop();
        await options.music.ensureTracks();
        if (myGeneration !== generation) return;
        const track = options.music.findTrack(item.trackId);
        if (!track) {
          options.onUnavailable?.(`《${item.title}》已被删除或暂时不可用`);
          await playIndex(target + 1, failures + 1);
          return;
        }
        expectedTrackId = track.id;
        options.music.playTrack(track);
      }
    } finally {
      if (myGeneration === generation) transitioning = false;
    }
  }

  function start(id: number, list: ListenPlaylistItem[], startIndex = 0) {
    if (!list.length) return;
    clear();
    messageId.value = id;
    items.value = list;
    void playIndex(Math.max(0, Math.min(startIndex, list.length - 1)));
  }

  function advance() {
    if (messageId.value === null) return;
    if (index.value + 1 < items.value.length) void playIndex(index.value + 1);
    else clear();
  }

  /** 有声圣经队列自然播完（BibleWorkspace `audio-queue-ended`）。 */
  function handleBibleQueueEnded() {
    if (phase.value !== "scripture" || transitioning) return;
    advance();
  }

  /** 音乐播放器曲目播完：是本会话的歌就接管续播，返回 true 让曲库跳过自己的循环逻辑。 */
  function handleTrackEnded() {
    if (phase.value !== "track" || transitioning) return false;
    if (options.music.currentTrackId() !== expectedTrackId) return false;
    advance();
    return true;
  }

  function toggle(id: number, list: ListenPlaylistItem[]) {
    if (!isCurrentMessage(id) || phase.value === null) {
      start(id, list, 0);
      return;
    }
    if (phase.value === "scripture") options.bible.toggle();
    else options.music.toggle();
  }

  function playItem(id: number, list: ListenPlaylistItem[], itemIndex: number) {
    if (isCurrentMessage(id) && index.value === itemIndex && phase.value !== null) {
      toggle(id, list);
      return;
    }
    start(id, list, itemIndex);
  }

  function stop() {
    if (phase.value === "scripture" && options.bible.active()) options.bible.stop();
    if (phase.value === "track" && options.music.playing()) options.music.pause();
    clear();
  }

  function nextVerse() {
    if (phase.value === "scripture") options.bible.nextVerse();
  }

  function previousVerse() {
    if (phase.value === "scripture") options.bible.previousVerse();
  }

  /** 经文段跨章时先在段内翻章，否则切到清单里的上一项/下一项。 */
  function nextChapter() {
    if (phase.value === null) return;
    if (phase.value === "scripture" && options.bible.canNextChapter()) {
      options.bible.nextChapter();
      return;
    }
    if (index.value + 1 < items.value.length) void playIndex(index.value + 1);
  }

  function previousChapter() {
    if (phase.value === null) return;
    if (phase.value === "scripture" && options.bible.canPreviousChapter()) {
      options.bible.previousChapter();
      return;
    }
    if (index.value > 0) void playIndex(index.value - 1);
  }

  // 用户在提词器/工作区里主动收起朗读会话 → 清单会话结束（自然播完走 handleBibleQueueEnded）
  watch(() => options.bible.active(), (active) => {
    if (!active && phase.value === "scripture" && !transitioning) clear();
  });

  // 用户在曲库里换了别的歌 → 清单会话结束
  watch(() => options.music.currentTrackId(), (trackId) => {
    if (phase.value === "track" && !transitioning && trackId !== expectedTrackId) clear();
  });

  return {
    current,
    isCurrentMessage,
    start,
    toggle,
    playItem,
    stop,
    nextVerse,
    previousVerse,
    nextChapter,
    previousChapter,
    handleBibleQueueEnded,
    handleTrackEnded
  };
}

export type ListenSession = ReturnType<typeof useListenSession>;
