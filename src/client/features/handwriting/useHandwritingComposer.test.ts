import assert from "node:assert/strict";
import test from "node:test";
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
