import assert from "node:assert/strict";
import test from "node:test";
import { HANDWRITING_PRESET_COLORS, HANDWRITING_STROKE_COLORS, HANDWRITING_DEFAULT_GLOW_COLOR } from "@shared/handwriting";
import { shouldSampleHandwritingPoint, useHandwritingComposer } from "./useHandwritingComposer.js";

test("explicit character completion preserves the final in-progress character in snapshots", () => {
  const composer = useHandwritingComposer({ key: "1:2:3" });
  assert.equal(composer.beginStroke({ x: 100, y: 100, timestampMs: 10 }, 7), true);
  assert.equal(composer.endStroke(7, { x: 200, y: 200, timestampMs: 30 }), true);
  assert.equal(composer.finishCharacter(), true);
  assert.equal(composer.beginStroke({ x: 300, y: 300, timestampMs: 80 }, 7), true);
  assert.equal(composer.endStroke(7), true);
  const snapshot = composer.snapshot();
  assert.equal(snapshot?.characters.length, 2);
  assert.deepEqual(snapshot?.characters[0].strokes[0].points.map((point) => point[2]), [0, 20]);
  assert.deepEqual(snapshot?.characters[1].strokes[0].points.map((point) => point[2]), [0]);
});

test("only one pointer is active and cancel keeps already collected ink ready for more strokes", () => {
  const composer = useHandwritingComposer();
  assert.equal(composer.beginStroke({ x: 1, y: 2, timestampMs: 0 }, 1), true);
  assert.equal(composer.beginStroke({ x: 3, y: 4, timestampMs: 1 }, 2), false);
  assert.equal(composer.appendPoint(1, { x: 3, y: 4, timestampMs: 20 }, true), true);
  assert.equal(composer.cancelStroke(1), true);
  assert.equal(composer.current.value.strokes[0].points.length, 2);
  assert.equal(composer.beginStroke({ x: 5, y: 6, timestampMs: 40 }, 1), true);
  assert.equal(composer.endStroke(1), true);
  assert.equal(composer.current.value.strokes.length, 2);
});

test("undo, delete and clear operate on the intended scope and increment revision", () => {
  const composer = useHandwritingComposer();
  const firstRevision = composer.revision.value;
  composer.beginStroke({ x: 1, y: 1, timestampMs: 0 }, 1);
  composer.endStroke(1);
  composer.finishCharacter();
  composer.beginStroke({ x: 2, y: 2, timestampMs: 10 }, 1);
  composer.endStroke(1);
  assert.ok(composer.revision.value > firstRevision);
  assert.equal(composer.undoStroke(), true);
  assert.equal(composer.current.value.strokes.length, 0);
  assert.equal(composer.characters.value.length, 1);
  assert.equal(composer.deleteCharacter(0), true);
  assert.equal(composer.hasContent.value, false);
  assert.equal(composer.clearCurrent(), false);
});

test("sampling keeps first, corner, spaced and final points without filling dense input", () => {
  assert.equal(shouldSampleHandwritingPoint(undefined, undefined, [0, 0, 0]), true);
  assert.equal(shouldSampleHandwritingPoint([0, 0, 0], undefined, [2, 0, 1]), false);
  assert.equal(shouldSampleHandwritingPoint([0, 0, 0], undefined, [70, 0, 1]), true);
  assert.equal(shouldSampleHandwritingPoint([0, 0, 0], [-20, 0, 0], [0, 20, 1]), true);
});

test("the selected palette color is frozen onto each new stroke", () => {
  const composer = useHandwritingComposer();
  assert.equal(composer.selectedColor.value, HANDWRITING_PRESET_COLORS[0]);
  assert.equal(composer.selectColor(HANDWRITING_STROKE_COLORS[1]), true);
  composer.beginStroke({ x: 1, y: 1, timestampMs: 0 }, 1);
  composer.endStroke(1);
  composer.selectColor(HANDWRITING_STROKE_COLORS[4]);
  composer.beginStroke({ x: 2, y: 2, timestampMs: 10 }, 1);
  composer.endStroke(1);
  assert.deepEqual(composer.current.value.strokes.map((stroke) => stroke.color), [
    HANDWRITING_STROKE_COLORS[1],
    HANDWRITING_STROKE_COLORS[4]
  ]);
});

test("custom stroke colors and paper metadata are included in draft and send snapshots", () => {
  const composer = useHandwritingComposer();
  assert.equal(composer.selectColor("#123456"), true);
  assert.equal(composer.setPaper(true, "#ABCDEF"), true);
  composer.beginStroke({ x: 1, y: 1, timestampMs: 0 }, 1);
  composer.endStroke(1);
  assert.deepEqual(composer.snapshot(), {
    kind: "handwriting",
    version: 1,
    characters: [{ strokes: [{ points: [[1, 1, 0]], color: "#123456" }] }],
    paper: { color: "#abcdef" }
  });
});

test("glow settings are persisted with a message and default to white when omitted", () => {
  const composer = useHandwritingComposer();
  assert.equal(composer.setGlow(true, "#AABBCC", 72, 48), true);
  composer.beginStroke({ x: 1, y: 1, timestampMs: 0 }, 1);
  composer.endStroke(1);
  assert.deepEqual(composer.snapshot()?.glow, {
    color: "#aabbcc",
    density: 72,
    width: 48
  });

  const defaults = useHandwritingComposer();
  assert.equal(defaults.setGlow(true), true);
  defaults.beginStroke({ x: 1, y: 1, timestampMs: 0 }, 1);
  defaults.endStroke(1);
  assert.deepEqual(defaults.snapshot()?.glow, {
    color: HANDWRITING_DEFAULT_GLOW_COLOR,
    density: 65,
    width: 60
  });
});

test("the glitter pen freezes its effect onto each new stroke", () => {
  const composer = useHandwritingComposer();
  assert.equal(composer.setEffect(true), true);
  composer.beginStroke({ x: 1, y: 1, timestampMs: 0 }, 1);
  composer.endStroke(1);
  assert.equal(composer.setEffect(false), true);
  composer.beginStroke({ x: 2, y: 2, timestampMs: 10 }, 1);
  composer.endStroke(1);
  assert.deepEqual(composer.current.value.strokes.map((stroke) => stroke.effect), [
    "metallic-pink-glitter",
    undefined
  ]);
});
