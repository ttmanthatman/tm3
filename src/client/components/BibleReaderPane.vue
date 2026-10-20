<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Home, MoreHorizontal, Brush, StickyNote, ArrowLeft, Bookmark, BookmarkCheck, ClipboardCopy, Link2, Play, Send, Eraser, X } from "lucide-vue-next";
import type {
  BibleBookCatalogDTO,
  BibleCatalogDTO,
  BibleChapterDTO,
  BibleChapterVerseFragmentDTO,
  BibleFavoriteDTO,
  BibleFavoriteKeyDTO,
  BibleLookupDTO,
  BibleTextMatchRangeDTO,
  BibleVerseLineDTO
} from "@shared/types";
import {
  bibleVerseGroupReference,
  bibleVerseKey,
  formatBibleVersesForCopy,
  groupContinuousBibleVerses,
  selectBibleVerseKeys
} from "../bibleVerseActions";
import BibleTranslationSelect from "../features/bible/BibleTranslationSelect.vue";
import BiblePassageShareDialog from "../features/bible/BiblePassageShareDialog.vue";
import { createReaderInsertionGate } from "../features/bible/readerInsertionGate";
import BiblePlayThroughIcon from "../features/bible/BiblePlayThroughIcon.vue";
import { useLongPressAction } from "../features/bible/useLongPressAction";
import { nearbyBibleChapterPreloadOrder, preservedScrollTop } from "../bibleReaderLoading";
import { bibleParallelReferenceSegments } from "../bibleParallelReferences";
import { useNoteMarkers } from "../features/bible/notes/useNoteMarkers";
import { useCopyworkMarkers } from "../features/bible/copywork/useCopyworkMarkers";
import { DEFAULT_BIBLE_TRANSLATION_ID, fetchBibleChapter } from "../bibleChapterCache";
import type { BiblePaneLocationState, BiblePaneState, BibleReaderTarget } from "../bibleWorkspaceState";
import {
  BIBLE_FAVORITE_COLOR_PRESETS,
  DEFAULT_BIBLE_FAVORITE_COLOR,
  normalizeBibleFavoriteColor
} from "@shared/bibleFavoriteColors";

const props = defineProps<{
  copyworkRevision?: number;
  paneId: string;
  label: string;
  initialState: BiblePaneState;
  catalog: BibleCatalogDTO;
  fontSize: number;
  active: boolean;
  receiving: boolean;
  canClose: boolean;
  channelName: string;
  canSend: boolean;
  sendUnavailableReason: string;
  sendPassage: (lookup: BibleLookupDTO, includeTranslation?: boolean) => Promise<void>;
  sendText: (content: string, requestId: string) => Promise<void>;
  canGoBack: boolean;
  favorites: BibleFavoriteDTO[];
  favoritesBusy: boolean;
  updateFavorites: (verses: BibleFavoriteKeyDTO[], favorited: boolean, color?: string) => Promise<void>;
  /** 有声圣经正在朗读的经节，格式 `CODE-章-节`（与 data-verse-key 一致） */
  playingVerseKey?: string | null;
  /** 有声圣经处于播放会话中：点经节改为跳到该节朗读，而不是选中 */
  audioSeekable?: boolean;
  /** 有声圣经功能对用户开放：选中经文的 footer 显示「播放」入口 */
  audioEnabled?: boolean;
  /** 「连播到底」已开启：footer 播放按钮显示绿色 + 三角带箭头图标 */
  audioPlayThrough?: boolean;
}>();

const emit = defineEmits<{
  back: [];
  home: [];
  activate: [paneId: string];
  close: [paneId: string];
  "toggle-receiver": [paneId: string];
  "open-reference": [sourcePaneId: string, reference: string];
  "state-change": [paneId: string, state: BiblePaneState];
  toast: [message: string];
  "note-start": [selection: { translation: string; bookCode: string; verses: BibleVerseLineDTO[] }];
  "note-browse": [filter: { translation: string; bookCode: string; chapter: number; verse: number }];
  "copy-start": [selection: { translation: string; bookCode: string; verses: BibleVerseLineDTO[] }];
  "copy-browse": [filter: { translation: string; bookCode: string; chapter: number; verse: number }];
  "verse-seek": [paneId: string, chapter: number, verse: number];
  "play-selection": [paneId: string];
  "toggle-play-through": [paneId: string];
}>();

type TextSegment = { text: string; highlighted: boolean };

const navigationOpen = ref(false);
const readerBook = ref<BibleBookCatalogDTO>(props.initialState.book);
const translation = ref(props.initialState.translation || DEFAULT_BIBLE_TRANSLATION_ID);
const readerChapters = ref<Record<number, BibleChapterDTO>>({});
const readerBusyChapters = ref<Set<number>>(new Set());
const readerError = ref("");
const readerScroll = ref<HTMLElement | null>(null);
const visibleChapter = ref(Math.max(1, props.initialState.visibleChapter));
const jumpVerse = ref<number | "">(props.initialState.targetVerse?.verse || "");
const targetVerse = ref<BibleReaderTarget | null>(props.initialState.targetVerse);
const linkedTargetVerseKeys = ref<Set<string>>(new Set());
const selectedVerseKeys = ref<Set<string>>(new Set(props.initialState.selectedVerseKeys || []));
const selectionAnchorKey = ref<string | null>(props.initialState.selectionAnchorKey || null);
const selectedFavoriteColor = ref<string>(DEFAULT_BIBLE_FAVORITE_COLOR);
const backStack = ref<BiblePaneLocationState[]>([...(props.initialState.backStack || [])]);
const passageShareDialog = ref<InstanceType<typeof BiblePassageShareDialog> | null>(null);
const insertionGate = createReaderInsertionGate();
let readerNavigating = false;
let readerGeneration = 0;
let nearbyPreloadTimer = 0;
let stateTimer = 0;
let suppressReaderScrollUntil = 0;

