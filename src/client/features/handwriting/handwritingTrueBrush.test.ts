import assert from "node:assert/strict";
import test from "node:test";
import type { HandwritingBrush, HandwritingPoint, HandwritingStroke } from "@shared/handwriting";
import { handwritingBrushGeometry } from "./handwritingBrush.js";
import { beginTrueBrushFold, foldProjection, reflectFoldPoint, retargetTrueBrushFold, trueBrushContours, trueBrushControlPoints, trueBrushCrease, trueBrushFoldNormal } from "./handwritingTrueBrush.js";

function stroke(brush: Partial<HandwritingBrush> = {}): HandwritingStroke {
  return {
    brush: { size: 84, sensitivity: 50, lag: 0, algorithm: "true-v1", rotationLag: 35, version: 2, ...brush },
    points: Array.from({ length: 31 }, (_, i) => [1500 + i * 120, 3500, i * 8])
  };
}
function turn(target: HandwritingStroke, angle: number, count: number, pause = 0) {
  const [x, y, t] = target.points.at(-1)!;
  if (pause) target.points.push([x, y, t + pause]);
  for (let i = 1; i <= count; i++) target.points.push([Math.round(x + i * 80 * Math.cos(angle)), Math.round(y + i * 80 * Math.sin(angle)), t + pause + i * 16]);
}

function contourDistance(a: ReturnType<typeof trueBrushContours>, b: ReturnType<typeof trueBrushContours>) {
  const from = a.flat(), to = b.flat();
  const distanceToLayer = (point: typeof from[number], layer: typeof from) => {
    let inside = false, distance = Infinity;
    for (let i = 0; i < layer.length; i++) {
      const p = layer[i], q = layer[(i + 1) % layer.length];
      if ((p.y > point.y) !== (q.y > point.y) && point.x < p.x + (q.x - p.x) * (point.y - p.y) / (q.y - p.y)) inside = !inside;
      const dx = q.x - p.x, dy = q.y - p.y;
      const t = Math.max(0, Math.min(1, ((point.x - p.x) * dx + (point.y - p.y) * dy) / (dx * dx + dy * dy || 1)));
      distance = Math.min(distance, Math.hypot(point.x - p.x - dx * t, point.y - p.y - dy * t));
    }
    return inside ? 0 : distance;
  };
  const directed = (points: typeof from, layers: typeof a) => Math.max(...points.map((point) => Math.min(...layers.map((layer) => distanceToLayer(point, layer)))));
  return Math.max(directed(from, b), directed(to, a));
}

test("folded nib unfolds along the outgoing heading instead of doubling its turn", () => {
  const source = { x: 2000, y: 3000, width: 800, spread: 0.9, contact: 1, angle: 0.3 };
  for (const heading of [Math.PI * 5 / 6, Math.PI, -Math.PI * 5 / 6]) {
    const fold = beginTrueBrushFold(source, heading);
    fold.travel = fold.distance;
    const tail = reflectFoldPoint(fold, fold.pin);
    const centre = reflectFoldPoint(fold, source);
    const releasedHeading = Math.atan2(centre.y - tail.y, centre.x - tail.x);
    assert.ok(Math.abs(Math.atan2(Math.sin(releasedHeading - heading), Math.cos(releasedHeading - heading))) < 1e-9);
  }
});

test("retargeted fold has no footprint switch at completion, including wrap, sideways and return travel", () => {
  const source = { x: 2000, y: 3000, width: 800, spread: 0.9, contact: 1, angle: 0 };
  for (const heading of [Math.PI * 11 / 12, Math.PI / 2, 0, -Math.PI * 5 / 6]) {
    const fold = beginTrueBrushFold(source, Math.PI * 5 / 6);
    retargetTrueBrushFold(fold, heading);
    for (const expansion of [0, 180]) {
      fold.travel = fold.distance * (1 - 1e-8);
      const before = trueBrushContours(source, fold, expansion);
      fold.travel = fold.distance;
      assert.ok(contourDistance([before[1]], trueBrushContours(source, fold, expansion)) < 0.01, `reflected contact at ${heading}, glow ${expansion} must be continuous`);
      const remaining = before[0], origin = remaining[0];
      const area = origin ? Math.abs(remaining.reduce((sum, p, i) => { const q = remaining[(i + 1) % remaining.length]; return sum + (p.x - origin.x) * (q.y - origin.y) - (p.y - origin.y) * (q.x - origin.x); }, 0)) / 2 : 0;
      assert.ok(area < 1e-6, "the disappearing contact must have zero painted area at release, including glow");
    }
  }
});

