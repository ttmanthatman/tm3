import type { Body } from "matter-js";

type MatterSleepingApi = {
  Sleeping: {
    set(body: Body, isSleeping: boolean): void;
  };
};

type MatterMotionApi = MatterSleepingApi & {
  Body: {
    setVelocity(body: Body, velocity: { x: number; y: number }): void;
  };
};

type MotionVector = { x: number; y: number };

const RETURN_SETTLE_DELAY_MS = 420;
const RETURN_SETTLE_DISTANCE_PX = 1.2;

export function keepReturningBodyAwake(matter: MatterSleepingApi, body: Body) {
  matter.Sleeping.set(body, false);
}

export function isBodyRestingOnTop(body: Body, obstacle: Body) {
  const horizontalOverlap = Math.min(body.bounds.max.x, obstacle.bounds.max.x) - Math.max(body.bounds.min.x, obstacle.bounds.min.x);
  const verticalGap = body.bounds.max.y - obstacle.bounds.min.y;
  return horizontalOverlap > 1 && body.position.y < obstacle.position.y && verticalGap >= -12 && verticalGap <= 14;
}

export function releaseBodyFromMovingObstacle(
  matter: MatterMotionApi,
  body: Body,
  obstacle: Body,
  motion: MotionVector,
  random: () => number = Math.random
) {
  matter.Sleeping.set(body, false);
  const motionSpeed = Math.hypot(motion.x, motion.y);
  const outwardDirection = body.position.x < obstacle.position.x ? -1 : 1;
  const outwardSpeed = 2.4 + Math.min(5.6, motionSpeed * 0.055);
  const carryX = Math.max(-3, Math.min(3, motion.x * 0.06));
  const jitterX = (random() - 0.5) * 1.2;
  const transferredY = Math.max(-4, Math.min(4, motion.y * 0.055));
  matter.Body.setVelocity(body, {
    x: body.velocity.x * 0.25 + outwardDirection * outwardSpeed + carryX + jitterX,
    y: motion.y < -1 ? transferredY : Math.max(1.1, transferredY)
  });
}

export function returnHasSettled(elapsedMs: number, remainingDistances: readonly number[]) {
  return elapsedMs >= RETURN_SETTLE_DELAY_MS
    && remainingDistances.length > 0
    && remainingDistances.every((distance) => distance <= RETURN_SETTLE_DISTANCE_PX);
}
