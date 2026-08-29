<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { X } from "lucide-vue-next";
import type { BibleLookupDTO, BibleVerseLineDTO } from "@shared/types";
import { api } from "../../api";
import { sermonContextVerseIsCurrent } from "./sermonContext";

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
const chapter = ref<BibleLookupDTO | null>(null);
const loading = ref(false);
const error = ref("");
let requestGeneration = 0;

const target = computed(() => props.verses[0] || null);
const chapterKey = computed(() => target.value ? `${target.value.book}:${target.value.chapter}` : "");
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
  body.scrollTop = Math.max(0, current.offsetTop - (body.clientHeight - current.offsetHeight) / 2);
}

watch(
  chapterKey,
  async (key) => {
    const generation = ++requestGeneration;
    chapter.value = null;
    error.value = "";
    if (!key || !target.value) return;
    loading.value = true;
    try {
      const reference = `${target.value.book}${target.value.chapter}章`;
      const response = await api<{ success: boolean; result?: BibleLookupDTO; message?: string }>(
        `/api/bible/lookup?reference=${encodeURIComponent(reference)}`
      );
      if (generation !== requestGeneration) return;
      if (!response.success || !response.result) throw new Error(response.message || "暂时找不到上下文");
      chapter.value = response.result;
      await centerCurrentVerse();
    } catch (reason) {
      if (generation === requestGeneration) error.value = reason instanceof Error ? reason.message : "暂时找不到上下文";
    } finally {
      if (generation === requestGeneration) loading.value = false;
    }
  },
  { immediate: true }
);

watch(selectionKey, () => {
  if (chapter.value) void centerCurrentVerse();
});

function handlePanelClick(event: MouseEvent) {
  if (!props.closeable) return;
  const targetElement = event.target instanceof Element ? event.target : null;
  if (!targetElement?.closest(".sermon-context-current") && !targetElement?.closest(".sermon-context-close")) emit("close");
}
</script>

<template>
  <section class="sermon-context-panel" :class="{ compact: props.compact }" aria-label="经文上下文" @click="handlePanelClick">
    <header>
      <span>
        <strong>经文上下文</strong>
        <small v-if="target">{{ target.book }} 第 {{ target.chapter }} 章</small>
      </span>
      <button
        v-if="props.closeable"
        class="sermon-context-close"
        type="button"
        aria-label="关闭经文上下文"
        @click.stop="emit('close')"
      ><X :size="18" /></button>
    </header>
    <div ref="bodyEl" class="sermon-context-body">
      <p v-if="!target" class="sermon-context-status">投影经文后，这里会显示所在章节的上下文。</p>
      <p v-else-if="loading" class="sermon-context-status">正在载入上下文…</p>
      <p v-else-if="error" class="sermon-context-status sermon-error" role="alert">{{ error }}</p>
      <p v-else class="sermon-context-paragraph">
        <span
          v-for="verse in chapter?.verses || []"
          :key="`${verse.book}-${verse.chapter}-${verse.verse}`"
          class="sermon-context-verse"
          :class="{ 'sermon-context-current': isCurrentVerse(verse) }"
        >
          <sup>{{ verse.verse }}</sup>
          <span>{{ verse.text }}</span>
        </span>
      </p>
    </div>
    <small v-if="props.closeable" class="sermon-context-help">上下滚动查看；点按高亮经文以外的位置退出上下文。</small>
  </section>
</template>
