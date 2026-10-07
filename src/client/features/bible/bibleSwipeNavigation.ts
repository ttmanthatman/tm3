import type { AppearanceDTO } from "@shared/types";

const controls = "button, input, textarea, select, a, video, audio, [contenteditable='true'], [role='button'], [data-no-bible-swipe]";

export function createBibleSwipeNavigation(options: {
  appearance: () => Pick<AppearanceDTO, "bibleSwipeEnabled" | "bibleSwipeProtectInteractions">;
  blocked: () => boolean;
  direction: "left" | "right";
  navigate: () => void;
}) {
  let origin: { x: number; y: number; interaction: boolean } | null = null;
  const cancel = () => { origin = null; };
  const allowed = () => options.appearance().bibleSwipeEnabled !== false && !options.blocked();

  function start(event: TouchEvent) {
    cancel();
    if (!allowed() || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const target = event.target as Element | null;
    const interaction = !!target?.closest?.("[data-bible-swipe-interaction]");
    if (touch.clientX <= 20 || target?.closest?.("[data-no-bible-swipe]")) return;
    if (interaction) {
      if (options.appearance().bibleSwipeProtectInteractions !== false) return;
    } else if (target?.closest?.(controls)) return;
    origin = { x: touch.clientX, y: touch.clientY, interaction };
  }

  function end(event: TouchEvent) {
    const previous = origin;
    cancel();
    if (!previous || !allowed() || event.touches.length || event.changedTouches.length !== 1) return;
    if (previous.interaction && options.appearance().bibleSwipeProtectInteractions !== false) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - previous.x;
    const dy = touch.clientY - previous.y;
    const distance = options.direction === "right" ? dx : -dx;
    if (distance >= 64 && Math.abs(dx) > Math.abs(dy) * 1.4) options.navigate();
  }

  return { start, end, cancel };
}
