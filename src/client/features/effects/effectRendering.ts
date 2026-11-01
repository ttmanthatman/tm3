export const EFFECT_FRAME_RATE = 30;
export const EFFECT_MAX_DPR = 1.25;
export const DRIP_PARTICLE_LIMIT = 48;
export const DRIP_SOURCE_LIMIT = 3;

/** Skip paints without changing animation speed or catching up after a pause. */
export function createEffectClock() {
  let previous: number | undefined;
  let next = 0;
  const interval = 1000 / EFFECT_FRAME_RATE;
  return {
    advance(now: number): number | null {
      if (previous !== undefined && now < next - 0.5) return null;
      const seconds = previous === undefined ? 1 / EFFECT_FRAME_RATE : Math.min(0.05, Math.max(0, (now - previous) / 1000));
      next = previous === undefined ? now + interval : next + Math.max(1, Math.floor((now - next) / interval) + 1) * interval;
      previous = now;
      return seconds;
    },
    reset() { previous = undefined; next = 0; }
  };
}
