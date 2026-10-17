import assert from "node:assert/strict";
import test from "node:test";
import { createBookSectionQueue } from "./bookSectionQueue";

test("foreground preparation precedes speculative work and duplicate callers share the task", async () => {
  const queue = createBookSectionQueue(1), order: number[] = [];
  let release!: () => void;
  const first = queue.run(0, () => new Promise<void>(resolve => { release = resolve; }));
  const speculative = queue.run(1, async () => { order.push(1); });
  const target = queue.run(2, async () => { order.push(2); }, true);
  assert.equal(queue.run(2, async () => { throw Error("duplicate"); }), target);
  release(); await Promise.all([first, speculative, target]);
  assert.deepEqual(order, [2, 1]);
});

test("invalidated queued work and destruction settle callers without running stale tasks", async () => {
  const queue = createBookSectionQueue(1);
  let release!: () => void;
  const first = queue.run(0, () => new Promise<void>(resolve => { release = resolve; }));
  const obsolete = queue.run(1, async () => { throw Error("stale"); });
  queue.retain(key => key === 0); await obsolete;
  const pending = queue.run(2, async () => { throw Error("closed"); });
  queue.destroy(); await pending; release(); await first;
});
