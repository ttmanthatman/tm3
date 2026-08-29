import assert from "node:assert/strict";
import test from "node:test";
import { nextSermonScrollLine, sermonWheelDirection } from "./sermonScroll.js";

test("nextSermonScrollLine moves one line and clamps both ends", () => {
  assert.equal(nextSermonScrollLine(2, 5, 1), 3);
  assert.equal(nextSermonScrollLine(5, 5, 1), 5);
  assert.equal(nextSermonScrollLine(0, 5, -1), 0);
  assert.equal(nextSermonScrollLine(3, 5, -1), 2);
});

test("sermonWheelDirection maps vertical wheel intent to one line", () => {
  assert.equal(sermonWheelDirection(0), 0);
  assert.equal(sermonWheelDirection(0.25), 1);
  assert.equal(sermonWheelDirection(-120), -1);
});
