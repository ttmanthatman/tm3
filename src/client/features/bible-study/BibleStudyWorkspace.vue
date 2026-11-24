<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { BookOpen, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, RotateCcw } from "lucide-vue-next";
import { BIBLE_STUDY_STAGES, BIBLE_STUDY_STAGE_DETAILS, type BibleStudyFailure, type BibleStudyWorkspaceState } from "@shared/bibleStudy";
import { api } from "../../api";
import { useChatStore } from "../../store";
import AppModal from "../../components/ui/AppModal.vue";
import type { StudyScriptureSelection } from "./useBibleStudyNavigation";
import BibleStudyQuestionPath from "./BibleStudyQuestionPath.vue";
import BibleStudyRecords from "./BibleStudyRecords.vue";

const props = defineProps<{ channelId: number; readerError?: string }>();
const emit = defineEmits<{ leave: []; active: [value: boolean]; scripture: [value: StudyScriptureSelection] }>();
const store = useChatStore();
const workspace = ref<BibleStudyWorkspaceState>({ progress: null, latest: null });
const progress = computed(() => workspace.value.progress);
const loaded = ref(false);
const collapsed = ref(false);
const dialog = ref<"records" | "summaries" | null>(null);
const actionBusy = ref(false);
const errorText = ref("");
let request = 0;
let pollTimer: ReturnType<typeof setTimeout> | undefined;
let restoreTimer: ReturnType<typeof setTimeout> | undefined;

const step = computed(() => progress.value ? BIBLE_STUDY_STAGES.indexOf(progress.value.stage) + 1 : 0);
const stage = computed(() => progress.value ? BIBLE_STUDY_STAGE_DETAILS[progress.value.stage] : null);
const currentQuestion = computed(() => progress.value?.questionPath.at(-1));
const selectedId = ref<number>();
function selectQuestion(id: number, automatic = false) {
  selectedId.value = id;
  const question = progress.value?.questionPath.find(question => question.id === id);
  if (question && progress.value) emit("scripture", {
    questionId: id, reference: progress.value.reference, evidence: question.evidence, automatic
  });
}
function openReference(reference: string) {
  const id = selectedId.value ?? currentQuestion.value?.id;
  if (id && progress.value) emit("scripture", { questionId: id, reference: progress.value.reference, evidence: [reference], automatic: false });
}
function openReading() {
  const id = selectedId.value ?? currentQuestion.value?.id;
  if (id) selectQuestion(id);
}
const failureText: Record<BibleStudyFailure, string> = {
  configuration: "AI 服务暂不可用。你的答复已保存，请联系管理员。",
  connection: "连接 AI 服务失败，你的答复已保存。",
  timeout: "AI 回应超时，你的答复已保存。",
  unavailable: "AI 服务暂时繁忙或不可用，你的答复已保存。",
  format: "AI 返回格式异常，你的答复已保存。"
};

async function load() {
  const id = ++request;
  try {
    const result = await api<BibleStudyWorkspaceState>("/api/bible-study/progress");
    if (id !== request) return;
    workspace.value = result;
    emit("active", !!result.progress);
    loaded.value = true;
    errorText.value = "";
    clearTimeout(pollTimer);
    if (result.progress?.working) pollTimer = setTimeout(() => { void load(); }, 1500);
  } catch (error) {
    if (id === request) errorText.value = error instanceof Error ? error.message : "查经进度读取失败";
  }
}

async function act(action: "retry" | "help") {
  const question = currentQuestion.value;
  if (actionBusy.value || (action === "help" && !question)) return;
  actionBusy.value = true;
  try {
    await api(`/api/bible-study/${action}`, {
      method: "POST",
      ...(action === "help" ? { body: JSON.stringify({ questionId: question?.id }) } : {})
    });
    await load();
  } catch (error) {
    const message = error instanceof Error ? error.message : "暂时无法更新查经，请再试一次";
    await load();
    errorText.value = message;
  } finally {
    actionBusy.value = false;
  }
}

function onProgress(event: { channelId: number }) {
  if (event.channelId === props.channelId) void load();
}
watch(() => store.socket, (socket, _old, onCleanup) => {
  if (!socket) return;
  socket.on("bible-study:progress", onProgress);
  socket.on("connect", load);
  onCleanup(() => {
    socket.off("bible-study:progress", onProgress);
    socket.off("connect", load);
  });
}, { immediate: true });
watch(() => store.lastIncomingMessage, message => {
  if (message?.channelId === props.channelId && message.sender.kind === "virtual") void load();
});
void load();

