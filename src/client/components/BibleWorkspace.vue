<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Bookmark, BookmarkCheck, BookOpen, ChevronRight, ClipboardCopy, Columns2, History, Home, PanelsTopLeft, Plus, Rows2, Search, Send, Sparkles, Trash2 } from "lucide-vue-next";
import type {
  BibleBookCatalogDTO,
  BibleCatalogDTO,
  BibleFavoriteDTO,
  BibleFavoriteKeyDTO,
  BibleLookupDTO,
  BibleRelatedSearchDTO,
  BibleTextMatchRangeDTO,
  BibleTextSearchDTO,
  BibleTextSearchItemDTO,
  BibleVerseLineDTO
} from "@shared/types";
import { api } from "../api";
import {
  findBibleTopicHistory,
  loadBibleWorkspaceState,
  mergeBibleTopicResults,
  normalizeBibleSearchQuery,
  saveBibleWorkspaceState,
  upsertBibleSearchHistory,
  type BibleReaderTarget,
  type BiblePaneLocationState,
  type BiblePaneState,
  type BibleSearchHistoryEntry,
  type BibleWorkspaceSearchMode,
  type BibleWorkspaceState,
  type BibleWorkspaceView
} from "../bibleWorkspaceState";
import BibleReaderPane from "./BibleReaderPane.vue";
import {
  MAX_BIBLE_PANES,
  biblePaneLabel,
  equalBiblePaneSizes,
  resolveBibleLinkTargetPaneId,
  resizeBiblePanePair,
  type BibleSplitOrientation
} from "../bibleSplitLayout";
import {
  formatBibleLookupsForCopy,
  formatBibleVersesForCopy
} from "../bibleVerseActions";
import { groupBibleFavoritePassages, type BibleFavoritePassage } from "../bibleFavorites";

const props = defineProps<{
  open: boolean;
  accountId: number;
  channelName: string;
  canSend: boolean;
  sendUnavailableReason: string;
  sendPassage: (lookup: BibleLookupDTO) => Promise<void>;
  favorites: BibleFavoriteDTO[];
  favoritesBusy: boolean;
  updateFavorites: (verses: BibleFavoriteKeyDTO[], favorited: boolean, color?: string) => Promise<void>;
}>();

const emit = defineEmits<{
  close: [];
  "reading-change": [activity: { active: boolean; bookName: string | null }];
}>();

type BibleReaderPaneExpose = {
  openLookup: (lookup: BibleLookupDTO, pushCurrent?: boolean) => Promise<void>;
  openLocation: (location: BiblePaneLocationState, pushCurrent?: boolean) => Promise<void>;
  snapshot: () => BiblePaneState;
};

type TextSegment = { text: string; highlighted: boolean };

const catalog = ref<BibleCatalogDTO | null>(null);
const catalogBusy = ref(false);
const catalogError = ref("");
const view = ref<BibleWorkspaceView>("home");
const homeSection = ref<"catalog" | "search" | "favorites">("catalog");
const searchMode = ref<BibleWorkspaceSearchMode>("topic");
const topicQuery = ref("");
const textQuery = ref("");
const topicResult = ref<BibleRelatedSearchDTO | null>(null);
const textResult = ref<BibleTextSearchDTO | null>(null);
const topicBusy = ref(false);
const textBusy = ref(false);
const topicError = ref("");
const textError = ref("");
const selectedBook = ref<BibleBookCatalogDTO | null>(null);
const panes = ref<BiblePaneState[]>([]);
const activePaneId = ref<string | null>(null);
const receivingPaneId = ref<string | null>(null);
const splitOrientation = ref<BibleSplitOrientation | null>(null);
const paneSizes = ref<number[]>([100]);
const viewportWidth = ref(typeof window === "undefined" ? 1280 : window.innerWidth);
const paneRefs = new Map<string, BibleReaderPaneExpose>();
const splitContainer = ref<HTMLElement | null>(null);
let paneSequence = 0;
let separatorDrag: { index: number; start: number; sizes: number[]; extent: number } | null = null;
const minBibleFontSize = 16;
const maxBibleFontSize = 40;
const defaultBibleFontSize = 20;
const bibleFontSize = ref(defaultBibleFontSize);
const showBibleFontMenu = ref(false);
const searchHistory = ref<BibleSearchHistoryEntry[]>([]);
const sendBusyKey = ref("");
const toast = ref("");
let toastTimer = 0;
let persistTimer = 0;
let catalogLoadPromise: Promise<void> | null = null;
let componentMounted = false;
let stateRestored = false;
let swipeStart: { x: number; y: number } | null = null;
let catalogPreloadTimer = 0;

function clampBibleFontSize(value: number) {
  if (!Number.isFinite(value)) return defaultBibleFontSize;
  return Math.min(maxBibleFontSize, Math.max(minBibleFontSize, Math.round(value)));
}

function bibleFontSizeStorageKey(accountId: number) {
  return `team-chat-bible-font-size:${accountId}`;
}

function loadBibleFontSize(accountId: number) {
  const saved = localStorage.getItem(bibleFontSizeStorageKey(accountId));
  bibleFontSize.value = saved ? clampBibleFontSize(Number(saved)) : defaultBibleFontSize;
}

function adjustBibleFontSize(delta: number) {
  bibleFontSize.value = clampBibleFontSize(bibleFontSize.value + delta);
}

watch(() => props.accountId, loadBibleFontSize, { immediate: true });
watch(bibleFontSize, (value) => {
  const clamped = clampBibleFontSize(value);
  if (clamped !== value) {
    bibleFontSize.value = clamped;
    return;
  }
  localStorage.setItem(bibleFontSizeStorageKey(props.accountId), String(clamped));
});

const allBooks = computed(() => [...(catalog.value?.oldTestament || []), ...(catalog.value?.newTestament || [])]);
const favoritePassages = computed(() => groupBibleFavoritePassages(props.favorites));
const textHasMore = computed(() => !!textResult.value && textResult.value.items.length < textResult.value.total);
const textModeLabel = computed(() => textResult.value?.mode === "allTerms" ? "多关键词匹配" : "连续原文匹配");
const matchingTopicHistory = computed(() => findBibleTopicHistory(searchHistory.value, topicQuery.value));
const readingBookName = computed(() => {
  if (view.value === "reader") return panes.value.find((pane) => pane.id === activePaneId.value)?.book.name || panes.value[0]?.book.name || null;
  if (view.value === "chapters") return selectedBook.value?.name || null;
  return null;
});
const effectiveSplitOrientation = computed<BibleSplitOrientation>(() => splitOrientation.value || (viewportWidth.value <= 700 ? "rows" : "columns"));
const splitGridStyle = computed(() => {
  const tracks = paneSizes.value.map((size) => `minmax(0, ${size}fr)`).join(" 8px ");
  return effectiveSplitOrientation.value === "columns"
    ? { gridTemplateColumns: tracks, gridTemplateRows: "minmax(0, 1fr)" }
    : { gridTemplateRows: tracks, gridTemplateColumns: "minmax(0, 1fr)" };
});

watch(
  [() => props.open, readingBookName],
  ([open, bookName]) => emit("reading-change", { active: open, bookName: open ? bookName : null }),
  { immediate: true }
);

watch(
  () => props.open,
  (open) => {
    if (open) {
      view.value = "home";
      homeSection.value = "catalog";
      selectedBook.value = null;
      void ensureCatalog();
    }
  },
  { immediate: true }
);

