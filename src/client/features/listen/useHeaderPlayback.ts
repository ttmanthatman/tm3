import { computed, ref, watch } from "vue";
import type { MusicPlayer } from "../music/useMusicPlayer";
import type { FriendPlayer } from "../friend/useFriendPlayer";

export interface HeaderBiblePlayback {
  active: boolean;
  playing: boolean;
  canPreviousChapter: boolean;
  canNextChapter: boolean;
  toggle(): void;
  nextChapter(): void;
  previousChapter(): void;
}

export function useHeaderPlayback(options: {
  music: MusicPlayer;
  friend: FriendPlayer;
  bible: () => HeaderBiblePlayback | undefined;
  canShiftSession: (delta: number) => boolean | null;
  shiftSession: (delta: number) => boolean;
}) {
  const { music, friend } = options;
  const lastSource = ref<"music" | "friend" | "bible">("music");
  watch(() => [music.state.playing.value, friend.state.playing.value, options.bible()?.playing] as const, ([song, radio, bible]) => {
    if (bible) lastSource.value = "bible";
    else if (radio) lastSource.value = "friend";
    else if (song) lastSource.value = "music";
  }, { immediate: true, flush: "sync" });
  const source = computed(() => lastSource.value === "bible" && !options.bible()?.active ? "music" : lastSource.value);
  const playing = computed(() => music.state.playing.value || friend.state.playing.value || !!options.bible()?.playing);
  const available = computed(() => source.value === "bible" ? !!options.bible()?.active
    : source.value === "friend" ? !!friend.state.currentProgram.value : !!music.state.currentTrack.value);
  const title = computed(() => source.value === "bible" ? "有声圣经"
    : source.value === "friend" ? friend.state.currentProgram.value?.title || "良友电台" : music.state.currentTrack.value?.title || "暂无播放内容");
  function canShift(delta: number) {
    if (source.value !== "friend") {
      const session = options.canShiftSession(delta);
      if (session !== null) return session;
    }
    if (source.value === "bible") return delta < 0 ? !!options.bible()?.canPreviousChapter : !!options.bible()?.canNextChapter;
    return source.value === "friend" ? friend.state.canShiftProgram.value : music.state.playableTracks.value.length > 1;
  }
  function toggle() {
    if (!available.value) return;
    if (source.value === "bible") options.bible()?.toggle();
    else if (source.value === "friend") {
      const program = friend.state.currentProgram.value;
      if (program) friend.controls.toggleProgram(program);
    } else music.controls.togglePlayback();
  }
  function shift(delta: number) {
    if (!canShift(delta)) return;
    if (source.value !== "friend" && options.shiftSession(delta)) return;
    if (source.value === "bible") {
      if (delta < 0) options.bible()?.previousChapter();
      else options.bible()?.nextChapter();
    } else if (source.value === "friend") friend.controls.shiftProgram(delta);
    else void music.controls.shiftTrack(delta, true);
  }
  return { playing, available, title, canShift, toggle, shift };
}

export type HeaderPlayback = ReturnType<typeof useHeaderPlayback>;
