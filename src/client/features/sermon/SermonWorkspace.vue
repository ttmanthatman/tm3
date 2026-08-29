<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ArrowDown, ArrowUp, CheckCircle2, ChevronLeft, Eraser, FolderOpen, Highlighter, Pencil, Plus, Save, SkipBack, SkipForward, Trash2, Underline, X } from "lucide-vue-next";
import type { BibleLookupDTO, SermonAnnotationKind, SermonDisplayDTO, SermonPresentationScope, SermonQueueItem, SermonSlideInput } from "@shared/types";
import { api } from "../../api";
import { useChatStore } from "../../store";
import { SERMON_DISPLAY_FALLBACK, sermonDisplayAttrs, sermonDisplayStyle } from "./sermonDisplay";
import { sermonPreviewScale } from "./sermonPreview";
import { nextSermonScrollLine, sermonWheelDirection, type SermonScrollDirection } from "./sermonScroll";
import { verseHasAnnotation } from "./sermonText";
import { sermonBackgroundPaint } from "./sermonThemes";
import { parseSermonInput } from "./sermonInput";
import { allSermonCandidatesSelected, matchingSermonPlan, nextSermonQueueItem } from "./sermonWorkspaceState";
import SermonContextPanel from "./SermonContextPanel.vue";
import SermonDisplayControls from "./SermonDisplayControls.vue";
import SermonStage from "./SermonStage.vue";
import { useSermon, type SermonEmitResult } from "./useSermon";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const store = useChatStore();
const sermon = useSermon({ getSocket: () => store.socket });
const { ownedState: sermonState, presenterStatus, directory, watchAccounts, plans } = sermon;

const accountId = computed(() => store.account?.id ?? null);
/** 本人是否持有进行中的演示（目录以 presenterId=账号 ID 区分并发演示）。 */
const ownSummary = computed(() => directory.value.find((entry) => entry.presenterId === accountId.value) || null);
const hasOwnPresentation = computed(() => ownSummary.value !== null);

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
const nextItem = computed(() => nextSermonQueueItem(queue.value, currentItemId.value));
const display = computed(() => sermonState.value?.display ?? SERMON_DISPLAY_FALLBACK);

const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
const shortcutHint = computed(() => (isMac ? "⌘+Enter 加入队列" : "Ctrl+Enter 加入队列"));

// 桌面端双预览（投影 1280×720、手机 390×845 基准尺寸）：按容器宽度等比缩放真实舞台。
const PREVIEW_PROJECTOR_BASE_WIDTH = 1280;
const PREVIEW_PROJECTOR_BASE_HEIGHT = 720;
const PREVIEW_PHONE_BASE_WIDTH = 390;
const PREVIEW_PHONE_BASE_HEIGHT = 845;
const projectorFrame = ref<HTMLElement | null>(null);
const phoneFrame = ref<HTMLElement | null>(null);
const nextFrame = ref<HTMLElement | null>(null);
const projectorScale = ref(0.3);
const phoneScale = ref(0.3);
const nextScale = ref(0.3);
let previewObserver: ResizeObserver | null = null;

function updatePreviewScales() {
  const projector = projectorFrame.value;
  if (projector) {
    const next = sermonPreviewScale(projector.clientWidth, projector.clientHeight, PREVIEW_PROJECTOR_BASE_WIDTH, PREVIEW_PROJECTOR_BASE_HEIGHT);
    if (next > 0) projectorScale.value = next;
  }
  const phone = phoneFrame.value;
  if (phone) {
    const next = sermonPreviewScale(phone.clientWidth, phone.clientHeight, PREVIEW_PHONE_BASE_WIDTH, PREVIEW_PHONE_BASE_HEIGHT);
    if (next > 0) phoneScale.value = next;
  }
  const following = nextFrame.value;
  if (following) {
    const next = sermonPreviewScale(following.clientWidth, following.clientHeight, PREVIEW_PROJECTOR_BASE_WIDTH, PREVIEW_PROJECTOR_BASE_HEIGHT);
    if (next > 0) nextScale.value = next;
  }
}

