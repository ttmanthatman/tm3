import assert from "node:assert/strict";
import test from "node:test";
import { HANDWRITING_DEFAULT_BRUSH, type HandwritingPoint, type HandwritingStroke } from "@shared/handwriting";
import { brushSampleEdges, handwritingBrushGeometry } from "./handwritingBrush.js";

function line(interval: number, lag = 35): HandwritingStroke {
  return { brush: { ...HANDWRITING_DEFAULT_BRUSH, lag }, points: Array.from({ length: 81 }, (_, i) => [1000 + i * 80, 3000, i * interval]) };
}

function stateWithoutStationaryTime(stroke: HandwritingStroke) {
  const geometry = handwritingBrushGeometry(stroke);
  assert.ok(geometry.state);
  const { stationaryMs: _stationaryMs, ...state } = geometry.state;
  return state;
}

test("brush opens on slow motion and narrows on fast motion", () => {
  const slow = handwritingBrushGeometry(line(32)).samples.at(-1)!;
  const fast = handwritingBrushGeometry(line(2)).samples.at(-1)!;
  assert.ok(slow.width > fast.width * 2);
  assert.ok(fast.width > 0);
});

test("immediate movement starts at a sharp tip and expands along travel", () => {
  const stroke: HandwritingStroke = {
    brush: { ...HANDWRITING_DEFAULT_BRUSH, size: 100, sensitivity: 0, lag: 0 },
    points: [[0, 0, 0], [240, 0, 16], [900, 0, 72], [1800, 0, 144]]
  };
  const samples = handwritingBrushGeometry(stroke).samples;
  const maxWidth = 120 + 100 * 12;
  assert.ok(samples[0].width <= maxWidth * 0.08);
  assert.ok(samples[0].contact <= 0.12);
  assert.ok(samples.at(-1)!.width > samples[0].width * 4);
  assert.ok(samples.at(-1)!.spread > samples[0].spread * 3);
});

test("three-hundred-millisecond initial dwell presses and spreads the footprint", () => {
  const stroke: HandwritingStroke = {
    brush: { ...HANDWRITING_DEFAULT_BRUSH, size: 80, sensitivity: 0, lag: 0 },
    points: [[100, 100, 0], [100, 100, 300]]
  };
  const samples = handwritingBrushGeometry(stroke).samples;
  const first = samples[0];
  const pressed = samples.at(-1)!;
  assert.equal(first.phase, "touching");
  assert.equal(pressed.phase, "pressing");
  assert.ok(pressed.width > first.width * 3);
  assert.ok(pressed.contact > first.contact * 4);
  assert.ok(pressed.spread > first.spread * 3);
});

test("adaptive input smoothing suppresses one-to-two-pixel line jitter", () => {
  const points: HandwritingPoint[] = Array.from({ length: 81 }, (_, index): HandwritingPoint => [
    index * 80,
    3000 + (index % 4 === 0 ? 20 : index % 4 === 2 ? -20 : 0),
    index * 8
  ]);
  const samples = handwritingBrushGeometry({ brush: { ...HANDWRITING_DEFAULT_BRUSH, lag: 0 }, points }).samples.slice(20);
  const angleError = Math.max(...samples.map((sample) => Math.abs(Math.atan2(Math.sin(sample.angle), Math.cos(sample.angle)))));
  const widths = samples.map((sample) => sample.width);
  const widthSpread = Math.max(...widths) / Math.max(1, Math.min(...widths));
  assert.ok(angleError < 0.08);
  assert.ok(widthSpread < 1.35);
});

test("arc-length simulation keeps sample spacing bounded and density independent", () => {
  const coarse = handwritingBrushGeometry(line(8));
  for (let index = 1; index < coarse.samples.length; index += 1) {
    const distance = Math.hypot(coarse.samples[index].x - coarse.samples[index - 1].x, coarse.samples[index].y - coarse.samples[index - 1].y);
    assert.ok(distance <= 32.01);
  }
  const denseStroke: HandwritingStroke = {
    brush: { ...HANDWRITING_DEFAULT_BRUSH },
    points: Array.from({ length: 321 }, (_, index): HandwritingPoint => [1000 + index * 20, 3000, index * 2])
  };
  const dense = handwritingBrushGeometry(denseStroke);
  const coarseEnd = coarse.samples.at(-1)!;
  const denseEnd = dense.samples.at(-1)!;
  assert.ok(Math.abs(coarseEnd.width - denseEnd.width) < 10);
  assert.ok(Math.abs(coarseEnd.angle - denseEnd.angle) < 0.06);
});

