<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, type Directive } from "vue";
import {
  AlertTriangle,
  Download,
  Eye,
  FileAudio,
  FileImage,
  FileQuestion,
  FileText,
  FileVideo,
  Grid3X3,
  HardDrive,
  List,
  RefreshCw,
  Search,
  Trash2,
  WandSparkles,
  X
} from "lucide-vue-next";
import type { AdminAttachmentDTO } from "@shared/types";
import { getToken } from "../api";
import { compactBytes } from "../time";

const props = defineProps<{
  attachments: AdminAttachmentDTO[];
  loading?: boolean;
  error?: string;
}>();

const emit = defineEmits<{
  refresh: [];
  delete: [ids: string[]];
  deleteAll: [];
  compress: [ids: string[]];
}>();

type ResourceKind = "all" | AdminAttachmentDTO["kind"];
type ResourceStatus = "all" | "available" | "missing" | "unused";
type ResourceType = "all" | "image" | "audio" | "video" | "pdf" | "other";
type SortMode = "newest" | "oldest" | "name" | "largest";

const query = ref("");
const kind = ref<ResourceKind>("all");
const status = ref<ResourceStatus>("all");
const type = ref<ResourceType>("all");
const sort = ref<SortMode>("newest");
const view = ref<"grid" | "list">("grid");
const page = ref(1);
const pageSize = 48;
const selectedIds = ref<Set<string>>(new Set());
const previewItem = ref<AdminAttachmentDTO | null>(null);
const previewUrl = ref("");
const previewLoading = ref(false);
const previewError = ref("");
let previewAbort: AbortController | null = null;

const thumbnailUrls = new WeakMap<HTMLImageElement, string>();
const thumbnailObservers = new WeakMap<HTMLImageElement, IntersectionObserver>();

function revokeThumbnail(element: HTMLImageElement) {
  const current = thumbnailUrls.get(element);
  if (current) URL.revokeObjectURL(current);
  thumbnailUrls.delete(element);
  thumbnailObservers.get(element)?.disconnect();
  thumbnailObservers.delete(element);
}