function toggleProgress() {
  collapsed.value = !collapsed.value;
  clearTimeout(restoreTimer);
  if (collapsed.value) restoreTimer = setTimeout(() => { collapsed.value = false; }, 5000);
}

onBeforeUnmount(() => {
  clearTimeout(restoreTimer);
  clearTimeout(pollTimer);
  request++;
});
</script>

<template>
  <section class="study-workspace" :class="{ 'study-active': !!progress }" aria-label="同行书房">
    <header class="study-header">
      <div class="study-header-line">
        <button class="study-header-button" type="button" aria-label="回到聊天室" @click="emit('leave')"><ChevronLeft :size="22" /></button>
        <strong data-testid="active-channel-name">同行书房</strong>
        <button v-if="progress" class="study-header-button collapse-progress" type="button"
          :aria-label="collapsed ? '展开查经进度' : '收起进度 5 秒'" :aria-expanded="!collapsed" @click="toggleProgress">
          <ChevronDown v-if="collapsed" :size="17" /><ChevronUp v-else :size="17" />
          <span>{{ collapsed ? '展开' : '收起' }}</span>
        </button>
      </div>
      <section v-if="progress && stage && !collapsed" class="study-progress" aria-label="查经进度">
        <div class="stage-meta">
          <strong class="stage-tag">{{ stage.label }}</strong>
          <span>第 {{ step }} / {{ BIBLE_STUDY_STAGES.length }} 阶段</span>
          <small>已问 {{ progress.questions }} 题</small>
        </div>
        <div class="stage-meter" role="progressbar" aria-label="查经阶段" :aria-valuenow="step" :aria-valuemax="BIBLE_STUDY_STAGES.length">
          <span v-for="(_, index) in BIBLE_STUDY_STAGES" :key="index" :class="{ reached: index < step }"></span>
        </div>
        <p class="stage-goal">{{ stage.goal }}</p>
      </section>
    </header>

    <div class="study-scroll">
      <div class="study-inner">
        <div class="study-dialogue">
          <nav class="record-actions" aria-label="查经记录">
            <button type="button" @click="dialog = 'records'"><BookOpen :size="19" /> <span>查经记录</span><ChevronRight :size="17" /></button>
            <button type="button" @click="dialog = 'summaries'">查经小结</button>
          </nav>

          <div v-if="progress" class="study-passage">
            <span>{{ progress.reference }}</span><button type="button" @click="openReading"><BookOpen :size="16" /> 打开圣经</button>
          </div>
          <p v-if="readerError" class="study-notice" role="alert">{{ readerError }}</p>

          <div v-if="errorText" class="study-notice" role="alert">
            <span>{{ errorText }}</span><button type="button" @click="load">刷新</button>
          </div>
          <div v-if="progress?.failure && !progress.working" class="study-notice" role="status">
            <span>{{ failureText[progress.failure] }}</span>
            <button type="button" :disabled="actionBusy" @click="act('retry')"><RotateCcw :size="15" /> 重试回应</button>
          </div>
          <div v-else-if="progress?.working" class="study-notice" role="status">正在整理你的答复…</div>
          <div v-else-if="workspace.latest === 'locked'" class="study-notice" role="status">
            完成这段经文后就可以换题。你也可以下次回来继续。
          </div>

          <BibleStudyQuestionPath v-if="progress" :questions="progress.questionPath" :answers="progress.answers ?? []" :feedback="progress.feedbackDetail" :busy="actionBusy || progress.working || !!progress.failure" @select="selectQuestion" @reference="openReference" @sent="load" @help="act('help')" />
          <section v-if="loaded && !progress" class="study-intro" aria-labelledby="study-intro-title">
            <h2 id="study-intro-title">{{ workspace.latest === 'complete' ? '本次查经已完成' : '今天想读哪一段？' }}</h2>
            <p v-if="workspace.latest === 'complete'" role="status">小结已归档。发送新的经文范围，就可以开始下一次查经。</p>
            <p v-else>发送经文范围，例如「马可福音 14:32–50」。</p>
            <p class="study-privacy">查经答复会保存，站点管理员可在后台查看。当前对话由站点配置的 AI 服务处理。</p>
          </section>
          <p v-else-if="!loaded && !errorText" role="status">正在读取查经进度…</p>
        </div>
      </div>
    </div>

    <Teleport defer to=".app-shell">
      <AppModal :open="!!dialog" :title="dialog === 'summaries' ? '查经小结' : '查经记录'" @close="dialog = null">
        <div v-if="dialog" class="study-dialog-records">
          <BibleStudyRecords :key="dialog" :show-sender="dialog === 'records'" :show-questions="dialog === 'records'"
            :endpoint="dialog === 'summaries' ? '/api/bible-study/summaries' : '/api/bible-study/records'"
            :empty-label="dialog === 'summaries' ? '完成一次查经后，小结会保存在这里。' : '还没有查经记录。'" />
        </div>
      </AppModal>
    </Teleport>
  </section>
