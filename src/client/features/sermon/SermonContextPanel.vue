<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { X } from "lucide-vue-next";
import type {
  BibleBookCatalogDTO,
  BibleCatalogDTO,
  BibleChapterDTO,
  BibleVerseLineDTO
} from "@shared/types";
import { api } from "../../api";
import {
  sermonContextBookForVerse,
  sermonContextInitialChapterNumbers,
  sermonContextScrollChapterTargets,
  sermonContextVerseIsCurrent
} from "./sermonContext";

const props = withDefaults(
  defineProps<{
    verses: BibleVerseLineDTO[];
    closeable?: boolean;
    compact?: boolean;
  }>(),
  { closeable: false, compact: false }
);

const emit = defineEmits<{ close: [] }>();
const bodyEl = ref<HTMLElement | null>(null);
const catalog = ref<BibleCatalogDTO | null>(null);
const contextBook = ref<BibleBookCatalogDTO | null>(null);
const chapters = ref<Record<number, BibleChapterDTO>>({});
const busyChapters = ref<Set<number>>(new Set());
const loading = ref(false);
const error = ref("");
let requestGeneration = 0;
const chapterCache = new Map<string, BibleChapterDTO>();

const target = computed(() => props.verses[0] || null);
const chapterKey = computed(() => target.value ? `${target.value.book}:${target.value.chapter}` : "");
const loadedChapters = computed(() => Object.values(chapters.value).sort((left, right) => left.chapter - right.chapter));
const selectionKey = computed(() => props.verses
  .map((verse) => `${verse.book}:${verse.chapter}:${verse.verse}-${verse.endVerse ?? verse.verse}`)
  .join("|"));

function isCurrentVerse(verse: BibleVerseLineDTO) {
  return sermonContextVerseIsCurrent(verse, props.verses);
}

async function centerCurrentVerse() {
  await nextTick();
  const body = bodyEl.value;
  const current = body?.querySelector<HTMLElement>(".sermon-context-current");
  if (!body || !current) return;
  const currentTop = current.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
  body.scrollTop = Math.max(0, currentTop - (body.clientHeight - current.offsetHeight) / 2);
}

async function ensureCatalog() {
  if (catalog.value) return catalog.value;
  const response = await api<{ success: boolean; result?: BibleCatalogDTO; message?: string }>("/api/bible/catalog");
  if (!response.success || !response.result) throw new Error(response.message || "暂时找不到圣经目录");
  catalog.value = response.result;
  return response.result;
}

async function fetchChapter(book: BibleBookCatalogDTO, chapter: number) {
  const key = `${book.code.toUpperCase()}:${chapter}`;
  const cached = chapterCache.get(key);
  if (cached) return cached;
  const response = await api<{ success: boolean; result?: BibleChapterDTO; message?: string }>(
    `/api/bible/chapter?book=${encodeURIComponent(book.code)}&chapter=${chapter}`
  );
  if (!response.success || !response.result) throw new Error(response.message || "暂时找不到这一章经文");
  chapterCache.set(key, response.result);
  return response.result;
}

async function loadChapter(chapter: number, prepend: boolean, generation = requestGeneration) {
  const book = contextBook.value;
  if (
    !book
    || chapter < 1
    || chapter > book.chapterCount
    || chapters.value[chapter]
    || busyChapters.value.has(chapter)
  ) return;

  busyChapters.value = new Set(busyChapters.value).add(chapter);
  const body = bodyEl.value;
  const anchorChapter = prepend ? loadedChapters.value[0]?.chapter : undefined;
  const anchorBefore = anchorChapter
    ? body?.querySelector<HTMLElement>(`[data-context-chapter="${anchorChapter}"]`)?.getBoundingClientRect().top
    : undefined;

  try {
    const result = await fetchChapter(book, chapter);
    if (generation !== requestGeneration || contextBook.value?.code !== book.code) return;
    chapters.value = { ...chapters.value, [chapter]: result };
    error.value = "";
    await nextTick();
    if (body && anchorChapter && anchorBefore !== undefined) {
      const anchorAfter = body.querySelector<HTMLElement>(`[data-context-chapter="${anchorChapter}"]`)?.getBoundingClientRect().top;
      if (anchorAfter !== undefined) body.scrollTop += anchorAfter - anchorBefore;
    }
  } catch (reason) {
    if (generation === requestGeneration) error.value = reason instanceof Error ? reason.message : "暂时找不到上下文";
  } finally {
    if (generation === requestGeneration) {
      const nextBusy = new Set(busyChapters.value);
      nextBusy.delete(chapter);
      busyChapters.value = nextBusy;
    }
  }
}

async function fillContextViewport(generation: number) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await nextTick();
    const body = bodyEl.value;
    const book = contextBook.value;
    const first = loadedChapters.value[0]?.chapter;
    const last = loadedChapters.value.at(-1)?.chapter;
    if (
      generation !== requestGeneration
      || !body
      || !book
      || first === undefined
      || last === undefined
      || body.scrollHeight > body.clientHeight + 120
    ) return;
    if (first > 1) await loadChapter(first - 1, true, generation);
    else if (last < book.chapterCount) await loadChapter(last + 1, false, generation);
    else return;
  }
}