function reconnectPreviewObserver() {
  if (!previewObserver) return;
  previewObserver.disconnect();
  if (projectorFrame.value) previewObserver.observe(projectorFrame.value);
  if (phoneFrame.value) previewObserver.observe(phoneFrame.value);
  if (nextFrame.value) previewObserver.observe(nextFrame.value);
  updatePreviewScales();
}

onMounted(() => {
  previewObserver = new ResizeObserver(updatePreviewScales);
  reconnectPreviewObserver();
});

// 预览只在演示创建后挂载；监听 template refs，避免 onMounted 时为空而永远停在 0.3×。
watch([projectorFrame, phoneFrame, nextFrame], reconnectPreviewObserver, { flush: "post" });

onBeforeUnmount(() => previewObserver?.disconnect());

const presenterUntilText = computed(() => {
  const status = presenterStatus.value;
  if (!status) return "";
  if (!status.canPresent) return "当前没有讲道权限";
  if (status.isAdmin) return "管理员可直接发起全体演示";
  return status.until ? `讲道权限有效期至 ${new Date(status.until).toLocaleString("zh-CN", { hour12: false })}` : "讲道权限长期有效";
});

// 演示被结束后回到队列屏，由开始屏接管。
watch(hasOwnPresentation, (has) => {
  if (!has) {
    view.value = "queue";
    verseMenu.value = null;
    selectionOffer.value = null;
    editing.value = false;
  }
});

// —— 开始屏：范围选择 + 观众选择器 + 开始演示 ——

const startScope = ref<SermonPresentationScope>("group");
const selectedInviteIds = ref<number[]>([]);
const selectedMoreInviteIds = ref<number[]>([]);
const startError = ref("");
const accountsError = ref("");

/** 观众选择器条目：在线优先、按名称排序，排除本人。 */
const selectableAccounts = computed(() =>
  watchAccounts.value
    .filter((account) => account.id !== accountId.value)
    .slice()
    .sort((a, b) => Number(b.online) - Number(a.online) || a.displayName.localeCompare(b.displayName, "zh-CN"))
);

/** 演示中的当前观众（以本人演示入座者）。 */
const currentViewers = computed(() => watchAccounts.value.filter((account) => account.seatedPresentation === accountId.value));

/** 可继续邀请的账号（未入座任何演示）。 */
const inviteCandidates = computed(() => selectableAccounts.value.filter((account) => account.seatedPresentation === null));
const inviteCandidateIds = computed(() => inviteCandidates.value.map((account) => account.id));
const allInviteCandidatesChecked = computed(() =>
  allSermonCandidatesSelected(inviteCandidateIds.value, selectedMoreInviteIds.value)
);
const someInviteCandidatesChecked = computed(() =>
  selectedMoreInviteIds.value.some((id) => inviteCandidateIds.value.includes(id)) && !allInviteCandidatesChecked.value
);
const currentScopeLabel = computed(() => sermonState.value?.scope === "assembly" ? "全员集会" : "小组演示");

async function loadAudienceData() {
  accountsError.value = "";
  try {
    await sermon.refreshPresenterStatus();
    // 观众列表接口需要讲道授权；无授权账号以小组模式演示，不展示观众管理。
    if (presenterStatus.value?.canPresent) await sermon.refreshWatchAccounts();
    else watchAccounts.value = [];
  } catch (error) {
    accountsError.value = error instanceof Error ? error.message : "观众列表加载失败";
  }
}

// 关闭工作区后回到队列屏；首次挂载为 open=true 时也必须在状态声明完成后加载数据。
watch(
  () => props.open,
  (open) => {
    if (!open) {
      view.value = "queue";
      verseMenu.value = null;
      selectionOffer.value = null;
      editing.value = false;
      return;
    }
    void loadAudienceData();
    void sermon.refreshPlans().catch(() => undefined);
  },
  { immediate: true }
);

