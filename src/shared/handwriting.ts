export const HANDWRITING_KIND = "handwriting" as const;
export const HANDWRITING_VERSION = 1 as const;
export const HANDWRITING_CONTENT = "[手写消息]" as const;
export const HANDWRITING_DEFAULT_COLOR = "#263b33" as const;
export const HANDWRITING_STROKE_COLORS = [
  HANDWRITING_DEFAULT_COLOR,
  "#c44536",
  "#e07a3f",
  "#c39218",
  "#2f855a",
  "#2f6fdd",
  "#7656b5",
  "#c04c82"
] as const;
export type HandwritingStrokeColor = (typeof HANDWRITING_STROKE_COLORS)[number];

export type HandwritingPoint = readonly [x: number, y: number, t: number];
export type HandwritingStroke = { points: HandwritingPoint[]; color?: HandwritingStrokeColor };
export type HandwritingCharacter = { strokes: HandwritingStroke[] };
export type HandwritingPayload = {
  kind: typeof HANDWRITING_KIND;
  version: typeof HANDWRITING_VERSION;
  characters: HandwritingCharacter[];
};

export type HandwritingLimits = {
  maxCharacters: number;
  maxStrokesPerCharacter: number;
  maxStrokes: number;
  maxPointsPerStroke: number;
  maxPoints: number;
  maxCharacterDurationMs: number;
  maxBytes: number;
};

export const HANDWRITING_SEND_LIMITS: Readonly<HandwritingLimits> = Object.freeze({
  maxCharacters: 30,
  maxStrokesPerCharacter: 64,
  maxStrokes: 600,
  maxPointsPerStroke: 1024,
  maxPoints: 6000,
  maxCharacterDurationMs: 600_000,
  maxBytes: 131_072
});

export const HANDWRITING_DRAFT_LIMITS: Readonly<HandwritingLimits> = Object.freeze({
  ...HANDWRITING_SEND_LIMITS,
  maxPoints: 12_000,
  maxBytes: 262_144
});

export type HandwritingValidationCode =
  | "invalid_shape"
  | "unknown_version"
  | "unknown_field"
  | "empty"
  | "limit"
  | "invalid_point"
  | "invalid_time"
  | "too_large";

export class HandwritingValidationError extends Error {
  readonly code: HandwritingValidationCode;

  constructor(code: HandwritingValidationCode, message: string) {
    super(message);
    this.name = "HandwritingValidationError";
    this.code = code;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertFields(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new HandwritingValidationError("unknown_field", "手写数据包含未知字段");
  }
}

export function handwritingPayloadBytes(payload: HandwritingPayload): number {
  return new TextEncoder().encode(JSON.stringify(payload)).byteLength;
}

export function isHandwritingStrokeColor(value: unknown): value is HandwritingStrokeColor {
  return typeof value === "string" && (HANDWRITING_STROKE_COLORS as readonly string[]).includes(value);
}

export function normalizeHandwritingPayload(
  input: unknown,
  limits: Readonly<HandwritingLimits> = HANDWRITING_SEND_LIMITS
): HandwritingPayload {
  if (!isPlainObject(input)) throw new HandwritingValidationError("invalid_shape", "手写数据格式无效");
  assertFields(input, ["kind", "version", "characters"]);
  if (input.kind !== HANDWRITING_KIND) throw new HandwritingValidationError("invalid_shape", "手写数据类型无效");
  if (input.version !== HANDWRITING_VERSION) throw new HandwritingValidationError("unknown_version", "暂不支持此手写数据版本");
  if (!Array.isArray(input.characters) || input.characters.length === 0) {
    throw new HandwritingValidationError("empty", "手写消息不能为空");
  }
  if (input.characters.length > limits.maxCharacters) {
    throw new HandwritingValidationError("limit", `手写消息最多 ${limits.maxCharacters} 字`);
  }

  let strokeCount = 0;
  let pointCount = 0;
  for (const character of input.characters) {
    if (!isPlainObject(character)) throw new HandwritingValidationError("invalid_shape", "手写字格格式无效");
    assertFields(character, ["strokes"]);
    if (!Array.isArray(character.strokes) || character.strokes.length === 0) {
      throw new HandwritingValidationError("empty", "手写字格不能没有笔画");
    }
    if (character.strokes.length > limits.maxStrokesPerCharacter) {
      throw new HandwritingValidationError("limit", "单字笔画数量超出限制");
    }
    strokeCount += character.strokes.length;
    if (strokeCount > limits.maxStrokes) throw new HandwritingValidationError("limit", "手写消息笔画数量超出限制");
    for (const stroke of character.strokes) {
      if (!isPlainObject(stroke)) throw new HandwritingValidationError("invalid_shape", "手写笔画格式无效");
      assertFields(stroke, ["points", "color"]);
      if (stroke.color !== undefined && !isHandwritingStrokeColor(stroke.color)) {
        throw new HandwritingValidationError("invalid_shape", "手写笔画颜色无效");
      }
      if (!Array.isArray(stroke.points) || stroke.points.length === 0) {
        throw new HandwritingValidationError("empty", "手写笔画不能没有采样点");
      }
      if (stroke.points.length > limits.maxPointsPerStroke) {
        throw new HandwritingValidationError("limit", "单笔采样点数量超出限制");
      }
      pointCount += stroke.points.length;
      if (pointCount > limits.maxPoints) throw new HandwritingValidationError("limit", "手写消息采样点数量超出限制");
    }
  }

  const characters: HandwritingCharacter[] = [];
  for (const character of input.characters) {
    const rawCharacter = character as { strokes: unknown[] };
    let previousTime = -1;
    let firstPoint = true;
    const strokes: HandwritingStroke[] = [];
    for (const stroke of rawCharacter.strokes) {
      const rawStroke = stroke as { points: unknown[]; color?: unknown };
      const points: HandwritingPoint[] = [];
      for (const point of rawStroke.points) {
        if (!Array.isArray(point) || point.length !== 3) {
          throw new HandwritingValidationError("invalid_point", "手写采样点格式无效");
        }
        const [x, y, t] = point;
        if (![x, y, t].every((value) => typeof value === "number" && Number.isFinite(value) && Number.isInteger(value))) {
          throw new HandwritingValidationError("invalid_point", "手写采样点必须是有限整数");
        }
        if (x < 0 || x > 10_000 || y < 0 || y > 10_000) {
          throw new HandwritingValidationError("invalid_point", "手写坐标超出范围");
        }
        if (firstPoint && t !== 0) throw new HandwritingValidationError("invalid_time", "每个字的首个采样点时间必须为 0");
        if (t < 0 || t > limits.maxCharacterDurationMs || t < previousTime) {
          throw new HandwritingValidationError("invalid_time", "手写采样时间无效");
        }
        firstPoint = false;
        previousTime = t;
        points.push([x, y, t]);
      }
      const color = rawStroke.color;
      strokes.push(color && color !== HANDWRITING_DEFAULT_COLOR ? { points, color: color as HandwritingStrokeColor } : { points });
    }
    characters.push({ strokes });
  }

  const normalized: HandwritingPayload = { kind: HANDWRITING_KIND, version: HANDWRITING_VERSION, characters };
  if (handwritingPayloadBytes(normalized) > limits.maxBytes) {
    throw new HandwritingValidationError("too_large", "手写数据体积超出限制");
  }
  return normalized;
}

export function parseStoredHandwritingPayload(input: unknown): HandwritingPayload | null {
  try {
    return normalizeHandwritingPayload(input);
  } catch {
    return null;
  }
}
