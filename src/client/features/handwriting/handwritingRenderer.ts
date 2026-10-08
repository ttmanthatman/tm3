import { handwritingBrushGeometry, type BrushSample } from "./handwritingBrush";
import { trueBrushContours, trueBrushControlPoints, type NibPoint } from "./handwritingTrueBrush";
import {
  HANDWRITING_DEFAULT_COLOR,
  type HandwritingCharacter,
  type HandwritingGlow,
  type HandwritingPayload,
  type HandwritingPoint,
  type HandwritingStroke
} from "@shared/handwriting";
import { buildHandwritingTimeline, visiblePointCountAt, type HandwritingTimeline } from "./handwritingTimeline";

export const HANDWRITING_CANVAS_SCALE = 10_000;
export const HANDWRITING_STROKE_WIDTH = 360;
// Broad turning footprints need a finer angle step so rotating cusps do not
// leave visible teeth along the outside edge. Settled straight runs keep their
// distance-based stamp count.
const MAX_BRUSH_STAMP_ANGLE = Math.PI / 90;

export type HandwritingCanvas = HTMLCanvasElement | { width: number; height: number; getContext(type: "2d"): CanvasRenderingContext2D | null };
export type HandwritingRendererOptions = {
  lineWidth?: number;
  maxDevicePixelRatio?: number;
  glow?: HandwritingGlow | null;
  visiblePointCounts?: number[];
};

function configureCanvas(canvas: HandwritingCanvas, options: HandwritingRendererOptions) {
  const rect = "getBoundingClientRect" in canvas ? canvas.getBoundingClientRect() : { width: canvas.width, height: canvas.height };
  const cssWidth = Math.max(1, rect.width || canvas.width || 1);
  const cssHeight = Math.max(1, rect.height || canvas.height || 1);
  const ratio = Math.min(Math.max(globalThis.devicePixelRatio || 1, 1), options.maxDevicePixelRatio ?? 3);
  const width = Math.max(1, Math.round(cssWidth * ratio));
  const height = Math.max(1, Math.round(cssHeight * ratio));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.setTransform(width / HANDWRITING_CANVAS_SCALE, 0, 0, height / HANDWRITING_CANVAS_SCALE, 0, 0);
  context.fillStyle = HANDWRITING_DEFAULT_COLOR;
  context.globalCompositeOperation = "source-over";
  context.lineCap = "round";
  context.lineJoin = "round";
  return context;
}

