import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workspace = readFileSync(new URL("./SermonWorkspace.vue", import.meta.url), "utf8");
const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");

test("late-mounted preview refs reconnect to ResizeObserver", () => {
  assert.match(workspace, /watch\(\[projectorFrame, phoneFrame\], reconnectPreviewObserver, \{ flush: "post" \}\)/);
  assert.match(workspace, /sermonPreviewScale\(projector\.clientWidth, projector\.clientHeight/);
});

test("desktop previews share a row and wrap only in a narrow preview container", () => {
  assert.match(workspace, /class="sermon-preview-grid"[\s\S]*?projector-preview[\s\S]*?phone-preview/);
  assert.match(css, /\.sermon-preview-grid \{[\s\S]*?grid-template-columns: minmax\(0, 3\.846fr\) minmax\(140px, 1fr\)/);
  assert.match(css, /@container sermon-previews \(max-width: 680px\) \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
});

test("one shared card inset moves both reference and body", () => {
  assert.match(css, /\.sermon-overlay-card \{[\s\S]*?padding-inline: calc\(var\(--sermon-margin-pct, 4\) \* 1%\)/);
  assert.doesNotMatch(css, /\.sermon-overlay-head \{[^}]*padding-inline/);
  assert.doesNotMatch(css, /\.sermon-overlay-body \{[^}]*padding-inline/);
});

test("unknown presenter status is not mislabeled as an application requirement", () => {
  assert.match(workspace, /presenterStatus === null">正在确认账号权限…/);
  assert.match(workspace, /presenterStatus\.isAdmin">管理员可直接发起，全站成员均可观看/);
  assert.match(workspace, /<strong>全体演示<\/strong>/);
});