async function loadProtectedImage(element: HTMLImageElement, url: string) {
  if (!url || element.dataset.secureLoaded === url) return;
  element.dataset.secureState = "loading";
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${getToken()}` }, cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const objectUrl = URL.createObjectURL(await response.blob());
    revokeThumbnail(element);
    thumbnailUrls.set(element, objectUrl);
    element.src = objectUrl;
    element.dataset.secureLoaded = url;
    element.dataset.secureState = "ready";
  } catch {
    element.dataset.secureState = "error";
  }
}

const vSecureSrc: Directive<HTMLImageElement, string> = {
  mounted(element, binding) {
    if (!binding.value) return;
    if (!("IntersectionObserver" in window)) {
      void loadProtectedImage(element, binding.value);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void loadProtectedImage(element, binding.value);
    }, { rootMargin: "240px" });
    thumbnailObservers.set(element, observer);
    observer.observe(element);
  },
  beforeUnmount(element) {
    revokeThumbnail(element);
  }
};

function extension(fileName: string) {
  return fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || "";
}

function resourceType(item: AdminAttachmentDTO): Exclude<ResourceType, "all"> {
  const ext = extension(item.fileName);
  if (["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "tif", "tiff"].includes(ext)) return "image";
  if (["mp3", "m4a", "wav", "ogg", "aac", "webm"].includes(ext)) return "audio";
  if (["mp4", "m4v", "mov"].includes(ext)) return "video";
  if (ext === "pdf") return "pdf";
  return "other";
}

function canBrowserPreview(item: AdminAttachmentDTO) {
  if (!item.exists || !item.url) return false;
  const ext = extension(item.fileName);
  return ["jpg", "jpeg", "png", "gif", "webp", "mp3", "m4a", "wav", "ogg", "aac", "webm", "mp4", "m4v", "mov", "pdf"].includes(ext);
}

function kindLabel(value: AdminAttachmentDTO["kind"]) {
  if (value === "avatar") return "头像";
  if (value === "background") return "外观图片";
  return "聊天附件";
}

function usageLabel(item: AdminAttachmentDTO) {
  if (!item.exists) return "文件已丢失";
  if (!item.usage.length) return "未被使用";
  return item.usage.join(" · ");
}

function formattedDate(value?: string | null) {
  if (!value) return "日期未知";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "日期未知" : date.toLocaleString();
}

function resourceIcon(item: AdminAttachmentDTO) {
  const value = resourceType(item);
  if (value === "image") return FileImage;
  if (value === "audio") return FileAudio;
  if (value === "video") return FileVideo;
  if (value === "pdf") return FileText;
  return FileQuestion;
}

const summary = computed(() => ({
  total: props.attachments.length,
  available: props.attachments.filter((item) => item.exists).length,
  missing: props.attachments.filter((item) => !item.exists).length,
  unused: props.attachments.filter((item) => item.exists && !item.usage.length).length,
  bytes: props.attachments.reduce((total, item) => total + (item.exists ? item.size : 0), 0)
}));

const filtered = computed(() => {
  const normalizedQuery = query.value.trim().toLocaleLowerCase();
  const rows = props.attachments.filter((item) => {
    if (kind.value !== "all" && item.kind !== kind.value) return false;
    if (type.value !== "all" && resourceType(item) !== type.value) return false;
    if (status.value === "available" && !item.exists) return false;
    if (status.value === "missing" && item.exists) return false;
    if (status.value === "unused" && (!item.exists || item.usage.length)) return false;
    if (!normalizedQuery) return true;
    return [item.fileName, item.label, item.channelName, item.ownerName, ...item.usage]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase().includes(normalizedQuery));
  });
  return rows.sort((left, right) => {
    if (sort.value === "name") return left.fileName.localeCompare(right.fileName, "zh-CN");
    if (sort.value === "largest") return right.size - left.size;
    const leftTime = Date.parse(left.createdAt || "") || 0;
    const rightTime = Date.parse(right.createdAt || "") || 0;
    return sort.value === "oldest" ? leftTime - rightTime : rightTime - leftTime;
  });
});

const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / pageSize)));
const visibleRows = computed(() => filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize));
const selected = computed(() => [...selectedIds.value]);
const selectedCompressible = computed(() => props.attachments.filter((item) => selectedIds.value.has(item.id) && item.exists && resourceType(item) === "image").map((item) => item.id));

watch([query, kind, status, type, sort], () => { page.value = 1; });
watch(() => props.attachments, (attachments) => {
  const valid = new Set(attachments.map((item) => item.id));
  selectedIds.value = new Set([...selectedIds.value].filter((id) => valid.has(id)));
  if (page.value > pageCount.value) page.value = pageCount.value;
});

watch(previewItem, async (item) => {
  previewAbort?.abort();
  previewAbort = null;
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = "";
  previewError.value = "";
  if (!item || !canBrowserPreview(item) || !item.url) return;
  previewLoading.value = true;
  const controller = new AbortController();
  previewAbort = controller;
  try {
    const response = await fetch(item.url, {
      headers: { Authorization: `Bearer ${getToken()}` },
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    previewUrl.value = URL.createObjectURL(await response.blob());
  } catch (error) {
    if (!controller.signal.aborted) previewError.value = error instanceof Error ? error.message : "预览加载失败";
  } finally {
    if (!controller.signal.aborted) previewLoading.value = false;
  }
});

function closePreviewOnEscape(event: KeyboardEvent) {
  if (event.key !== "Escape" || !previewItem.value) return;
  event.stopImmediatePropagation();
  previewItem.value = null;
}

onMounted(() => document.addEventListener("keydown", closePreviewOnEscape, true));

onBeforeUnmount(() => {
  document.removeEventListener("keydown", closePreviewOnEscape, true);
  previewAbort?.abort();
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
});

function toggleSelected(id: string) {
  const next = new Set(selectedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selectedIds.value = next;
}

function togglePageSelection() {
  const everyVisibleSelected = visibleRows.value.length > 0 && visibleRows.value.every((item) => selectedIds.value.has(item.id));
  const next = new Set(selectedIds.value);
  for (const item of visibleRows.value) {
    if (everyVisibleSelected) next.delete(item.id);
    else next.add(item.id);
  }
  selectedIds.value = next;
}

async function download(item: AdminAttachmentDTO) {
  if (!item.exists || !item.url) return;
  const response = await fetch(`${item.url}${item.url.includes("?") ? "&" : "?"}download=1`, {
    headers: { Authorization: `Bearer ${getToken()}` },
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`);
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = item.label || item.fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function requestDelete(ids: string[]) {
  if (!ids.length) return;
  emit("delete", ids);
  selectedIds.value = new Set();
}
</script>

