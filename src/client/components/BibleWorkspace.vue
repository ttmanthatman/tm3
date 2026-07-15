<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { BookOpen, ChevronLeft, Home, Search, Send } from "lucide-vue-next";
import type {
  BibleBookCatalogDTO,
  BibleCatalogDTO,
  BibleLookupDTO,
  BibleRelatedSearchDTO,
  BibleTextMatchRangeDTO,
  BibleTextSearchDTO,
  BibleTextSearchItemDTO,
  BibleVerseLineDTO
} from "@shared/types";
import { api } from "../api";

const props = defineProps<{
  open: boolean;
  channelName: string;
  canSend: boolean;
  sendUnavailableReason: string;
  sendPassage: (lookup: BibleLookupDTO) => Promise<void>;
}>();

const emit = defineEmits<{ close: [] }>();

type WorkspaceView = "home" | "chapters" | "reader";
type SearchMode = "topic" | "text";
type TextSegment = { text: string; highlighted: boolean };

const poetryBooks = new Set(["JOB", "PSA", "PRO", "ECC", "SNG"]);
const catalog = ref<BibleCatalogDTO | null>(null);
const catalogBusy = ref(false);
const catalogError = ref("");
const view = ref<WorkspaceView>("home");
const searchMode = ref<SearchMode>("topic");
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
const readerChapters = ref<Record<number, BibleLookupDTO>>({});
const readerBusyChapters = ref<Set<number>>(new Set());
const readerError = ref("");
const readerScroll = ref<HTMLElement | null>(null);
const visibleChapter = ref(1);
const targetVerse = ref<{ chapter: number; verse: number; endVerse: number; matches: BibleTextMatchRangeDTO[] } | null>(null);
const selectedVerse = ref<BibleVerseLineDTO | null>(null);
const sendBusyKey = ref("");
const toast = ref("");
let toastTimer = 0;
let swipeStart: { x: number; y: number } | null = null;

const allBooks = computed(() => [...(catalog.value?.oldTestament || []), ...(catalog.value?.newTestament || [])]);
const loadedChapters = computed(() => Object.keys(readerChapters.value).map(Number).sort((left, right) => left - right));
const headerTitle = computed(() => {
  if (view.value === "reader" && readerBook.value) return `${readerBook.value.name} 第${visibleChapter.value}章`;
  if (view.value === "chapters" && selectedBook.value) return selectedBook.value.name;
  return "圣经";
});
const textHasMore = computed(() => !!textResult.value && textResult.value.items.length < textResult.value.total);
const textModeLabel = computed(() => textResult.value?.mode === "allTerms" ? "多关键词匹配" : "连续原文匹配");

watch(
  () => props.open,
  (open) => {
    if (open) void ensureCatalog();
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  if (toastTimer) window.clearTimeout(toastTimer);
});

async function ensureCatalog() {
  if (catalog.value || catalogBusy.value) return;
  catalogBusy.value = true;
  catalogError.value = "";
  try {
    const response = await api<{ success: boolean; result: BibleCatalogDTO }>("/api/bible/catalog");
    catalog.value = response.result;
  } catch (error) {
    catalogError.value = error instanceof Error ? error.message : "圣经目录加载失败";
  } finally {
    catalogBusy.value = false;
  }
}

function returnHome() {
  view.value = "home";
  selectedBook.value = null;
  selectedVerse.value = null;
}

function reopenChapterPicker() {
  if (!readerBook.value) return;
  selectedBook.value = readerBook.value;
  view.value = "chapters";
  selectedVerse.value = null;
}

function chooseBook(book: BibleBookCatalogDTO) {
  if (book.chapterCount === 1) {
    void openReader(book, 1);
    return;
  }
  selectedBook.value = book;
  view.value = "chapters";
}