watch(
  () => props.accountId,
  (accountId, previousAccountId) => {
    if (componentMounted && accountId && accountId !== previousAccountId) {
      void restoreWorkspaceState();
    }
  }
);

watch(
  [view, searchMode, topicQuery, textQuery, topicResult, textResult, selectedBook, panes, activePaneId, receivingPaneId, splitOrientation, paneSizes, searchHistory],
  scheduleWorkspacePersistence,
  { deep: true }
);

function handleWorkspacePointerDown(event: PointerEvent) {
  const target = event.target instanceof Element ? event.target : null;
  if (showBibleFontMenu.value && !target?.closest("[data-bible-font-menu]")) {
    showBibleFontMenu.value = false;
  }
}

onMounted(() => {
  componentMounted = true;
  window.addEventListener("pagehide", persistWorkspaceState);
  document.addEventListener("pointerdown", handleWorkspacePointerDown);
  window.addEventListener("resize", handleViewportResize);
  void restoreWorkspaceState();
  catalogPreloadTimer = window.setTimeout(() => void ensureCatalog(), 500);
});

onBeforeUnmount(() => {
  window.removeEventListener("pagehide", persistWorkspaceState);
  document.removeEventListener("pointerdown", handleWorkspacePointerDown);
  window.removeEventListener("resize", handleViewportResize);
  persistWorkspaceState();
  if (toastTimer) window.clearTimeout(toastTimer);
  if (persistTimer) window.clearTimeout(persistTimer);
  if (catalogPreloadTimer) window.clearTimeout(catalogPreloadTimer);
});

async function restoreWorkspaceState() {
  stateRestored = false;
  resetWorkspaceState();
  const saved = loadBibleWorkspaceState(window.localStorage, props.accountId);
  if (!saved) {
    stateRestored = true;
    return;
  }
  searchMode.value = saved.searchMode === "text" ? "text" : "topic";
  topicQuery.value = saved.topicQuery || "";
  textQuery.value = saved.textQuery || "";
  topicResult.value = saved.topicResult || null;
  textResult.value = saved.textResult || null;
  selectedBook.value = saved.selectedBook || null;
  searchHistory.value = saved.history || [];
  panes.value = saved.panes;
  activePaneId.value = saved.activePaneId;
  receivingPaneId.value = saved.receivingPaneId;
  splitOrientation.value = saved.orientation;
  paneSizes.value = saved.paneSizes;
  paneSequence = saved.panes.reduce((highest, pane) => Math.max(highest, Number(pane.id.match(/(\d+)$/)?.[1] || 0)), 0);
  if (saved.view === "reader" && saved.panes.length) {
    await ensureCatalog();
    view.value = "reader";
  } else view.value = saved.view === "chapters" && saved.selectedBook ? "chapters" : "home";
  stateRestored = true;
}

function resetWorkspaceState() {
  view.value = "home";
  homeSection.value = "catalog";
  searchMode.value = "topic";
  topicQuery.value = "";
  textQuery.value = "";
  topicResult.value = null;
  textResult.value = null;
  selectedBook.value = null;
  panes.value = [];
  activePaneId.value = null;
  receivingPaneId.value = null;
  splitOrientation.value = null;
  paneSizes.value = [100];
  searchHistory.value = [];
}

function scheduleWorkspacePersistence() {
  if (!stateRestored || !props.accountId) return;
  if (persistTimer) window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(persistWorkspaceState, 180);
}

function persistWorkspaceState() {
  if (!stateRestored || !props.accountId) return;
  const currentPanes = panes.value.map((pane) => paneRefs.get(pane.id)?.snapshot() || pane);
  const state: BibleWorkspaceState = {
    version: 2,
    view: view.value,
    searchMode: searchMode.value,
    topicQuery: topicQuery.value,
    textQuery: textQuery.value,
    topicResult: topicResult.value,
    textResult: textResult.value,
    selectedBook: selectedBook.value,
    panes: currentPanes,
    activePaneId: activePaneId.value,
    receivingPaneId: receivingPaneId.value,
    orientation: splitOrientation.value,
    paneSizes: paneSizes.value,
    history: searchHistory.value
  };
  try {
    saveBibleWorkspaceState(window.localStorage, props.accountId, state);
  } catch {
    // Storage can be unavailable in private browsing; the mounted component still retains state.
  }
}

async function ensureCatalog() {
  if (catalog.value) return;
  if (catalogLoadPromise) {
    await catalogLoadPromise;
    return;
  }
  catalogBusy.value = true;
  catalogError.value = "";
  catalogLoadPromise = api<{ success: boolean; result: BibleCatalogDTO }>("/api/bible/catalog")
    .then((response) => {
      catalog.value = response.result;
    })
    .catch((error) => {
      catalogError.value = error instanceof Error ? error.message : "圣经目录加载失败";
    })
    .finally(() => {
      catalogBusy.value = false;
      catalogLoadPromise = null;
    });
  await catalogLoadPromise;
}

function returnHome() {
  view.value = "home";
  homeSection.value = "catalog";
  selectedBook.value = null;
}

function chooseBook(book: BibleBookCatalogDTO) {
  if (book.chapterCount === 1) {
    void openBookInActivePane(book, 1);
    return;
  }
  selectedBook.value = book;
  view.value = "chapters";
}

async function searchTopic(append = false) {
  const query = topicQuery.value.trim();
  if (query.length < 2 || topicBusy.value) return;
  const historyEntry = findBibleTopicHistory(searchHistory.value, query);
  if (historyEntry && !append) {
    restoreSearchHistory(historyEntry);
    return;
  }
  topicBusy.value = true;
  topicError.value = "";
  try {
    const response = await api<{ success: boolean; result: BibleRelatedSearchDTO }>("/api/bible/related", {
      method: "POST",
      body: JSON.stringify({
        query,
        excludeReferences: append ? historyEntry?.result.results.map((lookup) => lookup.normalizedReference) || [] : []
      })
    });
    topicResult.value = append && historyEntry
      ? mergeBibleTopicResults(historyEntry.result, response.result)
      : response.result;
    recordSearchHistory({ kind: "topic", query, updatedAt: new Date().toISOString(), result: topicResult.value });
  } catch (error) {
    topicError.value = error instanceof Error ? error.message : "主题检索失败";
  } finally {
    topicBusy.value = false;
  }
}

async function searchText(loadMore = false) {
  const query = textQuery.value.trim();
  if (!query || textBusy.value) return;
  textBusy.value = true;
  textError.value = "";
  const extendingCurrentSearch = loadMore
    && normalizeBibleSearchQuery(textResult.value?.query || "") === normalizeBibleSearchQuery(query);
  const offset = extendingCurrentSearch ? textResult.value?.items.length || 0 : 0;
  try {
    const response = await api<{ success: boolean; result: BibleTextSearchDTO }>(
      `/api/bible/search?query=${encodeURIComponent(query)}&offset=${offset}&limit=50`
    );
    textResult.value = extendingCurrentSearch && textResult.value
      ? { ...response.result, items: [...textResult.value.items, ...response.result.items] }
      : response.result;
    recordSearchHistory({ kind: "text", query, updatedAt: new Date().toISOString(), result: textResult.value });
  } catch (error) {
    textError.value = error instanceof Error ? error.message : "文本检索失败";
  } finally {
    textBusy.value = false;
  }
}

function recordSearchHistory(entry: BibleSearchHistoryEntry) {
  searchHistory.value = upsertBibleSearchHistory(searchHistory.value, entry);
}