// 观众人数随目录推送变化，打开工作区时联动刷新观众名单。
watch(
  () => ownSummary.value?.audienceCount,
  () => {
    if (props.open && hasOwnPresentation.value && presenterStatus.value?.canPresent) {
      void sermon.refreshWatchAccounts().catch((error: unknown) => {
        accountsError.value = error instanceof Error ? error.message : "观众列表加载失败";
      });
    }
  }
);

async function startPresentation() {
  startError.value = "";
  const invitedAccountIds = startScope.value === "group" ? selectedInviteIds.value : [];
  const result = await sermon.start(startScope.value, invitedAccountIds);
  if (!result.ok) {
    startError.value = result.message;
    return;
  }
  selectedInviteIds.value = [];
  void loadAudienceData();
}

// —— 可复用的命名讲道方案 ——

const planTitle = ref("");
const planBusyId = ref<string | null>(null);
const matchingPlan = computed(() => matchingSermonPlan(plans.value, queue.value, display.value));

async function saveNewPlan() {
  const title = planTitle.value.trim();
  if (!title) {
    actionError.value = "请输入方案名称";
    return;
  }
  planBusyId.value = "new";
  const result = await sermon.savePlan(title);
  planBusyId.value = null;
  actionError.value = result.ok ? `已保存“${title}”` : result.message;
  if (result.ok) planTitle.value = "";
}

async function overwritePlan(id: string, title: string) {
  if (!window.confirm(`用当前队列覆盖“${title}”？`)) return;
  planBusyId.value = id;
  const result = await sermon.savePlan(title, id);
  planBusyId.value = null;
  actionError.value = result.ok ? `已更新“${title}”` : result.message;
}

async function loadSavedPlan(id: string, title: string) {
  if (sermonState.value?.active && !window.confirm(`当前正在展示。载入“${title}”会停止当前画面并替换队列，继续吗？`)) return;
  if (!sermonState.value?.active && queue.value.length && !window.confirm(`载入“${title}”会替换当前队列，继续吗？`)) return;
  planBusyId.value = id;
  const result = await sermon.loadPlan(id);
  planBusyId.value = null;
  actionError.value = result.ok ? `已载入“${title}”` : result.message;
  if (result.ok) view.value = "queue";
}

async function deleteSavedPlan(id: string, title: string) {
  if (!window.confirm(`删除已保存的“${title}”？当前队列不受影响。`)) return;
  planBusyId.value = id;
  const result = await sermon.deletePlan(id);
  planBusyId.value = null;
  actionError.value = result.ok ? "已删除保存方案" : result.message;
}

function formatPlanTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("zh-CN", { hour12: false });
}

async function inviteMore() {
  if (!selectedMoreInviteIds.value.length) return;
  const result = await sermon.invite(selectedMoreInviteIds.value);
  actionError.value = result.ok ? "邀请已发送" : result.message;
  if (result.ok) selectedMoreInviteIds.value = [];
}

function toggleAllInviteCandidates(event: Event) {
  const checked = (event.target as HTMLInputElement).checked;
  selectedMoreInviteIds.value = checked ? inviteCandidateIds.value.slice() : [];
}

async function report(result: Promise<SermonEmitResult>) {
  const outcome = await result;
  actionError.value = outcome.ok ? "" : outcome.message || "操作失败";
  return outcome;
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
  if (!window.confirm("退出当前讲道台并清空当前队列？已保存的讲道方案不会删除。")) return;
  await report(sermon.end());
  view.value = "queue";
}

// —— 当前屏屏内滚动（桌面预览与移动演示视图共用，位置同步给观众端） ——

function presentMaxScrollLines(): number {
  // 桌面端的演示视图会被 CSS 隐藏，应以实际可见的投影预览计算；移动端则回退到演示舞台。
  const previewBody = projectorFrame.value?.querySelector<HTMLElement>(".sermon-overlay-body");
  const body = previewBody && projectorFrame.value?.clientHeight ? previewBody : document.querySelector<HTMLElement>(".sermon-present-stage .sermon-overlay-body");
  const passage = body?.querySelector<HTMLElement>(".sermon-passage");
  if (!body || !passage) return 0;
  const lineHeight = Number.parseFloat(getComputedStyle(passage).lineHeight) || passage.getBoundingClientRect().height;
  if (!lineHeight) return 0;
  return Math.ceil((body.scrollHeight - body.clientHeight) / lineHeight);
}

