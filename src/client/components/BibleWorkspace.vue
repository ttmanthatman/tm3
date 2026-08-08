<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Bookmark, BookmarkCheck, BookOpen, ChevronLeft, ClipboardCopy, History, Home, Plus, Search, Send, Sparkles, Trash2, X } from "lucide-vue-next";
import type {
  BibleBookCatalogDTO,
  BibleCatalogDTO,
  BibleChapterDTO,
  BibleChapterVerseFragmentDTO,
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
  type BibleSearchHistoryEntry,
  type BibleWorkspaceSearchMode,
  type BibleWorkspaceState,
  type BibleWorkspaceView
} from "../bibleWorkspaceState";
import {
  bibleVerseKey,
  formatBibleLookupsForCopy,
  formatBibleVersesForCopy,
  selectBibleVerseKeys
} from "../bibleVerseActions";
import { groupBibleFavoritePassages, type BibleFavoritePassage } from "../bibleFavorites";
import { nearbyBibleChapterPreloadOrder, preservedScrollTop } from "../bibleReaderLoading";
import {
  BIBLE_FAVORITE_COLOR_PRESETS,
  DEFAULT_BIBLE_FAVORITE_COLOR,
  normalizeBibleFavoriteColor
} from "@shared/bibleFavoriteColors";

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

type TextSegment = { text: string; highlighted: boolean };

const catalog = ref<BibleCatalogDTO | null>(null);
const catalogBusy = ref(false);
const catalogError = ref("");
const view = ref<BibleWorkspaceView>("home");
const homeSection = ref<"search" | "favorites">("search");
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
const readerBook = ref<BibleBookCatalogDTO | null>(null);
const readerChapters = ref<Record<number, BibleChapterDTO>>({});
const readerBusyChapters = ref<Set<number>>(new Set());
const readerError = ref("");
const readerScroll = ref<HTMLElement | null>(null);
const visibleChapter = ref(1);
const jumpVerse = ref<number | "">("");
const targetVerse = ref<BibleReaderTarget | null>(null);
const linkedTargetVerseKeys = ref<Set<string>>(new Set());
const selectedVerseKeys = ref<Set<string>>(new Set());
const selectionAnchorKey = ref<string | null>(null);
const selectedFavoriteColor = ref<string>(DEFAULT_BIBLE_FAVORITE_COLOR);
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
const chapterCache = new Map<string, BibleChapterDTO>();
const chapterLoadPromises = new Map<string, Promise<BibleChapterDTO>>();
let componentMounted = false;
let stateRestored = false;
let swipeStart: { x: number; y: number } | null = null;
let readerGeneration = 0;
let nearbyPreloadTimer = 0;
let catalogPreloadTimer = 0;
let suppressReaderScrollUntil = 0;

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
const loadedChapters = computed(() => Object.keys(readerChapters.value).map(Number).sort((left, right) => left - right));
const loadedVerses = computed(() => loadedChapters.value.flatMap((chapter) => readerChapters.value[chapter]?.verses || []));
const visibleChapterVerseNumbers = computed(() => {
  const numbers = new Set<number>();
  for (const verse of readerChapters.value[visibleChapter.value]?.verses || []) {
    for (let number = verse.verse; number <= verse.endVerse; number += 1) numbers.add(number);
  }
  return [...numbers].sort((left, right) => left - right);
});
const orderedLoadedVerseKeys = computed(() => readerBook.value
  ? loadedVerses.value.map((verse) => bibleVerseKey(readerBook.value!.code, verse))
  : []);
const selectedVerses = computed(() => readerBook.value
  ? loadedVerses.value.filter((verse) => selectedVerseKeys.value.has(bibleVerseKey(readerBook.value!.code, verse)))
  : []);
const favoritePassages = computed(() => groupBibleFavoritePassages(props.favorites));
const favoriteVerseKeys = computed(() => new Set(props.favorites.map((favorite) => bibleVerseKey(favorite.bookCode, favorite.verseLine))));
const favoriteVerseColors = computed(() => new Map(
  props.favorites.map((favorite) => [bibleVerseKey(favorite.bookCode, favorite.verseLine), normalizeBibleFavoriteColor(favorite.color)])
));
const allSelectedFavorited = computed(() => selectedVerses.value.length > 0 && readerBook.value
  ? selectedVerses.value.every((verse) => favoriteVerseKeys.value.has(bibleVerseKey(readerBook.value!.code, verse)))
  : false);
const selectedVerseSummary = computed(() => selectedVerses.value.length === 1
  ? selectedVerses.value[0].reference
  : `已选 ${selectedVerses.value.length} 节经文`);
