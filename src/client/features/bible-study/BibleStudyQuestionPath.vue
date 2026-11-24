<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { ChevronDown, ChevronUp, CircleHelp } from "lucide-vue-next";
import { BIBLE_STUDY_RELATION_LABELS, type BibleStudyQuestion, type BibleStudyAnswer } from "@shared/bibleStudy";
import { api } from "../../api";
import { studyQuestionTree } from "./questionTree";

const props = defineProps<{
  questions: BibleStudyQuestion[];
  answers: BibleStudyAnswer[];
  busy: boolean;
}>();
const emit = defineEmits<{ select: [id: number, automatic: boolean]; sent: []; help: []; reference: [value: string] }>();
const selectedId = ref<number>();
const scrollRoot = ref<HTMLElement>();
const questionsOpen = ref(true);
const submitBusy = ref(false);
const errorText = ref("");
const drafts = ref<Record<string, string>>({});
const retryRequest = ref<{ snapshot: string; id: string }>();
const tree = computed(() => studyQuestionTree(props.questions));
const current = computed(() => tree.value.byId.get(selectedId.value ?? 0));
const currentAnswers = computed(() => props.answers.filter(answer => answer.questionId === selectedId.value));
const draftKey = computed(() => String(selectedId.value));
const draft = computed({ get: () => drafts.value[draftKey.value] ?? "", set: value => { drafts.value[draftKey.value] = value; } });
const blocked = computed(() => props.busy || submitBusy.value);
async function revealAnswer() {
  await nextTick();
  scrollRoot.value?.querySelector<HTMLElement>(".question-detail")?.scrollIntoView({ block: "nearest", inline: "nearest" });
}
watch(() => props.questions.at(-1)?.id, id => {
  if (!id) return;
  selectedId.value = id;
  emit("select", id, true);
  if (questionsOpen.value) void revealAnswer();
}, { immediate: true });

function select(id: number) {
  selectedId.value = id;
  questionsOpen.value = true;
  errorText.value = "";
  emit("select", id, true);
  void revealAnswer();
}
function toggleAnswers() {
  questionsOpen.value = !questionsOpen.value;
  if (questionsOpen.value) void revealAnswer();
}
async function submit() {
  if (blocked.value || !current.value || !draft.value.trim()) return;
  const key = draftKey.value;
  const content = draft.value.trim();
  const input = { questionId: current.value.id, content, mode: "answer" };
  const snapshot = JSON.stringify(input);
  if (retryRequest.value?.snapshot !== snapshot) retryRequest.value = { snapshot, id: crypto.randomUUID() };
  submitBusy.value = true;
  errorText.value = "";
  try {
    await api("/api/bible-study/answer", { method: "POST", body: JSON.stringify({ ...input, clientRequestId: retryRequest.value.id }) });
    if (drafts.value[key]?.trim() === content) delete drafts.value[key];
    retryRequest.value = undefined;
    questionsOpen.value = false;
    emit("sent");
  } catch (error) {
    errorText.value = error instanceof Error ? error.message : "答复发送失败，内容已保留，请重试";
  } finally { submitBusy.value = false; }
}
</script>

