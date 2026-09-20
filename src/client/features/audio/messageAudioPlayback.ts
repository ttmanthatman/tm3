import { createExclusiveAudio, type ExclusiveAudio } from "./exclusiveAudio";

const STORAGE_KEY = "team-chat-message-audio-progress-v1";
const PARTICIPANT_ID = "message-audio";
const MAX_SAVED_POSITIONS = 64;

type AudioElement = Pick<
  HTMLAudioElement,
  "addEventListener" | "currentTime" | "duration" | "ended" | "pause" | "paused" | "play" | "preload" | "setAttribute" | "src"
>;

export type MessageAudioSnapshot = {
  playing: boolean;
  progress: number;
  durationMs: number;
};

type SavedPosition = { seconds: number; updatedAt: number };
type SavedPositions = Record<string, SavedPosition>;
type Listener = (snapshot: MessageAudioSnapshot) => void;

export type MessageAudioPlaybackOptions = {
  createAudio: (src: string) => AudioElement;
  exclusiveAudio: ExclusiveAudio;
  storage?: Pick<Storage, "getItem" | "setItem">;
  now?: () => number;
};

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

function readPositions(storage?: Pick<Storage, "getItem" | "setItem">): SavedPositions {
  if (!storage) return {};
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || "{}") as SavedPositions;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function createMessageAudioPlayback(options: MessageAudioPlaybackOptions) {
  const now = options.now ?? Date.now;
  const listeners = new Map<number, Set<Listener>>();
  const snapshots = new Map<number, MessageAudioSnapshot>();
  const positions = readPositions(options.storage);
  let active: { messageId: number; src: string; fallbackDurationMs: number; audio: AudioElement } | null = null;
  let coordinatorPause = false;
  let lastStorageFlushAt = 0;

  function fallbackSnapshot(messageId: number, fallbackDurationMs: number): MessageAudioSnapshot {
    const durationMs = Math.max(0, fallbackDurationMs);
    const savedSeconds = Math.max(0, positions[String(messageId)]?.seconds || 0);
    return {
      playing: false,
      progress: durationMs > 0 ? clamp((savedSeconds * 1000) / durationMs) : 0,
      durationMs
    };
  }

  function snapshot(messageId: number, fallbackDurationMs = 0) {
    return snapshots.get(messageId) || fallbackSnapshot(messageId, fallbackDurationMs);
  }

  function notify(messageId: number, patch: Partial<MessageAudioSnapshot>, fallbackDurationMs = 0) {
    const next = { ...snapshot(messageId, fallbackDurationMs), ...patch };
    snapshots.set(messageId, next);
    for (const listener of listeners.get(messageId) || []) listener(next);
  }

  function flushPositions(force = false) {
    if (!options.storage) return;
    const currentTime = now();
    if (!force && currentTime - lastStorageFlushAt < 2_000) return;
    try {
      const trimmed = Object.fromEntries(
        Object.entries(positions)
          .sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
          .slice(0, MAX_SAVED_POSITIONS)
      );
      options.storage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      lastStorageFlushAt = currentTime;
    } catch {
      // Playback must keep working when private browsing denies storage writes.
    }
  }

  function savePosition(messageId: number, seconds: number, duration: number, ended = false, force = false) {
    const key = String(messageId);
    if (ended || (Number.isFinite(duration) && duration > 0 && seconds >= duration - 0.5)) delete positions[key];
    else if (Number.isFinite(seconds) && seconds > 0.25) positions[key] = { seconds, updatedAt: now() };
    else delete positions[key];
    flushPositions(force || ended);
  }

  function pauseActive() {
    if (!active) return;
    const { messageId, fallbackDurationMs, audio } = active;
    if (!audio.paused) audio.pause();
    savePosition(messageId, audio.currentTime, audio.duration, false, true);
    notify(messageId, { playing: false }, fallbackDurationMs);
  }

  options.exclusiveAudio.register({
    id: PARTICIPANT_ID,
    resumable: false,
    suspend: () => {
      coordinatorPause = true;
      pauseActive();
      coordinatorPause = false;
    },
    resume: () => undefined
  });

  function ensureAudio(messageId: number, src: string, fallbackDurationMs: number) {
    if (active?.messageId === messageId && active.src === src) {
      active.fallbackDurationMs = fallbackDurationMs;
      return active.audio;
    }
    pauseActive();
    const audio = options.createAudio(src);
    const entry = { messageId, src, fallbackDurationMs, audio };
    active = entry;
    audio.preload = "metadata";
    audio.setAttribute("playsinline", "true");
    audio.setAttribute("webkit-playsinline", "true");

    const syncDuration = () => {
      if (active !== entry) return;
      const durationMs = Number.isFinite(audio.duration) && audio.duration > 0 ? Math.round(audio.duration * 1000) : fallbackDurationMs;
      const savedSeconds = Math.max(0, positions[String(messageId)]?.seconds || 0);
      if (savedSeconds > 0 && savedSeconds < audio.duration - 0.5 && audio.currentTime < 0.25) audio.currentTime = savedSeconds;
      notify(messageId, { durationMs, progress: durationMs > 0 ? clamp((audio.currentTime * 1000) / durationMs) : 0 }, fallbackDurationMs);
    };
    audio.addEventListener("loadedmetadata", syncDuration);
    audio.addEventListener("timeupdate", () => {
      if (active !== entry) return;
      const durationMs = Number.isFinite(audio.duration) && audio.duration > 0 ? Math.round(audio.duration * 1000) : fallbackDurationMs;
      savePosition(messageId, audio.currentTime, audio.duration);
      notify(messageId, { playing: !audio.paused, durationMs, progress: durationMs > 0 ? clamp((audio.currentTime * 1000) / durationMs) : 0 }, fallbackDurationMs);
    });
    audio.addEventListener("ended", () => {
      if (active !== entry) return;
      savePosition(messageId, audio.currentTime, audio.duration, true, true);
      notify(messageId, { playing: false, progress: 1 }, fallbackDurationMs);
      options.exclusiveAudio.deactivate(PARTICIPANT_ID, { resumeSuspended: true });
    });
    audio.addEventListener("pause", () => {
      if (active !== entry || audio.ended) return;
      savePosition(messageId, audio.currentTime, audio.duration, false, true);
      notify(messageId, { playing: false }, fallbackDurationMs);
      if (!coordinatorPause) options.exclusiveAudio.deactivate(PARTICIPANT_ID);
    });
    audio.addEventListener("error", () => {
      if (active !== entry) return;
      savePosition(messageId, audio.currentTime, audio.duration, false, true);
      notify(messageId, { playing: false }, fallbackDurationMs);
      options.exclusiveAudio.deactivate(PARTICIPANT_ID);
    });
    const savedSeconds = Math.max(0, positions[String(messageId)]?.seconds || 0);
    if (savedSeconds > 0) {
      try { audio.currentTime = savedSeconds; } catch { /* metadata will restore it */ }
    }
    syncDuration();
    return audio;
  }

  async function toggle(messageId: number, src: string, fallbackDurationMs = 0) {
    const audio = ensureAudio(messageId, src, fallbackDurationMs);
    if (!audio.paused) {
      audio.pause();
      return false;
    }
    if (audio.ended) {
      audio.currentTime = 0;
      notify(messageId, { progress: 0 }, fallbackDurationMs);
    }
    options.exclusiveAudio.activate(PARTICIPANT_ID);
    notify(messageId, { playing: true }, fallbackDurationMs);
    try {
      await audio.play();
      return true;
    } catch {
      notify(messageId, { playing: false }, fallbackDurationMs);
      options.exclusiveAudio.deactivate(PARTICIPANT_ID);
      return false;
    }
  }

  async function seek(messageId: number, src: string, value: number, fallbackDurationMs = 0) {
    const audio = ensureAudio(messageId, src, fallbackDurationMs);
    const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : fallbackDurationMs / 1000;
    if (!duration) return false;
    audio.currentTime = duration * clamp(value);
    savePosition(messageId, audio.currentTime, duration, false, true);
    notify(messageId, { progress: clamp(value), durationMs: Math.round(duration * 1000) }, fallbackDurationMs);
    if (audio.paused) return toggle(messageId, src, fallbackDurationMs);
    return true;
  }

  function subscribe(messageId: number, _src: string, fallbackDurationMs: number, listener: Listener) {
    const set = listeners.get(messageId) || new Set<Listener>();
    set.add(listener);
    listeners.set(messageId, set);
    listener(snapshot(messageId, fallbackDurationMs));
    return () => {
      const current = listeners.get(messageId);
      current?.delete(listener);
      if (!current?.size) listeners.delete(messageId);
      // Deliberately do not pause: virtualized message rows unmount offscreen.
    };
  }

  return { snapshot, subscribe, toggle, seek, stopAll: pauseActive };
}

let sharedMessageAudio: ReturnType<typeof createMessageAudioPlayback> | null = null;
let sharedExclusiveAudio: ExclusiveAudio | null = null;

export function getSharedExclusiveAudio() {
  if (!sharedExclusiveAudio) sharedExclusiveAudio = createExclusiveAudio();
  return sharedExclusiveAudio;
}

export function getSharedMessageAudioPlayback() {
  if (!sharedMessageAudio) {
    sharedMessageAudio = createMessageAudioPlayback({
      createAudio: (src) => new Audio(src),
      exclusiveAudio: getSharedExclusiveAudio(),
      storage: typeof localStorage === "undefined" ? undefined : localStorage
    });
  }
  return sharedMessageAudio;
}

export function stopAllMessageAudioPlayback() {
  sharedMessageAudio?.stopAll();
}
