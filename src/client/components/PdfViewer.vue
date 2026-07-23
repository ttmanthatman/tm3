<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import PdfWorker from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = PdfWorker;

const props = defineProps<{
  src: string;
  fileName?: string;
}>();

const emit = defineEmits<{
  close: [];
}>();

const scrollRef = ref<HTMLDivElement | null>(null);
const loading = ref(true);
const error = ref("");
const pageCount = ref(0);

let loadingTask: pdfjs.PDFDocumentLoadingTask | null = null;
let pdfDocument: pdfjs.PDFDocumentProxy | null = null;
let renderTask: pdfjs.RenderTask | null = null;
let loadToken = 0;

async function loadPdf() {
  const token = ++loadToken;
  if (!props.src) return;
  loading.value = true;
  error.value = "";
  pageCount.value = 0;
  try {
    loadingTask = pdfjs.getDocument({ url: props.src });
    const task = loadingTask;
    const doc = await task.promise;
    if (token !== loadToken) {
      void task.destroy();
      return;
    }
    pdfDocument = doc;
    pageCount.value = doc.numPages;
    loading.value = false;
    await nextTick();
    await renderAllPages(doc, token);
  } catch (err) {
    if (token !== loadToken) return;
    if (!scrollRef.value?.childElementCount) {
      error.value = err instanceof Error ? err.message : "PDF 加载失败";
    }
  } finally {
    if (token === loadToken) loading.value = false;
  }
}

async function renderAllPages(doc: pdfjs.PDFDocumentProxy, token: number) {
  const container = scrollRef.value;
  if (!container) return;
  container.replaceChildren();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const available = Math.max(container.clientWidth - 24, 160);
  for (let num = 1; num <= doc.numPages; num += 1) {
    if (token !== loadToken) return;
    const page = await doc.getPage(num);
    const base = page.getViewport({ scale: 1 });
    const cssWidth = Math.floor(Math.min(available, base.width * 2));
    const viewport = page.getViewport({ scale: (cssWidth / base.width) * dpr });
    const canvas = document.createElement("canvas");
    canvas.className = "pdf-viewer-canvas";
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

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
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
  loadToken += 1;
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
  <div class="pdf-viewer">
    <div v-if="loading" class="pdf-viewer-status">
      <span class="pdf-viewer-spinner" aria-hidden="true"></span>
      <span>正在加载 PDF...</span>
    </div>
    <div v-else-if="error" class="pdf-viewer-status error">
      <strong>PDF 加载失败</strong>
      <small>{{ error }}</small>
    </div>
    <div v-else ref="scrollRef" class="pdf-viewer-scroll" :aria-label="fileName || 'PDF 预览'"></div>
  </div>
</template>
