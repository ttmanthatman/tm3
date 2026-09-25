import assert from "node:assert/strict";
import test from "node:test";
import type { HandwritingPayload } from "@shared/handwriting";
import { handwritingBrushGeometry, type BrushSample } from "./handwritingBrush.js";
import { appendHandwritingStroke, drawHandwritingCharacter, drawHandwritingPayload, drawHandwritingTimelineAt, buildHandwritingTimeline, traceBrushFootprintPath } from "./handwritingRenderer.js";

type Operation = { type: string; args: unknown[] };

function fakeCanvas() {
  const operations: Operation[] = [];
  let fillStyle = "";
  const context = {
    get fillStyle() { return fillStyle; },
    set fillStyle(value: string) { fillStyle = value; operations.push({ type: "fillStyle", args: [value] }); },
    setTransform: (...args: unknown[]) => operations.push({ type: "setTransform", args }),
    clearRect: (...args: unknown[]) => operations.push({ type: "clearRect", args }),
    beginPath: () => operations.push({ type: "beginPath", args: [] }),
    arc: (...args: unknown[]) => operations.push({ type: "arc", args }),
    ellipse: (...args: unknown[]) => operations.push({ type: "ellipse", args }),
    fill: () => operations.push({ type: "fill", args: [] }),
    moveTo: (...args: unknown[]) => operations.push({ type: "moveTo", args }),
    lineTo: (...args: unknown[]) => operations.push({ type: "lineTo", args }),
    bezierCurveTo: (...args: unknown[]) => operations.push({ type: "bezierCurveTo", args }),
    closePath: () => operations.push({ type: "closePath", args: [] })
  };
  const canvas = { width: 0, height: 0, getContext: () => context };
  return { canvas: canvas as unknown as Parameters<typeof drawHandwritingPayload>[0], operations };
}

const payload: HandwritingPayload = {
  kind: "handwriting",
  version: 1,
  characters: [{ strokes: [{ points: [[0, 0, 0], [100, 100, 20]] }] }]
};

test("static and timeline rendering share one fixed-width vector path and a single-point dot", () => {
  const staticCanvas = fakeCanvas();
  drawHandwritingPayload(staticCanvas.canvas, payload);
  const timelineCanvas = fakeCanvas();
  const timeline = buildHandwritingTimeline(payload);
  drawHandwritingTimelineAt(timelineCanvas.canvas, payload, timeline, timeline.durationMs);
  const drawCalls = (operations: Operation[]) => operations.filter((operation) => ["arc", "lineTo", "bezierCurveTo"].includes(operation.type));
  assert.deepEqual(drawCalls(staticCanvas.operations), drawCalls(timelineCanvas.operations));
  const dotCanvas = fakeCanvas();
  drawHandwritingCharacter(dotCanvas.canvas, { strokes: [{ points: [[1, 2, 0]] }] });
  assert.equal(dotCanvas.operations.filter((operation) => operation.type === "arc").length, 1);
});

test("renders each stroke with its persisted palette color", () => {
  const coloredCanvas = fakeCanvas();
  drawHandwritingCharacter(coloredCanvas.canvas, {
    strokes: [
      { color: "#c44536", points: [[1, 2, 0]] },
      { color: "#2f6fdd", points: [[3, 4, 1]] }
    ]
  });
  assert.deepEqual(
    coloredCanvas.operations.filter((operation) => operation.type === "fillStyle").map((operation) => operation.args[0]),
    ["#263b33", "#c44536", "#2f6fdd"]
  );
});

test("renders a configurable glow halo before the ink", () => {
  const glowCanvas = fakeCanvas();
  drawHandwritingCharacter(glowCanvas.canvas, {
    strokes: [{ color: "#c44536", points: [[1, 2, 0], [100, 100, 20]] }]
  }, {
    glow: { color: "#ffffff", density: 50, width: 50 }
  });
  const fills = glowCanvas.operations.filter((operation) => operation.type === "fillStyle").map((operation) => operation.args[0]);
  assert.deepEqual(fills, ["#263b33", "rgba(255, 255, 255, 0.140)", "rgba(255, 255, 255, 0.280)", "#c44536"]);
  assert.ok(glowCanvas.operations.some((operation) => operation.type === "arc" && Number(operation.args[2]) > 360));
});

test("appending one sampled point performs constant drawing work", () => {
  const target = fakeCanvas();
  const stroke = { points: Array.from({ length: 101 }, (_, index) => [index, index, index] as const) };
  drawHandwritingCharacter(target.canvas, { strokes: [{ points: stroke.points.slice(0, 100) }] });
  target.operations.length = 0;
  appendHandwritingStroke(target.canvas, stroke, 100);
  assert.equal(target.operations.filter((operation) => operation.type === "arc").length, 1);
  assert.equal(target.operations.filter((operation) => operation.type === "lineTo").length, 3);
});

test("brush body sweeps oriented leaf footprints instead of ribbon quads or circular dabs", () => {
  const target = fakeCanvas();
  drawHandwritingCharacter(target.canvas, {
    strokes: [{
      brush: { size: 50, sensitivity: 70, lag: 40 },
      points: [[1000, 1000, 0], [2000, 1000, 100], [2000, 1800, 110]]
    }]
  });
  assert.equal(target.operations.filter((operation) => operation.type === "arc").length, 1);
  assert.equal(target.operations.filter((operation) => operation.type === "ellipse").length, 0);
  assert.equal(target.operations.filter((operation) => operation.type === "lineTo").length, 0);
  assert.equal(target.operations.filter((operation) => operation.type === "fill").length, 1);
  assert.ok(target.operations.filter((operation) => operation.type === "bezierCurveTo").length >= 12);
});