test("changing direction during a fold bounds contact-edge travel and bypasses the pause multiplier", () => {
  for (const pausedRotationScale of [0, 0.1, 1]) {
    const target = stroke({ size: 100, pausedRotationScale });
    turn(target, Math.PI * 5 / 6, 3, 400);
    turn(target, Math.PI * 11 / 12, 3);
    turn(target, Math.PI / 2, 30);
    const geometry = handwritingBrushGeometry(target);
    const samples = geometry.samples;
    for (let i = 1; i < samples.length; i++) {
      const previous = samples[i - 1], sample = samples[i];
      if (!previous.fold || !sample.fold) continue;
      const travel = Math.hypot(sample.handleX - previous.handleX, sample.handleY - previous.handleY);
      assert.ok(contourDistance(trueBrushContours(previous, previous.fold), trueBrushContours(sample, sample.fold)) <= travel * 3 + 1, "fold direction must advance with travel rather than teleporting an entire contact layer");
    }
    assert.equal(geometry.state?.trueRotationScale, 1, "a fold releases the pause latch for the rest of this stroke");
    assert.ok(Math.abs(samples.at(-1)!.angle - Math.PI / 2) < 0.02);
    turn(target, Math.PI / 2, 3, 400);
    assert.equal(handwritingBrushGeometry(target).state?.trueRotationScale, 1, "a later pause cannot restore the pre-fold multiplier");
  }
});

test("a paused finger na presses slowly then lifts into a narrow accelerated departure", () => {
  for (const angle of [0, Math.PI / 4]) {
    const target = stroke();
    target.points = Array.from({ length: 31 }, (_, i) => [1500 + i * 80, 3500, i * 80]);
    const [startX, startY, startTime] = target.points.at(-1)!;
    target.points.push([startX, startY, startTime + 400]);
    for (let i = 1; i <= 8; i++) target.points.push([Math.round(startX + i * 80 * Math.cos(angle)), Math.round(startY + i * 80 * Math.sin(angle)), startTime + 400 + i * 80]);
    const pressed = handwritingBrushGeometry(target).samples.at(-1)!;
    const [x, y, time] = target.points.at(-1)!;
    for (let i = 1; i <= 16; i++) target.points.push([Math.round(x + i * 160 * Math.cos(angle)), Math.round(y + i * 160 * Math.sin(angle)), time + i * 8]);
    const lifted = handwritingBrushGeometry(target).samples.at(-1)!;
    assert.ok(pressed.contact > 0.9, "slow departure keeps the shoulder in full contact");
    assert.ok(lifted.contact < 0.08, "accelerated departure progressively lifts the simulated bristles");
    assert.ok(lifted.width < pressed.width * 0.2, "a lifted na must narrow beyond the always-contacting speed floor");
  }
  const corner = stroke();
  turn(corner, Math.PI / 2, 16, 400);
  assert.ok(handwritingBrushGeometry(corner).samples.at(-1)!.contact > 0.9, "a perpendicular shoulder turn must retain pressing contact");
});

test("zero rotation lag cannot snap the released nib onto a new direction", () => {
  const target = stroke({ rotationLag: 0, size: 100 });
  turn(target, Math.PI * 5 / 6, 3, 400);
  turn(target, Math.PI / 2, 30);
  const samples = handwritingBrushGeometry(target).samples;
  const release = samples.findIndex((sample, index) => index > 0 && samples[index - 1].fold && !sample.fold);
  assert.ok(release > 0);
  for (let i = release + 1; i < samples.length; i++) {
    const previous = samples[i - 1], sample = samples[i];
    const distance = Math.hypot(sample.handleX - previous.handleX, sample.handleY - previous.handleY);
    assert.ok(contourDistance(trueBrushContours(previous), trueBrushContours(sample)) <= distance * 4 + 1, "release and subsequent turning must respect contact travel even at zero angular lag");
  }
});

