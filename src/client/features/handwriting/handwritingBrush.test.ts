import assert from "node:assert/strict";
import test from "node:test";
import { HANDWRITING_DEFAULT_BRUSH, type HandwritingStroke } from "@shared/handwriting";
import { handwritingBrushGeometry } from "./handwritingBrush.js";

function line(interval: number, lag = 35): HandwritingStroke {
  return { brush: { ...HANDWRITING_DEFAULT_BRUSH, lag }, points: Array.from({ length: 81 }, (_, i) => [1000 + i * 80, 3000, i * interval]) };
}

test("brush opens on slow motion and narrows on fast motion", () => {
  const slow = handwritingBrushGeometry(line(32)).dabs.at(-1)!;
  const fast = handwritingBrushGeometry(line(2)).dabs.at(-1)!;
  assert.ok(slow.width > fast.width * 2);
  assert.ok(fast.width > 0);
});

test("tip trails a corner, and zero lag follows the input exactly", () => {
  const stroke = line(8);
  stroke.points.push([7400, 3400, 648]);
  const tip = handwritingBrushGeometry(stroke).dabs.at(-1)!;
  assert.ok(tip.x < 7400 && tip.y < 3400);
  const noLag = line(8, 0);
  noLag.points.push([7400, 3400, 648]);
  const direct = handwritingBrushGeometry(noLag).dabs.at(-1)!;
  assert.equal(direct.x, 7400);
  assert.equal(direct.y, 3400);
});

test("incremental geometry is identical to a fresh replay, including dots and equal timestamps", () => {
  const stroke: HandwritingStroke = { brush: { ...HANDWRITING_DEFAULT_BRUSH }, points: [[100, 200, 0]] };
  const first = handwritingBrushGeometry(stroke).dabs[0];
  assert.ok(first.width > 0);
  stroke.points.push([100, 200, 0], [600, 400, 0], [900, 1200, 80]);
  const live = handwritingBrushGeometry(stroke);
  const replay = handwritingBrushGeometry(structuredClone(stroke));
  assert.deepEqual(live, replay);
  assert.equal(live.dabs[0], first);
  assert.ok(live.dabs.every((dab) => Object.values(dab).every(Number.isFinite)));
});

test("sample refinement keeps comparable width and tip position", () => {
  const coarse = handwritingBrushGeometry(line(8)).dabs.at(-1)!;
  const dense: HandwritingStroke = { brush: { ...HANDWRITING_DEFAULT_BRUSH }, points: Array.from({ length: 161 }, (_, i) => [1000 + i * 40, 3000, i * 4]) };
  const tip = handwritingBrushGeometry(dense).dabs.at(-1)!;
  assert.ok(Math.abs(tip.width - coarse.width) < 2);
  assert.ok(Math.abs(tip.x - coarse.x) < 25);
});
