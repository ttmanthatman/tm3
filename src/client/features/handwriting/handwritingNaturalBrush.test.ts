import assert from "node:assert/strict";
import test from "node:test";
import { HANDWRITING_DEFAULT_BRUSH, type HandwritingBrushAlgorithm, type HandwritingPoint, type HandwritingStroke } from "@shared/handwriting";
import { handwritingBrushGeometry } from "./handwritingBrush.js";

function naturalStroke(points: HandwritingPoint[], algorithm: HandwritingBrushAlgorithm = "follow", lag = 100): HandwritingStroke {
  return { brush: { size: 84, sensitivity: 50, lag, algorithm, version: 2 }, points };
}

for (const algorithm of ["follow", "slanted"] as const) {
  test(`${algorithm}: dwell and repeated initial jitter cannot spread a full nib or establish a false heading`, () => {
    const points: HandwritingPoint[] = [[2000, 3000, 0]];
    for (let index = 1; index <= 80; index++) points.push([2000 + (index % 2 ? 30 : -30), 3000 + (index % 3 ? 20 : -20), index * 16]);
    points.push([points.at(-1)![0], points.at(-1)![1], 5000]);
    const geometry = handwritingBrushGeometry(naturalStroke(points, algorithm));
    assert.ok(geometry.samples.every((sample) => !sample.directional));
    assert.ok(geometry.samples.every((sample) => sample.width < (120 + 84 * 12) * 0.15));
    assert.ok(geometry.samples.every((sample) => sample.x === 2000 && sample.y === 3000));
    assert.equal(geometry.state?.startTravel, 0);
  });

  test(`${algorithm}: a hesitant start followed by acceleration joins a narrow body without an oversized head`, () => {
    const points: HandwritingPoint[] = [[2000, 3000, 0], [2030, 3020, 100], [1990, 3000, 250], [2000, 3000, 350]];
    for (let index = 1; index <= 30; index++) points.push([2000 + index * 120, 3000, 350 + index * 8]);
    const samples = handwritingBrushGeometry(naturalStroke(points, algorithm)).samples;
    const start = samples.filter((sample) => !sample.directional);
    const body = samples.filter((sample) => sample.phase === "writing");
    assert.ok(start.length > 1 && body.length > 1);
    assert.ok(Math.max(...start.map((sample) => sample.width)) < Math.max(...body.map((sample) => sample.width)));
    assert.ok(body.at(-1)!.x > 5100);
    const firstDirectional = samples.find((sample) => sample.directional)!;
    assert.ok(Math.abs(firstDirectional.angle - (algorithm === "slanted" ? Math.PI / 4 : 0)) < 0.08);
  });

  test(`${algorithm}: speed changes have bounded outline slopes and lifting at the same position does not add a bulb`, () => {
    const points: HandwritingPoint[] = [[1000, 3000, 0]];
    for (let index = 1; index <= 30; index++) points.push([1000 + index * 80, 3000, index * 40]);
    for (let index = 1; index <= 30; index++) points.push([3400 + index * 160, 3000, 1200 + index * 8]);
    const stroke = naturalStroke(points, algorithm, 0);
    const geometry = handwritingBrushGeometry(stroke);
    const samples = geometry.samples;
    for (let index = 1; index < samples.length; index++) {
      if (!samples[index - 1].directional || !samples[index].directional) continue;
      const distance = Math.hypot(samples[index].handleX - samples[index - 1].handleX, samples[index].handleY - samples[index - 1].handleY);
      assert.ok(Math.abs(samples[index].width - samples[index - 1].width) <= distance * 0.6 + 0.001);
    }
    const slowWidth = samples[geometry.ends[30] - 1].width;
    assert.ok(slowWidth > samples.at(-1)!.width * 1.5);
    const before = structuredClone(samples);
    const last = points.at(-1)!;
    points.push([last[0], last[1], last[2] + 1000]);
    assert.deepEqual(handwritingBrushGeometry(stroke).samples, before);
  });
}

test("natural filtering affects the drawn path and follows faster input with less delay", () => {
  const points: HandwritingPoint[] = Array.from({ length: 80 }, (_, index) => [index * 100, 3000 + (index % 2 ? 25 : -25), index * 8]);
  const geometry = handwritingBrushGeometry(naturalStroke(points, "follow", 0));
  const samples = geometry.samples.slice(-40);
  const endpoints = geometry.ends.slice(-10).map((end) => geometry.samples[end - 1]);
  assert.ok(endpoints.every((sample) => sample.x === sample.inputX && sample.y === sample.inputY));
  assert.ok(samples.every((sample) => Math.abs(sample.y - 3000) < 25));
  assert.ok(samples.at(-1)!.rawX - samples.at(-1)!.x < 100);
  assert.ok(samples.every((sample) => Math.abs(sample.angle) < 0.05));
});

