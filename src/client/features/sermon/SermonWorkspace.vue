<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ArrowDown, ArrowUp, ChevronRight, Eraser, Highlighter, Plus, SkipBack, SkipForward, Trash2, Underline, X } from "lucide-vue-next";
import type { BibleLookupDTO, SermonAnnotationKind, SermonDisplayDTO, SermonQueueItem } from "@shared/types";
import { api } from "../../api";
import { useChatStore } from "../../store";
import { SERMON_DISPLAY_FALLBACK, sermonDisplayAttrs, sermonDisplayStyle } from "./sermonDisplay";
import { splitSermonReferences, verseHasAnnotation } from "./sermonText";
import SermonDisplayControls from "./SermonDisplayControls.vue";
import SermonStage from "./SermonStage.vue";
import { useSermon, type SermonEmitResult } from "./useSermon";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const store = useChatStore();
const sermon = useSermon({ getSocket: () => store.socket });
const { sermonState, presenterStatus } = sermon;

type ReferencePreview =
  | { reference: string; status: "loading" }
  | { reference: string; status: "ok"; lookup: BibleLookupDTO }
  | { reference: string; status: "error"; message: string };

const view = ref<"queue" | "present">("queue");
const referenceInput = ref("");
const previews = ref<ReferencePreview[]>([]);
const previewing = ref(false);
const adding = ref(false);
const actionError = ref("");
const addKind = ref<"bible" | "text">("bible");
const textTitleInput = ref("");
const textContentInput = ref("");

const queue = computed(() => sermonState.value?.queue || []);
const currentItemId = computed(() => sermonState.value?.currentItemId || null);
const currentItem = computed<SermonQueueItem | null>(() => queue.value.find((item) => item.id === currentItemId.value) || null);
const currentIndex = computed(() => queue.value.findIndex((item) => item.id === currentItemId.value));
const display = computed(() => sermonState.value?.display ?? SERMON_DISPLAY_FALLBACK);

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
    }
  }
);

async function report(result: Promise<SermonEmitResult>) {
  const outcome = await result;
  actionError.value = outcome.ok ? "" : outcome.message || "操作失败";
}

async function previewReferences() {
  const references = splitSermonReferences(referenceInput.value);
  if (!references.length || previewing.value) return;
  previewing.value = true;
  actionError.value = "";
  previews.value = references.map((reference) => ({ reference, status: "loading" }));
  for (let index = 0; index < references.length; index++) {
    const reference = references[index];
    try {
      const result = await api<{ success: boolean; result?: BibleLookupDTO; message?: string }>(
        `/api/bible/lookup?reference=${encodeURIComponent(reference)}`
      );
      previews.value[index] = result.success && result.result
        ? { reference, status: "ok", lookup: result.result }
        : { reference, status: "error", message: result.message || "无法识别该经文出处" };
    } catch (error) {
      previews.value[index] = { reference, status: "error", message: error instanceof Error ? error.message : "查询失败" };
    }
  }
  previewing.value = false;
}

const confirmedPreviews = computed(() => previews.value.filter((preview): preview is Extract<ReferencePreview, { status: "ok" }> => preview.status === "ok"));
const previewErrors = computed(() => previews.value.filter((preview): preview is Extract<ReferencePreview, { status: "error" }> => preview.status === "error"));

async function addToQueue() {
  const references = confirmedPreviews.value.map((preview) => preview.reference);
  if (!references.length || adding.value) return;
  adding.value = true;
  const result = await sermon.add(references);
  adding.value = false;
  if (!result.ok) {
    actionError.value = result.message;
    return;
  }
  referenceInput.value = "";
  previews.value = [];
  if (result.errors?.length) actionError.value = result.errors.map((entry) => `${entry.reference}：${entry.message}`).join("；");
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
  if (item.id !== currentItemId.value) void report(sermon.present(item.id));
}

function presentRelative(direction: -1 | 1) {
  const target = queue.value[currentIndex.value + direction];
  if (target) void report(sermon.present(target.id));
}

function updateDisplay(patch: Partial<SermonDisplayDTO>) {
  void report(sermon.setDisplay(patch));
}

