<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ChevronLeft, ChevronRight, Download, Maximize, Minus, Plus, Share2 } from "lucide-vue-next";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import type { MusicScoreDTO } from "@shared/types";
import { getToken } from "../../api";
import AppModal from "../../components/ui/AppModal.vue";
import { useScorePanZoom } from "./useScorePanZoom";

const props = withDefaults(defineProps<{ score: MusicScoreDTO; actionBusy?: boolean; actionStatus?: string }>(), { actionBusy: false, actionStatus: "" });
const emit = defineEmits<{ close: []; share: []; download: [] }>();
const stage = ref<HTMLElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const fileIndex = ref(0);
const pdfPageIndex = ref(0);
const pdfPageCount = ref(0);
const mediaUrl = ref("");
const imageAttempt = ref(0);
const loading = ref(true);
const error = ref("");
const dimensions = ref({ width: 1, height: 1 });
const stageSize = ref({ width: 1, height: 1 });
const orderedPages = computed(() => [...props.score.pages].sort((left, right) => left.pageIndex - right.pageIndex));
const sourcePage = computed(() => orderedPages.value[fileIndex.value]);
const isPdf = computed(() => props.score.kind === "pdf" || !!sourcePage.value?.fileName.toLowerCase().endsWith(".pdf"));
const pageIndex = computed(() => isPdf.value ? pdfPageIndex.value : fileIndex.value);
const pageCount = computed(() => isPdf.value ? pdfPageCount.value : orderedPages.value.length);
const panZoom = useScorePanZoom();
const { transform, dragging } = panZoom;
const fitSize = computed(() => {
  const ratio = Math.min(Math.max(1, stageSize.value.width - 24) / dimensions.value.width, Math.max(1, stageSize.value.height - 24) / dimensions.value.height);
  return { width: dimensions.value.width * ratio, height: dimensions.value.height * ratio };
});
const contentStyle = computed(() => ({
  ...panZoom.contentStyle.value,
  width: `${fitSize.value.width}px`, height: `${fitSize.value.height}px`,
  marginLeft: `${-fitSize.value.width / 2}px`, marginTop: `${-fitSize.value.height / 2}px`
}));
let sourceGeneration = 0;
let renderGeneration = 0;
let loadingTask: PDFDocumentLoadingTask | null = null;
let pdfDocument: PDFDocumentProxy | null = null;
let renderTask: RenderTask | null = null;
let observer: ResizeObserver | null = null;
let resizeTimer: ReturnType<typeof setTimeout> | null = null;
let disposed = false;

function releasePdf() {
  renderGeneration += 1;
  renderTask?.cancel();
  renderTask = null;
  if (loadingTask) void loadingTask.destroy();
  loadingTask = null;
  pdfDocument = null;
}

async function renderPdfPage() {
  const doc = pdfDocument;
  if (!doc) return;
  const generation = ++renderGeneration;
  renderTask?.cancel();
  renderTask = null;
  loading.value = true;
  error.value = "";
  try {
    const page = await doc.getPage(pdfPageIndex.value + 1);
    if (generation !== renderGeneration || disposed) return;
    const base = page.getViewport({ scale: 1 });
    dimensions.value = { width: base.width, height: base.height };
    await nextTick();
    const target = canvas.value;
    if (!target || generation !== renderGeneration || disposed) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // One page at a time, with bounded high-resolution pixels for zooming on phones and laptops.
    const scale = Math.min(fitSize.value.width / base.width * dpr * 1.5, Math.sqrt(8_000_000 / (base.width * base.height)), 8192 / base.width, 8192 / base.height);
    const viewport = page.getViewport({ scale });
    target.width = Math.max(1, Math.floor(viewport.width));
    target.height = Math.max(1, Math.floor(viewport.height));
    const context = target.getContext("2d");
    if (!context) throw new Error("无法绘制歌谱");
    const task = page.render({ canvas: target, canvasContext: context, viewport });
    renderTask = task;
    await task.promise;
    if (renderTask === task) renderTask = null;
  } catch (cause) {
    if (generation !== renderGeneration || disposed || (cause instanceof Error && cause.name === "RenderingCancelledException")) return;
    error.value = "歌谱加载失败，请重试";
  } finally {
    if (generation === renderGeneration && !disposed) loading.value = false;
  }
}

