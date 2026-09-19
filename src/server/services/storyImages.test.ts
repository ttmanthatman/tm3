import test from "node:test";
import assert from "node:assert/strict";
import { createStoryImageProcessor, StoryImageBusyError, writeStoryImage } from "./storyImages.js";

test("image decoder has one active slot, three waiting slots, and cancels queued work", async () => {
  const started: string[] = [];
  const finish: Array<() => void> = [];
  const convert = createStoryImageProcessor(async (input) => {
    started.push(input);
    await new Promise<void>((resolve) => finish.push(resolve));
  });
  const first = convert("first", "unused");
  await new Promise((resolve) => setImmediate(resolve));
  const abort = new AbortController();
  const second = convert("cancelled", "unused", abort.signal);
  const secondRejected = assert.rejects(second, { name: "AbortError" });
  const third = convert("third", "unused");
  const fourth = convert("fourth", "unused");
  await assert.rejects(convert("overflow", "unused"), StoryImageBusyError);
  assert.deepEqual(started, ["first"]);
  abort.abort();
  await secondRejected;
  finish.shift()!(); await first;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ["first", "third"]);
  finish.shift()!(); await third;
  await new Promise((resolve) => setImmediate(resolve));
  finish.shift()!(); await fourth;
  assert.deepEqual(started, ["first", "third", "fourth"]);
});

test("failed or aborted decoding releases the shared slot", async () => {
  let calls = 0;
  const convert = createStoryImageProcessor(async (_input, _output, signal) => {
    calls++;
    signal?.throwIfAborted();
    if (calls === 1) throw new Error("decoder exit failure");
  });
  await assert.rejects(convert("first", "unused"), /decoder exit failure/);
  await convert("second", "unused");
  assert.equal(calls, 2);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(writeStoryImage("must-not-read", "must-not-write", abort.signal), { name: "AbortError" });
});
