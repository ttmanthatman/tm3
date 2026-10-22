<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import AppModal from "../../components/ui/AppModal.vue";
import { useChatStore } from "../../store";
import { DOODLE_MAX_MARKS, DOODLE_MAX_POINTS, doodlePoint, drawDoodleSegment, parseDoodleDraft, renderDoodle, type DoodleDraft, type DoodleMark, type DoodleStroke } from "./doodleBoard";

const emit = defineEmits<{ close: [] }>();
const accountId = useChatStore().account?.id;
const storageKey = `tm3:doodle:v1:${accountId ?? "guest"}`;
const canvas = ref<HTMLCanvasElement | null>(null);
const stage = ref<HTMLElement | null>(null);
const draft = shallowRef<DoodleDraft>({ version: 1, width: window.innerWidth < 600 ? 900 : 1200, height: window.innerWidth < 600 ? 1200 : 900, marks: [] });
const redoMarks: DoodleMark[] = [];
const redoCount = ref(0);
const color = ref("#40344e");
const penWidth = ref(5);
const tool = ref<"pen" | "eraser" | "text">("pen");
const text = ref("");
const textInput = ref<HTMLInputElement | null>(null);
const clearOpen = ref(false);
const exportBusy = ref(false);
const status = ref("草稿自动保存在当前浏览器");
const error = ref("");
const displaySize = ref({ width: 1, height: 1 });
const palette = ["#40344e", "#e44b61", "#e69a24", "#329868", "#3181d1", "#9255c5"];
let active: DoodleStroke | null = null;
let pointerId: number | null = null;
let observer: ResizeObserver | null = null;
const pointCount = computed(() => draft.value.marks.reduce((sum, mark) => sum + (mark.kind === "stroke" ? mark.points.length : 0), 0));
const hasContent = computed(() => draft.value.marks.length > 0 && draft.value.marks.at(-1)?.kind !== "clear");