let pendingScroll: { itemId: string; lines: number } | null = null;
let requestedScroll: { itemId: string; lines: number } | null = null;
let scrollTimer: ReturnType<typeof setTimeout> | null = null;

async function flushPendingScroll() {
  scrollTimer = null;
  const target = pendingScroll;
  pendingScroll = null;
  if (!target) return;
  const outcome = await report(sermon.scroll(target.itemId, target.lines));
  if (!outcome.ok && requestedScroll?.itemId === target.itemId) {
    requestedScroll = null;
    pendingScroll = null;
    return;
  }
  if (pendingScroll && !scrollTimer) {
    scrollTimer = setTimeout(flushPendingScroll, 0);
  } else {
    const item = currentItem.value;
    requestedScroll = item ? { itemId: item.id, lines: item.scrollLines === target.lines ? item.scrollLines : target.lines } : null;
  }
}

function requestScroll(direction: SermonScrollDirection, delay = 0): boolean {
  const item = currentItem.value;
  const maxLines = presentMaxScrollLines();
  if (!item || maxLines <= 0) return false;
  const current = requestedScroll?.itemId === item.id ? requestedScroll.lines : (item.scrollLines ?? 0);
  const next = nextSermonScrollLine(current, maxLines, direction);
  if (next === current) return false;
  requestedScroll = pendingScroll = { itemId: item.id, lines: next };
  if (scrollTimer) clearTimeout(scrollTimer);
  scrollTimer = setTimeout(flushPendingScroll, delay);
  return true;
}

function handlePresentKeydown(event: KeyboardEvent) {
  if (!hasOwnPresentation.value || !event.shiftKey) return;
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
  const target = event.target as HTMLElement | null;
  if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable)) return;
  if (requestScroll(event.key === "ArrowDown" ? 1 : -1)) event.preventDefault();
}

function handlePreviewWheel(event: WheelEvent) {
  const direction = sermonWheelDirection(event.deltaY);
  if (direction && requestScroll(direction, 60)) event.preventDefault();
}

