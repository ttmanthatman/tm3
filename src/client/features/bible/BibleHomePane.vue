<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { BookMarked, Bookmark, BookmarkCheck, BookOpen, ClipboardCopy, History, ListPlus, Pencil, Plus, Search, Send, Share2, Trash2, ArrowLeft, X } from "lucide-vue-next";
import type { BibleBookCatalogDTO, BibleCatalogDTO, BibleFavoriteDTO, BibleFavoriteKeyDTO, BibleLookupDTO, BibleRelatedSearchDTO, BibleSearchHistoryDTO, BibleTextSearchDTO, BibleTextSearchItemDTO, BibleTextMatchRangeDTO, BibleVerseLineDTO } from "@shared/types";
import type { BibleTopicDTO, BibleTopicPassageDTO } from "@shared/bibleTopics";
import type { BiblePaneState, BibleHomeState, BibleWorkspaceSearchMode } from "../../bibleWorkspaceState";
import { mergeBibleTopicResults, normalizeBibleSearchQuery } from "../../bibleWorkspaceState";
import { api } from "../../api";
import { DEFAULT_BIBLE_TRANSLATION_ID, fetchBibleChapter } from "../../bibleChapterCache";
import { formatBibleLookupReferencesForCopy, formatBibleLookupsForCopy, formatBibleVerseReferencesForCopy, formatBibleVersesForCopy } from "../../bibleVerseActions";
import { groupBibleFavoritePassages, type BibleFavoritePassage } from "../../bibleFavorites";
import type { BibleTopicActions } from "../../bibleTopics";
import BiblePassageShareDialog from "./BiblePassageShareDialog.vue";
import type { BibleShareTextSender } from "./biblePassageSharing";
import BibleTopicShareDialog from "./BibleTopicShareDialog.vue";
import BibleTranslationSelect from "./BibleTranslationSelect.vue";
import BibleSearchHistory from "./BibleSearchHistory.vue";
import NoteLibrary from "./notes/NoteLibrary.vue";
import CopyworkLibrary from "./copywork/CopyworkLibrary.vue";
import type { CopyworkDraft } from "./copywork/copyworkDrafts";
import { useBibleAccountState } from "./useBibleAccountState";
const props = defineProps<{
  pane: BiblePaneState; label: string; active: boolean; canClose: boolean; canGoBack: boolean;
  catalog: BibleCatalogDTO; accountId: number; channelName: string; canSend: boolean;
  sendUnavailableReason: string; copyworkRevision: number;
  favorites: BibleFavoriteDTO[]; favoritesBusy: boolean;
  updateFavorites: (verses: BibleFavoriteKeyDTO[], favorited: boolean, color?: string) => Promise<void>;
  topics: BibleTopicDTO[]; topicsBusy: boolean; topicActions: BibleTopicActions;
  sendText: BibleShareTextSender;
}>();
const emit = defineEmits<{
  back: [];
  translation: [id: string];
  activate: [id: string]; close: [id: string];
  state: [state: BibleHomeState]; book: [book: BibleBookCatalogDTO, chapter: number];
  context: [lookup: BibleLookupDTO, matches: BibleTextMatchRangeDTO[]];
  resume: [draft: CopyworkDraft]; toast: [message: string];
}>();
const { history: searchHistory, historyError, refreshHistory, clearHistory, preferences } = useBibleAccountState();
const saved = props.pane.homeState;
const homeSection = ref(saved?.section || props.pane.homeSection || "catalog");
const searchMode = ref<BibleWorkspaceSearchMode>(saved?.searchMode || preferences.value?.defaultSearchMode || "topic");
const topicQuery = ref(saved?.topicQuery || "");
const textQuery = ref(saved?.textQuery || "");
const topicResult = ref<BibleRelatedSearchDTO | null>(saved?.topicResult || null);
const textResult = ref<BibleTextSearchDTO | null>(saved?.textResult || null);
const selectedBook = ref<BibleBookCatalogDTO | null>(props.pane.view === "chapters" ? props.pane.book : saved?.selectedBook || null);
const topicBusy = ref(false), textBusy = ref(false), topicError = ref(""), textError = ref("");
const searchTranslation = ref(textResult.value?.sourceId || props.pane.translation || DEFAULT_BIBLE_TRANSLATION_ID);
watch(() => props.pane.translation, value => { searchTranslation.value = value || DEFAULT_BIBLE_TRANSLATION_ID; });
watch(searchTranslation, value => emit("translation", value));
const passageShareDialog = ref<InstanceType<typeof BiblePassageShareDialog> | null>(null);
const topicShareDialog = ref<InstanceType<typeof BibleTopicShareDialog> | null>(null);
const homeScroller = ref<HTMLElement | null>(null);
defineExpose({ scrollTop: () => homeScroller.value?.scrollTop || 0, restoreScroll: (top: number) => { if (homeScroller.value) homeScroller.value.scrollTop = top; } });
const favoritePassages = computed(() => groupBibleFavoritePassages(props.favorites));
const textHasMore = computed(() => !!textResult.value && textResult.value.items.length < textResult.value.total);
const textModeLabel = computed(() => textResult.value?.mode === "allTerms" ? "多关键词匹配" : "连续原文匹配");
const matchingTopicHistory = computed(() => searchHistory.value.find(entry => entry.kind === "topic" && normalizeBibleSearchQuery(entry.query) === normalizeBibleSearchQuery(topicQuery.value)));
const selectedResults = ref<string[]>([]);
// 「只复制出处」：复制全部/复制所选只给引用不给正文；同时「发送所选」变为合并发送（一条消息）
const referencesOnly = ref(false);
const appendAvailable = computed(() => topicResult.value && normalizeBibleSearchQuery(topicResult.value.query) === normalizeBibleSearchQuery(topicQuery.value));
const currentLookups = computed(() => searchMode.value === "topic" ? topicResult.value?.results || [] : textResult.value?.items.map(item => singleVerseLookup(item.verse)) || []);
const selectedLookups = computed(() => currentLookups.value.filter(lookup => selectedResults.value.includes(lookup.normalizedReference)));
watch(searchMode, () => { selectedResults.value = []; });
watch([homeSection, searchMode, topicQuery, textQuery, topicResult, textResult, selectedBook], () => emit("state", {
  section: homeSection.value, searchMode: searchMode.value, topicQuery: topicQuery.value, textQuery: textQuery.value,
  topicResult: topicResult.value, textResult: textResult.value, selectedBook: selectedBook.value
}), { deep: true });
watch(() => props.pane.homeState, incoming => {
  if (!incoming) return;
  homeSection.value = incoming.section;
  searchMode.value = incoming.searchMode;
  topicQuery.value = incoming.topicQuery;
  textQuery.value = incoming.textQuery;
  topicResult.value = incoming.topicResult;
  textResult.value = incoming.textResult;
  selectedBook.value = incoming.selectedBook;
});
function chooseBook(book: BibleBookCatalogDTO) {
  if (book.chapterCount === 1) emit("book", book, 1);
  else selectedBook.value = book;
}
function openTextResult(item: BibleTextSearchItemDTO) { emit("context", singleVerseLookup(item.verse), item.matches); }
function openTopicResult(lookup: BibleLookupDTO) { emit("context", lookup, []); }
function showToast(message: string) { emit("toast", message); }
function toggleAll() { selectedResults.value = selectedLookups.value.length === currentLookups.value.length ? [] : currentLookups.value.map(lookup => lookup.normalizedReference); }
function copySelected() {
  const lookups = selectedLookups.value;
  if (referencesOnly.value) return writeClipboard(formatBibleLookupReferencesForCopy(lookups), `已复制 ${lookups.length} 处出处`);
  return writeClipboard(formatBibleLookupsForCopy(lookups, props.catalog.translation), `已复制 ${lookups.length} 处结果`);
}
function sendSelected() { if (props.canSend) passageShareDialog.value?.open(selectedLookups.value); }
type TextSegment = { text: string; highlighted: boolean };
async function searchTopic(append = false) {
  const query = topicQuery.value.trim();
  if (query.length < 2 || topicBusy.value) return;
  const historyEntry = topicResult.value && normalizeBibleSearchQuery(topicResult.value.query) === normalizeBibleSearchQuery(query) ? { result: topicResult.value } : null;
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
    if (!append) selectedResults.value = [];
    await refreshHistory();
  } catch (error) {
    topicError.value = error instanceof Error ? error.message : "主题检索失败";
  } finally {
    topicBusy.value = false;
  }
}

