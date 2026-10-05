import assert from "node:assert/strict";
import test from "node:test";
import type { HandwritingStroke } from "@shared/handwriting";
import { appendHandwritingStroke, drawHandwritingCharacter, drawHandwritingCharacterSteps, traceBrushFootprintPath } from "./handwritingRenderer.js";
import { handwritingBrushGeometry } from "./handwritingBrush.js";

function canvasProbe() {
  let closures = 0;
  let fills = 0;
  let contours = 0;
  const context = {
    setTransform() {}, clearRect() {}, beginPath() {}, arc() {}, ellipse() {},
    lineTo() {}, bezierCurveTo() {},
    moveTo() { contours++; },
    closePath() { closures++; },
    fill() { fills++; }
  } as unknown as CanvasRenderingContext2D;
  return {
    canvas: { width: 54, height: 54, getContext: () => context },
    counts: () => ({ closures, fills, contours })
  };
}

test("dense filled brush paths avoid repeated explicit contour closure in static, replay and live ink", () => {
  for (const version of [undefined, 2] as const) for (const algorithm of ["follow", "slanted"] as const) {
    const stroke: HandwritingStroke = {
      brush: { size: 45, sensitivity: 9, lag: 100, algorithm, ...(version ? { version } : {}) },
      points: Array.from({ length: 300 }, (_, index) => [
        5000 + Math.sin(index * 0.6) * 3000,
        5000 + Math.cos(index * 0.4) * 3000,
        index * 16
      ])
    };
    for (const mode of ["static", "replay", "live"] as const) {
      const target = canvasProbe();
      const options = { glow: { color: "#ffffff" as const, density: 50, width: 50 } };
      if (mode === "live") appendHandwritingStroke(target.canvas, stroke, 100, options);
      else drawHandwritingCharacter(target.canvas, { strokes: [stroke] }, {
        ...options, ...(mode === "replay" ? { visiblePointCounts: [200] } : {})
      });
      const counts = target.counts();
      assert.ok(counts.contours > 100, "exercise the many-subpath pattern of complex drawings");
      assert.equal(counts.closures, 0, `${version || "legacy"}/${algorithm}/${mode} must let fill close its contours`);
      assert.equal(counts.fills, 3, "keep each glow pass and the ink in one fill to preserve overlapping opacity");
    }
  }
});

test("standalone brush outlines remain explicitly closed for stroked inspection", () => {
  const target = canvasProbe();
  const stroke: HandwritingStroke = {
    brush: { size: 45, sensitivity: 9, lag: 100 },
    points: [[1000, 1000, 0], [2000, 1000, 100]]
  };
  traceBrushFootprintPath(target.canvas.getContext(), handwritingBrushGeometry(stroke).samples.at(-1)!);
  assert.equal(target.counts().closures, 1);
});

test("blank replay canvases do not calculate any hidden brush geometry", () => {
  const points = new Proxy([[1000, 1000, 0], [9000, 9000, 20]] as [number, number, number][], {
    get(target, property, receiver) {
      assert.ok(typeof property !== "string" || !/^\d+$/.test(property), "hidden coordinates must not be visited");
      return Reflect.get(target, property, receiver);
    }
  });
  const target = canvasProbe();
  drawHandwritingCharacter(target.canvas, {
    strokes: [{ brush: { size: 45, sensitivity: 9, lag: 100 }, points }]
  }, { visiblePointCounts: [0] });
  assert.deepEqual(target.counts(), { closures: 0, fills: 0, contours: 0 });
});

test("static drawing yields within a dense stroke while retaining one fill per glow pass", () => {
  const stroke: HandwritingStroke = {
    brush: { size: 45, sensitivity: 9, lag: 100 },
    points: Array.from({ length: 300 }, (_, i) => [5000 + Math.sin(i * 0.6) * 3000, 5000 + Math.cos(i * 0.4) * 3000, i * 16])
  };
  const target = canvasProbe();
  const options = { glow: { color: "#ffffff" as const, density: 50, width: 50 } };
  const drawing = drawHandwritingCharacterSteps(target.canvas, { strokes: [stroke] }, options);
  assert.equal(drawing.next().done, false);
  assert.ok(target.counts().contours <= 513, "yield after a bounded number of brush stamps");
  assert.equal(target.counts().fills, 0, "a partial path must not accumulate glow opacity");
  while (!drawing.next().done) { /* Complete the same retained paths. */ }
  const reference = canvasProbe();
  drawHandwritingCharacter(reference.canvas, { strokes: [stroke] }, options);
  assert.deepEqual(target.counts(), reference.counts());
});
