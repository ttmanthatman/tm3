export const MUSIC_PLAY_QUALIFY_RATIO = 0.33;

export function creditedMusicListenMs(previousMediaMs: number, currentMediaMs: number, elapsedWallMs: number) {
  const mediaDelta = currentMediaMs - previousMediaMs;
  if (!Number.isFinite(mediaDelta) || !Number.isFinite(elapsedWallMs) || mediaDelta <= 0 || elapsedWallMs < 0) return 0;
  const largestNaturalAdvance = Math.max(2_500, elapsedWallMs * 1.5 + 750);
  return mediaDelta <= largestNaturalAdvance ? mediaDelta : 0;
}

export function isQualifiedMusicPlay(durationMs: number, listenedMs: number) {
  return Number.isFinite(durationMs) && Number.isFinite(listenedMs) && durationMs >= 5_000 && listenedMs >= durationMs * MUSIC_PLAY_QUALIFY_RATIO;
}
