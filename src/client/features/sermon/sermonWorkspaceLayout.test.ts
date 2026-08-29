import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workspace = readFileSync(new URL("./SermonWorkspace.vue", import.meta.url), "utf8");
const hub = readFileSync(new URL("./SermonHub.vue", import.meta.url), "utf8");
const entryDialog = readFileSync(new URL("./SermonEntryDialog.vue", import.meta.url), "utf8");
const overlay = readFileSync(new URL("./SermonOverlay.vue", import.meta.url), "utf8");
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

test("desktop navigation and preview scrolling follow the workspace layout", () => {
  assert.match(workspace, /sermon-workspace-topbar[\s\S]*?sermon-topbar-button[\s\S]*?sermon-workspace-title/);
  assert.match(workspace, /class="sermon-preview-frame projector"[\s\S]*?@wheel="handlePreviewWheel"/);
  assert.match(workspace, /previewBody && projectorFrame\.value\?\.clientHeight/);
  assert.match(css, /\.sermon-preview-stage \.sermon-overlay-body \{[\s\S]*?scrollbar-width: none/);
  assert.match(css, /\.sermon-preview-stage \.sermon-overlay-body::\-webkit-scrollbar \{[\s\S]*?width: 0/);
});

test("one shared card inset moves both reference and body", () => {
  assert.match(css, /\.sermon-overlay-card \{[\s\S]*?width: 100%;[\s\S]*?min-height: 0;[\s\S]*?max-height: 100%/);
  assert.doesNotMatch(css, /\.sermon-overlay-card \{[\s\S]*?width: min\(880px, 100%\)/);
  assert.match(css, /\.sermon-overlay-card \{[\s\S]*?padding-inline: calc\(var\(--sermon-margin-pct, 4\) \* 1%\)/);
  assert.doesNotMatch(css, /\.sermon-overlay-head \{[^}]*padding-inline/);
  assert.doesNotMatch(css, /\.sermon-overlay-body \{[^}]*padding-inline/);
});

test("unknown presenter status is not mislabeled as an application requirement", () => {
  assert.match(workspace, /presenterStatus === null">正在确认账号权限…/);
  assert.match(workspace, /presenterStatus\.isAdmin">管理员可直接发起，全站成员均可观看/);
  assert.match(workspace, /<strong>全体演示<\/strong>/);
});

test("sermon entry separates own workspace from permitted read-only viewing", () => {
  assert.match(entryDialog, /选择要进入的讲道台/);
  assert.match(entryDialog, /进入自己的讲道台/);
  assert.match(entryDialog, /已获准观看的讲道台/);
  assert.match(entryDialog, /只能观看/);
});

test("live sermon notification uses a stage preview and no longer renders a top icon", () => {
  assert.doesNotMatch(hub, /sermon-hub-trigger/);
  assert.match(hub, /class="sermon-overlay sermon-live-preview"/);
  assert.match(hub, /忽略并最小化/);
  assert.match(hub, /点击进入观看/);
});

test("both ignored notifications and minimized full-screen viewing use draggable floating buttons", () => {
  assert.match(hub, /<SermonFloatingButton/);
  assert.match(overlay, /<SermonFloatingButton/);
  assert.doesNotMatch(css, /\.sermon-mini-bar/);
});

test("workspace can name, save, load, overwrite and delete prepared queues", () => {
  assert.match(workspace, /placeholder="例如：8月30日分享"/);
  assert.match(workspace, /saveNewPlan/);
  assert.match(workspace, /loadSavedPlan/);
  assert.match(workspace, /overwritePlan/);
  assert.match(workspace, /deleteSavedPlan/);
});