const textHasMore = computed(() => !!textResult.value && textResult.value.items.length < textResult.value.total);
const textModeLabel = computed(() => textResult.value?.mode === "allTerms" ? "多关键词匹配" : "连续原文匹配");
const matchingTopicHistory = computed(() => findBibleTopicHistory(searchHistory.value, topicQuery.value));
const readingBookName = computed(() => {
  if (view.value === "reader") return readerBook.value?.name || null;
  if (view.value === "chapters") return selectedBook.value?.name || null;
  return null;
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
  [view, searchMode, topicQuery, textQuery, topicResult, textResult, selectedBook, readerBook, visibleChapter, targetVerse, selectedVerseKeys, selectionAnchorKey, searchHistory],
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
  void restoreWorkspaceState();
  catalogPreloadTimer = window.setTimeout(() => void ensureCatalog(), 500);
});

onBeforeUnmount(() => {
  window.removeEventListener("pagehide", persistWorkspaceState);
  document.removeEventListener("pointerdown", handleWorkspacePointerDown);
  persistWorkspaceState();
  if (toastTimer) window.clearTimeout(toastTimer);
  if (persistTimer) window.clearTimeout(persistTimer);
  if (nearbyPreloadTimer) window.clearTimeout(nearbyPreloadTimer);
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
  visibleChapter.value = Math.max(1, saved.visibleChapter || 1);

  if (saved.view === "reader" && saved.readerBook) {
    const target = saved.targetVerse?.chapter === visibleChapter.value ? saved.targetVerse : null;
    await openReader(saved.readerBook, visibleChapter.value, target);
    const prefix = `${saved.readerBook.code.toUpperCase()}:`;
    selectedVerseKeys.value = new Set((saved.selectedVerseKeys || []).filter((key) => key.startsWith(prefix)));
    selectionAnchorKey.value = saved.selectionAnchorKey?.startsWith(prefix) ? saved.selectionAnchorKey : null;
  } else {
    readerBook.value = saved.readerBook || null;
    targetVerse.value = saved.targetVerse || null;
    view.value = saved.view === "chapters" && saved.selectedBook ? "chapters" : "home";
  }
  stateRestored = true;
}

function resetWorkspaceState() {
  readerGeneration += 1;
  if (nearbyPreloadTimer) window.clearTimeout(nearbyPreloadTimer);
  view.value = "home";
  searchMode.value = "topic";
  topicQuery.value = "";
  textQuery.value = "";
  topicResult.value = null;
  textResult.value = null;
  selectedBook.value = null;
  readerBook.value = null;
  readerChapters.value = {};
  visibleChapter.value = 1;
  jumpVerse.value = "";
  targetVerse.value = null;
  linkedTargetVerseKeys.value = new Set();
  clearVerseSelection();
  searchHistory.value = [];
}

function scheduleWorkspacePersistence() {
  if (!stateRestored || !props.accountId) return;
  if (persistTimer) window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(persistWorkspaceState, 180);
}

function persistWorkspaceState() {
  if (!stateRestored || !props.accountId) return;
  const state: BibleWorkspaceState = {
    version: 1,
    view: view.value,
    searchMode: searchMode.value,
    topicQuery: topicQuery.value,
    textQuery: textQuery.value,
    topicResult: topicResult.value,
    textResult: textResult.value,
    selectedBook: selectedBook.value,
    readerBook: readerBook.value,
    visibleChapter: visibleChapter.value,
    targetVerse: targetVerse.value,
    selectedVerseReference: null,
    selectedVerseKeys: [...selectedVerseKeys.value],
    selectionAnchorKey: selectionAnchorKey.value,
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
  selectedBook.value = null;
  clearVerseSelection();
}

function jumpToBook(event: Event) {
  const bookCode = (event.target as HTMLSelectElement).value;
  const book = allBooks.value.find((candidate) => candidate.code === bookCode);
  if (book) void openReader(book, 1);
}

function jumpToChapter(event: Event) {
  const chapter = Number((event.target as HTMLSelectElement).value);
  if (readerBook.value && Number.isInteger(chapter)) void openReader(readerBook.value, chapter);
}

function jumpToVerse(event: Event) {
  const verse = Number((event.target as HTMLSelectElement).value);
  if (!readerBook.value || !Number.isInteger(verse) || verse < 1) return;
  jumpVerse.value = verse;
  void openReader(readerBook.value, visibleChapter.value, {
    chapter: visibleChapter.value,
    verse,
    endVerse: verse,
    matches: []
  });
}

function chooseBook(book: BibleBookCatalogDTO) {
  if (book.chapterCount === 1) {
    void openReader(book, 1);
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
  const book = bookForVerse(item.verse);
  if (!book) return;
  void openReader(book, item.verse.chapter, {
    chapter: item.verse.chapter,
    verse: item.verse.verse,
    endVerse: item.verse.endVerse,
    matches: item.matches
  });
}

function openTopicResult(lookup: BibleLookupDTO) {
  const first = lookup.verses[0];
  if (!first) return;
  const book = bookForVerse(first);
  if (!book) return;
  void openReader(book, first.chapter, {
    chapter: first.chapter,
    verse: first.verse,
    endVerse: first.endVerse,
    matches: []
  });
}

async function openReader(
  book: BibleBookCatalogDTO,
  chapter: number,
  target: BibleReaderTarget | null = null,
  linkedTargets: ReadonlySet<string> | null = null
) {
  const generation = ++readerGeneration;
  suppressReaderScrollUntil = Date.now() + 500;
  if (nearbyPreloadTimer) window.clearTimeout(nearbyPreloadTimer);
  readerBook.value = book;
  readerChapters.value = {};
  readerBusyChapters.value = new Set();
  readerError.value = "";
  targetVerse.value = target;
  linkedTargetVerseKeys.value = new Set(linkedTargets || []);
  clearVerseSelection();
  visibleChapter.value = chapter;
  jumpVerse.value = target?.verse || "";
  view.value = "reader";
  await loadChapter(chapter);
  if (generation !== readerGeneration || readerBook.value?.code !== book.code) return;
  await nextTick();
  const selector = target
    ? `[data-verse-key="${book.code}-${chapter}-${target.verse}"]`
    : `[data-reader-chapter="${chapter}"]`;
  const scroller = readerScroll.value;
  const element = scroller?.querySelector<HTMLElement>(selector);
  if (scroller && element) {
    const previousScrollBehavior = scroller.style.scrollBehavior;
    scroller.style.scrollBehavior = "auto";
    element.scrollIntoView({ block: target ? "center" : "start", behavior: "auto" });
    scroller.style.scrollBehavior = previousScrollBehavior;
  }
  scheduleNearbyChapterPreloads(book, chapter, generation);
}

async function openLookupContext(lookup: BibleLookupDTO) {
  const first = lookup.verses[0];
  if (!first) return;
  await ensureCatalog();
  const book = bookForVerse(first);
  if (!book) {
    showToast("暂时无法定位这处经文");
    return;
  }
  const targetKeys = new Set<string>();
  for (const verse of lookup.verses) {
    if (verse.book !== first.book) continue;
    for (let number = verse.verse; number <= verse.endVerse; number += 1) {
      targetKeys.add(bibleVerseKey(book.code, { chapter: verse.chapter, verse: number }));
    }
  }
  await openReader(book, first.chapter, {
    chapter: first.chapter,
    verse: first.verse,
    endVerse: first.endVerse,
    matches: []
  }, targetKeys);
  const extraChapters = [...new Set(lookup.verses.filter((verse) => verse.book === first.book).map((verse) => verse.chapter))]
    .filter((chapter) => chapter !== first.chapter);
  await Promise.all(extraChapters.map((chapter) => loadChapter(chapter)));
}

defineExpose({ openLookupContext });

function chapterCacheKey(bookCode: string, chapter: number) {
  return `${bookCode.toUpperCase()}:${chapter}`;
}

async function fetchChapter(book: BibleBookCatalogDTO, chapter: number) {
  const key = chapterCacheKey(book.code, chapter);
  const cached = chapterCache.get(key);
  if (cached) return cached;
  const pending = chapterLoadPromises.get(key);
  if (pending) return pending;
  const promise = api<{ success: boolean; result?: BibleChapterDTO; message?: string }>(
    `/api/bible/chapter?book=${encodeURIComponent(book.code)}&chapter=${chapter}`
  ).then((response) => {
    if (!response.success || !response.result) throw new Error(response.message || "章节加载失败");
    chapterCache.set(key, response.result);
    return response.result;
  }).finally(() => chapterLoadPromises.delete(key));
  chapterLoadPromises.set(key, promise);
  return promise;
}

function scheduleNearbyChapterPreloads(book: BibleBookCatalogDTO, chapter: number, generation: number) {
  const queue = nearbyBibleChapterPreloadOrder(chapter, book.chapterCount, 5).slice(1);
  const pump = () => {
    if (generation !== readerGeneration || readerBook.value?.code !== book.code) return;
    const nextChapter = queue.shift();
    if (!nextChapter) return;
    void fetchChapter(book, nextChapter).catch(() => undefined).finally(() => {
      nearbyPreloadTimer = window.setTimeout(pump, 420);
    });
  };
  nearbyPreloadTimer = window.setTimeout(pump, 280);
}

async function loadChapter(chapter: number, prepend = false) {
  const book = readerBook.value;
  if (!book || chapter < 1 || chapter > book.chapterCount || readerChapters.value[chapter] || readerBusyChapters.value.has(chapter)) return;
  const busy = new Set(readerBusyChapters.value);
  busy.add(chapter);
  readerBusyChapters.value = busy;
  const scroller = readerScroll.value;
  const anchorChapter = prepend ? loadedChapters.value[0] : undefined;
  const anchorBefore = anchorChapter
    ? scroller?.querySelector<HTMLElement>(`[data-reader-chapter="${anchorChapter}"]`)?.getBoundingClientRect().top
    : undefined;
  try {
    const result = await fetchChapter(book, chapter);
    if (readerBook.value?.code !== book.code) return;
    readerChapters.value = { ...readerChapters.value, [chapter]: result };
    await nextTick();
    if (scroller && anchorChapter && anchorBefore !== undefined) {
      const anchorAfter = scroller.querySelector<HTMLElement>(`[data-reader-chapter="${anchorChapter}"]`)?.getBoundingClientRect().top;
      if (anchorAfter !== undefined) {
        const previousScrollBehavior = scroller.style.scrollBehavior;
        scroller.style.scrollBehavior = "auto";
        scroller.scrollTop = preservedScrollTop(scroller.scrollTop, anchorBefore, anchorAfter);
        scroller.style.scrollBehavior = previousScrollBehavior;
      }
    }
  } catch (error) {
    if (readerBook.value?.code === book.code) readerError.value = error instanceof Error ? error.message : "章节加载失败";
  } finally {
    if (readerBook.value?.code === book.code) {
      const next = new Set(readerBusyChapters.value);
      next.delete(chapter);
      readerBusyChapters.value = next;
    }
  }
}

function handleReaderScroll() {
  const scroller = readerScroll.value;
  const book = readerBook.value;
  if (!scroller || !book || !loadedChapters.value.length || Date.now() < suppressReaderScrollUntil) return;
  const chapters = Array.from(scroller.querySelectorAll<HTMLElement>("[data-reader-chapter]"));
  let closest = visibleChapter.value;
  let distance = Number.POSITIVE_INFINITY;
  for (const element of chapters) {
    const nextDistance = Math.abs(element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 72);
    if (nextDistance < distance) {
      distance = nextDistance;
      closest = Number(element.dataset.readerChapter || closest);
    }
  }
  if (visibleChapter.value !== closest) {
    visibleChapter.value = closest;
    jumpVerse.value = "";
  }
  const first = loadedChapters.value[0];
  const last = loadedChapters.value[loadedChapters.value.length - 1];
  if (scroller.scrollTop < 220 && first > 1) void loadChapter(first - 1, true);
  if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 320 && last < book.chapterCount) void loadChapter(last + 1);
}

function targetMatches(verse: BibleVerseLineDTO) {
  const target = targetVerse.value;
  return target && target.chapter === verse.chapter && target.verse === verse.verse ? target.matches : [];
}

function fragmentMatches(fragment: BibleChapterVerseFragmentDTO) {
  return targetMatches(fragment.verse).flatMap((range) => {
    const start = Math.max(fragment.start, range.start);
    const end = Math.min(fragment.end, range.end);
    return end > start ? [{ start: start - fragment.start, end: end - fragment.start }] : [];
  });
}

function isTargetVerse(verse: BibleVerseLineDTO) {
  if (readerBook.value && linkedTargetVerseKeys.value.size) {
    for (let number = verse.verse; number <= verse.endVerse; number += 1) {
      if (linkedTargetVerseKeys.value.has(bibleVerseKey(readerBook.value.code, { chapter: verse.chapter, verse: number }))) return true;
    }
    return false;
  }
  const target = targetVerse.value;
  return !!target && target.chapter === verse.chapter && verse.verse <= target.endVerse && verse.endVerse >= target.verse;
}

function selectVerse(verse: BibleVerseLineDTO, shiftKey = false) {
  const book = readerBook.value;
  if (!book) return;
  const clickedKey = bibleVerseKey(book.code, verse);
  selectedVerseKeys.value = selectBibleVerseKeys(
    orderedLoadedVerseKeys.value,
    selectedVerseKeys.value,
    clickedKey,
    selectionAnchorKey.value,
    shiftKey
  );
  if (!shiftKey || !selectionAnchorKey.value) selectionAnchorKey.value = clickedKey;
}

function clearVerseSelection() {
  selectedVerseKeys.value = new Set();
  selectionAnchorKey.value = null;
}

function isSelectedVerse(verse: BibleVerseLineDTO) {
  return !!readerBook.value && selectedVerseKeys.value.has(bibleVerseKey(readerBook.value.code, verse));
}

function isFavoriteVerse(verse: BibleVerseLineDTO) {
  return !!readerBook.value && favoriteVerseKeys.value.has(bibleVerseKey(readerBook.value.code, verse));
}

function favoriteColorForVerse(verse: BibleVerseLineDTO) {
  if (!readerBook.value) return DEFAULT_BIBLE_FAVORITE_COLOR;
  return favoriteVerseColors.value.get(bibleVerseKey(readerBook.value.code, verse)) || DEFAULT_BIBLE_FAVORITE_COLOR;
}

function favoriteVerseStyle(verse: BibleVerseLineDTO) {
  return isFavoriteVerse(verse) ? { "--bible-favorite-color": favoriteColorForVerse(verse) } : undefined;
}

function verseSegments(text: string, ranges: BibleTextMatchRangeDTO[]): TextSegment[] {
  const safeRanges = ranges
    .map((range) => ({ start: Math.max(0, Math.min(text.length, range.start)), end: Math.max(0, Math.min(text.length, range.end)) }))
    .filter((range) => range.end > range.start)
    .sort((left, right) => left.start - right.start);
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

function copySelectedVerses() {
  return writeClipboard(
    formatBibleVersesForCopy(selectedVerses.value, catalog.value?.translation || "新标点和合本（简体）"),
    `已复制 ${selectedVerses.value.length} 节经文`
  );
}

function favoriteKey(verse: BibleVerseLineDTO): BibleFavoriteKeyDTO | null {
  if (!readerBook.value) return null;
  return { bookCode: readerBook.value.code, chapter: verse.chapter, verse: verse.verse };
}

async function updateSelectedFavorites(remove: boolean) {
  const verses = selectedVerses.value.map(favoriteKey).filter((verse): verse is BibleFavoriteKeyDTO => !!verse);
  if (!verses.length || props.favoritesBusy) return;
  try {
    await props.updateFavorites(verses, !remove, remove ? undefined : selectedFavoriteColor.value);
    showToast(remove ? `已取消收藏 ${verses.length} 节经文` : `已收藏 ${verses.length} 节经文`);
    if (remove) {
      clearVerseSelection();
      targetVerse.value = null;
      linkedTargetVerseKeys.value = new Set();
    }
  } catch (error) {
    showToast(error instanceof Error ? error.message : "经文收藏更新失败");
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

async function chooseFavoriteColor(color: string) {
  selectedFavoriteColor.value = normalizeBibleFavoriteColor(color);
  if (!allSelectedFavorited.value || props.favoritesBusy) return;
  const verses = selectedVerses.value.map(favoriteKey).filter((verse): verse is BibleFavoriteKeyDTO => !!verse);
  if (!verses.length) return;
  try {
    await props.updateFavorites(verses, true, selectedFavoriteColor.value);
    showToast("已更新收藏标线颜色");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "标线颜色更新失败");
  }
}

watch([selectedVerseKeys, () => props.favorites], () => {
  const first = selectedVerses.value[0];
  if (first && isFavoriteVerse(first)) selectedFavoriteColor.value = favoriteColorForVerse(first);
});

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
      <button type="button" class="bible-topbar-button" @click="emit('close')"><ChevronLeft :size="20" />聊天</button>
      <button v-if="view !== 'reader'" type="button" class="bible-topbar-title" disabled>
        <strong>小故事的书房</strong>
        <small><span>圣经</span><Sparkles :size="11" aria-hidden="true" /><span>{{ catalog?.translation || "新标点和合本（简体）" }}</span></small>
      </button>
      <nav v-else-if="readerBook" class="bible-jump-nav" aria-label="经文快速跳转">
        <select :value="readerBook.code" aria-label="选择圣经书卷" @change="jumpToBook">
          <option v-for="book in allBooks" :key="book.code" :value="book.code">{{ book.name }}</option>
        </select>
        <select :value="visibleChapter" aria-label="选择章节" @change="jumpToChapter">
          <option v-for="chapter in readerBook.chapterCount" :key="chapter" :value="chapter">{{ chapter }}章</option>
        </select>
        <select :value="jumpVerse" :disabled="!visibleChapterVerseNumbers.length" aria-label="选择经节" @change="jumpToVerse">
          <option value="">节</option>
          <option v-for="verse in visibleChapterVerseNumbers" :key="verse" :value="verse">{{ verse }}节</option>
        </select>
      </nav>
      <div class="bible-topbar-actions">
        <span class="bible-resource-link" title="资料">资</span>
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
        <button v-if="view !== 'home'" type="button" class="bible-topbar-button home" @click="returnHome"><Home :size="19" />目录</button>
      </div>
    </header>

    <div v-if="catalogBusy" class="bible-state">正在展开圣经目录…</div>
    <div v-else-if="catalogError" class="bible-state error"><span>{{ catalogError }}</span><button @click="ensureCatalog">重新加载</button></div>

    <main v-else-if="view === 'home'" class="bible-home">
      <nav class="bible-home-tabs" role="tablist" aria-label="书房功能">
        <button type="button" role="tab" :aria-selected="homeSection === 'search'" :class="{ active: homeSection === 'search' }" @click="homeSection = 'search'"><Search :size="18" />经文检索</button>
        <button type="button" role="tab" :aria-selected="homeSection === 'favorites'" :class="{ active: homeSection === 'favorites' }" @click="homeSection = 'favorites'"><Bookmark :size="18" />经文收藏<span>{{ favorites.length }}</span></button>
      </nav>

      <section v-if="homeSection === 'search'" class="bible-search-panel">
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

      <section v-else class="bible-favorites" aria-label="经文收藏夹">
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

      <section v-if="catalog" class="bible-catalog">
        <header><BookOpen :size="24" /><div><h2>经卷目录</h2><p>旧约39卷 · 新约27卷</p></div></header>
        <section><h3>旧约</h3><div class="bible-book-grid"><button v-for="book in catalog.oldTestament" :key="book.code" type="button" @click="chooseBook(book)"><strong>{{ book.name }}</strong><small>{{ book.chapterCount }}章</small></button></div></section>
        <section><h3>新约</h3><div class="bible-book-grid"><button v-for="book in catalog.newTestament" :key="book.code" type="button" @click="chooseBook(book)"><strong>{{ book.name }}</strong><small>{{ book.chapterCount }}章</small></button></div></section>
      </section>
    </main>

    <main v-else-if="view === 'chapters' && selectedBook" class="bible-chapter-picker">
      <div class="bible-paper-heading"><span>选择章节</span><h1>{{ selectedBook.name }}</h1><p>共 {{ selectedBook.chapterCount }} 章</p></div>
      <div class="bible-chapter-grid"><button v-for="chapter in selectedBook.chapterCount" :key="chapter" type="button" @click="openReader(selectedBook, chapter)">{{ chapter }}</button></div>
    </main>

    <main v-else-if="view === 'reader' && readerBook" ref="readerScroll" class="bible-reader" @scroll.passive="handleReaderScroll">
      <div v-if="loadedChapters[0] === 1" class="bible-book-boundary">本卷开始</div>
      <section v-for="chapter in loadedChapters" :key="chapter" class="bible-reader-chapter" :data-reader-chapter="chapter">
        <header><span>{{ readerBook.name }}</span><h1>第{{ chapter }}章</h1></header>
        <div class="bible-chapter-text">
          <template v-for="(block, blockIndex) in readerChapters[chapter]?.blocks || []" :key="`${chapter}-${blockIndex}`">
            <h2 v-if="block.type === 'heading'" class="bible-structure-heading" :class="`level-${block.level}`">{{ block.text }}</h2>
            <p v-else-if="block.type === 'parallel'" class="bible-structure-parallel">{{ block.text }}</p>
            <p v-else-if="block.type === 'description'" class="bible-structure-description">{{ block.text }}</p>
            <p v-else-if="block.type === 'speaker'" class="bible-structure-speaker">{{ block.text }}</p>
            <div v-else-if="block.type === 'spacing'" class="bible-structure-spacing" aria-hidden="true"></div>
            <p v-else-if="block.type === 'paragraph'" class="bible-structure-paragraph" :class="block.style">
              <span
                v-for="fragment in block.fragments"
                :key="`${fragment.verse.reference}-${fragment.start}-${fragment.end}`"
                class="bible-reader-verse"
                :class="{ target: isTargetVerse(fragment.verse), selected: isSelectedVerse(fragment.verse), favorite: isFavoriteVerse(fragment.verse) }"
                :style="favoriteVerseStyle(fragment.verse)"
                :data-verse-key="fragment.showVerseNumber ? `${readerBook.code}-${fragment.verse.chapter}-${fragment.verse.verse}` : undefined"
                role="button"
                tabindex="0"
                :aria-pressed="isSelectedVerse(fragment.verse)"
                :title="isFavoriteVerse(fragment.verse) ? '已收藏；按住 Shift 可跨章范围选择' : '点选经文；按住 Shift 可跨章范围选择'"
                @click="selectVerse(fragment.verse, $event.shiftKey)"
                @keydown.enter.prevent="selectVerse(fragment.verse, $event.shiftKey)"
              ><sup v-if="fragment.showVerseNumber">{{ fragment.verse.verse }}</sup><template v-for="(segment, index) in verseSegments(fragment.text, fragmentMatches(fragment))" :key="index"><mark v-if="segment.highlighted">{{ segment.text }}</mark><template v-else>{{ segment.text }}</template></template></span>
            </p>
          </template>
        </div>
      </section>
      <div v-if="readerError" class="bible-state error">{{ readerError }}</div>
      <div v-if="loadedChapters[loadedChapters.length - 1] === readerBook.chapterCount" class="bible-book-boundary">本卷结束</div>
      <div v-else class="bible-reader-loading">继续向下阅读下一章</div>
    </main>

    <footer v-if="view === 'reader' && selectedVerses.length" class="bible-verse-action">
      <div>
        <strong>{{ selectedVerseSummary }}</strong>
        <small>{{ selectedVerses.length === 1 ? selectedVerses[0].text : '按住 Shift 点选另一节，可连续选择并跨章节' }}</small>
        <span class="bible-favorite-color-picker" aria-label="收藏标线颜色">
          <em>标线</em>
          <button
            v-for="preset in BIBLE_FAVORITE_COLOR_PRESETS"
            :key="preset.color"
            type="button"
            class="bible-favorite-color-swatch"
            :class="{ active: selectedFavoriteColor === preset.color }"
            :style="{ '--swatch-color': preset.color }"
            :aria-label="`${preset.name}标线`"
            :title="preset.name"
            :disabled="favoritesBusy"
            @click="chooseFavoriteColor(preset.color)"
          ></button>
        </span>
      </div>
      <div class="bible-verse-action-buttons">
        <button type="button" @click="copySelectedVerses"><ClipboardCopy :size="18" />复制</button>
        <button type="button" :disabled="favoritesBusy" @click="updateSelectedFavorites(allSelectedFavorited)"><BookmarkCheck v-if="allSelectedFavorited" :size="18" /><Bookmark v-else :size="18" />{{ allSelectedFavorited ? "取消收藏" : "收藏" }}</button>
        <button v-if="selectedVerses.length === 1" type="button" :disabled="!canSend || !!sendBusyKey" :title="canSend ? '' : sendUnavailableReason" @click="sendLookup(singleVerseLookup(selectedVerses[0]), selectedVerses[0].reference)"><Send :size="18" />发送</button>
        <button type="button" class="secondary" aria-label="清除选择" title="清除选择" @click="clearVerseSelection"><X :size="18" /></button>
      </div>
    </footer>
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
.bible-topbar-button.home { justify-self: end; }
.bible-topbar-actions { justify-self: end; display: flex; align-items: center; gap: 10px; }
.bible-topbar-title { min-width: 0; border: 0; padding: 5px 8px; display: grid; justify-items: center; color: inherit; background: transparent; font: inherit; line-height: 1.2; }
.bible-topbar-title strong { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: "Songti SC", "STSong", serif; font-size: 18px; }
.bible-topbar-title small { margin-top: 3px; color: #92775b; display: inline-flex; align-items: center; gap: 5px; font-size: 11px; white-space: nowrap; }
.bible-topbar-title small svg { color: #ad875a; }
.bible-jump-nav { min-width: 0; width: min(100%, 360px); justify-self: center; display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(50px, .72fr) minmax(46px, .66fr); gap: 5px; }
.bible-jump-nav select { min-width: 0; height: 34px; border: 1px solid rgba(128, 97, 63, .25); border-radius: 8px; padding: 0 6px; color: #5e452f; background: #fffaf1; font: inherit; font-size: 13px; font-weight: 700; outline: none; cursor: pointer; }
.bible-jump-nav select:focus { border-color: #967046; box-shadow: 0 0 0 2px rgba(150, 112, 70, .14); }
.bible-jump-nav select:disabled { opacity: .5; cursor: wait; }
.bible-font-control { flex: 0 0 auto; }
.bible-resource-link, .bible-font-trigger { width: 36px; height: 36px; border: 0; border-radius: 8px; color: #725537; background: rgba(128, 97, 63, .09); font: inherit; font-size: 18px; font-weight: 800; line-height: 1; cursor: pointer; }
.bible-resource-link { display: grid; place-items: center; text-decoration: none; cursor: default; }
.bible-resource-link:hover, .bible-font-trigger:hover { background: rgba(128, 97, 63, .16); }
.bible-font-stepper { min-height: 36px; display: flex; align-items: center; gap: 4px; }
.bible-font-stepper button, .bible-font-stepper span { min-width: 34px; height: 34px; border-radius: 7px; display: grid; place-items: center; }
.bible-font-stepper button { border: 0; padding: 0 7px; color: #654a31; background: rgba(128, 97, 63, .12); font: inherit; font-size: 14px; font-weight: 800; cursor: pointer; }
.bible-font-stepper button:disabled { opacity: .4; cursor: not-allowed; }
.bible-font-stepper span { border: 1px solid rgba(128, 97, 63, .28); color: #4f3b29; background: #fffaf1; font-size: 13px; font-weight: 800; }
.bible-home, .bible-chapter-picker, .bible-reader { min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.bible-home { padding: 26px max(16px, calc((100vw - 1120px) / 2)) calc(44px + var(--safe-bottom)); }
.bible-home-tabs { max-width: 820px; margin: 0 auto 12px; padding: 5px; border: 1px solid rgba(116, 84, 48, .14); border-radius: 14px; background: rgba(233, 223, 207, .86); display: grid; grid-template-columns: 1fr 1fr; gap: 5px; box-shadow: 0 8px 24px rgba(75, 51, 25, .06); }
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
.bible-reader { padding: 34px max(20px, calc((100vw - 760px) / 2)) calc(100px + var(--safe-bottom)); scroll-behavior: smooth; }
.bible-reader-chapter { scroll-margin-top: 80px; padding: 12px 0 42px; }
.bible-reader-chapter > header { margin-bottom: 22px; text-align: center; font-family: "Songti SC", "STSong", serif; }
.bible-reader-chapter > header span { color: #947657; letter-spacing: .18em; }
.bible-reader-chapter > header h1 { margin: 8px 0 0; font-size: 32px; }
.bible-chapter-text { font-family: "Songti SC", "STSong", "Noto Serif CJK SC", serif; font-size: var(--bible-font-size); line-height: 1.95; }
.bible-structure-heading { margin: 2.1em 0 .75em; color: #684728; text-align: center; font-size: 1.25em; line-height: 1.4; }
.bible-structure-heading:first-child { margin-top: 0; }
.bible-structure-heading.level-2 { font-size: 1.08em; }
.bible-structure-parallel { margin: -.45em 0 1.2em; color: #9a7d60; text-align: center; font-size: .72em; line-height: 1.55; }
.bible-structure-description { margin: 0 0 1em; color: #775b3f; text-align: center; font-size: .88em; font-style: italic; line-height: 1.65; }
.bible-structure-speaker { margin: 1em 0 .25em; color: #8a6847; font-size: .82em; font-weight: 700; }
.bible-structure-spacing { height: .9em; }
.bible-structure-paragraph { margin: 0 0 1em; text-align: justify; }
.bible-structure-paragraph.poetry { margin: 0; padding-left: 1.75em; text-indent: -1.75em; text-align: left; }
.bible-reader-verse { border-radius: 4px; padding: 2px 1px; cursor: pointer; transition: background-color 160ms ease; }
.bible-reader-verse::after { content: " "; }
.bible-reader-verse sup { margin-right: 2px; color: #9b7a58; font-size: .55em; font-weight: 700; vertical-align: super; }
.bible-reader-verse.target { background: rgba(222, 177, 70, .22); }
.bible-reader-verse.favorite { box-shadow: inset 0 -0.24em color-mix(in srgb, var(--bible-favorite-color, #f28b82) 72%, transparent); }
.bible-reader-verse.selected { outline: 1px solid rgba(150, 104, 52, .55); background: rgba(221, 180, 92, .28); }
.bible-book-boundary, .bible-reader-loading { padding: 16px 0 28px; color: #9a8168; text-align: center; font-family: "Songti SC", "STSong", serif; }
.bible-verse-action { position: fixed; left: 50%; bottom: calc(14px + var(--safe-bottom)); z-index: 3; width: min(700px, calc(100vw - 24px)); transform: translateX(-50%); padding: 10px 11px 10px 14px; border: 1px solid rgba(102, 70, 39, .2); border-radius: 14px; background: rgba(255, 252, 245, .97); box-shadow: 0 13px 36px rgba(58, 39, 20, .2); display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; }
.bible-verse-action div { min-width: 0; display: grid; gap: 2px; }
.bible-verse-action small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #816a53; }
.bible-verse-action button { min-height: 42px; border: 0; border-radius: 10px; padding: 0 14px; color: white; background: #80613f; display: inline-flex; align-items: center; gap: 6px; font: inherit; font-weight: 700; cursor: pointer; }
.bible-verse-action .bible-verse-action-buttons { display: flex; align-items: center; gap: 7px; }
.bible-favorite-color-picker { min-height: 24px; margin-top: 5px; display: flex; align-items: center; gap: 7px; }
.bible-favorite-color-picker em { color: #816a53; font-size: 11px; font-style: normal; font-weight: 700; }
.bible-verse-action .bible-favorite-color-swatch { width: 21px; height: 21px; min-height: 21px; border: 2px solid rgba(255, 255, 255, .94); border-radius: 999px; padding: 0; display: block; background: var(--swatch-color); box-shadow: 0 0 0 1px rgba(84, 57, 31, .2); }
.bible-verse-action .bible-favorite-color-swatch.active { outline: 2px solid #6f5133; outline-offset: 2px; }
.bible-verse-action button.secondary { padding: 0 11px; color: #74583b; background: #eee3d2; }
.bible-state { display: grid; place-items: center; align-content: center; gap: 12px; min-height: 220px; color: #80674e; }
.bible-state.error { color: #a33d30; }
.bible-state button { border: 0; border-radius: 9px; padding: 9px 14px; color: white; background: #80613f; }
.bible-toast { position: fixed; left: 50%; bottom: calc(76px + var(--safe-bottom)); z-index: 5; transform: translateX(-50%); max-width: calc(100vw - 32px); padding: 10px 16px; border-radius: 999px; color: white; background: rgba(55, 41, 28, .9); box-shadow: 0 8px 24px rgba(0, 0, 0, .18); white-space: nowrap; }
@media (max-width: 900px) { .bible-book-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
@media (max-width: 600px) {
  .bible-topbar { padding-left: 10px; padding-right: 10px; grid-template-columns: 62px minmax(0, 1fr) auto; }
  .bible-topbar-actions { gap: 5px; }
  .bible-jump-nav { gap: 3px; grid-template-columns: minmax(0, 1.2fr) minmax(48px, .72fr) minmax(44px, .65fr); }
  .bible-jump-nav select { padding: 0 3px; font-size: 12px; }
  .bible-topbar-button.home { font-size: 0; }
  .bible-topbar-button.home svg { width: 20px; height: 20px; }
  .bible-font-stepper { position: absolute; right: 10px; top: calc(var(--safe-top) + 10px); z-index: 2; padding: 3px; border-radius: 10px; background: rgba(250, 246, 237, .98); box-shadow: 0 8px 24px rgba(74, 52, 29, .18); }
  .bible-topbar-title strong { font-size: 17px; }
  .bible-topbar-title small { gap: 3px; font-size: 10px; }
  .bible-home { padding: 15px 12px calc(34px + var(--safe-bottom)); }
  .bible-home-tabs { margin-bottom: 9px; }
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
  .bible-reader { padding-top: 24px; }
  .bible-verse-action { grid-template-columns: minmax(0, 1fr); }
  .bible-verse-action .bible-verse-action-buttons { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)) auto; }
  .bible-verse-action button { justify-content: center; padding: 0 9px; }
}
@media (prefers-reduced-motion: reduce) { .bible-workspace { transition-duration: 1ms; } .bible-reader { scroll-behavior: auto; } }
</style>
