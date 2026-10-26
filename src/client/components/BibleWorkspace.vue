<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { Columns2, Maximize2, Minimize2, PanelsTopLeft, Play, Rows2, Settings2, Share2, X } from "lucide-vue-next";
import type {
  BibleBookCatalogDTO,
  BibleCatalogDTO,
  BibleChapterDTO,
  BibleFavoriteDTO,
  BibleFavoriteKeyDTO,
  BibleLookupDTO,
  BibleRelatedSearchDTO,
  BibleSessionPayloadDTO,
  BibleTextMatchRangeDTO,
  BibleTextSearchDTO,
  BibleWorkspaceSnapshotDTO,
  ChannelDTO
} from "@shared/types";
import type { BibleTopicDTO } from "@shared/bibleTopics";
import type { BibleTopicActions } from "../bibleTopics";
import { api } from "../api";
import { useChatStore } from "../store";
import { createBibleSwipeNavigation } from "../features/bible/bibleSwipeNavigation";
import type { CopyworkSource } from "@shared/bibleCopywork";
import {
  bibleWorkspaceSnapshot,
  bibleWorkspaceStateFromSnapshot,
  bibleWorkspaceStateNewer,
  loadBibleWorkspaceState,
  saveBibleWorkspaceState,
  type BibleReaderTarget,
  type BiblePaneLocationState,
  type BiblePaneState,
  type BibleSearchHistoryEntry,
  type BibleWorkspaceSearchMode,
  type BibleWorkspaceState,
  type BibleHomeState,
  type BibleWorkspaceView
} from "../bibleWorkspaceState";
import NoteManager from "../features/bible/notes/NoteManager.vue";
import CopyworkManager from "../features/bible/copywork/CopyworkManager.vue";
import BibleHomePane from "../features/bible/BibleHomePane.vue";
import BiblePreferencesDialog from "../features/bible/BiblePreferencesDialog.vue";
import { BIBLE_FONT_DEFAULT, bibleFontSizeStorageKey, clampBibleFontSize } from "../features/bible/bibleFont";
import AppModal from "./ui/AppModal.vue";
import { provideBibleAccountState } from "../features/bible/useBibleAccountState";
import BibleReaderPane from "./BibleReaderPane.vue";
import BibleAudioControls from "../features/bible/BibleAudioControls.vue";
import type { BibleShareTextSender } from "../features/bible/biblePassageSharing";
import { useBibleAudioPlayer } from "../features/bible/useBibleAudioPlayer";
import type { BibleAudioPlayItem } from "../features/bible/bibleAudioQueue";
import { bibleAudioDefaultVersion, bibleAudioEnabled, loadBibleAudioManifest } from "../features/bible/bibleAudioManifest";
import { DEFAULT_BIBLE_TRANSLATION_ID, fetchBibleChapter } from "../bibleChapterCache";
import {
  MAX_BIBLE_PANES,
  biblePaneLabel,
  equalBiblePaneSizes,
  resolveBibleLinkTargetPaneId,
  resizeBiblePanePair,
  type BibleSplitOrientation
} from "../bibleSplitLayout";
import { buildBibleSessionSharePayload } from "../bibleSessionShare";

const props = defineProps<{
  open: boolean;
  split?: boolean;
  splitAvailable?: boolean;
  layoutWidth?: number;
  accountId: number;
  channelName: string;
  canSend: boolean;
  sendUnavailableReason: string;
  sendText: BibleShareTextSender;
  favorites: BibleFavoriteDTO[];
  favoritesBusy: boolean;
  updateFavorites: (verses: BibleFavoriteKeyDTO[], favorited: boolean, color?: string) => Promise<void>;
  /** 账号自建的经文收藏主题（含已解析的经文段落） */
  topics: BibleTopicDTO[];
  topicsBusy: boolean;
  topicActions: BibleTopicActions;
  /** 账号级保存的阅读窗格快照（来自服务器），用于跨设备恢复 */
  serverWorkspace?: BibleWorkspaceSnapshotDTO | null;
  /** 可分享到聊天室的频道列表 */
  shareChannels?: ChannelDTO[];
  /** 打开阅读器时所在的频道，分享弹窗默认选中 */
  activeChannelId?: number | null;
}>();

const emit = defineEmits<{
  close: [];
  expand: [];
  shrink: [];
  "reading-change": [activity: { active: boolean; bookName: string | null }];
  "audio-queue-ended": [];
}>();

type BibleReaderPaneExpose = {
  openLookup: (lookup: BibleLookupDTO, pushCurrent?: boolean) => Promise<void>;
  openLocation: (location: BiblePaneLocationState, pushCurrent?: boolean) => Promise<void>;
  snapshot: () => BiblePaneState;
  restoreReadingAnchor: (anchor: NonNullable<BiblePaneLocationState["scrollAnchor"]>) => void;
  applyTranslation: (translationId: string) => void;
  selectedLookups: () => BibleLookupDTO[];
};

type TextSegment = { text: string; highlighted: boolean };

const noteManager = ref<InstanceType<typeof NoteManager> | null>(null);
const copyworkManager = ref<InstanceType<typeof CopyworkManager> | null>(null);
const copyworkRevision = ref(0);
const catalog = ref<BibleCatalogDTO | null>(null);
const catalogBusy = ref(false);
const catalogError = ref("");
const view = ref<BibleWorkspaceView>("home");
const homeSection = ref<"catalog" | "search" | "favorites" | "copyworks" | "notes">("catalog");
const searchMode = ref<BibleWorkspaceSearchMode>("topic");
const topicQuery = ref("");
const textQuery = ref("");
const topicResult = ref<BibleRelatedSearchDTO | null>(null);
const textResult = ref<BibleTextSearchDTO | null>(null);
const selectedBook = ref<BibleBookCatalogDTO | null>(null);
const panes = ref<BiblePaneState[]>([]);
const activePaneId = ref<string | null>(null);
const receivingPaneId = ref<string | null>(null);
const splitOrientation = ref<BibleSplitOrientation | null>(null);
const paneSizes = ref<number[]>([100]);
const viewportWidth = ref(typeof window === "undefined" ? 1280 : window.innerWidth);
const paneRefs = new Map<string, BibleReaderPaneExpose>();
const homeRefs = new Map<string, { scrollTop: () => number; restoreScroll: (top: number) => void }>();
const screenHistory = ref<Record<string, { state: BiblePaneState; scrollTop: number }[]>>({});
const splitContainer = ref<HTMLElement | null>(null);
let paneSequence = 0;
let separatorDrag: { index: number; start: number; sizes: number[]; extent: number } | null = null;
const bibleFontSize = ref(BIBLE_FONT_DEFAULT);
let bibleFontSizeSaveTimer = 0;
const searchHistory = ref<BibleSearchHistoryEntry[]>([]);
const preferencesOpen = ref(false);
const pendingContext = ref<{ sourcePaneId: string; lookup: BibleLookupDTO; matches: BibleTextMatchRangeDTO[] } | null>(null);
const showShareDialog = ref(false);
const shareChannelId = ref<number | null>(null);
const shareBusy = ref(false);
const toast = ref("");
let toastTimer = 0;
let persistTimer = 0;
let catalogLoadPromise: Promise<void> | null = null;
let componentMounted = false;
let stateRestored = false;
const store = useChatStore();
const { preferences, savePreferences } = provideBibleAccountState(() => props.accountId, () => props.open, showToast);
const { start: handleTouchStart, end: handleTouchEnd, cancel: cancelSwipe } = createBibleSwipeNavigation({
  appearance: () => store.appearance,
  blocked: () => !props.open || !!props.splitAvailable,
  direction: "left",
  navigate: () => emit("close")
});
let catalogPreloadTimer = 0;
let serverSyncTimer = 0;
let pendingWorkspaceSyncJson = "";
let lastSyncedWorkspaceJson = "";