const allBooks = computed(() => [...props.catalog.oldTestament, ...props.catalog.newTestament]);
const currentTranslation = computed(() => props.catalog.translations.find((item) => item.id === translation.value) || null);
const translationName = computed(() => currentTranslation.value?.name || props.catalog.translation);
const translationCopyright = computed(() => currentTranslation.value?.copyright || "");
const loadedChapters = computed(() => Object.keys(readerChapters.value).map(Number).sort((left, right) => left - right));
const loadedVerses = computed(() => loadedChapters.value.flatMap((chapter) => readerChapters.value[chapter]?.verses || []));
const visibleChapterVerseNumbers = computed(() => {
  const numbers = new Set<number>();
  for (const verse of readerChapters.value[visibleChapter.value]?.verses || []) {
    for (let number = verse.verse; number <= verse.endVerse; number += 1) numbers.add(number);
  }
  return [...numbers].sort((left, right) => left - right);
});
const orderedLoadedVerseKeys = computed(() => loadedVerses.value.map((verse) => bibleVerseKey(readerBook.value.code, verse)));
const selectedVerses = computed(() => loadedVerses.value.filter((verse) => selectedVerseKeys.value.has(bibleVerseKey(readerBook.value.code, verse))));
const favoriteVerseKeys = computed(() => new Set(props.favorites.map((favorite) => bibleVerseKey(favorite.bookCode, favorite.verseLine))));
const favoriteVerseColors = computed(() => new Map(
  props.favorites.map((favorite) => [bibleVerseKey(favorite.bookCode, favorite.verseLine), normalizeBibleFavoriteColor(favorite.color)])
));
const allSelectedFavorited = computed(() => selectedVerses.value.length > 0
  && selectedVerses.value.every((verse) => favoriteVerseKeys.value.has(bibleVerseKey(readerBook.value.code, verse))));
const selectedPassageLookups = computed<BibleLookupDTO[]>(() => groupContinuousBibleVerses(selectedVerses.value).map((group) => {
  const reference = group.length === 1 ? group[0].reference : bibleVerseGroupReference(group);
  return {
    reference,
    normalizedReference: reference,
    translation: translationName.value,
    sourceId: translation.value,
    verses: group
  };
}));
const { markers: copyworkMarkers, error: copyworkMarkerError, reload: reloadCopyworkMarkers } = useCopyworkMarkers(translation, () => readerBook.value.code, loadedChapters, () => props.copyworkRevision || 0);
const { markers: noteMarkers, error: noteMarkerError, reload: reloadNoteMarkers } = useNoteMarkers(translation, () => readerBook.value.code, loadedChapters);
function isFinalFragment(fragment: BibleChapterVerseFragmentDTO) {
  const blocks = readerChapters.value[fragment.verse.chapter]?.blocks || [];
  const fragments = blocks.flatMap((block) => block.type === "paragraph" ? block.fragments : []).filter((f) => f.verse.verse === fragment.verse.verse);
  return fragments.at(-1) === fragment;
}

const selectedVerseSummary = computed(() => selectedPassageLookups.value.length === 1
  ? selectedPassageLookups.value[0].normalizedReference
  : `已选 ${selectedVerses.value.length} 节经文`);

onMounted(async () => {
  await openLocation({
    book: props.initialState.book,
    visibleChapter: props.initialState.visibleChapter,
    targetVerse: props.initialState.targetVerse,
    scrollAnchor: props.initialState.scrollAnchor
  });
  selectedVerseKeys.value = new Set(props.initialState.selectedVerseKeys || []);
  selectionAnchorKey.value = props.initialState.selectionAnchorKey || null;
  emitState();
});

onBeforeUnmount(() => {
  insertionGate.cancel();
  readerGeneration += 1;
  if (nearbyPreloadTimer) window.clearTimeout(nearbyPreloadTimer);
  if (stateTimer) window.clearTimeout(stateTimer);
});

watch([selectedVerseKeys, () => props.favorites], () => {
  const first = selectedVerses.value[0];
  if (first && isFavoriteVerse(first)) selectedFavoriteColor.value = favoriteColorForVerse(first);
  scheduleStateChange();
});

function scheduleStateChange() {
  if (stateTimer) window.clearTimeout(stateTimer);
  stateTimer = window.setTimeout(emitState, 160);
}

function emitState() {
  emit("state-change", props.paneId, snapshot());
}

function snapshot(): BiblePaneState {
  return {
    id: props.paneId,
    book: readerBook.value,
    visibleChapter: visibleChapter.value,
    targetVerse: targetVerse.value,
    scrollAnchor: captureScrollAnchor(),
    selectedVerseKeys: [...selectedVerseKeys.value],
    selectionAnchorKey: selectionAnchorKey.value,
    backStack: [...backStack.value],
    translation: translation.value
  };
}

function captureLocation(): BiblePaneLocationState {
  const state = snapshot();
  return {
    book: state.book,
    visibleChapter: state.visibleChapter,
    targetVerse: state.targetVerse,
    scrollAnchor: state.scrollAnchor
  };
}

function captureScrollAnchor() {
  const scroller = readerScroll.value;
  if (!scroller) return null;
  const scrollerTop = scroller.getBoundingClientRect().top;
  const anchors = Array.from(scroller.querySelectorAll<HTMLElement>("[data-scroll-anchor]"));
  // A chapter section spans all its verses. Only its heading may act as a
  // chapter anchor; otherwise it would always win over the verse being read.
  const anchor = anchors.find((element) => {
    const visiblePart = element.dataset.anchorVerse ? element : element.querySelector("header");
    return visiblePart && visiblePart.getBoundingClientRect().bottom > scrollerTop + 44;
  }) || anchors[0];
  if (!anchor) return { chapter: visibleChapter.value, verse: null, offset: 0 };
  return {
    chapter: Number(anchor.dataset.anchorChapter || visibleChapter.value),
    verse: anchor.dataset.anchorVerse ? Number(anchor.dataset.anchorVerse) : null,
    offset: anchor.getBoundingClientRect().top - scrollerTop
  };
}

