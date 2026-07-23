import { computed, ref, watch, type ComputedRef, type Ref } from "vue";
import type {
  MusicPlaybackStateDTO,
  MusicPlaylistDTO,
  MusicPlaylistSourceKind,
  MusicTrackDTO
} from "@shared/types";
import { APP_VERSION } from "@shared/release";
import { creditedMusicListenMs, isQualifiedMusicPlay } from "@shared/musicPlayback";
import { shouldWriteMusicProgress, type MusicProgressState } from "@shared/activityLog";
import { api, getToken } from "../../api";
import { randomId } from "../../randomId";
import {
  bindMusicMediaSession,
  musicFadeVolume,
  nextMusicTrackIndexForMode,
  pushMusicPlaybackHistory,
  shouldAdvanceMusic,
  shouldRestartOnlyTrack,
  shouldRepeatCurrentMusic,
  syncMusicMediaSession,
  takePreviousMusicTrack,
  type MusicPlaybackMode
} from "../../musicPlayer";

const MUSIC_FADE_OUT_MS = 900;
const MUSIC_STATE_SYNC_INTERVAL_MS = 15_000;

type MusicPlayerRequest = <T>(path: string, options?: RequestInit) => Promise<T>;

type MusicMediaSession = Parameters<typeof bindMusicMediaSession>[0] & {
  playbackState: "none" | "paused" | "playing";
  metadata: MediaMetadata | null;
};

export interface MusicPlayerRuntime {
  createAudio: () => HTMLAudioElement;
  storage: Pick<Storage, "getItem" | "setItem">;
  now: () => number;
  random: () => number;
  randomUUID: () => string;
  setInterval: (handler: () => void, delay: number) => number;
  clearInterval: (timer: number) => void;
  setTimeout: (handler: () => void, delay: number) => number;
  clearTimeout: (timer: number) => void;
  requestAnimationFrame: (handler: FrameRequestCallback) => number;
  cancelAnimationFrame: (frame: number) => void;
  mediaSession: MusicMediaSession | null;
  createMediaMetadata: ((metadata: MediaMetadataInit) => MediaMetadata) | null;
  listenPageHide: (handler: () => void) => () => void;
  listenVisibilityChange: (handler: () => void) => () => void;
  documentVisible: () => boolean;
}

interface UseMusicPlayerOptions {
  tracks: Ref<MusicTrackDTO[]>;
  libraryTracks: ComputedRef<MusicTrackDTO[]>;
  favoriteTracks: ComputedRef<MusicTrackDTO[]>;
  playlists: Ref<MusicPlaylistDTO[]>;
  selectedSourceKind: Ref<MusicPlaylistSourceKind>;
  selectedPlaylistId: Ref<number | null>;
  scoreOpen: Ref<boolean>;
  request?: MusicPlayerRequest;
  runtime?: MusicPlayerRuntime;
  streamUrl?: (track: MusicTrackDTO) => string;
  primeTrackCache?: (track: MusicTrackDTO) => Promise<void>;
  onCurrentTrackChanged?: () => void;
  onListeningChanged?: () => void;
  onHeatChanged?: (trackId: number, heat: number) => void;
  /** 每次实际发起播放（用户点选、切换、自动续播都会汇聚到 play()）时触发 */
  onPlaybackStart?: () => void;
}

type MusicPlaySession = {
  accountId: number | null;
  accountGeneration: number;
  trackId: number;
  playbackId: string;
  listenedMs: number;
  lastMediaMs: number;
  lastObservedAt: number;
  lastProgressLoggedAt: number;
  reported: boolean;
};