function loadBibleFontSize(accountId: number) {
  const saved = localStorage.getItem(bibleFontSizeStorageKey(accountId));
  bibleFontSize.value = preferences.value?.fontSize || (saved ? clampBibleFontSize(Number(saved)) : BIBLE_FONT_DEFAULT);
}

// 偏好面板里的字号调节：立即应用到阅读区，保存按 500ms 合并；撞上「正在保存」稍后自动重试。
function handleBibleFontSizeLive(size: number) {
  const fontSize = clampBibleFontSize(size);
  if (fontSize !== bibleFontSize.value) bibleFontSize.value = fontSize;
  scheduleBibleFontSizeSave();
}

function scheduleBibleFontSizeSave(retry = 0) {
  if (bibleFontSizeSaveTimer) window.clearTimeout(bibleFontSizeSaveTimer);
  bibleFontSizeSaveTimer = window.setTimeout(() => {
    bibleFontSizeSaveTimer = 0;
    void savePreferences({ fontSize: bibleFontSize.value }).catch(() => {
      if (retry < 2) scheduleBibleFontSizeSave(retry + 1);
      else showToast("字号保存失败，请稍后重试");
    });
  }, 500);
}

watch(() => props.accountId, loadBibleFontSize, { immediate: true });
// 保存响应携带的是保存时刻的字号；本地已有待保存编辑（防抖计时器在计时，或
// 撞上「正在保存」后的重试在排队）时它是旧值，回写会把新编辑打回去。
watch(() => preferences.value?.fontSize, size => { if (size && !bibleFontSizeSaveTimer) bibleFontSize.value = size; });
watch(bibleFontSize, (value) => {
  const clamped = clampBibleFontSize(value);
  if (clamped !== value) {
    bibleFontSize.value = clamped;
    return;
  }
  localStorage.setItem(bibleFontSizeStorageKey(props.accountId), String(clamped));
});

const allBooks = computed(() => [...(catalog.value?.oldTestament || []), ...(catalog.value?.newTestament || [])]);
const readingBookName = computed(() => {
  if (view.value === "reader") {
    const pane = panes.value.find((pane) => pane.id === activePaneId.value) || panes.value[0];
    return pane?.view === "home" ? null : pane?.book.name || null;
  }
  if (view.value === "chapters") return selectedBook.value?.name || null;
  return null;
});
const workspaceWidth = computed(() => props.layoutWidth || viewportWidth.value);
const effectiveSplitOrientation = computed<BibleSplitOrientation>(() => workspaceWidth.value <= 700 ? "rows" : splitOrientation.value || "columns");
watch(workspaceWidth, async () => {
  const anchors = [...paneRefs].map(([id, pane]) => [id, pane.snapshot().scrollAnchor] as const);
  await nextTick();
  for (const [id, anchor] of anchors) if (anchor) paneRefs.get(id)?.restoreReadingAnchor(anchor);
});
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
      // 进入时保留已恢复的窗格状态（直接回到上次的阅读视图）
      void ensureCatalog();
    } else {
      // 退出阅读器时立即保存并同步账号级窗格状态
      persistWorkspaceState();
      void flushWorkspaceServerSync();
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

onMounted(() => {
  componentMounted = true;
  window.addEventListener("pagehide", persistWorkspaceState);
  window.addEventListener("resize", handleViewportResize);
  void restoreWorkspaceState();
  catalogPreloadTimer = window.setTimeout(() => void ensureCatalog(), 500);
});

onBeforeUnmount(() => {
  window.removeEventListener("pagehide", persistWorkspaceState);
  window.removeEventListener("resize", handleViewportResize);
  persistWorkspaceState();
  void flushWorkspaceServerSync();
  if (toastTimer) window.clearTimeout(toastTimer);
  if (persistTimer) window.clearTimeout(persistTimer);
  if (catalogPreloadTimer) window.clearTimeout(catalogPreloadTimer);
  if (bibleFontSizeSaveTimer) window.clearTimeout(bibleFontSizeSaveTimer);
});

async function restoreWorkspaceState() {
  const accountId = props.accountId;
  if (serverSyncTimer) window.clearTimeout(serverSyncTimer);
  pendingWorkspaceSyncJson = "";
  lastSyncedWorkspaceJson = "";
  pendingContext.value = null;
  preferencesOpen.value = false;
  stateRestored = false;
  resetWorkspaceState();
  await ensureCatalog();
  if (props.accountId !== accountId) return;
  const local = loadBibleWorkspaceState(window.localStorage, props.accountId);
  const server = props.serverWorkspace ? bibleWorkspaceStateFromSnapshot(props.serverWorkspace, local) : null;
  const saved = bibleWorkspaceStateNewer(local, server);
  if (!saved) {
    const firstBook = allBooks.value[0];
    if (firstBook) {
      const pane = createPaneState(firstBook, 1);
      pane.view = "home";
      panes.value = [pane];
      activePaneId.value = pane.id;
      view.value = "reader";
    }
    stateRestored = true;
    return;
  }
  let savedPanes = saved.panes;
  if (saved.view === "reader" && savedPanes.length) {
    await ensureCatalog();
    // 服务器快照可能带有本机目录中不存在的书卷，恢复时过滤
    const knownCodes = new Set(allBooks.value.map((book) => book.code));
    savedPanes = savedPanes.filter((pane) => knownCodes.has(pane.book.code));
  }
  if (saved.view !== "reader" || !savedPanes.length) {
    const firstBook = saved.selectedBook || allBooks.value[0];
    if (firstBook) {
      let home = savedPanes.find(pane => pane.id === saved.activePaneId) || savedPanes[0];
      if (!home) { home = createPaneState(firstBook, 1); savedPanes = [home]; }
      home.view = saved.view === "chapters" ? "chapters" : "home";
      home.homeState = {
        section: saved.topicResult || saved.textResult ? "search" : "catalog",
        searchMode: saved.searchMode, topicQuery: saved.topicQuery, textQuery: saved.textQuery,
        topicResult: saved.topicResult, textResult: saved.textResult, selectedBook: saved.selectedBook
      };
    }
  }
  const paneIds = new Set(savedPanes.map((pane) => pane.id));
  searchMode.value = saved.searchMode === "text" ? "text" : "topic";
  topicQuery.value = saved.topicQuery || "";
  textQuery.value = saved.textQuery || "";
  topicResult.value = saved.topicResult || null;
  textResult.value = saved.textResult || null;
  selectedBook.value = saved.selectedBook || null;
  searchHistory.value = saved.history || [];
  panes.value = savedPanes;
  activePaneId.value = saved.activePaneId && paneIds.has(saved.activePaneId) ? saved.activePaneId : savedPanes[0]?.id || null;
  receivingPaneId.value = saved.receivingPaneId && paneIds.has(saved.receivingPaneId) ? saved.receivingPaneId : null;
  splitOrientation.value = saved.orientation;
  paneSizes.value = savedPanes.length === saved.panes.length ? saved.paneSizes : equalBiblePaneSizes(savedPanes.length || 1);
  paneSequence = savedPanes.reduce((highest, pane) => Math.max(highest, Number(pane.id.match(/(\d+)$/)?.[1] || 0)), 0);
  view.value = "reader";
  stateRestored = true;
}

function resetWorkspaceState() {
  screenHistory.value = {};
  homeRefs.clear();
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
  const currentPanes = panes.value.map((pane) => ({ ...pane, ...paneRefs.get(pane.id)?.snapshot() }));
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
    history: searchHistory.value,
    updatedAt: new Date().toISOString()
  };
  try {
    saveBibleWorkspaceState(window.localStorage, props.accountId, state);
  } catch {
    // Storage can be unavailable in private browsing; the mounted component still retains state.
  }
  scheduleWorkspaceServerSync(state);
}

