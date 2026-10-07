import assert from "node:assert/strict";
import test from "node:test";
import { copyworkTapRegion, createCopyworkGestures } from "./copyworkGestures";

function harness(paging = false) {
  let at = 0;
  let playing = false;
  let progress = 500;
  let pending: (() => void) | null = null;
  const calls: string[] = [];
  const gestures = createCopyworkGestures({
    paging: () => paging,
    playing: () => playing,
    progress: () => progress,
    duration: () => 1000,
    toggle: () => {
      playing = !playing;
      calls.push("toggle");
    },
    restart: () => {
      playing = true;
      progress = 0;
      calls.push("restart");
    },
    pause: () => {
      playing = false;
      calls.push("pause");
    },
    resume: () => {
      playing = true;
      calls.push("resume");
    },
    seek: (value) => {
      progress = value;
      calls.push("seek");
    },
    turn: (direction) => calls.push(direction === -1 ? "previous" : "next"),
    now: () => at,
    schedule: (callback) => {
      pending = callback;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    },
    unschedule: () => {
      pending = null;
    }
  });
  const point = (x = 140, y = 10) => ({ id: 1, x, y, width: 280 });
  return {
    gestures,
    calls,
    point,
    tap(x = 140) {
      gestures.down(point(x));
      gestures.up(point(x));
    },
    wait() {
      at += 300;
      pending?.();
    },
    advance(ms: number) {
      at += ms;
    },
    progress: () => progress,
    playing: () => playing
  };
}

test("only the edges turn pages; the right half is still the playback area", () => {
  assert.equal(copyworkTapRegion(0, 280, true), "previous");
  assert.equal(copyworkTapRegion(278, 280, true), "next");
  assert.equal(copyworkTapRegion(210, 280, true), "playback");
  assert.equal(copyworkTapRegion(0, 280, false), "playback");
  const h = harness(true);
  h.tap(2);
  h.tap(278);
  h.tap(210);
  h.wait();
  assert.deepEqual(h.calls, ["previous", "next", "toggle"]);
});
test("single tap toggles, double tap restarts once, including touch capture release", () => {
  const h = harness();
  h.tap();
  h.gestures.lostCapture();
  h.wait();
  assert.equal(h.playing(), true);
  h.tap();
  h.wait();
  assert.equal(h.playing(), false);
  h.tap();
  h.advance(80);
  h.tap();
  h.wait();
  assert.deepEqual(h.calls, ["toggle", "toggle", "restart"]);
  assert.equal(h.progress(), 0);
});
test("horizontal drag scrubs without a click or page turn and preserves play state", () => {
  const h = harness(true);
  h.tap();
  h.wait();
  h.gestures.down(h.point());
  assert.equal(h.gestures.move(h.point(210)), true);
  h.gestures.up(h.point(210));
  h.wait();
  assert.equal(h.progress(), 750);
  assert.deepEqual(h.calls, ["toggle", "pause", "seek", "resume"]);
  h.tap();
  h.wait();
  h.gestures.down(h.point());
  h.gestures.move(h.point(70));
  h.gestures.up(h.point(70));
  assert.equal(h.playing(), false);
  assert.equal(h.progress(), 500);
});
test("vertical scrolling and cancelled/offscreen gestures do not replay or turn pages", () => {
  const h = harness(true);
  h.gestures.down(h.point());
  assert.equal(h.gestures.move(h.point(141, 60)), false);
  h.gestures.up(h.point(141, 60));
  h.wait();
  h.tap();
  h.gestures.cancel();
  h.wait();
  assert.deepEqual(h.calls, []);
});
