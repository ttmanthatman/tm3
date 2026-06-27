export type ChatPanel = "future" | "main" | "ai";
export type SwipeAxis = "x" | "y";

export const PANEL_ORDER = ["future", "main", "ai"] as const;

const AXIS_LOCK_DISTANCE = 12;
const AXIS_DOMINANCE_RATIO = 1.2;
const EDGE_RESISTANCE = 0.35;
const MIN_DISTANCE_THRESHOLD = 96;
const MAX_DISTANCE_THRESHOLD = 180;
const DISTANCE_THRESHOLD_RATIO = 0.28;
const FAST_SWIPE_MIN_DISTANCE = 96;
const FAST_SWIPE_VELOCITY = 1.05;

function panelIndex(panel: ChatPanel) {
  return PANEL_ORDER.indexOf(panel);
}

export function normalizeChatPanel(value: string | null | undefined): ChatPanel {
  return PANEL_ORDER.includes(value as ChatPanel) ? (value as ChatPanel) : "main";
}

export function resolveSwipeAxis(dx: number, dy: number, currentAxis: SwipeAxis | null = null): SwipeAxis | null {
  if (currentAxis) return currentAxis;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (absX < AXIS_LOCK_DISTANCE && absY < AXIS_LOCK_DISTANCE) return null;
  return absX >= Math.max(AXIS_LOCK_DISTANCE, absY * AXIS_DOMINANCE_RATIO) ? "x" : "y";
}

export function panelDragOffset(panel: ChatPanel, dx: number) {
  const idx = panelIndex(panel);
  if ((idx === 0 && dx > 0) || (idx === PANEL_ORDER.length - 1 && dx < 0)) return dx * EDGE_RESISTANCE;
  return dx;
}

export function nextPanelAfterSwipe(options: {
  currentPanel: ChatPanel;
  dx: number;
  dy: number;
  elapsedMs: number;
  viewportWidth: number;
}) {
  const axis = resolveSwipeAxis(options.dx, options.dy);
  if (axis !== "x") return null;

  const currentIndex = panelIndex(options.currentPanel);
  const direction = options.dx < 0 ? 1 : -1;
  const nextIndex = currentIndex + direction;
  if (nextIndex < 0 || nextIndex >= PANEL_ORDER.length) return null;

  const absX = Math.abs(options.dx);
  const threshold = Math.min(
    MAX_DISTANCE_THRESHOLD,
    Math.max(MIN_DISTANCE_THRESHOLD, options.viewportWidth * DISTANCE_THRESHOLD_RATIO)
  );
  const velocity = absX / Math.max(1, options.elapsedMs);
  const farEnough = absX >= threshold;
  const fastEnough = absX >= FAST_SWIPE_MIN_DISTANCE && velocity >= FAST_SWIPE_VELOCITY;

  return farEnough || fastEnough ? PANEL_ORDER[nextIndex] : null;
}

export function panelSwitchDirection(from: ChatPanel, to: ChatPanel) {
  return panelIndex(to) > panelIndex(from) ? 1 : -1;
}
