/** Return the largest uniform scale that keeps a base-sized stage inside its preview frame. */
export function sermonPreviewScale(frameWidth: number, frameHeight: number, baseWidth: number, baseHeight: number): number {
  if (frameWidth <= 0 || frameHeight <= 0 || baseWidth <= 0 || baseHeight <= 0) return 0;
  return Math.min(frameWidth / baseWidth, frameHeight / baseHeight);
}
