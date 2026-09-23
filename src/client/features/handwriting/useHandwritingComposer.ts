import { computed, ref } from "vue";
import {
  HANDWRITING_DEFAULT_COLOR,
  HANDWRITING_DRAFT_LIMITS,
  HANDWRITING_DEFAULT_PAPER_COLOR,
  HANDWRITING_DEFAULT_GLOW_COLOR,
  HANDWRITING_DEFAULT_GLOW_DENSITY,
  HANDWRITING_DEFAULT_GLOW_WIDTH,
  HANDWRITING_PRESET_COLORS,
  HANDWRITING_STROKE_COLORS,
  HANDWRITING_SEND_LIMITS,
  isHandwritingStrokeColor,
  normalizeHandwritingColor,
  normalizeHandwritingGlow,
  normalizeHandwritingPayload,
  type HandwritingColor,
  type HandwritingCharacter,
  type HandwritingGlow,
  type HandwritingPayload,
  type HandwritingPoint,
  type HandwritingStroke,
  type HandwritingStrokeColor
} from "@shared/handwriting";

export type HandwritingInputPoint = {
  x: number;
  y: number;
  timestampMs: number;
};

export type HandwritingComposerSnapshot = {
  key: string;
  payload: HandwritingPayload | null;
  revision: number;
};

export function shouldSampleHandwritingPoint(
  previous: HandwritingPoint | undefined,
  beforePrevious: HandwritingPoint | undefined,
  candidate: HandwritingPoint
) {
  if (!previous) return true;
  const distance = Math.hypot(candidate[0] - previous[0], candidate[1] - previous[1]);
  const elapsed = candidate[2] - previous[2];
  if (distance >= 55 || elapsed >= 8) return true;
  if (!beforePrevious || distance < 18) return false;
  const first = [previous[0] - beforePrevious[0], previous[1] - beforePrevious[1]] as const;
  const second = [candidate[0] - previous[0], candidate[1] - previous[1]] as const;
  const firstLength = Math.hypot(first[0], first[1]);
  const secondLength = Math.hypot(second[0], second[1]);
  if (!firstLength || !secondLength) return false;
  const cosine = (first[0] * second[0] + first[1] * second[1]) / (firstLength * secondLength);
  return cosine < 0.87;
}

function cloneCharacter(character: HandwritingCharacter): HandwritingCharacter {
  return {
    strokes: character.strokes.map((stroke) => ({
      points: stroke.points.map((point) => [...point] as HandwritingPoint),
      ...(stroke.color ? { color: stroke.color } : {})
    }))
  };
}

function characterPointCount(character: HandwritingCharacter) {
  return character.strokes.reduce((sum, stroke) => sum + stroke.points.length, 0);
}

function clampCoordinate(value: number) {
  return Math.max(0, Math.min(10_000, Math.round(Number.isFinite(value) ? value : 0)));
}

