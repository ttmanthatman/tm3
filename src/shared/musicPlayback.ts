export const MUSIC_PLAY_QUALIFY_RATIO = 0.33;

export const MUSIC_PANEL_FONT_SIZE_DEFAULT = 20;
export const MUSIC_PANEL_FONT_SIZE_MIN = 14;
export const MUSIC_PANEL_FONT_SIZE_MAX = 28;

export function cleanMusicPanelFontSize(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return MUSIC_PANEL_FONT_SIZE_DEFAULT;
  return Math.max(MUSIC_PANEL_FONT_SIZE_MIN, Math.min(MUSIC_PANEL_FONT_SIZE_MAX, Math.round(parsed)));
}

export function creditedMusicListenMs(previousMediaMs: number, currentMediaMs: number, elapsedWallMs: number) {
  const mediaDelta = currentMediaMs - previousMediaMs;
  if (!Number.isFinite(mediaDelta) || !Number.isFinite(elapsedWallMs) || mediaDelta <= 0 || elapsedWallMs < 0) return 0;
  const largestNaturalAdvance = Math.max(2_500, elapsedWallMs * 1.5 + 750);
  return mediaDelta <= largestNaturalAdvance ? mediaDelta : 0;
}

export function isQualifiedMusicPlay(durationMs: number, listenedMs: number) {
  return Number.isFinite(durationMs) && Number.isFinite(listenedMs) && durationMs >= 5_000 && listenedMs >= durationMs * MUSIC_PLAY_QUALIFY_RATIO;
}