<template>
  <section class="resource-manager" aria-label="资源管理">
    <header class="resource-heading">
      <div>
        <strong>资源管理</strong>
        <small>查找、预览和清理聊天附件、头像与外观图片</small>
      </div>
      <button class="resource-button" :disabled="loading" @click="emit('refresh')"><RefreshCw :size="16" />刷新</button>
    </header>

    <div class="resource-summary" aria-label="资源概况">
      <button :class="{ active: status === 'all' }" @click="status = 'all'"><HardDrive :size="18" /><span><b>{{ summary.total }}</b><small>全部资源</small></span></button>
      <button :class="{ active: status === 'available' }" @click="status = 'available'"><span class="summary-dot available"></span><span><b>{{ summary.available }}</b><small>可用</small></span></button>
      <button :class="{ active: status === 'missing' }" @click="status = 'missing'"><AlertTriangle :size="18" /><span><b>{{ summary.missing }}</b><small>文件缺失</small></span></button>
      <button :class="{ active: status === 'unused' }" @click="status = 'unused'"><span class="summary-dot unused"></span><span><b>{{ summary.unused }}</b><small>未被引用</small></span></button>
      <div><span><b>{{ compactBytes(summary.bytes) }}</b><small>已占空间</small></span></div>
    </div>

    <div class="resource-toolbar">
      <label class="resource-search"><Search :size="17" /><input v-model="query" type="search" placeholder="搜索完整文件名、上传者、频道或用途" /></label>
      <select v-model="kind" aria-label="资源来源">
        <option value="all">全部来源</option>
        <option value="upload">聊天附件</option>
        <option value="avatar">头像</option>
        <option value="background">外观图片</option>
      </select>
      <select v-model="type" aria-label="文件类型">
        <option value="all">全部类型</option>
        <option value="image">图片</option>
        <option value="audio">音频</option>
        <option value="video">视频</option>
        <option value="pdf">PDF</option>
        <option value="other">其它文件</option>
      </select>
      <select v-model="sort" aria-label="排序方式">
        <option value="newest">最新优先</option>
        <option value="oldest">最早优先</option>
        <option value="name">文件名</option>
        <option value="largest">体积最大</option>
      </select>
      <div class="view-switch" aria-label="显示方式">
        <button :class="{ active: view === 'grid' }" aria-label="网格" @click="view = 'grid'"><Grid3X3 :size="17" /></button>
        <button :class="{ active: view === 'list' }" aria-label="列表" @click="view = 'list'"><List :size="17" /></button>
      </div>
    </div>

    <div v-if="error" class="resource-error" role="alert"><AlertTriangle :size="18" /><span>{{ error }}</span><button @click="emit('refresh')">重试</button></div>
    <div v-else-if="loading && !attachments.length" class="resource-loading" aria-live="polite"><span></span><p>正在读取资源索引…</p></div>
    <div v-else-if="!filtered.length" class="resource-empty">
      <FileQuestion :size="34" />
      <strong>没有符合条件的资源</strong>
      <small>清除搜索或切换筛选条件后再试。</small>
    </div>

    <div v-else class="resource-results">
      <div class="results-head">
        <span>找到 {{ filtered.length }} 项 · 第 {{ page }}/{{ pageCount }} 页</span>
        <button class="text-button" @click="togglePageSelection">选择/取消本页</button>
      </div>
      <div class="resource-list" :class="`view-${view}`">
        <article v-for="item in visibleRows" :key="item.id" class="resource-card" :class="{ selected: selectedIds.has(item.id), missing: !item.exists }">
          <label class="resource-check" :aria-label="`选择 ${item.fileName}`"><input type="checkbox" :checked="selectedIds.has(item.id)" @change="toggleSelected(item.id)" /></label>
          <button class="resource-thumb" :disabled="!canBrowserPreview(item)" @click="previewItem = item">
            <img v-if="resourceType(item) === 'image' && item.exists && item.url" v-secure-src="item.url" alt="" />
            <component :is="resourceIcon(item)" :size="30" />
            <span v-if="!item.exists" class="resource-state missing">缺失</span>
            <span v-else-if="!item.usage.length" class="resource-state unused">未引用</span>
          </button>
          <div class="resource-info">
            <div class="resource-title"><strong :title="item.fileName">{{ item.label || item.fileName }}</strong><span>{{ kindLabel(item.kind) }}</span></div>
            <code :title="item.fileName">{{ item.fileName }}</code>
            <p :title="usageLabel(item)">{{ usageLabel(item) }}</p>
            <small>{{ compactBytes(item.size) }} · {{ formattedDate(item.createdAt) }}</small>
          </div>
          <div class="resource-actions">
            <button :disabled="!canBrowserPreview(item)" aria-label="预览" @click="previewItem = item"><Eye :size="16" /></button>
            <button :disabled="!item.exists || !item.url" aria-label="下载" @click="download(item)"><Download :size="16" /></button>
            <button class="danger" aria-label="删除" @click="requestDelete([item.id])"><Trash2 :size="16" /></button>
          </div>
        </article>
      </div>

      <nav v-if="pageCount > 1" class="resource-pagination" aria-label="资源分页">
        <button :disabled="page <= 1" @click="page -= 1">上一页</button>
        <span>{{ page }} / {{ pageCount }}</span>
        <button :disabled="page >= pageCount" @click="page += 1">下一页</button>
      </nav>
    </div>

    <footer class="resource-bulk-bar">
      <span>已选 <b>{{ selected.length }}</b> 项</span>
      <button :disabled="!selectedCompressible.length" @click="emit('compress', selectedCompressible)"><WandSparkles :size="16" />压缩图片</button>
      <button class="danger" :disabled="!selected.length" @click="requestDelete(selected)"><Trash2 :size="16" />删除所选</button>
      <button class="danger-quiet" :disabled="!attachments.length" @click="emit('deleteAll')">清理全部</button>
    </footer>

    <section v-if="previewItem" class="resource-preview-shell" role="dialog" aria-modal="true" aria-label="资源预览" @click.self="previewItem = null">
      <div class="resource-preview">
        <header>
          <div><strong>{{ previewItem.label || previewItem.fileName }}</strong><code>{{ previewItem.fileName }}</code></div>
          <button aria-label="关闭预览" @click="previewItem = null"><X :size="20" /></button>
        </header>
        <div class="preview-stage">
          <p v-if="previewLoading">正在安全读取文件…</p>
          <p v-else-if="previewError" class="preview-error"><AlertTriangle :size="20" />{{ previewError }}</p>
          <img v-else-if="previewUrl && resourceType(previewItem) === 'image'" :src="previewUrl" alt="附件预览" />
          <audio v-else-if="previewUrl && resourceType(previewItem) === 'audio'" :src="previewUrl" controls autoplay />
          <video v-else-if="previewUrl && resourceType(previewItem) === 'video'" :src="previewUrl" controls autoplay playsinline />
          <iframe v-else-if="previewUrl && resourceType(previewItem) === 'pdf'" :src="previewUrl" title="PDF 预览" sandbox=""></iframe>
          <div v-else class="preview-unavailable"><component :is="resourceIcon(previewItem)" :size="40" /><strong>此文件不在浏览器内打开</strong><small>为避免主动文件执行代码，请下载后用本机应用查看。</small></div>
        </div>
        <footer>
          <span>{{ usageLabel(previewItem) }} · {{ compactBytes(previewItem.size) }}</span>
          <button :disabled="!previewItem.exists || !previewItem.url" @click="download(previewItem)"><Download :size="16" />下载原文件</button>
        </footer>
      </div>
    </section>
  </section>
