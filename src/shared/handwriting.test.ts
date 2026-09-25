import assert from "node:assert/strict";
import test from "node:test";
import {
  HANDWRITING_DEFAULT_COLOR,
  HANDWRITING_DEFAULT_PREFERENCES,
  HANDWRITING_DRAFT_LIMITS,
  HANDWRITING_DEFAULT_GLOW_COLOR,
  HANDWRITING_DEFAULT_GLOW_DENSITY,
  HANDWRITING_DEFAULT_GLOW_WIDTH,
  HANDWRITING_PRESET_COLORS,
  HANDWRITING_STROKE_COLORS,
  HANDWRITING_SEND_LIMITS,
  HandwritingValidationError,
  handwritingPayloadBytes,
  normalizeHandwritingPreferences,
  normalizeHandwritingPayload,
  parseStoredHandwritingPayload,
  type HandwritingPayload
} from "./handwriting.js";

function payload(points: number[][] = [[100, 200, 0]]): HandwritingPayload {
  return { kind: "handwriting", version: 1, characters: [{ strokes: [{ points: points as [number, number, number][] }] }] };
}

test("normalizes a deterministic strict handwriting payload without mutating input", () => {
  const input = payload([[1, 2, 0], [3, 4, 0], [5, 6, 10]]);
  const normalized = normalizeHandwritingPayload(input);
  assert.deepEqual(normalized, input);
  assert.notEqual(normalized, input);
  assert.equal(handwritingPayloadBytes(normalized), new TextEncoder().encode(JSON.stringify(normalized)).byteLength);
});

test("accepts single-point strokes and resets time for each character", () => {
  const input = payload();
  input.characters.push({ strokes: [{ points: [[1, 1, 0]] }] });
  assert.deepEqual(normalizeHandwritingPayload(input), input);
});

test("normalizes preset and custom per-stroke colors while keeping legacy ink payloads canonical", () => {
  const colored = payload();
  colored.characters[0].strokes[0].color = HANDWRITING_STROKE_COLORS[2];
  assert.deepEqual(normalizeHandwritingPayload(colored), colored);

  const custom = payload();
  custom.characters[0].strokes[0].color = "#AABBCC";
  assert.equal(normalizeHandwritingPayload(custom).characters[0].strokes[0].color, "#aabbcc");

  const explicitDefault = payload();
  explicitDefault.characters[0].strokes[0].color = HANDWRITING_DEFAULT_COLOR;
  assert.deepEqual(normalizeHandwritingPayload(explicitDefault), payload());

  const unsupported = payload();
  unsupported.characters[0].strokes[0].color = "#ffff" as never;
  assert.throws(() => normalizeHandwritingPayload(unsupported), /颜色/);
});

test("keeps optional paper color in sent payloads and rejects malformed paper metadata", () => {
  const paper = payload();
  paper.paper = { color: "#FFF4D6" };
  assert.deepEqual(normalizeHandwritingPayload(paper), { ...paper, paper: { color: "#fff4d6" } });
  assert.throws(() => normalizeHandwritingPayload({ ...payload(), paper: {} }), HandwritingValidationError);
  assert.throws(() => normalizeHandwritingPayload({ ...payload(), paper: { color: "white" } }), HandwritingValidationError);
});

test("keeps optional glow settings in sent payloads and defaults omitted glow values", () => {
  const glow = payload();
  glow.glow = { color: "#AABBCC", density: 72, width: 48 };
  assert.deepEqual(normalizeHandwritingPayload(glow), {
    ...glow,
    glow: { color: "#aabbcc", density: 72, width: 48 }
  });

  const partial = payload();
  partial.glow = { density: 20 } as never;
  assert.deepEqual(normalizeHandwritingPayload(partial).glow, {
    color: HANDWRITING_DEFAULT_GLOW_COLOR,
    density: 20,
    width: HANDWRITING_DEFAULT_GLOW_WIDTH
  });

  assert.throws(() => normalizeHandwritingPayload({ ...payload(), glow: { color: "white" } }), HandwritingValidationError);
  assert.throws(() => normalizeHandwritingPayload({ ...payload(), glow: { density: 101 } }), HandwritingValidationError);
});

test("drops the retired glitter effect from stored strokes without hiding legacy messages", () => {
  const legacy = payload();
  Object.assign(legacy.characters[0].strokes[0], { effect: "metallic-pink-glitter" });
  assert.deepEqual(normalizeHandwritingPayload(legacy), payload());

  const unsupported = payload();
  Object.assign(unsupported.characters[0].strokes[0], { effect: "rainbow" });
  assert.throws(() => normalizeHandwritingPayload(unsupported), HandwritingValidationError);
});

