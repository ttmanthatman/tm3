<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ChevronLeft, ChevronRight, X } from "lucide-vue-next";
import * as pdfjs from "pdfjs-dist";
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = PdfWorker;

const props = defineProps<{
  src: string;
  fileName?: string;
}>();

const emit = defineEmits<{
  close: [];
}>();

const containerRef = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const loading = ref(true);
const error = ref("");
const pageNumber = ref(1);
const pageCount = ref(0);
const scale = ref(1.5);

let loadingTask: pdfjs.PDFDocumentLoadingTask | null = null;
let pdfDocument: pdfjs.PDFDocumentProxy | null = null;
let renderTask: pdfjs.RenderTask | null = null;

async function loadPdf() {
  if (!props.src) return;
  loading.value = true;
  error.value = "";
  pageNumber.value = 1;
  pageCount.value = 0;
  try {
    loadingTask = pdfjs.getDocument({ url: props.src });
    pdfDocument = await loadingTask.promise;
    pageCount.value = pdfDocument.numPages;
    await renderPage(1);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "PDF 加载失败";
  } finally {
    loading.value = false;
  }
}

async function renderPage(num: number) {
  if (!pdfDocument || !canvasRef.value) return;
  if (renderTask) {
    renderTask.cancel();
    renderTask = null;
  }
  try {
    const page = await pdfDocument.getPage(num);
    const viewport = page.getViewport({ scale: scale.value });
    const canvas = canvasRef.value;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建 canvas 上下文");
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    renderTask = page.render({ canvas, canvasContext: context, viewport });
    await renderTask.promise;
    pageNumber.value = num;
  } catch (err) {
    if (err instanceof Error && err.name === "RenderingCancelledException") return;
    error.value = err instanceof Error ? err.message : "PDF 渲染失败";
  }
}

function goToPage(delta: number) {
  const next = pageNumber.value + delta;
  if (next < 1 || next > pageCount.value) return;
  void renderPage(next);
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    goToPage(-1);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    goToPage(1);
  } else if (event.key === "Escape") {
    emit("close");
  }
}

watch(
  () => props.src,
  () => {
    void loadPdf();
  }
);

onMounted(() => {
  void loadPdf();
  window.addEventListener("keydown", handleKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeydown);
  if (renderTask) {
    renderTask.cancel();
    renderTask = null;
  }
  if (loadingTask) {
    void loadingTask.destroy();
    loadingTask = null;
  }
  pdfDocument = null;
});
</script>

<template>
  <div ref="containerRef" class="pdf-viewer">
    <div v-if="loading" class="pdf-viewer-status">
      <span class="pdf-viewer-spinner" aria-hidden="true"></span>
      <span>正在加载 PDF...</span>
    </div>
    <div v-else-if="error" class="pdf-viewer-status error">
      <strong>PDF 加载失败</strong>
      <small>{{ error }}</small>
    </div>
    <template v-else>
      <div class="pdf-viewer-canvas-wrap">
        <canvas ref="canvasRef" class="pdf-viewer-canvas"></canvas>
      </div>
      <div class="pdf-viewer-controls">
        <button type="button" class="pdf-viewer-nav" :disabled="pageNumber <= 1" @click="goToPage(-1)" aria-label="上一页">
          <ChevronLeft :size="22" />
        </button>
        <span class="pdf-viewer-page">{{ pageNumber }} / {{ pageCount }}</span>
        <button type="button" class="pdf-viewer-nav" :disabled="pageNumber >= pageCount" @click="goToPage(1)" aria-label="下一页">
          <ChevronRight :size="22" />
        </button>
      </div>
    </template>
  </div>
</template>
