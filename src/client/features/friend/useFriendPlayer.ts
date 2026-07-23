import { computed, ref } from "vue";
import type { FriendProgramDTO } from "../../../shared/types";
import { api, getToken } from "../../api";
import { musicFadeVolume } from "../../musicPlayer";

const FRIEND_FADE_MS = 900;

type FriendPlayerRequest = <T>(path: string, options?: RequestInit) => Promise<T>;

export interface FriendPlayerRuntime {
  createAudio: () => HTMLAudioElement;
  now: () => number;
  setTimeout: (handler: () => void, delay: number) => number;
  clearTimeout: (timer: number) => void;
  requestAnimationFrame: (handler: FrameRequestCallback) => number;
  cancelAnimationFrame: (frame: number) => void;
}

export interface UseFriendPlayerOptions {
  request?: FriendPlayerRequest;
  runtime?: FriendPlayerRuntime;
  streamUrl?: (program: FriendProgramDTO) => string;
  /** 用户主动发起播放（拥有最高优先级，应挂起其他音频） */
  onUserPlay?: () => void;
  /** 用户主动暂停（不触发其他音频续播） */
  onUserPause?: () => void;
  /** 当前节目自然播完（可续播被挂起的音频） */
  onEnded?: () => void;
}

function browserRuntime(): FriendPlayerRuntime {
  return {
    createAudio: () => new Audio(),
    now: () => performance.now(),
    setTimeout: (handler, delay) => window.setTimeout(handler, delay),
    clearTimeout: (timer) => window.clearTimeout(timer),
    requestAnimationFrame: (handler) => window.requestAnimationFrame(handler),
    cancelAnimationFrame: (frame) => window.cancelAnimationFrame(frame)
  };
}

