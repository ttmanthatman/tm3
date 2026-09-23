import {
  HANDWRITING_DEFAULT_COLOR,
  type HandwritingCharacter,
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
  context.lineCap = "round";
  context.lineJoin = "round";
  return context;
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

function drawStroke(context: CanvasRenderingContext2D, stroke: HandwritingStroke, visiblePoints = stroke.points.length, width = HANDWRITING_STROKE_WIDTH) {
  context.fillStyle = stroke.color || HANDWRITING_DEFAULT_COLOR;
  const points = stroke.points.slice(0, Math.max(0, visiblePoints));
  if (!points.length) return;
  drawPoint(context, points[0], width);
  for (let index = 1; index < points.length; index += 1) {
    drawSegment(context, points[index - 1], points[index], width);
    drawPoint(context, points[index], width);
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
  context.fillStyle = stroke.color || HANDWRITING_DEFAULT_COLOR;
  let index = Math.max(0, startPointIndex);
  if (index === 0) {
    drawPoint(context, stroke.points[0], width);
    index = 1;
  }
  for (; index < stroke.points.length; index += 1) {
    drawSegment(context, stroke.points[index - 1], stroke.points[index], width);
    drawPoint(context, stroke.points[index], width);
  }
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
  for (const stroke of character.strokes) drawStroke(context, stroke, stroke.points.length, width);
}

export function drawHandwritingPayload(canvas: HandwritingCanvas, payload: HandwritingPayload | null | undefined, options: HandwritingRendererOptions = {}) {
  const context = configureCanvas(canvas, options);
  if (!context) return;
  context.clearRect(0, 0, HANDWRITING_CANVAS_SCALE, HANDWRITING_CANVAS_SCALE);
  if (!payload) return;
  const width = Math.max(1, options.lineWidth ?? HANDWRITING_STROKE_WIDTH);
  for (const character of payload.characters) {
    for (const stroke of character.strokes) drawStroke(context, stroke, stroke.points.length, width);
  }
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
  const visible = visiblePointCountAt(timeline, elapsedMs);
  const counts = new Map<string, number>();
  for (let index = 0; index < visible; index += 1) {
    const event = timeline.events[index];
    const key = `${event.characterIndex}:${event.strokeIndex}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const [key, count] of counts) {
    const [characterIndex, strokeIndex] = key.split(":").map(Number);
    const stroke = payload.characters[characterIndex]?.strokes[strokeIndex];
    if (stroke) drawStroke(context, stroke, count, width);
  }
}

export function drawHandwritingProgress(canvas: HandwritingCanvas, payload: HandwritingPayload, timeline: HandwritingTimeline, elapsedMs: number, options?: HandwritingRendererOptions) {
  drawHandwritingTimelineAt(canvas, payload, timeline, elapsedMs, options);
}

export { buildHandwritingTimeline };