async function openLocation(
  location: BiblePaneLocationState,
  pushCurrent = false,
  linkedTargets: ReadonlySet<string> | null = null
) {
  if (pushCurrent && readerBook.value) backStack.value = [...backStack.value.slice(-19), captureLocation()];
  const generation = ++readerGeneration;
  insertionGate.cancel();
  readerNavigating = true;
  suppressReaderScrollUntil = Date.now() + 500;
  if (nearbyPreloadTimer) window.clearTimeout(nearbyPreloadTimer);
  readerBook.value = location.book;
  readerChapters.value = {};
  readerBusyChapters.value = new Set();
  readerError.value = "";
  targetVerse.value = location.targetVerse;
  linkedTargetVerseKeys.value = new Set(linkedTargets || []);
  clearVerseSelection(false);
  visibleChapter.value = location.visibleChapter;
  jumpVerse.value = location.targetVerse?.verse || "";
  await loadChapter(location.visibleChapter);
  if (generation !== readerGeneration || readerBook.value.code !== location.book.code) return;
  await nextTick();
  if (location.scrollAnchor) restoreScrollAnchor(location.scrollAnchor);
  else scrollToLocation(location);
  readerNavigating = false;
  suppressReaderScrollUntil = Date.now() + 180;
  scheduleNearbyChapterPreloads(location.book, location.visibleChapter, generation);
  emitState();
}

async function openLookup(lookup: BibleLookupDTO, pushCurrent = true) {
  const first = lookup.verses[0];
  if (!first) return;
  const book = allBooks.value.find((candidate) => candidate.name === first.book);
  if (!book) throw new Error("暂时无法定位这处经文");
  const targetKeys = new Set<string>();
  for (const verse of lookup.verses) {
    if (verse.book !== first.book) continue;
    for (let number = verse.verse; number <= verse.endVerse; number += 1) {
      targetKeys.add(bibleVerseKey(book.code, { chapter: verse.chapter, verse: number }));
    }
  }
  await openLocation({
    book,
    visibleChapter: first.chapter,
    targetVerse: { chapter: first.chapter, verse: first.verse, endVerse: first.endVerse, matches: [] },
    scrollAnchor: null
  }, pushCurrent, targetKeys);
  const extraChapters = [...new Set(lookup.verses.filter((verse) => verse.book === first.book).map((verse) => verse.chapter))]
    .filter((chapter) => chapter !== first.chapter);
  await Promise.all(extraChapters.map((chapter) => loadChapter(chapter)));
  emitState();
}

async function goBack() {
  const previous = backStack.value.at(-1);
  if (!previous) { emit("back"); return; }
  backStack.value = backStack.value.slice(0, -1);
  await openLocation(previous, false);
}

function scrollToLocation(location: BiblePaneLocationState) {
  const scroller = readerScroll.value;
  if (!scroller) return;
  const selector = location.targetVerse
    ? `[data-verse-key="${location.book.code}-${location.visibleChapter}-${location.targetVerse.verse}"]`
    : `[data-reader-chapter="${location.visibleChapter}"]`;
  const element = scroller.querySelector<HTMLElement>(selector);
  if (!element) return;
  const scrollerRect = scroller.getBoundingClientRect();
  const desiredOffset = location.targetVerse ? Math.max(70, scroller.clientHeight * .34) : 54;
  scroller.scrollTop += element.getBoundingClientRect().top - scrollerRect.top - desiredOffset;
}

function restoreScrollAnchor(anchor: NonNullable<BiblePaneLocationState["scrollAnchor"]>) {
  const scroller = readerScroll.value;
  if (!scroller) return;
  const selector = anchor.verse === null
    ? `[data-reader-chapter="${anchor.chapter}"]`
    : `[data-anchor-chapter="${anchor.chapter}"][data-anchor-verse="${anchor.verse}"]`;
  const element = scroller.querySelector<HTMLElement>(selector);
  if (!element) return;
  scroller.scrollTop += element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - anchor.offset;
}

function jumpToBook(event: Event) {
  const book = allBooks.value.find((candidate) => candidate.code === (event.target as HTMLSelectElement).value);
  if (book) void openLocation({ book, visibleChapter: 1, targetVerse: null, scrollAnchor: null });
}

function jumpToChapter(event: Event) {
  const chapter = Number((event.target as HTMLSelectElement).value);
  if (Number.isInteger(chapter)) void openLocation({ book: readerBook.value, visibleChapter: chapter, targetVerse: null, scrollAnchor: null });
}

function jumpToVerse(event: Event) {
  const verse = Number((event.target as HTMLSelectElement).value);
  if (!Number.isInteger(verse) || verse < 1) return;
  void openLocation({
    book: readerBook.value,
    visibleChapter: visibleChapter.value,
    targetVerse: { chapter: visibleChapter.value, verse, endVerse: verse, matches: [] },
    scrollAnchor: null
  });
}

function changeTranslation(next: string) {
  if (!next || next === translation.value) return;
  if (!props.catalog.translations.some((item) => item.id === next)) return;
  translation.value = next;
  // 保留返回栈：章节坐标在各译本间通用
  void openLocation({ book: readerBook.value, visibleChapter: visibleChapter.value, targetVerse: null, scrollAnchor: null });
}

/** 由工作区在打开检索结果前静默切换译本（不触发加载，紧随其后的 openLocation/openLookup 会按新译本加载） */
function applyTranslation(next: string) {
  if (!next || next === translation.value) return;
  if (!props.catalog.translations.some((item) => item.id === next)) return;
  translation.value = next;
}

function scheduleNearbyChapterPreloads(book: BibleBookCatalogDTO, chapter: number, generation: number) {
  const translationId = translation.value;
  const queue = nearbyBibleChapterPreloadOrder(chapter, book.chapterCount, 5).slice(1);
  const pump = () => {
    if (generation !== readerGeneration || readerBook.value.code !== book.code || translation.value !== translationId) return;
    const nextChapter = queue.shift();
    if (!nextChapter) return;
    void fetchBibleChapter(book, nextChapter, translationId).catch(() => undefined).finally(() => {
      if (generation !== readerGeneration) return;
      nearbyPreloadTimer = window.setTimeout(pump, 420);
    });
  };
  nearbyPreloadTimer = window.setTimeout(pump, 280);
}