// 账号级保存：防抖 PATCH 到 /api/me/preferences，失败保留待下次重试
function scheduleWorkspaceServerSync(state: BibleWorkspaceState) {
  const json = JSON.stringify(bibleWorkspaceSnapshot(state, state.updatedAt || new Date().toISOString()));
  if (json === lastSyncedWorkspaceJson) return;
  pendingWorkspaceSyncJson = json;
  if (serverSyncTimer) window.clearTimeout(serverSyncTimer);
  serverSyncTimer = window.setTimeout(() => void flushWorkspaceServerSync(), 2000);
}

async function flushWorkspaceServerSync() {
  if (serverSyncTimer) {
    window.clearTimeout(serverSyncTimer);
    serverSyncTimer = 0;
  }
  const json = pendingWorkspaceSyncJson;
  const accountId = props.accountId;
  if (!json || !accountId) return;
  pendingWorkspaceSyncJson = "";
  try {
    await api("/api/me/preferences", { method: "PATCH", body: JSON.stringify({ bibleWorkspace: JSON.parse(json) }) });
    if (props.accountId === accountId) lastSyncedWorkspaceJson = json;
  } catch {
    if (props.accountId === accountId) {
      if (!pendingWorkspaceSyncJson) pendingWorkspaceSyncJson = json;
      if (props.open) showToast("阅读窗格同步失败，稍后会重试");
    }
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

function rememberScreen(pane: BiblePaneState) {
  const state = { ...pane, ...paneRefs.get(pane.id)?.snapshot(), view: pane.view || "reader" };
  const entry = { state: JSON.parse(JSON.stringify(state)) as BiblePaneState, scrollTop: homeRefs.get(pane.id)?.scrollTop() || 0 };
  screenHistory.value = { ...screenHistory.value, [pane.id]: [...(screenHistory.value[pane.id] || []).slice(-19), entry] };
}

async function returnToPreviousScreen(paneId: string) {
  const history = screenHistory.value[paneId] || [];
  const previous = history.at(-1);
  if (!previous) return;
  screenHistory.value = { ...screenHistory.value, [paneId]: history.slice(0, -1) };
  updatePaneState(paneId, previous.state);
  activePaneId.value = paneId;
  await nextTick();
  homeRefs.get(paneId)?.restoreScroll(previous.scrollTop);
}

function returnHome(paneId = activePaneId.value) {
  const pane = panes.value.find(item => item.id === paneId);
  if (!pane) return;
  rememberScreen(pane);
  const snapshot = paneRefs.get(pane.id)?.snapshot() || pane;
  updatePaneState(pane.id, { ...snapshot, view: "home", backStack: [], homeSection: "catalog", homeState: { section: "catalog", searchMode: preferences.value?.defaultSearchMode || "topic", topicQuery: "", textQuery: "", topicResult: null, textResult: null, selectedBook: null } });
}
async function changePaneTranslation(paneId: string | null, translation: string) {
  const pane = panes.value.find(item => item.id === paneId);
  if (!pane || !catalog.value?.translations.some(item => item.id === translation) || pane.translation === translation) return;
  const reader = paneRefs.get(pane.id);
  const snapshot = reader?.snapshot() || pane;
  updatePaneState(pane.id, { ...pane, ...snapshot, translation });
  if (!reader) return;
  reader.applyTranslation(translation);
  try { await reader.openLocation({ book: snapshot.book, visibleChapter: snapshot.visibleChapter, targetVerse: null, scrollAnchor: null }); }
  catch (cause) { showToast(cause instanceof Error ? cause.message : "译本切换失败"); }
}
function updateHomeState(paneId: string, homeState: BibleHomeState) {
  const pane = panes.value.find(item => item.id === paneId);
  if (!pane || (pane.view !== "home" && pane.view !== "chapters")) return;
  updatePaneState(paneId, { ...pane, homeState, homeSection: homeState.section, view: homeState.selectedBook ? "chapters" : "home", ...(homeState.selectedBook ? { book: homeState.selectedBook, visibleChapter: 1, targetVerse: null, scrollAnchor: null } : {}) });
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

function setHomeRef(paneId: string, element: unknown) {
  if (element) homeRefs.set(paneId, element as { scrollTop: () => number; restoreScroll: (top: number) => void });
  else homeRefs.delete(paneId);
}

function updateReaderState(paneId: string, state: BiblePaneState) {
  const pane = panes.value.find(item => item.id === paneId);
  if (pane && pane.view !== "home" && pane.view !== "chapters") updatePaneState(paneId, state);
}

function updatePaneState(paneId: string, state: BiblePaneState) {
  const index = panes.value.findIndex((pane) => pane.id === paneId);
  if (index < 0) return;
  const next = [...panes.value];
  next[index] = { ...next[index], ...state, id: paneId };
  panes.value = next;
}

async function openBookInActivePane(book: BibleBookCatalogDTO, chapter: number, requestedPaneId = activePaneId.value) {
  await ensureCatalog();
  let paneId = requestedPaneId;
  if (!paneId || !panes.value.some((pane) => pane.id === paneId)) {
    const pane = createPaneState(book, chapter);
    panes.value = [pane];
    paneSizes.value = [100];
    activePaneId.value = pane.id;
    paneId = pane.id;
  }
  activePaneId.value = paneId;
  const pane = panes.value.find(item => item.id === paneId);
  if (pane) {
    if (pane.view === "home" || pane.view === "chapters") rememberScreen(pane);
    updatePaneState(paneId, { ...pane, book, visibleChapter: chapter, view: "reader", targetVerse: null, scrollAnchor: null, backStack: [] });
  }
  view.value = "reader";
  await nextTick();
  await paneRefs.get(paneId)?.openLocation({ book, visibleChapter: chapter, targetVerse: null, scrollAnchor: null });
}

async function addBiblePane(): Promise<string | null> {
  if (panes.value.length >= MAX_BIBLE_PANES) return null;
  await ensureCatalog();
  const active = activePaneId.value ? paneRefs.get(activePaneId.value)?.snapshot() : null;
  const source = active || panes.value.find((pane) => pane.id === activePaneId.value) || panes.value[0];
  if (!source) {
    const firstBook = allBooks.value[0];
    if (!firstBook) return null;
    const firstPane = createPaneState(firstBook, 1);
    firstPane.view = "home";
    const secondPane = { ...createPaneState(firstBook, 1), view: "home" as const };
    panes.value = [firstPane, secondPane];
    paneSizes.value = equalBiblePaneSizes(2);
    activePaneId.value = secondPane.id;
    view.value = "reader";
    return secondPane.id;
  }
  const pane: BiblePaneState = {
    ...source,
    homeState: source.homeState ? structuredClone(JSON.parse(JSON.stringify(source.homeState))) : undefined,
    id: nextPaneId(),
    selectedVerseKeys: [],
    selectionAnchorKey: null,
    backStack: []
  };
  panes.value = [...panes.value, pane];
  paneSizes.value = equalBiblePaneSizes(panes.value.length);
  activePaneId.value = pane.id;
  view.value = "reader";
  return pane.id;
}

function closeBiblePane(paneId: string) {
  if (panes.value.length <= 1) return;
  const index = panes.value.findIndex((pane) => pane.id === paneId);
  if (index < 0) return;
  delete screenHistory.value[paneId];
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
    // 单窗格阅读时点击经文链接：自动分屏，链接内容进入新窗格 B，
    // 并把 B 设为默认接收窗格（链接图标按下）。
    let freshTarget = false;
    if (panes.value.length === 1 && panes.value[0]?.id === sourcePaneId) {
      const receiverId = await addBiblePane();
      if (receiverId) receivingPaneId.value = receiverId;
      freshTarget = !!receiverId;
    }
    await routeLookup(response.result, sourcePaneId, [], undefined, undefined, freshTarget);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "经文跳转失败");
  }
}

async function routeLookup(lookup: BibleLookupDTO, sourcePaneId: string | null, matches: BibleTextMatchRangeDTO[] = [], translationId?: string, explicitTargetId?: string, freshTarget = false) {
  const first = lookup.verses[0];
  if (!first) return;
  await ensureCatalog();
  const book = allBooks.value.find(book => book.name === first.book);
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
    if (translationId) pane.translation = translationId;
    panes.value = [pane];
    activePaneId.value = pane.id;
    paneSizes.value = [100];
    view.value = "reader";
    await nextTick();
    if (translationId) paneRefs.get(pane.id)?.applyTranslation(translationId);
    if (matches.length) {
      await paneRefs.get(pane.id)?.openLocation({ book, visibleChapter: first.chapter, targetVerse: pane.targetVerse, scrollAnchor: null }, false);
    } else await paneRefs.get(pane.id)?.openLookup(lookup, false);
    return;
  }
  const ids = panes.value.map((pane) => pane.id);
  const source = sourcePaneId && ids.includes(sourcePaneId) ? sourcePaneId : activePaneId.value || ids[0];
  const targetId = explicitTargetId || resolveBibleLinkTargetPaneId(ids, source, receivingPaneId.value);
  if (!targetId) return;
  const target = panes.value.find(pane => pane.id === targetId);
  const targetWasHome = target?.view === "home" || target?.view === "chapters";
  if (target && targetWasHome && !freshTarget) rememberScreen(target);
  const pushCurrent = !freshTarget && !targetWasHome;
  if (target) updatePaneState(targetId, { ...target, view: "reader", book, visibleChapter: first.chapter, targetVerse: { chapter: first.chapter, verse: first.verse, endVerse: first.endVerse, matches }, scrollAnchor: null, ...(!pushCurrent ? { backStack: [] } : {}), ...(translationId ? { translation: translationId } : {}) });
  activePaneId.value = targetId;
  view.value = "reader";
  await nextTick();
  if (translationId) paneRefs.get(targetId)?.applyTranslation(translationId);
  if (matches.length) {
    await paneRefs.get(targetId)?.openLocation({
      book,
      visibleChapter: first.chapter,
      targetVerse: { chapter: first.chapter, verse: first.verse, endVerse: first.endVerse, matches },
      scrollAnchor: null
    }, pushCurrent);
  } else await paneRefs.get(targetId)?.openLookup(lookup, pushCurrent);
}

