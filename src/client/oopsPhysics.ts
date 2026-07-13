import type { Body } from "matter-js";

type MatterSleepingApi = {
  Sleeping: {
    set(body: Body, isSleeping: boolean): void;
  };
};

const RETURN_SETTLE_DELAY_MS = 420;
const RETURN_SETTLE_DISTANCE_PX = 1.2;

export function keepReturningBodyAwake(matter: MatterSleepingApi, body: Body) {
  matter.Sleeping.set(body, false);
}

export function returnHasSettled(elapsedMs: number, remainingDistances: readonly number[]) {
  return elapsedMs >= RETURN_SETTLE_DELAY_MS
    && remainingDistances.length > 0
    && remainingDistances.every((distance) => distance <= RETURN_SETTLE_DISTANCE_PX);
}
