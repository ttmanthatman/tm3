import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readClientStyles } from "../../stylesManifest.js";

test("handwriting messages expose only the drawing and retain transparent presentation", () => {
  const component = readFileSync(new URL("./HandwritingMessage.vue", import.meta.url), "utf8");
  const app = readFileSync(new URL("../../App.vue", import.meta.url), "utf8");
  const styles = readClientStyles();

  assert.doesNotMatch(component, /手写消息 ·|重播|handwriting-message-head|handwriting-message-replay/);
  assert.match(component, /@click\.stop="payload && replayHandwriting\(\)"/);
  assert.match(component, /@keydown="handleReplayKey"/);
  assert.match(app, /'handwriting-bubble': row\.message\.type === 'handwriting'/);
  assert.match(styles, /\.message-row \.bubble\.handwriting-bubble[\s\S]*?background: transparent;/);
  assert.doesNotMatch(component, /\.handwriting-message-grid\s*\{[^}]*\b(?:background: #fff|border:)/);
});