test("tip trails a corner, and zero lag follows the input exactly", () => {
  const stroke = line(8);
  stroke.points.push([7400, 3400, 648]);
  const tip = handwritingBrushGeometry(stroke).samples.at(-1)!;
  assert.ok(tip.x < 7400 && tip.y < 3400);
  const noLag = line(8, 0);
  noLag.points.push([7400, 3400, 648]);
  const direct = handwritingBrushGeometry(noLag).samples.at(-1)!;
  assert.equal(direct.x, 7400);
  assert.equal(direct.y, 3400);
});

test("stationary time does not relax brush deformation", () => {
  const stroke = line(8);
  const before = { ...handwritingBrushGeometry(stroke).samples.at(-1)! };
  stroke.points.push([stroke.points.at(-1)![0], stroke.points.at(-1)![1], stroke.points.at(-1)![2] + 2000]);
  const after = handwritingBrushGeometry(stroke).samples.at(-1)!;
  assert.deepEqual(after, before);
});

test("different stationary durations produce the same brush samples", () => {
  const a = line(8);
  const b = line(8);
  a.points.push([a.points.at(-1)![0], a.points.at(-1)![1], a.points.at(-1)![2] + 100]);
  b.points.push([b.points.at(-1)![0], b.points.at(-1)![1], b.points.at(-1)![2] + 5000]);
  assert.deepEqual(handwritingBrushGeometry(a).samples, handwritingBrushGeometry(b).samples);
});

test("a long pause followed by straight travel does not trigger virtual lift", () => {
  const stroke = line(8);
  const last = stroke.points.at(-1)!;
  stroke.points.push([last[0], last[1], last[2] + 2000]);
  for (let index = 1; index <= 10; index += 1) stroke.points.push([last[0] + index * 80, last[1], last[2] + 2008 + index * 8]);
  const geometry = handwritingBrushGeometry(stroke);
  assert.ok(geometry.state);
  assert.equal(geometry.state.phase, "writing");
  assert.ok(geometry.state.contact > 0.98);
  const writingIndex = geometry.samples.findIndex((sample) => sample.phase === "writing");
  assert.ok(writingIndex > 0);
  assert.ok(geometry.samples.slice(writingIndex).every((sample) => sample.phase === "writing"));
});

test("a ninety-degree turn rotates the brush gradually", () => {
  const stroke: HandwritingStroke = {
    brush: { ...HANDWRITING_DEFAULT_BRUSH },
    points: Array.from({ length: 13 }, (_, index): HandwritingPoint => [index * 80, 2000, index * 8])
  };
  const cornerTime = stroke.points.at(-1)![2];
  for (let index = 1; index <= 12; index += 1) stroke.points.push([960, 2000 + index * 80, cornerTime + index * 8]);
  const samples = handwritingBrushGeometry(stroke).samples;
  const firstTurn = samples.findIndex((sample) => sample.y > 2000);
  assert.ok(firstTurn > 0);
  assert.ok(Math.abs(samples[firstTurn].angle) < Math.PI / 3);
  assert.ok(Math.abs(samples.at(-1)!.angle) > Math.PI / 3);
  for (let index = 1; index < samples.length; index += 1) {
    const delta = Math.abs(Math.atan2(Math.sin(samples[index].angle - samples[index - 1].angle), Math.cos(samples[index].angle - samples[index - 1].angle)));
    assert.ok(delta < Math.PI / 4);
  }
});

test("pause plus a sharp turn lifts more than an immediate turn", () => {
  function turn(paused: boolean) {
    const stroke: HandwritingStroke = {
      brush: { ...HANDWRITING_DEFAULT_BRUSH },
      points: Array.from({ length: 13 }, (_, index): HandwritingPoint => [index * 80, 2000, index * 8])
    };
    const last = stroke.points.at(-1)!;
    if (paused) stroke.points.push([last[0], last[1], last[2] + 2000]);
    for (let index = 1; index <= 8; index += 1) stroke.points.push([last[0], last[1] + index * 80, last[2] + (paused ? 2008 : 8) + index * 8]);
    return Math.min(...handwritingBrushGeometry(stroke).samples.slice(-40).map((sample) => sample.contact));
  }
  assert.ok(turn(true) < turn(false) - 0.15);
});

test("stationary points never change orientation", () => {
  const stroke = line(8);
  const before = handwritingBrushGeometry(stroke).samples.at(-1)!.angle;
  let time = stroke.points.at(-1)![2];
  for (let index = 0; index < 5; index += 1) {
    time += 1000;
    stroke.points.push([stroke.points.at(-1)![0], stroke.points.at(-1)![1], time]);
  }
  assert.equal(handwritingBrushGeometry(stroke).samples.at(-1)!.angle, before);
});