async function openSearchContext(sourcePaneId: string, lookup: BibleLookupDTO, matches: BibleTextMatchRangeDTO[]) {
  if (panes.value.length === 1) {
    const targetId = await addBiblePane();
    if (targetId) await routeLookup(lookup, sourcePaneId, matches, lookup.sourceId, targetId, true);
    return;
  }
  if (receivingPaneId.value && receivingPaneId.value !== sourcePaneId) {
    await routeLookup(lookup, sourcePaneId, matches, lookup.sourceId, receivingPaneId.value);
    return;
  }
  pendingContext.value = { sourcePaneId, lookup, matches };
}
async function chooseContextPane(targetId: string) {
  const pending = pendingContext.value;
  if (!pending) return;
  pendingContext.value = null;
  await routeLookup(pending.lookup, pending.sourcePaneId, pending.matches, pending.lookup.sourceId, targetId);
}

async function openLookupContext(lookup: BibleLookupDTO) {
  await routeLookup(lookup, activePaneId.value, [], lookup.sourceId);
}

async function openCopyworkContext(source: CopyworkSource) {
  await ensureCatalog();
  const book = allBooks.value.find((item) => item.code === source.bookCode);
  if (!book) throw new Error("暂时无法定位这处经文");
  await routeLookup({
    reference: source.reference,
    normalizedReference: source.reference,
    translation: source.translationName,
    sourceId: source.translation,
    verses: [{ book: book.name, chapter: source.chapter, verse: source.verseStart, endVerse: source.verseEnd, reference: source.reference, text: source.text }]
  }, activePaneId.value, [], source.translation);
}