function activePaneTranslation() { return searchTranslation.value || props.pane.translation || DEFAULT_BIBLE_TRANSLATION_ID; }

async function searchText(loadMore = false) {
  const query = textQuery.value.trim();
  if (!query || textBusy.value) return;
  textBusy.value = true;
  textError.value = "";
  const translationId = activePaneTranslation();
  const extendingCurrentSearch = loadMore
    && normalizeBibleSearchQuery(textResult.value?.query || "") === normalizeBibleSearchQuery(query)
    && (textResult.value?.sourceId || DEFAULT_BIBLE_TRANSLATION_ID) === translationId;
  const offset = extendingCurrentSearch ? textResult.value?.items.length || 0 : 0;
  try {
    const response = await api<{ success: boolean; result: BibleTextSearchDTO }>(
      `/api/bible/search?query=${encodeURIComponent(query)}&offset=${offset}&limit=50&translation=${encodeURIComponent(translationId)}`
    );
    textResult.value = extendingCurrentSearch && textResult.value
      ? { ...response.result, items: [...textResult.value.items, ...response.result.items] }
      : response.result;
    if (!extendingCurrentSearch) selectedResults.value = [];
    await refreshHistory();
  } catch (error) {
    textError.value = error instanceof Error ? error.message : "文本检索失败";
  } finally {
    textBusy.value = false;
  }
}