function glowFillStyle(color: HandwritingGlow["color"], alpha: number) {
  const value = color.slice(1);
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

function glowPasses(glow: HandwritingGlow, width: number) {
  const density = Math.max(0, Math.min(100, glow.density)) / 100;
  const expansion = width * (0.5 + 2.5 * (Math.max(0, Math.min(100, glow.width)) / 100));
  return [
    { width: width + expansion * 1.2, fillStyle: glowFillStyle(glow.color, density * 0.28) },
    { width: width + expansion * 0.55, fillStyle: glowFillStyle(glow.color, density * 0.56) }
  ];
}

function brushFootprintPoint(sample: BrushSample, along: number, side: number, expansion: number) {
  const tangentX = Math.cos(sample.angle);
  const tangentY = Math.sin(sample.angle);
  const normalX = -tangentY;
  const normalY = tangentX;
  return {
    x: sample.x + tangentX * along + normalX * side,
    y: sample.y + tangentY * along + normalY * side
  };
}

export function traceBrushFootprintPath(context: CanvasRenderingContext2D, sample: BrushSample, expansion = 0, closePath = true) {
  const width = Math.max(1, sample.width + expansion);
  const spread = Math.max(0.12, Math.min(1, sample.spread));
  const halfWidth = width * 0.5 * (0.78 + 0.22 * spread);
  if (sample.version === 2 && (sample.algorithm === "slanted" || !sample.directional)) {
    const { along, side } = naturalFootprintRadii(sample, expansion);
    const start = brushFootprintPoint(sample, along, 0, expansion);
    context.moveTo(start.x, start.y);
    context.ellipse(sample.x, sample.y, along, side, sample.angle, 0, Math.PI * 2);
    if (closePath) context.closePath();
    return;
  }
  if (sample.algorithm === "slanted") {
    // A flat chisel brush keeps its broad edge at 45 degrees at every stamp.
    const halfDepth = width * 0.12;
    const corners = [
      brushFootprintPoint(sample, -halfWidth, -halfDepth, expansion),
      brushFootprintPoint(sample, halfWidth, -halfDepth, expansion),
      brushFootprintPoint(sample, halfWidth, halfDepth, expansion),
      brushFootprintPoint(sample, -halfWidth, halfDepth, expansion)
    ];
    context.moveTo(corners[0].x, corners[0].y);
    for (const corner of corners.slice(1)) context.lineTo(corner.x, corner.y);
    if (closePath) context.closePath();
    return;
  }
  if (!sample.directional) {
    context.arc(sample.x, sample.y, halfWidth, 0, Math.PI * 2);
    return;
  }
  if (sample.fold) {
    for (const contour of trueBrushContours(sample, sample.fold, expansion)) {
      if (contour.length < 3) continue;
      context.moveTo(contour[0].x, contour[0].y);
      for (const point of contour.slice(1)) context.lineTo(point.x, point.y);
      if (closePath) context.closePath();
    }
    return;
  }
  const points = sample.algorithm === "true-v1" ? trueBrushControlPoints(sample, expansion) : brushLeafControlPoints(sample, expansion);
  // Match the positive winding of ellipses and sweep hulls. Opposite winding
  // cancels overlapping subpaths in a single fill, leaving hollow end nibs
  // and fine scale-shaped seams inside the swept ink.
  context.moveTo(points[0].x, points[0].y);
  context.bezierCurveTo(points[7].x, points[7].y, points[6].x, points[6].y, points[5].x, points[5].y);
  context.bezierCurveTo(points[4].x, points[4].y, points[4].x, points[4].y, points[3].x, points[3].y);
  context.bezierCurveTo(points[2].x, points[2].y, points[1].x, points[1].y, points[0].x, points[0].y);
  if (closePath) context.closePath();
}

function brushLeafControlPoints(sample: BrushSample, expansion: number) {
  const width = Math.max(1, sample.width + expansion);
  const spread = Math.max(0.12, Math.min(1, sample.spread));
  const contact = Math.max(0.05, Math.min(1, sample.contact));
  const halfWidth = width * 0.5 * (0.78 + 0.22 * spread);
  const length = width * (0.42 + 0.28 * spread);
  const trailingTip = -length * (0.82 + 0.18 * contact);
  const leadingNose = length * (0.58 + 0.16 * (1 - spread));
  const shoulder = length * 0.04;
  const tipSide = width * (sample.bend ?? 0);
  return [
    brushFootprintPoint(sample, trailingTip, tipSide, expansion),
    brushFootprintPoint(sample, trailingTip * 0.28, halfWidth * 0.72 + tipSide * 0.45, expansion),
    brushFootprintPoint(sample, shoulder, halfWidth, expansion),
    brushFootprintPoint(sample, leadingNose * 0.68, halfWidth * 0.62, expansion),
    brushFootprintPoint(sample, leadingNose, 0, expansion),
    brushFootprintPoint(sample, leadingNose * 0.68, -halfWidth * 0.62, expansion),
    brushFootprintPoint(sample, shoulder, -halfWidth, expansion),
    brushFootprintPoint(sample, trailingTip * 0.28, -halfWidth * 0.72 + tipSide * 0.45, expansion)
  ];
}

function interpolatedBrushSample(from: BrushSample, to: BrushSample, amount: number): BrushSample {
  // A completed paper reflection is already the released nib's shape. Its
  // stored angle changes at release; interpolating that angle would invent
  // the rigid rotation the fold deliberately replaces.
  if (from.fold && !to.fold) return to;
  const angleDelta = Math.atan2(Math.sin(to.angle - from.angle), Math.cos(to.angle - from.angle));
  return {
    ...to,
    x: from.x + (to.x - from.x) * amount,
    y: from.y + (to.y - from.y) * amount,
    width: from.width + (to.width - from.width) * amount,
    angle: from.angle + angleDelta * amount,
    ...(to.bend !== undefined ? { bend: (from.bend ?? 0) + (to.bend - (from.bend ?? 0)) * amount } : {}),
    ...(to.fold ? { fold: { ...to.fold, travel: (from.fold?.travel ?? 0) + (to.fold.travel - (from.fold?.travel ?? 0)) * amount } } : {}),
    contact: from.contact + (to.contact - from.contact) * amount,
    spread: from.spread + (to.spread - from.spread) * amount
  };
}

function naturalFootprintRadii(sample: BrushSample, expansion: number) {
  const width = Math.max(1, sample.width + expansion);
  const halfWidth = width * 0.5 * (0.78 + 0.22 * Math.max(0.12, Math.min(1, sample.spread)));
  if (!sample.directional) return { along: halfWidth, side: halfWidth };
  const depth = width * 0.11;
  return sample.algorithm === "slanted" ? { along: halfWidth, side: depth } : { along: depth, side: halfWidth };
}

type OutlinePoint = { x: number; y: number };

function naturalFootprintPoints(sample: BrushSample, expansion: number): OutlinePoint[] {
  if (sample.algorithm === "true-v1" && sample.directional) return trueBrushContours(sample, sample.fold, expansion).flat();
  if (sample.directional && sample.algorithm !== "slanted") {
    const points = brushLeafControlPoints(sample, expansion);
    return [[0, 1, 2, 3], [3, 4, 4, 5], [5, 6, 7, 0]].flatMap((indices) =>
      Array.from({ length: 12 }, (_, index) => {
        const t = index / 12;
        const weights = [(1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t ** 2, t ** 3];
        return {
          x: indices.reduce((sum, pointIndex, i) => sum + points[pointIndex].x * weights[i], 0),
          y: indices.reduce((sum, pointIndex, i) => sum + points[pointIndex].y * weights[i], 0)
        };
      })
    );
  }
  const { along, side } = naturalFootprintRadii(sample, expansion);
  return Array.from({ length: 16 }, (_, index) => {
    const angle = (index * Math.PI) / 8;
    return brushFootprintPoint(sample, along * Math.cos(angle), side * Math.sin(angle), expansion);
  });
}

function tracePointHull(context: CanvasRenderingContext2D, outline: NibPoint[]) {
  // Connect the support envelopes of consecutive nib cross-sections. The
  // swept body fills the space between them, retaining the rotating waterdrop
  // nib for follow and the fixed shallow cross-section for slanted.
  const points = outline.sort((a, b) => a.x - b.x || a.y - b.y);
  if (points.length < 3) return;
  const cross = (a: OutlinePoint, b: OutlinePoint, c: OutlinePoint) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const half = (ordered: OutlinePoint[]) => {
    const hull: OutlinePoint[] = [];
    for (const point of ordered) {
      while (hull.length > 1 && cross(hull[hull.length - 2], hull[hull.length - 1], point) <= 0) hull.pop();
      hull.push(point);
    }
    hull.pop();
    return hull;
  };
  const hull = [...half(points), ...half([...points].reverse())];
  if (hull.length < 3) return;
  context.moveTo(hull[0].x, hull[0].y);
  for (const point of hull.slice(1)) context.lineTo(point.x, point.y);
}

function traceNaturalSweep(context: CanvasRenderingContext2D, from: BrushSample, to: BrushSample, expansion: number) {
  if (from.fold || to.fold) {
    const layers = (sample: BrushSample) => {
      if (sample.fold) return trueBrushContours(sample, sample.fold, expansion);
      const contour = naturalFootprintPoints(sample, expansion);
      return from.fold && !to.fold ? [[], contour] : [contour, []];
    };
    const before = layers(from);
    const after = layers(to);
    // Sweep each contact layer separately. A single hull around both folded
    // layers would fill areas that no bristle actually touched.
    for (let layer = 0; layer < 2; layer++) tracePointHull(context, [...before[layer], ...after[layer]]);
  } else tracePointHull(context, [...naturalFootprintPoints(from, expansion), ...naturalFootprintPoints(to, expansion)]);
  traceBrushFootprintPath(context, to, expansion, false);
}

function* drawBrushOutlineSteps(context: CanvasRenderingContext2D, samples: readonly BrushSample[], from: number, until: number, expansion: number): Generator<void> {
  if (from >= until) return;
  context.beginPath();
  // fill() closes each subpath implicitly. Repeated explicit closure scans
  // growing paths in some browsers and can stall dense drawings for seconds.
  // Keep one fill per pass to preserve overlapping glow opacity.
  if (from === 0) traceBrushFootprintPath(context, samples[0], expansion, false);
  let stamps = 0;
  for (let index = Math.max(1, from); index < until; index += 1) {
    const previous = samples[index - 1];
    const sample = samples[index];
    const distance = Math.hypot(sample.x - previous.x, sample.y - previous.y);
    const stampSpacing = Math.max(6, Math.min(previous.width, sample.width) * 0.42);
    const angleDelta = sample.fold || previous.fold ? 0 : Math.atan2(Math.sin(sample.angle - previous.angle), Math.cos(sample.angle - previous.angle));
    const foldTravel = sample.fold ? Math.abs(sample.fold.travel - (previous.fold?.travel ?? 0)) * 2 : 0;
    const stampCount = Math.max(1, Math.ceil(Math.max(distance, foldTravel) / stampSpacing), Math.ceil(Math.abs(angleDelta) / MAX_BRUSH_STAMP_ANGLE));
    let previousStamp = previous;
    for (let stamp = 1; stamp <= stampCount; stamp += 1) {
      const nextStamp = interpolatedBrushSample(previous, sample, stamp / stampCount);
      if (sample.version === 2) traceNaturalSweep(context, previousStamp, nextStamp, expansion);
      else traceBrushFootprintPath(context, nextStamp, expansion, false);
      previousStamp = nextStamp;
      if (++stamps % 512 === 0) yield;
    }
  }
  context.fill();
}

function drawPoint(context: CanvasRenderingContext2D, point: HandwritingPoint, width: number) {
  context.beginPath();
  context.arc(point[0], point[1], Math.max(1, width / 2), 0, Math.PI * 2);
  context.fill();
}

function drawSegment(context: CanvasRenderingContext2D, from: HandwritingPoint, to: HandwritingPoint, width: number, endWidth = width) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const distance = Math.hypot(dx, dy);
  if (!distance) return;
  const nx = -dy / distance;
  const ny = dx / distance;
  const half = width / 2;
  const endHalf = endWidth / 2;
  context.beginPath();
  context.moveTo(from[0] + nx * half, from[1] + ny * half);
  context.lineTo(to[0] + nx * endHalf, to[1] + ny * endHalf);
  context.lineTo(to[0] - nx * endHalf, to[1] - ny * endHalf);
  context.lineTo(from[0] - nx * half, from[1] - ny * half);
  context.closePath();
  context.fill();
}

function* drawStrokeGeometrySteps(
  context: CanvasRenderingContext2D,
  stroke: HandwritingStroke,
  startPointIndex: number,
  visiblePoints: number,
  width: number
): Generator<void> {
  const end = Math.min(stroke.points.length, Math.max(0, visiblePoints));
  if (startPointIndex >= end) return;
  if (stroke.brush) {
    const geometry = handwritingBrushGeometry(stroke);
    const from = startPointIndex === 0 ? 0 : geometry.ends[startPointIndex - 1];
    const until = end === 0 ? 0 : geometry.ends[end - 1];
    yield* drawBrushOutlineSteps(context, geometry.samples, from, until, width - HANDWRITING_STROKE_WIDTH);
    return;
  }
  let index = Math.max(0, startPointIndex);
  if (index >= end) return;
  if (index === 0) {
    drawPoint(context, stroke.points[0], width);
    index = 1;
  }
  for (; index < end; index += 1) {
    drawSegment(context, stroke.points[index - 1], stroke.points[index], width);
    drawPoint(context, stroke.points[index], width);
    if (index % 512 === 0) yield;
  }
}

function drawStrokeGeometry(context: CanvasRenderingContext2D, stroke: HandwritingStroke, start: number, end: number, width: number) {
  const drawing = drawStrokeGeometrySteps(context, stroke, start, end, width);
  while (!drawing.next().done) { /* Synchronous composer and replay entry points. */ }
}

function drawStrokes(
  context: CanvasRenderingContext2D,
  strokes: Array<{ stroke: HandwritingStroke; visiblePoints: number }>,
  width: number,
  glow?: HandwritingGlow | null
) {
  if (glow) {
    for (const pass of glowPasses(glow, width)) {
      context.fillStyle = pass.fillStyle;
      for (const entry of strokes) drawStrokeGeometry(context, entry.stroke, 0, entry.visiblePoints, pass.width);
    }
  }
  for (const entry of strokes) {
    context.fillStyle = entry.stroke.color || HANDWRITING_DEFAULT_COLOR;
    drawStrokeGeometry(context, entry.stroke, 0, entry.visiblePoints, width);
  }
}

export function appendHandwritingStroke(
  canvas: HandwritingCanvas,
  stroke: HandwritingStroke,
  startPointIndex: number,
  options: HandwritingRendererOptions = {}
) {
  const context = configureCanvas(canvas, options);
  if (!context || startPointIndex >= stroke.points.length) return;
  const width = Math.max(1, options.lineWidth ?? HANDWRITING_STROKE_WIDTH);
  if (options.glow) {
    context.globalCompositeOperation = "destination-over";
    for (const pass of glowPasses(options.glow, width)) {
      context.fillStyle = pass.fillStyle;
      drawStrokeGeometry(context, stroke, startPointIndex, stroke.points.length, pass.width);
    }
    context.globalCompositeOperation = "source-over";
  }
  context.fillStyle = stroke.color || HANDWRITING_DEFAULT_COLOR;
  drawStrokeGeometry(context, stroke, startPointIndex, stroke.points.length, width);
}

export function clearHandwritingCanvas(canvas: HandwritingCanvas) {
  const context = configureCanvas(canvas, {});
  if (!context) return;
  context.clearRect(0, 0, HANDWRITING_CANVAS_SCALE, HANDWRITING_CANVAS_SCALE);
}

export function drawHandwritingCharacter(
  canvas: HandwritingCanvas,
  character: HandwritingCharacter | null | undefined,
  options: HandwritingRendererOptions = {}
) {
  const context = configureCanvas(canvas, options);
  if (!context) return;
  context.clearRect(0, 0, HANDWRITING_CANVAS_SCALE, HANDWRITING_CANVAS_SCALE);
  if (!character) return;
  const width = Math.max(1, options.lineWidth ?? HANDWRITING_STROKE_WIDTH);
  drawStrokes(
    context,
    character.strokes.map((stroke, index) => ({ stroke, visiblePoints: options.visiblePointCounts?.[index] ?? stroke.points.length })),
    width,
    options.glow
  );
}

// Static message rendering can yield within a large stroke without splitting
// its fill, so dense paths stay responsive and glow overlaps stay identical.
export function* drawHandwritingCharacterSteps(
  canvas: HandwritingCanvas,
  character: HandwritingCharacter,
  options: HandwritingRendererOptions = {}
): Generator<void> {
  const context = configureCanvas(canvas, options);
  if (!context) return;
  context.clearRect(0, 0, HANDWRITING_CANVAS_SCALE, HANDWRITING_CANVAS_SCALE);
  const width = Math.max(1, options.lineWidth ?? HANDWRITING_STROKE_WIDTH);
  if (options.glow) {
    for (const pass of glowPasses(options.glow, width)) {
      for (const stroke of character.strokes) {
        context.fillStyle = pass.fillStyle;
        yield* drawStrokeGeometrySteps(context, stroke, 0, stroke.points.length, pass.width);
        yield;
      }
    }
  }
  for (const stroke of character.strokes) {
    context.fillStyle = stroke.color || HANDWRITING_DEFAULT_COLOR;
    yield* drawStrokeGeometrySteps(context, stroke, 0, stroke.points.length, width);
    yield;
  }
}

export function drawHandwritingPayload(canvas: HandwritingCanvas, payload: HandwritingPayload | null | undefined, options: HandwritingRendererOptions = {}) {
  const context = configureCanvas(canvas, options);
  if (!context) return;
  context.clearRect(0, 0, HANDWRITING_CANVAS_SCALE, HANDWRITING_CANVAS_SCALE);
  if (!payload) return;
  const width = Math.max(1, options.lineWidth ?? HANDWRITING_STROKE_WIDTH);
  const glow = options.glow === undefined ? payload.glow : options.glow;
  drawStrokes(
    context,
    payload.characters.flatMap((character) => character.strokes.map((stroke) => ({ stroke, visiblePoints: stroke.points.length }))),
    width,
    glow
  );
}

export function drawHandwritingTimelineAt(
  canvas: HandwritingCanvas,
  payload: HandwritingPayload,
  timeline: HandwritingTimeline,
  elapsedMs: number,
  options: HandwritingRendererOptions = {}
) {
  const context = configureCanvas(canvas, options);
  if (!context) return;
  context.clearRect(0, 0, HANDWRITING_CANVAS_SCALE, HANDWRITING_CANVAS_SCALE);
  const width = Math.max(1, options.lineWidth ?? HANDWRITING_STROKE_WIDTH);
  const glow = options.glow === undefined ? payload.glow : options.glow;
  const visible = visiblePointCountAt(timeline, elapsedMs);
  const counts = new Map<string, number>();
  for (let index = 0; index < visible; index += 1) {
    const event = timeline.events[index];
    const key = `${event.characterIndex}:${event.strokeIndex}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const strokes: Array<{ stroke: HandwritingStroke; visiblePoints: number }> = [];
  for (const [key, count] of counts) {
    const [characterIndex, strokeIndex] = key.split(":").map(Number);
    const stroke = payload.characters[characterIndex]?.strokes[strokeIndex];
    if (stroke) strokes.push({ stroke, visiblePoints: count });
  }
  drawStrokes(context, strokes, width, glow);
}

export function drawHandwritingProgress(canvas: HandwritingCanvas, payload: HandwritingPayload, timeline: HandwritingTimeline, elapsedMs: number, options?: HandwritingRendererOptions) {
  drawHandwritingTimelineAt(canvas, payload, timeline, elapsedMs, options);
}

export { buildHandwritingTimeline };

/** Draw in the caller's coordinate system without clearing or resizing its surface. */
export function drawHandwritingInk(context: CanvasRenderingContext2D, character: HandwritingCharacter, visiblePointCounts?: number[]) {
  drawStrokes(context, character.strokes.map((stroke, index) => ({ stroke, visiblePoints: visiblePointCounts?.[index] ?? stroke.points.length })), HANDWRITING_STROKE_WIDTH, null);
}

/** Yield dense folio paths using the same ink geometry and coordinate system. */
export function* drawHandwritingInkSteps(context: CanvasRenderingContext2D, character: HandwritingCharacter, visiblePointCounts?: number[]): Generator<void> {
  for (const [index, stroke] of character.strokes.entries()) {
    context.fillStyle = stroke.color || HANDWRITING_DEFAULT_COLOR;
    yield* drawStrokeGeometrySteps(context, stroke, 0, visiblePointCounts?.[index] ?? stroke.points.length, HANDWRITING_STROKE_WIDTH);
    yield;
  }
}
