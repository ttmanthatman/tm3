<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { BIBLE_STUDY_RELATION_LABELS, BIBLE_STUDY_STAGE_DETAILS, type BibleStudyRecord, type BibleStudyRecordPage } from "@shared/bibleStudy";
import { api } from "../../api";

const props = defineProps<{ endpoint: string; emptyLabel: string; showSender?: boolean; showQuestions?: boolean }>();
const records = ref<BibleStudyRecord[]>([]);
const before = ref<number | null>(null);
const busy = ref(false);
const error = ref("");
const date = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" });
const visibleRecords = computed(() => records.value.map(record => ({
  ...record,
  text: record.summary ? record.content.replace(/^\*\*(.+)\*\*$/gm, "$1") : record.content
})));

async function load(older = false) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    const query = older && before.value ? `?before=${before.value}` : "";
    const page = await api<BibleStudyRecordPage>(props.endpoint + query);
    records.value = older ? [...records.value, ...page.records] : page.records;
    before.value = page.nextBefore;
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "查经记录加载失败";
  } finally {
    busy.value = false;
  }
}
onMounted(() => load());
</script>

<template>
  <section class="study-records" :aria-busy="busy">
    <div v-if="showSender || error" class="study-record-actions">
      <button class="mini-btn secondary" type="button" :disabled="busy" @click="load()">刷新记录</button>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="busy && !records.length" role="status">正在读取查经记录…</p>
    <p v-else-if="!error && !records.length">{{ emptyLabel }}</p>
    <article v-for="record in visibleRecords" :key="record.id" :class="{ 'study-summary': record.summary }">
      <header>
        <strong v-if="showSender">{{ record.sender }}{{ record.summary ? ' · 小结' : '' }}</strong>
        <time :datetime="record.createdAt">{{ date.format(new Date(record.createdAt)) }}</time>
      </header>
      <template v-if="showQuestions && record.question">
        <small>{{ BIBLE_STUDY_STAGE_DETAILS[record.question.stage].label }} · {{ BIBLE_STUDY_RELATION_LABELS[record.question.relation] }}</small>
        <p>{{ record.question.text }}</p>
        <p class="question-purpose">为什么问 · {{ record.question.purpose }}</p>
        <p v-if="record.question.evidence.length" class="question-purpose">经文依据 · {{ record.question.evidence.join('、') }}</p>
        <p v-if="record.question.parentId && visibleRecords.some(entry => entry.id === record.question?.parentId && entry.question)" class="question-purpose">
          承接 · {{ visibleRecords.find(entry => entry.id === record.question?.parentId)?.question?.text }}
        </p>
        <details v-if="record.text !== record.question.text">
          <summary>助手完整回应</summary>
          <p>{{ record.text }}</p>
        </details>
      </template>
      <p v-else>{{ record.text }}</p>
    </article>
    <button v-if="before" class="mini-btn secondary" type="button" :disabled="busy" @click="load(true)">更早的记录</button>
  </section>
</template>

<style scoped>
.study-records { display: grid; align-content: start; gap: 0.85rem; min-width: 0; }
.study-record-actions { display: flex; }
article { min-width: 0; padding: 0.65rem 0.85rem; border-inline-start: 2px solid currentColor; }
article.study-summary { background: color-mix(in srgb, currentColor 5%, transparent); }
header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem 1rem; }
time { font-size: 0.78rem; opacity: 0.72; }
p { margin: 0; font-size: 0.93rem; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }
header + p { margin-top: 0.45rem; }
.question-purpose { font-size: .82rem; opacity: .78; margin-top: .25rem; }
details { margin-top: .3rem; }
summary { width: fit-content; font-size: .82rem; cursor: pointer; }
</style>
