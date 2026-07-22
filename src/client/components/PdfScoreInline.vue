<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import * as pdfjs from "pdfjs-dist";
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = PdfWorker;

const props = defineProps<{
  src: string;
}>();

const containerRef = ref<HTMLDivElement | null>(null);
const error = ref("");

let loadingTask: pdfjs.PDFDocumentLoadingTask | null = null;
let renderTask: pdfjs.RenderTask | null = null;
let loadToken = 0;

async function loadPdf() {
  const token = ++loadToken;
  if (!props.src) return;
  error.value = "";
  try {
    loadingTask = pdfjs.getDocument({ url: props.src });
    const task = loadingTask;
    const doc = await task.promise;
    if (token !== loadToken) {
      void task.destroy();
      return;
    }
    await nextTick();
    await renderAllPages(doc, token);
  } catch (err) {
    if (token !== loadToken) return;
    error.value = err instanceof Error ? err.message : "PDF 加载失败";
  }
}

async function renderAllPages(doc: pdfjs.PDFDocumentProxy, token: number) {
  const container = containerRef.value;
  if (!container) return;
  container.replaceChildren();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const available = Math.max(container.clientWidth, 160);
  for (let num = 1; num <= doc.numPages; num += 1) {
    if (token !== loadToken) return;
    const page = await doc.getPage(num);
    const base = page.getViewport({ scale: 1 });
    const cssWidth = Math.floor(available);
    const viewport = page.getViewport({ scale: (cssWidth / base.width) * dpr });
    const canvas = document.createElement("canvas");
    canvas.className = "pdf-score-inline-canvas";
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${cssWidth}px`;
    canvas.setAttribute("aria-label", `第 ${num} 页`);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建 canvas 上下文");
    container.appendChild(canvas);
    try {
      renderTask = page.render({ canvas, canvasContext: context, viewport });
      await renderTask.promise;
    } catch (err) {
      if (err instanceof Error && err.name === "RenderingCancelledException") return;
      throw err;
    } finally {
      renderTask = null;
    }
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
});

onBeforeUnmount(() => {
  loadToken += 1;
  if (renderTask) {
    renderTask.cancel();
    renderTask = null;
  }
  if (loadingTask) {
    void loadingTask.destroy();
    loadingTask = null;
  }
});
</script>

<template>
  <div class="pdf-score-inline">
    <div v-if="error" class="pdf-score-inline-error">PDF 加载失败</div>
    <div v-else ref="containerRef" class="pdf-score-inline-pages"></div>
  </div>
</template>