export function useHandwritingComposer(initial?: Partial<HandwritingComposerSnapshot>) {
  const scopeKey = ref(initial?.key || "");
  const characters = ref<HandwritingCharacter[]>([]);
  const current = ref<HandwritingCharacter>({ strokes: [] });
  const revision = ref(initial?.revision || 0);
  const errorMessage = ref("");
  const activePointerId = ref<number | null>(null);
  const selectedColor = ref<HandwritingStrokeColor>(HANDWRITING_PRESET_COLORS[0]);
  const paperEnabled = ref(false);
  const paperColor = ref<HandwritingStrokeColor>(HANDWRITING_DEFAULT_PAPER_COLOR);
  const glowEnabled = ref(false);
  const glowColor = ref<HandwritingColor>(HANDWRITING_DEFAULT_GLOW_COLOR);
  const glowDensity = ref(HANDWRITING_DEFAULT_GLOW_DENSITY);
  const glowWidth = ref(HANDWRITING_DEFAULT_GLOW_WIDTH);
  let timestampOrigin: number | null = null;

  const completedPointCount = computed(() => characters.value.reduce((sum, character) => sum + characterPointCount(character), 0));
  const currentPointCount = computed(() => characterPointCount(current.value));
  const totalPointCount = computed(() => completedPointCount.value + currentPointCount.value);
  const strokeCount = computed(() => characters.value.reduce((sum, character) => sum + character.strokes.length, 0) + current.value.strokes.length);
  const hasContent = computed(() => totalPointCount.value > 0);
  const snapshotCharacters = computed<HandwritingCharacter[]>(() => {
    const result = characters.value.map(cloneCharacter);
    if (current.value.strokes.length) result.push(cloneCharacter(current.value));
    return result;
  });

  function touch() {
    revision.value += 1;
  }

  function pointFor(input: HandwritingInputPoint): HandwritingPoint {
    if (timestampOrigin === null) timestampOrigin = input.timestampMs;
    const time = Math.max(0, Math.min(HANDWRITING_DRAFT_LIMITS.maxCharacterDurationMs, Math.round(input.timestampMs - timestampOrigin)));
    const strokes = current.value.strokes;
    const last = strokes.at(-1)?.points.at(-1);
    return [clampCoordinate(input.x), clampCoordinate(input.y), Math.max(time, last?.[2] ?? 0)];
  }

  function selectColor(color: unknown) {
    if (!isHandwritingStrokeColor(color)) return false;
    selectedColor.value = color;
    return true;
  }

  function setPaper(enabled: boolean, color?: unknown) {
    const nextColor = normalizeHandwritingColor(color, paperColor.value);
    if (paperEnabled.value === enabled && paperColor.value === nextColor) return false;
    paperEnabled.value = enabled;
    paperColor.value = nextColor;
    touch();
    return true;
  }

  function setGlow(enabled: boolean, color?: unknown, density?: unknown, width?: unknown) {
    const next = normalizeHandwritingGlow({
      color,
      density,
      width
    }, {
      color: glowColor.value,
      density: glowDensity.value,
      width: glowWidth.value
    });
    if (
      glowEnabled.value === enabled &&
      glowColor.value === next.color &&
      glowDensity.value === next.density &&
      glowWidth.value === next.width
    ) return false;
    glowEnabled.value = enabled;
    glowColor.value = next.color;
    glowDensity.value = next.density;
    glowWidth.value = next.width;
    touch();
    return true;
  }

  function glowSettings(): HandwritingGlow {
    return {
      color: glowColor.value,
      density: glowDensity.value,
      width: glowWidth.value
    };
  }

  function beginStroke(input: HandwritingInputPoint, pointerId: number) {
    if (activePointerId.value !== null || activePointerId.value === pointerId) return false;
    if (hasContent.value && characters.value.length >= HANDWRITING_DRAFT_LIMITS.maxCharacters && !current.value.strokes.length) {
      errorMessage.value = "最多 30 字，请删除一个字格或发送这一条";
      return false;
    }
    if (strokeCount.value >= HANDWRITING_DRAFT_LIMITS.maxStrokes || totalPointCount.value >= HANDWRITING_DRAFT_LIMITS.maxPoints) {
      errorMessage.value = "手写数据已达保护上限，请撤销一笔或删除一个字";
      return false;
    }
    if (current.value.strokes.length >= HANDWRITING_DRAFT_LIMITS.maxStrokesPerCharacter) {
      errorMessage.value = "单字笔画数量已达上限，请删除一个字或撤销一笔";
      return false;
    }
    activePointerId.value = pointerId;
    const point = pointFor(input);
    const stroke: HandwritingStroke = {
      points: [point],
      ...(selectedColor.value !== HANDWRITING_DEFAULT_COLOR ? { color: selectedColor.value } : {})
    };
    current.value.strokes.push(stroke);
    touch();
    errorMessage.value = "";
    return true;
  }

  function appendPoint(pointerId: number, input: HandwritingInputPoint, force = false) {
    if (activePointerId.value !== pointerId) return false;
    const stroke = current.value.strokes.at(-1);
    if (!stroke) return false;
    const point = pointFor(input);
    const previous = stroke.points.at(-1);
    if (previous && previous[0] === point[0] && previous[1] === point[1] && previous[2] === point[2]) return false;
    if (!force && !shouldSampleHandwritingPoint(previous, stroke.points.at(-2), point)) return false;
    if (stroke.points.length >= HANDWRITING_DRAFT_LIMITS.maxPointsPerStroke || totalPointCount.value >= HANDWRITING_DRAFT_LIMITS.maxPoints) {
      errorMessage.value = "这一笔已达采样点上限，请抬笔后继续";
      return false;
    }
    stroke.points.push(point);
    touch();
    return true;
  }

  function endStroke(pointerId: number, input?: HandwritingInputPoint) {
    if (activePointerId.value !== pointerId) return false;
    if (input) appendPoint(pointerId, input, true);
    activePointerId.value = null;
    touch();
    return true;
  }

  function cancelStroke(pointerId: number) {
    if (activePointerId.value !== pointerId) return false;
    activePointerId.value = null;
    touch();
    return true;
  }

  function undoStroke() {
    if (!current.value.strokes.length) return false;
    current.value.strokes.pop();
    if (!current.value.strokes.length) timestampOrigin = null;
    touch();
    errorMessage.value = "";
    return true;
  }

  function clearCurrent() {
    if (!current.value.strokes.length) return false;
    current.value = { strokes: [] };
    timestampOrigin = null;
    activePointerId.value = null;
    touch();
    errorMessage.value = "";
    return true;
  }

  function finishCharacter() {
    if (!current.value.strokes.length) return false;
    if (characters.value.length >= HANDWRITING_DRAFT_LIMITS.maxCharacters) {
      errorMessage.value = "最多 30 字，请删除一个字格或发送这一条";
      return false;
    }
    characters.value.push(cloneCharacter(current.value));
    current.value = { strokes: [] };
    timestampOrigin = null;
    touch();
    errorMessage.value = "";
    return true;
  }

  function deleteCharacter(index: number) {
    if (index < 0 || index >= characters.value.length) return false;
    characters.value.splice(index, 1);
    touch();
    errorMessage.value = "";
    return true;
  }

  function clearAll() {
    if (!hasContent.value) return false;
    characters.value = [];
    current.value = { strokes: [] };
    timestampOrigin = null;
    activePointerId.value = null;
    touch();
    errorMessage.value = "";
    return true;
  }

  function snapshot(): HandwritingPayload | null {
    const candidates = snapshotCharacters.value;
    if (!candidates.length) return null;
    try {
      return normalizeHandwritingPayload({
        kind: "handwriting",
        version: 1,
        characters: candidates,
        ...(paperEnabled.value ? { paper: { color: paperColor.value } } : {}),
        ...(glowEnabled.value ? { glow: glowSettings() } : {})
      }, HANDWRITING_SEND_LIMITS);
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : "手写内容暂无法发送";
      return null;
    }
  }

  function draftSnapshot(): HandwritingPayload | null {
    const candidates = snapshotCharacters.value;
    if (!candidates.length) return null;
    try {
      return normalizeHandwritingPayload({
        kind: "handwriting",
        version: 1,
        characters: candidates,
        ...(paperEnabled.value ? { paper: { color: paperColor.value } } : {}),
        ...(glowEnabled.value ? { glow: glowSettings() } : {})
      }, HANDWRITING_DRAFT_LIMITS);
    } catch {
      return null;
    }
  }

  function load(next: Partial<HandwritingComposerSnapshot>) {
    scopeKey.value = next.key || "";
    revision.value = next.revision || 0;
    activePointerId.value = null;
    timestampOrigin = null;
    errorMessage.value = "";
    if (!next.payload) {
      characters.value = [];
      current.value = { strokes: [] };
      selectedColor.value = HANDWRITING_PRESET_COLORS[0];
      paperEnabled.value = false;
      paperColor.value = HANDWRITING_DEFAULT_PAPER_COLOR;
      glowEnabled.value = false;
      glowColor.value = HANDWRITING_DEFAULT_GLOW_COLOR;
      glowDensity.value = HANDWRITING_DEFAULT_GLOW_DENSITY;
      glowWidth.value = HANDWRITING_DEFAULT_GLOW_WIDTH;
      return;
    }
    try {
      const normalized = normalizeHandwritingPayload(next.payload, HANDWRITING_DRAFT_LIMITS);
      const last = normalized.characters.at(-1);
      characters.value = normalized.characters.slice(0, -1).map(cloneCharacter);
      current.value = last ? cloneCharacter(last) : { strokes: [] };
      selectedColor.value = current.value.strokes.at(-1)?.color || HANDWRITING_DEFAULT_COLOR;
      paperEnabled.value = !!normalized.paper;
      paperColor.value = normalized.paper?.color || HANDWRITING_DEFAULT_PAPER_COLOR;
      glowEnabled.value = !!normalized.glow;
      glowColor.value = normalized.glow?.color || HANDWRITING_DEFAULT_GLOW_COLOR;
      glowDensity.value = normalized.glow?.density ?? HANDWRITING_DEFAULT_GLOW_DENSITY;
      glowWidth.value = normalized.glow?.width ?? HANDWRITING_DEFAULT_GLOW_WIDTH;
    } catch {
      characters.value = [];
      current.value = { strokes: [] };
      selectedColor.value = HANDWRITING_PRESET_COLORS[0];
      paperEnabled.value = false;
      paperColor.value = HANDWRITING_DEFAULT_PAPER_COLOR;
      glowEnabled.value = false;
      glowColor.value = HANDWRITING_DEFAULT_GLOW_COLOR;
      glowDensity.value = HANDWRITING_DEFAULT_GLOW_DENSITY;
      glowWidth.value = HANDWRITING_DEFAULT_GLOW_WIDTH;
      errorMessage.value = "原手写草稿已损坏，已保留为新草稿";
    }
  }

  if (initial?.payload) load(initial);

  return {
    scopeKey,
    characters,
    current,
    revision,
    errorMessage,
    activePointerId,
    selectedColor,
    paperEnabled,
    paperColor,
    glowEnabled,
    glowColor,
    glowDensity,
    glowWidth,
    palette: HANDWRITING_STROKE_COLORS,
    completedPointCount,
    currentPointCount,
    totalPointCount,
    strokeCount,
    hasContent,
    snapshotCharacters,
    selectColor,
    setPaper,
    setGlow,
    beginStroke,
    appendPoint,
    endStroke,
    cancelStroke,
    undoStroke,
    clearCurrent,
    finishCharacter,
    deleteCharacter,
    clearAll,
    snapshot,
    draftSnapshot,
    load
  };
}