async function restoreSearchHistory(entry: BibleSearchHistoryDTO) {
  if (topicBusy.value || textBusy.value) return;
  searchMode.value = entry.kind;
  if (entry.kind === "topic") { topicQuery.value = entry.query; await searchTopic(); }
  else { textQuery.value = entry.query; searchTranslation.value = entry.translation; await searchText(); }
}
function singleVerseLookup(verse: BibleVerseLineDTO): BibleLookupDTO {
  return {
    reference: verse.reference,
    normalizedReference: verse.reference,
    translation: textResult.value?.translation || props.catalog?.translation || "新标点和合本（简体）",
    sourceId: textResult.value?.sourceId || props.catalog?.sourceId || "cmn-cu89s",
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
  const lookups = topicResult.value.results;
  if (referencesOnly.value) return writeClipboard(formatBibleLookupReferencesForCopy(lookups), `已复制 ${lookups.length} 处出处`);
  return writeClipboard(
    formatBibleLookupsForCopy(lookups, props.catalog?.translation || "新标点和合本（简体）"),
    `已复制 ${lookups.length} 处结果`
  );
}

function copyTextItem(item: BibleTextSearchItemDTO) {
  return writeClipboard(
    formatBibleVersesForCopy([item.verse], textResult.value?.translation || props.catalog?.translation || "新标点和合本（简体）"),
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
  const translationId = textResult.value?.sourceId || activePaneTranslation();
  try {
    const response = await api<{ success: boolean; result: BibleTextSearchDTO }>(
      `/api/bible/search/export?query=${encodeURIComponent(query)}&translation=${encodeURIComponent(translationId)}`
    );
    const verses = response.result.items.map((item) => item.verse);
    if (referencesOnly.value) {
      await writeClipboard(formatBibleVerseReferencesForCopy(verses), `已复制全部 ${response.result.total} 节的出处`);
    } else {
      await writeClipboard(formatBibleVersesForCopy(verses, response.result.translation), `已复制全部 ${response.result.total} 节结果`);
    }
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
  emit("context", passage.lookup, []);
}

function sendLookup(lookup: BibleLookupDTO) {
  if (props.canSend) passageShareDialog.value?.open([lookup]);
}

// ----- 经文主题（收藏夹自建主题：解析引用批量添加，可转发到聊天室） -----
const topicCreateOpen = ref(false);
const topicNameDraft = ref("");
const activeTopicId = ref<number | null>(null);
const activeTopic = computed(() => props.topics.find(topic => topic.id === activeTopicId.value) || null);
const topicVerses = ref<Record<number, BibleVerseLineDTO[]>>({});
const topicVersesFailed = ref<Set<number>>(new Set());
const topicReferenceDraft = ref("");
const topicAddNotice = ref("");
const topicRenameOpen = ref(false);
const topicRenameDraft = ref("");

watch(activeTopicId, () => { topicVerses.value = {}; topicVersesFailed.value = new Set(); topicReferenceDraft.value = ""; topicAddNotice.value = ""; topicRenameOpen.value = false; });

async function loadTopicVerses(passage: BibleTopicPassageDTO) {
  if (topicVerses.value[passage.id]) return;
  const book: BibleBookCatalogDTO = { code: passage.bookCode, name: passage.bookName, chapterCount: passage.endChapter };
  const verses: BibleVerseLineDTO[] = [];
  for (let chapter = passage.startChapter; chapter <= passage.endChapter; chapter++) {
    const loaded = await fetchBibleChapter(book, chapter);
    const from = chapter === passage.startChapter ? passage.startVerse : 1;
    const to = chapter === passage.endChapter ? passage.endVerse : loaded.verses[loaded.verses.length - 1]?.verse || 0;
    for (const verse of loaded.verses) if (verse.verse >= from && verse.verse <= to) verses.push(verse);
  }
  topicVerses.value = { ...topicVerses.value, [passage.id]: verses };
}

watch(() => activeTopic.value?.passages.map(passage => passage.id).join(","), () => {
  const topic = activeTopic.value;
  if (!topic) return;
  for (const passage of topic.passages) {
    if (topicVerses.value[passage.id] || topicVersesFailed.value.has(passage.id)) continue;
    loadTopicVerses(passage).catch(() => { topicVersesFailed.value = new Set([...topicVersesFailed.value, passage.id]); });
  }
}, { immediate: true });

function openTopic(topic: BibleTopicDTO) {
  activeTopicId.value = topic.id;
}

function topicPassageLookup(passage: BibleTopicPassageDTO): BibleLookupDTO | null {
  const verses = topicVerses.value[passage.id];
  if (!verses?.length) return null;
  return {
    reference: passage.reference,
    normalizedReference: passage.reference,
    translation: "新标点和合本（简体）",
    sourceId: DEFAULT_BIBLE_TRANSLATION_ID,
    verses
  };
}

function openTopicPassage(passage: BibleTopicPassageDTO) {
  const lookup = topicPassageLookup(passage);
  if (lookup) emit("context", lookup, []);
}

async function submitTopicCreate() {
  const name = topicNameDraft.value.trim();
  if (!name || props.topicsBusy) return;
  try {
    const topic = await props.topicActions.create(name);
    topicNameDraft.value = "";
    topicCreateOpen.value = false;
    openTopic(topic);
    showToast(`已创建主题「${topic.name}」，粘贴经文章节号即可批量添加`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "创建主题失败");
  }
}

async function submitTopicRename() {
  const topic = activeTopic.value;
  const name = topicRenameDraft.value.trim();
  if (!topic || !name || name === topic.name || props.topicsBusy) return;
  try {
    await props.topicActions.rename(topic.id, name);
    topicRenameOpen.value = false;
    showToast("主题已重命名");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "重命名失败");
  }
}

async function removeTopic() {
  const topic = activeTopic.value;
  if (!topic || props.topicsBusy) return;
  if (!window.confirm(`删除主题「${topic.name}」？其中的 ${topic.passages.length} 段经文会一并移除（不影响散收藏的经文）。`)) return;
  try {
    await props.topicActions.remove(topic.id);
    activeTopicId.value = null;
    showToast("主题已删除");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "删除主题失败");
  }
}

async function submitTopicPassages() {
  const topic = activeTopic.value;
  const reference = topicReferenceDraft.value.trim();
  if (!topic || !reference || props.topicsBusy) return;
  try {
    const { added, duplicates } = await props.topicActions.addPassages(topic.id, reference);
    topicReferenceDraft.value = "";
    topicAddNotice.value = duplicates
      ? `已添加 ${added} 段经文，${duplicates} 段已在主题中，自动跳过`
      : `已添加 ${added} 段经文`;
  } catch (error) {
    showToast(error instanceof Error ? error.message : "添加经文失败，请检查引用写法");
  }
}

async function removeTopicPassage(passage: BibleTopicPassageDTO) {
  const topic = activeTopic.value;
  if (!topic || props.topicsBusy) return;
  if (!window.confirm(`从主题中移除「${passage.reference}」？`)) return;
  try {
    await props.topicActions.removePassages(topic.id, [passage.id]);
    showToast(`已移除 ${passage.reference}`);
  } catch (error) {
    showToast(error instanceof Error ? error.message : "移除经文失败");
  }
}

// 转发主题走应用内确认框（BibleTopicShareDialog），不用系统 window.confirm
function shareTopic(topic: BibleTopicDTO) {
  if (!props.canSend || props.topicsBusy) return;
  topicShareDialog.value?.open(topic);
}

function retryTopicVerses(passage: BibleTopicPassageDTO) {
  topicVersesFailed.value = new Set([...topicVersesFailed.value].filter(id => id !== passage.id));
  loadTopicVerses(passage).catch(() => { topicVersesFailed.value = new Set([...topicVersesFailed.value, passage.id]); });
}

function copyTopic() {
  const topic = activeTopic.value;
  if (!topic) return;
  const body = topic.passages.map(passage => {
    const verses = topicVerses.value[passage.id] || [];
    return `${passage.reference}\n${verses.map(verse => `${verse.verse} ${verse.text}`).join("\n")}`;
  }).join("\n\n");
  return writeClipboard(body, `已复制主题「${topic.name}」`);
}

</script>
<template>
  <section class="bible-home-pane" :class="{ active }" @pointerdown="emit('activate', pane.id)">
    <main v-if="!selectedBook" ref="homeScroller" class="bible-home">
      <div class="bible-home-navigation">
      <button v-if="canGoBack" class="bible-home-back" type="button" aria-label="返回" title="返回" @click="emit('back')"><ArrowLeft :size="17" /></button>
      <nav class="bible-home-tabs" role="tablist" aria-label="书房功能">
        <button type="button" role="tab" :aria-selected="homeSection === 'catalog'" :class="{ active: homeSection === 'catalog' }" @click="homeSection = 'catalog'">经卷目录</button>
        <button type="button" role="tab" :aria-selected="homeSection === 'search'" :class="{ active: homeSection === 'search' }" @click="homeSection = 'search'">经文检索</button>
        <button type="button" role="tab" :aria-selected="homeSection === 'copyworks'" :class="{ active: homeSection === 'copyworks' }" @click="homeSection = 'copyworks'">我的抄写</button>
        <button type="button" role="tab" :aria-selected="homeSection === 'notes'" :class="{ active: homeSection === 'notes' }" @click="homeSection = 'notes'">我的笔记</button>
        <button type="button" role="tab" :aria-selected="homeSection === 'favorites'" :class="{ active: homeSection === 'favorites' }" @click="homeSection = 'favorites'">经文收藏<span>{{ favorites.length }}</span></button>
      </nav>
      <button v-if="canClose" class="bible-home-close" type="button" :aria-label="`关闭 ${label} 窗格`" title="关闭窗格" @click="emit('close', pane.id)"><X :size="17" /></button>
      </div>

      <section v-if="homeSection === 'catalog' && catalog" class="bible-catalog">
        <section><h3>旧约</h3><div class="bible-book-grid"><button v-for="book in catalog.oldTestament" :key="book.code" type="button" @click="chooseBook(book)"><strong>{{ book.name }}</strong><small>{{ book.chapterCount }}章</small></button></div></section>
        <section><h3>新约</h3><div class="bible-book-grid"><button v-for="book in catalog.newTestament" :key="book.code" type="button" @click="chooseBook(book)"><strong>{{ book.name }}</strong><small>{{ book.chapterCount }}章</small></button></div></section>
      </section>

      <section v-else-if="homeSection === 'search'" class="bible-search-panel">
        <div class="bible-search-tabs" role="tablist" aria-label="经文检索方式">
          <button type="button" :class="{ active: searchMode === 'topic' }" @click="searchMode = 'topic'">主题检索</button>
          <button type="button" :class="{ active: searchMode === 'text' }" @click="searchMode = 'text'">文本检索</button>
        </div>

        <form v-if="searchMode === 'topic'" class="bible-search-form" @submit.prevent="searchTopic(false)">
          <label :for="`bible-topic-query-${pane.id}`">想查看关于什么的经文？</label>
          <div class="bible-search-row"><div class="bible-query-field"><input :id="`bible-topic-query-${pane.id}`" v-model="topicQuery" maxlength="200" placeholder="例如：焦虑时怎样信靠神" /><BibleSearchHistory :id="`bible-topic-history-${pane.id}`" :entries="searchHistory" :error="historyError" @select="restoreSearchHistory" @clear="clearHistory" @retry="refreshHistory" /></div><button :disabled="topicBusy || topicQuery.trim().length < 2"><History v-if="matchingTopicHistory" :size="18" /><Search v-else :size="18" />{{ topicBusy ? "查找中" : matchingTopicHistory ? "查看历史" : "AI查找" }}</button></div>
          <small>AI只查找出处，经文正文始终来自本地和合本。</small>
          <div v-if="matchingTopicHistory" class="bible-history-match">
            <span>已搜索过，历史中有 {{ matchingTopicHistory.count }} 处经文。</span>
            <button type="button" :disabled="topicBusy" @click="searchTopic(!!appendAvailable)"><Plus :size="16" />{{ topicBusy ? "生成中" : appendAvailable ? "追加生成" : "载入历史" }}</button>
          </div>
          <p v-if="topicError" class="bible-search-error" role="alert">{{ topicError }}</p>
        </form>

        <form v-else class="bible-search-form" @submit.prevent="searchText(false)">
          <div class="bible-search-row"><div class="bible-query-field"><input :id="`bible-text-query-${pane.id}`" aria-label="检索经文原文" v-model="textQuery" maxlength="200" placeholder="例如：神爱世人，或输入多个关键词" /><BibleSearchHistory :id="`bible-text-history-${pane.id}`" :entries="searchHistory" :error="historyError" @select="restoreSearchHistory" @clear="clearHistory" @retry="refreshHistory" /></div><button :disabled="textBusy || !textQuery.trim()"><Search :size="18" />{{ textBusy ? "检索中" : "检索" }}</button></div>
          <div class="search-translation"><span>检索译本</span><BibleTranslationSelect v-model="searchTranslation" :translations="catalog.translations" label="检索译本" /></div>
          <p v-if="textError" class="bible-search-error" role="alert">{{ textError }}</p>
        </form>

        <div v-if="currentLookups.length" class="bible-selection-actions" role="group" aria-label="检索结果批量操作">
          <button type="button" @click="toggleAll">{{ selectedLookups.length === currentLookups.length ? '取消全选' : '全选当前结果' }}</button>
          <span>已选 {{ selectedLookups.length }} 处</span>
          <button type="button" :disabled="!selectedLookups.length" @click="copySelected">复制所选</button>
          <button type="button" :disabled="!selectedLookups.length || !canSend || passageShareDialog?.busy" @click="sendSelected">发送所选</button>
          <label class="bible-reference-only"><input v-model="referencesOnly" type="checkbox" role="switch" /><span class="switch" aria-hidden="true"></span>只复制出处</label>
        </div>
        <section v-if="searchMode === 'topic' && topicResult" class="bible-results" aria-live="polite">
          <header><strong>相关经文</strong><span>{{ topicResult.results.length }} 处</span><button v-if="topicResult.results.length" type="button" class="bible-copy-all" @click="copyTopicResults"><ClipboardCopy :size="15" />复制全部</button></header>
          <article v-for="lookup in topicResult.results" :key="lookup.normalizedReference" class="bible-result-card" @click="openTopicResult(lookup)">
            <label class="bible-result-select" @click.stop><input v-model="selectedResults" type="checkbox" :value="lookup.normalizedReference" :aria-label="`选择 ${lookup.normalizedReference}`" /><h3>{{ lookup.normalizedReference }}</h3></label>
            <p><template v-for="verse in lookup.verses" :key="verse.reference"><sup>{{ verse.verse }}</sup>{{ verse.text }}</template></p>
            <footer><button type="button" @click.stop="copyLookup(lookup)"><ClipboardCopy :size="16" />复制</button><button type="button" @click.stop="openTopicResult(lookup)"><BookOpen :size="16" />阅读上下文</button><button type="button" :disabled="!canSend" :title="canSend ? '' : sendUnavailableReason" @click.stop="sendLookup(lookup)"><Send :size="16" />发送</button></footer>
          </article>
        </section>

        <section v-if="searchMode === 'text' && textResult" class="bible-results" aria-live="polite">
          <header><strong>{{ textModeLabel }}</strong><span>共 {{ textResult.total }} 节</span><button v-if="textResult.total" type="button" class="bible-copy-all" :disabled="textBusy" @click="copyAllTextResults"><ClipboardCopy :size="15" />{{ textBusy ? "整理中…" : "复制全部" }}</button></header>
          <p v-if="!textResult.items.length" class="bible-empty">没有找到包含这段文字的经文。</p>
          <article v-for="item in textResult.items" :key="item.verse.reference" class="bible-result-card" @click="openTextResult(item)">
            <label class="bible-result-select" @click.stop><input v-model="selectedResults" type="checkbox" :value="item.verse.reference" :aria-label="`选择 ${item.verse.reference}`" /><h3>{{ item.verse.reference }}</h3></label>
            <p><template v-for="(segment, index) in verseSegments(item.verse.text, item.matches)" :key="index"><mark v-if="segment.highlighted">{{ segment.text }}</mark><template v-else>{{ segment.text }}</template></template></p>
            <footer><button type="button" @click.stop="copyTextItem(item)"><ClipboardCopy :size="16" />复制</button><button type="button" @click.stop="openTextResult(item)"><BookOpen :size="16" />阅读上下文</button><button type="button" :disabled="!canSend" :title="canSend ? '' : sendUnavailableReason" @click.stop="sendLookup(singleVerseLookup(item.verse))"><Send :size="16" />发送</button></footer>
          </article>
          <button v-if="textHasMore" type="button" class="bible-load-more" :disabled="textBusy" @click="searchText(true)">{{ textBusy ? "加载中…" : "加载更多" }}</button>
        </section>
      </section>

      <NoteLibrary v-else-if="homeSection === 'notes'" :key="accountId" :account-id="accountId" />
      <CopyworkLibrary v-else-if="homeSection === 'copyworks'" :account-id="accountId" :revision="copyworkRevision" @resume="emit('resume', $event)" />
      <section v-else-if="homeSection === 'favorites'" class="bible-favorites" aria-label="经文收藏夹">
        <template v-if="activeTopic">
          <header class="bible-topic-detail-head">
            <button class="bible-topic-back" type="button" aria-label="返回收藏夹" @click="activeTopicId = null"><ArrowLeft :size="17" /></button>
            <div class="bible-topic-detail-title">
              <template v-if="!topicRenameOpen">
                <h2><BookMarked :size="20" />{{ activeTopic.name }}</h2>
                <p>{{ activeTopic.passages.length }} 段经文 · 更新于 {{ new Date(activeTopic.updatedAt).toLocaleDateString() }}</p>
              </template>
              <form v-else class="bible-topic-rename-form" @submit.prevent="submitTopicRename">
                <input v-model="topicRenameDraft" maxlength="60" aria-label="新的主题名称" />
                <button type="submit" :disabled="topicsBusy">保存</button>
                <button type="button" @click="topicRenameOpen = false">取消</button>
              </form>
            </div>
            <span class="bible-topic-detail-actions">
              <button type="button" :disabled="!activeTopic.passages.length" @click="copyTopic"><ClipboardCopy :size="16" />复制全部</button>
              <button type="button" :disabled="topicsBusy" @click="topicRenameOpen = true; topicRenameDraft = activeTopic.name"><Pencil :size="16" />重命名</button>
              <button type="button" :disabled="topicsBusy || !activeTopic.passages.length || !canSend" :title="!canSend ? sendUnavailableReason : ''" @click="shareTopic(activeTopic)"><Share2 :size="16" />转发到聊天室</button>
              <button type="button" :disabled="topicsBusy" @click="removeTopic"><Trash2 :size="16" />删除</button>
            </span>
          </header>

          <form class="bible-topic-add-form" @submit.prevent="submitTopicPassages">
            <label :for="`bible-topic-reference-${pane.id}`">批量添加经文</label>
            <textarea :id="`bible-topic-reference-${pane.id}`" v-model="topicReferenceDraft" rows="3" :disabled="topicsBusy" placeholder="例如：申命记8:17–18；历代志上29:14–16；约伯记1:21；诗篇40:17；49:6–9；86:1" spellcheck="false"></textarea>
            <div class="bible-topic-add-row">
              <small>粘贴一处或多处经文章节号，支持书卷名、节范围与换行，自动按本地和合本解析</small>
              <button type="submit" :disabled="topicsBusy || !topicReferenceDraft.trim()"><ListPlus :size="16" />{{ topicsBusy ? "添加中…" : "解析并添加" }}</button>
            </div>
            <p v-if="topicAddNotice" class="bible-topic-add-notice" role="status">{{ topicAddNotice }}</p>
          </form>

          <p v-if="!activeTopic.passages.length" class="bible-empty">这个主题还没有经文。把经文章节号粘贴到上方输入框，一次就能添加多处。</p>
          <div v-else class="bible-favorite-grid">
            <article v-for="passage in activeTopic.passages" :key="passage.id" @click="openTopicPassage(passage)">
              <h3><BookOpen :size="15" />{{ passage.reference }}</h3>
              <p v-if="topicVerses[passage.id]?.length"><template v-for="verse in topicVerses[passage.id]" :key="verse.reference"><sup>{{ verse.verse }}</sup>{{ verse.text }}</template></p>
              <div v-else-if="topicVersesFailed.has(passage.id)" class="bible-topic-verse-failed">
                <span>正文暂时无法展开</span>
                <button type="button" @click.stop="retryTopicVerses(passage)">重试</button>
              </div>
              <p v-else class="bible-topic-verse-loading">正在展开正文…</p>
              <footer>
                <button type="button" :disabled="topicsBusy" @click.stop="removeTopicPassage(passage)"><Trash2 :size="15" />移除</button>
              </footer>
            </article>
          </div>
        </template>

        <template v-else>
          <header>
            <Bookmark :size="24" />
            <div><h2>经文收藏夹</h2><p>连续收藏的经文会自动合并，便于阅读和复制</p></div>
            <span>{{ favorites.length }} 节 · {{ favoritePassages.length }} 段</span>
          </header>

          <section class="bible-topic-strip" aria-label="经文主题">
            <div class="bible-topic-strip-head">
              <h3><BookMarked :size="17" />我的主题<span>{{ topics.length }}</span></h3>
              <button type="button" @click="topicCreateOpen = !topicCreateOpen"><Plus :size="16" />新建主题</button>
            </div>
            <form v-if="topicCreateOpen" class="bible-topic-create-form" @submit.prevent="submitTopicCreate">
              <input v-model="topicNameDraft" maxlength="60" placeholder="主题名称，例如：我们在神面前都是穷人" aria-label="主题名称" />
              <button type="submit" :disabled="topicsBusy || !topicNameDraft.trim()">创建</button>
              <button type="button" @click="topicCreateOpen = false">取消</button>
            </form>
            <p v-if="!topics.length" class="bible-topic-empty">创建主题，把一组经文收藏在一起：粘贴“申命记8:17–18；诗篇40:17”这样的章节号就能批量添加，还能整组转发到聊天室。</p>
            <div v-else class="bible-topic-grid">
              <article v-for="topic in topics" :key="topic.id" @click="openTopic(topic)">
                <h4><BookMarked :size="16" />{{ topic.name }}</h4>
                <p>{{ topic.passages.length }} 段经文 · 更新于 {{ new Date(topic.updatedAt).toLocaleDateString() }}</p>
                <footer>
                  <button type="button" @click.stop="openTopic(topic)"><BookOpen :size="15" />打开</button>
                  <button type="button" :disabled="topicsBusy || !topic.passages.length || !canSend" :title="!canSend ? sendUnavailableReason : ''" @click.stop="shareTopic(topic)"><Share2 :size="15" />转发</button>
                </footer>
              </article>
            </div>
          </section>

          <h3 class="bible-favorites-subhead">全部收藏</h3>
          <p v-if="favoritesBusy && !favorites.length" class="bible-empty">正在加载收藏…</p>
          <p v-else-if="!favorites.length" class="bible-empty">还没有收藏经文。在阅读时点选经文，再点“收藏”。</p>
          <div v-else class="bible-favorite-grid">
            <article v-for="passage in favoritePassages" :key="passage.key" @click="openBibleFavoritePassage(passage)">
              <h3><BookmarkCheck :size="16" />{{ passage.lookup.normalizedReference }}</h3>
              <p><template v-for="verse in passage.lookup.verses" :key="verse.reference"><sup>{{ verse.verse }}</sup>{{ verse.text }}</template></p>
              <footer><button type="button" @click.stop="copyLookup(passage.lookup)"><ClipboardCopy :size="15" />复制</button><button type="button" :disabled="favoritesBusy" @click.stop="removeBibleFavoritePassage(passage)"><Trash2 :size="15" />取消收藏</button></footer>
            </article>
          </div>
        </template>
      </section>

    </main>

    <main v-else ref="homeScroller" class="bible-chapter-picker">
      <button class="bible-chapter-back" type="button" aria-label="返回经卷目录" @click="selectedBook = null"><ArrowLeft :size="17" />返回目录</button>
      <button v-if="canClose" class="bible-home-close chapter-close" type="button" :aria-label="`关闭 ${label} 窗格`" title="关闭窗格" @click="emit('close', pane.id)"><X :size="17" /></button>
      <div class="bible-paper-heading"><span>选择章节</span><h1>{{ selectedBook.name }}</h1><p>共 {{ selectedBook.chapterCount }} 章</p></div>
      <div class="bible-chapter-grid"><button v-for="chapter in selectedBook.chapterCount" :key="chapter" type="button" @click="emit('book', selectedBook, chapter)">{{ chapter }}</button></div>
    </main>

    <BiblePassageShareDialog ref="passageShareDialog" :channel-name="channelName" :send-text="sendText" @sent="showToast(`已发送到：${channelName}`)" />
    <BibleTopicShareDialog ref="topicShareDialog" :channel-name="channelName" :share="topicActions.share" @sent="showToast(`已发送到：${channelName}`)" />
  </section>
</template>
<style scoped>
.bible-home-pane { min-width: 0; min-height: 0; display: grid; grid-template-rows: minmax(0, 1fr); overflow: hidden; background: #f3ecde; container-type: inline-size; }
.bible-home-pane.active { box-shadow: inset 0 0 0 1px rgba(166, 121, 70, .3); }
.bible-home, .bible-chapter-picker { scrollbar-width: none; }
.bible-home::-webkit-scrollbar, .bible-chapter-picker::-webkit-scrollbar, .bible-home-tabs::-webkit-scrollbar, .bible-history-list::-webkit-scrollbar { display: none; }
.bible-result-select { display: flex; gap: 10px; align-items: center; margin-bottom: 9px; cursor: pointer; }
.bible-result-select input { margin: 0; width: 20px; height: 20px; flex-shrink: 0; accent-color: #80613f; }
.bible-selection-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 12px; }
.bible-selection-actions button { min-height: 40px; padding: 6px 10px; color: #604b32; background: #fffaf1; border: 1px solid #cbb797; border-radius: 8px; font: inherit; }
.bible-selection-actions button:disabled { opacity: .45; }
/* 「只复制出处」开关：真实 input 铺满整个标签（opacity 0）才能被点中，视觉由 .switch 替身负责 */
.bible-reference-only { position: relative; display: inline-flex; align-items: center; gap: 8px; min-height: 40px; margin-left: auto; color: #604b32; cursor: pointer; user-select: none; }
.bible-reference-only input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.bible-reference-only .switch { flex: none; position: relative; width: 36px; height: 20px; border-radius: 999px; background: #d3c3a8; transition: background 160ms ease; }
.bible-reference-only .switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fffdf7; box-shadow: 0 1px 3px rgba(74, 52, 29, .3); transition: transform 160ms ease; }
.bible-reference-only input:checked + .switch { background: #b9582b; }
.bible-reference-only input:checked + .switch::after { transform: translateX(16px); }
.bible-reference-only input:focus-visible + .switch { outline: 2px solid rgba(185, 88, 43, .55); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { .bible-reference-only .switch, .bible-reference-only .switch::after { transition: none; } }
.bible-home, .bible-chapter-picker { min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.bible-home { padding: 26px max(16px, calc((100% - 1120px) / 2)) calc(44px + var(--safe-bottom)); }
.bible-home-navigation { max-width: 820px; margin: 0 auto 12px; display: flex; align-items: center; gap: 8px; }
.bible-home-close, .bible-home-back, .bible-chapter-back { flex-shrink: 0; min-height: 34px; border: 0; border-radius: 7px; padding: 6px; background: transparent; color: #725537; display: inline-flex; align-items: center; gap: 6px; font: inherit; cursor: pointer; }
.bible-home-close { width: 34px; justify-content: center; }
.bible-home-tabs { min-width: 0; flex: 1; margin: 0; padding: 5px; border: 1px solid rgba(116, 84, 48, .14); border-radius: 14px; background: rgba(233, 223, 207, .86); display: grid; grid-template-columns: repeat(5, minmax(max-content, 1fr)); overflow-x: auto; scrollbar-width: none; gap: 5px; box-shadow: 0 8px 24px rgba(75, 51, 25, .06); }
.bible-home-tabs button { min-height: 44px; padding: 0 12px; white-space: nowrap; border: 0; border-radius: 10px; color: #765b40; background: transparent; display: inline-flex; align-items: center; justify-content: center; gap: 7px; font: inherit; font-weight: 800; cursor: pointer; }
.bible-home-tabs button.active { color: #fffaf1; background: #80613f; box-shadow: 0 4px 12px rgba(87, 60, 31, .18); }
.bible-home-tabs button span { min-width: 22px; padding: 2px 6px; border-radius: 999px; color: inherit; background: rgba(255, 255, 255, .2); font-size: 11px; }
.bible-home-tabs button:not(.active) span { background: rgba(128, 97, 63, .1); }
.bible-search-panel { max-width: 820px; margin: 0 auto 34px; padding: 18px; border: 1px solid rgba(116, 84, 48, .18); border-radius: 18px; background: rgba(255, 252, 245, .88); box-shadow: 0 12px 36px rgba(75, 51, 25, .08); }
.bible-search-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; padding: 4px; border-radius: 12px; background: #e9dfcf; }
.bible-search-tabs button { min-height: 42px; border: 0; border-radius: 9px; color: #765b40; background: transparent; font: inherit; font-weight: 700; cursor: pointer; }
.bible-search-tabs button.active { color: #fffaf1; background: #80613f; box-shadow: 0 4px 12px rgba(87, 60, 31, .18); }
.bible-search-form { display: grid; gap: 9px; margin-top: 18px; }
.bible-search-form label { font: inherit; font-weight: 700; }
.bible-search-form > .bible-search-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
.bible-query-field { position: relative; display: flex; min-width: 0; }
.bible-search-form .search-translation { display: flex; align-items: center; gap: 9px; color: #8a735c; font-size: 13px; }
.bible-search-form input { width: 100%; box-sizing: border-box; min-width: 0; height: 48px; border: 1px solid #cdbb9f; border-radius: 11px; padding: 0 48px 0 14px; color: #3f3227; background: #fffef9; font: inherit; font-size: 16px; outline: none; }
.bible-search-form input:focus { border-color: #967046; box-shadow: 0 0 0 3px rgba(150, 112, 70, .14); }
.bible-search-form button, .bible-load-more { border: 0; border-radius: 11px; padding: 0 18px; color: white; background: #80613f; display: inline-flex; align-items: center; justify-content: center; gap: 6px; font: inherit; font-weight: 700; cursor: pointer; }
.bible-search-form button:disabled, .bible-result-card button:disabled, .bible-verse-action button:disabled { opacity: .45; cursor: not-allowed; }
.bible-search-form small { color: #8a735c; }
.bible-search-error { margin: 0; color: #a4382c; }
.bible-search-form > .bible-history-match { display: flex; grid-template-columns: none; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 12px; border: 1px solid rgba(128, 97, 63, .2); border-radius: 10px; color: #74583b; background: #f6efe2; }
.bible-history-match span { min-width: 0; }
.bible-history-match button { flex: 0 0 auto; min-height: 34px; padding: 0 11px; border: 1px solid #b89b77; border-radius: 8px; color: #6d5135; background: #fffaf1; font-size: 13px; }
.bible-results { display: grid; gap: 12px; margin-top: 22px; }
.bible-results > header { display: flex; align-items: center; justify-content: space-between; color: #6d5135; }
.bible-copy-all { min-height: 32px; border: 1px solid #bda581; border-radius: 9px; padding: 0 10px; color: #6d5135; background: #fffaf1; display: inline-flex; align-items: center; gap: 5px; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; }
.bible-copy-all:disabled { opacity: .5; cursor: wait; }
.bible-result-card { padding: 16px; border: 1px solid rgba(117, 84, 47, .16); border-radius: 13px; background: #fffdf7; cursor: pointer; }
.bible-result-card:hover { border-color: rgba(128, 97, 63, .4); box-shadow: 0 7px 20px rgba(76, 51, 25, .08); }
.bible-result-card h3 { margin: 0; color: #76502d; font: inherit; font-weight: 800; line-height: 1.4; }
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
.bible-favorites-subhead { margin: 22px 0 10px; color: #6d5135; font-family: "Songti SC", "STSong", serif; }
.bible-topic-strip { margin-top: 6px; }
.bible-topic-strip-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
.bible-topic-strip-head h3 { margin: 0; color: #6d5135; display: flex; align-items: center; gap: 6px; font-family: "Songti SC", "STSong", serif; }
.bible-topic-strip-head h3 span { min-width: 20px; padding: 1px 7px; border-radius: 999px; color: #8b7259; background: rgba(128, 97, 63, .12); font-size: 12px; }
.bible-topic-strip-head > button, .bible-topic-create-form button, .bible-topic-rename-form button { min-height: 34px; border: 1px solid #80613f; color: #fffaf1; background: #80613f; border-radius: 8px; padding: 0 11px; display: inline-flex; align-items: center; gap: 5px; font: inherit; font-weight: 700; cursor: pointer; }
.bible-topic-create-form button[type="button"], .bible-topic-rename-form button[type="button"] { color: #6d5135; background: #faf4e8; border-color: #cbb797; }
.bible-topic-strip-head > button:disabled, .bible-topic-create-form button:disabled, .bible-topic-rename-form button:disabled { opacity: .45; cursor: not-allowed; }
.bible-topic-create-form, .bible-topic-rename-form { display: flex; gap: 8px; margin-bottom: 12px; }
.bible-topic-create-form input, .bible-topic-rename-form input { flex: 1; min-width: 0; height: 40px; border: 1px solid #cdbb9f; border-radius: 9px; padding: 0 12px; color: #3f3227; background: #fffef9; font: inherit; outline: none; }
.bible-topic-create-form input:focus, .bible-topic-rename-form input:focus { border-color: #967046; }
.bible-topic-empty { margin: 0; padding: 12px 14px; border: 1px dashed rgba(128, 97, 63, .3); border-radius: 11px; color: #8c745c; background: rgba(255, 252, 245, .6); }
.bible-topic-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.bible-topic-grid article { min-width: 0; padding: 13px 14px; border: 1px solid rgba(117, 84, 47, .16); border-radius: 12px; background: #fffdf7; cursor: pointer; }
.bible-topic-grid article:hover { border-color: rgba(128, 97, 63, .4); box-shadow: 0 7px 20px rgba(76, 51, 25, .08); }
.bible-topic-grid h4 { margin: 0 0 6px; color: #76502d; display: flex; align-items: center; gap: 6px; font-family: "Songti SC", "STSong", serif; overflow-wrap: anywhere; }
.bible-topic-grid p { margin: 0; color: #8b7259; font-size: 13px; }
.bible-topic-grid footer { display: flex; justify-content: flex-end; gap: 7px; margin-top: 10px; }
.bible-topic-grid footer button { min-height: 32px; border: 1px solid #cbb797; border-radius: 8px; padding: 0 9px; color: #6d5135; background: #faf4e8; display: inline-flex; align-items: center; gap: 4px; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; }
.bible-topic-grid footer button:disabled { opacity: .45; cursor: not-allowed; }
.bible-topic-detail-head { margin-bottom: 14px; color: #6d5135; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 10px; }
.bible-topic-back { flex-shrink: 0; min-height: 34px; border: 0; border-radius: 7px; padding: 6px; background: transparent; color: #725537; display: inline-flex; align-items: center; cursor: pointer; }
.bible-topic-detail-title { min-width: 0; }
.bible-topic-detail-title h2 { margin: 0; display: flex; align-items: center; gap: 7px; color: #76502d; font-family: "Songti SC", "STSong", serif; overflow-wrap: anywhere; }
.bible-topic-detail-title p { margin: 3px 0 0; color: #8b7259; font-size: 13px; }
.bible-topic-rename-form input { height: 36px; }
.bible-topic-detail-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; }
.bible-topic-detail-actions button { min-height: 34px; border: 1px solid #cbb797; border-radius: 8px; padding: 0 10px; color: #6d5135; background: #faf4e8; display: inline-flex; align-items: center; gap: 4px; font: inherit; font-size: 13px; font-weight: 700; cursor: pointer; }
.bible-topic-detail-actions button:disabled { opacity: .45; cursor: not-allowed; }
.bible-topic-detail-actions button:not(:disabled):last-of-type { color: #a4382c; }
.bible-topic-add-form { display: grid; gap: 8px; margin-bottom: 18px; padding: 13px 14px; border: 1px solid rgba(128, 97, 63, .2); border-radius: 12px; background: #f6efe2; }
.bible-topic-add-form label { color: #74583b; font-weight: 700; }
.bible-topic-add-form textarea { width: 100%; box-sizing: border-box; border: 1px solid #cdbb9f; border-radius: 9px; padding: 9px 12px; color: #3f3227; background: #fffef9; font: inherit; line-height: 1.6; resize: vertical; outline: none; }
.bible-topic-add-form textarea:focus { border-color: #967046; }
.bible-topic-add-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.bible-topic-add-row small { color: #8a735c; }
.bible-topic-add-row button { min-height: 38px; border: 0; border-radius: 9px; padding: 0 13px; color: #fffaf1; background: #80613f; display: inline-flex; align-items: center; gap: 5px; font: inherit; font-weight: 700; cursor: pointer; }
.bible-topic-add-row button:disabled { opacity: .45; cursor: not-allowed; }
.bible-topic-add-notice { margin: 0; color: #4d6b3c; font-weight: 700; }
.bible-topic-verse-loading { color: #9b8268; }
.bible-topic-verse-failed { display: flex; align-items: center; gap: 8px; color: #a4382c; }
.bible-topic-verse-failed button { min-height: 30px; border: 1px solid #cbb797; border-radius: 7px; padding: 0 9px; color: #6d5135; background: #faf4e8; font: inherit; font-size: 13px; cursor: pointer; }
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
.bible-chapter-picker { position: relative; padding: 48px max(18px, calc((100% - 760px) / 2)) calc(48px + var(--safe-bottom)); }
.bible-chapter-back { position: absolute; top: 12px; left: 12px; }
.chapter-close { position: absolute; top: 12px; right: 12px; }
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
@container (max-width: 600px) {
.bible-home { padding: 15px 12px calc(34px + var(--safe-bottom)); }
.bible-home-tabs button { padding: 0 8px; font-size: 13px; gap: 4px; }
.bible-search-panel { padding: 12px; }
.bible-search-form > .bible-search-row { grid-template-columns: minmax(0, 1fr); }
.bible-search-form button { min-height: 44px; }
.bible-book-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.bible-chapter-grid { grid-template-columns: repeat(5, 1fr); }
.bible-result-card footer { flex-wrap: wrap; }
.bible-results > header { flex-wrap: wrap; gap: 8px; }
.bible-favorite-grid { grid-template-columns: minmax(0, 1fr); }
.bible-topic-grid { grid-template-columns: minmax(0, 1fr); }
.bible-topic-detail-head { grid-template-columns: auto minmax(0, 1fr); }
.bible-topic-detail-actions { grid-column: 1 / -1; justify-content: flex-start; }
.bible-topic-add-row { flex-direction: column; align-items: stretch; }
.bible-topic-add-row button { justify-content: center; }
}
</style>