async function loadChapter(chapter: number, prepend = false) {
  const book = readerBook.value;
  const translationId = translation.value;
  const generation = readerGeneration;
  if (chapter < 1 || chapter > book.chapterCount || readerChapters.value[chapter] || readerBusyChapters.value.has(chapter)) return;
  readerBusyChapters.value = new Set(readerBusyChapters.value).add(chapter);
  try {
    const result = await fetchBibleChapter(book, chapter, translationId);
    if (generation !== readerGeneration) return;
    const insertsBefore = prepend || (loadedChapters.value.length > 0 && chapter < loadedChapters.value[0]);
    if (insertsBefore && !(await insertionGate.wait())) return;
    if (generation !== readerGeneration) return;
    // Capture at insertion time: the reader can keep moving while the request
    // is pending. A pre-request anchor would undo that native scrolling.
    const scroller = readerScroll.value;
    const anchorChapter = insertsBefore ? loadedChapters.value[0] : undefined;
    const anchorBefore = anchorChapter
      ? scroller?.querySelector<HTMLElement>(`[data-reader-chapter="${anchorChapter}"]`)?.getBoundingClientRect().top
      : undefined;
    readerChapters.value = { ...readerChapters.value, [chapter]: result };
    await nextTick();
    if (generation !== readerGeneration) return;
    if (scroller && anchorChapter && anchorBefore !== undefined) {
      const anchorAfter = scroller.querySelector<HTMLElement>(`[data-reader-chapter="${anchorChapter}"]`)?.getBoundingClientRect().top;
      if (anchorAfter !== undefined) scroller.scrollTop = preservedScrollTop(scroller.scrollTop, anchorBefore, anchorAfter);
    }
  } catch (error) {
    if (generation === readerGeneration) readerError.value = error instanceof Error ? error.message : "章节加载失败";
  } finally {
    if (generation === readerGeneration) {
      const busy = new Set(readerBusyChapters.value);
      busy.delete(chapter);
      readerBusyChapters.value = busy;
    }
  }
}

function handleReaderScroll() {
  insertionGate.motion();
  const scroller = readerScroll.value;
  if (!scroller || readerNavigating || !loadedChapters.value.length || Date.now() < suppressReaderScrollUntil) return;
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
  const last = loadedChapters.value.at(-1)!;
  if (scroller.scrollTop < 220 && first > 1) void loadChapter(first - 1, true);
  if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 320 && last < readerBook.value.chapterCount) void loadChapter(last + 1);
  scheduleStateChange();
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
  if (linkedTargetVerseKeys.value.size) {
    for (let number = verse.verse; number <= verse.endVerse; number += 1) {
      if (linkedTargetVerseKeys.value.has(bibleVerseKey(readerBook.value.code, { chapter: verse.chapter, verse: number }))) return true;
    }
    return false;
  }
  const target = targetVerse.value;
  return !!target && target.chapter === verse.chapter && verse.verse <= target.endVerse && verse.endVerse >= target.verse;
}

function selectVerse(verse: BibleVerseLineDTO, shiftKey = false) {
  clearNavigationHighlight();
  const clickedKey = bibleVerseKey(readerBook.value.code, verse);
  selectedVerseKeys.value = selectBibleVerseKeys(
    orderedLoadedVerseKeys.value,
    selectedVerseKeys.value,
    clickedKey,
    selectionAnchorKey.value,
    shiftKey
  );
  if (!shiftKey || !selectionAnchorKey.value) selectionAnchorKey.value = clickedKey;
  scheduleStateChange();
}

// 有声圣经：播放会话中点经节 = 跳到该节朗读（prs.app 同款），不改动选集。
function handleVerseClick(verse: BibleVerseLineDTO, shiftKey = false) {
  if (props.audioSeekable && !shiftKey) {
    emit("verse-seek", props.paneId, verse.chapter, verse.verse);
    return;
  }
  selectVerse(verse, shiftKey);
}

const playingVerseTarget = computed(() => {
  const key = props.playingVerseKey;
  if (!key) return null;
  const match = /^(.+)-(\d+)-(\d+)$/.exec(key);
  if (!match || match[1] !== readerBook.value.code) return null;
  return { chapter: Number(match[2]), verse: Number(match[3]) };
});

function isPlayingVerse(verse: BibleVerseLineDTO) {
  const target = playingVerseTarget.value;
  return !!target && target.chapter === verse.chapter && verse.verse <= target.verse && target.verse <= verse.endVerse;
}

// 用户手动滚动后 3 秒内不跟随朗读进度，避免滚动打架。
const AUDIO_FOLLOW_COOLDOWN_MS = 3000;
let audioFollowSuppressedUntil = 0;
function noteUserScroll() {
  audioFollowSuppressedUntil = Date.now() + AUDIO_FOLLOW_COOLDOWN_MS;
}

function handleReaderWheel() {
  insertionGate.motion();
  noteUserScroll();
}

watch(() => props.playingVerseKey, (key) => {
  if (!key || Date.now() < audioFollowSuppressedUntil) return;
  const scroller = readerScroll.value;
  const element = scroller?.querySelector<HTMLElement>(`[data-verse-key="${key}"]`);
  if (!scroller || !element) return;
  const bounds = scroller.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  const margin = Math.min(120, bounds.height * 0.2);
  if (rect.top >= bounds.top + margin && rect.bottom <= bounds.bottom - margin) return;
  element.scrollIntoView({ block: "center", behavior: "smooth" });
}, { flush: "post" });

function clearNavigationHighlight() {
  targetVerse.value = null;
  linkedTargetVerseKeys.value = new Set();
  jumpVerse.value = "";
}

function clearVerseSelection(notify = true) {
  if (notify) clearNavigationHighlight();
  selectedVerseKeys.value = new Set();
  selectionAnchorKey.value = null;
  if (notify) scheduleStateChange();
}

