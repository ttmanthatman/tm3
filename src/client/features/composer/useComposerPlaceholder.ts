import { ref } from "vue";

export type ComposerPlaceholderPhase = "idle" | "appear" | "hold" | "disappear";

export type ComposerPlaceholderSources = {
  getPrompts: () => string[];
  getHoldSeconds: () => number;
  getAppearSeconds: () => number;
  getDisappearSeconds: () => number;
  getGapSeconds: () => number;
};

/**
 * Rotates composer prompt overlays through appear → hold → disappear → gap.
 * The client renders `text` letter by letter: characters light up left to
 * right during "appear" and dim left to right during "disappear", each phase
 * paced by its own configured duration. The timer pauses while the document
 * is hidden and must be stopped via stop() on unmount.
 */
export function useComposerPlaceholder(sources: ComposerPlaceholderSources) {
  const text = ref("");
  const phase = ref<ComposerPlaceholderPhase>("idle");
  let promptIndex = 0;
  let timer = 0;

  function activePrompts(): string[] {
    return sources.getPrompts();
  }

  function clearTimer() {
    window.clearTimeout(timer);
    timer = 0;
  }

  function schedule(next: () => void, seconds: number) {
    clearTimer();
    timer = window.setTimeout(next, Math.max(0, seconds) * 1000);
  }

  function beginPrompt() {
    const prompts = activePrompts();
    if (prompts.length === 0) {
      text.value = "";
      phase.value = "idle";
      schedule(beginPrompt, sources.getGapSeconds());
      return;
    }
    text.value = prompts[promptIndex % prompts.length] || "";
    phase.value = "appear";
    schedule(beginHold, sources.getAppearSeconds());
  }

  function beginHold() {
    phase.value = "hold";
    schedule(beginDisappear, sources.getHoldSeconds());
  }

  function beginDisappear() {
    phase.value = "disappear";
    schedule(beginGap, sources.getDisappearSeconds());
  }

  function beginGap() {
    text.value = "";
    phase.value = "idle";
    promptIndex += 1;
    schedule(beginPrompt, sources.getGapSeconds());
  }

  function restart() {
    clearTimer();
    promptIndex = 0;
    text.value = "";
    phase.value = "idle";
    schedule(beginPrompt, sources.getGapSeconds());
  }

  function onVisibilityChange() {
    if (document.hidden) clearTimer();
    else restart();
  }

  document.addEventListener("visibilitychange", onVisibilityChange);
  schedule(beginPrompt, sources.getGapSeconds());

  function stop() {
    clearTimer();
    document.removeEventListener("visibilitychange", onVisibilityChange);
  }

  return { text, phase, stop };
}