test("lag controls the spatial length of a turn", () => {
  function turnDistance(lag: number) {
    const stroke: HandwritingStroke = {
      brush: { ...HANDWRITING_DEFAULT_BRUSH, lag },
      points: Array.from({ length: 13 }, (_, index): HandwritingPoint => [index * 80, 2000, index * 8])
    };
    const cornerTime = stroke.points.at(-1)![2];
    for (let index = 1; index <= 30; index += 1) stroke.points.push([960, 2000 + index * 80, cornerTime + index * 8]);
    const samples = handwritingBrushGeometry(stroke).samples;
    return samples.findIndex((sample) => sample.y > 2000 && Math.abs(Math.PI / 2 - sample.angle) < Math.PI / 12);
  }
  assert.ok(turnDistance(100) > turnDistance(0));
  assert.ok(turnDistance(100) > turnDistance(35));
});

test("sample refinement keeps comparable position, width, angle and contact", () => {
  const coarse = handwritingBrushGeometry(line(8)).samples.at(-1)!;
  const denseStroke: HandwritingStroke = {
    brush: { ...HANDWRITING_DEFAULT_BRUSH },
    points: Array.from({ length: 161 }, (_, i) => [1000 + i * 40, 3000, i * 4])
  };
  const dense = handwritingBrushGeometry(denseStroke).samples.at(-1)!;
  assert.ok(Math.abs(dense.width - coarse.width) < 8);
  assert.ok(Math.abs(dense.x - coarse.x) < 35);
  assert.ok(Math.abs(dense.angle - coarse.angle) < 0.08);
  assert.ok(Math.abs(dense.contact - coarse.contact) < 0.04);
});

test("incremental geometry is identical to a fresh replay, including dots and equal timestamps", () => {
  const stroke: HandwritingStroke = { brush: { ...HANDWRITING_DEFAULT_BRUSH }, points: [[100, 200, 0]] };
  const first = handwritingBrushGeometry(stroke).samples[0];
  assert.ok(first.width > 0);
  stroke.points.push([100, 200, 0], [600, 400, 0], [900, 1200, 80]);
  const live = handwritingBrushGeometry(stroke);
  const replay = handwritingBrushGeometry(structuredClone(stroke));
  assert.deepEqual(live, replay);
  assert.equal(live.samples[0], first);
  assert.ok(live.samples.every((sample) => Object.values(sample).every((value) => typeof value !== "number" || Number.isFinite(value))));
});

test("absolute timestamp offsets do not change geometry", () => {
  const base: HandwritingPoint[] = [[0, 0, 0], [100, 0, 8], [100, 100, 16], [220, 100, 24]];
  const shifted = base.map(([x, y, t]) => [x, y, t + 10000] as HandwritingPoint);
  const a = handwritingBrushGeometry({ brush: { ...HANDWRITING_DEFAULT_BRUSH }, points: base });
  const b = handwritingBrushGeometry({ brush: { ...HANDWRITING_DEFAULT_BRUSH }, points: shifted });
  assert.deepEqual(a.samples, b.samples);
});

test("different pause durations with identical travel do not change trail", () => {
  const a = line(8);
  const b = line(8);
  a.points.push([a.points.at(-1)![0], a.points.at(-1)![1], a.points.at(-1)![2] + 200]);
  b.points.push([b.points.at(-1)![0], b.points.at(-1)![1], b.points.at(-1)![2] + 8000]);
  const aTrail = handwritingBrushGeometry(a).samples.at(-1)!;
  const bTrail = handwritingBrushGeometry(b).samples.at(-1)!;
  assert.equal(aTrail.trailX, bTrail.trailX);
  assert.equal(aTrail.trailY, bTrail.trailY);
  assert.deepEqual(stateWithoutStationaryTime(a), stateWithoutStationaryTime(b));
});

test("degenerate paths and one-hundred-eighty-degree returns stay finite", () => {
  const points: HandwritingPoint[] = [
    [10, 10, 0], [10, 10, 0], [20, 10, 0], [10, 10, 0], [10, 10, 0], [-500, 10, 2], [-500, 10, 2]
  ];
  const geometry = handwritingBrushGeometry({ brush: { ...HANDWRITING_DEFAULT_BRUSH }, points });
  assert.ok(geometry.samples.length > 0);
  assert.ok(geometry.samples.every((sample) => Object.values(sample).every((value) => typeof value !== "number" || Number.isFinite(value))));
});

test("brush edge generation stays inside the configured width envelope", () => {
  const stroke: HandwritingStroke = {
    brush: { ...HANDWRITING_DEFAULT_BRUSH, size: 50 },
    points: [[0, 0, 0], [800, 0, 80], [800, 800, 160]]
  };
  const samples = handwritingBrushGeometry(stroke).samples;
  const edges = brushSampleEdges(samples);
  for (let index = 0; index < samples.length; index += 1) {
    const width = Math.hypot(edges.left[index].x - edges.right[index].x, edges.left[index].y - edges.right[index].y);
    assert.ok(width <= samples[index].width * 1.2 + 1);
  }
});