function redraw() {
  const ctx = canvas.value?.getContext("2d");
  if (ctx) renderDoodle(ctx, draft.value);
}
function persist() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(draft.value));
    status.value = "草稿已保存在当前浏览器";
    error.value = "";
  } catch {
    error.value = "草稿保存失败，请先保存图片，避免关闭后丢失。";
  }
}
function commit(mark: DoodleMark) {
  draft.value = { ...draft.value, marks: [...draft.value.marks, mark] };
  redoMarks.length = 0;
  redoCount.value = 0;
  clearOpen.value = false;
  persist();
}
function hasRoom() {
  if (draft.value.marks.length < DOODLE_MAX_MARKS && pointCount.value < DOODLE_MAX_POINTS) return true;
  error.value = "画板内容较多，请保存图片后清空，再继续创作。";
  return false;
}
function start(event: PointerEvent) {
  if (pointerId !== null || exportBusy.value || (event.pointerType === "mouse" && event.button !== 0) || !canvas.value || !hasRoom()) return;
  const point = doodlePoint(event.clientX, event.clientY, canvas.value.getBoundingClientRect(), draft.value.width, draft.value.height);
  if (tool.value === "text") {
    if (!text.value.trim()) { textInput.value?.focus(); return; }
    commit({ kind: "text", color: color.value, size: Math.max(48, penWidth.value * 4), text: text.value.trim(), ...point });
    redraw();
    return;
  }
  pointerId = event.pointerId;
  canvas.value.setPointerCapture(event.pointerId);
  active = { kind: "stroke", color: color.value, width: tool.value === "eraser" ? penWidth.value * 4 : penWidth.value, erase: tool.value === "eraser", points: [point] };
  const ctx = canvas.value.getContext("2d");
  if (ctx) drawDoodleSegment(ctx, active, point, point);
}
function move(event: PointerEvent) {
  if (event.pointerId !== pointerId || !active || !canvas.value) return;
  const ctx = canvas.value.getContext("2d");
  if (!ctx) return;
  const rect = canvas.value.getBoundingClientRect();
  const samples = event.getCoalescedEvents?.();
  for (const sample of samples?.length ? samples : [event]) {
    if (active.points.length + pointCount.value >= DOODLE_MAX_POINTS) { finish(); error.value = "画板内容较多，请保存图片后清空，再继续创作。"; return; }
    const point = doodlePoint(sample.clientX, sample.clientY, rect, draft.value.width, draft.value.height);
    const previous = active.points.at(-1)!;
    if (Math.hypot(point.x - previous.x, point.y - previous.y) < 0.5) continue;
    active.points.push(point);
    drawDoodleSegment(ctx, active, previous, point);
  }
}
function finish(event?: PointerEvent) {
  if (event && event.pointerId !== pointerId) return;
  if (active) { commit(active); active = null; }
  const previousId = pointerId;
  pointerId = null;
  if (previousId !== null && canvas.value?.hasPointerCapture(previousId)) canvas.value.releasePointerCapture(previousId);
}
function undo() {
  finish();
  const mark = draft.value.marks.at(-1);
  if (!mark) return;
  redoMarks.push(mark);
  redoCount.value = redoMarks.length;
  draft.value = { ...draft.value, marks: draft.value.marks.slice(0, -1) };
  persist(); redraw();
}
function redo() {
  const mark = redoMarks.pop();
  if (!mark) return;
  draft.value = { ...draft.value, marks: [...draft.value.marks, mark] };
  redoCount.value = redoMarks.length;
  persist(); redraw();
}
function clear() {
  // Keep clear undoable without retaining an unbounded history.
  if (draft.value.marks.length >= DOODLE_MAX_MARKS || pointCount.value >= DOODLE_MAX_POINTS) {
    draft.value = { ...draft.value, marks: [] };
    redoMarks.length = 0; redoCount.value = 0; clearOpen.value = false; persist();
  } else commit({ kind: "clear" });
  redraw();
}
function addText() {
  if (!text.value.trim() || !hasRoom()) return;
  commit({ kind: "text", color: color.value, size: Math.max(48, penWidth.value * 4), text: text.value.trim(), x: 40, y: draft.value.height / 2 });
  redraw();
}
function resize() {
  if (!stage.value) return;
  const scale = Math.min(stage.value.clientWidth / draft.value.width, stage.value.clientHeight / draft.value.height);
  displaySize.value = { width: draft.value.width * scale, height: draft.value.height * scale };
}
async function exportImage(share: boolean) {
  finish();
  if (exportBusy.value) return;
  exportBusy.value = true;
  error.value = "";
  try {
    const output = document.createElement("canvas");
    output.width = draft.value.width; output.height = draft.value.height;
    const ctx = output.getContext("2d");
    if (!ctx || !canvas.value) throw new Error("无法生成图片，请重试");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, output.width, output.height);
    ctx.drawImage(canvas.value, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => output.toBlob((value) => value ? resolve(value) : reject(new Error("无法生成图片，请重试")), "image/png"));
    const file = new File([blob], `随手画-${Date.now()}.png`, { type: "image/png" });
    if (share && navigator.canShare?.({ files: [file] }) && navigator.share) {
      await navigator.share({ files: [file], title: "我的随手画" });
      status.value = "图片已分享";
    } else {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = file.name;
      document.body.append(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.value = share ? "当前浏览器不支持直接分享，已下载图片，可将图片发送给朋友。" : "图片已下载";
    }
  } catch (cause) {
    if (cause instanceof Error && cause.name === "AbortError") status.value = "已取消分享，草稿仍保留";
    else error.value = cause instanceof Error ? cause.message : "保存或分享失败，请重试";
  } finally { exportBusy.value = false; }
}
function pause() { finish(); }
function close() { finish(); emit("close"); }
onMounted(() => {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) { draft.value = parseDoodleDraft(raw); status.value = "已恢复当前浏览器的草稿"; }
  } catch { error.value = "无法恢复草稿；原草稿会在下次绘画后被替换，请先检查浏览器存储权限。"; }
  // Canvas dimensions are assigned before drawing to avoid a later render clearing the restored draft.
  if (canvas.value) { canvas.value.width = draft.value.width; canvas.value.height = draft.value.height; }
  redraw();
  observer = new ResizeObserver(resize); if (stage.value) observer.observe(stage.value);
  resize();
  document.addEventListener("visibilitychange", pause);
  window.addEventListener("pagehide", pause);
});
onBeforeUnmount(() => {
  finish(); observer?.disconnect();
  document.removeEventListener("visibilitychange", pause);
  window.removeEventListener("pagehide", pause);
});
</script>