function restoreSearchHistory(entry: BibleSearchHistoryEntry) {
  view.value = "home";
  if (entry.kind === "topic") {
    searchMode.value = "topic";
    topicQuery.value = entry.query;
    topicResult.value = entry.result;
    topicError.value = "";
  } else {
    searchMode.value = "text";
    textQuery.value = entry.query;
    textResult.value = entry.result;
    textError.value = "";
  }
  recordSearchHistory({ ...entry, updatedAt: new Date().toISOString() });
}

function clearSearchHistory() {
  searchHistory.value = [];
}

function historyResultCount(entry: BibleSearchHistoryEntry) {
  return entry.kind === "topic" ? `${entry.result.results.length} 处` : `${entry.result.total} 节`;
}

function historyTimeLabel(updatedAt: string) {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function bookForVerse(verse: BibleVerseLineDTO) {
  return allBooks.value.find((book) => book.name === verse.book) || null;
}

function openTextResult(item: BibleTextSearchItemDTO) {
  void routeLookup(singleVerseLookup(item.verse), activePaneId.value, item.matches);
}

function openTopicResult(lookup: BibleLookupDTO) {
  void routeLookup(lookup, activePaneId.value);
}

function handleViewportResize() {
  viewportWidth.value = window.innerWidth;
}

function nextPaneId() {
  paneSequence += 1;
  return `bible-pane-${paneSequence}`;
}

function createPaneState(book: BibleBookCatalogDTO, chapter: number, target: BibleReaderTarget | null = null): BiblePaneState {
  return {
    id: nextPaneId(),
    book,
    visibleChapter: chapter,
    targetVerse: target,
    scrollAnchor: null,
    selectedVerseKeys: [],
    selectionAnchorKey: null,
    backStack: []
  };
}

function setPaneRef(paneId: string, element: unknown) {
  if (element) paneRefs.set(paneId, element as BibleReaderPaneExpose);
  else paneRefs.delete(paneId);
}

function updatePaneState(paneId: string, state: BiblePaneState) {
  const index = panes.value.findIndex((pane) => pane.id === paneId);
  if (index < 0) return;
  const next = [...panes.value];
  next[index] = { ...state, id: paneId };
  panes.value = next;
}

async function openBookInActivePane(book: BibleBookCatalogDTO, chapter: number) {
  await ensureCatalog();
  let paneId = activePaneId.value;
  if (!paneId || !panes.value.some((pane) => pane.id === paneId)) {
    const pane = createPaneState(book, chapter);
    panes.value = [pane];
    paneSizes.value = [100];
    activePaneId.value = pane.id;
    paneId = pane.id;
  }
  view.value = "reader";
  await nextTick();
  await paneRefs.get(paneId)?.openLocation({ book, visibleChapter: chapter, targetVerse: null, scrollAnchor: null });
}

async function addBiblePane() {
  if (panes.value.length >= MAX_BIBLE_PANES) return;
  await ensureCatalog();
  const active = activePaneId.value ? paneRefs.get(activePaneId.value)?.snapshot() : null;
  const source = active || panes.value.find((pane) => pane.id === activePaneId.value) || panes.value[0];
  if (!source) {
    const firstBook = allBooks.value[0];
    if (!firstBook) return;
    const firstPane = createPaneState(firstBook, 1);
    const secondPane = createPaneState(firstBook, 1);
    panes.value = [firstPane, secondPane];
    paneSizes.value = equalBiblePaneSizes(2);
    activePaneId.value = secondPane.id;
    view.value = "reader";
    return;
  }
  const pane: BiblePaneState = {
    ...source,
    id: nextPaneId(),
    selectedVerseKeys: [],
    selectionAnchorKey: null,
    backStack: []
  };
  panes.value = [...panes.value, pane];
  paneSizes.value = equalBiblePaneSizes(panes.value.length);
  activePaneId.value = pane.id;
  view.value = "reader";
}

function closeBiblePane(paneId: string) {
  if (panes.value.length <= 1) return;
  const index = panes.value.findIndex((pane) => pane.id === paneId);
  if (index < 0) return;
  const remaining = panes.value.filter((pane) => pane.id !== paneId);
  panes.value = remaining;
  paneSizes.value = equalBiblePaneSizes(remaining.length);
  if (receivingPaneId.value === paneId) receivingPaneId.value = null;
  if (activePaneId.value === paneId) activePaneId.value = remaining[Math.min(index, remaining.length - 1)]?.id || remaining[0]?.id || null;
}

function toggleReceivingPane(paneId: string) {
  receivingPaneId.value = receivingPaneId.value === paneId ? null : paneId;
  activePaneId.value = paneId;
}

function toggleSplitOrientation() {
  splitOrientation.value = effectiveSplitOrientation.value === "columns" ? "rows" : "columns";
}

function beginSeparatorDrag(index: number, event: PointerEvent) {
  const container = splitContainer.value;
  const separator = event.currentTarget as HTMLElement | null;
  if (!container || !separator) return;
  event.preventDefault();
  separator.setPointerCapture(event.pointerId);
  const rect = container.getBoundingClientRect();
  separatorDrag = {
    index,
    start: effectiveSplitOrientation.value === "columns" ? event.clientX : event.clientY,
    sizes: [...paneSizes.value],
    extent: Math.max(1, effectiveSplitOrientation.value === "columns" ? rect.width : rect.height)
  };
}

function moveSeparator(event: PointerEvent) {
  if (!separatorDrag) return;
  const position = effectiveSplitOrientation.value === "columns" ? event.clientX : event.clientY;
  paneSizes.value = resizeBiblePanePair(
    separatorDrag.sizes,
    separatorDrag.index,
    (position - separatorDrag.start) / separatorDrag.extent * 100
  );
}

function finishSeparatorDrag(event: PointerEvent) {
  const separator = event.currentTarget as HTMLElement | null;
  if (separator?.hasPointerCapture(event.pointerId)) separator.releasePointerCapture(event.pointerId);
  separatorDrag = null;
}

function handleSeparatorKey(index: number, event: KeyboardEvent) {
  const negativeKey = effectiveSplitOrientation.value === "columns" ? "ArrowLeft" : "ArrowUp";
  const positiveKey = effectiveSplitOrientation.value === "columns" ? "ArrowRight" : "ArrowDown";
  if (event.key === negativeKey || event.key === positiveKey) {
    event.preventDefault();
    paneSizes.value = resizeBiblePanePair(paneSizes.value, index, event.key === positiveKey ? 2 : -2);
  } else if (event.key === "Home") {
    event.preventDefault();
    paneSizes.value = equalBiblePaneSizes(panes.value.length);
  }
}

async function handlePaneReference(sourcePaneId: string, reference: string) {
  try {
    const response = await api<{ success: boolean; result?: BibleLookupDTO; message?: string }>(
      `/api/bible/lookup?reference=${encodeURIComponent(reference)}`
    );
    if (!response.success || !response.result) throw new Error(response.message || "无法识别这处经文");
    await routeLookup(response.result, sourcePaneId);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "经文跳转失败");
  }
}