// ---- 有声圣经：播放器挂在工作区上，关闭工作区后继续朗读，由 App 悬浮在聊天顶端的提词器接管；队列/时间戳逻辑见 features/bible/bibleAudioQueue.ts ----
const bibleAudio = reactive(useBibleAudioPlayer({
  accountId: () => props.accountId,
  books: () => allBooks.value,
  version: () => bibleAudioDefaultVersion.value,
  onToast: showToast,
  onQueueEnded: () => emit("audio-queue-ended")
}));
const bibleAudioFollow = ref(true);
const bibleAudioChapterText = ref<BibleChapterDTO | null>(null);
let bibleAudioChapterTextKey = "";

function bibleAudioFollowStorageKey(accountId: number) {
  return `team-chat-bible-audio-follow:${accountId}`;
}

// 提词器换句过渡（滑动变形）开关；默认开启，按账号存本地。声明须在下方 immediate watch 之前。
const bibleAudioLyricsTransition = ref(true);

function bibleAudioLyricsTransitionStorageKey(accountId: number) {
  return `team-chat-bible-audio-lyrics-transition:${accountId}`;
}

// 「连播到底」开关（播放键长按切换）：开启后从选中经文起播不受选集终点约束，按账号存本地。
const bibleAudioPlayThrough = ref(false);

function bibleAudioPlayThroughStorageKey(accountId: number) {
  return `team-chat-bible-audio-play-through:${accountId}`;
}

watch(() => props.accountId, (accountId) => {
  bibleAudioFollow.value = localStorage.getItem(bibleAudioFollowStorageKey(accountId)) !== "false";
  bibleAudioLyricsTransition.value = localStorage.getItem(bibleAudioLyricsTransitionStorageKey(accountId)) !== "false";
  bibleAudioPlayThrough.value = localStorage.getItem(bibleAudioPlayThroughStorageKey(accountId)) === "true";
  if (props.open && accountId) void loadBibleAudioManifest(true);
}, { immediate: true });

watch(() => props.open, (open) => {
  if (open && props.accountId) void loadBibleAudioManifest();
}, { immediate: true });

function toggleBibleAudioFollow() {
  bibleAudioFollow.value = !bibleAudioFollow.value;
  localStorage.setItem(bibleAudioFollowStorageKey(props.accountId), bibleAudioFollow.value ? "true" : "false");
}

function handleBibleAudioLyricsTransition(value: boolean) {
  bibleAudioLyricsTransition.value = value;
  localStorage.setItem(bibleAudioLyricsTransitionStorageKey(props.accountId), value ? "true" : "false");
}

const bibleAudioCompact = computed(() => workspaceWidth.value <= 600);

function activeReaderPane() {
  const isReader = (pane: BiblePaneState) => pane.view !== "home" && pane.view !== "chapters";
  return panes.value.find((pane) => pane.id === activePaneId.value && isReader(pane)) || panes.value.find(isReader) || null;
}

// 无选中：从（优先）窗格当前章整章播起；有选中：按播放模式逐段播放或从首节连播到底。
function startBibleAudioPlayback(preferPaneId?: string) {
  const isReader = (pane: BiblePaneState) => pane.view !== "home" && pane.view !== "chapters";
  const pane = (preferPaneId ? panes.value.find((item) => item.id === preferPaneId && isReader(item)) : null) || activeReaderPane();
  if (!pane) {
    showToast("请先打开一章经文再播放");
    return;
  }
  const reader = paneRefs.get(pane.id);
  const selection = reader?.selectedLookups() || [];
  if (selection.length) {
    if (bibleAudioPlayThrough.value) bibleAudio.startFromLookupsThrough(selection);
    else bibleAudio.startFromLookups(selection);
    return;
  }
  bibleAudio.startFromChapter(pane.book.code, reader?.snapshot().visibleChapter || pane.visibleChapter);
}

function handleBibleAudioToggle() {
  if (bibleAudio.toggle()) return;
  startBibleAudioPlayback();
}

// 播放键长按：切换「连播到底」。开启时把进行中的选集会话当场转连播；空闲则按当前上下文起播
// （阅读窗格 footer 的长按以该窗格为上下文，顶栏则以活动窗格为准）。
function toggleBibleAudioPlayThrough(startPaneId?: string) {
  bibleAudioPlayThrough.value = !bibleAudioPlayThrough.value;
  localStorage.setItem(bibleAudioPlayThroughStorageKey(props.accountId), bibleAudioPlayThrough.value ? "true" : "false");
  if (!bibleAudioPlayThrough.value) return;
  bibleAudio.continueAll();
  if (!bibleAudio.active) startBibleAudioPlayback(startPaneId);
}

function handleBibleAudioVerseSeek(paneId: string, chapter: number, verse: number) {
  const pane = panes.value.find((item) => item.id === paneId);
  if (pane) bibleAudio.seekToVerse(pane.book.code, chapter, verse);
}

// 阅读窗格 footer 的「播放」：朗读该窗格当前选中的经文（连播到底开启时从首节连播）
function handleBibleAudioPlaySelection(paneId: string) {
  const selection = paneRefs.get(paneId)?.selectedLookups() || [];
  if (!selection.length) return;
  if (bibleAudioPlayThrough.value) bibleAudio.startFromLookupsThrough(selection);
  else bibleAudio.startFromLookups(selection);
}

// 播放器停止播放（暂停）后，点击控件以外任意处即收起播放会话
function handleBibleAudioDismiss(event: PointerEvent) {
  if (!bibleAudio.active || bibleAudio.playing) return;
  const target = event.target;
  if (target instanceof Element && target.closest(".bible-audio-controls")) return;
  bibleAudio.stop();
}

/** 消息长按「播放经文」：打开首段所在位置，然后依次朗读全部引用 */
async function startAudioFromLookups(lookups: BibleLookupDTO[]) {
  await ensureCatalog();
  await loadBibleAudioManifest();
  if (!bibleAudioEnabled.value) {
    showToast("有声圣经暂未开放");
    return false;
  }
  if (lookups[0]) await openLookupContext(lookups[0]);
  return bibleAudio.startFromLookups(lookups);
}

/** 「/听」清单里的经文段：不改动窗格位置（工作区可能根本没打开），只起播已切好的队列；
 *  未开放时静默返回 false，由调用方在聊天侧给提示（工作区关着时这里的 toast 用户看不见） */
async function playAudioItems(items: BibleAudioPlayItem[]) {
  await ensureCatalog();
  await loadBibleAudioManifest();
  if (!bibleAudioEnabled.value) return false;
  return bibleAudio.startFromItems(items);
}

// 跟随翻页：朗读进入新一章时让活动窗格翻到该章（可在控件里关闭）
watch(() => bibleAudio.currentItem, async (item) => {
  if (!item || !bibleAudioFollow.value || !props.open) return;
  const book = allBooks.value.find((entry) => entry.code === item.book);
  if (!book) return;
  const pane = activeReaderPane();
  const current = pane ? paneRefs.get(pane.id)?.snapshot() : null;
  if (pane && current && current.book.code === item.book && current.visibleChapter === item.chapter) return;
  await openBookInActivePane(book, item.chapter, pane?.id || activePaneId.value);
});