test("a single brush point starts as a directionless contact dot", () => {
  const target = fakeCanvas();
  drawHandwritingCharacter(target.canvas, {
    strokes: [{ brush: { size: 50, sensitivity: 70, lag: 40 }, points: [[10, 20, 0]] }]
  });
  assert.equal(target.operations.filter((operation) => operation.type === "bezierCurveTo").length, 0);
  assert.equal(target.operations.filter((operation) => operation.type === "moveTo").length, 0);
  assert.equal(target.operations.filter((operation) => operation.type === "arc").length, 1);
});

test("an initial dwell expands the contact without choosing a direction", () => {
  const target = fakeCanvas();
  drawHandwritingCharacter(target.canvas, {
    strokes: [{ brush: { size: 80, sensitivity: 0, lag: 35 }, points: [[10, 20, 0], [10, 20, 300]] }]
  });
  assert.equal(target.operations.filter((operation) => operation.type === "bezierCurveTo").length, 0);
  assert.ok(target.operations.filter((operation) => operation.type === "arc").length >= 2);
});

test("brush footprint places its sharp cusp behind the direction of travel", () => {
  const target = fakeCanvas();
  const sample: BrushSample = {
    x: 1000, y: 2000, width: 400, angle: 0, contact: 0.8, spread: 0.7, directional: true,
    trailX: 30, trailY: 0, phase: "writing", rawX: 1030, rawY: 2000,
    inputX: 1030, inputY: 2000, handleX: 1030, handleY: 2000, speed: 1
  };
  traceBrushFootprintPath(target.canvas.getContext("2d")!, sample);
  const cusp = target.operations.find((operation) => operation.type === "moveTo")!;
  const curves = target.operations.filter((operation) => operation.type === "bezierCurveTo");
  assert.ok(Number(cusp.args[0]) < sample.x, "the sharp cusp trails the tip position");
  assert.ok(Number(curves[1].args[2]) > sample.x, "the rounded nose leads the tip position");
});

test("brush turn adds intermediate footprints when angle changes faster than position", () => {
  const straight = Array.from({ length: 26 }, (_, index) => [1000 + index * 120, 3000, index * 8] as [number, number, number]);
  const turn = Array.from({ length: 20 }, (_, index) => [4000 - (index + 1) * 45, 3000 + (index + 1) * 100, (index + 26) * 8] as [number, number, number]);
  const stroke = {
    brush: { size: 100, sensitivity: 0, lag: 40 },
    points: [...straight, ...turn]
  };
  const samples = handwritingBrushGeometry(stroke).samples;
  const distanceOnlyCount = 1 + samples.slice(1).reduce((total, sample, index) => {
    const previous = samples[index];
    const distance = Math.hypot(sample.x - previous.x, sample.y - previous.y);
    const spacing = Math.max(6, Math.min(previous.width, sample.width) * 0.42);
    return total + Math.max(1, Math.ceil(distance / spacing));
  }, 0);
  const target = fakeCanvas();
  drawHandwritingCharacter(target.canvas, { strokes: [stroke] });
  const renderedCount = target.operations.filter((operation) => operation.type === "moveTo").length;
  assert.ok(renderedCount > distanceOnlyCount, "turning inserts footprints beyond distance-only sampling");
});

test("brush live append advances the same deterministic geometry as full replay", () => {
  const stroke = { brush: { size: 50, sensitivity: 70, lag: 40 }, points: [[1000, 1000, 0], [2000, 1000, 100], [2000, 1800, 110]] as [number, number, number][] };
  const live = fakeCanvas();
  for (let index = 0; index < stroke.points.length; index++) {
    appendHandwritingStroke(live.canvas, { ...stroke, points: stroke.points.slice(0, index + 1) }, index);
  }
  const staticCanvas = fakeCanvas();
  drawHandwritingCharacter(staticCanvas.canvas, { strokes: [stroke] });
  const replay = fakeCanvas();
  drawHandwritingCharacter(replay.canvas, { strokes: [stroke] }, { visiblePointCounts: [3] });
  assert.ok(live.operations.some((operation) => operation.type === "bezierCurveTo"));
  assert.ok(staticCanvas.operations.some((operation) => operation.type === "bezierCurveTo"));
  const pathOperations = (operations: Operation[]) => operations.filter((operation) => ["moveTo", "bezierCurveTo", "closePath"].includes(operation.type));
  assert.deepEqual(pathOperations(live.operations), pathOperations(staticCanvas.operations));
  assert.deepEqual(
    replay.operations.filter((operation) => ["ellipse", "moveTo", "lineTo", "bezierCurveTo", "closePath"].includes(operation.type)),
    staticCanvas.operations.filter((operation) => ["ellipse", "moveTo", "lineTo", "bezierCurveTo", "closePath"].includes(operation.type))
  );
});

test("partial replay preserves brush and color while hiding future points without copying strokes", () => {
  const stroke = { color: "#123456" as const, brush: { size: 50, sensitivity: 70, lag: 40 }, points: [[1000, 1000, 0], [2000, 1000, 100], [9000, 8000, 110]] as [number, number, number][] };
  const input = JSON.stringify(stroke);
  const partial = fakeCanvas();
  drawHandwritingCharacter(partial.canvas, { strokes: [stroke] }, { visiblePointCounts: [2] });
  const prefix = fakeCanvas();
  drawHandwritingCharacter(prefix.canvas, { strokes: [{ ...stroke, points: stroke.points.slice(0, 2) }] });
  assert.deepEqual(partial.operations, prefix.operations);
  assert.ok(partial.operations.some((op) => op.type === "fillStyle" && op.args[0] === stroke.color));
  assert.equal(JSON.stringify(stroke), input);
});
