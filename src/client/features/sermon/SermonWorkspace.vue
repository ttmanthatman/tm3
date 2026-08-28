<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ArrowDown, ArrowUp, ChevronRight, Eraser, Highlighter, Pencil, Plus, SkipBack, SkipForward, Trash2, Underline, X } from "lucide-vue-next";
import type { BibleLookupDTO, SermonAnnotationKind, SermonDisplayDTO, SermonQueueItem, SermonSlideInput } from "@shared/types";
import { api } from "../../api";
import { useChatStore } from "../../store";
import { SERMON_DISPLAY_FALLBACK, sermonDisplayAttrs, sermonDisplayStyle } from "./sermonDisplay";
import { verseHasAnnotation } from "./sermonText";
import { parseSermonInput } from "./sermonInput";
import SermonDisplayControls from "./SermonDisplayControls.vue";
import SermonStage from "./SermonStage.vue";
import { useSermon, type SermonEmitResult } from "./useSermon";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const store = useChatStore();
const sermon = useSermon({ getSocket: () => store.socket });
const { sermonState, presenterStatus } = sermon;

const view = ref<"queue" | "present">("queue");
const contentInput = ref("");
const onePerSlide = ref(false);
const parsedSlides = ref<SermonSlideInput[]>([]);
const adding = ref(false);
const actionError = ref("");

type RefDetail = { status: "loading" | "ok" | "error"; normalizedReference?: string; verseCount?: number };
const refDetails = ref(new Map<string, RefDetail>());

const queue = computed(() => sermonState.value?.queue || []);
const currentItemId = computed(() => sermonState.value?.currentItemId || null);
const currentItem = computed<SermonQueueItem | null>(() => queue.value.find((item) => item.id === currentItemId.value) || null);
const currentIndex = computed(() => queue.value.findIndex((item) => item.id === currentItemId.value));
const display = computed(() => sermonState.value?.display ?? SERMON_DISPLAY_FALLBACK);

const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
const shortcutHint = computed(() => (isMac ? "⌘+Enter 加入队列" : "Ctrl+Enter 加入队列"));

// 桌面端双预览（投影 1280×720、手机 390×845 基准尺寸）：按容器宽度等比缩放真实舞台。
const PREVIEW_PROJECTOR_BASE_WIDTH = 1280;
const PREVIEW_PHONE_BASE_WIDTH = 390;
const projectorFrame = ref<HTMLElement | null>(null);
const phoneFrame = ref<HTMLElement | null>(null);
const projectorScale = ref(0.3);
const phoneScale = ref(0.3);
let previewObserver: ResizeObserver | null = null;

onMounted(() => {
  previewObserver = new ResizeObserver(() => {
    const projectorWidth = projectorFrame.value?.clientWidth ?? 0;
    if (projectorWidth > 0) projectorScale.value = projectorWidth / PREVIEW_PROJECTOR_BASE_WIDTH;
    const phoneWidth = phoneFrame.value?.clientWidth ?? 0;
    if (phoneWidth > 0) phoneScale.value = phoneWidth / PREVIEW_PHONE_BASE_WIDTH;
  });
  if (projectorFrame.value) previewObserver.observe(projectorFrame.value);
  if (phoneFrame.value) previewObserver.observe(phoneFrame.value);
});

onBeforeUnmount(() => previewObserver?.disconnect());

const presenterUntilText = computed(() => {
  const status = presenterStatus.value;
  if (!status) return "";
  if (!status.canPresent) return "当前没有讲道权限";
  return status.until ? `讲道权限有效期至 ${new Date(status.until).toLocaleString("zh-CN", { hour12: false })}` : "讲道权限长期有效";
});

// 关闭工作区后回到队列屏，下次打开始终是队列入口。
watch(
  () => props.open,
  (open) => {
    if (!open) {
      view.value = "queue";
      verseMenu.value = null;
      selectionOffer.value = null;
      editing.value = false;
    }
  }
);