function browserRuntime(): MusicPlayerRuntime {
  return {
    createAudio: () => new Audio(),
    storage: localStorage,
    now: () => performance.now(),
    random: Math.random,
    randomUUID: () => randomId(),
    setInterval: (handler, delay) => window.setInterval(handler, delay),
    clearInterval: (timer) => window.clearInterval(timer),
    setTimeout: (handler, delay) => window.setTimeout(handler, delay),
    clearTimeout: (timer) => window.clearTimeout(timer),
    requestAnimationFrame: (handler) => window.requestAnimationFrame(handler),
    cancelAnimationFrame: (frame) => window.cancelAnimationFrame(frame),
    mediaSession: "mediaSession" in navigator ? navigator.mediaSession as MusicMediaSession : null,
    createMediaMetadata: typeof MediaMetadata === "undefined"
      ? null
      : (metadata) => new MediaMetadata(metadata),
    listenPageHide: (handler) => {
      window.addEventListener("pagehide", handler);
      return () => window.removeEventListener("pagehide", handler);
    },
    listenVisibilityChange: (handler) => {
      document.addEventListener("visibilitychange", handler);
      return () => document.removeEventListener("visibilitychange", handler);
    },
    documentVisible: () => document.visibilityState === "visible"
  };
}

function musicPlaybackModeStorageKey(accountId: number) {
  return `team-chat-music-playback-mode:${accountId}`;
}

function musicOnlyFavoritesStorageKey(accountId: number) {
  return `team-chat-music-only-favorites:${accountId}`;
}

function musicPlaybackStateStorageKey(accountId: number) {
  return `team-chat-music-playback-state:${accountId}`;
}

export function parseStoredMusicPlaybackState(value: string | null): MusicPlaybackStateDTO | null {
  if (!value) return null;
  try {
    const state = JSON.parse(value) as MusicPlaybackStateDTO;
    if (!state || !["library", "favorites", "playlist"].includes(state.sourceKind)) return null;
    if (!["playlist", "single", "shuffle"].includes(state.playbackMode)) return null;
    return {
      ...state,
      playlistId: Number(state.playlistId) || null,
      trackId: Number(state.trackId) || null,
      progressMs: Math.max(0, Number(state.progressMs) || 0)
    };
  } catch {
    return null;
  }
}

export function randomMusicTrack(
  tracks: MusicTrackDTO[],
  excludeId?: number | null,
  random: () => number = Math.random
) {
  if (!tracks.length) return null;
  const candidates = tracks.length > 1 && excludeId ? tracks.filter((track) => track.id !== excludeId) : tracks;
  return candidates[Math.floor(random() * candidates.length)] || tracks[0];
}

