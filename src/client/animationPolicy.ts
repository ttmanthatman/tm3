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

export function shouldTriggerIncomingRainEffect(input: {
  effect: string | null;
  messageChannelId: number;
  currentChannelId: number;
  prayerOnly: boolean;
  messageType: string;
  activeView: boolean;
  documentVisible: boolean;
}) {
  return input.effect === "rain"
    && input.messageChannelId === input.currentChannelId
    && (!input.prayerOnly || input.messageType === "prayer")
    && input.activeView
    && input.documentVisible;
}