async function report(result: Promise<SermonEmitResult>) {
  const outcome = await result;
  actionError.value = outcome.ok ? "" : outcome.message || "操作失败";
}

function formatErrors(result: SermonEmitResult) {
  return result.ok && result.errors?.length ? result.errors.map((entry) => `${entry.reference}：${entry.message}`).join("；") : "";
}

// —— 统一输入：本地解析 + 防抖经文查询 ——

let parseTimer: ReturnType<typeof setTimeout> | null = null;

function setRefDetail(reference: string, detail: RefDetail) {
  const next = new Map(refDetails.value);
  next.set(reference, detail);
  refDetails.value = next;
}

async function lookupReference(reference: string) {
  try {
    const result = await api<{ success: boolean; result?: BibleLookupDTO; message?: string }>(
      `/api/bible/lookup?reference=${encodeURIComponent(reference)}`
    );
    setRefDetail(
      reference,
      result.success && result.result
        ? { status: "ok", normalizedReference: result.result.normalizedReference, verseCount: result.result.verses.length }
        : { status: "error" }
    );
  } catch {
    setRefDetail(reference, { status: "error" });
  }
}

function refreshParse() {
  const slides = parseSermonInput(contentInput.value, onePerSlide.value);
  parsedSlides.value = slides;
  const references = [...new Set(slides.flatMap((slide) => slide.blocks.filter((block) => block.type === "reference").map((block) => block.reference)))];
  for (const reference of references) {
    if (refDetails.value.has(reference)) continue;
    setRefDetail(reference, { status: "loading" });
    void lookupReference(reference);
  }
}

watch([contentInput, onePerSlide], () => {
  if (parseTimer) clearTimeout(parseTimer);
  parseTimer = setTimeout(() => {
    parseTimer = null;
    refreshParse();
  }, 200);
});

onBeforeUnmount(() => {
  if (parseTimer) clearTimeout(parseTimer);
});

function refLabel(reference: string) {
  const detail = refDetails.value.get(reference);
  return detail?.status === "ok" ? (detail.normalizedReference ?? reference) : reference;
}

function refStatusText(reference: string) {
  const detail = refDetails.value.get(reference);
  if (!detail || detail.status === "loading") return "正在查询…";
  if (detail.status === "error") return "无法识别，将作为文字加入";
  return `${detail.verseCount ?? 0} 节`;
}

function textSnippet(content: string) {
  const flat = content.replace(/\n+/g, " ").trim();
  return flat.length > 40 ? `${flat.slice(0, 40)}…` : flat;
}

async function addToQueue() {
  const slides = parsedSlides.value;
  if (!slides.length || adding.value) return;
  adding.value = true;
  const result = await sermon.add(slides);
  adding.value = false;
  if (!result.ok) {
    actionError.value = result.message;
    return;
  }
  contentInput.value = "";
  parsedSlides.value = [];
  actionError.value = formatErrors(result);
}

function handleInputKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    void addToQueue();
  }
}

function moveItem(itemId: string, direction: -1 | 1) {
  const order = queue.value.map((item) => item.id);
  const index = order.indexOf(itemId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= order.length) return;
  [order[index], order[target]] = [order[target], order[index]];
  void report(sermon.reorder(order));
}

/** 队列屏点击条目：推送给观众并进入演示视图（已展示的条目直接进入）。 */
function enterPresent(item: SermonQueueItem) {
  view.value = "present";
  verseMenu.value = null;
  selectionOffer.value = null;
  editing.value = false;
  if (item.id !== currentItemId.value) void report(sermon.present(item.id));
}

function presentRelative(direction: -1 | 1) {
  const target = queue.value[currentIndex.value + direction];
  if (target) void report(sermon.present(target.id));
}

function updateDisplay(patch: Partial<SermonDisplayDTO>) {
  void report(sermon.setDisplay(patch));
}