async function searchTopic() {
  const query = topicQuery.value.trim();
  if (query.length < 2 || topicBusy.value) return;
  topicBusy.value = true;
  topicError.value = "";
  try {
    const response = await api<{ success: boolean; result: BibleRelatedSearchDTO }>("/api/bible/related", {
      method: "POST",
      body: JSON.stringify({ query })
    });
    topicResult.value = response.result;
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
  const offset = loadMore ? textResult.value?.items.length || 0 : 0;
  try {
    const response = await api<{ success: boolean; result: BibleTextSearchDTO }>(
      `/api/bible/search?query=${encodeURIComponent(query)}&offset=${offset}&limit=50`
    );
    textResult.value = loadMore && textResult.value
      ? { ...response.result, items: [...textResult.value.items, ...response.result.items] }
      : response.result;
  } catch (error) {
    textError.value = error instanceof Error ? error.message : "文本检索失败";
  } finally {
    textBusy.value = false;
  }
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
  target: { chapter: number; verse: number; endVerse: number; matches: BibleTextMatchRangeDTO[] } | null = null
) {
  readerBook.value = book;
  readerChapters.value = {};
  readerError.value = "";
  targetVerse.value = target;
  selectedVerse.value = null;
  visibleChapter.value = chapter;
  view.value = "reader";
  await loadChapter(chapter);
  await nextTick();
  const element = readerScroll.value?.querySelector<HTMLElement>(`[data-verse-key="${book.code}-${chapter}-${target?.verse || 1}"]`);
  element?.scrollIntoView({ block: target ? "center" : "start" });
}

async function loadChapter(chapter: number, prepend = false) {
  const book = readerBook.value;
  if (!book || chapter < 1 || chapter > book.chapterCount || readerChapters.value[chapter] || readerBusyChapters.value.has(chapter)) return;
  const busy = new Set(readerBusyChapters.value);
  busy.add(chapter);
  readerBusyChapters.value = busy;
  const previousHeight = prepend ? readerScroll.value?.scrollHeight || 0 : 0;
  try {
    const response = await api<{ success: boolean; result?: BibleLookupDTO; message?: string }>(
      `/api/bible/lookup?reference=${encodeURIComponent(`${book.name} ${chapter}`)}`
    );
    if (!response.success || !response.result) throw new Error(response.message || "章节加载失败");
    readerChapters.value = { ...readerChapters.value, [chapter]: response.result };
    await nextTick();
    if (prepend && readerScroll.value) readerScroll.value.scrollTop += readerScroll.value.scrollHeight - previousHeight;
  } catch (error) {
    readerError.value = error instanceof Error ? error.message : "章节加载失败";
  } finally {
    const next = new Set(readerBusyChapters.value);
    next.delete(chapter);
    readerBusyChapters.value = next;
  }
}

function handleReaderScroll() {
  const scroller = readerScroll.value;
  const book = readerBook.value;
  if (!scroller || !book || !loadedChapters.value.length) return;
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
  visibleChapter.value = closest;
  const first = loadedChapters.value[0];
  const last = loadedChapters.value[loadedChapters.value.length - 1];
  if (scroller.scrollTop < 220 && first > 1) void loadChapter(first - 1, true);
  if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 320 && last < book.chapterCount) void loadChapter(last + 1);
}

function targetMatches(verse: BibleVerseLineDTO) {
  const target = targetVerse.value;
  return target && target.chapter === verse.chapter && target.verse === verse.verse ? target.matches : [];
}

function isTargetVerse(verse: BibleVerseLineDTO) {
  const target = targetVerse.value;
  return !!target && target.chapter === verse.chapter && verse.verse <= target.endVerse && verse.endVerse >= target.verse;
}

