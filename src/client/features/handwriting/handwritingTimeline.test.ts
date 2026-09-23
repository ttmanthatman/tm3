import assert from "node:assert/strict";
import test from "node:test";
import type { HandwritingPayload } from "@shared/handwriting";
import { buildHandwritingTimeline, visiblePointCountAt } from "./handwritingTimeline.js";

function payload(characters: Array<Array<Array<[number, number, number]>>>): HandwritingPayload {
  return {
    kind: "handwriting",
    version: 1,
    characters: characters.map((strokes) => ({ strokes: strokes.map((points) => ({ points })) }))
  };
}

test("timeline preserves stroke order, compresses long idle gaps and accelerates long playback", () => {
  const timeline = buildHandwritingTimeline(payload([
    [[[0, 0, 0], [10, 10, 20]], [[20, 20, 2_000], [30, 30, 2_010]]],
    [[[40, 40, 0]]]
  ]));
  assert.equal(timeline.events.length, 5);
  assert.equal(timeline.events[0].at, 0);
  assert.equal(timeline.events[1].at, 20);
  assert.equal(timeline.events[2].at, 520);
  assert.equal(timeline.events[3].at, 530);
  assert.equal(timeline.events[4].at, 780);
  assert.equal(visiblePointCountAt(timeline, 0), 1);
  assert.equal(visiblePointCountAt(timeline, 20), 2);
  assert.equal(visiblePointCountAt(timeline, 780), 5);
  const long = buildHandwritingTimeline(payload([[[[0, 0, 0], [1, 1, 20_000]]]]));
  assert.equal(long.durationMs, 15_000);
  assert.equal(long.events[1].at, 15_000);
});

test("single point strokes and zero intervals remain drawable without negative timing", () => {
  const timeline = buildHandwritingTimeline(payload([[[[0, 0, 0]], [[1, 1, 0]]], [[[2, 2, 0]]]]));
  assert.deepEqual(timeline.events.map((event) => event.at), [0, 0, 250]);
  assert.equal(visiblePointCountAt(timeline, -10), 0);
  assert.equal(visiblePointCountAt(timeline, Number.NaN), 0);
});
