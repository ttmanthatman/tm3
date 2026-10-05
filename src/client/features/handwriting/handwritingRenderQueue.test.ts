import assert from "node:assert/strict";
import test from "node:test";
import { createHandwritingRenderQueue } from "./handwritingRenderQueue.js";

function harness() {
  let time = 0;
  let callback: (() => void) | null = null;
  const queue = createHandwritingRenderQueue({
    requestFrame: (next) => { callback = next; return 1; },
    cancelFrame: () => { callback = null; },
    now: () => time
  });
  return {
    queue,
    spend(ms: number) { time += ms; },
    frame() { const next = callback; callback = null; next?.(); },
    hasFrame: () => !!callback
  };
}

test("visible messages share a bounded frame budget and yield after a costly character", () => {
  const h = harness();
  const drawn: number[] = [];
  for (let i = 0; i < 3; i++) h.queue.enqueue({}, () => { drawn.push(i); h.spend(50); });
  assert.deepEqual(drawn, []);
  h.frame();
  assert.deepEqual(drawn, [0]);
  assert.equal(h.hasFrame(), true);
  h.frame();
  h.frame();
  assert.deepEqual(drawn, [0, 1, 2]);
  assert.equal(h.hasFrame(), false);
});

test("replay updates coalesce to the newest points and offscreen or destroyed canvases cancel", () => {
  const h = harness();
  const canvas = {};
  const drawn: number[] = [];
  h.queue.enqueue(canvas, () => drawn.push(1));
  h.queue.enqueue(canvas, () => drawn.push(2));
  h.frame();
  assert.deepEqual(drawn, [2]);
  h.queue.enqueue(canvas, () => drawn.push(3));
  h.queue.cancel(canvas);
  assert.equal(h.hasFrame(), false);
  h.frame();
  assert.deepEqual(drawn, [2]);
});

test("a canceled message does not discard work belonging to another message", () => {
  const h = harness();
  const first = {};
  const second = {};
  const drawn: string[] = [];
  h.queue.enqueue(first, () => drawn.push("first"));
  h.queue.enqueue(second, () => drawn.push("second"));
  h.queue.cancel(first);
  h.frame();
  assert.deepEqual(drawn, ["second"]);
});