onMounted(() => window.addEventListener("keydown", handlePresentKeydown));
onBeforeUnmount(() => {
  window.removeEventListener("keydown", handlePresentKeydown);
  if (scrollTimer) clearTimeout(scrollTimer);
});

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
      <button class="sermon-topbar-button" type="button" @click="emit('close')"><ChevronLeft :size="20" />聊天</button>
      <div class="sermon-workspace-title">
        <strong>讲道台</strong>
        <small v-if="presenterUntilText">{{ presenterUntilText }}</small>
      </div>
    </header>

    <main v-if="hasOwnPresentation" class="sermon-workspace-body sermon-queue-view" :class="{ 'mobile-hidden': view !== 'queue' }">
      <div class="sermon-queue-column">
        <section class="sermon-block">
          <h3>保存讲道方案</h3>
          <div class="sermon-plan-save-row">
            <input v-model="planTitle" maxlength="80" placeholder="例如：8月30日分享" @keydown.enter.prevent="saveNewPlan" />
            <button class="primary-btn" type="button" :disabled="planBusyId !== null" @click="saveNewPlan">
              <Save :size="15" />{{ matchingPlan ? "另存当前队列" : "保存当前队列" }}
            </button>
          </div>
          <p v-if="matchingPlan" class="sermon-plan-status saved" role="status">
            <CheckCircle2 :size="15" />当前队列已保存为“{{ matchingPlan.title }}”<template v-if="formatPlanTime(matchingPlan.updatedAt)"> · {{ formatPlanTime(matchingPlan.updatedAt) }}</template>
          </p>
          <p v-else-if="plans.length" class="sermon-plan-status">当前队列尚未保存，或已有未保存更改。</p>
          <p v-if="!plans.length" class="sermon-hint">保存后可随时载入，提前准备的经文、文字、顺序、标注和显示样式都会保留。</p>
          <div v-else class="sermon-plan-list">
            <article v-for="plan in plans" :key="plan.id" class="sermon-plan-row">
              <span>
                <strong>{{ plan.title }}</strong>
                <small>{{ plan.queue.length }} 屏<template v-if="formatPlanTime(plan.updatedAt)"> · {{ formatPlanTime(plan.updatedAt) }}</template></small>
              </span>
              <div>
                <button class="mini-btn secondary" type="button" :disabled="planBusyId !== null" @click="loadSavedPlan(plan.id, plan.title)"><FolderOpen :size="14" />载入</button>
                <button class="mini-btn secondary" type="button" :disabled="planBusyId !== null" @click="overwritePlan(plan.id, plan.title)">覆盖</button>
                <button class="mini-icon-btn" type="button" :disabled="planBusyId !== null" aria-label="删除保存方案" @click="deleteSavedPlan(plan.id, plan.title)"><Trash2 :size="14" /></button>
              </div>
            </article>
          </div>
        </section>

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
              <span>
                每处经文一屏
                <small>自动把内容中的经文分割到队列，每处经文作为一页幻灯片展示。</small>
              </span>
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
          <p v-if="!queue.length" class="sermon-hint">队列为空。添加经文或文字后，点击条目进入演示并推送给已入座的观众。</p>
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

        <section v-if="presenterStatus?.canPresent" class="sermon-block">
          <h3 class="sermon-audience-heading">
            <span>观众<small v-if="currentViewers.length">（{{ currentViewers.length }}）</small></span>
            <small class="sermon-scope-status">当前：{{ currentScopeLabel }}</small>
          </h3>
          <p v-if="accountsError" class="sermon-error" role="alert">{{ accountsError }}</p>
          <template v-else>
            <p v-if="!currentViewers.length" class="sermon-hint">暂无观众入座。</p>
            <div v-for="viewer in currentViewers" :key="viewer.id" class="sermon-viewer-row">
              <i class="sermon-online-dot" :class="{ online: viewer.online }" aria-hidden="true"></i>
              <span class="sermon-audience-name">{{ viewer.displayName }}</span>
              <button class="mini-btn secondary" type="button" @click="report(sermon.removeViewer(viewer.id))">移除</button>
            </div>
            <p v-if="sermonState?.scope === 'assembly'" class="sermon-hint">当前为全员集会，所有成员都可直接观看，无需逐个邀请。</p>
            <details v-else-if="inviteCandidates.length" class="sermon-invite-more">
              <summary>邀请更多观众</summary>
              <label class="sermon-audience-row sermon-audience-select-all">
                <input
                  type="checkbox"
                  :checked="allInviteCandidatesChecked"
                  :indeterminate="someInviteCandidatesChecked"
                  @change="toggleAllInviteCandidates"
                />
                <strong>全选（{{ inviteCandidates.length }} 人）</strong>
              </label>
              <label v-for="account in inviteCandidates" :key="account.id" class="sermon-audience-row">
                <input v-model="selectedMoreInviteIds" type="checkbox" :value="account.id" />
                <i class="sermon-online-dot" :class="{ online: account.online }" aria-hidden="true"></i>
                <span class="sermon-audience-name">{{ account.displayName }}</span>
              </label>
              <button class="mini-btn secondary" type="button" :disabled="!selectedMoreInviteIds.length" @click="inviteMore">发出邀请</button>
            </details>
          </template>
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
          <button class="mini-btn danger-soft" type="button" :disabled="sermon.pending.value" @click="endPresentation">退出并重新选择模式</button>
        </footer>
      </div>

      <aside class="sermon-preview-column">
        <div class="sermon-preview-grid">
          <section class="sermon-preview-block projector-preview">
            <h3>投影预览</h3>
            <div ref="projectorFrame" class="sermon-preview-frame projector" :style="{ background: sermonBackgroundPaint(display.background) }" @wheel="handlePreviewWheel">
              <div class="sermon-preview-scale projector" :style="{ transform: `scale(${projectorScale})` }">
                <div class="sermon-overlay sermon-preview-stage projector" :style="sermonDisplayStyle(display)" v-bind="sermonDisplayAttrs(display)">
                  <div class="sermon-overlay-card">
                    <SermonStage :item="currentItem" :presenter-name="sermonState?.presenterName || ''" />
                  </div>
                </div>
              </div>
            </div>
          </section>
          <section class="sermon-preview-block phone-preview">
            <h3>手机预览</h3>
            <div ref="phoneFrame" class="sermon-preview-frame phone" :style="{ background: sermonBackgroundPaint(display.background) }" @wheel="handlePreviewWheel">
              <div class="sermon-preview-scale phone" :style="{ transform: `scale(${phoneScale})` }">
                <div class="sermon-overlay sermon-preview-stage phone" :style="sermonDisplayStyle(display)" v-bind="sermonDisplayAttrs(display)">
                  <div class="sermon-overlay-card">
                    <SermonStage :item="currentItem" :presenter-name="sermonState?.presenterName || ''" />
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
        <section class="sermon-preview-block sermon-next-preview">
          <h3>下一页</h3>
          <div
            v-if="nextItem"
            ref="nextFrame"
            class="sermon-preview-frame projector"
            :style="{ background: sermonBackgroundPaint(display.background) }"
          >
            <div class="sermon-preview-scale projector" :style="{ transform: `scale(${nextScale})` }">
              <div class="sermon-overlay sermon-preview-stage projector" :style="sermonDisplayStyle(display)" v-bind="sermonDisplayAttrs(display)">
                <div class="sermon-overlay-card">
                  <SermonStage :item="nextItem" :presenter-name="sermonState?.presenterName || ''" />
                </div>
              </div>
            </div>
          </div>
          <p v-else class="sermon-next-empty">已经是最后一页</p>
        </section>
        <section class="sermon-preview-block sermon-context-preview">
          <SermonContextPanel :verses="currentItem?.verses || []" compact />
        </section>
      </aside>
    </main>

    <main v-else class="sermon-workspace-body sermon-start-view">
      <section class="sermon-block sermon-start-block">
        <h3>进入自己的讲道台</h3>
        <p class="sermon-hint">可先进入并准备、保存讲道内容；只有开始展示某一屏后，获准的观众才会看到正在讲道通知。</p>
        <div class="sermon-scope-options" role="radiogroup" aria-label="演示范围">
          <label class="sermon-scope-option" :class="{ active: startScope === 'group' }">
            <input v-model="startScope" type="radio" value="group" />
            <span>
              <strong>小组演示</strong>
              <small>邀请特定账号观看，任何成员都可发起</small>
            </span>
          </label>
          <label class="sermon-scope-option" :class="{ active: startScope === 'assembly', disabled: presenterStatus !== null && !presenterStatus.canPresent }">
            <input v-model="startScope" type="radio" value="assembly" :disabled="presenterStatus !== null && !presenterStatus.canPresent" />
            <span>
              <strong>全体演示</strong>
              <small v-if="presenterStatus === null">正在确认账号权限…</small>
              <small v-else-if="presenterStatus.isAdmin">管理员可直接发起，全站成员均可观看</small>
              <small v-else>{{ presenterStatus.canPresent ? "全站成员均可观看" : "需申请讲道授权后可用" }}</small>
            </span>
          </label>
        </div>
        <template v-if="startScope === 'group' && presenterStatus?.canPresent">
          <h4 class="sermon-audience-title">邀请观众（可选）</h4>
          <p v-if="accountsError" class="sermon-error" role="alert">{{ accountsError }}</p>
          <div v-else class="sermon-audience-list">
            <label
              v-for="account in selectableAccounts"
              :key="account.id"
              class="sermon-audience-row"
              :class="{ disabled: account.seatedPresentation !== null }"
            >
              <input v-model="selectedInviteIds" type="checkbox" :value="account.id" :disabled="account.seatedPresentation !== null" />
              <i class="sermon-online-dot" :class="{ online: account.online }" aria-hidden="true"></i>
              <span class="sermon-audience-name">{{ account.displayName }}</span>
              <small v-if="account.seatedPresentation !== null" class="sermon-audience-note">观看其他演示中</small>
              <small v-else-if="!account.online" class="sermon-audience-note">离线</small>
            </label>
            <p v-if="!selectableAccounts.length" class="sermon-hint">暂无其他成员可选。</p>
          </div>
        </template>
        <div class="sermon-start-actions">
          <button class="primary-btn" type="button" :disabled="sermon.pending.value" @click="startPresentation">
            {{ sermon.pending.value ? "正在进入…" : "进入自己的讲道台" }}
          </button>
          <p v-if="startError" class="sermon-error" role="alert">{{ startError }}</p>
        </div>
      </section>
    </main>

    <main v-if="hasOwnPresentation && view === 'present'" class="sermon-present-view">
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