test("normalizes account palette order, custom color, selection and paper preference", () => {
  const preferences = normalizeHandwritingPreferences({
    strokeColors: ["#112233", "#FFEEDD"],
    customColor: "#ABCDEF",
    selectedIndex: 7,
    paperEnabled: true,
    paperColor: "#123456",
    glowEnabled: true,
    glowColor: "#ABCDEF",
    glowDensity: 72,
    glowWidth: 48
  });
  assert.deepEqual(preferences.strokeColors, ["#112233", "#ffeedd", ...HANDWRITING_PRESET_COLORS.slice(2)]);
  assert.equal(preferences.customColor, "#abcdef");
  assert.equal(preferences.selectedIndex, 7);
  assert.deepEqual({
    paperEnabled: preferences.paperEnabled,
    paperColor: preferences.paperColor,
    glowEnabled: preferences.glowEnabled,
    glowColor: preferences.glowColor,
    glowDensity: preferences.glowDensity,
    glowWidth: preferences.glowWidth
  }, {
    paperEnabled: true,
    paperColor: "#123456",
    glowEnabled: true,
    glowColor: "#abcdef",
    glowDensity: 72,
    glowWidth: 48
  });
  assert.deepEqual(normalizeHandwritingPreferences(null), HANDWRITING_DEFAULT_PREFERENCES);
});

test("rejects unknown fields, versions, empty arrays, non-finite values, ranges and decreasing time", () => {
  const invalid: unknown[] = [
    { ...payload(), extra: true },
    { ...payload(), version: 2 },
    { kind: "handwriting", version: 1, characters: [] },
    { kind: "handwriting", version: 1, characters: [{ strokes: [] }] },
    payload([[Number.NaN, 2, 0]]),
    payload([[10_001, 2, 0]]),
    payload([[1, 2, 1]]),
    payload([[1, 2, 1], [2, 3, 0]])
  ];
  for (const value of invalid) assert.throws(() => normalizeHandwritingPayload(value), HandwritingValidationError);
});

test("rejects every configured count at limit plus one", () => {
  const tooManyCharacters = payload();
  tooManyCharacters.characters = Array.from({ length: HANDWRITING_SEND_LIMITS.maxCharacters + 1 }, () => ({ strokes: [{ points: [[0, 0, 0]] }] }));
  assert.throws(() => normalizeHandwritingPayload(tooManyCharacters), /最多/);

  const tooManyStrokes = payload();
  tooManyStrokes.characters[0].strokes = Array.from({ length: HANDWRITING_SEND_LIMITS.maxStrokesPerCharacter + 1 }, () => ({ points: [[0, 0, 0]] }));
  assert.throws(() => normalizeHandwritingPayload(tooManyStrokes), /单字笔画/);

  const tooManyPoints = payload(Array.from({ length: HANDWRITING_SEND_LIMITS.maxPointsPerStroke + 1 }, (_, index) => [0, 0, index]));
  assert.throws(() => normalizeHandwritingPayload(tooManyPoints), /单笔采样点/);
});

test("enforces UTF-8 byte limits and exposes a larger editor-only budget", () => {
  const limited = { ...HANDWRITING_SEND_LIMITS, maxBytes: handwritingPayloadBytes(payload()) - 1 };
  assert.throws(() => normalizeHandwritingPayload(payload(), limited), /体积/);
  assert.equal(HANDWRITING_DRAFT_LIMITS.maxBytes > HANDWRITING_SEND_LIMITS.maxBytes, true);
  assert.equal(HANDWRITING_DRAFT_LIMITS.maxPoints > HANDWRITING_SEND_LIMITS.maxPoints, true);
});

test("stored unknown or corrupt payloads degrade to null", () => {
  assert.equal(parseStoredHandwritingPayload({ ...payload(), version: 9 }), null);
  assert.equal(parseStoredHandwritingPayload({ kind: "handwriting", version: 1, characters: "bad" }), null);
  assert.deepEqual(parseStoredHandwritingPayload(payload()), payload());
});

test("brush settings survive normalization and malformed settings are rejected", () => {
  const brush = { size: 45, sensitivity: 65, lag: 35 };
  const input = payload();
  input.characters[0].strokes[0].brush = brush;
  assert.deepEqual(normalizeHandwritingPayload(input), input);
  assert.deepEqual(normalizeHandwritingPreferences({ pen: "brush", brush }).brush, brush);
  for (const bad of [null, {}, { ...brush, size: 101 }, { ...brush, lag: -1 }, { ...brush, sensitivity: 1.2 }, { ...brush, texture: true }]) {
    const invalid = payload();
    Object.assign(invalid.characters[0].strokes[0], { brush: bad });
    assert.throws(() => normalizeHandwritingPayload(invalid), HandwritingValidationError);
  }
});

test("accepts tenfold stroke and message budgets and enforces the character point budget", () => {
  const expanded = payload(Array.from({ length: 10_240 }, (_, i) => [i % 10_000, 5000, i]));
  assert.equal(normalizeHandwritingPayload(expanded).characters[0].strokes[0].points.length, 10_240);
  const manyStrokes = payload();
  manyStrokes.characters[0].strokes = Array.from({ length: 640 }, () => ({ points: [[0, 0, 0]] }));
  assert.equal(normalizeHandwritingPayload(manyStrokes).characters[0].strokes.length, 640);
  const dense = payload();
  dense.characters[0].strokes = Array.from({ length: 6 }, () => ({ points: Array.from({ length: 10_000 }, () => [9999, 9999, 0] as const) }));
  assert.equal(normalizeHandwritingPayload(dense).characters[0].strokes.length, 6);
  dense.characters[0].strokes.push({ points: [[0, 0, 0]] });
  assert.throws(() => normalizeHandwritingPayload(dense, HANDWRITING_DRAFT_LIMITS), /单字采样/);
});
