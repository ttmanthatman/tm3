import type { NibPoint } from "./handwritingTrueBrush";

export type TrueBrushMotion = {
  anchor: NibPoint;
  heading?: number;
  incoming?: number;
  cornerTravel: number;
  reversalFrom?: NibPoint;
};

const DIRECTION_DISTANCE = 64;
const CORNER_DISTANCE = 320;

export function advanceTrueBrushMotion(motion: TrueBrushMotion, point: NibPoint) {
  const dx = point.x - motion.anchor.x;
  const dy = point.y - motion.anchor.y;
  const distance = Math.hypot(dx, dy);
  // Net displacement, rather than event count or accumulated jitter, confirms
  // a direction. Keep the incoming direction across a short corner so several
  // intermediate samples cannot conceal a reversal.
  if (distance < DIRECTION_DISTANCE) return { heading: motion.heading, reversal: false };
  const heading = Math.atan2(dy, dx);
  const delta = motion.incoming === undefined ? 0 : Math.abs(Math.atan2(Math.sin(heading - motion.incoming), Math.cos(heading - motion.incoming)));
  if (delta > Math.PI * 0.75) motion.reversalFrom ??= motion.anchor;
  else motion.reversalFrom = undefined;
  const reversalDistance = motion.reversalFrom ? Math.hypot(point.x - motion.reversalFrom.x, point.y - motion.reversalFrom.y) : 0;
  motion.anchor = { ...point };
  motion.heading = heading;
  motion.cornerTravel += distance;
  const reversal = reversalDistance >= DIRECTION_DISTANCE * 2;
  if (reversal || delta <= Math.PI / 6 || motion.cornerTravel > CORNER_DISTANCE) {
    motion.incoming = heading;
    motion.cornerTravel = 0;
    motion.reversalFrom = undefined;
  }
  return { heading, reversal };
}
