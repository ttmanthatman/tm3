import { computed, ref } from "vue";
import type { FriendCategoryDTO, FriendPlaybackDTO, FriendProgramDTO, FriendSeriesDTO } from "../../../shared/types";
import { api, getToken } from "../../api";
import { musicFadeVolume } from "../../musicPlayer";

const FRIEND_FADE_MS = 900;
const FRIEND_PROGRESS_SAVE_MS = 10_000;
const FRIEND_RESUME_MIN_MS = 5_000;
const FRIEND_HISTORY_LIMIT = 20;

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
  /** 良友节目收听状态变化（用于上报“正在听”在场状态） */
  onListeningChanged?: (program: FriendProgramDTO | null) => void;
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
  const categories = ref<FriendCategoryDTO[]>([]);
  const categoriesLoading = ref(false);
  const categoriesError = ref("");
  const activeSeries = ref<FriendSeriesDTO | null>(null);
  const seriesPrograms = ref<FriendProgramDTO[]>([]);
  const seriesLoading = ref(false);
  const seriesError = ref("");
  const history = ref<FriendPlaybackDTO[]>([]);
  const historyLoading = ref(false);
  const historyError = ref("");
  const currentProgramId = ref<string | null>(null);
  const playing = ref(false);
  const loading = ref(false);
  const error = ref("");
  const progress = ref(0);

  const currentProgram = computed(() =>
    programs.value.find((program) => program.id === currentProgramId.value)
    || seriesPrograms.value.find((program) => program.id === currentProgramId.value)
    || null
  );

  let audio: HTMLAudioElement | null = null;
  let fadeFrame: number | undefined;
  let fadeTimer: number | undefined;
  let progressTimer: number | undefined;
  let disposed = false;

  function notifyListening(program: FriendProgramDTO | null) {
    options.onListeningChanged?.(program);
  }

  function upsertHistoryLocal(program: FriendProgramDTO, progressMs: number, durationMs: number) {
    const entry: FriendPlaybackDTO = {
      programId: program.id,
      seriesTitle: program.seriesTitle,
      title: program.title,
      audioUrl: program.audioUrl,
      imageUrl: program.imageUrl,
      progressMs,
      durationMs,
      playedAt: new Date().toISOString()
    };
    history.value = [entry, ...history.value.filter((item) => item.programId !== program.id)].slice(0, FRIEND_HISTORY_LIMIT);
  }

  function savePlaybackProgress() {
    const program = currentProgram.value;
    if (!program || !audio) return;
    const progressMs = Math.round((audio.currentTime || 0) * 1000);
    const durationMs = audio.duration && Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 0;
    upsertHistoryLocal(program, progressMs, durationMs);
    void request(`/api/friend/playback/${encodeURIComponent(program.id)}`, {
      method: "PUT",
      body: JSON.stringify({
        seriesTitle: program.seriesTitle,
        title: program.title,
        audioUrl: program.audioUrl,
        imageUrl: program.imageUrl ?? null,
        progressMs,
        durationMs
      })
    }).catch(() => undefined);
  }

  function stopProgressTimer() {
    if (progressTimer !== undefined) runtime.clearTimeout(progressTimer);
    progressTimer = undefined;
  }

  function scheduleProgressSave() {
    stopProgressTimer();
    progressTimer = runtime.setTimeout(() => {
      progressTimer = undefined;
      if (disposed || !playing.value) return;
      savePlaybackProgress();
      scheduleProgressSave();
    }, FRIEND_PROGRESS_SAVE_MS);
  }

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
    stopProgressTimer();
    savePlaybackProgress();
    playing.value = false;
    loading.value = false;
    progress.value = 1;
    notifyListening(null);
    options.onEnded?.();
  }

  function handleError() {
    if (disposed) return;
    clearFade();
    stopProgressTimer();
    playing.value = false;
    loading.value = false;
    error.value = "节目暂时无法播放";
    notifyListening(null);
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
      savePlaybackProgress();
      clearFade();
      targetAudio.src = streamUrl(program);
      targetAudio.dataset.programId = program.id;
      targetAudio.load();
      progress.value = 0;
      const saved = history.value.find((item) => item.programId === program.id);
      if (saved && saved.progressMs >= FRIEND_RESUME_MIN_MS
        && (!saved.durationMs || saved.progressMs < saved.durationMs * 0.95)) {
        targetAudio.currentTime = saved.progressMs / 1000;
      }
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
      notifyListening(program);
      savePlaybackProgress();
      scheduleProgressSave();
      if (fadeInVolume) fadeIn(targetAudio);
    } catch (playError) {
      if (disposed || targetAudio !== audio) return;
      loading.value = false;
      playing.value = false;
      error.value = playError instanceof Error && playError.name === "NotAllowedError"
        ? "请再次点击播放"
        : "节目暂时无法播放";
      notifyListening(null);
    }
  }

  /** 用户点击播放（最高优先级） */
  async function playProgram(program: FriendProgramDTO) {
    options.onUserPlay?.();
    await startPlayback(program, false);
  }

  /** 打开面板时在今日节目里随机挑一个播放；已在播放则不打扰 */
  async function playRandom() {
    if (playing.value && currentProgram.value) return;
    if (!programs.value.length) await loadPrograms();
    const pool = programs.value.filter((program) => program.id !== currentProgramId.value);
    if (!pool.length) return;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    await playProgram(pick);
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
    stopProgressTimer();
    savePlaybackProgress();
    fadeOutThenPause(audio);
    notifyListening(null);
    options.onUserPause?.();
  }

  /** 被协调器挂起：渐弱暂停，保留进度 */
  function duck() {
    if (!audio || audio.paused) return;
    playing.value = false;
    loading.value = false;
    stopProgressTimer();
    savePlaybackProgress();
    fadeOutThenPause(audio);
    notifyListening(null);
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

  async function loadCategories() {
    if (categoriesLoading.value) return;
    categoriesLoading.value = true;
    categoriesError.value = "";
    try {
      const result = await request<{ categories: FriendCategoryDTO[] }>("/api/friend/categories");
      categories.value = result.categories || [];
      if (!categories.value.length) categoriesError.value = "暂时没有节目分类";
    } catch {
      categoriesError.value = "节目分类暂时无法获取，请稍后重试";
    } finally {
      categoriesLoading.value = false;
    }
  }

  async function openSeries(series: FriendSeriesDTO) {
    if (seriesLoading.value) return;
    activeSeries.value = series;
    seriesPrograms.value = [];
    seriesLoading.value = true;
    seriesError.value = "";
    try {
      const result = await request<{ programs: FriendProgramDTO[] }>(`/api/friend/series/${encodeURIComponent(series.alias)}`);
      seriesPrograms.value = result.programs || [];
      if (!seriesPrograms.value.length) seriesError.value = "暂时没有节目";
    } catch {
      seriesError.value = "节目列表暂时无法获取，请稍后重试";
    } finally {
      seriesLoading.value = false;
    }
  }

  function closeSeries() {
    activeSeries.value = null;
    seriesPrograms.value = [];
    seriesError.value = "";
  }

  async function loadHistory() {
    if (historyLoading.value) return;
    historyLoading.value = true;
    historyError.value = "";
    try {
      const result = await request<{ history: FriendPlaybackDTO[] }>("/api/friend/history");
      history.value = result.history || [];
    } catch {
      historyError.value = "收听记录暂时无法获取，请稍后重试";
    } finally {
      historyLoading.value = false;
    }
  }

  /** 切换账号后清空收听记录（进度数据按账号隔离） */
  function resetHistory() {
    history.value = [];
    historyError.value = "";
  }

  function resolveMediaUrl(url?: string) {
    return url ? `${url}&token=${encodeURIComponent(getToken())}` : "";
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearFade();
    stopProgressTimer();
    savePlaybackProgress();
    notifyListening(null);
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
      categories,
      categoriesLoading,
      categoriesError,
      activeSeries,
      seriesPrograms,
      seriesLoading,
      seriesError,
      history,
      historyLoading,
      historyError,
      currentProgramId,
      currentProgram,
      playing,
      loading,
      error,
      progress
    },
    controls: {
      loadPrograms,
      loadCategories,
      openSeries,
      closeSeries,
      loadHistory,
      resetHistory,
      playProgram,
      playRandom,
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
