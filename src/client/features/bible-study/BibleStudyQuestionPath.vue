<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { ChevronDown, ChevronUp, CircleHelp, CornerDownRight } from "lucide-vue-next";
import { BIBLE_STUDY_RELATION_LABELS, type BibleStudyQuestion, type BibleStudyAnswer } from "@shared/bibleStudy";
import { api } from "../../api";
import { studyQuestionTree, studyQuestionAncestors } from "./questionTree";

const props = defineProps<{
  questions: BibleStudyQuestion[];
  answers: BibleStudyAnswer[];
  busy: boolean;
  feedback?: string;
}>();
const emit = defineEmits<{ select: [id: number, automatic: boolean]; sent: []; help: []; reference: [value: string] }>();
const selectedId = ref<number>();
const mode = ref<"answer" | "followup">("answer");
const questionsOpen = ref(true);
const ancestorsOpen = ref(false);
const submitBusy = ref(false);
const errorText = ref("");
const field = ref<HTMLTextAreaElement>();
const drafts = ref<Record<string, string>>({});
const expandedAnswers = ref(new Set<number>());
const retryRequest = ref<{ snapshot: string; id: string }>();
const tree = computed(() => studyQuestionTree(props.questions));
const current = computed(() => tree.value.byId.get(selectedId.value ?? 0));
const label = computed(() => tree.value.labels.get(selectedId.value ?? 0));
const ancestors = computed(() => studyQuestionAncestors(props.questions, selectedId.value));
const parent = computed(() => ancestors.value.at(-1));
const draftKey = computed(() => `${selectedId.value}:${mode.value}`);
const draft = computed({ get: () => drafts.value[draftKey.value] ?? "", set: value => { drafts.value[draftKey.value] = value; } });
const blocked = computed(() => props.busy || submitBusy.value);
const answered = computed(() => new Set(props.answers.map(answer => answer.questionId)));
watch(() => props.questions.at(-1)?.id, id => {
  if (!id) return;
  selectedId.value = id;
  mode.value = "answer";
  emit("select", id, true);
}, { immediate: true });

