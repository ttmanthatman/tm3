export type GravityVector = { x: number; y: number; strength: number };

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