<style scoped>
.sermon-start-view {
  align-content: center;
}

.sermon-start-block {
  width: min(560px, 100%);
  margin: 0 auto;
}

.sermon-scope-options {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.sermon-scope-option {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 12px;
  cursor: pointer;
}

.sermon-scope-option.active {
  border-color: var(--accent);
}

.sermon-scope-option.disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.sermon-scope-option > span {
  display: flex;
  flex-direction: column;
}

.sermon-scope-option small {
  color: var(--muted);
}

.sermon-audience-title {
  margin: 16px 0 8px;
  font-size: 14px;
}

.sermon-audience-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.sermon-scope-status {
  padding: 3px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent);
  font-weight: 600;
}

.sermon-audience-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 240px;
  overflow-y: auto;
}

.sermon-audience-row,
.sermon-viewer-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
}

.sermon-audience-row {
  cursor: pointer;
}

.sermon-audience-row.disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.sermon-audience-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sermon-audience-note {
  flex: none;
  color: var(--muted);
  font-size: 12px;
}

.sermon-online-dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--line);
}

.sermon-online-dot.online {
  background: var(--accent);
}

.sermon-viewer-row .mini-btn {
  flex: none;
}

.sermon-invite-more {
  margin-top: 10px;
}

.sermon-invite-more summary {
  cursor: pointer;
  color: var(--accent);
  font-size: 13px;
}

