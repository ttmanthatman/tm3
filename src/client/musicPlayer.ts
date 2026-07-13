export type MusicPlaybackMode = "single" | "playlist";

export function nextMusicTrackIndex(length: number, currentIndex: number, delta: number) {
  if (length <= 0) return -1;
  const safeIndex = currentIndex >= 0 && currentIndex < length ? currentIndex : 0;
  return (safeIndex + delta + length) % length;
}

export function shouldAdvanceMusic(mode: MusicPlaybackMode) {
  return mode === "playlist";
}