test("a pause removes incoming speed from finger lift inference without disturbing stationary ink", () => {
  const target = stroke();
  const [x, y, time] = target.points.at(-1)!;
  const before = structuredClone(handwritingBrushGeometry(target).samples);
  target.points.push([x, y, time + 400]);
  assert.deepEqual(handwritingBrushGeometry(target).samples, before);
  for (let i = 1; i <= 6; i++) {
    target.points.push([x + i * 20, y, time + 400 + i * 40]);
    assert.ok(handwritingBrushGeometry(target).samples.at(-1)!.contact > 0.9, "the previous fast approach must not lift a slowly resumed press");
  }
  const insensitive = stroke({ sensitivity: 0 });
  turn(insensitive, 0, 20, 400);
  assert.ok(handwritingBrushGeometry(insensitive).samples.at(-1)!.contact > 0.9, "zero speed sensitivity disables inferred lift");
});

test("down then right does not fold when a short upward jitter occurs at the corner", () => {
  for (const lag of [0, 35, 100]) {
    for (const jitter of [0, 40, 80, 120]) {
      const target = stroke({ lag });
      target.points = Array.from({ length: 31 }, (_, i) => [3000, 1500 + i * 100, i * 8]);
      target.points.push([3000, 4500 - jitter, 256]);
      for (let i = 1; i <= 20; i++) target.points.push([3000 + i * 80, 4500 - jitter, 256 + i * 8]);
      assert.ok(handwritingBrushGeometry(target).samples.every((sample) => !sample.fold), `a short upward jitter (${jitter}, lag ${lag}) must not turn a 90° corner into an upward fold`);
    }
  }
});

test("slow curves and stationary oscillation do not become abrupt reversals", () => {
  const curve = stroke();
  for (let i = 1; i <= 36; i++) turn(curve, i * Math.PI / 36, 2);
  assert.ok(handwritingBrushGeometry(curve).samples.every((sample) => !sample.fold));
  const jitter = stroke();
  const [x, y, time] = jitter.points.at(-1)!;
  for (let i = 1; i <= 50; i++) jitter.points.push([x + (i % 2 ? -40 : 0), y, time + i * 8]);
  assert.ok(handwritingBrushGeometry(jitter).samples.every((sample) => !sample.fold));
});

test("reversal detection tolerates dense sampling and a large outgoing event", () => {
  for (const step of [16, 40, 80, 500]) {
    const target = stroke();
    const [x, y, time] = target.points.at(-1)!;
    for (let i = 1; i <= Math.ceil(1600 / step); i++) {
      target.points.push([Math.round(x - i * step * Math.cos(Math.PI / 6)), Math.round(y + i * step / 2), time + i * 8]);
    }
    assert.ok(handwritingBrushGeometry(target).samples.some((sample) => sample.fold), `outgoing step ${step} must preserve the reversal`);
  }
});

test("a tight reversal through short intermediate directions still folds along the outgoing path", () => {
  const target = stroke();
  turn(target, Math.PI / 3, 1);
  turn(target, Math.PI * 2 / 3, 1);
  turn(target, Math.PI * 5 / 6, 18);
  const folds = handwritingBrushGeometry(target).samples.filter((sample) => sample.fold);
  assert.ok(folds.length, "the reversal must compare against the incoming path across the short transition");
  assert.ok(folds.every((sample) => Math.abs(sample.fold!.heading - Math.PI * 5 / 6) < 0.08));
});

