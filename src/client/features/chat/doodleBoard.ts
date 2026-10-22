export type DoodlePoint = { x: number; y: number };
export type DoodleStroke = { kind: "stroke"; color: string; width: number; erase: boolean; points: DoodlePoint[] };
export type DoodleText = { kind: "text"; color: string; size: number; text: string; x: number; y: number };
export type DoodleMark = DoodleStroke | DoodleText | { kind: "clear" };
export type DoodleDraft = { version: 1; width: number; height: number; marks: DoodleMark[] };
export const DOODLE_MAX_POINTS = 80000;
export const DOODLE_MAX_MARKS = 1000;
const MAX_DRAFT_BYTES = 3_000_000;
const colorPattern = /^#[\da-f]{6}$/i;

export function doodlePoint(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }, width: number, height: number): DoodlePoint {
  return {
    x: Math.round(Math.max(0, Math.min(width, (clientX - rect.left) / rect.width * width)) * 10) / 10,
    y: Math.round(Math.max(0, Math.min(height, (clientY - rect.top) / rect.height * height)) * 10) / 10
  };
}

export function parseDoodleDraft(raw: string): DoodleDraft {
  if (raw.length > MAX_DRAFT_BYTES) throw new Error("画板草稿过大");
  const value: unknown = JSON.parse(raw);
  const validNumber = (n: unknown, min: number, max: number): n is number => typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1 || !("width" in value) || !("height" in value) || !validNumber(value.width, 300, 1600) || !validNumber(value.height, 300, 1600) || !("marks" in value) || !Array.isArray(value.marks) || value.marks.length > DOODLE_MAX_MARKS) throw new Error("画板草稿格式不正确");
  let points = 0;
  for (const mark of value.marks) {
    if (!mark || typeof mark !== "object") throw new Error("画板内容不正确");
    if (mark.kind === "clear") continue;
    if (typeof mark.color !== "string" || !colorPattern.test(mark.color)) throw new Error("画板颜色不正确");
    if (mark.kind === "stroke") {
      if (!validNumber(mark.width, 1, 80) || typeof mark.erase !== "boolean" || !Array.isArray(mark.points) || !mark.points.length) throw new Error("画板笔迹不正确");
      points += mark.points.length;
      if (points > DOODLE_MAX_POINTS || !mark.points.every((p: DoodlePoint) => p && validNumber(p.x, 0, value.width as number) && validNumber(p.y, 0, value.height as number))) throw new Error("画板笔迹过多或坐标不正确");
    } else if (mark.kind === "text") {
      if (typeof mark.text !== "string" || !mark.text.trim() || mark.text.length > 120 || !validNumber(mark.size, 12, 120) || !validNumber(mark.x, 0, value.width) || !validNumber(mark.y, 0, value.height)) throw new Error("画板文字不正确");
    } else throw new Error("画板内容类型不正确");
  }
  return value as DoodleDraft;
}

export function drawDoodleSegment(ctx: CanvasRenderingContext2D, stroke: DoodleStroke, from: DoodlePoint, to: DoodlePoint) {
  ctx.save();
  ctx.globalCompositeOperation = stroke.erase ? "destination-out" : "source-over";
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  if (from.x === to.x && from.y === to.y) {
    ctx.arc(to.x, to.y, stroke.width / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }
  ctx.restore();
}

export function renderDoodle(ctx: CanvasRenderingContext2D, draft: DoodleDraft) {
  ctx.clearRect(0, 0, draft.width, draft.height);
  for (const mark of draft.marks) {
    if (mark.kind === "clear") ctx.clearRect(0, 0, draft.width, draft.height);
    else if (mark.kind === "text") {
      ctx.save();
      ctx.fillStyle = mark.color;
      ctx.font = `${mark.size}px sans-serif`;
      ctx.textBaseline = "top";
      ctx.fillText(mark.text, mark.x, mark.y, draft.width - mark.x);
      ctx.restore();
    } else {
      drawDoodleSegment(ctx, mark, mark.points[0]!, mark.points[0]!);
      for (let i = 1; i < mark.points.length; i++) drawDoodleSegment(ctx, mark, mark.points[i - 1]!, mark.points[i]!);
    }
  }
}