async function endPresentation() {
  if (!window.confirm("结束展示并清空讲道队列？")) return;
  await report(sermon.clearPresentation());
  view.value = "queue";
}

// —— 演示视图内屏内滚动（Shift+↑/↓ 一行步进，位置同步给观众端） ——

function presentMaxScrollLines(): number {
  const body = document.querySelector<HTMLElement>(".sermon-present-stage .sermon-overlay-body");
  const passage = body?.querySelector<HTMLElement>(".sermon-passage");
  if (!body || !passage) return 0;
  const lineHeight = Number.parseFloat(getComputedStyle(passage).lineHeight) || passage.getBoundingClientRect().height;
  if (!lineHeight) return 0;
  return Math.floor((body.scrollHeight - body.clientHeight) / lineHeight);
}

function handlePresentKeydown(event: KeyboardEvent) {
  if (view.value !== "present" || !event.shiftKey) return;
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
  const target = event.target as HTMLElement | null;
  if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable)) return;
  const item = currentItem.value;
  const maxLines = presentMaxScrollLines();
  if (!item || maxLines <= 0) return;
  event.preventDefault();
  const current = item.scrollLines ?? 0;
  const next = Math.min(maxLines, Math.max(0, current + (event.key === "ArrowDown" ? 1 : -1)));
  if (next !== current) void report(sermon.scroll(item.id, next));
}

