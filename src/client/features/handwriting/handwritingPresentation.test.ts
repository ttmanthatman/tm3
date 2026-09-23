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
  assert.match(component, /payload\.value\?\.paper\s*\?/);
  assert.match(component, /backgroundColor: payload\.value\.paper\.color/);
});

test("the composer uses one editable preview, a per-stroke palette and coalesced draft persistence", () => {
  const component = readFileSync(new URL("./HandwritingComposer.vue", import.meta.url), "utf8");
  const palette = readFileSync(new URL("./HandwritingPalette.vue", import.meta.url), "utf8");
  const message = readFileSync(new URL("./HandwritingMessage.vue", import.meta.url), "utf8");
  assert.doesNotMatch(component, /<section class="handwriting-completed"/);
  assert.doesNotMatch(component, /清空当前字|当前字格[\s\S]*?写完后手动完成/);
  assert.match(palette, /aria-label="笔画颜色"/);
  assert.match(palette, /aria-label="自定义颜色"/);
  assert.match(palette, /小秘密：长按调出调色盘/);
  assert.match(palette, /显示纸张/);
  assert.match(palette, /aria-label="光晕"/);
  assert.match(palette, /aria-label="光晕颜色"/);
  assert.match(palette, /aria-label="光晕密度"/);
  assert.match(palette, /aria-label="光晕宽度"/);
  assert.match(palette, /setTimeout\(\(\) => \{\s*longPressTriggered = true;\s*openPicker\(index\);\s*\}, 450\)/);
  assert.match(palette, /role="dialog" aria-label="调色盘"/);
  assert.match(palette, /aria-label="调色盘颜色"[\s\S]*?type="color"|type="color"[\s\S]*?aria-label="调色盘颜色"/);
  assert.doesNotMatch(palette, /showPicker|handwriting-color-input/);
  assert.match(component, /@select="selectPaletteColor"/);
  assert.match(component, /@glow-change="changeGlow"/);
  assert.match(message, /payload\.value\?\.glow/);
  assert.match(component, /draftScheduler\.request\(\)/);
  assert.match(component, /点已完成的字可删除/);
  assert.doesNotMatch(component, /composer\.snapshotCharacters\.value/);
  assert.match(message, /stroke\.color/);
});
