export type SermonFloatingPoint = { x: number; y: number };
export type SermonFloatingSize = { width: number; height: number };

export function clampSermonFloatingPoint(
  point: SermonFloatingPoint,
  element: SermonFloatingSize,
  viewport: SermonFloatingSize,
  margin = 8
): SermonFloatingPoint {
  return {
    x: Math.min(Math.max(margin, point.x), Math.max(margin, viewport.width - element.width - margin)),
    y: Math.min(Math.max(margin, point.y), Math.max(margin, viewport.height - element.height - margin))
  };
}

export function sermonFloatingMoved(start: SermonFloatingPoint, current: SermonFloatingPoint, threshold = 6): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= threshold;
}
