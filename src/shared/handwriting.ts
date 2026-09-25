export const HANDWRITING_KIND = "handwriting" as const;
export const HANDWRITING_VERSION = 1 as const;
export const HANDWRITING_CONTENT = "[手写消息]" as const;
export const HANDWRITING_DEFAULT_COLOR = "#263b33" as const;
export const HANDWRITING_PRESET_COLORS = [
  "#ff4d6d",
  "#ff8a3d",
  "#f4c430",
  "#24b86a",
  "#268cff",
  "#7557ff",
  "#e84aa7"
] as const;
export const HANDWRITING_STROKE_COLORS = HANDWRITING_PRESET_COLORS;
export const HANDWRITING_PRESET_LABELS = ["朱红", "橙色", "金黄", "绿色", "蓝色", "紫色", "玫红"] as const;
export const HANDWRITING_PALETTE_SLOT_COUNT = HANDWRITING_PRESET_COLORS.length;
export const HANDWRITING_CUSTOM_COLOR_INDEX = HANDWRITING_PALETTE_SLOT_COUNT;
export const HANDWRITING_DEFAULT_CUSTOM_COLOR = HANDWRITING_DEFAULT_COLOR;
export const HANDWRITING_DEFAULT_PAPER_COLOR = "#fffaf0" as const;
export const HANDWRITING_DEFAULT_GLOW_COLOR = "#ffffff" as const;
export const HANDWRITING_DEFAULT_GLOW_DENSITY = 65;
export const HANDWRITING_DEFAULT_GLOW_WIDTH = 60;

export type HandwritingColor = `#${string}`;
export type HandwritingStrokeColor = HandwritingColor;

export type HandwritingPaper = {
  color: HandwritingColor;
};

export type HandwritingGlow = {
  color: HandwritingColor;
  density: number;
  width: number;
};

export type HandwritingPen = "hard" | "brush";
export type HandwritingBrush = { size: number; sensitivity: number; lag: number };
export const HANDWRITING_DEFAULT_BRUSH: Readonly<HandwritingBrush> = Object.freeze({ size: 45, sensitivity: 65, lag: 35 });

export function normalizeHandwritingBrush(value: unknown): HandwritingBrush {
  const row = isPlainObject(value) ? value : {};
  return {
    size: normalizeHandwritingGlowAmount(row.size, HANDWRITING_DEFAULT_BRUSH.size),
    sensitivity: normalizeHandwritingGlowAmount(row.sensitivity, HANDWRITING_DEFAULT_BRUSH.sensitivity),
    lag: normalizeHandwritingGlowAmount(row.lag, HANDWRITING_DEFAULT_BRUSH.lag)
  };
}

export type HandwritingPreferencesDTO = {
  pen: HandwritingPen;
  brush: HandwritingBrush;
  strokeColors: HandwritingColor[];
  customColor: HandwritingColor;
  selectedIndex: number;
  paperEnabled: boolean;
  paperColor: HandwritingColor;
  glowEnabled: boolean;
  glowColor: HandwritingColor;
  glowDensity: number;
  glowWidth: number;
};

export const HANDWRITING_DEFAULT_PREFERENCES: HandwritingPreferencesDTO = {
  pen: "hard",
  brush: { ...HANDWRITING_DEFAULT_BRUSH },
  strokeColors: [...HANDWRITING_PRESET_COLORS],
  customColor: HANDWRITING_DEFAULT_CUSTOM_COLOR,
  selectedIndex: 0,
  paperEnabled: false,
  paperColor: HANDWRITING_DEFAULT_PAPER_COLOR,
  glowEnabled: false,
  glowColor: HANDWRITING_DEFAULT_GLOW_COLOR,
  glowDensity: HANDWRITING_DEFAULT_GLOW_DENSITY,
  glowWidth: HANDWRITING_DEFAULT_GLOW_WIDTH
};

export type HandwritingPoint = readonly [x: number, y: number, t: number];
export type HandwritingStroke = { points: HandwritingPoint[]; color?: HandwritingStrokeColor; brush?: HandwritingBrush };
export type HandwritingCharacter = { strokes: HandwritingStroke[] };
export type HandwritingPayload = {
  kind: typeof HANDWRITING_KIND;
  version: typeof HANDWRITING_VERSION;
  characters: HandwritingCharacter[];
  paper?: HandwritingPaper;
  glow?: HandwritingGlow;
};