async function routeLookup(lookup: BibleLookupDTO, sourcePaneId: string | null, matches: BibleTextMatchRangeDTO[] = []) {
  const first = lookup.verses[0];
  if (!first) return;
  await ensureCatalog();
  const book = bookForVerse(first);
  if (!book) {
    showToast("暂时无法定位这处经文");
    return;
  }
  if (!panes.value.length) {
    const pane = createPaneState(book, first.chapter, {
      chapter: first.chapter,
      verse: first.verse,
      endVerse: first.endVerse,
      matches
    });
    panes.value = [pane];
    activePaneId.value = pane.id;
    paneSizes.value = [100];
    view.value = "reader";
    await nextTick();
    if (matches.length) {
      await paneRefs.get(pane.id)?.openLocation({ book, visibleChapter: first.chapter, targetVerse: pane.targetVerse, scrollAnchor: null }, false);
    } else await paneRefs.get(pane.id)?.openLookup(lookup, false);
    return;
  }
  const ids = panes.value.map((pane) => pane.id);
  const source = sourcePaneId && ids.includes(sourcePaneId) ? sourcePaneId : activePaneId.value || ids[0];
  const targetId = resolveBibleLinkTargetPaneId(ids, source, receivingPaneId.value);
  if (!targetId) return;
  activePaneId.value = targetId;
  view.value = "reader";
  await nextTick();
  if (matches.length) {
    await paneRefs.get(targetId)?.openLocation({
      book,
      visibleChapter: first.chapter,
      targetVerse: { chapter: first.chapter, verse: first.verse, endVerse: first.endVerse, matches },
      scrollAnchor: null
    }, true);
  } else await paneRefs.get(targetId)?.openLookup(lookup, true);
}

async function openLookupContext(lookup: BibleLookupDTO) {
  await routeLookup(lookup, activePaneId.value);
}

defineExpose({ openLookupContext });

function singleVerseLookup(verse: BibleVerseLineDTO): BibleLookupDTO {
  return {
    reference: verse.reference,
    normalizedReference: verse.reference,
    translation: catalog.value?.translation || "新标点和合本（简体）",
    sourceId: catalog.value?.sourceId || "cmn-cu89s",
    verses: [verse]
  };
}

async function writeClipboard(text: string, successMessage: string) {
  if (!text) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement("textarea");
      try {
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        if (!document.execCommand("copy")) throw new Error("copy unavailable");
      } finally {
        textarea.remove();
      }
    }
    showToast(successMessage);
  } catch {
    showToast("复制失败，请检查浏览器剪贴板权限");
  }
}

function copyLookup(lookup: BibleLookupDTO) {
  return writeClipboard(formatBibleLookupsForCopy([lookup], lookup.translation), `已复制 ${lookup.normalizedReference}`);
}

function copyTopicResults() {
  if (!topicResult.value) return;
  return writeClipboard(
    formatBibleLookupsForCopy(topicResult.value.results, catalog.value?.translation || "新标点和合本（简体）"),
    `已复制 ${topicResult.value.results.length} 处结果`
  );
}

function copyTextItem(item: BibleTextSearchItemDTO) {
  return writeClipboard(
    formatBibleVersesForCopy([item.verse], catalog.value?.translation || "新标点和合本（简体）"),
    `已复制 ${item.verse.reference}`
  );
}

function verseSegments(text: string, ranges: BibleTextMatchRangeDTO[]): TextSegment[] {
  const safeRanges = ranges.map((range) => ({
    start: Math.max(0, Math.min(text.length, range.start)),
    end: Math.max(0, Math.min(text.length, range.end))
  })).filter((range) => range.end > range.start).sort((left, right) => left.start - right.start);
  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const range of safeRanges) {
    if (range.start > cursor) segments.push({ text: text.slice(cursor, range.start), highlighted: false });
    if (range.end > cursor) segments.push({ text: text.slice(Math.max(cursor, range.start), range.end), highlighted: true });
    cursor = Math.max(cursor, range.end);
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), highlighted: false });
  return segments.length ? segments : [{ text, highlighted: false }];
}

async function copyAllTextResults() {
  const query = textResult.value?.query;
  if (!query || textBusy.value) return;
  textBusy.value = true;
  try {
    const response = await api<{ success: boolean; result: BibleTextSearchDTO }>(
      `/api/bible/search/export?query=${encodeURIComponent(query)}`
    );
    await writeClipboard(
      formatBibleVersesForCopy(response.result.items.map((item) => item.verse), catalog.value?.translation || "新标点和合本（简体）"),
      `已复制全部 ${response.result.total} 节结果`
    );
  } catch (error) {
    showToast(error instanceof Error ? error.message : "复制全部结果失败");
  } finally {
    textBusy.value = false;
  }
}

async function removeBibleFavoritePassage(passage: BibleFavoritePassage) {
  if (props.favoritesBusy) return;
  if (!window.confirm(`取消收藏“${passage.lookup.normalizedReference}”？`)) return;
  try {
    await props.updateFavorites(
      passage.favorites.map((favorite) => ({
        bookCode: favorite.bookCode,
        chapter: favorite.chapter,
        verse: favorite.verse
      })),
      false
    );
    showToast(`已取消收藏 ${passage.lookup.normalizedReference}`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "取消收藏失败");
  }
}

function openBibleFavoritePassage(passage: BibleFavoritePassage) {
  void openLookupContext(passage.lookup);
}

async function sendLookup(lookup: BibleLookupDTO, key: string) {
  if (!props.canSend || sendBusyKey.value) return;
  sendBusyKey.value = key;
  try {
    await props.sendPassage(lookup);
    showToast(`已发送到：${props.channelName}`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "发送失败，请重试");
  } finally {
    sendBusyKey.value = "";
  }
}

function showToast(message: string) {
  toast.value = message;
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.value = "";
  }, 2600);
}

function handleTouchStart(event: TouchEvent) {
  const touch = event.touches[0];
  const target = event.target as HTMLElement | null;
  if (!touch || touch.clientX <= 20 || target?.closest("button, input, textarea, select, a, video, audio, [contenteditable='true'], [role='button'], [data-no-bible-swipe]")) {
    swipeStart = null;
    return;
  }
  swipeStart = { x: touch.clientX, y: touch.clientY };
}

function handleTouchEnd(event: TouchEvent) {
  const touch = event.changedTouches[0];
  if (!touch || !swipeStart) return;
  const deltaX = touch.clientX - swipeStart.x;
  const deltaY = touch.clientY - swipeStart.y;
  swipeStart = null;
  if (deltaX <= -64 && Math.abs(deltaX) > Math.abs(deltaY) * 1.4) emit("close");
}
</script>

