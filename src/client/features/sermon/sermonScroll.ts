export type SermonScrollDirection = -1 | 1;

/** 把当前屏滚动一行，并限制在舞台可滚动范围内。 */
export function nextSermonScrollLine(current: number, max: number, direction: SermonScrollDirection): number {
  return Math.min(Math.max(0, max), Math.max(0, current + direction));
}

/** 鼠标滚轮只关心纵向意图；触控板的细小增量也按一行处理。 */
export function sermonWheelDirection(deltaY: number): SermonScrollDirection | 0 {
  if (deltaY === 0) return 0;
  return deltaY > 0 ? 1 : -1;
}