test("an active fold follows a sustained change of outgoing direction and releases without a contact jump", () => {
  const target = stroke({ size: 100 });
  turn(target, Math.PI * 5 / 6, 2);
  turn(target, Math.PI * 11 / 12, 3);
  const geometry = handwritingBrushGeometry(target);
  const latestFold = geometry.samples.filter((sample) => sample.fold).at(-1)!;
  assert.ok(latestFold?.fold);
  assert.ok(latestFold.fold.heading > Math.PI * 5 / 6 && latestFold.fold.heading <= Math.PI * 11 / 12 + 0.01, "the fold continuously turns toward the current outgoing path rather than jumping to it");
  turn(target, Math.PI * 11 / 12, 20);
  const samples = handwritingBrushGeometry(target).samples;
  const release = samples.findIndex((sample, index) => index > 0 && samples[index - 1].fold && !sample.fold);
  assert.ok(release > 0);
  const after = samples[release + 1];
  const before = samples[release];
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) <= 65, "releasing the pin must not teleport the contact back to the handle");
});

test("true-v1 preserves the pointer-down contact centre and has a slender, longer tail without lateral twisting", () => {
  const dot = handwritingBrushGeometry({ brush: stroke().brush, points: [[2000, 3000, 0], [2000, 3000, 500]] });
  assert.ok(dot.samples.every((sample) => !sample.directional && sample.x === 2000 && sample.y === 3000));
  const nib = handwritingBrushGeometry(stroke()).samples.at(-1)!;
  const points = trueBrushControlPoints(nib);
  assert.ok(nib.x - points[0].x > nib.width * 0.95, "the cusp extends about a full width behind the same contact centre");
  assert.ok(Math.abs(points[1].y - nib.y) < nib.width * 0.1, "tail shoulders stay slender");
  const corner = stroke();
  turn(corner, Math.PI / 2, 10);
  assert.ok(handwritingBrushGeometry(corner).samples.every((sample) => sample.bend === undefined));
});

test("before folding, a configurable pause latches response until lift and targets the newest direction", () => {
  const slowed = stroke({ pauseThresholdMs: 200, pausedRotationScale: 0.1 });
  const normal = stroke({ pauseThresholdMs: 2000 });
  turn(slowed, Math.PI / 2, 4, 300);
  turn(normal, Math.PI / 2, 4, 300);
  const slowGeometry = handwritingBrushGeometry(slowed);
  const normalGeometry = handwritingBrushGeometry(normal);
  assert.equal(slowGeometry.state?.trueRotationScale, 0.1);
  assert.equal(normalGeometry.state?.trueRotationScale, 1);
  assert.ok(slowGeometry.samples.at(-1)!.angle < normalGeometry.samples.at(-1)!.angle * 0.2);
  const previousAngle = slowGeometry.samples.at(-1)!.angle;
  turn(slowed, -Math.PI / 8, 2);
  const changed = handwritingBrushGeometry(slowed);
  assert.equal(changed.state?.trueRotationScale, 0.1);
  assert.ok(changed.samples.at(-1)!.angle < previousAngle, "new target replaces the pre-pause or previous-turn target");
  assert.equal(handwritingBrushGeometry(stroke()).state?.trueRotationScale, 1, "a new stroke resets the latch");
  const zero = stroke({ pausedRotationScale: 0 });
  turn(zero, Math.PI / 2, 8, 201);
  assert.equal(handwritingBrushGeometry(zero).samples.at(-1)!.angle, 0);
});

test("pause threshold is strict and detects a gap even without stationary pointer events", () => {
  for (const [pause, expected] of [[184, 1], [185, 0.1]] as const) {
    const target = stroke();
    const last = target.points.at(-1)!;
    target.points.push([last[0], last[1] + 80, last[2] + pause + 16]);
    assert.equal(handwritingBrushGeometry(target).state?.trueRotationScale, expected);
  }
});

test("135 degrees does not fold but a sudden greater turn does, in both directions and through the angle wrap", () => {
  const boundary = stroke();
  boundary.points.push([5000, 3600, 256]); // exactly 135° from the previous rightward movement
  assert.ok(handwritingBrushGeometry(boundary).samples.every((sample) => !sample.fold));
  for (const direction of [-1, 1]) {
    const target = stroke();
    turn(target, direction * Math.PI * 5 / 6, 16);
    const samples = handwritingBrushGeometry(target).samples;
    assert.ok(samples.some((sample) => sample.fold));
    assert.ok(!samples.at(-1)!.fold, "sufficient travel fully unfolds and releases");
  }
  const wrapped = stroke();
  // Crossing +pi/-pi by a small angle is not a reversal.
  wrapped.points = Array.from({ length: 31 }, (_, i) => [6000 - i * 120, 3500 + i, i * 8]);
  turn(wrapped, -Math.PI + 0.02, 4);
  assert.ok(handwritingBrushGeometry(wrapped).samples.every((sample) => !sample.fold));
});

