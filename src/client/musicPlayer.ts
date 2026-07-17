export type MusicPlaybackMode = "single" | "playlist" | "shuffle";
export type MusicPlaylistSort = "manual" | "heat" | "uploaded" | "filename";

export type SortableMusicTrack = {
  id: number;
  title: string;
  fileName: string;
  createdAt: string;
  heat: number;
  manualOrder: number;
};

export type MusicMediaSessionHandlers = {
  play: () => void;
  pause: () => void;
  previousTrack: () => void;
  nextTrack: () => void;
};

type MusicMediaSessionAction = "play" | "pause" | "previoustrack" | "nexttrack";
type MusicMediaSessionActionTarget = {
  setActionHandler: (action: MusicMediaSessionAction, handler: (() => void) | null) => void;
};
type MusicMediaSessionStateTarget<TMetadata> = {
  playbackState: "none" | "paused" | "playing";
  metadata: TMetadata | null;
};

export function bindMusicMediaSession(session: MusicMediaSessionActionTarget | null | undefined, handlers: MusicMediaSessionHandlers) {
  if (!session) return () => undefined;
  const bindings: Array<[MusicMediaSessionAction, () => void]> = [
    ["play", handlers.play],
    ["pause", handlers.pause],
    ["previoustrack", handlers.previousTrack],
    ["nexttrack", handlers.nextTrack]
  ];
  for (const [action, handler] of bindings) {
    try {
      session.setActionHandler(action, handler);
    } catch {
      // Media Session support differs by browser and action; keep the actions it accepts.
    }
  }
  return () => {
    for (const [action] of bindings) {
      try {
        session.setActionHandler(action, null);
      } catch {
        // Ignore actions that were unsupported during registration.
      }
    }
  };
}

export function syncMusicMediaSession<TMetadata>(
  session: MusicMediaSessionStateTarget<TMetadata> | null | undefined,
  state: { title: string; playing: boolean },
  createMetadata: (metadata: { title: string; artist: string }) => TMetadata
) {
  if (!session) return;
  const title = state.title.trim();
  if (!title) {
    session.playbackState = "none";
    session.metadata = null;
    return;
  }
  session.playbackState = state.playing ? "playing" : "paused";
  session.metadata = createMetadata({ title, artist: "聊天室音乐" });
}

export function nextMusicTrackIndex(length: number, currentIndex: number, delta: number) {
  if (length <= 0) return -1;
  const safeIndex = currentIndex >= 0 && currentIndex < length ? currentIndex : 0;
  return (safeIndex + delta + length) % length;
}

export function nextMusicTrackIndexForMode(
  length: number,
  currentIndex: number,
  delta: number,
  mode: MusicPlaybackMode,
  random: () => number = Math.random
) {
  if (mode !== "shuffle" || length <= 1) return nextMusicTrackIndex(length, currentIndex, delta);
  const safeIndex = currentIndex >= 0 && currentIndex < length ? currentIndex : 0;
  const candidates = Array.from({ length }, (_, index) => index).filter((index) => index !== safeIndex);
  return candidates[Math.min(candidates.length - 1, Math.floor(Math.max(0, Math.min(0.999999, random())) * candidates.length))];
}

export function shouldRestartOnlyTrack(trackCount: number, delta: number) {
  return trackCount === 1 && delta < 0;
}

export function pushMusicPlaybackHistory(
  history: number[],
  currentTrackId: number | null | undefined,
  nextTrackId: number | null | undefined,
  limit = 100
) {
  if (!currentTrackId || !nextTrackId || currentTrackId === nextTrackId) return [...history];
  return [...history, currentTrackId].slice(-Math.max(1, limit));
}

export function takePreviousMusicTrack(history: number[], availableTrackIds: number[]) {
  const available = new Set(availableTrackIds);
  const remaining = [...history];
  while (remaining.length) {
    const trackId = remaining.pop()!;
    if (available.has(trackId)) return { trackId, history: remaining };
  }
  return { trackId: null, history: remaining };
}

export function musicFadeVolume(progress: number) {
  return 1 - Math.min(1, Math.max(0, progress));
}

export function shouldAdvanceMusic(mode: MusicPlaybackMode, scoreOpen = false) {
  return mode !== "single" && !scoreOpen;
}

export function shouldRepeatCurrentMusic(mode: MusicPlaybackMode, scoreOpen = false) {
  return mode === "single" && !scoreOpen;
}

export function shouldShowMusicScoreTrigger(input: { playing: boolean; scoreOpen: boolean; pageCount: number }) {
  return input.scoreOpen || (input.playing && input.pageCount > 0);
}

export function shouldKeepMusicScoreForTrack(pageCount: number) {
  return pageCount > 0;
}

export function musicMentionTokenAtCursor(value: string, caret: number) {
  const beforeCursor = value.slice(0, caret);
  const match = beforeCursor.match(/@@([^\s@，。！？、,.!?:;；：]*)$/);
  if (!match) return null;
  return {
    start: beforeCursor.length - match[1].length - 2,
    end: caret,
    query: match[1]
  };
}

export function sortMusicTracks<T extends SortableMusicTrack>(tracks: T[], sort: MusicPlaylistSort) {
  const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
  return [...tracks].sort((left, right) => {
    if (sort === "heat") return right.heat - left.heat || Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.id - left.id;
    if (sort === "uploaded") return Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.id - left.id;
    if (sort === "filename") return collator.compare(left.fileName, right.fileName) || left.id - right.id;
    return left.manualOrder - right.manualOrder || Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.id - left.id;
  });
}

export function moveMusicTrack<T>(items: T[], fromIndex: number, delta: number) {
  const toIndex = fromIndex + delta;
  if (fromIndex < 0 || fromIndex >= items.length || toIndex < 0 || toIndex >= items.length) return [...items];
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}
