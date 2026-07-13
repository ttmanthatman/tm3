export type MusicPlaybackMode = "single" | "playlist";

export function nextMusicTrackIndex(length: number, currentIndex: number, delta: number) {
  if (length <= 0) return -1;
  const safeIndex = currentIndex >= 0 && currentIndex < length ? currentIndex : 0;
  return (safeIndex + delta + length) % length;
}

export function shouldRestartOnlyTrack(trackCount: number, delta: number) {
  return trackCount === 1 && delta < 0;
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