// 聊天顶端提词器按朗读所在章取经文文本（与音频同一译本）
watch(() => bibleAudio.currentItem, async (item) => {
  if (!item) {
    bibleAudioChapterText.value = null;
    bibleAudioChapterTextKey = "";
    return;
  }
  const key = `${item.book}:${item.chapter}`;
  if (key === bibleAudioChapterTextKey) return;
  bibleAudioChapterTextKey = key;
  const book = allBooks.value.find((entry) => entry.code === item.book);
  if (!book) return;
  try {
    const chapter = await fetchBibleChapter(book, item.chapter, bibleAudioDefaultVersion.value?.translation || DEFAULT_BIBLE_TRANSLATION_ID);
    if (bibleAudioChapterTextKey === key) bibleAudioChapterText.value = chapter;
  } catch {
    if (bibleAudioChapterTextKey === key) bibleAudioChapterText.value = null;
  }
});

const bibleAudioLyrics = computed(() => {
  if (!bibleAudio.currentItem) return null;
  const verse = bibleAudio.currentVerse;
  const lines = bibleAudioChapterText.value?.verses || [];
  if (verse === null || verse <= 0) return { current: "本章引言", next: lines[0]?.text || "" };
  const index = lines.findIndex((line) => line.verse <= verse && verse <= line.endVerse);
  if (index < 0) return { current: "", next: "" };
  return { current: lines[index].text, next: lines[index + 1]?.text || "" };
});

onBeforeUnmount(() => bibleAudio.dispose());

// 暴露给 App 的聊天顶端提词器状态快照（reactive 经 expose 代理保持追踪）；bookName/chapter 供「正在听圣经」动态使用
const bibleAudioTeleprompter = computed(() => ({
  active: bibleAudio.active,
  playing: bibleAudio.playing,
  reference: bibleAudio.currentReference,
  bookName: bibleAudio.currentBookName,
  chapter: bibleAudio.currentItem?.chapter ?? null,
  transition: bibleAudioLyricsTransition.value,
  lyrics: bibleAudioLyrics.value
}));

defineExpose({
  openLookupContext,
  openSession,
  openCopyworkContext,
  startAudioFromLookups,
  playAudioItems,
  audio: bibleAudio,
  bibleAudioTeleprompter,
  toggleBibleAudio: handleBibleAudioToggle,
  stopBibleAudio: () => bibleAudio.stop()
});

function openShareDialog() {
  const channels = props.shareChannels || [];
  if (!channels.length) {
    showToast("暂时没有可分享的频道");
    return;
  }
  shareChannelId.value = channels.some((channel) => channel.id === props.activeChannelId) ? props.activeChannelId || channels[0].id : channels[0].id;
  showShareDialog.value = true;
}

async function confirmShare() {
  if (shareBusy.value || !shareChannelId.value) return;
  const currentPanes = panes.value.map((pane) => ({ ...pane, ...paneRefs.get(pane.id)?.snapshot() }));
  const payload = buildBibleSessionSharePayload(currentPanes, effectiveSplitOrientation.value, receivingPaneId.value, catalog.value?.translation || "");
  if (!payload) return;
  shareBusy.value = true;
  try {
    await api<{ success: boolean }>("/api/bible/share", {
      method: "POST",
      body: JSON.stringify({
        channelId: shareChannelId.value,
        panes: payload.panes,
        orientation: payload.orientation,
        receivingIndex: payload.receivingIndex
      })
    });
    const channelName = (props.shareChannels || []).find((channel) => channel.id === shareChannelId.value)?.name || "聊天室";
    showShareDialog.value = false;
    showToast(`已分享到：${channelName}`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "分享失败，请重试");
  } finally {
    shareBusy.value = false;
  }
}

/** 打开他人分享的“打开的圣经”：按分享载荷重建窗格布局（各自本地阅读） */
async function openSession(payload: BibleSessionPayloadDTO) {
  await ensureCatalog();
  const books = new Map(allBooks.value.map((book) => [book.code, book]));
  const knownTranslations = new Set((catalog.value?.translations || []).map((translation) => translation.id));
  const sessionPanes: BiblePaneState[] = [];
  for (const sessionPane of payload.panes.slice(0, MAX_BIBLE_PANES)) {
    const book = books.get(sessionPane.bookCode);
    if (!book) continue;
    const chapter = Math.max(1, Math.min(book.chapterCount, Math.floor(sessionPane.chapter) || 1));
    sessionPanes.push({
      id: nextPaneId(),
      book,
      visibleChapter: chapter,
      targetVerse: sessionPane.verseStart
        ? { chapter, verse: sessionPane.verseStart, endVerse: sessionPane.verseEnd || sessionPane.verseStart, matches: [] }
        : null,
      scrollAnchor: null,
      selectedVerseKeys: [],
      selectionAnchorKey: null,
      backStack: [],
      ...(sessionPane.translation && knownTranslations.has(sessionPane.translation) ? { translation: sessionPane.translation } : {})
    });
  }
  if (!sessionPanes.length) {
    showToast("分享的经卷在当前目录中不存在");
    return;
  }
  screenHistory.value = {};
  panes.value = sessionPanes;
  paneSizes.value = equalBiblePaneSizes(sessionPanes.length);
  activePaneId.value = sessionPanes[0].id;
  receivingPaneId.value = payload.receivingIndex !== null ? sessionPanes[payload.receivingIndex]?.id || null : null;
  splitOrientation.value = payload.orientation;
  view.value = "reader";
  await nextTick();
  await Promise.all(
    sessionPanes.map((pane) =>
      paneRefs.get(pane.id)?.openLocation(
        { book: pane.book, visibleChapter: pane.visibleChapter, targetVerse: pane.targetVerse, scrollAnchor: null },
        false
      )
    )
  );
}

function showToast(message: string) {
  toast.value = message;
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.value = "";
  }, 2600);
}

</script>