function isSelectedVerse(verse: BibleVerseLineDTO) {
  return selectedVerseKeys.value.has(bibleVerseKey(readerBook.value.code, verse));
}

function isFavoriteVerse(verse: BibleVerseLineDTO) {
  return favoriteVerseKeys.value.has(bibleVerseKey(readerBook.value.code, verse));
}

function favoriteColorForVerse(verse: BibleVerseLineDTO) {
  return favoriteVerseColors.value.get(bibleVerseKey(readerBook.value.code, verse)) || DEFAULT_BIBLE_FAVORITE_COLOR;
}

function favoriteVerseStyle(verse: BibleVerseLineDTO) {
  return isFavoriteVerse(verse) ? { "--bible-favorite-color": favoriteColorForVerse(verse) } : undefined;
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

async function writeClipboard(text: string) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    emit("toast", `已复制 ${selectedVerses.value.length} 节经文`);
  } catch {
    emit("toast", "复制失败，请检查浏览器剪贴板权限");
  }
}

// footer「播放」键：短按朗读选中经文，长按切换「连播到底」（按钮变绿 + 三角带箭头图标）
const playThroughPress = useLongPressAction(() => emit("toggle-play-through", props.paneId));

function handlePlaySelectionClick() {
  if (playThroughPress.consumeClick()) return;
  emit("play-selection", props.paneId);
}

function favoriteKey(verse: BibleVerseLineDTO): BibleFavoriteKeyDTO {
  return { bookCode: readerBook.value.code, chapter: verse.chapter, verse: verse.verse };
}

async function updateSelectedFavorites(remove: boolean) {
  const verses = selectedVerses.value.map(favoriteKey);
  if (!verses.length || props.favoritesBusy) return;
  try {
    await props.updateFavorites(verses, !remove, remove ? undefined : selectedFavoriteColor.value);
    emit("toast", remove ? `已取消收藏 ${verses.length} 节经文` : `已收藏 ${verses.length} 节经文`);
    if (remove) {
      clearVerseSelection();
      targetVerse.value = null;
      linkedTargetVerseKeys.value = new Set();
    }
  } catch (error) {
    emit("toast", error instanceof Error ? error.message : "经文收藏更新失败");
  }
}

async function chooseFavoriteColor(color: string) {
  selectedFavoriteColor.value = normalizeBibleFavoriteColor(color);
  if (!allSelectedFavorited.value || props.favoritesBusy) return;
  try {
    await props.updateFavorites(selectedVerses.value.map(favoriteKey), true, selectedFavoriteColor.value);
    emit("toast", "已更新收藏标线颜色");
  } catch (error) {
    emit("toast", error instanceof Error ? error.message : "标线颜色更新失败");
  }
}

function sendSelectedVerses() {
  if (props.canSend) passageShareDialog.value?.open(selectedPassageLookups.value);
}

function selectedLookups(): BibleLookupDTO[] {
  return selectedPassageLookups.value;
}

defineExpose({ openLookup, openLocation, snapshot, goBack, applyTranslation, restoreReadingAnchor: restoreScrollAnchor, selectedLookups });
</script>

