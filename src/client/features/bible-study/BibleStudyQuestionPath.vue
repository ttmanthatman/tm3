<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { ChevronDown, ChevronUp, CircleHelp } from "lucide-vue-next";
import { bibleStudyBranchIds, BIBLE_STUDY_RELATION_LABELS, type BibleStudyQuestion, type BibleStudyAnswer } from "@shared/bibleStudy";
import { api } from "../../api";
import AppModal from "../../components/ui/AppModal.vue";
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
const questionActionBusy = ref(false);
const deleteDialogOpen = ref(false);
const deleteTargetId = ref<number>();
const actionError = ref("");
const errorText = ref("");
const drafts = ref<Record<string, string>>({});
const retryRequest = ref<{ snapshot: string; id: string }>();
const tree = computed(() => studyQuestionTree(props.questions));
const current = computed(() => tree.value.byId.get(selectedId.value ?? 0));
const currentAnswers = computed(() => props.answers.filter(answer => answer.questionId === selectedId.value));
const draftKey = computed(() => String(selectedId.value));
const draft = computed({ get: () => drafts.value[draftKey.value] ?? "", set: value => { drafts.value[draftKey.value] = value; } });
const blocked = computed(() => props.busy || submitBusy.value || questionActionBusy.value);
const deleteIds = ref<number[]>([]);
const deleteAnswerCount = computed(() => props.answers.filter(answer => deleteIds.value.includes(answer.questionId)).length);
const deleteLabel = computed(() => tree.value.labels.get(deleteTargetId.value ?? 0));
async function revealAnswer() {
  await nextTick();
  scrollRoot.value?.querySelector<HTMLElement>(".question-detail")?.scrollIntoView({ block: "nearest", inline: "nearest" });
}
watch(() => props.questions, (questions, previous) => {
  const id = questions.at(-1)?.id;
  if (!id || (current.value && id === previous?.at(-1)?.id)) return;
  selectedId.value = id;
  emit("select", id, true);
  if (questionsOpen.value) void revealAnswer();
}, { immediate: true });
watch(() => currentAnswers.value.map(answer => `${answer.id}:${answer.response ?? ""}`).join("|"), (value, previous) => {
  if (value && value !== previous && currentAnswers.value.some(answer => answer.response)) {
    questionsOpen.value = true;
    void revealAnswer();
  }
});

