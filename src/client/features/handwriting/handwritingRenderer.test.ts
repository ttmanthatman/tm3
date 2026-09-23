import assert from "node:assert/strict";
import test from "node:test";
import type { HandwritingPayload } from "@shared/handwriting";
import { appendHandwritingStroke, drawHandwritingCharacter, drawHandwritingPayload, drawHandwritingTimelineAt, buildHandwritingTimeline } from "./handwritingRenderer.js";

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
    fill: () => operations.push({ type: "fill", args: [] }),
    moveTo: (...args: unknown[]) => operations.push({ type: "moveTo", args }),
    lineTo: (...args: unknown[]) => operations.push({ type: "lineTo", args }),
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
  const drawCalls = (operations: Operation[]) => operations.filter((operation) => operation.type === "arc" || operation.type === "lineTo");
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

test("appending one sampled point performs constant drawing work", () => {
  const target = fakeCanvas();
  const stroke = { points: Array.from({ length: 101 }, (_, index) => [index, index, index] as const) };
  drawHandwritingCharacter(target.canvas, { strokes: [{ points: stroke.points.slice(0, 100) }] });
  target.operations.length = 0;
  appendHandwritingStroke(target.canvas, stroke, 100);
  assert.equal(target.operations.filter((operation) => operation.type === "arc").length, 1);
  assert.equal(target.operations.filter((operation) => operation.type === "lineTo").length, 3);
});