<template>
  <article
    class="bible-reader-pane"
    :class="{ active, receiving }"
    :style="{ '--bible-font-size': `${fontSize}px` }"
    @pointerdown="emit('activate', paneId)"
  >
    <header class="bible-pane-toolbar" :class="{ expanded: navigationOpen, 'has-highlight': targetVerse || linkedTargetVerseKeys.size || selectedVerseKeys.size }" data-no-bible-swipe @keydown.esc.stop="navigationOpen = false">
      <button type="button" class="bible-pane-icon" :aria-label="`${label} 窗格目录`" @click="emit('home')"><Home :size="17" /></button>
      <button type="button" class="bible-pane-navigation" :aria-label="`${navigationOpen ? '收起' : '展开'} ${label} 窗格导航`" :aria-expanded="navigationOpen" @click="navigationOpen = !navigationOpen"><span>{{ readerBook.name }} {{ visibleChapter }}章</span><MoreHorizontal :size="18" /></button>
      <button type="button" class="bible-pane-icon" :disabled="!backStack.length && !canGoBack" aria-label="返回" title="返回" @click.stop="goBack"><ArrowLeft :size="17" /></button>
      <nav class="bible-pane-jumps" :aria-label="`${label} 窗格经文跳转`">
        <BibleTranslationSelect :model-value="translation" :translations="catalog.translations" label="选择圣经译本" @update:model-value="changeTranslation" />
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
      <button
        type="button"
        class="bible-pane-icon receiver"
        :class="{ selected: receiving }"
        :aria-pressed="receiving"
        :aria-label="receiving ? `${label} 窗格正在接收所有经文链接` : `指定 ${label} 窗格接收所有经文链接`"
        :title="receiving ? '取消链接接收窗格' : '所有经文链接在这里打开'"
        @click.stop="emit('toggle-receiver', paneId)"
      ><Link2 :size="16" /></button>
      <button v-if="targetVerse || linkedTargetVerseKeys.size || selectedVerseKeys.size" type="button" class="bible-pane-icon" aria-label="清除经文高亮" title="清除经文高亮" @click.stop="clearVerseSelection()"><Eraser :size="16" /></button>
      <button v-if="canClose" type="button" class="bible-pane-icon close" :aria-label="`关闭 ${label} 窗格`" @click.stop="emit('close', paneId)"><X :size="16" /></button>
      <span class="bible-pane-label" :title="`${label} 窗格`">{{ label }}</span>
    </header>

    <main ref="readerScroll" class="bible-pane-scroll" @scroll.passive="handleReaderScroll"
      @touchstart.passive="insertionGate.touchStart()" @touchend.passive="insertionGate.touchEnd()" @touchcancel.passive="insertionGate.touchEnd()"
      @touchmove.passive="noteUserScroll" @pointerdown.passive="noteUserScroll"
      @wheel.passive="handleReaderWheel">
      <div v-if="loadedChapters[0] === 1" class="bible-book-boundary">本卷开始</div>
      <section v-for="chapter in loadedChapters" :key="chapter" class="bible-reader-chapter" :data-reader-chapter="chapter" data-scroll-anchor :data-anchor-chapter="chapter">
        <header><span>{{ readerBook.name }}</span><h1>第{{ chapter }}章</h1></header>
        <div class="bible-chapter-text">
          <template v-for="(block, blockIndex) in readerChapters[chapter]?.blocks || []" :key="`${chapter}-${blockIndex}`">
            <h2 v-if="block.type === 'heading'" class="bible-structure-heading" :class="`level-${block.level}`">{{ block.text }}</h2>
            <p v-else-if="block.type === 'parallel'" class="bible-structure-parallel">
              <template v-for="(segment, segmentIndex) in bibleParallelReferenceSegments(block.text)" :key="segmentIndex">
                <button v-if="segment.kind === 'link'" type="button" @click.stop="emit('open-reference', paneId, segment.reference)">{{ segment.text }}</button>
                <template v-else>{{ segment.text }}</template>
              </template>
            </p>
            <p v-else-if="block.type === 'description'" class="bible-structure-description">{{ block.text }}</p>
            <p v-else-if="block.type === 'speaker'" class="bible-structure-speaker">{{ block.text }}</p>
            <div v-else-if="block.type === 'spacing'" class="bible-structure-spacing" aria-hidden="true"></div>
            <p v-else-if="block.type === 'paragraph'" class="bible-structure-paragraph" :class="block.style">
              <template v-for="fragment in block.fragments" :key="`${fragment.verse.reference}-${fragment.start}-${fragment.end}`"><span
                class="bible-reader-verse"
                :class="{ target: isTargetVerse(fragment.verse), selected: isSelectedVerse(fragment.verse), favorite: isFavoriteVerse(fragment.verse), playing: isPlayingVerse(fragment.verse) }"
                :style="favoriteVerseStyle(fragment.verse)"
                :data-verse-key="fragment.showVerseNumber ? `${readerBook.code}-${fragment.verse.chapter}-${fragment.verse.verse}` : undefined"
                :data-scroll-anchor="fragment.showVerseNumber ? '' : undefined"
                :data-anchor-chapter="fragment.showVerseNumber ? fragment.verse.chapter : undefined"
                :data-anchor-verse="fragment.showVerseNumber ? fragment.verse.verse : undefined"
                role="button"
                tabindex="0"
                :aria-pressed="isSelectedVerse(fragment.verse)"
                @click="handleVerseClick(fragment.verse, $event.shiftKey)"
                @keydown.enter.prevent="handleVerseClick(fragment.verse, $event.shiftKey)"
              ><sup v-if="fragment.showVerseNumber">{{ fragment.verse.verse }}</sup><template v-for="(segment, index) in verseSegments(fragment.text, fragmentMatches(fragment))" :key="index"><mark v-if="segment.highlighted">{{ segment.text }}</mark><template v-else>{{ segment.text }}</template></template></span><button v-if="isFinalFragment(fragment) && copyworkMarkers[fragment.verse.chapter]?.includes(fragment.verse.verse)" type="button" class="bible-copywork-marker" aria-label="查看此节经文的抄写" @click.stop="emit('copy-browse', { translation, bookCode: readerBook.code, chapter: fragment.verse.chapter, verse: fragment.verse.verse })"><Brush :size="16" /></button><button v-if="isFinalFragment(fragment) && noteMarkers[fragment.verse.chapter]?.includes(fragment.verse.verse)" type="button" class="bible-copywork-marker" aria-label="查看此节经文的笔记" @click.stop="emit('note-browse', { translation, bookCode: readerBook.code, chapter: fragment.verse.chapter, verse: fragment.verse.verse })"><StickyNote :size="16" /></button></template>
            </p>
          </template>
        </div>
      </section>
      <div v-if="copyworkMarkerError" class="bible-state"><button type="button" @click="reloadCopyworkMarkers">{{ copyworkMarkerError }}</button></div>
      <div v-if="noteMarkerError" class="bible-state"><button type="button" @click="reloadNoteMarkers">{{ noteMarkerError }}</button></div>
      <div v-if="readerError" class="bible-state error">{{ readerError }}</div>
      <div v-if="loadedChapters.at(-1) === readerBook.chapterCount" class="bible-book-boundary">本卷结束</div>
      <div v-else class="bible-reader-loading">继续向下阅读下一章</div>
      <div v-if="translationCopyright" class="bible-translation-copyright">{{ translationCopyright }}</div>
    </main>

    <footer v-if="selectedVerses.length" class="bible-pane-verse-action">
      <div class="bible-pane-selection-copy">
        <strong>{{ selectedVerseSummary }}</strong>
        <span class="bible-favorite-color-picker" aria-label="收藏标线颜色">
          <button
            v-for="preset in BIBLE_FAVORITE_COLOR_PRESETS"
            :key="preset.color"
            type="button"
            class="bible-favorite-color-swatch"
            :class="{ active: selectedFavoriteColor === preset.color }"
            :style="{ '--swatch-color': preset.color }"
            :aria-label="`${preset.name}标线`"
            :disabled="favoritesBusy"
            @click="chooseFavoriteColor(preset.color)"
          ></button>
        </span>
      </div>
      <div class="bible-pane-action-buttons">
        <button
          v-if="audioEnabled"
          type="button"
          class="bible-pane-audio-play"
          :class="{ through: audioPlayThrough }"
          :aria-label="audioPlayThrough ? '连播到底：从选中经文一直朗读' : '播放选中的经文'"
          :title="audioPlayThrough ? '从选中经文连播到底（长按切回选段朗读）' : '朗读选中经文（长按连播到底）'"
          @pointerdown="playThroughPress.down"
          @pointermove="playThroughPress.move"
          @pointerup="playThroughPress.clear"
          @pointercancel="playThroughPress.clear"
          @pointerleave="playThroughPress.clear"
          @contextmenu.prevent
          @click="handlePlaySelectionClick"
        ><BiblePlayThroughIcon v-if="audioPlayThrough" :size="16" /><Play v-else :size="16" /><span>播放</span></button>
        <button type="button" :disabled="selectedVerses.length !== 1 || selectedVerses[0].endVerse !== selectedVerses[0].verse" title="选中一节经文后写笔记" @click="emit('note-start', { translation, bookCode: readerBook.code, verses: selectedVerses })"><StickyNote :size="16" /><span>笔记</span></button>
        <button type="button" @click="emit('copy-start', { translation, bookCode: readerBook.code, verses: selectedVerses })"><Brush :size="16" /><span>抄写</span></button>
        <button type="button" @click="writeClipboard(formatBibleVersesForCopy(selectedVerses, translationName))"><ClipboardCopy :size="16" /><span>复制</span></button>
        <button type="button" :disabled="favoritesBusy" @click="updateSelectedFavorites(allSelectedFavorited)"><BookmarkCheck v-if="allSelectedFavorited" :size="16" /><Bookmark v-else :size="16" /><span>{{ allSelectedFavorited ? "取消" : "收藏" }}</span></button>
        <button type="button" :disabled="!canSend" :title="canSend ? '' : sendUnavailableReason" @click="sendSelectedVerses"><Send :size="16" /><span>发送</span></button>
        <button type="button" class="secondary" aria-label="清除选择" @click="clearVerseSelection()"><X :size="16" /></button>
      </div>
    </footer>
    <BiblePassageShareDialog ref="passageShareDialog" :channel-name="channelName" :send-passage="sendPassage" :send-text="sendText" @sent="emit('toast', `已发送到：${channelName}`)" />
  </article>
