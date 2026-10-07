<script setup lang="ts">
import { ref } from "vue";
import type { BibleVerseLineDTO } from "@shared/types";
import { copyworkCharacters, type CopyworkDTO, type CopyworkSource } from "@shared/bibleCopywork";
import { copyworkWrite as api } from "./copyworkApi";
import AppModal from "../../../components/ui/AppModal.vue";
import CopyworkComposer from "./CopyworkComposer.vue";
import CopyworkViewer from "./CopyworkViewer.vue";
import type { CopyworkVerseFilter } from "./copyworkViewerState";
import type { CopyworkDraft } from "./copyworkDrafts";
const props = defineProps<{ accountId: number }>();
const emit = defineEmits<{ changed: []; chat: [] }>();
const source = ref<CopyworkSource | null>(null);
const starting = ref(false);
const error = ref("");
const setupOpen = ref(false);
const draft = ref<CopyworkDraft | null>(null);
const workId = ref("");
const filter = ref<CopyworkVerseFilter | null>(null);
async function start(selection: {
  translation: string;
  bookCode: string;
  verses: BibleVerseLineDTO[];
}) {
  setupOpen.value = true;
  source.value = null;
  error.value = "";
  starting.value = true;
  try {
    const sorted = [...selection.verses].sort((a, b) => a.chapter - b.chapter || a.verse - b.verse);
    if (
      !sorted.length ||
      sorted.some(
        (v, i) =>
          v.chapter !== sorted[0].chapter ||
          (i > 0 && v.verse !== (sorted[i - 1].endVerse || sorted[i - 1].verse) + 1)
      )
    )
      throw new Error("请选择同一章内连续的完整经节");
    const response = await api<{ source: CopyworkSource }>("/api/bible/copyworks/source", {
      method: "POST",
      body: JSON.stringify({
        translation: selection.translation,
        bookCode: selection.bookCode,
        chapter: sorted[0].chapter,
        verseStart: sorted[0].verse,
        verseEnd: sorted.at(-1)!.endVerse || sorted.at(-1)!.verse
      })
    });
    source.value = response.source;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "经文加载失败";
  } finally {
    starting.value = false;
  }
}
function begin() {
  if (!source.value) return;
  draft.value = {
    id: crypto.randomUUID(),
    accountId: props.accountId,
    source: source.value,
    spacing: "normal",
    glyphs: [],
    current: { strokes: [] },
    index: 0,
    updatedAt: Date.now()
  };
  setupOpen.value = false;
}
function resume(value: CopyworkDraft) {
  filter.value = null;
  draft.value = value;
}
function saved(work: CopyworkDTO) {
  draft.value = null;
  filter.value = null;
  workId.value = work.id;
  changed();
}
function changed() {
  emit("changed");
  window.dispatchEvent(new Event("bible-copyworks-changed"));
}
function browse(value: NonNullable<typeof filter.value>) {
  workId.value = "";
  filter.value = value;
}
defineExpose({ start, resume, browse });
</script>
<template>
  <AppModal
    :open="setupOpen"
    title="把这段经文写下来"
    :busy="starting"
    content-class="copywork-setup"
    @close="setupOpen = false"
  >
    <div class="setup-body">
      <p v-if="starting">正在准备经文…</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <template v-if="source"
        ><h2>{{ source.reference }}</h2>
        <small
          >{{ source.translationName }} · {{ copyworkCharacters(source.text).length }} 字</small
        >
        <p class="source-text">{{ source.text }}</p>
        <p class="muted">逐字书写，随时停下，下次继续。完成后默认只有自己可见。</p>
        <button @click="begin">开始抄写</button></template
      >
    </div>
  </AppModal>
  <CopyworkComposer
    v-if="draft"
    :key="draft.id"
    :draft="draft"
    @close="
      draft = null;
      emit('changed');
    "
    @saved="saved"
  />
  <CopyworkViewer
    v-if="workId || filter"
    :key="workId || JSON.stringify(filter)"
    :id="workId || undefined"
    :filter="filter || undefined"
    @close="workId = ''; filter = null"
    @changed="changed"
    @chat="emit('chat')"
  />
</template>
<style scoped>
:deep(.copywork-setup) {
  background: #f8f3e9;
  color: #63513b;
}
.setup-body {
  padding: 20px;
  overflow: auto;
  max-height: 70dvh;
}
.source-text {
  line-height: 2;
  font-family: "Songti SC", serif;
  font-size: 19px;
}
.muted,
small {
  color: #87765f;
  font-size: 13px;
}
.setup-body button {
  min-height: 44px;
  padding: 10px 24px;
  background: #415c4c;
  color: white;
  border: 0;
  border-radius: 8px;
  font: inherit;
}
</style>