<template>
  <section
    id="bible-workspace"
    aria-label="圣经"
    class="bible-workspace"
    :class="{ open, split, compact: workspaceWidth <= 600, medium: workspaceWidth <= 900 }"
    :style="{ '--bible-font-size': `${bibleFontSize}px` }"
    :aria-hidden="!open"
    :inert="!open"
    @touchstart.passive="handleTouchStart"
    @touchend.passive="handleTouchEnd"
    @touchcancel.passive="cancelSwipe"
    @pointerdown.passive="handleBibleAudioDismiss"
  >
    <header class="bible-topbar">
      <button type="button" class="bible-topbar-button layout-control" aria-label="关闭圣经" title="关闭圣经" @click="emit('close')"><X :size="20" /></button>
      <div class="bible-topbar-actions">
        <button
          v-if="bibleAudioEnabled && !bibleAudio.active"
          type="button"
          class="bible-resource-link"
          aria-label="播放有声圣经"
          title="播放有声圣经"
          @click="handleBibleAudioToggle"
        ><Play :size="19" /></button>
        <button type="button" class="bible-resource-link" aria-label="圣经偏好设置" title="偏好设置" @click="preferencesOpen = true"><Settings2 :size="19" /></button>
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
        <button
          v-if="view === 'reader' && panes.length"
          type="button"
          class="bible-resource-link"
          aria-label="分享当前阅读窗格到聊天室"
          title="分享打开的圣经"
          @click="openShareDialog"
        ><Share2 :size="19" /></button>
        <button v-if="splitAvailable" type="button" class="bible-topbar-button layout-control" :aria-label="split ? '圣经全屏' : '缩小圣经，恢复分屏'" :title="split ? '圣经全屏' : '恢复分屏'" @click="split ? emit('expand') : emit('shrink')"><Maximize2 v-if="split" :size="20" /><Minimize2 v-else :size="20" /></button>
      </div>
      <BibleAudioControls
        v-if="bibleAudioEnabled && bibleAudio.active"
        :active="bibleAudio.active"
        :playing="bibleAudio.playing"
        :loading="bibleAudio.loading"
        :position-ms="bibleAudio.positionMs"
        :duration-ms="bibleAudio.durationMs"
        :rate="bibleAudio.rate"
        :reference="bibleAudio.currentReference"
        :can-previous-chapter="bibleAudio.canPreviousChapter"
        :can-next-chapter="bibleAudio.canNextChapter"
        :compact="bibleAudioCompact"
        :follow-enabled="bibleAudioFollow"
        :play-through="bibleAudioPlayThrough"
        :error="bibleAudio.error"
        @toggle="handleBibleAudioToggle"
        @previous-verse="bibleAudio.previousVerse()"
        @next-verse="bibleAudio.nextVerse()"
        @previous-chapter="bibleAudio.previousChapter()"
        @next-chapter="bibleAudio.nextChapter()"
        @cycle-rate="bibleAudio.cycleRate()"
        @toggle-follow="toggleBibleAudioFollow"
        @toggle-play-through="toggleBibleAudioPlayThrough"
      />
    </header>

    <div v-if="catalogBusy" class="bible-state">正在展开圣经目录…</div>
    <div v-else-if="catalogError" class="bible-state error"><span>{{ catalogError }}</span><button @click="ensureCatalog">重新加载</button></div>

    <section
      v-else-if="catalog && panes.length"
      ref="splitContainer"
      class="bible-split-reader"
      :class="effectiveSplitOrientation"
      :style="splitGridStyle"
    >
      <template v-for="(pane, index) in panes" :key="pane.id">
        <BibleHomePane
          :ref="element => setHomeRef(pane.id, element)" :can-go-back="!!screenHistory[pane.id]?.length" @back="returnToPreviousScreen(pane.id)"
          v-if="pane.view === 'home' || pane.view === 'chapters'"
          :key="`${accountId}:${pane.id}:home`" :pane="pane" :label="biblePaneLabel(index)" :active="activePaneId === pane.id"
          :can-close="panes.length > 1" :catalog="catalog"
          @translation="changePaneTranslation(pane.id, $event)"
          :account-id="accountId" :channel-name="channelName" :can-send="canSend" :send-unavailable-reason="sendUnavailableReason"
          :send-text="sendText" :favorites="favorites" :favorites-busy="favoritesBusy" :update-favorites="updateFavorites" :copywork-revision="copyworkRevision"
          :topics="topics" :topics-busy="topicsBusy" :topic-actions="topicActions"
          @activate="activePaneId = $event" @close="closeBiblePane" @state="updateHomeState(pane.id, $event)"
          @book="(book, chapter) => openBookInActivePane(book, chapter, pane.id)"
          @context="(lookup, matches) => openSearchContext(pane.id, lookup, matches)" @resume="copyworkManager?.resume($event)" @toast="showToast"
        />
        <BibleReaderPane
          v-else
          :ref="(element) => setPaneRef(pane.id, element)"
          :copywork-revision="copyworkRevision"
          @note-start="noteManager?.start($event)"
          @note-browse="noteManager?.browse($event)"
          @copy-start="copyworkManager?.start($event)"
          @copy-browse="copyworkManager?.browse($event)"
          :pane-id="pane.id"
          :label="biblePaneLabel(index)"
          :initial-state="pane"
          :catalog="catalog"
          :font-size="bibleFontSize"
          :active="activePaneId === pane.id"
          :receiving="receivingPaneId === pane.id"
          :can-close="panes.length > 1"
          :can-go-back="!!screenHistory[pane.id]?.length"
          :channel-name="channelName"
          :can-send="canSend"
          :send-unavailable-reason="sendUnavailableReason"
          :send-text="sendText"
          :favorites="favorites"
          :favorites-busy="favoritesBusy"
          :update-favorites="updateFavorites"
          :playing-verse-key="bibleAudio.playingVerseKey"
          :audio-seekable="bibleAudioEnabled && bibleAudio.active"
          :audio-enabled="bibleAudioEnabled"
          :audio-play-through="bibleAudioPlayThrough"
          @verse-seek="handleBibleAudioVerseSeek"
          @play-selection="handleBibleAudioPlaySelection"
          @toggle-play-through="toggleBibleAudioPlayThrough"
          @home="returnHome(pane.id)"
          @activate="activePaneId = $event"
          @close="closeBiblePane"
          @toggle-receiver="toggleReceivingPane"
          @open-reference="handlePaneReference"
          @back="returnToPreviousScreen(pane.id)"
          @state-change="updateReaderState"
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
    <!-- 圣经页面内不放提词器（经文本身高亮跟随）；提词器只在只看聊天时由 App 悬浮在聊天顶端 -->
    <BiblePreferencesDialog :open="preferencesOpen" :font-size="bibleFontSize" :lyrics-transition="bibleAudioLyricsTransition" @font-size="handleBibleFontSizeLive" @lyrics-transition="handleBibleAudioLyricsTransition" @close="preferencesOpen = false" />
    <AppModal :open="!!pendingContext" title="发送上下文到哪个窗格？" content-class="bible-context-dialog" @close="pendingContext = null">
      <div class="bible-context-options"><p>检索结果会保留在原窗格。</p><button v-for="pane in panes.filter(item => item.id !== pendingContext?.sourcePaneId)" :key="pane.id" type="button" @click="chooseContextPane(pane.id)">{{ biblePaneLabel(panes.findIndex(item => item.id === pane.id)) }} 窗格 · {{ pane.view === 'home' ? '目录与检索' : pane.book.name }}</button></div>
    </AppModal>
    <NoteManager ref="noteManager" :key="accountId" :account-id="accountId" :active="open" />
    <CopyworkManager ref="copyworkManager" :account-id="accountId" @changed="copyworkRevision++" @chat="emit('close')" />
    <div v-if="showShareDialog" class="bible-share-backdrop" @click.self="showShareDialog = false" @keydown.esc="showShareDialog = false">
      <div class="bible-share-dialog" role="dialog" aria-modal="true" aria-label="分享打开的圣经">
        <h2>分享打开的圣经</h2>
        <p class="bible-share-summary">把当前 {{ panes.length }} 个阅读窗格发送到聊天室，成员点击卡片即可一起阅读。</p>
        <label class="bible-share-field">
          <span>分享到频道</span>
          <select v-model="shareChannelId">
            <option v-for="channel in props.shareChannels || []" :key="channel.id" :value="channel.id">{{ channel.name }}</option>
          </select>
        </label>
        <div class="bible-share-actions">
          <button type="button" :disabled="shareBusy" @click="showShareDialog = false">取消</button>
          <button type="button" class="primary" :disabled="shareBusy || !shareChannelId" @click="confirmShare">{{ shareBusy ? "分享中…" : "分享" }}</button>
        </div>
      </div>
    </div>
    <div v-if="toast" class="bible-toast" role="status">{{ toast }}</div>
  </section>
