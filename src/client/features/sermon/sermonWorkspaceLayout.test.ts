import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workspace = readFileSync(new URL("./SermonWorkspace.vue", import.meta.url), "utf8");
const hub = readFileSync(new URL("./SermonHub.vue", import.meta.url), "utf8");
const entryDialog = readFileSync(new URL("./SermonEntryDialog.vue", import.meta.url), "utf8");
const overlay = readFileSync(new URL("./SermonOverlay.vue", import.meta.url), "utf8");
const stage = readFileSync(new URL("./SermonStage.vue", import.meta.url), "utf8");
const contextPanel = readFileSync(new URL("./SermonContextPanel.vue", import.meta.url), "utf8");
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
  assert.match(css, /\.sermon-overlay \{[\s\S]*?padding-inline: 0/);
});

test("unknown presenter status is not mislabeled as an application requirement", () => {
  assert.match(workspace, /presenterStatus === null">正在确认账号权限…/);
  assert.match(workspace, /presenterStatus\.isAdmin">管理员可直接发起，全站成员均可观看/);
  assert.match(workspace, /<strong>全体演示<\/strong>/);
});

test("initial workspace data load runs after its reactive state is declared", () => {
  const stateDeclaration = workspace.indexOf('const accountsError = ref("")');
  const openWatcher = workspace.indexOf("// 关闭工作区后回到队列屏");
  assert.ok(stateDeclaration >= 0 && openWatcher > stateDeclaration);
  assert.match(workspace.slice(openWatcher), /\{ immediate: true \}/);
});

test("sermon entry separates own workspace from permitted read-only viewing", () => {
  assert.match(entryDialog, /选择要进入的讲道台/);
  assert.match(entryDialog, /进入自己的讲道台/);
  assert.match(entryDialog, /已获准观看的讲道台/);
  assert.match(entryDialog, /只能观看/);
  assert.match(entryDialog, /permittedPresentations\.value\.length === 0/);
});

test("live sermon notification uses a stage preview and no longer renders a top icon", () => {
  assert.doesNotMatch(hub, /sermon-hub-trigger/);
  assert.match(hub, /defineAsyncComponent\(\(\) => import\("\.\/SermonStage\.vue"\)\)/);
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
  assert.doesNotMatch(workspace, /:disabled="!queue\.length \|\| planBusyId !== null"/);
  assert.match(workspace, /当前队列已保存为/);
  assert.match(workspace, /另存当前队列/);
});

test("workspace explains split scriptures, exposes invite scope and previews the next slide", () => {
  assert.match(workspace, /自动把内容中的经文分割到队列，每处经文作为一页幻灯片展示。/);
  assert.match(workspace, /当前：\{\{ currentScopeLabel \}\}/);
  assert.match(workspace, /"全员集会" : "小组演示"/);
  assert.match(workspace, />全选（\{\{ inviteCandidates\.length \}\} 人）</);
  assert.match(workspace, /<h3>下一页<\/h3>/);
  assert.match(workspace, /<SermonPlainPreview v-if="nextItem" :item="nextItem"/);
  assert.doesNotMatch(workspace, /<SermonStage :item="nextItem"/);
  assert.match(workspace, /startScope === 'group' && presenterStatus\?\.canPresent/);
  assert.match(workspace, /startScope\.value === "group" \? selectedInviteIds\.value : \[\]/);
  assert.match(workspace, />退出并重新选择模式<\/button>/);
});

test("queue selection rehearses locally and explicit controls start or stop audience presentation", () => {
  assert.match(workspace, /function selectPreview\(item: SermonQueueItem\)/);
  assert.match(workspace, /function startSelectedPresentation\(\)/);
  assert.match(workspace, /function stopPresentation\(\)/);
  assert.match(workspace, />开始演示<\/button>/);
  assert.match(workspace, />结束演示<\/button>/);
  assert.match(workspace, /@click="selectPreview\(item\)"/);
  assert.doesNotMatch(workspace, /@click="enterPresent\(item\)"/);
});

test("every queue slide exposes its applicable layout options", () => {
  assert.match(workspace, />段落显示<\/span>/);
  assert.match(workspace, />居中显示<\/span>/);
  assert.match(workspace, /sermon\.setLayout\(item\.id, patch\)/);
});

test("stage hides text badges and puts centered scripture references after the body", () => {
  assert.match(stage, /props\.item\.kind !== "text"/);
  assert.match(stage, /referenceAfterBody/);
  assert.match(stage, /sermon-centered-reference/);
  assert.match(stage, /sermon-layout-paragraph/);
  assert.match(stage, /sermon-layout-centered/);
});

test("presenter preview and audience long press expose local scripture context", () => {
  assert.match(workspace, /sermon-context-preview[\s\S]*?<SermonContextPanel :verses="previewItem\?\.verses \|\| \[\]" compact/);
  assert.match(stage, /setTimeout\(\(\) => \{[\s\S]*?emit\("verse-hold", verse\)[\s\S]*?\}, 520\)/);
  assert.match(overlay, /@click\.self="contextVerses = \[\]"[\s\S]*?enable-verse-hold[\s\S]*?@verse-hold="showContext"/);
  assert.match(contextPanel, /\/api\/bible\/catalog/);
  assert.match(contextPanel, /\/api\/bible\/chapter\?book=/);
  assert.match(contextPanel, /@scroll\.passive="handleContextScroll"/);
  assert.match(contextPanel, /<strong>上下文<\/strong>/);
  assert.match(contextPanel, /class="sermon-context-reset"/);
  assert.match(contextPanel, />复位<\/button>/);
  assert.match(contextPanel, /sermon-context-current/);
  assert.match(contextPanel, /class="sermon-context-paragraph"/);
  assert.match(contextPanel, /v-for="chapter in loadedChapters"/);
  assert.doesNotMatch(contextPanel, /\/api\/bible\/lookup\?reference=/);
  assert.match(css, /\.sermon-context-panel \{[\s\S]*?font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif/);
  assert.match(css, /\.sermon-context-paragraph \{[\s\S]*?font-size: 15px;[\s\S]*?line-height: 1\.65/);
  assert.match(css, /\.sermon-context-current \{[\s\S]*?border-bottom-color: #22c55e[\s\S]*?background: rgba\(250, 204, 21, 0\.78\)/);
});

test("mobile presentation controls remain scrollable without covering the scripture stage", () => {
  assert.match(css, /\.sermon-present-controls \{[\s\S]*?max-height: min\(48dvh, 460px\)/);
  assert.match(css, /\.sermon-present-controls \{[\s\S]*?overflow-y: auto/);
  assert.match(css, /\.sermon-present-view \{[\s\S]*?grid-template-rows: minmax\(0, 1fr\) auto/);
});