function selectVerse(verse: BibleVerseLineDTO) {
  selectedVerse.value = selectedVerse.value?.reference === verse.reference ? null : verse;
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
    :aria-hidden="!open"
    :inert="!open"
    @touchstart.passive="handleTouchStart"
    @touchend.passive="handleTouchEnd"
  >
    <header class="bible-topbar">
      <button type="button" class="bible-topbar-button" @click="emit('close')"><ChevronLeft :size="20" />聊天</button>
      <button type="button" class="bible-topbar-title" :class="{ interactive: view === 'reader' }" :disabled="view !== 'reader'" @click="reopenChapterPicker">
        <strong>{{ headerTitle }}</strong>
        <small>{{ catalog?.translation || "新标点和合本（简体）" }}</small>
      </button>
      <button v-if="view !== 'home'" type="button" class="bible-topbar-button home" @click="returnHome"><Home :size="19" />目录</button>
      <span v-else class="bible-topbar-spacer"></span>
    </header>

    <div v-if="catalogBusy" class="bible-state">正在展开圣经目录…</div>
    <div v-else-if="catalogError" class="bible-state error"><span>{{ catalogError }}</span><button @click="ensureCatalog">重新加载</button></div>

    <main v-else-if="view === 'home'" class="bible-home">
      <section class="bible-search-panel">
        <div class="bible-search-tabs" role="tablist" aria-label="经文检索方式">
          <button type="button" :class="{ active: searchMode === 'topic' }" @click="searchMode = 'topic'">主题检索</button>
          <button type="button" :class="{ active: searchMode === 'text' }" @click="searchMode = 'text'">文本检索</button>
        </div>

        <form v-if="searchMode === 'topic'" class="bible-search-form" @submit.prevent="searchTopic">
          <label for="bible-topic-query">想查看关于什么的经文？</label>
          <div><input id="bible-topic-query" v-model="topicQuery" maxlength="200" placeholder="例如：焦虑时怎样信靠神" /><button :disabled="topicBusy || topicQuery.trim().length < 2"><Search :size="18" />{{ topicBusy ? "查找中" : "查找" }}</button></div>
          <small>AI只查找出处，经文正文始终来自本地和合本。</small>
          <p v-if="topicError" class="bible-search-error" role="alert">{{ topicError }}</p>
        </form>

        <form v-else class="bible-search-form" @submit.prevent="searchText(false)">
          <label for="bible-text-query">直接查找经文原文</label>
          <div><input id="bible-text-query" v-model="textQuery" maxlength="200" placeholder="例如：神爱世人，或输入多个关键词" /><button :disabled="textBusy || !textQuery.trim()"><Search :size="18" />{{ textBusy ? "检索中" : "检索" }}</button></div>
          <small>先匹配连续原文；没有结果时自动尝试所有关键词同时包含。</small>
          <p v-if="textError" class="bible-search-error" role="alert">{{ textError }}</p>
        </form>

        <section v-if="searchMode === 'topic' && topicResult" class="bible-results" aria-live="polite">
          <header><strong>相关经文</strong><span>{{ topicResult.results.length }} 处</span></header>
          <article v-for="lookup in topicResult.results" :key="lookup.normalizedReference" class="bible-result-card" @click="openTopicResult(lookup)">
            <h3>{{ lookup.normalizedReference }}</h3>
            <p><template v-for="verse in lookup.verses" :key="verse.reference"><sup>{{ verse.verse }}</sup>{{ verse.text }}</template></p>
            <footer><button type="button" @click.stop="openTopicResult(lookup)"><BookOpen :size="16" />阅读上下文</button><button type="button" :disabled="!canSend || !!sendBusyKey" :title="canSend ? '' : sendUnavailableReason" @click.stop="sendLookup(lookup, lookup.normalizedReference)"><Send :size="16" />发送</button></footer>
          </article>
        </section>

        <section v-if="searchMode === 'text' && textResult" class="bible-results" aria-live="polite">
          <header><strong>{{ textModeLabel }}</strong><span>共 {{ textResult.total }} 节</span></header>
          <p v-if="!textResult.items.length" class="bible-empty">没有找到包含这段文字的经文。</p>
          <article v-for="item in textResult.items" :key="item.verse.reference" class="bible-result-card" @click="openTextResult(item)">
            <h3>{{ item.verse.reference }}</h3>
            <p><template v-for="(segment, index) in verseSegments(item.verse.text, item.matches)" :key="index"><mark v-if="segment.highlighted">{{ segment.text }}</mark><template v-else>{{ segment.text }}</template></template></p>
            <footer><button type="button" @click.stop="openTextResult(item)"><BookOpen :size="16" />阅读上下文</button><button type="button" :disabled="!canSend || !!sendBusyKey" :title="canSend ? '' : sendUnavailableReason" @click.stop="sendLookup(singleVerseLookup(item.verse), item.verse.reference)"><Send :size="16" />发送</button></footer>
          </article>
          <button v-if="textHasMore" type="button" class="bible-load-more" :disabled="textBusy" @click="searchText(true)">{{ textBusy ? "加载中…" : "加载更多" }}</button>
        </section>
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
        <div class="bible-chapter-text" :class="{ poetry: poetryBooks.has(readerBook.code) }">
          <span
            v-for="verse in readerChapters[chapter]?.verses || []"
            :key="verse.reference"
            class="bible-reader-verse"
            :class="{ target: isTargetVerse(verse), selected: selectedVerse?.reference === verse.reference }"
            :data-verse-key="`${readerBook.code}-${verse.chapter}-${verse.verse}`"
            role="button"
            tabindex="0"
            @click="selectVerse(verse)"
            @keydown.enter.prevent="selectVerse(verse)"
          ><sup>{{ verse.verse }}</sup><template v-for="(segment, index) in verseSegments(verse.text, targetMatches(verse))" :key="index"><mark v-if="segment.highlighted">{{ segment.text }}</mark><template v-else>{{ segment.text }}</template></template></span>
        </div>
      </section>
      <div v-if="readerError" class="bible-state error">{{ readerError }}</div>
      <div v-if="loadedChapters[loadedChapters.length - 1] === readerBook.chapterCount" class="bible-book-boundary">本卷结束</div>
      <div v-else class="bible-reader-loading">继续向下阅读下一章</div>
    </main>

    <footer v-if="view === 'reader' && selectedVerse" class="bible-verse-action">
      <div><strong>{{ selectedVerse.reference }}</strong><small>{{ selectedVerse.text }}</small></div>
      <button type="button" :disabled="!canSend || !!sendBusyKey" :title="canSend ? '' : sendUnavailableReason" @click="sendLookup(singleVerseLookup(selectedVerse), selectedVerse.reference)"><Send :size="18" />发送本节</button>
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
.bible-topbar { min-height: calc(58px + var(--safe-top)); padding: var(--safe-top) 14px 0; display: grid; grid-template-columns: minmax(78px, 1fr) minmax(0, 2fr) minmax(78px, 1fr); align-items: center; border-bottom: 1px solid rgba(104, 76, 45, .18); background: rgba(250, 246, 237, .96); box-shadow: 0 4px 18px rgba(74, 52, 29, .08); }
.bible-topbar-button { border: 0; background: transparent; color: #725537; display: inline-flex; align-items: center; gap: 3px; font: inherit; font-weight: 700; padding: 10px 0; cursor: pointer; }
.bible-topbar-button.home { justify-self: end; }
.bible-topbar-spacer { width: 78px; }
.bible-topbar-title { min-width: 0; border: 0; padding: 5px 8px; display: grid; justify-items: center; color: inherit; background: transparent; font: inherit; line-height: 1.2; }
.bible-topbar-title.interactive { border-radius: 9px; cursor: pointer; }
.bible-topbar-title.interactive:hover { background: rgba(128, 97, 63, .08); }
.bible-topbar-title strong { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: "Songti SC", "STSong", serif; font-size: 18px; }
.bible-topbar-title small { margin-top: 3px; color: #92775b; font-size: 11px; }
.bible-home, .bible-chapter-picker, .bible-reader { min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.bible-home { padding: 26px max(16px, calc((100vw - 1120px) / 2)) calc(44px + var(--safe-bottom)); }
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
.bible-results { display: grid; gap: 12px; margin-top: 22px; }
.bible-results > header { display: flex; align-items: center; justify-content: space-between; color: #6d5135; }
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
.bible-chapter-text { font-family: "Songti SC", "STSong", "Noto Serif CJK SC", serif; font-size: clamp(18px, 2.15vw, 21px); line-height: 1.95; text-align: justify; }
.bible-reader-verse { border-radius: 4px; padding: 2px 1px; cursor: pointer; transition: background-color 160ms ease; }
.bible-reader-verse::after { content: " "; }
.bible-reader-verse sup { margin-right: 2px; color: #9b7a58; font-size: .55em; font-weight: 700; vertical-align: super; }
.bible-reader-verse.target { background: rgba(222, 177, 70, .22); }
.bible-reader-verse.selected { outline: 1px solid rgba(150, 104, 52, .55); background: rgba(221, 180, 92, .28); }
.bible-chapter-text.poetry .bible-reader-verse { display: block; padding-left: 1.5em; text-indent: -1.5em; }
.bible-book-boundary, .bible-reader-loading { padding: 16px 0 28px; color: #9a8168; text-align: center; font-family: "Songti SC", "STSong", serif; }
.bible-verse-action { position: fixed; left: 50%; bottom: calc(14px + var(--safe-bottom)); z-index: 3; width: min(700px, calc(100vw - 24px)); transform: translateX(-50%); padding: 10px 11px 10px 14px; border: 1px solid rgba(102, 70, 39, .2); border-radius: 14px; background: rgba(255, 252, 245, .97); box-shadow: 0 13px 36px rgba(58, 39, 20, .2); display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; }
.bible-verse-action div { min-width: 0; display: grid; gap: 2px; }
.bible-verse-action small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #816a53; }
.bible-verse-action button { min-height: 42px; border: 0; border-radius: 10px; padding: 0 14px; color: white; background: #80613f; display: inline-flex; align-items: center; gap: 6px; font: inherit; font-weight: 700; cursor: pointer; }
.bible-state { display: grid; place-items: center; align-content: center; gap: 12px; min-height: 220px; color: #80674e; }
.bible-state.error { color: #a33d30; }
.bible-state button { border: 0; border-radius: 9px; padding: 9px 14px; color: white; background: #80613f; }
.bible-toast { position: fixed; left: 50%; bottom: calc(76px + var(--safe-bottom)); z-index: 5; transform: translateX(-50%); max-width: calc(100vw - 32px); padding: 10px 16px; border-radius: 999px; color: white; background: rgba(55, 41, 28, .9); box-shadow: 0 8px 24px rgba(0, 0, 0, .18); white-space: nowrap; }
@media (max-width: 900px) { .bible-book-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
@media (max-width: 600px) {
  .bible-topbar { padding-left: 10px; padding-right: 10px; grid-template-columns: 76px minmax(0, 1fr) 76px; }
  .bible-home { padding: 15px 12px calc(34px + var(--safe-bottom)); }
  .bible-search-panel { padding: 13px; border-radius: 14px; }
  .bible-search-form > div { grid-template-columns: minmax(0, 1fr); }
  .bible-search-form button { min-height: 44px; }
  .bible-book-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .bible-book-grid button { min-height: 66px; }
  .bible-chapter-picker { padding-top: 32px; }
  .bible-chapter-grid { grid-template-columns: repeat(5, 1fr); gap: 9px; }
  .bible-reader { padding-top: 24px; }
  .bible-verse-action { grid-template-columns: minmax(0, 1fr); }
  .bible-verse-action button { justify-content: center; }
}
@media (prefers-reduced-motion: reduce) { .bible-workspace { transition-duration: 1ms; } .bible-reader { scroll-behavior: auto; } }
</style>
