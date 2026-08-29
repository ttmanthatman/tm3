import assert from "node:assert/strict";
import test from "node:test";
import { clampSermonFloatingPoint, sermonFloatingMoved } from "./sermonFloating.js";

test("悬浮讲道按钮始终夹在当前视口内", () => {
  assert.deepEqual(
    clampSermonFloatingPoint({ x: 999, y: -20 }, { width: 120, height: 48 }, { width: 390, height: 844 }, 8),
    { x: 262, y: 8 }
  );
  assert.deepEqual(
    clampSermonFloatingPoint({ x: 40, y: 700 }, { width: 120, height: 48 }, { width: 390, height: 844 }, 8),
    { x: 40, y: 700 }
  );
});

test("轻点与拖动按六像素阈值区分", () => {
  assert.equal(sermonFloatingMoved({ x: 10, y: 10 }, { x: 14, y: 13 }), false);
  assert.equal(sermonFloatingMoved({ x: 10, y: 10 }, { x: 16, y: 10 }), true);
});