test("natural dots, short hooks and reversals remain visible and finite", () => {
  for (const points of [
    [[1000, 1000, 0]],
    [[1000, 1000, 0], [1000, 1000, 300]],
    [[1000, 1000, 0], [1100, 1000, 8], [1200, 1080, 16], [1170, 1160, 24]],
    [[1000, 1000, 0], [1500, 1000, 0], [1000, 1000, 0], [500, 1000, 2]]
  ] as HandwritingPoint[][]) {
    const samples = handwritingBrushGeometry(naturalStroke(points)).samples;
    assert.ok(samples.length > 0 && samples.every((sample) => sample.width > 0));
    assert.ok(samples.every((sample) => Object.values(sample).every((value) => typeof value !== "number" || Number.isFinite(value))));
    if (points.length > 2) assert.ok(samples.some((sample) => sample.directional));
  }
});

test("natural incremental geometry and fresh replay agree through jitter, turns and dwell", () => {
  const points: HandwritingPoint[] = [[1000, 1000, 0], [1020, 990, 100], [1000, 1010, 300], [1400, 1000, 310], [2000, 1000, 350], [2200, 1200, 400], [2200, 1700, 450], [2200, 1700, 800]];
  const stroke = naturalStroke([]);
  for (const point of points) {
    stroke.points.push(point);
    const live = handwritingBrushGeometry(stroke);
    const replay = handwritingBrushGeometry(structuredClone(stroke));
    assert.deepEqual(live, replay);
  }
});

test("old strokes and new strokes select distinct models without rewriting stored points", () => {
  const points: HandwritingPoint[] = [[1000, 1000, 0], [1000, 1000, 300], [1400, 1000, 320]];
  const original = structuredClone(points);
  const old = handwritingBrushGeometry({ brush: { ...HANDWRITING_DEFAULT_BRUSH }, points });
  const natural = handwritingBrushGeometry(naturalStroke(points));
  assert.ok(old.samples.every((sample) => sample.version === undefined));
  assert.ok(natural.samples.every((sample) => sample.version === 2));
  assert.notDeepEqual(old.samples, natural.samples);
  assert.deepEqual(points, original);
});

test("natural ink stays comparable across coalesced sampling densities and timestamp origins", () => {
  const geometryAt = (step: number, timeOffset = 0) => handwritingBrushGeometry(naturalStroke(
    Array.from({ length: 4800 / step + 1 }, (_, index) => [1000 + index * step, 3000, timeOffset + index * (step / 15)])
  ));
  const coarse = geometryAt(120).samples.at(-1)!;
  const dense = geometryAt(30).samples.at(-1)!;
  assert.ok(Math.abs(coarse.x - dense.x) < 10);
  assert.ok(Math.abs(coarse.width - dense.width) < 5);
  assert.ok(Math.abs(coarse.angle - dense.angle) < 0.02);
  assert.deepEqual(geometryAt(60).samples, geometryAt(60, 10000).samples);
});

test("rotation lag slows turning independently of tip position and stays fixed during a pause", () => {
  const points: HandwritingPoint[] = Array.from({ length: 31 }, (_, index) => [1000 + index * 120, 3000, index * 8]);
  for (let index = 1; index <= 6; index++) points.push([4600, 3000 + index * 120, 240 + index * 8]);
  const strokeAt = (rotationLag: number) => {
    const stroke = naturalStroke(structuredClone(points), "follow", 100);
    stroke.brush = { ...stroke.brush!, rotationLag };
    return stroke;
  };
  const strokes = [0, 35, 100].map(strokeAt);
  const tips = strokes.map((stroke) => handwritingBrushGeometry(stroke).samples.at(-1)!);
  assert.ok(tips[0].angle > tips[1].angle && tips[1].angle > tips[2].angle);
  assert.ok(tips[0].angle - tips[2].angle > 0.5);
  for (const tip of tips.slice(1)) {
    assert.deepEqual([tip.x, tip.y, tip.width, tip.trailX, tip.trailY], [tips[0].x, tips[0].y, tips[0].width, tips[0].trailX, tips[0].trailY]);
  }
  const last = points.at(-1)!;
  strokes[2].points.push([last[0], last[1], last[2] + 1000]);
  assert.equal(handwritingBrushGeometry(strokes[2]).samples.at(-1)!.angle, tips[2].angle);
  const noPositionLag = strokeAt(100);
  noPositionLag.brush!.lag = 0;
  const direct = handwritingBrushGeometry(noPositionLag).samples.at(-1)!;
  assert.equal(direct.angle, tips[2].angle);
  assert.notEqual(direct.x, tips[2].x);
});