export function useFriendPlayer(options: UseFriendPlayerOptions = {}) {
  const request = options.request || api;
  const runtime = options.runtime || browserRuntime();
  const streamUrl = options.streamUrl || ((program: FriendProgramDTO) =>
    `${program.audioUrl}&token=${encodeURIComponent(getToken())}`);

  const programs = ref<FriendProgramDTO[]>([]);
  const listLoading = ref(false);
  const listError = ref("");
  const currentProgramId = ref<string | null>(null);
  const playing = ref(false);
  const loading = ref(false);
  const error = ref("");
  const progress = ref(0);

  const currentProgram = computed(() =>
    programs.value.find((program) => program.id === currentProgramId.value) || null
  );

  let audio: HTMLAudioElement | null = null;
  let fadeFrame: number | undefined;
  let fadeTimer: number | undefined;
  let disposed = false;

  function clearFade(resetVolume = true) {
    if (fadeFrame !== undefined) runtime.cancelAnimationFrame(fadeFrame);
    if (fadeTimer !== undefined) runtime.clearTimeout(fadeTimer);
    fadeFrame = undefined;
    fadeTimer = undefined;
    if (resetVolume && audio) audio.volume = 1;
  }

  function fadeOutThenPause(targetAudio: HTMLAudioElement) {
    clearFade();
    if (targetAudio.paused) {
      targetAudio.pause();
      targetAudio.volume = 1;
      return;
    }
    const startedAt = runtime.now();
    const animate = (now: number) => {
      if (targetAudio !== audio || disposed) return;
      targetAudio.volume = musicFadeVolume((now - startedAt) / FRIEND_FADE_MS);
      if (targetAudio.volume > 0) fadeFrame = runtime.requestAnimationFrame(animate);
    };
    const finish = () => {
      if (targetAudio !== audio || disposed) return;
      clearFade(false);
      targetAudio.volume = 0;
      targetAudio.pause();
      targetAudio.volume = 1;
    };
    fadeFrame = runtime.requestAnimationFrame(animate);
    fadeTimer = runtime.setTimeout(finish, FRIEND_FADE_MS);
  }

  function fadeIn(targetAudio: HTMLAudioElement) {
    const startedAt = runtime.now();
    const animate = (now: number) => {
      if (targetAudio !== audio || disposed) return;
      targetAudio.volume = 1 - musicFadeVolume((now - startedAt) / FRIEND_FADE_MS);
      if (targetAudio.volume < 1) fadeFrame = runtime.requestAnimationFrame(animate);
    };
    fadeFrame = runtime.requestAnimationFrame(animate);
    fadeTimer = runtime.setTimeout(() => {
      if (targetAudio !== audio || disposed) return;
      clearFade(false);
      targetAudio.volume = 1;
    }, FRIEND_FADE_MS);
  }

  function handlePlay() {
    if (disposed) return;
    playing.value = true;
    loading.value = false;
    error.value = "";
  }

  function handlePause() {
    if (disposed) return;
    playing.value = false;
    loading.value = false;
  }

  function handleEnded() {
    if (disposed) return;
    clearFade();
    playing.value = false;
    loading.value = false;
    progress.value = 1;
    options.onEnded?.();
  }

  function handleError() {
    if (disposed) return;
    clearFade();
    playing.value = false;
    loading.value = false;
    error.value = "节目暂时无法播放";
  }

  function handleTimeUpdate() {
    if (disposed || !audio?.duration || !Number.isFinite(audio.duration)) return;
    progress.value = Math.min(1, Math.max(0, audio.currentTime / audio.duration));
  }

  function initializeAudio() {
    if (audio || disposed) return;
    audio = runtime.createAudio();
    audio.preload = "metadata";
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("error", handleError);
    audio.addEventListener("waiting", () => {
      if (!disposed) loading.value = true;
    });
    audio.addEventListener("canplay", () => {
      if (!disposed) loading.value = false;
    });
    audio.addEventListener("timeupdate", handleTimeUpdate);
  }

  async function startPlayback(program: FriendProgramDTO, fadeInVolume: boolean) {
    initializeAudio();
    if (!audio) return;
    const targetAudio = audio;
    if (targetAudio.dataset.programId !== program.id) {
      clearFade();
      targetAudio.src = streamUrl(program);
      targetAudio.dataset.programId = program.id;
      targetAudio.load();
      progress.value = 0;
    }
    currentProgramId.value = program.id;
    clearFade();
    targetAudio.volume = fadeInVolume ? 0 : 1;
    loading.value = true;
    error.value = "";
    try {
      await targetAudio.play();
      if (disposed || targetAudio !== audio || currentProgramId.value !== program.id) {
        targetAudio.pause();
        return;
      }
      playing.value = true;
      loading.value = false;
      if (fadeInVolume) fadeIn(targetAudio);
    } catch (playError) {
      if (disposed || targetAudio !== audio) return;
      loading.value = false;
      playing.value = false;
      error.value = playError instanceof Error && playError.name === "NotAllowedError"
        ? "请再次点击播放"
        : "节目暂时无法播放";
    }
  }

  /** 用户点击播放（最高优先级） */
  async function playProgram(program: FriendProgramDTO) {
    options.onUserPlay?.();
    await startPlayback(program, false);
  }

  function toggleProgram(program: FriendProgramDTO) {
    if (currentProgramId.value === program.id && playing.value) {
      pause();
      return;
    }
    if (currentProgramId.value === program.id && audio && !audio.ended) {
      options.onUserPlay?.();
      void startPlayback(program, false);
      return;
    }
    void playProgram(program);
  }

  /** 用户主动暂停：渐弱，不触发其他音频续播 */
  function pause() {
    if (!audio) return;
    playing.value = false;
    loading.value = false;
    fadeOutThenPause(audio);
    options.onUserPause?.();
  }

  /** 被协调器挂起：渐弱暂停，保留进度 */
  function duck() {
    if (!audio || audio.paused) return;
    playing.value = false;
    loading.value = false;
    fadeOutThenPause(audio);
  }

  /** 被协调器恢复：渐强续播 */
  async function resumeWithFade() {
    const program = currentProgram.value;
    if (!program || !audio || !audio.paused || audio.ended) return;
    await startPlayback(program, true);
  }

  async function loadPrograms() {
    if (listLoading.value) return;
    listLoading.value = true;
    listError.value = "";
    try {
      const result = await request<{ programs: FriendProgramDTO[] }>("/api/friend/programs");
      programs.value = result.programs || [];
      if (!programs.value.length) listError.value = "暂时没有节目";
    } catch {
      listError.value = "节目单暂时无法获取，请稍后重试";
    } finally {
      listLoading.value = false;
    }
  }

  function resolveMediaUrl(url?: string) {
    return url ? `${url}&token=${encodeURIComponent(getToken())}` : "";
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearFade();
    if (audio) {
      const targetAudio = audio;
      targetAudio.pause();
      targetAudio.removeAttribute("src");
      targetAudio.load();
      audio = null;
    }
    playing.value = false;
    loading.value = false;
  }

  return {
    state: {
      programs,
      listLoading,
      listError,
      currentProgramId,
      currentProgram,
      playing,
      loading,
      error,
      progress
    },
    controls: {
      loadPrograms,
      playProgram,
      toggleProgram,
      pause,
      duck,
      resumeWithFade,
      resolveMediaUrl,
      dispose
    }
  };
}

export type FriendPlayer = ReturnType<typeof useFriendPlayer>;
