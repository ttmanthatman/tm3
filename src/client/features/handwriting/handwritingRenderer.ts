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

export type HandwritingCanvas = HTMLCanvasElement | { width: number; height: number; getContext(type: "2d"): CanvasRenderingContext2D | null };
export type HandwritingRendererOptions = {
  lineWidth?: number;
  maxDevicePixelRatio?: number;
  glow?: HandwritingGlow | null;
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

function drawPoint(context: CanvasRenderingContext2D, point: HandwritingPoint, width: number) {
  context.beginPath();
  context.arc(point[0], point[1], Math.max(1, width / 2), 0, Math.PI * 2);
  context.fill();
}

function drawSegment(context: CanvasRenderingContext2D, from: HandwritingPoint, to: HandwritingPoint, width: number) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const distance = Math.hypot(dx, dy);
  if (!distance) return;
  const nx = -dy / distance;
  const ny = dx / distance;
  const half = width / 2;
  context.beginPath();
  context.moveTo(from[0] + nx * half, from[1] + ny * half);
  context.lineTo(to[0] + nx * half, to[1] + ny * half);
  context.lineTo(to[0] - nx * half, to[1] - ny * half);
  context.lineTo(from[0] - nx * half, from[1] - ny * half);
  context.closePath();
  context.fill();
}

function drawStrokeGeometry(
  context: CanvasRenderingContext2D,
  stroke: HandwritingStroke,
  startPointIndex: number,
  visiblePoints: number,
  width: number
) {
  const end = Math.min(stroke.points.length, Math.max(0, visiblePoints));
  let index = Math.max(0, startPointIndex);
  if (index >= end) return;
  if (index === 0) {
    drawPoint(context, stroke.points[0], width);
    index = 1;
  }
  for (; index < end; index += 1) {
    drawSegment(context, stroke.points[index - 1], stroke.points[index], width);
    drawPoint(context, stroke.points[index], width);
  }
}

const GLITTER_PASSES = [
  { widthScale: 1.13, fillStyle: "#c4528c" },
  { widthScale: 1.02, fillStyle: "#f3a6ce" },
  { widthScale: 0.34, fillStyle: "#fff3fa" }
] as const;
const GLITTER_COLORS = ["#fff3fa", "#ffd0e8", "#f8c8ff"] as const;

function glitterHash(segmentIndex: number, markIndex: number, from: HandwritingPoint, to: HandwritingPoint) {
  let hash = (segmentIndex + 1) * 83492791 ^ (markIndex + 1) * 2971215073;
  for (const point of [from, to]) {
    hash = Math.imul(hash ^ point[0], 33) ^ Math.imul(hash ^ point[1], 17);
  }
  return hash >>> 0;
}

function drawGlitterSparkle(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  fillStyle: string
) {
  const inner = size * 0.22;
  context.fillStyle = fillStyle;
  context.beginPath();
  context.moveTo(x, y - size);
  context.lineTo(x + inner, y - inner);
  context.lineTo(x + size, y);
  context.lineTo(x + inner, y + inner);
  context.lineTo(x, y + size);
  context.lineTo(x - inner, y + inner);
  context.lineTo(x - size, y);
  context.lineTo(x - inner, y - inner);
  context.closePath();
  context.fill();
  context.beginPath();
  context.arc(x, y, Math.max(1, size * 0.18), 0, Math.PI * 2);
  context.fill();
}

function drawGlitterSegment(
  context: CanvasRenderingContext2D,
  from: HandwritingPoint,
  to: HandwritingPoint,
  segmentIndex: number,
  width: number
) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const distance = Math.hypot(dx, dy);
  if (!distance) return;
  const count = Math.min(5, Math.floor(distance / 850));
  const nx = -dy / distance;
  const ny = dx / distance;
  for (let markIndex = 0; markIndex < count; markIndex += 1) {
    const hash = glitterHash(segmentIndex, markIndex, from, to);
    const progress = (markIndex + 0.5) / count + ((hash % 101) / 101 - 0.5) * (0.55 / count);
    const offset = (((hash >>> 8) % 101) / 100 - 0.5) * width * 0.38;
    const size = width * (0.85 + ((hash >>> 16) % 3) * 0.12);
    const color = GLITTER_COLORS[(hash >>> 24) % GLITTER_COLORS.length];
    drawGlitterSparkle(
      context,
      from[0] + dx * progress + nx * offset,
      from[1] + dy * progress + ny * offset,
      size,
      color
    );
    if (color !== GLITTER_COLORS[0]) {
      drawGlitterSparkle(
        context,
        from[0] + dx * progress + nx * offset,
        from[1] + dy * progress + ny * offset,
        size * 0.55,
        GLITTER_COLORS[0]
      );
    }
  }
}

function drawGlitter(
  context: CanvasRenderingContext2D,
  stroke: HandwritingStroke,
  startPointIndex: number,
  visiblePoints: number,
  width: number
) {
  const end = Math.min(stroke.points.length, Math.max(0, visiblePoints));
  const start = Math.max(0, startPointIndex);
  if (start >= end) return;
  if (start === 0) {
    const first = stroke.points[0];
    drawGlitterSparkle(context, first[0], first[1], width * 0.85, GLITTER_COLORS[0]);
  }
  for (let index = Math.max(1, start); index < end; index += 1) {
    drawGlitterSegment(context, stroke.points[index - 1], stroke.points[index], index, width);
  }
}

function drawStrokeInk(
  context: CanvasRenderingContext2D,
  stroke: HandwritingStroke,
  startPointIndex: number,
  visiblePoints: number,
  width: number
) {
  if (!stroke.effect) {
    context.fillStyle = stroke.color || HANDWRITING_DEFAULT_COLOR;
    drawStrokeGeometry(context, stroke, startPointIndex, visiblePoints, width);
    return;
  }
  for (const pass of GLITTER_PASSES) {
    context.fillStyle = pass.fillStyle;
    drawStrokeGeometry(context, stroke, startPointIndex, visiblePoints, Math.max(1, width * pass.widthScale));
  }
  drawGlitter(context, stroke, startPointIndex, visiblePoints, width);
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
    drawStrokeInk(context, entry.stroke, 0, entry.visiblePoints, width);
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
  drawStrokeInk(context, stroke, startPointIndex, stroke.points.length, width);
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
    character.strokes.map((stroke) => ({ stroke, visiblePoints: stroke.points.length })),
    width,
    options.glow
  );
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