</template>

<style scoped>
.bible-workspace {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  color: #3f3227;
  background: #f3ecde;
  transform: translateX(-102%);
  transition: transform 280ms cubic-bezier(.22, .8, .25, 1);
  pointer-events: none;
  visibility: hidden;
  isolation: isolate;
}
.bible-workspace :deep(*) { scrollbar-width: none; }
.bible-workspace :deep(*::-webkit-scrollbar) { display: none; }
.bible-workspace.open { transform: translateX(0); pointer-events: auto; visibility: visible; }
.bible-workspace.split { position: relative; inset: auto; grid-column: 1; grid-row: 1; min-width: 0; min-height: 0; z-index: 5; transition: none; }
.bible-topbar-button.layout-control { min-width: 32px; min-height: 44px; justify-content: center; }
.bible-topbar { position: relative; min-height: var(--bible-topbar-height); padding: var(--safe-top) 14px 0; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; column-gap: 10px; align-items: center; border-bottom: 1px solid rgba(104, 76, 45, .18); background: rgba(250, 246, 237, .96); box-shadow: 0 4px 18px rgba(74, 52, 29, .08); container: bible-topbar / inline-size; }
.bible-topbar-button { border: 0; background: transparent; color: #725537; display: inline-flex; align-items: center; gap: 3px; font: inherit; font-weight: 700; padding: 10px 0; cursor: pointer; }
.bible-topbar-actions { grid-column: 3; display: flex; align-items: center; gap: 10px; }
.bible-workspace .bible-audio-controls { grid-row: 1; grid-column: 2; justify-self: center; }
.bible-resource-link { flex: 0 0 auto; width: 36px; height: 36px; padding: 0; display: grid; place-items: center; border: 0; border-radius: 8px; color: #725537; background: rgba(128, 97, 63, .09); font: inherit; font-size: 18px; font-weight: 800; line-height: 1; cursor: pointer; }
.bible-resource-link { display: grid; place-items: center; padding: 0; text-decoration: none; cursor: pointer; }
.bible-resource-link:disabled { opacity: .36; cursor: not-allowed; }
.bible-resource-link:hover { background: rgba(128, 97, 63, .16); }
.bible-split-reader { min-width: 0; min-height: 0; display: grid; overflow: hidden; background: #d9cbb8; }
.bible-pane-separator { position: relative; z-index: 4; min-width: 0; min-height: 0; display: grid; place-items: center; touch-action: none; outline: none; background: rgba(112, 77, 42, .12); }
.bible-pane-separator::before { content: ""; position: absolute; inset: 0; background: transparent; transition: background-color 140ms ease; }
.bible-pane-separator:hover::before, .bible-pane-separator:focus-visible::before { background: rgba(218, 124, 30, .2); }
.bible-pane-separator span { position: relative; width: 3px; height: 34px; border-radius: 999px; background: rgba(112, 77, 42, .42); }
.bible-split-reader.columns .bible-pane-separator { cursor: col-resize; }
.bible-split-reader.rows .bible-pane-separator { cursor: row-resize; }
.bible-split-reader.rows .bible-pane-separator span { width: 34px; height: 3px; }
 .bible-state { display: grid; place-items: center; align-content: center; gap: 12px; min-height: 220px; color: #80674e; }
.bible-context-options { padding: 0 16px 16px; display: grid; gap: 10px; color: #604b32; }
.bible-context-options button { min-height: 44px; border: 1px solid #cbb797; border-radius: 8px; background: #fffaf1; font: inherit; color: inherit; cursor: pointer; }
.bible-toast { position: fixed; left: 50%; bottom: calc(76px + var(--safe-bottom)); z-index: 5; transform: translateX(-50%); max-width: calc(100vw - 32px); padding: 10px 16px; border-radius: 999px; color: white; background: rgba(55, 41, 28, .9); box-shadow: 0 8px 24px rgba(0, 0, 0, .18); white-space: nowrap; }
.bible-share-backdrop { position: fixed; inset: 0; z-index: 6; display: grid; place-items: center; padding: 20px; background: rgba(45, 33, 22, .45); }
.bible-share-dialog { width: min(360px, 100%); padding: 18px; border: 1px solid rgba(117, 84, 47, .2); border-radius: 14px; background: #faf4e8; box-shadow: 0 18px 48px rgba(45, 33, 22, .3); }
.bible-share-dialog h2 { margin: 0 0 8px; color: #6d5135; font-family: "Songti SC", "STSong", serif; font-size: 19px; }
.bible-share-summary { margin: 0 0 14px; color: #8b7259; font-size: 13px; line-height: 1.6; }
.bible-share-field { display: grid; gap: 6px; color: #6d5135; font-size: 13px; }
.bible-share-field select { min-height: 38px; padding: 0 10px; border: 1px solid #cbb797; border-radius: 9px; color: #4f3b29; background: #fffdf7; font: inherit; }
.bible-share-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.bible-share-actions button { min-height: 36px; padding: 0 14px; border: 1px solid #cbb797; border-radius: 9px; color: #6d5135; background: transparent; font: inherit; cursor: pointer; }
.bible-share-actions button.primary { color: white; border-color: #80613f; background: #80613f; }
.bible-share-actions button:disabled { opacity: .45; cursor: default; }
.bible-workspace.compact .bible-topbar { padding-left: 10px; padding-right: 10px; padding-bottom: 6px; grid-template-columns: auto minmax(0, 1fr) auto; }
.bible-workspace.compact .bible-topbar-actions { grid-row: 1; grid-column: 3; max-width: 100%; justify-content: flex-end; gap: 5px; }
.bible-workspace.compact .bible-resource-link { width: 32px; height: 32px; }
.bible-workspace.split.compact .bible-topbar { padding-bottom: 0; }
@media (prefers-reduced-motion: reduce) { .bible-workspace { transition-duration: 1ms; } }
</style>