async function addTextToQueue() {
  const content = textContentInput.value.trim();
  if (!content || adding.value) return;
  adding.value = true;
  const result = await sermon.addTexts([{ title: textTitleInput.value.trim() || undefined, content }]);
  adding.value = false;
  if (!result.ok) {
    actionError.value = result.message;
    return;
  }
  textTitleInput.value = "";
  textContentInput.value = "";
}

async function endPresentation() {
  if (!window.confirm("结束展示并清空讲道队列？")) return;
  await report(sermon.clearPresentation());
  view.value = "queue";
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
          <div class="sermon-font-picker sermon-add-kind" role="group" aria-label="添加类型">
            <button type="button" :class="{ active: addKind === 'bible' }" :aria-pressed="addKind === 'bible'" @click="addKind = 'bible'">经文</button>
            <button type="button" :class="{ active: addKind === 'text' }" :aria-pressed="addKind === 'text'" @click="addKind = 'text'">文字</button>
          </div>
          <template v-if="addKind === 'bible'">
            <textarea
              v-model="referenceInput"
              class="sermon-reference-input"
              rows="2"
              placeholder="输入经文出处，多个用逗号、分号或换行分隔，如：约3:16，诗篇23"
            ></textarea>
            <div class="sermon-block-actions">
              <button class="mini-btn secondary" type="button" :disabled="previewing || !splitSermonReferences(referenceInput).length" @click="previewReferences">
                {{ previewing ? "正在查询…" : "预览" }}
              </button>
              <button class="primary-btn" type="button" :disabled="adding || !confirmedPreviews.length" @click="addToQueue">
                <Plus :size="15" />{{ adding ? "正在加入…" : `加入队列${confirmedPreviews.length ? `（${confirmedPreviews.length}）` : ""}` }}
              </button>
            </div>
            <div v-if="previews.length" class="sermon-previews">
              <div v-for="preview in previews" :key="preview.reference" class="sermon-preview" :class="preview.status">
                <template v-if="preview.status === 'ok'">
                  <strong>{{ preview.lookup.normalizedReference }}</strong>
                  <small>{{ preview.lookup.verses.length }} 节 · {{ preview.lookup.verses[0]?.text || "" }}</small>
                </template>
                <template v-else-if="preview.status === 'error'">
                  <strong>{{ preview.reference }}</strong>
                  <small>{{ preview.message }}</small>
                </template>
                <small v-else>正在查询 {{ preview.reference }}…</small>
              </div>
            </div>
            <p v-if="previewErrors.length" class="sermon-hint">有 {{ previewErrors.length }} 条无法识别，确认加入时只会包含可识别的出处。</p>
          </template>
          <template v-else>
            <input v-model="textTitleInput" class="sermon-reference-input sermon-text-title-input" type="text" maxlength="100" placeholder="标题（可选）" />
            <textarea
              v-model="textContentInput"
              class="sermon-reference-input"
              rows="4"
              maxlength="4000"
              placeholder="输入文字内容，空行分段，如大纲、引言或引文"
            ></textarea>
            <div class="sermon-block-actions">
              <button class="primary-btn" type="button" :disabled="adding || !textContentInput.trim()" @click="addTextToQueue">
                <Plus :size="15" />{{ adding ? "正在加入…" : "加入队列" }}
              </button>
            </div>
          </template>
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
        <SermonDisplayControls :display="display" @update="updateDisplay" />
        <div class="sermon-present-controls-row">
          <button class="mini-btn secondary" type="button" :disabled="currentIndex <= 0" @click="presentRelative(-1)"><SkipBack :size="15" />上一条</button>
          <button class="mini-btn secondary" type="button" :disabled="currentIndex < 0 || currentIndex >= queue.length - 1" @click="presentRelative(1)">下一条<SkipForward :size="15" /></button>
        </div>
        <div class="sermon-present-controls-row">
          <button class="mini-btn secondary" type="button" @click="view = 'queue'">返回演示队列</button>
          <button class="mini-btn danger-soft" type="button" :disabled="sermon.pending.value" @click="endPresentation">结束展示</button>
        </div>
        <p v-if="actionError || sermon.statusMessage.value" class="sermon-error" role="alert">{{ actionError || sermon.statusMessage.value }}</p>
      </footer>
    </main>
  </section>
</template>