export function useMusicPlayer(options: UseMusicPlayerOptions) {
  const request = options.request || api;
  const runtime = options.runtime || browserRuntime();
  const streamUrl = options.streamUrl || ((track: MusicTrackDTO) =>
    `/api/music/tracks/${track.id}/stream?token=${encodeURIComponent(getToken())}`);
  const primeTrackCache = options.primeTrackCache || (async (track: MusicTrackDTO) => {
    if (!("serviceWorker" in navigator)) return;
    const registration = await navigator.serviceWorker.ready.catch(() => null);
    registration?.active?.postMessage({ type: "CACHE_RESOURCE", url: streamUrl(track) });
  });

  const currentTrackId = ref<number | null>(null);
  const playbackMode = ref<MusicPlaybackMode>("shuffle");
  const onlyFavorites = ref(false);
  const playing = ref(false);
  const loading = ref(false);
  const error = ref("");
  const playbackSourceKind = ref<MusicPlaylistSourceKind>("library");
  const playbackPlaylistId = ref<number | null>(null);
  const playbackHistoryIds = ref<number[]>([]);
  const playbackServerUpdatedAt = ref("");

  const playbackPlaylist = computed(() =>
    options.playlists.value.find((playlist) => playlist.id === playbackPlaylistId.value) || null
  );
  const playableTracks = computed(() => {
    if (playbackSourceKind.value === "playlist") return playbackPlaylist.value?.tracks || [];
    if (playbackSourceKind.value === "favorites" || onlyFavorites.value) return options.favoriteTracks.value;
    return options.libraryTracks.value;
  });
  const currentTrack = computed(() =>
    options.tracks.value.find((track) => track.id === currentTrackId.value) || null
  );
  const currentTrackIndex = computed(() =>
    playableTracks.value.findIndex((track) => track.id === currentTrack.value?.id)
  );

  let activeAccountId: number | null = null;
  let accountGeneration = 0;
  let pendingRestoredProgressMs = 0;
  let stateSyncTimer: number | undefined;
  let audio: HTMLAudioElement | null = null;
  let unbindMediaSession: (() => void) | null = null;
  let fadeFrame: number | undefined;
  let fadeTimer: number | undefined;
  let playSession: MusicPlaySession | null = null;
  let removePageHideListener: (() => void) | null = null;
  let removeVisibilityListener: (() => void) | null = null;
  let mounted = false;
  let disposed = false;

  function notifyCurrentTrackChanged() {
    options.onCurrentTrackChanged?.();
  }

  function notifyListeningChanged() {
    options.onListeningChanged?.();
  }

  function setCurrentTrack(trackId: number | null) {
    currentTrackId.value = trackId;
    notifyCurrentTrackChanged();
  }

  function applyPlaybackState(state: MusicPlaybackStateDTO) {
    options.selectedSourceKind.value = state.sourceKind;
    playbackSourceKind.value = state.sourceKind;
    onlyFavorites.value = state.sourceKind === "favorites";
    options.selectedPlaylistId.value = state.sourceKind === "playlist" ? state.playlistId : null;
    playbackPlaylistId.value = state.sourceKind === "playlist" ? state.playlistId : null;
    setCurrentTrack(state.trackId);
    pendingRestoredProgressMs = state.progressMs;
    playbackMode.value = state.playbackMode;
  }

  function currentPlaybackTimeMs() {
    return Math.max(0, Math.round((audio?.currentTime || 0) * 1000));
  }

  function playbackStateSnapshot(accountId = activeAccountId): MusicPlaybackStateDTO | null {
    if (!accountId) return null;
    const trackId = currentTrack.value?.id || null;
    const currentBelongsToQueue = !trackId || playableTracks.value.some((track) => track.id === trackId);
    const sourceKind = currentBelongsToQueue ? playbackSourceKind.value : "library";
    return {
      sourceKind,
      playlistId: sourceKind === "playlist" ? playbackPlaylistId.value : null,
      trackId,
      progressMs: currentPlaybackTimeMs(),
      playbackMode: playbackMode.value,
      updatedAt: new Date().toISOString()
    };
  }

  async function syncPlaybackState(
    state = playbackStateSnapshot(),
    accountId = activeAccountId,
    generation = accountGeneration
  ) {
    if (!state || !accountId) return;
    const result = await request<{ accepted: boolean; state: MusicPlaybackStateDTO }>("/api/music/playback-state", {
      method: "PUT",
      body: JSON.stringify({ ...state, knownUpdatedAt: playbackServerUpdatedAt.value || undefined })
    }).catch(() => null);
    if (!result?.state || activeAccountId !== accountId || accountGeneration !== generation || disposed) return;
    playbackServerUpdatedAt.value = result.state.updatedAt;
    if (!result.accepted && !playing.value) applyPlaybackState(result.state);
  }

  function persistPlaybackState(syncNow = false) {
    const accountId = activeAccountId;
    const state = playbackStateSnapshot(accountId);
    if (!accountId || !state) return;
    runtime.storage.setItem(musicPlaybackStateStorageKey(accountId), JSON.stringify(state));
    if (syncNow) void syncPlaybackState(state, accountId, accountGeneration);
  }

  function stopStateSyncTimer() {
    if (stateSyncTimer !== undefined) runtime.clearInterval(stateSyncTimer);
    stateSyncTimer = undefined;
  }

  function startStateSyncTimer() {
    stopStateSyncTimer();
    if (!activeAccountId || disposed) return;
    stateSyncTimer = runtime.setInterval(() => {
      if (playing.value) persistPlaybackState(true);
    }, MUSIC_STATE_SYNC_INTERVAL_MS);
  }

  function loadPlaybackMode(accountId: number) {
    const savedMode = runtime.storage.getItem(musicPlaybackModeStorageKey(accountId));
    playbackMode.value = savedMode === "single" || savedMode === "playlist" ? savedMode : "shuffle";
    onlyFavorites.value = runtime.storage.getItem(musicOnlyFavoritesStorageKey(accountId)) === "1";
    if (onlyFavorites.value) {
      options.selectedSourceKind.value = "favorites";
      playbackSourceKind.value = "favorites";
    }
  }

  function clearFade(resetVolume = true) {
    if (fadeFrame !== undefined) runtime.cancelAnimationFrame(fadeFrame);
    if (fadeTimer !== undefined) runtime.clearTimeout(fadeTimer);
    fadeFrame = undefined;
    fadeTimer = undefined;
    if (resetVolume && audio) audio.volume = 1;
  }

  function clearAudioSource() {
    if (!audio) return;
    audio.removeAttribute("src");
    delete audio.dataset.trackId;
    audio.load();
  }

  function resetAccountState() {
    stopStateSyncTimer();
    clearFade();
    audio?.pause();
    clearAudioSource();
    playing.value = false;
    loading.value = false;
    error.value = "";
    playbackMode.value = "shuffle";
    onlyFavorites.value = false;
    options.selectedSourceKind.value = "library";
    options.selectedPlaylistId.value = null;
    playbackSourceKind.value = "library";
    playbackPlaylistId.value = null;
    playbackHistoryIds.value = [];
    playbackServerUpdatedAt.value = "";
    pendingRestoredProgressMs = 0;
    playSession = null;
    setCurrentTrack(null);
    syncCurrentMediaSession();
    notifyListeningChanged();
  }

  function handleAccountChange(accountId: number | null | undefined) {
    const nextAccountId = accountId || null;
    if (nextAccountId === activeAccountId) return;
    accountGeneration += 1;
    resetAccountState();
    activeAccountId = nextAccountId;
    if (activeAccountId) loadPlaybackMode(activeAccountId);
  }

  async function activateAccount(accountId: number) {
    handleAccountChange(accountId);
    const generation = accountGeneration;
    const local = parseStoredMusicPlaybackState(
      runtime.storage.getItem(musicPlaybackStateStorageKey(accountId))
    );
    const result = await request<{ state: MusicPlaybackStateDTO | null }>("/api/music/playback-state")
      .catch(() => ({ state: null }));
    if (disposed || activeAccountId !== accountId || accountGeneration !== generation) return;
    const server = result.state;
    if (server) playbackServerUpdatedAt.value = server.updatedAt;
    const state = local && (!server || Date.parse(local.updatedAt) > Date.parse(server.updatedAt))
      ? local
      : server;
    if (state) {
      applyPlaybackState(state);
      if (state === local) void syncPlaybackState(state, accountId, generation);
    }
    startStateSyncTimer();
  }

  function setPlaybackMode(mode: MusicPlaybackMode) {
    playbackMode.value = mode;
    if (activeAccountId) runtime.storage.setItem(musicPlaybackModeStorageKey(activeAccountId), mode);
    persistPlaybackState(true);
  }

  function cyclePlaybackMode() {
    const modes: MusicPlaybackMode[] = ["playlist", "single", "shuffle"];
    setPlaybackMode(modes[(modes.indexOf(playbackMode.value) + 1) % modes.length]);
  }

  function playbackModeLabel(mode = playbackMode.value) {
    if (mode === "single") return "单曲循环";
    if (mode === "shuffle") return "随机播放";
    return "列表循环";
  }

  function syncCurrentMediaSession() {
    if (!runtime.mediaSession || !runtime.createMediaMetadata) return;
    syncMusicMediaSession(
      runtime.mediaSession,
      { title: currentTrack.value?.title || "", playing: playing.value },
      runtime.createMediaMetadata
    );
  }

  function initializeMediaSession() {
    if (!runtime.mediaSession) return;
    unbindMediaSession?.();
    unbindMediaSession = bindMusicMediaSession(runtime.mediaSession, {
      play: () => void play(),
      pause: () => pause(true),
      previousTrack: () => void shiftTrack(-1),
      nextTrack: () => void shiftTrack(1)
    });
    syncCurrentMediaSession();
  }

  function beginPlaySession(track: MusicTrackDTO) {
    playSession = {
      accountId: activeAccountId,
      accountGeneration,
      trackId: track.id,
      playbackId: runtime.randomUUID(),
      listenedMs: 0,
      lastMediaMs: Math.max(0, Math.round((audio?.currentTime || 0) * 1000)),
      lastObservedAt: runtime.now(),
      lastProgressLoggedAt: Number.NEGATIVE_INFINITY,
      reported: false
    };
  }

  function resetPlayObservation() {
    if (!playSession || !audio) return;
    playSession.lastMediaMs = Math.max(0, Math.round(audio.currentTime * 1000));
    playSession.lastObservedAt = runtime.now();
  }

  function preparePlaySession() {
    const track = currentTrack.value;
    if (!track || !audio) return;
    if (!playSession || playSession.trackId !== track.id || audio.ended) beginPlaySession(track);
    else resetPlayObservation();
  }

  async function reportProgress(
    session: MusicPlaySession,
    targetAudio: HTMLAudioElement,
    state: MusicProgressState,
    now = runtime.now()
  ) {
    if (!Number.isFinite(targetAudio.duration) || targetAudio.duration <= 0) return;
    if (!shouldWriteMusicProgress(state, now - session.lastProgressLoggedAt)) return;
    session.lastProgressLoggedAt = now;
    const durationMs = Math.max(1, Math.round(targetAudio.duration * 1000));
    const progressMs = Math.min(durationMs, Math.max(0, Math.round(targetAudio.currentTime * 1000)));
    const listenedMs = Math.min(durationMs, Math.max(0, Math.ceil(session.listenedMs)));
    await request(`/api/music/tracks/${session.trackId}/progress`, {
      method: "POST",
      body: JSON.stringify({
        playbackId: session.playbackId,
        state,
        progressMs,
        listenedMs,
        durationMs,
        appVersion: APP_VERSION
      })
    }).catch(() => undefined);
  }

  async function reportQualifiedPlay(session: MusicPlaySession, durationSeconds: number) {
    if (session.reported || !Number.isFinite(durationSeconds)) return;
    const durationMs = Math.round(durationSeconds * 1000);
    const listenedMs = Math.min(durationMs, Math.ceil(session.listenedMs));
    if (!isQualifiedMusicPlay(durationMs, listenedMs)) return;
    session.reported = true;
    try {
      const result = await request<{ heat: number }>(`/api/music/tracks/${session.trackId}/play`, {
        method: "POST",
        body: JSON.stringify({ playbackId: session.playbackId, durationMs, listenedMs })
      });
      if (
        Number.isFinite(result.heat) &&
        playSession === session &&
        activeAccountId === session.accountId &&
        accountGeneration === session.accountGeneration
      ) {
        options.onHeatChanged?.(session.trackId, result.heat);
      }
    } catch {
      if (playSession === session) session.reported = false;
    }
  }

  function handlePlay() {
    if (disposed) return;
    playing.value = true;
    loading.value = false;
    error.value = "";
    preparePlaySession();
    if (playSession && audio) void reportProgress(playSession, audio, "started");
    notifyListeningChanged();
    persistPlaybackState(true);
  }

  function handlePause() {
    if (disposed) return;
    playing.value = false;
    loading.value = false;
    if (playSession && audio) void reportProgress(playSession, audio, "paused");
    resetPlayObservation();
    notifyListeningChanged();
    persistPlaybackState(true);
  }

  function handleMetadataLoaded() {
    if (!audio || pendingRestoredProgressMs <= 0 || !Number.isFinite(audio.duration)) return;
    audio.currentTime = Math.min(
      pendingRestoredProgressMs / 1000,
      Math.max(0, audio.duration - 0.25)
    );
    pendingRestoredProgressMs = 0;
    resetPlayObservation();
  }

  function handleWaiting() {
    if (disposed) return;
    loading.value = true;
    resetPlayObservation();
  }

  function handleCanPlay() {
    if (disposed) return;
    loading.value = false;
    resetPlayObservation();
  }

  function handleSeeking() {
    if (!disposed) resetPlayObservation();
  }

  function handleSeeked() {
    if (disposed) return;
    resetPlayObservation();
    persistPlaybackState(true);
  }

  function handleTimeUpdate() {
    const session = playSession;
    const targetAudio = audio;
    if (disposed || !session || !targetAudio || session.trackId !== currentTrack.value?.id) return;
    const now = runtime.now();
    const currentMediaMs = Math.max(0, Math.round(targetAudio.currentTime * 1000));
    if (!targetAudio.paused && !targetAudio.seeking && targetAudio.readyState >= 2) {
      session.listenedMs += creditedMusicListenMs(
        session.lastMediaMs,
        currentMediaMs,
        now - session.lastObservedAt
      );
    }
    session.lastMediaMs = currentMediaMs;
    session.lastObservedAt = now;
    void reportProgress(session, targetAudio, "progress", now);
    void reportQualifiedPlay(session, targetAudio.duration);
  }

  function handleError() {
    if (disposed) return;
    if (playSession && audio) void reportProgress(playSession, audio, "error");
    playing.value = false;
    loading.value = false;
    error.value = "歌曲暂时无法播放";
    notifyListeningChanged();
  }

  function setAudioTrack(track: MusicTrackDTO) {
    initializeAudio();
    void primeTrackCache(track);
    if (!audio || audio.dataset.trackId === String(track.id)) return;
    if (playSession && audio.dataset.trackId) void reportProgress(playSession, audio, "changed");
    clearFade();
    audio.src = streamUrl(track);
    audio.dataset.trackId = String(track.id);
    audio.load();
    beginPlaySession(track);
  }

  async function play(playOptions?: { fadeIn?: boolean }) {
    const track = currentTrack.value;
    if (!track) {
      error.value = "歌单还是空的";
      return;
    }
    setAudioTrack(track);
    if (!audio) return;
    const targetAudio = audio;
    const generation = accountGeneration;
    clearFade();
    targetAudio.volume = playOptions?.fadeIn ? 0 : 1;
    preparePlaySession();
    loading.value = true;
    error.value = "";
    options.onPlaybackStart?.();
    try {
      await targetAudio.play();
      if (
        disposed ||
        generation !== accountGeneration ||
        targetAudio !== audio ||
        currentTrackId.value !== track.id
      ) {
        targetAudio.pause();
        return;
      }
      playing.value = true;
      loading.value = false;
      if (playOptions?.fadeIn) {
        const startedAt = runtime.now();
        const animate = (now: number) => {
          if (targetAudio !== audio || disposed) return;
          targetAudio.volume = 1 - musicFadeVolume((now - startedAt) / MUSIC_FADE_OUT_MS);
          if (targetAudio.volume < 1) fadeFrame = runtime.requestAnimationFrame(animate);
        };
        fadeFrame = runtime.requestAnimationFrame(animate);
        fadeTimer = runtime.setTimeout(() => {
          if (targetAudio !== audio || disposed) return;
          clearFade(false);
          targetAudio.volume = 1;
        }, MUSIC_FADE_OUT_MS);
      }
    } catch (playError) {
      if (disposed || generation !== accountGeneration || targetAudio !== audio) return;
      loading.value = false;
      playing.value = false;
      error.value = playError instanceof Error && playError.name === "NotAllowedError"
        ? "请再次点击播放"
        : "歌曲暂时无法播放";
    }
  }

  function pause(immediate = false) {
    const targetAudio = audio;
    if (!targetAudio) return;
    clearFade();
    if (immediate || targetAudio.paused) {
      targetAudio.pause();
      targetAudio.volume = 1;
      playing.value = false;
      loading.value = false;
      notifyListeningChanged();
      return;
    }
    playing.value = false;
    loading.value = false;
    notifyListeningChanged();
    const startedAt = runtime.now();
    const animate = (now: number) => {
      if (targetAudio !== audio || disposed) return;
      targetAudio.volume = musicFadeVolume((now - startedAt) / MUSIC_FADE_OUT_MS);
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
    fadeTimer = runtime.setTimeout(finish, MUSIC_FADE_OUT_MS);
  }

  function togglePlayback() {
    if (playing.value) pause();
    else void play();
  }

  function stop() {
    pause(true);
    if (audio) audio.currentTime = 0;
    error.value = "";
  }

  async function shiftTrack(delta: number, continuePlaying = playing.value) {
    if (delta < 0) {
      const previous = takePreviousMusicTrack(
        playbackHistoryIds.value,
        options.tracks.value.map((track) => track.id)
      );
      playbackHistoryIds.value = previous.history;
      if (previous.trackId) {
        const track = options.tracks.value.find((item) => item.id === previous.trackId);
        if (!track) return;
        setCurrentTrack(track.id);
        pendingRestoredProgressMs = 0;
        setAudioTrack(track);
        error.value = "";
        if (continuePlaying) await play();
        persistPlaybackState(true);
        return;
      }
    }
    if (!playableTracks.value.length) return;
    if (shouldRestartOnlyTrack(playableTracks.value.length, delta)) {
      const track = playableTracks.value[0];
      setCurrentTrack(track.id);
      pendingRestoredProgressMs = 0;
      setAudioTrack(track);
      if (audio) audio.currentTime = 0;
      beginPlaySession(track);
      error.value = "";
      await play();
      persistPlaybackState(true);
      return;
    }
    const index = currentTrackIndex.value >= 0 ? currentTrackIndex.value : 0;
    const nextIndex = nextMusicTrackIndexForMode(
      playableTracks.value.length,
      index,
      delta,
      playbackMode.value,
      runtime.random
    );
    const track = playableTracks.value[nextIndex];
    if (delta > 0) {
      playbackHistoryIds.value = pushMusicPlaybackHistory(
        playbackHistoryIds.value,
        currentTrackId.value,
        track.id
      );
    }
    setCurrentTrack(track.id);
    pendingRestoredProgressMs = 0;
    setAudioTrack(track);
    error.value = "";
    if (continuePlaying) await play();
    persistPlaybackState(true);
  }

  function handleEnded() {
    if (disposed) return;
    clearFade();
    playing.value = false;
    if (playSession && audio) void reportProgress(playSession, audio, "ended");
    notifyListeningChanged();
    if (shouldRepeatCurrentMusic(playbackMode.value, options.scoreOpen.value) && currentTrack.value) {
      if (audio) audio.currentTime = 0;
      beginPlaySession(currentTrack.value);
      void play();
    } else if (
      shouldAdvanceMusic(playbackMode.value, options.scoreOpen.value) &&
      playableTracks.value.length
    ) {
      void shiftTrack(1, true);
    }
  }

  function selectTrack(track: MusicTrackDTO) {
    playbackHistoryIds.value = pushMusicPlaybackHistory(
      playbackHistoryIds.value,
      currentTrackId.value,
      track.id
    );
    playbackSourceKind.value = options.selectedSourceKind.value;
    playbackPlaylistId.value = options.selectedSourceKind.value === "playlist"
      ? options.selectedPlaylistId.value
      : null;
    onlyFavorites.value = options.selectedSourceKind.value === "favorites";
    if (activeAccountId) {
      runtime.storage.setItem(
        musicOnlyFavoritesStorageKey(activeAccountId),
        onlyFavorites.value ? "1" : "0"
      );
    }
    setCurrentTrack(track.id);
    pendingRestoredProgressMs = 0;
    setAudioTrack(track);
    void play();
    persistPlaybackState(true);
  }

  function replaceCurrentTrack(track: MusicTrackDTO, continuePlaying = playing.value) {
    setCurrentTrack(track.id);
    pendingRestoredProgressMs = 0;
    setAudioTrack(track);
    if (continuePlaying) void play();
  }

  function setOnlyFavorites(nextOnlyFavorites: boolean) {
    const previousTrackId = currentTrackId.value;
    const continuePlaying = playing.value;
    onlyFavorites.value = nextOnlyFavorites;
    options.selectedSourceKind.value = nextOnlyFavorites ? "favorites" : "library";
    playbackSourceKind.value = nextOnlyFavorites ? "favorites" : "library";
    options.selectedPlaylistId.value = null;
    playbackPlaylistId.value = null;
    if (activeAccountId) {
      runtime.storage.setItem(
        musicOnlyFavoritesStorageKey(activeAccountId),
        nextOnlyFavorites ? "1" : "0"
      );
    }

    const availableTracks = nextOnlyFavorites ? options.favoriteTracks.value : options.tracks.value;
    if (availableTracks.some((track) => track.id === previousTrackId)) {
      persistPlaybackState(true);
      return;
    }

    const track = randomMusicTrack(availableTracks, undefined, runtime.random);
    if (!track) {
      setCurrentTrack(null);
      pause(true);
      persistPlaybackState(true);
      return;
    }
    setCurrentTrack(track.id);
    pendingRestoredProgressMs = 0;
    setAudioTrack(track);
    if (continuePlaying) void play();
    persistPlaybackState(true);
  }

  function reconcileTracks() {
    const previousId = currentTrackId.value;
    const wasPlaying = playing.value;
    const byId = new Map(options.tracks.value.map((track) => [track.id, track]));
    if (previousId && byId.has(previousId)) {
      setCurrentTrack(previousId);
    } else {
      if (wasPlaying) pause(true);
      const availableTracks = playableTracks.value.length
        ? playableTracks.value
        : options.selectedSourceKind.value === "library"
          ? options.tracks.value
          : [];
      setCurrentTrack(
        randomMusicTrack(availableTracks, previousId, runtime.random)?.id || null
      );
      pendingRestoredProgressMs = 0;
      clearAudioSource();
    }
    if (currentTrack.value) setAudioTrack(currentTrack.value);
    if (!pendingRestoredProgressMs) persistPlaybackState(false);
  }

  function handlePlaylistDeleted(playlistId: number) {
    if (playlistId !== playbackPlaylistId.value) return;
    playbackSourceKind.value = "library";
    playbackPlaylistId.value = null;
    onlyFavorites.value = false;
    persistPlaybackState(true);
  }

  function initializeAudio() {
    if (audio || disposed) return;
    audio = runtime.createAudio();
    audio.preload = "metadata";
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("error", handleError);
    audio.addEventListener("waiting", handleWaiting);
    audio.addEventListener("canplay", handleCanPlay);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("seeking", handleSeeking);
    audio.addEventListener("seeked", handleSeeked);
    audio.addEventListener("loadedmetadata", handleMetadataLoaded);
    initializeMediaSession();
  }

  function disposeAudio() {
    if (!audio) return;
    const targetAudio = audio;
    unbindMediaSession?.();
    unbindMediaSession = null;
    if (runtime.mediaSession) {
      runtime.mediaSession.playbackState = "none";
      runtime.mediaSession.metadata = null;
    }
    clearFade();
    targetAudio.pause();
    targetAudio.removeEventListener("play", handlePlay);
    targetAudio.removeEventListener("pause", handlePause);
    targetAudio.removeEventListener("ended", handleEnded);
    targetAudio.removeEventListener("error", handleError);
    targetAudio.removeEventListener("waiting", handleWaiting);
    targetAudio.removeEventListener("canplay", handleCanPlay);
    targetAudio.removeEventListener("timeupdate", handleTimeUpdate);
    targetAudio.removeEventListener("seeking", handleSeeking);
    targetAudio.removeEventListener("seeked", handleSeeked);
    targetAudio.removeEventListener("loadedmetadata", handleMetadataLoaded);
    targetAudio.removeAttribute("src");
    targetAudio.load();
    audio = null;
  }

  function mount() {
    if (mounted || disposed) return;
    mounted = true;
    initializeAudio();
    removePageHideListener = runtime.listenPageHide(() => persistPlaybackState(true));
    removeVisibilityListener = runtime.listenVisibilityChange(() => {
      if (!runtime.documentVisible()) persistPlaybackState(true);
    });
  }

  function dispose() {
    if (disposed) return;
    persistPlaybackState(true);
    disposed = true;
    accountGeneration += 1;
    stopStateSyncTimer();
    removePageHideListener?.();
    removeVisibilityListener?.();
    removePageHideListener = null;
    removeVisibilityListener = null;
    disposeAudio();
    stopMediaSessionWatch();
  }

  const stopMediaSessionWatch = watch(
    [() => currentTrack.value?.title || "", playing],
    syncCurrentMediaSession,
    { flush: "sync" }
  );

  return {
    state: {
      currentTrackId,
      currentTrack,
      playableTracks,
      playbackMode,
      onlyFavorites,
      playing,
      loading,
      error
    },
    controls: {
      mount,
      dispose,
      handleAccountChange,
      activateAccount,
      persistPlaybackState,
      setPlaybackMode,
      cyclePlaybackMode,
      playbackModeLabel,
      setOnlyFavorites,
      play,
      pause,
      stop,
      togglePlayback,
      shiftTrack,
      selectTrack,
      replaceCurrentTrack,
      reconcileTracks,
      handlePlaylistDeleted,
      currentPlaybackTimeMs
    }
  };
}