</template>

<style scoped>
.bible-copywork-marker { display: inline-flex; vertical-align: middle; align-items: center; justify-content: center; width: 36px; height: 36px; padding: 8px; border: 0; background: transparent; color: #806741; cursor: pointer; }
.bible-reader-pane { container-type: inline-size; position: relative; min-width: 0; min-height: 0; display: grid; grid-template-rows: auto minmax(0, 1fr); overflow: hidden; background: #f3ecde; box-shadow: inset 0 0 0 1px transparent; }
.bible-reader-pane.active { box-shadow: inset 0 0 0 1px rgba(205, 126, 42, .5); }
.bible-reader-pane.receiving { box-shadow: inset 0 0 0 2px rgba(220, 125, 31, .72); }
.bible-pane-navigation { display: none; }
.bible-pane-toolbar { min-width: 0; min-height: 44px; padding: 5px 7px; display: grid; grid-template-columns: auto auto minmax(0, 1fr) auto auto auto; align-items: center; gap: 4px; border-bottom: 1px solid rgba(104, 76, 45, .16); background: rgba(250, 246, 237, .98); }
.bible-pane-toolbar.has-highlight { grid-template-columns: auto auto minmax(0, 1fr) auto auto auto auto; }
.bible-pane-jumps { min-width: 0; display: grid; grid-template-columns: minmax(62px, .85fr) minmax(0, 1.3fr) minmax(48px, .7fr) minmax(43px, .62fr); gap: 3px; }
.bible-pane-jumps :deep(.bible-translation-trigger) { width: 100%; min-height: 32px; height: 32px; padding: 0 4px; gap: 3px; font-size: 12px; }
.bible-pane-jumps select { min-width: 0; height: 32px; border: 1px solid rgba(128, 97, 63, .24); border-radius: 7px; padding: 0 4px; color: #5e452f; background: #fffaf1; font: inherit; font-size: 12px; font-weight: 700; }
.bible-pane-icon { width: 32px; height: 32px; border: 0; border-radius: 7px; padding: 0; color: #725537; background: rgba(128, 97, 63, .09); display: grid; place-items: center; cursor: pointer; }
.bible-pane-icon:disabled { opacity: .28; cursor: default; }
.bible-pane-icon.receiver.selected { color: #fff8ed; background: #d97718; }
.bible-pane-icon.close { color: #976044; }
.bible-pane-label { width: 25px; height: 21px; border-radius: 6px; color: #fff8ed; background: #de7d1e; display: grid; place-items: center; font-size: 12px; font-weight: 900; box-shadow: 0 2px 6px rgba(164, 83, 12, .25); }
/* Prepend correction must finish before painting, with a single anchor owner.
   Smooth correction otherwise fights the active native touch scroll. */
.bible-pane-scroll { min-width: 0; min-height: 0; overflow: auto; padding: 24px max(16px, calc((100% - 760px) / 2)) 100px; overscroll-behavior: contain; overflow-anchor: none; scroll-behavior: auto; }
.bible-reader-chapter { scroll-margin-top: 54px; padding: 10px 0 40px; }
.bible-reader-chapter > header { margin-bottom: 20px; text-align: center; font-family: "Songti SC", "STSong", serif; }
.bible-reader-chapter > header span { color: #947657; letter-spacing: .14em; }
.bible-reader-chapter > header h1 { margin: 7px 0 0; font-size: clamp(25px, 3vw, 32px); }
.bible-chapter-text { font-family: "Songti SC", "STSong", "Noto Serif CJK SC", serif; font-size: var(--bible-font-size); line-height: 1.95; }
.bible-structure-heading { margin: 2.1em 0 .75em; color: #684728; text-align: center; font-size: 1.25em; line-height: 1.4; }
.bible-structure-heading:first-child { margin-top: 0; }
.bible-structure-heading.level-2 { font-size: 1.08em; }
.bible-structure-parallel { margin: -.45em 0 1.2em; color: #9a7d60; text-align: center; font-size: .72em; line-height: 1.55; }
.bible-structure-parallel button { border: 0; border-radius: 4px; padding: 1px 2px; color: #9a5a1f; background: transparent; font: inherit; text-decoration: underline; text-decoration-color: rgba(217, 119, 24, .45); text-underline-offset: 2px; cursor: pointer; }
.bible-structure-parallel button:hover { color: #c05f0b; background: rgba(217, 119, 24, .1); }
.bible-structure-description { margin: 0 0 1em; color: #775b3f; text-align: center; font-size: .88em; font-style: italic; line-height: 1.65; }
.bible-structure-speaker { margin: 1em 0 .25em; color: #8a6847; font-size: .82em; font-weight: 700; }
.bible-structure-spacing { height: .9em; }
.bible-structure-paragraph { margin: 0 0 1em; text-align: justify; }
.bible-structure-paragraph.poetry { margin: 0; padding-left: 1.75em; text-indent: -1.75em; text-align: left; }
.bible-reader-verse { border-radius: 4px; padding: 2px 1px; cursor: pointer; transition: background-color 160ms ease; }
.bible-reader-verse::after { content: " "; }
.bible-reader-verse sup { margin-right: 2px; color: #9b7a58; font-size: .55em; font-weight: 700; vertical-align: super; }
.bible-reader-verse mark { padding: 0; color: #b42318; background: transparent; font-weight: 800; }
.bible-reader-verse.target { background: rgba(222, 177, 70, .22); }
.bible-reader-verse.favorite { box-shadow: inset 0 -0.24em color-mix(in srgb, var(--bible-favorite-color, #f28b82) 72%, transparent); }
.bible-reader-verse.selected { border-radius: 0; background: rgba(221, 180, 92, .3); }
.bible-reader-verse.playing { color: #f97316; font-weight: 700; }
.bible-reader-verse.playing sup { color: #f97316; }
.bible-book-boundary, .bible-reader-loading { padding: 16px 0 28px; color: #9a8168; text-align: center; font-family: "Songti SC", "STSong", serif; }
.bible-translation-copyright { padding: 0 0 24px; color: #b39a80; text-align: center; font-size: 11px; line-height: 1.6; }
.bible-state { display: grid; place-items: center; min-height: 150px; color: #80674e; }
.bible-state.error { color: #a33d30; }
.bible-pane-verse-action { position: absolute; left: 8px; right: 8px; bottom: 8px; z-index: 3; padding: 8px; border: 1px solid rgba(102, 70, 39, .2); border-radius: 12px; background: rgba(255, 252, 245, .97); box-shadow: 0 10px 28px rgba(58, 39, 20, .2); display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 7px; }
.bible-pane-selection-copy { min-width: 0; display: grid; gap: 4px; }
.bible-pane-selection-copy > strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.bible-favorite-color-picker, .bible-pane-action-buttons { display: flex; align-items: center; gap: 4px; }
.bible-pane-action-buttons { flex-wrap: wrap; }
.bible-favorite-color-swatch { width: 17px; height: 17px; border: 2px solid #fff; border-radius: 999px; padding: 0; background: var(--swatch-color); box-shadow: 0 0 0 1px rgba(84, 57, 31, .2); }
.bible-favorite-color-swatch.active { outline: 2px solid #6f5133; outline-offset: 1px; }
.bible-pane-action-buttons button { min-height: 34px; border: 0; border-radius: 8px; padding: 0 8px; color: white; background: #80613f; display: inline-flex; align-items: center; justify-content: center; gap: 3px; font: inherit; font-size: 12px; font-weight: 700; }
.bible-pane-action-buttons button.secondary { color: #74583b; background: #eee3d2; }
.bible-pane-action-buttons button:disabled { opacity: .45; }
/* 有声圣经「播放」：动作按钮行的第一个动作，与笔记/抄写/复制同行同尺寸；连播到底时变绿 */
.bible-pane-action-buttons button.bible-pane-audio-play { background: #c2733a; cursor: pointer; }
.bible-pane-action-buttons button.bible-pane-audio-play:hover { background: #ad6530; }
.bible-pane-action-buttons button.bible-pane-audio-play.through { background: #2f9e44; }
.bible-pane-action-buttons button.bible-pane-audio-play.through:hover { background: #268a3b; }
@container (max-width: 600px) {
  .bible-pane-toolbar { grid-template-columns: auto auto minmax(0, 1fr) auto auto auto; padding: 4px; }
  .bible-pane-icon { width: 29px; height: 30px; }
  .bible-pane-jumps select { height: 30px; padding: 0 2px; font-size: 11px; }
  .bible-pane-label { width: 22px; }
  .bible-pane-scroll { padding: 18px 13px 94px; }
  .bible-pane-verse-action { align-items: stretch; flex-direction: column; }
  .bible-pane-selection-copy { display: none; }
  .bible-pane-action-buttons { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)) auto; }
  .bible-pane-action-buttons button { padding: 0 5px; }
}
@container (max-width: 420px) {
  .bible-pane-toolbar, .bible-pane-toolbar.has-highlight { grid-template-columns: repeat(3, minmax(0, 1fr)) minmax(32px, auto); gap: 5px; }
  .bible-pane-navigation { grid-column: 1 / 4; grid-row: 1; min-width: 0; min-height: 36px; display: flex; align-items: center; justify-content: space-between; gap: 4px; border: 0; border-radius: 7px; padding: 0 6px; color: #5e452f; background: rgba(128, 97, 63, .09); font: inherit; font-size: 12px; cursor: pointer; }
  .bible-pane-navigation span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bible-pane-navigation svg { flex-shrink: 0; }
  .bible-pane-label { grid-column: 4; grid-row: 1; }
  .bible-pane-toolbar:not(.expanded) .bible-pane-jumps, .bible-pane-toolbar:not(.expanded) .bible-pane-icon { display: none; }
  .bible-pane-jumps { grid-column: 1 / -1; grid-row: 2; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px; }
  .bible-pane-jumps select { height: 36px; font-size: 12px; }
  .bible-pane-icon { grid-row: auto; width: 100%; height: 32px; }
  .bible-pane-action-buttons { display: flex; flex-wrap: wrap; }
  .bible-pane-action-buttons button { flex: 1 0 auto; white-space: nowrap; min-height: 36px; }
}
@media (prefers-reduced-motion: reduce) { .bible-pane-scroll { scroll-behavior: auto; } }
.bible-pane-scroll { scrollbar-width: none; }
.bible-pane-scroll::-webkit-scrollbar { display: none; }
</style>
