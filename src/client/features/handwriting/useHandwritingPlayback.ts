import { buildHandwritingTimeline, type HandwritingTimeline } from "./handwritingTimeline";
import { parseStoredHandwritingPayload, type HandwritingPayload } from "@shared/handwriting";

export type HandwritingPlaybackState = {
  playing: boolean;
  progressMs: number;
  visible: boolean;
  surfaceActive: boolean;
};

export type HandwritingPlaybackDependencies = {
  getPayload: () => HandwritingPayload | null;
  draw: (progressMs: number) => void;
  claimAutoPlay?: () => boolean;
  requestFrame?: (callback: (timestamp: number) => void) => number;
  cancelFrame?: (handle: number) => void;
  now?: () => number;
  isDocumentVisible?: () => boolean;
  reducedMotion?: () => boolean;
  observeVisibility?: (element: Element, callback: (visible: boolean) => void) => () => void;
  onAutoPlayDeclined?: () => void;
  onStateChange?: (state: HandwritingPlaybackState) => void;
};

export function createHandwritingPlaybackController(dependencies: HandwritingPlaybackDependencies) {
  const requestFrame = dependencies.requestFrame || ((callback) => requestAnimationFrame(callback));
  const cancelFrame = dependencies.cancelFrame || ((handle) => cancelAnimationFrame(handle));
  const now = dependencies.now || (() => performance.now());
  const isDocumentVisible = dependencies.isDocumentVisible || (() => document.visibilityState === "visible");
  const reducedMotion = dependencies.reducedMotion || (() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  let timeline: HandwritingTimeline = { events: [], durationMs: 0 };
  let frame = 0;
  let lastFrameAt = 0;
  let playing = false;
  let progressMs = 0;
  let visible = false;
  let surfaceActive = true;
  let resumeOnVisibility = false;
  let unobserve: (() => void) | null = null;
  let mountedElement: Element | null = null;

  function state(): HandwritingPlaybackState {
    return { playing, progressMs, visible, surfaceActive };
  }

  function publish() {
    dependencies.onStateChange?.(state());
  }

  function rebuildTimeline() {
    const payload = dependencies.getPayload();
    timeline = payload ? buildHandwritingTimeline(payload) : { events: [], durationMs: 0 };
  }

  function cancelFrameLoop() {
    if (frame) cancelFrame(frame);
    frame = 0;
  }

  function finish() {
    cancelFrameLoop();
    playing = false;
    progressMs = timeline.durationMs;
    dependencies.draw(progressMs);
    publish();
  }

  function frameStep() {
    if (!playing) return;
    const current = now();
    const delta = Math.max(0, current - lastFrameAt);
    lastFrameAt = current;
    progressMs = Math.min(timeline.durationMs, progressMs + delta);
    dependencies.draw(progressMs);
    if (progressMs >= timeline.durationMs) {
      finish();
      return;
    }
    frame = requestFrame(frameStep);
    publish();
  }

  function play(fromStart = true) {
    rebuildTimeline();
    if (!timeline.durationMs) {
      dependencies.draw(0);
      return false;
    }
    cancelFrameLoop();
    if (fromStart) progressMs = 0;
    playing = true;
    resumeOnVisibility = false;
    lastFrameAt = now();
    dependencies.draw(progressMs);
    frame = requestFrame(frameStep);
    publish();
    return true;
  }

  function pause(resumeWhenVisible = false) {
    cancelFrameLoop();
    if (playing) resumeOnVisibility = resumeWhenVisible;
    playing = false;
    publish();
  }

  function canAutoPlay() {
    return visible && surfaceActive && isDocumentVisible() && !reducedMotion();
  }

  function tryAutoPlay() {
    if (playing) return true;
    if (!canAutoPlay()) return false;
    if (!dependencies.claimAutoPlay?.()) return false;
    return play(true);
  }

  function visibilityChanged(nextVisible: boolean) {
    visible = nextVisible;
    if (!visible) {
      pause(true);
      return false;
    } else if (resumeOnVisibility && surfaceActive && isDocumentVisible()) {
      return play(false);
    } else if (!tryAutoPlay()) {
      dependencies.onAutoPlayDeclined?.();
      return false;
    }
    return playing;
  }

  function handleVisibilityChange() {
    if (!isDocumentVisible()) pause(true);
    else if (visible && resumeOnVisibility && surfaceActive) play(false);
    publish();
  }

  function handlePageHide() {
    destroy();
  }

  function setSurfaceActive(active: boolean) {
    surfaceActive = active;
    if (!active) pause(true);
    else if (visible && resumeOnVisibility && isDocumentVisible()) play(false);
    publish();
  }

  function setPayload() {
    const wasPlaying = playing;
    cancelFrameLoop();
    playing = false;
    progressMs = 0;
    resumeOnVisibility = false;
    rebuildTimeline();
    dependencies.draw(0);
    if (wasPlaying) play(true);
    publish();
  }

  function mount(element: Element) {
    destroy();
    mountedElement = element;
    if (dependencies.observeVisibility) {
      unobserve = dependencies.observeVisibility(element, visibilityChanged);
    } else if (typeof IntersectionObserver !== "undefined") {
      const observer = new IntersectionObserver((entries) => visibilityChanged(entries.some((entry) => entry.isIntersecting)), {
        rootMargin: "120px 0px",
        threshold: 0.01
      });
      observer.observe(element);
      unobserve = () => observer.disconnect();
    }
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", handleVisibilityChange);
    if (typeof window !== "undefined") window.addEventListener("pagehide", handlePageHide, { once: true });
  }

  function destroy() {
    cancelFrameLoop();
    playing = false;
    resumeOnVisibility = false;
    unobserve?.();
    unobserve = null;
    if (mountedElement) {
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (typeof window !== "undefined") window.removeEventListener("pagehide", handlePageHide);
      mountedElement = null;
    }
    publish();
  }

  rebuildTimeline();
  return {
    state,
    play,
    pause,
    tryAutoPlay,
    visibilityChanged,
    setSurfaceActive,
    setPayload,
    mount,
    destroy
  };
}

export function handwritingGridMetrics(payload: HandwritingPayload | null | undefined, viewportWidth = 1280) {
  const count = Math.max(1, payload?.characters.length || 1);
  const availableWidth = viewportWidth >= 768 ? 360 : Math.max(180, viewportWidth - 106);
  const columns = Math.max(1, Math.min(6, count, Math.floor(availableWidth / 54)));
  const rows = Math.ceil(count / columns);
  return { columns, rows, count, maxColumns: 6 };
}

export function handwritingMessageEstimatedHeight(payload: unknown, viewportWidth = 1280) {
  const { columns, rows } = handwritingGridMetrics(parseStoredHandwritingPayload(payload), viewportWidth);
  const available = viewportWidth >= 768 ? 360 : Math.max(180, viewportWidth - 106);
  const gridWidth = Math.min(360, columns * 54, available);
  const cell = gridWidth / columns;
  return Math.ceil(25 + rows * cell);
}
