import assert from "node:assert/strict";
import test from "node:test";
import { createHandwritingDraftScheduler } from "./handwritingDraftScheduler.js";

test("coalesces point updates and flushes the latest draft at stroke end", () => {
  const callbacks = new Map<number, () => void>();
  let nextTimer = 1;
  let saves = 0;
  const scheduler = createHandwritingDraftScheduler({
    persist: () => { saves += 1; },
    schedule: (callback) => {
      const timer = nextTimer++;
      callbacks.set(timer, callback);
      return timer;
    },
    cancel: (timer) => { callbacks.delete(timer as number); }
  });

  for (let index = 0; index < 200; index += 1) scheduler.request();
  assert.equal(callbacks.size, 1);
  assert.equal(saves, 0);

  scheduler.flush();
  assert.equal(callbacks.size, 0);
  assert.equal(saves, 1);
  scheduler.flush();
  assert.equal(saves, 2);
});