<template>
  <section
    class="bible-workspace"
    :class="{ open }"
    :style="{ '--bible-font-size': `${bibleFontSize}px` }"
    :aria-hidden="!open"
    :inert="!open"
    @touchstart.passive="handleTouchStart"
    @touchend.passive="handleTouchEnd"
  >
    <header class="bible-topbar">
      <div class="bible-topbar-leading">
        <button v-if="view !== 'home'" type="button" class="bible-topbar-button home" @click="returnHome"><Home :size="19" />目录</button>
      </div>
      <button type="button" class="bible-topbar-title" disabled>
        <strong>{{ view === 'reader' ? `${panes.length} 窗格阅读` : '小故事的书房' }}</strong>
        <small><span>圣经</span><Sparkles :size="11" aria-hidden="true" /><span>{{ catalog?.translation || "新标点和合本（简体）" }}</span></small>
      </button>
      <div class="bible-topbar-actions">
        <button
          type="button"
          class="bible-resource-link"
          :disabled="panes.length >= MAX_BIBLE_PANES"
          :aria-label="panes.length >= MAX_BIBLE_PANES ? '已达到四窗格上限' : '添加圣经阅读窗格'"
          :title="panes.length >= MAX_BIBLE_PANES ? '最多四个窗格' : '添加阅读窗格'"
          @click="addBiblePane"
        ><PanelsTopLeft :size="19" /></button>
        <button
          v-if="view === 'reader' && panes.length > 1"
          type="button"
          class="bible-resource-link"
          :aria-label="effectiveSplitOrientation === 'columns' ? '改为上下分屏' : '改为左右分屏'"
          :title="effectiveSplitOrientation === 'columns' ? '上下分屏' : '左右分屏'"
          @click="toggleSplitOrientation"
        ><Rows2 v-if="effectiveSplitOrientation === 'columns'" :size="19" /><Columns2 v-else :size="19" /></button>
        <div class="bible-font-control" data-bible-font-menu>
          <button
            v-if="!showBibleFontMenu"
            type="button"
            class="bible-font-trigger"
            :aria-label="`经文字体大小，当前 ${bibleFontSize} 号`"
            aria-expanded="false"
            @click.stop="showBibleFontMenu = true"
          >字</button>
          <div v-else class="bible-font-stepper" role="group" :aria-label="`经文字体大小，当前 ${bibleFontSize} 号`" @click.stop>
            <button type="button" :disabled="bibleFontSize <= minBibleFontSize" @click="adjustBibleFontSize(-1)">小</button>
            <span aria-live="polite">{{ bibleFontSize }}</span>
            <button type="button" :disabled="bibleFontSize >= maxBibleFontSize" @click="adjustBibleFontSize(1)">大</button>
          </div>
        </div>
        <button type="button" class="bible-topbar-button chat" @click="emit('close')">聊天<ChevronRight :size="20" /></button>
      </div>
    </header>

    <div v-if="catalogBusy" class="bible-state">正在展开圣经目录…</div>
    <div v-else-if="catalogError" class="bible-state error"><span>{{ catalogError }}</span><button @click="ensureCatalog">重新加载</button></div>

    <main v-else-if="view === 'home'" class="bible-home">
      <nav class="bible-home-tabs" role="tablist" aria-label="书房功能">
        <button type="button" role="tab" :aria-selected="homeSection === 'catalog'" :class="{ active: homeSection === 'catalog' }" @click="homeSection = 'catalog'"><BookOpen :size="18" />经卷目录</button>
        <button type="button" role="tab" :aria-selected="homeSection === 'search'" :class="{ active: homeSection === 'search' }" @click="homeSection = 'search'"><Search :size="18" />经文检索</button>
        <button type="button" role="tab" :aria-selected="homeSection === 'favorites'" :class="{ active: homeSection === 'favorites' }" @click="homeSection = 'favorites'"><Bookmark :size="18" />经文收藏<span>{{ favorites.length }}</span></button>
      </nav>

      <section v-if="homeSection === 'catalog' && catalog" class="bible-catalog">
        <header><BookOpen :size="24" /><div><h2>经卷目录</h2><p>旧约39卷 · 新约27卷</p></div></header>
        <section><h3>旧约</h3><div class="bible-book-grid"><button v-for="book in catalog.oldTestament" :key="book.code" type="button" @click="chooseBook(book)"><strong>{{ book.name }}</strong><small>{{ book.chapterCount }}章</small></button></div></section>
        <section><h3>新约</h3><div class="bible-book-grid"><button v-for="book in catalog.newTestament" :key="book.code" type="button" @click="chooseBook(book)"><strong>{{ book.name }}</strong><small>{{ book.chapterCount }}章</small></button></div></section>
      </section>

      <section v-else-if="homeSection === 'search'" class="bible-search-panel">
        <div class="bible-search-tabs" role="tablist" aria-label="经文检索方式">
          <button type="button" :class="{ active: searchMode === 'topic' }" @click="searchMode = 'topic'">主题检索</button>
          <button type="button" :class="{ active: searchMode === 'text' }" @click="searchMode = 'text'">文本检索</button>
        </div>

        <form v-if="searchMode === 'topic'" class="bible-search-form" @submit.prevent="searchTopic(false)">
          <label for="bible-topic-query">想查看关于什么的经文？</label>
          <div><input id="bible-topic-query" v-model="topicQuery" maxlength="200" placeholder="例如：焦虑时怎样信靠神" /><button :disabled="topicBusy || topicQuery.trim().length < 2"><History v-if="matchingTopicHistory" :size="18" /><Search v-else :size="18" />{{ topicBusy ? "查找中" : matchingTopicHistory ? "查看历史" : "AI查找" }}</button></div>
          <small>AI只查找出处，经文正文始终来自本地和合本。</small>
          <div v-if="matchingTopicHistory" class="bible-history-match">
            <span>已搜索过，历史中有 {{ matchingTopicHistory.result.results.length }} 处经文。</span>
            <button type="button" :disabled="topicBusy" @click="searchTopic(true)"><Plus :size="16" />{{ topicBusy ? "生成中" : "追加生成" }}</button>
          </div>
          <p v-if="topicError" class="bible-search-error" role="alert">{{ topicError }}</p>
        </form>

        <form v-else class="bible-search-form" @submit.prevent="searchText(false)">
          <label for="bible-text-query">直接查找经文原文</label>
          <div><input id="bible-text-query" v-model="textQuery" maxlength="200" placeholder="例如：神爱世人，或输入多个关键词" /><button :disabled="textBusy || !textQuery.trim()"><Search :size="18" />{{ textBusy ? "检索中" : "检索" }}</button></div>
          <small>先匹配连续原文；没有结果时自动尝试所有关键词同时包含。</small>
          <p v-if="textError" class="bible-search-error" role="alert">{{ textError }}</p>
        </form>

        <section v-if="searchHistory.length" class="bible-search-history" aria-label="经文搜索历史">
          <header><span><History :size="18" /><strong>搜索历史</strong></span><button type="button" @click="clearSearchHistory"><Trash2 :size="15" />清空</button></header>
          <div class="bible-history-list">
            <button v-for="entry in searchHistory" :key="`${entry.kind}:${entry.query}`" type="button" @click="restoreSearchHistory(entry)">
              <span>{{ entry.kind === "topic" ? "AI主题" : "原文" }}</span>
              <strong>{{ entry.query }}</strong>
              <small>{{ historyResultCount(entry) }} · {{ historyTimeLabel(entry.updatedAt) }}</small>
            </button>
          </div>
        </section>

        <section v-if="searchMode === 'topic' && topicResult" class="bible-results" aria-live="polite">
          <header><strong>相关经文</strong><span>{{ topicResult.results.length }} 处</span><button v-if="topicResult.results.length" type="button" class="bible-copy-all" @click="copyTopicResults"><ClipboardCopy :size="15" />复制全部</button></header>
          <article v-for="lookup in topicResult.results" :key="lookup.normalizedReference" class="bible-result-card" @click="openTopicResult(lookup)">
            <h3>{{ lookup.normalizedReference }}</h3>
            <p><template v-for="verse in lookup.verses" :key="verse.reference"><sup>{{ verse.verse }}</sup>{{ verse.text }}</template></p>
            <footer><button type="button" @click.stop="copyLookup(lookup)"><ClipboardCopy :size="16" />复制</button><button type="button" @click.stop="openTopicResult(lookup)"><BookOpen :size="16" />阅读上下文</button><button type="button" :disabled="!canSend || !!sendBusyKey" :title="canSend ? '' : sendUnavailableReason" @click.stop="sendLookup(lookup, lookup.normalizedReference)"><Send :size="16" />发送</button></footer>
          </article>
        </section>

        <section v-if="searchMode === 'text' && textResult" class="bible-results" aria-live="polite">
          <header><strong>{{ textModeLabel }}</strong><span>共 {{ textResult.total }} 节</span><button v-if="textResult.total" type="button" class="bible-copy-all" :disabled="textBusy" @click="copyAllTextResults"><ClipboardCopy :size="15" />{{ textBusy ? "整理中…" : "复制全部" }}</button></header>
          <p v-if="!textResult.items.length" class="bible-empty">没有找到包含这段文字的经文。</p>
          <article v-for="item in textResult.items" :key="item.verse.reference" class="bible-result-card" @click="openTextResult(item)">
            <h3>{{ item.verse.reference }}</h3>
            <p><template v-for="(segment, index) in verseSegments(item.verse.text, item.matches)" :key="index"><mark v-if="segment.highlighted">{{ segment.text }}</mark><template v-else>{{ segment.text }}</template></template></p>
            <footer><button type="button" @click.stop="copyTextItem(item)"><ClipboardCopy :size="16" />复制</button><button type="button" @click.stop="openTextResult(item)"><BookOpen :size="16" />阅读上下文</button><button type="button" :disabled="!canSend || !!sendBusyKey" :title="canSend ? '' : sendUnavailableReason" @click.stop="sendLookup(singleVerseLookup(item.verse), item.verse.reference)"><Send :size="16" />发送</button></footer>
          </article>
          <button v-if="textHasMore" type="button" class="bible-load-more" :disabled="textBusy" @click="searchText(true)">{{ textBusy ? "加载中…" : "加载更多" }}</button>
        </section>
      </section>

      <section v-else-if="homeSection === 'favorites'" class="bible-favorites" aria-label="经文收藏夹">
        <header>
          <Bookmark :size="24" />
          <div><h2>经文收藏夹</h2><p>连续收藏的经文会自动合并，便于阅读和复制</p></div>
          <span>{{ favorites.length }} 节 · {{ favoritePassages.length }} 段</span>
        </header>
        <p v-if="favoritesBusy && !favorites.length" class="bible-empty">正在加载收藏…</p>
        <p v-else-if="!favorites.length" class="bible-empty">还没有收藏经文。在阅读时点选经文，再点“收藏”。</p>
        <div v-else class="bible-favorite-grid">
          <article v-for="passage in favoritePassages" :key="passage.key" @click="openBibleFavoritePassage(passage)">
            <h3><BookmarkCheck :size="16" />{{ passage.lookup.normalizedReference }}</h3>
            <p><template v-for="verse in passage.lookup.verses" :key="verse.reference"><sup>{{ verse.verse }}</sup>{{ verse.text }}</template></p>
            <footer><button type="button" @click.stop="copyLookup(passage.lookup)"><ClipboardCopy :size="15" />复制</button><button type="button" :disabled="favoritesBusy" @click.stop="removeBibleFavoritePassage(passage)"><Trash2 :size="15" />取消收藏</button></footer>
          </article>
        </div>
      </section>

    </main>

    <main v-else-if="view === 'chapters' && selectedBook" class="bible-chapter-picker">
      <div class="bible-paper-heading"><span>选择章节</span><h1>{{ selectedBook.name }}</h1><p>共 {{ selectedBook.chapterCount }} 章</p></div>
      <div class="bible-chapter-grid"><button v-for="chapter in selectedBook.chapterCount" :key="chapter" type="button" @click="openBookInActivePane(selectedBook, chapter)">{{ chapter }}</button></div>
    </main>

    <section
      v-else-if="view === 'reader' && catalog && panes.length"
      ref="splitContainer"
      class="bible-split-reader"
      :class="effectiveSplitOrientation"
      :style="splitGridStyle"
    >
      <template v-for="(pane, index) in panes" :key="pane.id">
        <BibleReaderPane
          :ref="(element) => setPaneRef(pane.id, element)"
          :pane-id="pane.id"
          :label="biblePaneLabel(index)"
          :initial-state="pane"
          :catalog="catalog"
          :font-size="bibleFontSize"
          :active="activePaneId === pane.id"
          :receiving="receivingPaneId === pane.id"
          :can-close="panes.length > 1"
          :channel-name="channelName"
          :can-send="canSend"
          :send-unavailable-reason="sendUnavailableReason"
          :send-passage="sendPassage"
          :favorites="favorites"
          :favorites-busy="favoritesBusy"
          :update-favorites="updateFavorites"
          @activate="activePaneId = $event"
          @close="closeBiblePane"
          @toggle-receiver="toggleReceivingPane"
          @open-reference="handlePaneReference"
          @state-change="updatePaneState"
          @toast="showToast"
        />
        <div
          v-if="index < panes.length - 1"
          class="bible-pane-separator"
          role="separator"
          tabindex="0"
          :aria-orientation="effectiveSplitOrientation === 'columns' ? 'vertical' : 'horizontal'"
          :aria-label="`调整 ${biblePaneLabel(index)} 与 ${biblePaneLabel(index + 1)} 窗格大小`"
          :aria-valuenow="Math.round(paneSizes[index] || 0)"
          @pointerdown="beginSeparatorDrag(index, $event)"
          @pointermove="moveSeparator"
          @pointerup="finishSeparatorDrag"
          @pointercancel="finishSeparatorDrag"
          @keydown="handleSeparatorKey(index, $event)"
          @dblclick="paneSizes = equalBiblePaneSizes(panes.length)"
        ><span aria-hidden="true"></span></div>
      </template>
    </section>
    <div v-if="toast" class="bible-toast" role="status">{{ toast }}</div>
  </section>
