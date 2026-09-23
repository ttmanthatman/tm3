import assert from "node:assert/strict";
import test from "node:test";
import {
  HANDWRITING_DEFAULT_COLOR,
  HANDWRITING_DEFAULT_PREFERENCES,
  HANDWRITING_DRAFT_LIMITS,
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

test("normalizes account palette order, custom color, selection and paper preference", () => {
  const preferences = normalizeHandwritingPreferences({
    strokeColors: ["#112233", "#FFEEDD"],
    customColor: "#ABCDEF",
    selectedIndex: 7,
    paperEnabled: true,
    paperColor: "#123456"
  });
  assert.deepEqual(preferences.strokeColors, ["#112233", "#ffeedd", ...HANDWRITING_PRESET_COLORS.slice(2)]);
  assert.equal(preferences.customColor, "#abcdef");
  assert.equal(preferences.selectedIndex, 7);
  assert.deepEqual({ paperEnabled: preferences.paperEnabled, paperColor: preferences.paperColor }, {
    paperEnabled: true,
    paperColor: "#123456"
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