<template>
  <section v-if="current" class="question-path" aria-label="问题脉络">
    <header class="path-header">
      <strong>问题列表 · {{ questions.length }} 题</strong>
      <button type="button" :aria-expanded="questionsOpen" @click="toggleAnswers">
        {{ questionsOpen ? '收起回答' : '展开回答' }}<ChevronUp v-if="questionsOpen" :size="16" /><ChevronDown v-else :size="16" />
      </button>
    </header>
    <div ref="scrollRoot" class="path-scroll" tabindex="0" role="region" aria-label="问题树，可横向滚动">
      <ol class="path-steps">
        <li v-for="row in tree.rows" :key="row.question.id" :style="{ '--question-depth': row.depth }" :class="{ selected: row.question.id === selectedId }">
          <h3 v-if="!row.parentLabel && row.question.relation !== 'earlier'" class="question-kicker">{{ BIBLE_STUDY_RELATION_LABELS[row.question.relation] }}</h3>
          <div class="question-line">
            <button class="question-title" type="button" :aria-current="row.question.id === selectedId ? 'step' : undefined"
              :aria-expanded="questionsOpen && row.question.id === selectedId" :aria-controls="`study-question-answer-${row.question.id}`" @click="select(row.question.id)">
              <strong class="question-number">{{ row.label }}</strong><span class="question-text">{{ row.question.text }}</span>
            </button>
          </div>
          <article v-if="questionsOpen && row.question.id === selectedId" :id="`study-question-answer-${row.question.id}`" class="question-detail" aria-label="当前问题">
            <div v-if="currentAnswers.length" class="saved-answers">
              <div v-for="answer in currentAnswers" :key="answer.id"><p><strong>我的回答</strong> {{ answer.text }}</p><p v-if="answer.response"><strong>助手回应</strong> {{ answer.response }}</p></div>
            </div>
            <nav v-if="current.evidence.length" class="question-evidence" aria-label="相关经文">
              <span>经文依据 ·</span><button v-for="reference in current.evidence" :key="reference" type="button" @click="emit('reference', reference)">{{ reference }}</button>
            </nav>
            <p v-if="current.relation === 'hint' && current.returnToId" class="hint-return">答完这一步，我们回到原题。</p>
            <form @submit.prevent="submit">
              <label :for="`study-answer-${current.id}`">写下你的观察</label>
              <textarea :id="`study-answer-${current.id}`" v-model="draft" :disabled="blocked" placeholder="写下你的观察…" rows="3" maxlength="10000"></textarea>
              <div class="answer-actions">
                <button v-if="current.id === questions.at(-1)?.id" type="button" :disabled="blocked" @click="emit('help')"><CircleHelp :size="16" />{{ current.relation === 'hint' ? '再给一点提示' : '答不上来' }}</button>
                <button class="submit-answer" type="submit" :disabled="blocked || !draft.trim()">{{ submitBusy ? '保存中…' : '回答并收起' }}</button>
              </div>
            </form>
          </article>
        </li>
      </ol>
    </div>
    <p v-if="errorText" class="answer-error" role="alert">{{ errorText }} <button type="button" @click="emit('sent')">刷新进度</button></p>
  </section>
</template>

<style scoped>
.question-path { min-width: 0; border-inline-start: 3px solid #64866a; padding: 12px; background: #fffdf777; border-radius: 8px; color: var(--study-ink); }
.path-header, .answer-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.path-header { margin-bottom: 10px; font-size: .9rem; color: var(--study-pine); }
button { font: inherit; color: var(--study-pine); cursor: pointer; background: transparent; border: 0; padding: 6px 0; min-height: 36px; display: inline-flex; align-items: center; gap: 5px; text-align: start; }
button:disabled { opacity: .5; cursor: default; }
button:focus-visible, textarea:focus-visible, .path-scroll:focus-visible { outline: 2px solid var(--study-pine); outline-offset: 2px; }
.path-header button { font-size: .76rem; }
.path-scroll { max-height: 70dvh; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; }
.path-steps { list-style: none; padding: 0; margin: 0; width: max-content; min-width: 100%; }
.path-steps > li { margin-inline-start: calc(var(--question-depth) * 18px); padding: 10px 0; border-bottom: 1px solid var(--study-line); }
.question-kicker { font-size: .75rem; font-weight: 600; color: var(--study-muted); margin: 0 0 3px; }
.question-title { align-items: baseline; font-size: .9rem; line-height: 1.6; }
.question-text { width: min(32rem, calc(100cqi - 125px)); min-width: 14rem; overflow-wrap: anywhere; }
.question-number { flex: none; white-space: nowrap; border-radius: 5px; background: #e3ebd7; padding: 1px 5px; font-variant-numeric: tabular-nums; }
.selected > .question-line .question-title { font-weight: 700; }
.question-detail { box-sizing: border-box; width: min(32rem, calc(100cqi - 80px)); min-width: 240px; padding-block: 8px; }
.saved-answers { background: var(--study-highlight, #e6ecdf); border-radius: 5px; padding: 10px; }
.saved-answers p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: .86rem; line-height: 1.6; }
.saved-answers p + p, .saved-answers > div + div { margin-top: 8px; }
.question-evidence { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; font-size: .82rem; }
.question-evidence button { text-decoration: underline; text-underline-offset: 3px; }
.hint-return { font-size: .82rem; color: var(--study-muted); }
form { display: grid; gap: 8px; margin-top: 8px; }
label { font-size: .8rem; line-height: 1.5; }
textarea { box-sizing: border-box; width: 100%; min-width: 0; resize: vertical; min-height: 84px; border: 1px solid #aaa28f; border-radius: 7px; padding: 10px; font: inherit; font-size: .95rem; background: #fffdf8; color: var(--study-ink); }
.answer-actions { flex-wrap: wrap; font-size: .82rem; }
.submit-answer { margin-inline-start: auto; background: var(--study-pine); color: #fff7dc; border-radius: 7px; padding: 8px 14px; }
.answer-error { color: #92391b; font-size: .85rem; }
</style>