</template>

<style scoped>
.resource-manager { display: grid; gap: 14px; min-width: 0; }
.resource-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.resource-heading > div { display: grid; gap: 3px; }
.resource-heading strong { font-size: 18px; }
.resource-heading small, .resource-info small, .resource-info p { color: var(--muted); }
button, select, input { font: inherit; }
.resource-button, .resource-bulk-bar button, .resource-pagination button { min-height: 36px; border: 1px solid var(--line); border-radius: 8px; padding: 0 12px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; background: #fff; color: var(--text); }
button:disabled { opacity: .45; cursor: not-allowed; }
.resource-summary { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; background: #fff; }
.resource-summary > * { min-width: 0; min-height: 68px; border: 0; border-right: 1px solid var(--line); padding: 10px 12px; display: flex; align-items: center; gap: 9px; background: transparent; text-align: left; }
.resource-summary > *:last-child { border-right: 0; }
.resource-summary button { cursor: pointer; }
.resource-summary button.active { background: color-mix(in srgb, var(--accent) 9%, #fff); color: var(--accent-dark); }
.resource-summary span { min-width: 0; display: grid; }
.resource-summary b { font-size: 18px; }
.resource-summary small { overflow: hidden; color: var(--muted); text-overflow: ellipsis; white-space: nowrap; }
.summary-dot { width: 12px; height: 12px; border-radius: 999px; background: #22c55e; }
.summary-dot.unused { background: #94a3b8; }
.resource-toolbar { display: grid; grid-template-columns: minmax(220px, 1fr) auto auto auto auto; gap: 8px; }
.resource-search { min-width: 0; min-height: 40px; border: 1px solid var(--line); border-radius: 8px; padding: 0 11px; display: flex; align-items: center; gap: 8px; background: #fff; }
.resource-search input { min-width: 0; width: 100%; border: 0; outline: 0; background: transparent; }
.resource-toolbar select { min-height: 40px; border: 1px solid var(--line); border-radius: 8px; padding: 0 30px 0 10px; background: #fff; }
.view-switch { display: flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: #fff; }
.view-switch button { width: 40px; border: 0; background: transparent; }
.view-switch button.active { background: var(--accent); color: #fff; }
.resource-error, .resource-loading, .resource-empty { min-height: 160px; border: 1px dashed var(--line); border-radius: 10px; padding: 24px; display: flex; align-items: center; justify-content: center; gap: 10px; color: var(--muted); text-align: center; }
.resource-error { min-height: 72px; color: #b42318; }
.resource-error button { border: 0; background: transparent; color: inherit; text-decoration: underline; }
.resource-loading, .resource-empty { flex-direction: column; }
.resource-loading span { width: 26px; height: 26px; border: 3px solid #dbe3ea; border-top-color: var(--accent); border-radius: 999px; animation: resource-spin .8s linear infinite; }
@keyframes resource-spin { to { transform: rotate(360deg); } }
.resource-results { display: grid; gap: 10px; }
.results-head { display: flex; justify-content: space-between; gap: 12px; color: var(--muted); font-size: 13px; }
.text-button { border: 0; background: transparent; color: var(--accent-dark); }
.resource-list.view-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px; }
.resource-card { position: relative; min-width: 0; border: 1px solid var(--line); border-radius: 10px; padding: 9px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 9px; background: #fff; transition: border-color .15s, box-shadow .15s; }
.resource-card.selected { border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 16%, transparent); }
.resource-card.missing { background: #fff9f8; }
.resource-check { position: absolute; top: 14px; left: 14px; z-index: 2; width: 22px; height: 22px; border-radius: 6px; display: grid; place-items: center; background: rgba(255,255,255,.92); box-shadow: 0 1px 5px rgba(0,0,0,.15); }
.resource-check input { width: 16px; height: 16px; accent-color: var(--accent); }
.resource-thumb { position: relative; grid-column: 1 / -1; height: 142px; border: 0; border-radius: 8px; overflow: hidden; display: grid; place-items: center; background: #eef2f5; color: #718096; }
.resource-thumb img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.resource-thumb img[data-secure-state="error"] { display: none; }
.resource-thumb svg { z-index: 0; }
.resource-state { position: absolute; right: 7px; bottom: 7px; border-radius: 999px; padding: 3px 7px; background: rgba(15,23,42,.76); color: #fff; font-size: 11px; }
.resource-state.missing { background: #b42318; }
.resource-info { min-width: 0; display: grid; align-content: start; gap: 5px; }
.resource-title { min-width: 0; display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.resource-title strong { min-width: 0; overflow-wrap: anywhere; line-height: 1.35; }
.resource-title span { flex: 0 0 auto; border-radius: 999px; padding: 2px 6px; background: #eef2f5; color: var(--muted); font-size: 11px; }
.resource-info code { min-width: 0; max-height: 42px; overflow: auto; overflow-wrap: anywhere; white-space: normal; color: #334155; font-size: 12px; }
.resource-info p { min-width: 0; margin: 0; overflow-wrap: anywhere; line-height: 1.4; font-size: 12px; }
.resource-actions { display: flex; align-items: end; gap: 3px; }
.resource-actions button { width: 34px; height: 34px; border: 0; border-radius: 7px; display: grid; place-items: center; background: #eef2f5; color: #334155; }
.resource-actions button.danger, .resource-bulk-bar .danger { color: #b42318; }
.view-list { display: grid; gap: 7px; }
.view-list .resource-card { grid-template-columns: 76px minmax(0, 1fr) auto; align-items: center; }
.view-list .resource-thumb { grid-column: auto; height: 64px; }
.view-list .resource-check { top: 7px; left: 7px; }
.resource-pagination { display: flex; align-items: center; justify-content: center; gap: 12px; }
.resource-bulk-bar { position: sticky; bottom: -16px; z-index: 5; border: 1px solid var(--line); border-radius: 10px; padding: 10px; display: flex; align-items: center; justify-content: flex-end; gap: 8px; background: rgba(255,255,255,.96); box-shadow: 0 -8px 24px rgba(15,23,42,.09); backdrop-filter: blur(10px); }
.resource-bulk-bar > span { margin-right: auto; }
.resource-bulk-bar .danger-quiet { border-color: transparent; color: #b42318; background: transparent; }
.resource-preview-shell { position: fixed; inset: 0; z-index: 72; padding: 16px; display: grid; place-items: center; background: rgba(15,23,42,.58); }
.resource-preview { width: min(920px, 100%); height: min(720px, calc(100vh - 32px)); border-radius: 12px; overflow: hidden; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; background: #fff; box-shadow: 0 24px 80px rgba(0,0,0,.28); }
.resource-preview header, .resource-preview footer { min-width: 0; min-height: 58px; padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--line); }
.resource-preview header > div { min-width: 0; display: grid; gap: 3px; }
.resource-preview header code { max-width: 72vw; overflow-wrap: anywhere; white-space: normal; color: var(--muted); }
.resource-preview header button { width: 38px; height: 38px; border: 0; border-radius: 8px; display: grid; place-items: center; background: #eef2f5; }
.preview-stage { min-height: 0; display: grid; place-items: center; overflow: auto; background: #111827; color: #e5e7eb; }
.preview-stage img, .preview-stage video { max-width: 100%; max-height: 100%; object-fit: contain; }
.preview-stage audio { width: min(520px, 90%); }
.preview-stage iframe { width: 100%; height: 100%; border: 0; background: #fff; }
.preview-error, .preview-unavailable { max-width: 420px; padding: 24px; display: grid; justify-items: center; gap: 8px; text-align: center; }
.resource-preview footer { border-top: 1px solid var(--line); border-bottom: 0; }
.resource-preview footer span { min-width: 0; overflow-wrap: anywhere; color: var(--muted); }
.resource-preview footer button { min-height: 38px; border: 0; border-radius: 8px; padding: 0 13px; display: inline-flex; align-items: center; gap: 6px; background: var(--accent); color: #fff; }
@media (max-width: 760px) {
  .resource-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .resource-summary > * { border-bottom: 1px solid var(--line); }
  .resource-toolbar { grid-template-columns: 1fr 1fr; }
  .resource-search { grid-column: 1 / -1; }
  .view-switch { justify-self: stretch; }
  .view-switch button { flex: 1; }
  .resource-list.view-grid { grid-template-columns: minmax(0, 1fr); }
  .view-list .resource-card { grid-template-columns: 68px minmax(0, 1fr); }
  .view-list .resource-actions { grid-column: 1 / -1; justify-content: flex-end; }
  .resource-bulk-bar { flex-wrap: wrap; bottom: -16px; }
  .resource-bulk-bar > span { width: 100%; }
  .resource-preview-shell { padding: 0; }
  .resource-preview { width: 100%; height: 100%; border-radius: 0; }
}
</style>
