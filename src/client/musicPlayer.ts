export type MusicPlaybackMode = "single" | "playlist";
export type MusicPlaylistSort = "manual" | "heat" | "uploaded" | "filename";

export type SortableMusicTrack = {
  id: number;
  title: string;
  fileName: string;
  createdAt: string;
  heat: number;
  manualOrder: number;
};

export function nextMusicTrackIndex(length: number, currentIndex: number, delta: number) {
  if (length <= 0) return -1;
  const safeIndex = currentIndex >= 0 && currentIndex < length ? currentIndex : 0;
  return (safeIndex + delta + length) % length;
}

export function shouldRestartOnlyTrack(trackCount: number, delta: number) {
  return trackCount === 1 && delta < 0;
}

export function musicFadeVolume(progress: number) {
  return 1 - Math.min(1, Math.max(0, progress));
}

export function shouldAdvanceMusic(mode: MusicPlaybackMode, scoreOpen = false) {
  return mode === "playlist" && !scoreOpen;
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