</template>

<style scoped>
.study-workspace { grid-row: 1 / 7; display: grid; grid-template-rows: auto minmax(0, 1fr); min-height: 0; background: var(--study-paper); color: var(--study-ink); container-type: inline-size; }
.study-active { grid-row: 1 / -1; }
.study-header { color: #fff7dc; background: var(--study-pine); padding: var(--safe-top, 0px) 16px 12px; }
.study-header-line { display: grid; grid-template-columns: auto 1fr auto; align-items: center; min-height: 48px; gap: 6px; }
.study-header-line strong { font-size: 1.21rem; }
.study-header-button { display: inline-flex; align-items: center; gap: 5px; height: 44px; min-width: 36px; background: transparent; border: 0; color: inherit; font: inherit; cursor: pointer; padding: 0 4px; }
.collapse-progress { font-size: .84rem; padding-inline: 8px 0; }
.stage-meta { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 10px; font-size: .83rem; }
.stage-meta small { font-size: .78rem; font-variant-numeric: tabular-nums; }
.stage-tag { background: var(--study-gold); color: #173528; border-radius: 8px; padding: 4px 10px; }
.stage-meter { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; margin: 8px 0 6px; }
.stage-meter span { height: 5px; background: #377163; border-radius: 6px; }
.stage-meter .reached { background: var(--study-gold); }
.stage-goal { font-size: .78rem; line-height: 1.45; color: #e5ebd8; margin: 0; }
.study-scroll { min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.study-inner { max-width: 760px; margin-inline: auto; padding: clamp(16px, 5cqi, 28px); display: grid; gap: 13px; }
.study-dialogue { min-width: 0; display: grid; align-content: start; gap: 12px; }
.record-actions { display: flex; gap: 8px; }
.record-actions button { display: inline-flex; align-items: center; gap: 6px; justify-content: center; min-height: 41px; border: 1px solid #b7ab95; background: transparent; color: var(--study-pine); border-radius: 8px; padding: 5px 10px; font: inherit; font-size: .86rem; cursor: pointer; }
.record-actions button:first-child { flex: 1; }
.record-actions button:first-child span { flex: 1; text-align: start; }
.study-passage { display: flex; align-items: center; flex-wrap: wrap; justify-content: space-between; gap: 8px; color: var(--study-muted); font-size: .85rem; }
.study-passage button { display: inline-flex; align-items: center; gap: 5px; min-height: 38px; border: 0; background: transparent; color: var(--study-pine); font: inherit; cursor: pointer; }
.current-question { border-inline-start: 4px solid #4d6d4f; background: #e8eddb; border-radius: 10px; padding: 10px 13px 8px; overflow-wrap: anywhere; }
.question-kicker { display: inline-block; color: var(--study-pine); background: #d4dfc2; border-radius: 7px; padding: 2px 7px; font-size: .77rem; font-weight: 700; }
.current-question h2, .study-intro h2 { font-size: clamp(1.1rem, 3.75cqi, 1.45rem); line-height: 1.42; margin: 6px 0; color: #11372a; }
.question-evidence, .question-purpose, .hint-return { font-size: .82rem; line-height: 1.5; margin: 5px 0; }
.question-evidence, .hint-return { color: var(--study-muted); }
.question-purpose strong { color: var(--study-pine); margin-inline-end: 3px; }
.study-intro p { font-size: .9rem; line-height: 1.6; margin: 5px 0; }
.study-privacy { color: var(--study-muted); }
.help-button, .study-notice button { color: var(--study-pine); background: transparent; border: 0; font: inherit; font-size: .82rem; cursor: pointer; padding: 4px 0; min-height: 38px; display: inline-flex; gap: 5px; align-items: center; }
.help-button:disabled, .study-notice button:disabled { opacity: .5; cursor: default; }
.study-notice { background: #f5eace; color: #4a3920; border: 1px solid #d9c49b; border-radius: 8px; padding: 5px 10px; font-size: .82rem; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 5px; }
.study-dialog-records { overflow-y: auto; max-height: min(62dvh, 36rem); padding: .25rem 1rem .8rem; }
</style>