.sermon-invite-more .sermon-audience-row {
  margin-top: 6px;
}

.sermon-audience-select-all {
  padding-bottom: 6px;
  border-bottom: 1px solid var(--line);
}

.sermon-invite-more .mini-btn {
  margin-top: 8px;
}

.sermon-start-actions {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
}

.sermon-plan-save-row,
.sermon-plan-row,
.sermon-plan-row > div {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sermon-plan-save-row input,
.sermon-plan-row > span {
  flex: 1;
  min-width: 0;
}

.sermon-plan-row {
  padding: 9px 0;
  border-top: 1px solid var(--line);
}

.sermon-plan-row > span {
  display: flex;
  flex-direction: column;
}

.sermon-plan-row small {
  color: var(--muted);
}

.sermon-plan-status {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 8px 0 0;
  color: var(--muted);
  font-size: 13px;
}

.sermon-plan-status.saved {
  color: var(--accent);
}

.sermon-one-per-slide > span {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sermon-one-per-slide small {
  color: var(--muted);
  font-weight: 400;
}

.sermon-next-preview {
  margin-top: 18px;
}

.sermon-context-preview {
  margin-top: 18px;
}

.sermon-next-empty {
  margin: 0;
  padding: 22px;
  border: 1px dashed var(--line);
  border-radius: 10px;
  color: var(--muted);
  text-align: center;
}

@media (max-width: 560px) {
  .sermon-input-options {
    align-items: stretch;
    flex-direction: column;
  }

  .sermon-input-options .primary-btn {
    align-self: flex-end;
  }

  .sermon-plan-save-row,
  .sermon-plan-row {
    align-items: stretch;
    flex-direction: column;
  }

  .sermon-plan-row > div {
    flex-wrap: wrap;
  }
}
</style>