onMounted(() => window.addEventListener("keydown", handlePresentKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", handlePresentKeydown));

// —— 演示视图内热编辑（按原文重编辑当前屏，保存后重解析并推送） ——

const editing = ref(false);
const editSource = ref("");

function rebuildSource(item: SermonQueueItem): string {
  if (item.source?.trim()) return item.source;
  const fromBlocks = (item.blocks ?? []).map((block) => (block.type === "passage" ? block.reference : block.content)).join("\n");
  return fromBlocks || item.content || item.reference;
}

function openEditor() {
  const item = currentItem.value;
  if (!item) return;
  verseMenu.value = null;
  selectionOffer.value = null;
  editSource.value = rebuildSource(item);
  editing.value = true;
}

async function saveEdit() {
  const item = currentItem.value;
  if (!item) return;
  const slides = parseSermonInput(editSource.value, false);
  if (!slides.length) {
    actionError.value = "内容为空";
    return;
  }
  const result = await sermon.update(item.id, slides[0]);
  if (!result.ok) {
    actionError.value = result.message;
    return;
  }
  editing.value = false;
  actionError.value = formatErrors(result);
}

// —— 演示视图内标注 ——

const verseMenu = ref<{ verseIndex: number; x: number; y: number } | null>(null);
const selectionOffer = ref<{ verseIndex: number; start: number; end: number; x: number; y: number } | null>(null);

function handleVerseClick(verseIndex: number, event: MouseEvent) {
  // 刚拖出选段时不弹整节菜单，避免与“划线选段”冲突。
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed) return;
  selectionOffer.value = null;
  const x = Math.min(Math.max(event.clientX, 84), window.innerWidth - 84);
  verseMenu.value = verseMenu.value?.verseIndex === verseIndex ? null : { verseIndex, x, y: event.clientY };
}

function toggleVerseAnnotation(kind: SermonAnnotationKind) {
  const menu = verseMenu.value;
  const item = currentItem.value;
  if (!menu || !item) return;
  if (verseHasAnnotation(item.annotations, menu.verseIndex, kind)) {
    void report(sermon.clearAnnotations(item.id, menu.verseIndex, kind));
  } else {
    void report(sermon.annotate(item.id, { verseIndex: menu.verseIndex, kind }));
  }
}

function clearVerseAnnotations() {
  const menu = verseMenu.value;
  const item = currentItem.value;
  if (!menu || !item) return;
  void report(sermon.clearAnnotations(item.id, menu.verseIndex));
  verseMenu.value = null;
}

/** 把节内选区换算成该节纯文本的字符偏移（不存 DOM 路径，跨端按文本重切）。 */
function handleSelectionMouseup(event: MouseEvent) {
  const item = currentItem.value;
  const selection = window.getSelection();
  // 折叠选区（普通点击）直接放行：不能在 mouseup 时关掉经节菜单，
  // 否则菜单按钮在随后的 click 派发前就被卸载，点击被吞掉。
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
  verseMenu.value = null;
  if (!item) {
    selectionOffer.value = null;
    return;
  }
  const range = selection.getRangeAt(0);
  const anchor = range.commonAncestorContainer;
  const verseTextEl = (anchor instanceof Element ? anchor : anchor.parentElement)?.closest<HTMLElement>(".sermon-verse-text");
  const stageRoot = (event.target instanceof Element ? event.target : null)?.closest(".sermon-present-stage");
  if (!verseTextEl || !stageRoot?.contains(verseTextEl)) {
    selectionOffer.value = null;
    return;
  }
  const verseIndex = Number(verseTextEl.dataset.verseIndex);
  if (!Number.isInteger(verseIndex) || verseIndex < 0 || verseIndex >= item.verses.length) {
    selectionOffer.value = null;
    return;
  }
  const before = range.cloneRange();
  before.selectNodeContents(verseTextEl);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  const end = start + range.toString().length;
  if (start >= end) {
    selectionOffer.value = null;
    return;
  }
  const rect = range.getBoundingClientRect();
  const x = Math.min(Math.max(rect.left + rect.width / 2, 70), window.innerWidth - 70);
  selectionOffer.value = { verseIndex, start, end, x, y: rect.bottom + 8 };
}

function annotateSelection() {
  const offer = selectionOffer.value;
  const item = currentItem.value;
  if (!offer || !item) return;
  void report(sermon.annotate(item.id, { verseIndex: offer.verseIndex, kind: "underline", start: offer.start, end: offer.end }));
  selectionOffer.value = null;
  window.getSelection()?.removeAllRanges();
}
</script>

<template>
  <section class="sermon-workspace" :class="{ open: props.open }" :aria-hidden="!props.open" :inert="!props.open">
    <header class="sermon-workspace-topbar">
      <div class="sermon-workspace-title">
        <strong>讲道台</strong>
        <small v-if="presenterUntilText">{{ presenterUntilText }}</small>
      </div>
      <button class="sermon-topbar-button" type="button" @click="emit('close')">聊天<ChevronRight :size="20" /></button>
    </header>

    <main class="sermon-workspace-body sermon-queue-view" :class="{ 'mobile-hidden': view !== 'queue' }">
      <div class="sermon-queue-column">
        <section class="sermon-block">
          <h3>添加内容</h3>
          <textarea
            v-model="contentInput"
            class="sermon-reference-input"
            rows="4"
            maxlength="8000"
            placeholder="输入经文出处或文字，如：&#10;约3:16&#10;诗篇 23:1&#10;大纲、引文等文字原样保留…"
            @keydown="handleInputKeydown"
          ></textarea>
          <div class="sermon-input-options">
            <label class="sermon-one-per-slide">
              <input v-model="onePerSlide" type="checkbox" />
              <span>每处经文一屏</span>
            </label>
            <button class="primary-btn" type="button" :disabled="adding || !parsedSlides.length" @click="addToQueue">
              <Plus :size="15" />{{ adding ? "正在加入…" : "加入队列" }}
            </button>
          </div>
          <div v-if="parsedSlides.length" class="sermon-previews">
            <div v-for="(slide, slideIndex) in parsedSlides" :key="slideIndex" class="sermon-preview ok">
              <template v-for="(block, blockIndex) in slide.blocks" :key="blockIndex">
                <template v-if="block.type === 'reference'">
                  <strong>{{ refLabel(block.reference) }}</strong>
                  <small :class="{ 'sermon-preview-warn': refDetails.get(block.reference)?.status === 'error' }">{{ refStatusText(block.reference) }}</small>
                </template>
                <small v-else class="sermon-preview-text">{{ textSnippet(block.content) }}</small>
              </template>
              <em v-if="parsedSlides.length > 1" class="sermon-preview-index">第 {{ slideIndex + 1 }} 屏</em>
            </div>
          </div>
          <p class="sermon-hint sermon-shortcut-hint">{{ shortcutHint }}（提交当前输入）· Enter 换行（同一屏）· 演示时 Shift+↑/↓ 滚动一行</p>
        </section>

        <section class="sermon-block">
          <h3>讲道队列<small v-if="queue.length">（{{ queue.length }}）</small></h3>
          <p v-if="!queue.length" class="sermon-hint">队列为空。添加经文或文字后，点击条目进入演示并推送给所有在线成员。</p>
          <div v-for="(item, index) in queue" :key="item.id" class="sermon-queue-item" :class="{ current: item.id === currentItemId }">
            <button class="sermon-queue-main" type="button" @click="enterPresent(item)">
              <span class="sermon-queue-title">
                <em v-if="item.id === currentItemId" class="sermon-live">展示中</em>
                <strong>{{ item.normalizedReference }}</strong>
              </span>
              <small>{{ item.kind === "text" ? "文字" : `${item.verses.length} 节` }}<template v-if="item.annotations.length"> · {{ item.annotations.length }} 处标注</template></small>
            </button>
            <div class="sermon-queue-actions">
              <button class="mini-icon-btn" type="button" :disabled="index === 0" aria-label="上移" @click="moveItem(item.id, -1)"><ArrowUp :size="15" /></button>
              <button class="mini-icon-btn" type="button" :disabled="index === queue.length - 1" aria-label="下移" @click="moveItem(item.id, 1)"><ArrowDown :size="15" /></button>
              <button class="mini-icon-btn" type="button" aria-label="删除" @click="report(sermon.remove(item.id))"><Trash2 :size="15" /></button>
            </div>
          </div>
        </section>

        <section class="sermon-block sermon-queue-controls">
          <h3>演示控制</h3>
          <div class="sermon-present-controls-row">
            <button class="mini-btn secondary" type="button" :disabled="currentIndex <= 0" @click="presentRelative(-1)"><SkipBack :size="15" />上一条</button>
            <button class="mini-btn secondary" type="button" :disabled="currentIndex < 0 || currentIndex >= queue.length - 1" @click="presentRelative(1)">下一条<SkipForward :size="15" /></button>
          </div>
          <SermonDisplayControls :display="display" @update="updateDisplay" />
        </section>

        <footer class="sermon-queue-foot">
          <p v-if="actionError || sermon.statusMessage.value" class="sermon-error" role="alert">{{ actionError || sermon.statusMessage.value }}</p>
          <button v-if="queue.length" class="mini-btn danger-soft" type="button" :disabled="sermon.pending.value" @click="endPresentation">结束展示</button>
        </footer>
      </div>

      <aside class="sermon-preview-column">
        <section class="sermon-preview-block">
          <h3>投影预览</h3>
          <div ref="projectorFrame" class="sermon-preview-frame projector">
            <div class="sermon-preview-scale projector" :style="{ transform: `scale(${projectorScale})` }">
              <div class="sermon-overlay sermon-preview-stage projector" :style="sermonDisplayStyle(display)" v-bind="sermonDisplayAttrs(display)">
                <div class="sermon-overlay-card">
                  <SermonStage :item="currentItem" :presenter-name="sermonState?.presenterName || ''" />
                </div>
              </div>
            </div>
          </div>
        </section>
        <section class="sermon-preview-block">
          <h3>手机预览</h3>
          <div ref="phoneFrame" class="sermon-preview-frame phone">
            <div class="sermon-preview-scale phone" :style="{ transform: `scale(${phoneScale})` }">
              <div class="sermon-overlay sermon-preview-stage phone" :style="sermonDisplayStyle(display)" v-bind="sermonDisplayAttrs(display)">
                <div class="sermon-overlay-card">
                  <SermonStage :item="currentItem" :presenter-name="sermonState?.presenterName || ''" />
                </div>
              </div>
            </div>
          </div>
        </section>
      </aside>
    </main>

    <main v-if="view === 'present'" class="sermon-present-view">
      <div
        v-if="currentItem"
        class="sermon-overlay sermon-present-stage"
        :style="sermonDisplayStyle(display)"
        v-bind="sermonDisplayAttrs(display)"
        @mouseup="handleSelectionMouseup"
      >
        <div class="sermon-overlay-card">
          <SermonStage
            :item="currentItem"
            :presenter-name="sermonState?.presenterName || ''"
            @verse-click="handleVerseClick"
          />
        </div>
        <div v-if="verseMenu" class="sermon-verse-menu" :style="{ left: `${verseMenu.x}px`, top: `${verseMenu.y}px` }">
          <button
            type="button"
            :class="{ active: verseHasAnnotation(currentItem.annotations, verseMenu.verseIndex, 'highlight') }"
            @click="toggleVerseAnnotation('highlight')"
          ><Highlighter :size="14" />高亮</button>
          <button
            type="button"
            :class="{ active: verseHasAnnotation(currentItem.annotations, verseMenu.verseIndex, 'underline') }"
            @click="toggleVerseAnnotation('underline')"
          ><Underline :size="14" />划线</button>
          <button type="button" @click="clearVerseAnnotations"><Eraser :size="14" />取消标记</button>
        </div>
        <button
          v-if="selectionOffer"
          class="sermon-selection-btn"
          type="button"
          :style="{ left: `${selectionOffer.x}px`, top: `${selectionOffer.y}px` }"
          @mousedown.prevent
          @click="annotateSelection"
        ><Underline :size="14" />划线选段</button>
      </div>
      <div v-else class="sermon-present-empty">
        <p>当前没有展示中的经文。</p>
        <button class="primary-btn" type="button" @click="view = 'queue'">返回演示队列选择</button>
      </div>

      <footer class="sermon-present-controls">
        <div v-if="editing" class="sermon-edit-panel">
          <textarea
            v-model="editSource"
            class="sermon-reference-input"
            rows="4"
            maxlength="8000"
            placeholder="按原文编辑本屏：经文出处重新查询，文字原样保留"
            @keydown.esc="editing = false"
          ></textarea>
          <div class="sermon-block-actions">
            <button class="mini-btn secondary" type="button" @click="editing = false">取消</button>
            <button class="primary-btn" type="button" :disabled="sermon.pending.value || !editSource.trim()" @click="saveEdit">保存并推送</button>
          </div>
        </div>
        <SermonDisplayControls :display="display" @update="updateDisplay" />
        <div class="sermon-present-controls-row">
          <button class="mini-btn secondary" type="button" :disabled="currentIndex <= 0" @click="presentRelative(-1)"><SkipBack :size="15" />上一条</button>
          <button class="mini-btn secondary" type="button" :disabled="currentIndex < 0 || currentIndex >= queue.length - 1" @click="presentRelative(1)">下一条<SkipForward :size="15" /></button>
        </div>
        <div class="sermon-present-controls-row">
          <button class="mini-btn secondary" type="button" @click="openEditor"><Pencil :size="14" />编辑本屏</button>
          <button class="mini-btn secondary" type="button" @click="view = 'queue'">返回演示队列</button>
          <button class="mini-btn danger-soft" type="button" :disabled="sermon.pending.value" @click="endPresentation">结束展示</button>
        </div>
        <p class="sermon-hint">Shift+↑/↓ 屏内滚动一行（观众端同步）</p>
        <p v-if="actionError || sermon.statusMessage.value" class="sermon-error" role="alert">{{ actionError || sermon.statusMessage.value }}</p>
      </footer>
    </main>
  </section>
</template>