async function loadSource() {
  const generation = ++sourceGeneration;
  releasePdf();
  panZoom.reset();
  pdfPageIndex.value = 0;
  pdfPageCount.value = 0;
  loading.value = true;
  error.value = "";
  imageAttempt.value += 1;
  const page = sourcePage.value;
  if (!page) { loading.value = false; error.value = "这份歌谱还没有可预览的页面"; return; }
  mediaUrl.value = `/api/music/scores/${props.score.id}/pages/${page.id}?token=${encodeURIComponent(getToken())}`;
  if (!isPdf.value) return;
  try {
    const [pdfjs, worker] = await Promise.all([import("pdfjs-dist/legacy/build/pdf.mjs"), import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")]);
    if (generation !== sourceGeneration || disposed) return;
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const task = pdfjs.getDocument({ url: mediaUrl.value });
    loadingTask = task;
    const document = await task.promise;
    if (generation !== sourceGeneration || disposed) return;
    pdfDocument = document;
    pdfPageCount.value = document.numPages;
    await renderPdfPage();
  } catch {
    if (generation === sourceGeneration && !disposed) { loading.value = false; error.value = "歌谱加载失败，请重试"; }
  }
}

function imageLoaded(event: Event) {
  const image = event.target as HTMLImageElement;
  dimensions.value = { width: image.naturalWidth || 1, height: image.naturalHeight || 1 };
  loading.value = false;
  error.value = "";
}
function imageFailed() { loading.value = false; error.value = "歌谱加载失败，请重试"; }
function shiftPage(delta: number) {
  const next = pageIndex.value + delta;
  if (next < 0 || next >= pageCount.value || loading.value) return;
  panZoom.reset();
  if (isPdf.value) { pdfPageIndex.value = next; void renderPdfPage(); }
  else fileIndex.value = next;
}
function measureStage() {
  if (!stage.value) return;
  stageSize.value = { width: stage.value.clientWidth, height: stage.value.clientHeight };
  if (resizeTimer) clearTimeout(resizeTimer);
  if (pdfDocument) resizeTimer = setTimeout(() => { resizeTimer = null; void renderPdfPage(); }, 180);
}

watch(() => props.score.id, () => { fileIndex.value = 0; });
watch(() => `${props.score.id}:${sourcePage.value?.id ?? ""}`, () => { void loadSource(); }, { immediate: true });
onMounted(() => {
  measureStage();
  observer = new ResizeObserver(measureStage);
  if (stage.value) observer.observe(stage.value);
});
onBeforeUnmount(() => {
  disposed = true;
  sourceGeneration += 1;
  observer?.disconnect();
  if (resizeTimer) clearTimeout(resizeTimer);
  releasePdf();
});
</script>

<template>
  <AppModal :open="true" :title="score.title" size="medium" content-class="music-score-preview" close-label="关闭歌谱预览" @close="emit('close')">
    <div class="music-score-preview-tools" role="group" aria-label="歌谱操作">
      <div class="music-score-preview-zoom">
        <button type="button" aria-label="缩小歌谱" :disabled="loading || !!error || transform.scale <= .25" @click="panZoom.zoomBy(1 / 1.25)"><Minus :size="18" /></button>
        <output aria-label="歌谱缩放比例">{{ Math.round(transform.scale * 100) }}%</output>
        <button type="button" aria-label="放大歌谱" :disabled="loading || !!error || transform.scale >= 8" @click="panZoom.zoomBy(1.25)"><Plus :size="18" /></button>
        <button type="button" class="music-score-preview-fit" aria-label="适合窗口" :disabled="loading || !!error" @click="panZoom.reset()"><Maximize :size="17" /><span>适合窗口</span></button>
      </div>
      <div class="music-score-preview-actions">
        <button type="button" aria-label="分享歌谱" :disabled="actionBusy || !score.pages.length" @click="emit('share')"><Share2 :size="17" /><span>分享</span></button>
        <button type="button" aria-label="下载歌谱" :disabled="actionBusy || !score.pages.length" @click="emit('download')"><Download :size="17" /><span>下载</span></button>
      </div>
    </div>
    <div ref="stage" class="music-score-preview-stage" :class="{ dragging }" :aria-busy="loading" aria-label="歌谱预览，可缩放和拖动" :data-scale="transform.scale" :data-offset-x="transform.x" :data-offset-y="transform.y"
      @pointerdown="panZoom.onPointerDown" @pointermove="panZoom.onPointerMove" @pointerup="panZoom.onPointerEnd" @pointercancel="panZoom.onPointerEnd" @lostpointercapture="panZoom.onPointerEnd" @wheel="panZoom.onWheel" @dragstart.prevent
    >
      <div v-show="!loading && !error" class="music-score-preview-content" :style="contentStyle">
        <canvas v-if="isPdf" ref="canvas" class="music-score-preview-canvas" :aria-label="`歌谱第 ${pageIndex + 1} 页`"></canvas>
        <img v-else-if="sourcePage" :key="`${sourcePage.id}-${imageAttempt}`" class="music-score-preview-image" :src="mediaUrl" :alt="`${score.title} 第 ${pageIndex + 1} 页`" draggable="false" @load="imageLoaded" @error="imageFailed" />
      </div>
      <div v-if="loading" class="music-score-preview-state" role="status">正在加载歌谱…</div>
      <div v-else-if="error" class="music-score-preview-state" role="alert" @pointerdown.stop>
        <p>{{ error }}</p><button v-if="sourcePage" type="button" @click="loadSource">重试</button>
      </div>
    </div>
    <footer class="music-score-preview-footer">
      <div class="music-score-preview-pagination" role="group" aria-label="歌谱翻页">
        <button type="button" aria-label="上一页歌谱" :disabled="loading || pageIndex <= 0" @click="shiftPage(-1)"><ChevronLeft :size="20" /></button>
        <span data-testid="music-score-page-number" aria-live="polite">{{ pageCount ? pageIndex + 1 : 0 }} / {{ pageCount }}</span>
        <button type="button" aria-label="下一页歌谱" :disabled="loading || pageIndex >= pageCount - 1" @click="shiftPage(1)"><ChevronRight :size="20" /></button>
      </div>
      <span v-if="actionStatus" class="music-score-preview-action-status" role="status">{{ actionStatus }}</span>
      <span v-else class="music-score-preview-hint">滚轮或双指缩放，拖动查看</span>
    </footer>
  </AppModal>
</template>

<style scoped>
:deep(.music-score-preview) {
  width: min(1100px, calc(100vw - 24px));
  height: min(900px, calc(var(--app-height, 100dvh) - var(--safe-top, 0px) - var(--safe-bottom, 0px) - 24px));
  max-height: calc(var(--app-height, 100dvh) - var(--safe-top, 0px) - var(--safe-bottom, 0px) - 24px);
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #fff;
}
:deep(.music-score-preview .modal-head) { flex: 0 0 auto; gap: 12px; margin-bottom: 0; }
:deep(.music-score-preview .modal-head strong) { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
:deep(.music-score-preview .modal-head .icon-btn) { flex-shrink: 0; }
.music-score-preview-tools { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; border-bottom: 1px solid #e3e5e9; flex-shrink: 0; }
.music-score-preview-zoom, .music-score-preview-actions { display: flex; align-items: center; gap: 5px; }
.music-score-preview-tools button, .music-score-preview-pagination button, .music-score-preview-state button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-width: 36px; min-height: 36px; padding: 6px 8px; border: 1px solid #e1e4e8; border-radius: 7px; background: #fff; color: #26334a; font: inherit; font-size: 13px; cursor: pointer; }
.music-score-preview-tools button:disabled, .music-score-preview-pagination button:disabled { opacity: .4; cursor: default; }
.music-score-preview-tools button:focus-visible, .music-score-preview-pagination button:focus-visible, .music-score-preview-state button:focus-visible { outline: 2px solid #527bb3; outline-offset: 2px; }
.music-score-preview-zoom output { min-width: 44px; text-align: center; font-size: 12px; font-variant-numeric: tabular-nums; }
.music-score-preview-stage { position: relative; flex: 1 1 auto; min-height: 120px; overflow: hidden; background: #e8ebef; touch-action: none; cursor: grab; user-select: none; }
.music-score-preview-stage.dragging { cursor: grabbing; }
.music-score-preview-content { position: absolute; left: 50%; top: 50%; transform-origin: center; background: #fff; box-shadow: 0 2px 15px #17243a24; }
.music-score-preview-image, .music-score-preview-canvas { display: block; width: 100%; height: 100%; max-width: none; pointer-events: none; }
.music-score-preview-state { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 10px; padding: 20px; color: #536076; text-align: center; }
.music-score-preview-state p { margin: 0; }
.music-score-preview-footer { display: flex; flex: 0 0 auto; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px; min-width: 0; padding: 8px 12px; border-top: 1px solid #e3e5e9; }
.music-score-preview-pagination { display: flex; align-items: center; gap: 8px; }
.music-score-preview-pagination span { min-width: 50px; text-align: center; font-size: 13px; font-variant-numeric: tabular-nums; }
.music-score-preview-hint, .music-score-preview-action-status { min-width: 0; margin: 0; color: #687489; font-size: 12px; overflow-wrap: anywhere; }
.music-score-preview-action-status { flex: 1 1 160px; }
@media (max-width: 480px) {
  .music-score-preview-tools { padding: 8px; gap: 6px; }
  .music-score-preview-zoom, .music-score-preview-actions { gap: 3px; }
  .music-score-preview-tools button { padding: 5px 6px; }
  .music-score-preview-fit span { display: none; }
  .music-score-preview-footer { padding: 7px 8px; gap: 5px; }
  .music-score-preview-hint { max-width: 135px; font-size: 11px; }
}
</style>