</template>

<style scoped>
.bible-workspace {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  color: #3f3227;
  background: #f3ecde;
  transform: translateX(-102%);
  transition: transform 280ms cubic-bezier(.22, .8, .25, 1);
  pointer-events: none;
  visibility: hidden;
  isolation: isolate;
}
.bible-workspace.open { transform: translateX(0); pointer-events: auto; visibility: visible; }
.bible-topbar { position: relative; min-height: calc(58px + var(--safe-top)); padding: var(--safe-top) 14px 0; display: grid; grid-template-columns: minmax(78px, 1fr) minmax(0, 2fr) minmax(112px, 1fr); align-items: center; border-bottom: 1px solid rgba(104, 76, 45, .18); background: rgba(250, 246, 237, .96); box-shadow: 0 4px 18px rgba(74, 52, 29, .08); }
.bible-topbar-button { border: 0; background: transparent; color: #725537; display: inline-flex; align-items: center; gap: 3px; font: inherit; font-weight: 700; padding: 10px 0; cursor: pointer; }
.bible-topbar-leading { justify-self: start; display: flex; align-items: center; }
.bible-topbar-actions { justify-self: end; display: flex; align-items: center; gap: 10px; }
.bible-topbar-title { min-width: 0; border: 0; padding: 5px 8px; display: grid; justify-items: center; color: inherit; background: transparent; font: inherit; line-height: 1.2; }
.bible-topbar-title strong { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: "Songti SC", "STSong", serif; font-size: 18px; }
.bible-topbar-title small { margin-top: 3px; color: #92775b; display: inline-flex; align-items: center; gap: 5px; font-size: 11px; white-space: nowrap; }
.bible-topbar-title small svg { color: #ad875a; }
.bible-font-control { flex: 0 0 auto; }
.bible-resource-link, .bible-font-trigger { width: 36px; height: 36px; border: 0; border-radius: 8px; color: #725537; background: rgba(128, 97, 63, .09); font: inherit; font-size: 18px; font-weight: 800; line-height: 1; cursor: pointer; }
.bible-resource-link { display: grid; place-items: center; padding: 0; text-decoration: none; cursor: pointer; }
.bible-resource-link:disabled { opacity: .36; cursor: not-allowed; }
.bible-resource-link:hover, .bible-font-trigger:hover { background: rgba(128, 97, 63, .16); }
.bible-font-stepper { min-height: 36px; display: flex; align-items: center; gap: 4px; }
.bible-font-stepper button, .bible-font-stepper span { min-width: 34px; height: 34px; border-radius: 7px; display: grid; place-items: center; }
.bible-font-stepper button { border: 0; padding: 0 7px; color: #654a31; background: rgba(128, 97, 63, .12); font: inherit; font-size: 14px; font-weight: 800; cursor: pointer; }
.bible-font-stepper button:disabled { opacity: .4; cursor: not-allowed; }
.bible-font-stepper span { border: 1px solid rgba(128, 97, 63, .28); color: #4f3b29; background: #fffaf1; font-size: 13px; font-weight: 800; }
.bible-home, .bible-chapter-picker { min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.bible-split-reader { min-width: 0; min-height: 0; display: grid; overflow: hidden; background: #d9cbb8; }
.bible-pane-separator { position: relative; z-index: 4; min-width: 0; min-height: 0; display: grid; place-items: center; touch-action: none; outline: none; background: rgba(112, 77, 42, .12); }
.bible-pane-separator::before { content: ""; position: absolute; inset: 0; background: transparent; transition: background-color 140ms ease; }
.bible-pane-separator:hover::before, .bible-pane-separator:focus-visible::before { background: rgba(218, 124, 30, .2); }
.bible-pane-separator span { position: relative; width: 3px; height: 34px; border-radius: 999px; background: rgba(112, 77, 42, .42); }
.bible-split-reader.columns .bible-pane-separator { cursor: col-resize; }
.bible-split-reader.rows .bible-pane-separator { cursor: row-resize; }
.bible-split-reader.rows .bible-pane-separator span { width: 34px; height: 3px; }
.bible-home { padding: 26px max(16px, calc((100vw - 1120px) / 2)) calc(44px + var(--safe-bottom)); }
.bible-home-tabs { max-width: 820px; margin: 0 auto 12px; padding: 5px; border: 1px solid rgba(116, 84, 48, .14); border-radius: 14px; background: rgba(233, 223, 207, .86); display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 5px; box-shadow: 0 8px 24px rgba(75, 51, 25, .06); }
.bible-home-tabs button { min-height: 46px; border: 0; border-radius: 10px; color: #765b40; background: transparent; display: inline-flex; align-items: center; justify-content: center; gap: 7px; font: inherit; font-weight: 800; cursor: pointer; }
.bible-home-tabs button.active { color: #fffaf1; background: #80613f; box-shadow: 0 4px 12px rgba(87, 60, 31, .18); }
.bible-home-tabs button span { min-width: 22px; padding: 2px 6px; border-radius: 999px; color: inherit; background: rgba(255, 255, 255, .2); font-size: 11px; }
.bible-home-tabs button:not(.active) span { background: rgba(128, 97, 63, .1); }
.bible-search-panel { max-width: 820px; margin: 0 auto 34px; padding: 18px; border: 1px solid rgba(116, 84, 48, .18); border-radius: 18px; background: rgba(255, 252, 245, .88); box-shadow: 0 12px 36px rgba(75, 51, 25, .08); }
.bible-search-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; padding: 4px; border-radius: 12px; background: #e9dfcf; }
.bible-search-tabs button { min-height: 42px; border: 0; border-radius: 9px; color: #765b40; background: transparent; font: inherit; font-weight: 700; cursor: pointer; }
.bible-search-tabs button.active { color: #fffaf1; background: #80613f; box-shadow: 0 4px 12px rgba(87, 60, 31, .18); }
.bible-search-form { display: grid; gap: 9px; margin-top: 18px; }
.bible-search-form label { font-family: "Songti SC", "STSong", serif; font-size: 20px; font-weight: 700; }
.bible-search-form > div { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
.bible-search-form input { min-width: 0; height: 48px; border: 1px solid #cdbb9f; border-radius: 11px; padding: 0 14px; color: #3f3227; background: #fffef9; font: inherit; font-size: 16px; outline: none; }
.bible-search-form input:focus { border-color: #967046; box-shadow: 0 0 0 3px rgba(150, 112, 70, .14); }
.bible-search-form button, .bible-load-more { border: 0; border-radius: 11px; padding: 0 18px; color: white; background: #80613f; display: inline-flex; align-items: center; justify-content: center; gap: 6px; font: inherit; font-weight: 700; cursor: pointer; }
.bible-search-form button:disabled, .bible-result-card button:disabled, .bible-verse-action button:disabled { opacity: .45; cursor: not-allowed; }
.bible-search-form small { color: #8a735c; }
.bible-search-error { margin: 0; color: #a4382c; }
.bible-search-form > .bible-history-match { display: flex; grid-template-columns: none; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; border: 1px solid rgba(128, 97, 63, .2); border-radius: 10px; color: #74583b; background: #f6efe2; }
.bible-history-match span { min-width: 0; }
.bible-history-match button { flex: 0 0 auto; min-height: 34px; padding: 0 11px; border: 1px solid #b89b77; border-radius: 8px; color: #6d5135; background: #fffaf1; font-size: 13px; }
.bible-search-history { display: grid; gap: 10px; margin-top: 18px; padding-top: 15px; border-top: 1px solid rgba(116, 84, 48, .16); }
.bible-search-history > header { display: flex; align-items: center; justify-content: space-between; color: #6d5135; }
.bible-search-history > header span, .bible-search-history > header button { display: inline-flex; align-items: center; gap: 6px; }
.bible-search-history > header button { border: 0; padding: 5px 7px; color: #91765b; background: transparent; font: inherit; font-size: 13px; cursor: pointer; }
.bible-history-list { display: flex; gap: 8px; overflow-x: auto; padding: 1px 1px 5px; scrollbar-width: thin; }
.bible-history-list > button { flex: 0 0 min(230px, 72vw); min-width: 0; padding: 10px 12px; border: 1px solid rgba(116, 84, 48, .16); border-radius: 10px; color: #4f3b29; background: #fffdf7; display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 4px 8px; text-align: left; font: inherit; cursor: pointer; }
.bible-history-list > button:hover { border-color: rgba(128, 97, 63, .4); }
.bible-history-list > button > span { padding: 2px 6px; border-radius: 999px; color: #7b5b3d; background: #eee2cf; font-size: 11px; }
.bible-history-list > button > strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bible-history-list > button > small { grid-column: 1 / -1; color: #91775d; }
.bible-results { display: grid; gap: 12px; margin-top: 22px; }
.bible-results > header { display: flex; align-items: center; justify-content: space-between; color: #6d5135; }
.bible-copy-all { min-height: 32px; border: 1px solid #bda581; border-radius: 9px; padding: 0 10px; color: #6d5135; background: #fffaf1; display: inline-flex; align-items: center; gap: 5px; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; }
.bible-copy-all:disabled { opacity: .5; cursor: wait; }
.bible-result-card { padding: 16px; border: 1px solid rgba(117, 84, 47, .16); border-radius: 13px; background: #fffdf7; cursor: pointer; }
.bible-result-card:hover { border-color: rgba(128, 97, 63, .4); box-shadow: 0 7px 20px rgba(76, 51, 25, .08); }
.bible-result-card h3 { margin: 0 0 9px; color: #76502d; font-family: "Songti SC", "STSong", serif; }
.bible-result-card p { margin: 0; font-family: "Songti SC", "STSong", serif; font-size: 17px; line-height: 1.8; }
.bible-result-card p sup { margin-right: 2px; color: #95704a; font-size: 10px; }
.bible-result-card mark, .bible-reader-verse mark { padding: 0; color: #b42318; background: transparent; font-weight: 800; }
.bible-result-card footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.bible-result-card footer button { min-height: 36px; border: 1px solid #cbb797; border-radius: 9px; padding: 0 11px; color: #6d5135; background: #faf4e8; display: inline-flex; align-items: center; gap: 5px; font: inherit; font-weight: 700; cursor: pointer; }
.bible-result-card footer button:last-child { color: white; border-color: #80613f; background: #80613f; }
.bible-load-more { min-height: 42px; margin: 4px auto 0; }
.bible-empty { margin: 0; padding: 16px; text-align: center; color: #8c745c; }
.bible-favorites { max-width: 1120px; margin: 0 auto 34px; padding: 18px; border: 1px solid rgba(116, 84, 48, .18); border-radius: 18px; background: rgba(255, 252, 245, .82); box-shadow: 0 12px 36px rgba(75, 51, 25, .08); }
.bible-favorites > header { margin-bottom: 14px; color: #6d5135; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 12px; }
.bible-favorites h2, .bible-favorites p { margin: 0; }
.bible-favorites h2 { font-family: "Songti SC", "STSong", serif; }
.bible-favorites > header p { margin-top: 3px; color: #8b7259; font-size: 13px; }
.bible-favorites > header > span { color: #8b7259; font-size: 13px; white-space: nowrap; }
.bible-favorite-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.bible-favorite-grid article { min-width: 0; padding: 14px; border: 1px solid rgba(117, 84, 47, .16); border-radius: 12px; background: #fffdf7; cursor: pointer; }
.bible-favorite-grid h3 { margin: 0 0 7px; color: #76502d; display: flex; align-items: center; gap: 6px; font-family: "Songti SC", "STSong", serif; }
.bible-favorite-grid p { color: #574330; font-family: "Songti SC", "STSong", serif; font-size: calc(var(--bible-font-size) * .85); line-height: 1.7; }
.bible-favorite-grid p sup { margin-right: 2px; color: #95704a; font-size: .58em; font-weight: 700; }
.bible-favorite-grid footer { display: flex; justify-content: flex-end; gap: 7px; margin-top: 10px; }
.bible-favorite-grid button { min-height: 34px; border: 1px solid #cbb797; border-radius: 8px; padding: 0 9px; color: #6d5135; background: #faf4e8; display: inline-flex; align-items: center; gap: 4px; font: inherit; font-size: 13px; cursor: pointer; }
.bible-favorite-grid button:disabled { opacity: .45; }
.bible-catalog { max-width: 1120px; margin: 0 auto; }
.bible-catalog > header { display: flex; align-items: center; gap: 12px; margin-bottom: 22px; color: #6d5135; }
.bible-catalog h2, .bible-catalog h3, .bible-catalog p { margin: 0; }
.bible-catalog h2, .bible-catalog h3 { font-family: "Songti SC", "STSong", serif; }
.bible-catalog p { margin-top: 3px; color: #8b7259; }
.bible-catalog > section + section { margin-top: 30px; }
.bible-catalog > section > h3 { margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid rgba(112, 78, 44, .18); font-size: 22px; }
.bible-book-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; }
.bible-book-grid button { min-height: 76px; padding: 10px 8px; border: 1px solid rgba(116, 82, 46, .16); border-radius: 11px; color: #4f3b29; background: rgba(255, 252, 245, .85); display: grid; align-content: center; gap: 4px; font: inherit; cursor: pointer; }
.bible-book-grid button:hover { border-color: #ab8963; background: #fffdf8; transform: translateY(-1px); }
.bible-book-grid strong { font-family: "Songti SC", "STSong", serif; font-size: 16px; }
.bible-book-grid small { color: #92775b; }
.bible-chapter-picker { padding: 48px max(18px, calc((100vw - 760px) / 2)) calc(48px + var(--safe-bottom)); }
.bible-paper-heading { text-align: center; font-family: "Songti SC", "STSong", serif; }
.bible-paper-heading span, .bible-paper-heading p { color: #957a5d; }
.bible-paper-heading h1 { margin: 10px 0 6px; font-size: 34px; }
.bible-paper-heading p { margin: 0; }
.bible-chapter-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 10px; margin-top: 32px; }
.bible-chapter-grid button { aspect-ratio: 1; min-width: 0; border: 1px solid #cbb89b; border-radius: 50%; color: #5c432d; background: rgba(255, 252, 245, .9); font: 700 16px/1 "Songti SC", "STSong", serif; cursor: pointer; }
.bible-chapter-grid button:hover { color: white; border-color: #80613f; background: #80613f; }
.bible-state { display: grid; place-items: center; align-content: center; gap: 12px; min-height: 220px; color: #80674e; }
.bible-state.error { color: #a33d30; }
.bible-state button { border: 0; border-radius: 9px; padding: 9px 14px; color: white; background: #80613f; }
.bible-toast { position: fixed; left: 50%; bottom: calc(76px + var(--safe-bottom)); z-index: 5; transform: translateX(-50%); max-width: calc(100vw - 32px); padding: 10px 16px; border-radius: 999px; color: white; background: rgba(55, 41, 28, .9); box-shadow: 0 8px 24px rgba(0, 0, 0, .18); white-space: nowrap; }
@media (max-width: 900px) { .bible-book-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
@media (max-width: 600px) {
  .bible-topbar { padding-left: 10px; padding-right: 10px; grid-template-columns: 62px minmax(0, 1fr) auto; }
  .bible-topbar-actions { gap: 5px; }
  .bible-topbar-button.home { font-size: 0; }
  .bible-topbar-button.home svg { width: 20px; height: 20px; }
  .bible-font-stepper { position: absolute; right: 10px; top: calc(var(--safe-top) + 10px); z-index: 2; padding: 3px; border-radius: 10px; background: rgba(250, 246, 237, .98); box-shadow: 0 8px 24px rgba(74, 52, 29, .18); }
  .bible-topbar-title strong { font-size: 17px; }
  .bible-topbar-title small { gap: 3px; font-size: 10px; }
  .bible-home { padding: 15px 12px calc(34px + var(--safe-bottom)); }
  .bible-home-tabs { margin-bottom: 9px; }
  .bible-home-tabs button { gap: 4px; font-size: 14px; }
  .bible-home-tabs button svg { display: none; }
  .bible-home-tabs button span { min-width: 18px; padding: 2px 4px; }
  .bible-search-panel { padding: 13px; border-radius: 14px; }
  .bible-results > header { flex-wrap: wrap; gap: 8px; }
  .bible-search-form > div { grid-template-columns: minmax(0, 1fr); }
  .bible-search-form button { min-height: 44px; }
  .bible-book-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .bible-favorites { padding: 13px; border-radius: 14px; }
  .bible-favorites > header { grid-template-columns: auto minmax(0, 1fr); }
  .bible-favorites > header > span { grid-column: 2; }
  .bible-favorite-grid { grid-template-columns: minmax(0, 1fr); }
  .bible-book-grid button { min-height: 66px; }
  .bible-chapter-picker { padding-top: 32px; }
  .bible-chapter-grid { grid-template-columns: repeat(5, 1fr); gap: 9px; }
}
@media (prefers-reduced-motion: reduce) { .bible-workspace { transition-duration: 1ms; } }
</style>