export type HandwritingLimits = {
  maxCharacters: number;
  maxStrokesPerCharacter: number;
  maxStrokes: number;
  maxPointsPerStroke: number;
  maxPointsPerCharacter: number;
  maxPoints: number;
  maxCharacterDurationMs: number;
  maxBytes: number;
};

export const HANDWRITING_SEND_LIMITS: Readonly<HandwritingLimits> = Object.freeze({
  maxCharacters: 30,
  maxStrokesPerCharacter: 640,
  maxStrokes: 6000,
  maxPointsPerStroke: 10_240,
  maxPointsPerCharacter: 60_000,
  maxPoints: 60_000,
  maxCharacterDurationMs: 600_000,
  maxBytes: 1_310_720
});

export const HANDWRITING_DRAFT_LIMITS: Readonly<HandwritingLimits> = Object.freeze({
  ...HANDWRITING_SEND_LIMITS,
  maxPoints: 120_000,
  maxBytes: 2_621_440
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

export function isHandwritingColor(value: unknown): value is HandwritingColor {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

export function normalizeHandwritingColor(value: unknown, fallback: HandwritingColor): HandwritingColor {
  return isHandwritingColor(value) ? value.toLowerCase() as HandwritingColor : fallback;
}

function normalizeHandwritingGlowAmount(value: unknown, fallback: number): number {
  const amount = Number(value);
  return Number.isInteger(amount) && amount >= 0 && amount <= 100 ? amount : fallback;
}

export function normalizeHandwritingGlow(value: unknown, fallback: HandwritingGlow = {
  color: HANDWRITING_DEFAULT_GLOW_COLOR,
  density: HANDWRITING_DEFAULT_GLOW_DENSITY,
  width: HANDWRITING_DEFAULT_GLOW_WIDTH
}): HandwritingGlow {
  const row = isPlainObject(value) ? value : {};
  return {
    color: normalizeHandwritingColor(row.color, fallback.color),
    density: normalizeHandwritingGlowAmount(row.density, fallback.density),
    width: normalizeHandwritingGlowAmount(row.width, fallback.width)
  };
}

export function isHandwritingStrokeColor(value: unknown): value is HandwritingStrokeColor {
  return isHandwritingColor(value);
}

export function normalizeHandwritingPreferences(value: unknown): HandwritingPreferencesDTO {
  const row = value && typeof value === "object" && !Array.isArray(value)
    ? value as Partial<HandwritingPreferencesDTO>
    : {};
  const strokeColors = Array.isArray(row.strokeColors)
    ? row.strokeColors.slice(0, HANDWRITING_PALETTE_SLOT_COUNT).map((color, index) =>
      normalizeHandwritingColor(color, HANDWRITING_PRESET_COLORS[index])
    )
    : [...HANDWRITING_PRESET_COLORS];
  while (strokeColors.length < HANDWRITING_PALETTE_SLOT_COUNT) {
    strokeColors.push(HANDWRITING_PRESET_COLORS[strokeColors.length]);
  }
  const rawIndex = Number(row.selectedIndex);
  const selectedIndex = Number.isInteger(rawIndex) && rawIndex >= 0 && rawIndex <= HANDWRITING_CUSTOM_COLOR_INDEX
    ? rawIndex
    : 0;
  return {
    pen: row.pen === "brush" ? "brush" : "hard",
    brush: normalizeHandwritingBrush(row.brush),
    strokeColors,
    customColor: normalizeHandwritingColor(row.customColor, HANDWRITING_DEFAULT_CUSTOM_COLOR),
    selectedIndex,
    paperEnabled: row.paperEnabled === true,
    paperColor: normalizeHandwritingColor(row.paperColor, HANDWRITING_DEFAULT_PAPER_COLOR),
    glowEnabled: row.glowEnabled === true,
    glowColor: normalizeHandwritingColor(row.glowColor, HANDWRITING_DEFAULT_GLOW_COLOR),
    glowDensity: normalizeHandwritingGlowAmount(row.glowDensity, HANDWRITING_DEFAULT_GLOW_DENSITY),
    glowWidth: normalizeHandwritingGlowAmount(row.glowWidth, HANDWRITING_DEFAULT_GLOW_WIDTH)
  };
}

export function normalizeHandwritingPayload(
  input: unknown,
  limits: Readonly<HandwritingLimits> = HANDWRITING_SEND_LIMITS
): HandwritingPayload {
  if (!isPlainObject(input)) throw new HandwritingValidationError("invalid_shape", "手写数据格式无效");
  assertFields(input, ["kind", "version", "characters", "paper", "glow"]);
  if (input.kind !== HANDWRITING_KIND) throw new HandwritingValidationError("invalid_shape", "手写数据类型无效");
  if (input.version !== HANDWRITING_VERSION) throw new HandwritingValidationError("unknown_version", "暂不支持此手写数据版本");
  if (!Array.isArray(input.characters) || input.characters.length === 0) {
    throw new HandwritingValidationError("empty", "手写消息不能为空");
  }
  if (input.characters.length > limits.maxCharacters) {
    throw new HandwritingValidationError("limit", `手写消息最多 ${limits.maxCharacters} 字`);
  }
  let paper: HandwritingPaper | undefined;
  if (input.paper !== undefined) {
    if (!isPlainObject(input.paper)) throw new HandwritingValidationError("invalid_shape", "手写纸张格式无效");
    assertFields(input.paper, ["color"]);
    if (!isHandwritingColor(input.paper.color)) {
      throw new HandwritingValidationError("invalid_shape", "手写纸张颜色无效");
    }
    paper = { color: input.paper.color.toLowerCase() as HandwritingColor };
  }
  let glow: HandwritingGlow | undefined;
  if (input.glow !== undefined) {
    if (!isPlainObject(input.glow)) throw new HandwritingValidationError("invalid_shape", "手写光晕格式无效");
    assertFields(input.glow, ["color", "density", "width"]);
    if (input.glow.color !== undefined && !isHandwritingColor(input.glow.color)) {
      throw new HandwritingValidationError("invalid_shape", "手写光晕颜色无效");
    }
    for (const key of ["density", "width"] as const) {
      const amount = input.glow[key];
      if (amount !== undefined && (typeof amount !== "number" || !Number.isInteger(amount) || amount < 0 || amount > 100)) {
        throw new HandwritingValidationError("invalid_shape", "手写光晕参数无效");
      }
    }
    glow = normalizeHandwritingGlow(input.glow);
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
    let characterPoints = 0;
    for (const stroke of character.strokes) {
      if (!isPlainObject(stroke)) throw new HandwritingValidationError("invalid_shape", "手写笔画格式无效");
      assertFields(stroke, ["points", "color", "effect", "brush"]);
      if (stroke.brush !== undefined) {
        if (!isPlainObject(stroke.brush)) throw new HandwritingValidationError("invalid_shape", "毛笔参数格式无效");
        assertFields(stroke.brush, ["size", "sensitivity", "lag"]);
        for (const key of ["size", "sensitivity", "lag"] as const) {
          const value = stroke.brush[key];
          if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100) {
            throw new HandwritingValidationError("invalid_shape", "毛笔参数必须为 0 至 100 的整数");
          }
        }
      }
      if (stroke.color !== undefined && !isHandwritingStrokeColor(stroke.color)) {
        throw new HandwritingValidationError("invalid_shape", "手写笔画颜色无效");
      }
      if (stroke.effect !== undefined && stroke.effect !== "metallic-pink-glitter") {
        throw new HandwritingValidationError("invalid_shape", "手写旧版效果数据无效");
      }
      if (!Array.isArray(stroke.points) || stroke.points.length === 0) {
        throw new HandwritingValidationError("empty", "手写笔画不能没有采样点");
      }
      if (stroke.points.length > limits.maxPointsPerStroke) {
        throw new HandwritingValidationError("limit", "单笔采样点数量超出限制");
      }
      characterPoints += stroke.points.length;
      if (characterPoints > limits.maxPointsPerCharacter) throw new HandwritingValidationError("limit", "单字采样点数量超出限制");
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
      const rawStroke = stroke as { points: unknown[]; color?: unknown; effect?: unknown; brush?: unknown };
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
      const normalizedColor = color === undefined ? HANDWRITING_DEFAULT_COLOR : normalizeHandwritingColor(color, HANDWRITING_DEFAULT_COLOR);
      strokes.push({
        points,
        ...(rawStroke.brush !== undefined ? { brush: normalizeHandwritingBrush(rawStroke.brush) } : {}),
        ...(normalizedColor !== HANDWRITING_DEFAULT_COLOR ? { color: normalizedColor } : {})
      });
    }
    characters.push({ strokes });
  }

  const normalized: HandwritingPayload = {
    kind: HANDWRITING_KIND,
    version: HANDWRITING_VERSION,
    characters,
    ...(paper ? { paper } : {}),
    ...(glow ? { glow } : {})
  };
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
