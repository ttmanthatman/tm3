export const MUSIC_LYRICS_TICK_MS = 100;

export function shouldRunMusicLyricsClock(input: {
  playing: boolean;
  cueCount: number;
  suppressed: boolean;
  documentVisible: boolean;
}) {
  return input.playing && input.cueCount > 0 && !input.suppressed && input.documentVisible;
}

export function shouldRenderMessageEffect(input: {
  manuallyPaused: boolean;
  visibilityKnown: boolean;
  visible: boolean;
  documentVisible: boolean;
}) {
  if (input.manuallyPaused || !input.documentVisible) return false;
  return !input.visibilityKnown || input.visible;
}

export function shouldRunFlashEffectTimer(input: {
  visibleFlashMessage: boolean;
  previewVisible: boolean;
  documentVisible: boolean;
}) {
  return input.documentVisible && (input.visibleFlashMessage || input.previewVisible);
}
