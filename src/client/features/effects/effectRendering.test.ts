import assert from "node:assert/strict";
import test from "node:test";
import { createEffectClock } from "./effectRendering";

test("decoration paints are bounded at 30Hz across 60/120/144Hz displays without slowing time", () => {
  for (const rate of [60, 120, 144]) {
    const clock = createEffectClock();
    const steps: number[] = [];
    for (let frame = 0; frame <= rate * 2; frame += 1) {
      const dt = clock.advance(frame * 1000 / rate);
      if (dt !== null) steps.push(dt);
    }
    assert.ok(steps.length >= 60 && steps.length <= 61, `${rate}Hz: ${steps.length}`);
    assert.ok(Math.abs(steps.reduce((sum, dt) => sum + dt, 0) - 2) <= 0.04);
  }
});

test("a delayed or resumed effect never simulates an unbounded backlog", () => {
  const clock = createEffectClock();
  clock.advance(0);
  assert.equal(clock.advance(5), null);
  assert.equal(clock.advance(5000), 0.05);
  clock.reset();
  assert.equal(clock.advance(100_000), 1 / 30);
  assert.equal(clock.advance(100_001), null);
});