test("fold keeps the physical cusp pinned, bends onto new travel, and stops at rest", () => {
  const target = stroke();
  turn(target, Math.PI * 5 / 6, 4, 400);
  const geometry = handwritingBrushGeometry(target);
  const folds = geometry.samples.filter((sample) => sample.fold);
  assert.ok(folds.length > 3);
  const first = folds[0].fold!;
  for (const sample of folds) {
    const fold = sample.fold!;
    assert.deepEqual(fold.pin, first.pin);
    assert.equal(sample.angle, first.source.angle, "body does not rigidly rotate during folding");
    const normal = { x: Math.cos(trueBrushFoldNormal(fold)), y: Math.sin(trueBrushFoldNormal(fold)) };
    const creaseTangent = { x: -normal.y, y: normal.x };
    assert.ok(Math.abs(normal.x * creaseTangent.x + normal.y * creaseTangent.y) < 1e-12);
    const onCrease = { x: fold.pin.x + normal.x * trueBrushCrease(fold) + creaseTangent.x * 100, y: fold.pin.y + normal.y * trueBrushCrease(fold) + creaseTangent.y * 100 };
    assert.ok(Math.abs(foldProjection(fold, onCrease) - trueBrushCrease(fold)) < 1e-9);
    const contours = trueBrushContours(sample, fold);
    assert.ok(contours.flat().some((point) => Math.hypot(point.x - fold.pin.x, point.y - fold.pin.y) < 1e-8));
  }
  const before = structuredClone(geometry.samples);
  const last = target.points.at(-1)!;
  target.points.push([last[0], last[1], last[2] + 1000]);
  assert.deepEqual(handwritingBrushGeometry(target).samples, before);
  turn(target, Math.PI * 5 / 6, 20);
  const finished = handwritingBrushGeometry(target);
  assert.ok(!finished.samples.at(-1)!.fold);
  assert.equal(finished.state?.trueRotationScale, 1, "fold release clears the pause latch");
});

test("complete paper reflection preserves shape area and releases with the same footprint", () => {
  const source = { x: 2000, y: 3000, width: 500, spread: 0.9, contact: 1, angle: 0 };
  const fold = beginTrueBrushFold(source, Math.PI * 5 / 6);
  fold.travel = fold.distance;
  const centre = reflectFoldPoint(fold, source);
  for (const expansion of [0, 180]) {
    const unfolded = trueBrushContours(source, fold, expansion)[1];
    const released = trueBrushContours({ ...source, ...centre, angle: fold.heading }, undefined, expansion)[0];
    for (const point of unfolded) assert.ok(released.some((other) => Math.hypot(point.x - other.x, point.y - other.y) < 1e-8), "ink and glow must not jump at release");
    const area = (points: typeof unfolded) => Math.abs(points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p.x * q.y - p.y * q.x; }, 0) / 2);
    assert.ok(Math.abs(area(unfolded) - area(trueBrushContours(source, undefined, expansion)[0])) < 1e-6);
  }
});

test("live incremental geometry equals fresh replay at every prefix including pause, fold, release and a later target", () => {
  const target = stroke();
  turn(target, Math.PI * 5 / 6, 2, 400);
  turn(target, Math.PI * 11 / 12, 4);
  turn(target, Math.PI * 5 / 6, 18);
  turn(target, Math.PI / 2, 8);
  const points = [...target.points];
  target.points = [];
  for (const point of points) {
    target.points.push(point as HandwritingPoint);
    assert.deepEqual(handwritingBrushGeometry(target), handwritingBrushGeometry(structuredClone(target)));
  }
});