function select(id: number) {
  selectedId.value = id;
  questionsOpen.value = true;
  errorText.value = "";
  actionError.value = "";
  emit("select", id, true);
  void revealAnswer();
}
function toggleAnswers() {
  questionsOpen.value = !questionsOpen.value;
  if (questionsOpen.value) void revealAnswer();
}
function askDelete() {
  if (!current.value || blocked.value) return;
  deleteTargetId.value = current.value.id;
  deleteIds.value = bibleStudyBranchIds(props.questions, current.value.id);
  actionError.value = "";
  deleteDialogOpen.value = true;
}
async function changeQuestion(action: "delete" | "skip") {
  const id = action === "delete" ? deleteTargetId.value : current.value?.id;
  if (!id || blocked.value) return;
  questionActionBusy.value = true;
  actionError.value = "";
  try {
    await api(`/api/bible-study/questions/${action}`, { method: "POST", body: JSON.stringify({ questionId: id,
      ...(action === "delete" ? { expectedIds: deleteIds.value } : {})
    }) });
    deleteDialogOpen.value = false;
    emit("sent");
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : "暂时无法修改问题，请重试";
  } finally { questionActionBusy.value = false; }
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
    <ol ref="scrollRoot" class="path-steps">
        <li v-for="row in tree.rows" :key="row.question.id" :class="{ selected: row.question.id === selectedId }">
          <h3 v-if="!row.parentLabel && row.question.relation !== 'earlier'" class="question-kicker">{{ BIBLE_STUDY_RELATION_LABELS[row.question.relation] }}</h3>
          <div class="question-line">
            <button class="question-title" type="button" :aria-current="row.question.id === selectedId ? 'step' : undefined"
              :aria-expanded="questionsOpen && row.question.id === selectedId" :aria-controls="`study-question-answer-${row.question.id}`" @click="select(row.question.id)">
              <strong class="question-number">{{ row.label }}</strong> <span class="question-text">{{ row.question.text }}</span>
            </button>
          </div>
          <article v-if="questionsOpen && row.question.id === selectedId" :id="`study-question-answer-${row.question.id}`" class="question-detail" aria-label="当前问题">
            <div v-if="currentAnswers.length" class="saved-answers">
              <div v-for="answer in currentAnswers" :key="answer.id"><p><strong>我的回应</strong> {{ answer.text }}</p><p v-if="answer.response"><strong>助手回应</strong> {{ answer.response }}</p></div>
            </div>
            <nav v-if="current.evidence.length" class="question-evidence" aria-label="相关经文">
              <span>经文依据 ·</span><button v-for="reference in current.evidence" :key="reference" type="button" @click="emit('reference', reference)">{{ reference }}</button>
            </nav>
            <p v-if="current.relation === 'hint' && current.returnToId" class="hint-return">答完这一步，我们回到原题。</p>
            <div class="question-actions">
              <button type="button" :disabled="blocked || current.skipped" @click="changeQuestion('skip')">不想回答</button>
              <button type="button" class="delete-question" :disabled="blocked" @click="askDelete">删除问题</button>
            </div>
            <p v-if="current.skipped" class="hint-return">已跳过这个问题，仍可追加回答或提问。</p>
            <p v-if="actionError && !deleteDialogOpen" class="answer-error" role="alert">{{ actionError }}</p>
            <form @submit.prevent="submit">
              <label :for="`study-answer-${current.id}`">追加回答或提问</label>
              <textarea :id="`study-answer-${current.id}`" v-model="draft" :disabled="blocked" placeholder="追加回答或提问…" rows="3" maxlength="10000"></textarea>
              <div class="answer-actions">
                <button v-if="current.id === questions.at(-1)?.id" type="button" :disabled="blocked" @click="emit('help')"><CircleHelp :size="16" />{{ current.relation === 'hint' ? '再给一点提示' : '答不上来' }}</button>
                <button class="submit-answer" type="submit" :disabled="blocked || !draft.trim()">{{ submitBusy ? '保存中…' : '回答并收起' }}</button>
              </div>
            </form>
          </article>
        </li>
    </ol>
    <p v-if="errorText" class="answer-error" role="alert">{{ errorText }} <button type="button" @click="emit('sent')">刷新进度</button></p>
  </section>
  <Teleport defer to=".app-shell">
    <AppModal :open="deleteDialogOpen" title="删除问题" :busy="questionActionBusy" @close="deleteDialogOpen = false">
      <div class="delete-dialog-body">
        <p>确定删除 {{ deleteLabel }} 吗？</p>
        <p>这会同时删除它下面的全部子问题和相关回答，无法恢复。</p>
        <p>本次包含 {{ deleteIds.length }} 道问题、{{ deleteAnswerCount }} 条已保存的回应。</p>
        <p v-if="actionError" class="answer-error" role="alert">{{ actionError }}</p>
        <div class="answer-actions">
          <button type="button" :disabled="questionActionBusy" @click="deleteDialogOpen = false">取消</button>
          <button type="button" class="confirm-delete-question" :disabled="blocked || !deleteIds.length" @click="changeQuestion('delete')">确认删除</button>
        </div>
      </div>
    </AppModal>
  </Teleport>
</template>

<style scoped>
.question-path { min-width: 0; color: var(--study-ink); }
.path-header, .answer-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.path-header { margin-bottom: 10px; font-size: .9rem; color: var(--study-pine); }
button { font: inherit; color: var(--study-pine); cursor: pointer; background: transparent; border: 0; padding: 6px 0; min-height: 36px; display: inline-flex; align-items: center; gap: 5px; text-align: start; }
button:disabled { opacity: .5; cursor: default; }
button:focus-visible, textarea:focus-visible { outline: 2px solid var(--study-pine); outline-offset: 2px; }
.path-header button { font-size: .76rem; }
.path-steps { box-sizing: border-box; list-style: none; padding: 0; margin: 0; width: 100%; min-width: 0; }
.path-steps > li { padding: 10px 0; border-bottom: 1px solid var(--study-line); }
.question-kicker { font-size: .75rem; font-weight: 600; color: var(--study-muted); margin: 0 0 3px; }
.question-title { display: block; width: 100%; min-width: 0; font-size: .9rem; line-height: 1.6; overflow-wrap: anywhere; }
.question-text { display: inline; overflow-wrap: anywhere; }
.question-number { white-space: normal; overflow-wrap: anywhere; border-radius: 5px; background: #e3ebd7; padding: 1px 5px; font-variant-numeric: tabular-nums; }
.selected > .question-line .question-title { font-weight: 700; }
.question-detail { box-sizing: border-box; width: 100%; min-width: 0; padding-block: 8px; }
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
.question-actions { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-block: 6px; font-size: .82rem; }
.delete-question, .confirm-delete-question { color: #973d2a; }
.delete-dialog-body { min-width: 0; overflow-wrap: anywhere; padding: 0 18px 18px; line-height: 1.7; }
.confirm-delete-question { border: 1px solid currentColor; padding: 6px 12px; border-radius: 6px; }
</style>