<template>
  <Teleport to="body">
    <AppModal :open="true" title="使用说明" size="medium" content-class="chat-usage-help" @close="close">
      <div class="chat-usage-help-content" data-no-bible-swipe>
        <p class="doodle-intro">还没写呢，你随便涂涂画画吧……</p>
        <div class="doodle-toolbar" role="toolbar" aria-label="画板工具">
          <button v-for="item in ([['pen', '画笔'], ['eraser', '橡皮擦'], ['text', '文字']] as const)" :key="item[0]" type="button" :aria-pressed="tool === item[0]" @click="tool = item[0]">{{ item[1] }}</button>
          <span class="doodle-colors" role="group" aria-label="笔迹颜色">
            <button v-for="swatch in palette" :key="swatch" class="doodle-swatch" :style="{ background: swatch }" type="button" :aria-label="`颜色 ${swatch}`" :aria-pressed="color === swatch" @click="color = swatch; tool = tool === 'eraser' ? 'pen' : tool" />
            <input v-model="color" type="color" aria-label="自定义颜色" />
          </span>
          <label class="doodle-width">粗细 <input v-model.number="penWidth" type="range" min="1" max="20" aria-label="笔迹粗细" /></label>
          <button type="button" :disabled="!draft.marks.length" @click="undo">撤销</button>
          <button type="button" :disabled="!redoCount" @click="redo">重做</button>
          <button type="button" :disabled="!hasContent" @click="clearOpen = !clearOpen">清空</button>
        </div>
        <form v-if="tool === 'text'" class="doodle-text" @submit.prevent="addText">
          <input ref="textInput" v-model="text" maxlength="120" aria-label="画板文字" placeholder="输入文字，点画板放置" />
          <button type="submit" :disabled="!text.trim()">添加文字</button>
        </form>
        <div v-if="clearOpen" class="doodle-clear" role="group" aria-label="确认清空画板">
          <span>清空当前画板？{{ draft.marks.length >= DOODLE_MAX_MARKS || pointCount >= DOODLE_MAX_POINTS ? '内容已达上限，清空后无法撤销。' : '清空后可撤销。' }}</span>
          <button type="button" @click="clear">确认清空</button><button type="button" @click="clearOpen = false">取消</button>
        </div>
        <div ref="stage" class="doodle-stage">
          <canvas ref="canvas" class="doodle-canvas" :class="{ 'doodle-text-cursor': tool === 'text' }" :style="{ width: `${displaySize.width}px`, height: `${displaySize.height}px` }" aria-label="自由画板，可用手指、鼠标或触控笔画画写字，也可用文字工具添加文字" @pointerdown.prevent="start" @pointermove.prevent="move" @pointerup="finish" @pointercancel="finish" @lostpointercapture="finish" @contextmenu.prevent />
          <span v-if="!hasContent" class="doodle-hint" aria-hidden="true">在这里，随手画点什么吧</span>
        </div>
        <footer class="doodle-footer">
          <p :role="error ? 'alert' : 'status'">{{ error || status }}</p>
          <div><button type="button" :disabled="exportBusy || !hasContent" @click="exportImage(false)">保存图片</button><button class="doodle-share" type="button" :disabled="exportBusy || !hasContent" @click="exportImage(true)">{{ exportBusy ? '处理中…' : '分享' }}</button></div>
        </footer>
      </div>
    </AppModal>
  </Teleport>
</template>

<style scoped>
:deep(.chat-usage-help) {
  width: min(1100px, 100%);
  height: min(900px, calc(var(--app-height, 100dvh) - var(--safe-top, 0px) - var(--safe-bottom, 0px) - 24px));
  max-height: calc(var(--app-height, 100dvh) - var(--safe-top, 0px) - var(--safe-bottom, 0px) - 24px);
  color: #40344e;
  background: linear-gradient(145deg, #fff1d7, #f5dce8 48%, #d6e4f5);
  grid-template-rows: auto minmax(0, 1fr);
}
:deep(.chat-usage-help .modal-head) { color: #40344e; background: #fff8ef66; border-bottom-color: #7c577b24; }
.chat-usage-help-content { min-height: 0; overflow: auto; overscroll-behavior: contain; display: flex; flex-direction: column; gap: 10px; padding: 12px; }
.doodle-intro { margin: 0; font-size: 14px; }
.doodle-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.chat-usage-help-content button { min-height: 34px; border: 1px solid #71607840; border-radius: 7px; padding: 5px 10px; color: #40344e; background: #ffffffb3; cursor: pointer; }
.chat-usage-help-content button[aria-pressed="true"] { outline: 2px solid #675179; outline-offset: 1px; }
.chat-usage-help-content button:disabled { opacity: .45; cursor: default; }
.chat-usage-help-content :is(button, input):focus-visible { outline: 2px solid #543b83; outline-offset: 2px; }
.doodle-colors { display: flex; align-items: center; gap: 7px; padding: 3px; }
.chat-usage-help-content .doodle-swatch { width: 25px; height: 25px; min-height: 25px; border-radius: 50%; padding: 0; border: 2px solid #fff; }
.doodle-colors input { width: 30px; height: 30px; padding: 0; border: 0; background: transparent; }
.doodle-width { display: flex; align-items: center; gap: 4px; font-size: 13px; white-space: nowrap; }
.doodle-width input { width: 75px; accent-color: #675179; }
.doodle-text, .doodle-clear { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.doodle-text input { min-width: 0; flex: 1; border: 1px solid #71607840; border-radius: 6px; padding: 7px; font-size: 16px; }
.doodle-clear { font-size: 13px; }
.doodle-stage { position: relative; flex: 1 0 180px; min-height: 180px; display: flex; align-items: center; justify-content: center; overflow: hidden; border-radius: 8px; background: #ffffff55; }
.doodle-canvas { display: block; flex-shrink: 0; background: white; box-shadow: 0 2px 12px #40344e14; touch-action: none; cursor: crosshair; }
.doodle-text-cursor { cursor: text; }
.doodle-hint { position: absolute; pointer-events: none; color: #a59ba9; font-size: 14px; }
.doodle-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.doodle-footer p { min-width: 0; margin: 0; font-size: 12px; overflow-wrap: anywhere; }
.doodle-footer p[role="alert"] { color: #a12643; }
.doodle-footer > div { display: flex; flex-shrink: 0; gap: 6px; }
.chat-usage-help-content .doodle-share { color: white; background: #675179; }
@media (max-width: 480px) { .chat-usage-help-content { padding: 10px; gap: 8px; } .doodle-footer { flex-wrap: wrap; } .doodle-footer > div { margin-left: auto; } }
</style>
