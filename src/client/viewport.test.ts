import assert from "node:assert/strict";
import test from "node:test";
import { getAppViewportHeight } from "./viewport";

const pwa = { layoutHeight: 844, visualHeight: 797, standalone: true, editing: false };

test("standalone status-bar discrepancy does not shorten the app, including with a hardware keyboard", () => {
  assert.equal(getAppViewportHeight(pwa), 844);
  assert.equal(getAppViewportHeight({ ...pwa, editing: true }), 844);
});

test("standalone keyboard uses visible bottom, including viewport pan and short landscape viewports", () => {
  assert.equal(getAppViewportHeight({ ...pwa, editing: true, visualHeight: 480 }), 480);
  assert.equal(getAppViewportHeight({ ...pwa, editing: true, visualHeight: 480, visualOffsetTop: 36 }), 516);
  assert.equal(getAppViewportHeight({ ...pwa, editing: true, layoutHeight: 390, visualHeight: 240 }), 240);
  assert.equal(getAppViewportHeight({ ...pwa, visualHeight: 480 }), 844);
});

test("browser tabs retain visual viewport sizing and missing visualViewport falls back to layout", () => {
  assert.equal(getAppViewportHeight({ ...pwa, standalone: false }), 797);
  assert.equal(getAppViewportHeight({ ...pwa, visualHeight: undefined }), 844);
  assert.equal(getAppViewportHeight({ ...pwa, visualHeight: 900 }), 844);
});