async function loadInitialContext() {
  const generation = ++requestGeneration;
  const currentTarget = target.value;
  chapters.value = {};
  contextBook.value = null;
  busyChapters.value = new Set();
  error.value = "";
  if (!currentTarget) return;
  loading.value = true;

  try {
    const nextCatalog = await ensureCatalog();
    const book = sermonContextBookForVerse(nextCatalog, currentTarget.book);
    if (!book) throw new Error("暂时找不到这卷书的上下文");
    contextBook.value = book;

    const chapterNumbers = sermonContextInitialChapterNumbers(currentTarget.chapter, book.chapterCount);
    const targetChapter = await fetchChapter(book, currentTarget.chapter);
    if (generation !== requestGeneration) return;
    chapters.value = { [currentTarget.chapter]: targetChapter };

    const neighborResults = await Promise.allSettled(
      chapterNumbers
        .filter((chapter) => chapter !== currentTarget.chapter)
        .map(async (chapter) => ({ chapter, result: await fetchChapter(book, chapter) }))
    );
    if (generation !== requestGeneration) return;
    const nextChapters = { ...chapters.value };
    for (const result of neighborResults) {
      if (result.status === "fulfilled") nextChapters[result.value.chapter] = result.value.result;
    }
    chapters.value = nextChapters;
    await fillContextViewport(generation);
    await centerCurrentVerse();
  } catch (reason) {
    if (generation === requestGeneration) error.value = reason instanceof Error ? reason.message : "暂时找不到上下文";
  } finally {
    if (generation === requestGeneration) loading.value = false;
  }
}

function handleContextScroll() {
  const body = bodyEl.value;
  const book = contextBook.value;
  const first = loadedChapters.value[0]?.chapter;
  const last = loadedChapters.value.at(-1)?.chapter;
  if (!body || !book || first === undefined || last === undefined) return;
  const targets = sermonContextScrollChapterTargets({
    scrollTop: body.scrollTop,
    scrollHeight: body.scrollHeight,
    clientHeight: body.clientHeight,
    firstChapter: first,
    lastChapter: last,
    chapterCount: book.chapterCount
  });
  if (targets.previous !== null) void loadChapter(targets.previous, true);
  if (targets.next !== null) void loadChapter(targets.next, false);
}

function resetContext() {
  void centerCurrentVerse();
}

watch(chapterKey, () => {
  void loadInitialContext();
}, { immediate: true });

watch(selectionKey, () => {
  if (chapters.value[target.value?.chapter || 0]) void centerCurrentVerse();
});

function handlePanelClick(event: MouseEvent) {
  if (!props.closeable) return;
  const targetElement = event.target instanceof Element ? event.target : null;
  if (
    !targetElement?.closest(".sermon-context-current")
    && !targetElement?.closest(".sermon-context-close")
    && !targetElement?.closest(".sermon-context-reset")
  ) emit("close");
}
</script>

<template>
  <section class="sermon-context-panel" :class="{ compact: props.compact }" aria-label="经文上下文" @click="handlePanelClick">
    <header>
      <span>
        <strong>上下文</strong>
        <small v-if="target">{{ target.book }} 第 {{ target.chapter }} 章</small>
      </span>
      <div class="sermon-context-actions">
        <button
          v-if="target"
          class="sermon-context-reset"
          type="button"
          :disabled="loading"
          aria-label="将当前投影经文复位到上下文中间"
          @click.stop="resetContext"
        >复位</button>
        <button
          v-if="props.closeable"
          class="sermon-context-close"
          type="button"
          aria-label="关闭经文上下文"
          @click.stop="emit('close')"
        ><X :size="18" /></button>
      </div>
    </header>
    <div ref="bodyEl" class="sermon-context-body" :aria-busy="loading" @scroll.passive="handleContextScroll">
      <p v-if="!target" class="sermon-context-status">投影经文后，这里会显示所在章节的上下文。</p>
      <p v-else-if="loading && !loadedChapters.length" class="sermon-context-status">正在载入上下文…</p>
      <p v-else-if="error && !loadedChapters.length" class="sermon-context-status sermon-error" role="alert">{{ error }}</p>
      <template v-else>
        <p v-if="busyChapters.has((loadedChapters[0]?.chapter || 1) - 1)" class="sermon-context-load-status">正在载入上一章…</p>
        <section
          v-for="chapter in loadedChapters"
          :key="chapter.chapter"
          class="sermon-context-chapter"
          :data-context-chapter="chapter.chapter"
        >
          <h4>{{ chapter.bookName }} 第 {{ chapter.chapter }} 章</h4>
          <p class="sermon-context-paragraph">
            <span
              v-for="verse in chapter.verses"
              :key="`${verse.book}-${verse.chapter}-${verse.verse}`"
              class="sermon-context-verse"
              :class="{ 'sermon-context-current': isCurrentVerse(verse) }"
            >
              <sup>{{ verse.verse }}</sup>
              <span>{{ verse.text }}</span>
            </span>
          </p>
        </section>
        <p v-if="busyChapters.has((loadedChapters.at(-1)?.chapter || 0) + 1)" class="sermon-context-load-status">正在载入下一章…</p>
        <p v-if="error" class="sermon-context-load-status sermon-error" role="alert">{{ error }}</p>
      </template>
    </div>
    <small v-if="props.closeable" class="sermon-context-help">上下滚动浏览本卷；“复位”可回到当前经文，点按高亮经文以外的位置退出。</small>
  </section>
</template>