async function select(id: number, followup = false) {
  selectedId.value = id;
  mode.value = followup ? "followup" : "answer";
  questionsOpen.value = true;
  ancestorsOpen.value = false;
  errorText.value = "";
  emit("select", id, followup);
  await nextTick();
  field.value?.focus({ preventScroll: true });
}
function toggleAnswer(id: number) {
  const next = new Set(expandedAnswers.value);
  if (next.has(id)) next.delete(id); else next.add(id);
  expandedAnswers.value = next;
}
async function submit() {
  if (blocked.value || !current.value || !draft.value.trim()) return;
  const key = draftKey.value;
  const content = draft.value.trim();
  const input = { questionId: current.value.id, content, mode: mode.value };
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
      <button type="button" :aria-expanded="questionsOpen" @click="questionsOpen = !questionsOpen">
        {{ questionsOpen ? '收起问答' : '展开问答' }}<ChevronUp v-if="questionsOpen" :size="16" /><ChevronDown v-else :size="16" />
      </button>
    </header>
    <ol class="path-steps">
      <li v-for="row in tree.rows" :key="row.question.id" :style="{ '--question-depth': row.depth }" :class="{ selected: row.question.id === selectedId }">
        <div class="question-line">
          <button class="question-title" type="button" :aria-current="row.question.id === selectedId ? 'step' : undefined" @click="select(row.question.id)">
            <strong class="question-number">{{ row.label }}</strong><span>{{ row.question.text }}</span>
          </button>
          <button class="followup-button" type="button" :disabled="blocked" :aria-label="`继续追问 ${row.label}`" @click="select(row.question.id, true)"><CornerDownRight :size="14" />继续追问</button>
        </div>
        <div class="question-meta">
          <button v-if="row.parentLabel" type="button" @click="select(row.question.parentId!)">追问 {{ row.parentLabel }}</button>
          <span>{{ BIBLE_STUDY_RELATION_LABELS[row.question.relation] }}</span>
          <button v-if="answered.has(row.question.id)" type="button" :aria-expanded="expandedAnswers.has(row.question.id)" @click="toggleAnswer(row.question.id)">{{ expandedAnswers.has(row.question.id) ? '收起回答' : '已回答 · 查看回答' }}</button>
        </div>
        <div v-if="expandedAnswers.has(row.question.id)" class="saved-answers">
          <div v-for="answer in answers.filter(answer => answer.questionId === row.question.id)" :key="answer.id"><p><strong>我的回答</strong> {{ answer.text }}</p><p v-if="answer.response"><strong>助手回应</strong> {{ answer.response }}</p></div>
        </div>
      </li>
    </ol>
    <div v-if="questionsOpen" class="question-detail">
      <div v-if="ancestors.length > 1" class="ancestry">
        <button type="button" :aria-expanded="ancestorsOpen" @click="ancestorsOpen = !ancestorsOpen">问题脉络：{{ tree.labels.get(ancestors[0].id) }} → {{ ancestors.length > 2 ? `… ${ancestors.length - 2} 题 → ` : '' }}{{ tree.labels.get(parent!.id) }} · {{ ancestorsOpen ? '收起' : '查看完整脉络' }}</button>
        <ol v-if="ancestorsOpen"><li v-for="ancestor in ancestors" :key="ancestor.id"><button type="button" @click="select(ancestor.id)">{{ tree.labels.get(ancestor.id) }} {{ ancestor.text }}</button></li></ol>
      </div>
      <p v-if="parent" class="parent-question"><strong>上一级 · {{ tree.labels.get(parent.id) }}</strong> {{ parent.text }}</p>
      <article aria-label="当前问题">
        <small>{{ mode === 'followup' ? `正在追问 ${label}` : `正在回答 ${label}` }}</small>
        <h2>{{ current.text }}</h2>
        <nav v-if="current.evidence.length" class="question-evidence" aria-label="相关经文">
          <span>经文依据 ·</span><button v-for="reference in current.evidence" :key="reference" type="button" @click="emit('reference', reference)">{{ reference }}</button>
        </nav>
        <p v-else class="question-evidence">全段观察 · 无具体经节</p>
        <p class="question-purpose"><strong>为什么问</strong> {{ current.purpose }}</p>
        <p v-if="current.relation === 'hint' && current.returnToId">答完这一步，我们回到原题。</p>
        <p v-if="feedback && current.id === questions.at(-1)?.id">上一题反馈 · {{ feedback }}</p>
      </article>
      <form @submit.prevent="submit">
        <label :for="`study-answer-${current.id}`">{{ mode === 'followup' ? `针对 ${label} 另开一个追问分支` : '写下你的观察' }}</label>
        <textarea :id="`study-answer-${current.id}`" ref="field" v-model="draft" :disabled="blocked" :placeholder="mode === 'followup' ? '还想从这个问题追问什么？' : '写下你的观察…'" rows="3" maxlength="10000"></textarea>
        <div class="answer-actions">
          <button v-if="current.id === questions.at(-1)?.id && mode === 'answer'" type="button" :disabled="blocked" @click="emit('help')"><CircleHelp :size="16" />{{ current.relation === 'hint' ? '再给一点提示' : '答不上来' }}</button>
          <button class="submit-answer" type="submit" :disabled="blocked || !draft.trim()">{{ submitBusy ? '保存中…' : mode === 'followup' ? '发起追问' : '回答并收起' }}</button>
        </div>
      </form>
    </div>
    <p v-if="errorText" class="answer-error" role="alert">{{ errorText }} <button type="button" @click="emit('sent')">刷新进度</button></p>
  </section>
</template>

<style scoped>
.question-path { min-width: 0; border-inline-start: 3px solid #64866a; padding: 12px; background: #fffdf777; border-radius: 8px; color: var(--study-ink); overflow-wrap: anywhere; }
.path-header, .question-line, .answer-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.path-header { margin-bottom: 10px; font-size: .9rem; color: var(--study-pine); }
button { font: inherit; color: var(--study-pine); cursor: pointer; background: transparent; border: 0; padding: 6px 0; min-height: 36px; display: inline-flex; align-items: center; gap: 4px; text-align: start; }
button:disabled { opacity: .5; cursor: default; }
button:focus-visible, textarea:focus-visible { outline: 2px solid var(--study-pine); outline-offset: 2px; }
.path-header button, .question-meta, .followup-button { font-size: .76rem; }
.path-steps { max-height: 17rem; overflow-y: auto; overscroll-behavior: contain; list-style: none; padding: 0; margin: 0; }
.path-steps > li { margin-inline-start: calc(var(--question-depth) * 12px); padding: 7px 0; border-bottom: 1px solid var(--study-line); min-width: 0; }
.question-line { flex-wrap: wrap; align-items: baseline; }
.question-title { flex: 1 1 180px; align-items: baseline; font-size: .9rem; line-height: 1.5; }
.question-title span { min-width: 0; }
.question-number { flex: none; border-radius: 5px; background: #e3ebd7; padding: 1px 5px; font-variant-numeric: tabular-nums; }
.selected .question-title { font-weight: 700; }
.followup-button { flex: none; }
.question-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; color: var(--study-muted); }
.saved-answers { background: #e6ecdf; border-radius: 5px; padding: 8px; }
.saved-answers p { margin: 0; white-space: pre-wrap; font-size: .86rem; line-height: 1.6; }
.saved-answers p + p { margin-top: 8px; }
.question-evidence { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; font-size: .82rem; }
.question-evidence button { text-decoration: underline; text-underline-offset: 3px; }
.question-detail { margin-top: 14px; }
.parent-question { font-size: .85rem; line-height: 1.6; padding-block: 8px; border-bottom: 1px solid var(--study-line); }
.ancestry { font-size: .8rem; }
.ancestry ol { padding-inline-start: 20px; }
article { background: #e6ecdf; padding: 10px 12px; border-radius: 6px; }
article small { color: var(--study-pine); font-weight: 700; }
article h2 { font-size: 1.05rem; line-height: 1.6; margin: 5px 0; }
article p { font-size: .82rem; line-height: 1.6; margin: 4px 0; }
form { display: grid; gap: 8px; margin-top: 12px; }
label { font-size: .8rem; line-height: 1.5; }
textarea { box-sizing: border-box; width: 100%; min-width: 0; resize: vertical; min-height: 84px; border: 1px solid #aaa28f; border-radius: 7px; padding: 10px; font: inherit; font-size: .95rem; background: #fffdf8; color: var(--study-ink); }
.answer-actions { flex-wrap: wrap; font-size: .82rem; }
.submit-answer { margin-inline-start: auto; background: var(--study-pine); color: #fff7dc; border-radius: 7px; padding: 8px 14px; }
.answer-error { color: #92391b; font-size: .85rem; }
</style>
