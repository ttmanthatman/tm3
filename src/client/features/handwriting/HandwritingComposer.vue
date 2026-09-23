<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { Check, Eraser, Play, RotateCcw, Send, Trash2, X } from "lucide-vue-next";
import type { HandwritingPayload } from "@shared/handwriting";
import AppModal from "../../components/ui/AppModal.vue";
import HandwritingPad from "./HandwritingPad.vue";
import { drawHandwritingCharacter } from "./handwritingRenderer";
import { buildHandwritingTimeline, type HandwritingTimeline } from "./handwritingTimeline";
import {
  useHandwritingComposer,
  type HandwritingComposerSnapshot,
  type HandwritingInputPoint
} from "./useHandwritingComposer";

const props = defineProps<{
  open: boolean;
  draftState: HandwritingComposerSnapshot;
  busy: boolean;
  status: string;
  socketReady: boolean;
  replyLabel?: string;
}>();

const emit = defineEmits<{
  close: [];
  "draft-change": [payload: HandwritingPayload | null, revision: number];
  submit: [payload: HandwritingPayload, revision: number];
}>();

const composer = useHandwritingComposer(props.draftState);
const characters = computed(() => composer.characters.value);
const currentCharacter = computed(() => composer.current.value);
const revision = computed(() => composer.revision.value);
const hasContent = computed(() => composer.hasContent.value);
const totalPointCount = computed(() => composer.totalPointCount.value);
const clearConfirmOpen = ref(false);
const previewPlaying = ref(false);
const previewGrid = ref<HTMLElement | null>(null);
const completedStrip = ref<HTMLElement | null>(null);
let previewFrame = 0;
let previewStartedAt = 0;
let previewTimelineDuration = 0;
let previewPayload: HandwritingPayload | null = null;
let previewTimeline: HandwritingTimeline | null = null;
let previewCursor = 0;
let previewRenderedProgress = 0;
let previewVisibleCounts = new Map<string, number>();

const displayCharacters = computed(() => composer.snapshotCharacters.value);
const canFinishCharacter = computed(() => !props.busy && currentCharacter.value.strokes.length > 0);
const canSubmit = computed(() => !props.busy && props.socketReady && hasContent.value);

function persistDraft() {
  emit("draft-change", composer.draftSnapshot(), revision.value);
}

function updateAfter(action: () => unknown) {
  if (props.busy) return;
  action();
  persistDraft();
}

function point(pointerId: number, input: HandwritingInputPoint, force = false) {
  if (props.busy) return;
  composer.appendPoint(pointerId, input, force);
  persistDraft();
}

function strokeStart(pointerId: number, input: HandwritingInputPoint) {
  if (props.busy) return;
  composer.beginStroke(input, pointerId);
  persistDraft();
}

function strokeEnd(pointerId: number, input?: HandwritingInputPoint) {
  if (props.busy) return;
  composer.endStroke(pointerId, input);
  persistDraft();
}

function strokeCancel(pointerId: number) {
  if (props.busy) return;
  composer.cancelStroke(pointerId);
  persistDraft();
}

function submit() {
  if (!canSubmit.value) return;
  const payload = composer.snapshot();
  if (payload) emit("submit", payload, composer.revision.value);
}

function partialCharacter(payload: HandwritingPayload, index: number, visibleByStroke: Map<string, number>) {
  const character = payload.characters[index];
  if (!character) return null;
  const strokes = character.strokes.flatMap((stroke, strokeIndex) => {
    const count = visibleByStroke.get(`${index}:${strokeIndex}`) || 0;
    return count > 0 ? [{ points: stroke.points.slice(0, count) }] : [];
  });
  return strokes.length ? { strokes } : null;
}

function drawPreviewProgress(elapsedMs: number) {
  if (!previewPayload || !previewTimeline) return;
  if (elapsedMs < previewRenderedProgress) {
    previewCursor = 0;
    previewRenderedProgress = 0;
    previewVisibleCounts = new Map();
  }
  while (previewCursor < previewTimeline.events.length && previewTimeline.events[previewCursor].at <= elapsedMs) {
    const event = previewTimeline.events[previewCursor];
    const key = `${event.characterIndex}:${event.strokeIndex}`;
    previewVisibleCounts.set(key, (previewVisibleCounts.get(key) || 0) + 1);
    previewCursor += 1;
  }
  previewRenderedProgress = elapsedMs;
  const canvases = [...(previewGrid.value?.querySelectorAll<HTMLCanvasElement>("canvas") || [])];
  previewPayload.characters.forEach((_character, index) => {
    const canvas = canvases[index];
    if (canvas) drawHandwritingCharacter(canvas, partialCharacter(previewPayload!, index, previewVisibleCounts));
  });
}

function stopPreview(reset = false) {
  if (previewFrame) cancelAnimationFrame(previewFrame);
  previewFrame = 0;
  previewPlaying.value = false;
  previewTimeline = null;
  previewCursor = 0;
  previewRenderedProgress = 0;
  previewVisibleCounts = new Map();
  if (reset) void renderStatic();
}

function startPreview() {
  const payload = composer.snapshot();
  if (!payload) return;
  stopPreview(false);
  previewPayload = payload;
  const timeline = buildHandwritingTimeline(payload);
  previewTimeline = timeline;
  previewTimelineDuration = timeline.durationMs;
  previewStartedAt = performance.now();
  previewPlaying.value = true;
  const frame = (now: number) => {
    const elapsed = Math.min(previewTimelineDuration, now - previewStartedAt);
    drawPreviewProgress(elapsed);
    if (elapsed >= previewTimelineDuration) {
      previewFrame = 0;
      previewPlaying.value = false;
      return;
    }
    previewFrame = requestAnimationFrame(frame);
  };
  previewFrame = requestAnimationFrame(frame);
}

async function renderStatic() {
  await nextTick();
  const previewCanvases = [...(previewGrid.value?.querySelectorAll<HTMLCanvasElement>("canvas") || [])];
  displayCharacters.value.forEach((character, index) => {
    const canvas = previewCanvases[index];
    if (canvas) drawHandwritingCharacter(canvas, character);
  });
  const completedCanvases = [...(completedStrip.value?.querySelectorAll<HTMLCanvasElement>("canvas") || [])];
  characters.value.forEach((character, index) => {
    const canvas = completedCanvases[index];
    if (canvas) drawHandwritingCharacter(canvas, character);
  });
}

watch(
  () => props.draftState,
  (state) => {
    stopPreview(false);
    composer.load(state);
    clearConfirmOpen.value = false;
    void renderStatic();
  },
  { deep: true, immediate: true }
);
watch(displayCharacters, () => { if (!previewPlaying.value) void renderStatic(); }, { deep: true });
watch(() => props.open, (open) => { if (!open) stopPreview(true); });
watch(() => props.busy, (busy) => { if (busy) stopPreview(false); });
</script>

<template>
  <AppModal
    :open="open"
    :busy="busy"
    size="medium"
    title="逐字手写"
    content-class="handwriting-composer-modal"
    @close="emit('close')"
  >
    <div class="handwriting-composer-body">
      <section class="handwriting-completed" aria-labelledby="handwriting-completed-title">
        <header>
          <strong id="handwriting-completed-title">已完成的字</strong>
          <span>{{ characters.length }} / 30</span>
          <button type="button" class="handwriting-text-action danger" :disabled="busy || !hasContent" @click="clearConfirmOpen = true">清空全部</button>
        </header>
        <div v-if="!characters.length" class="handwriting-empty">写好一个字后，点“完成此字”</div>
        <div v-else ref="completedStrip" class="handwriting-completed-strip">
          <button
            v-for="(character, index) in characters"
            :key="`${revision}:${index}`"
            type="button"
            class="handwriting-completed-cell"
            :disabled="busy"
            :aria-label="`删除第 ${index + 1} 个字格`"
            title="删除整个字并重写"
            @click="updateAfter(() => composer.deleteCharacter(index))"
          >
            <canvas aria-hidden="true"></canvas>
          </button>
        </div>
        <small>点已完成的字格可删除整个字，其余字保持顺序。</small>
      </section>

      <section class="handwriting-current" aria-labelledby="handwriting-current-title">
        <header>
          <strong id="handwriting-current-title">当前字格</strong>
          <span>写完后手动完成，不会因停顿自动切字</span>
        </header>
        <HandwritingPad
          :strokes="currentCharacter.strokes"
          :disabled="busy"
          aria-label="当前手写字格"
          @stroke-start="strokeStart"
          @stroke-point="point"
          @stroke-end="strokeEnd"
          @stroke-cancel="strokeCancel"
        />
        <div class="handwriting-pad-actions">
          <button type="button" :disabled="busy || !currentCharacter.strokes.length" @click="updateAfter(() => composer.undoStroke())"><RotateCcw :size="16" />撤销一笔</button>
          <button type="button" :disabled="busy || !currentCharacter.strokes.length" @click="updateAfter(() => composer.clearCurrent())"><Eraser :size="16" />清空当前字</button>
          <button type="button" :disabled="!canFinishCharacter" @click="updateAfter(() => composer.finishCharacter())"><Check :size="16" />完成此字</button>
        </div>
        <p class="handwriting-status" :class="{ error: composer.errorMessage }" role="status">{{ composer.errorMessage || status }}</p>
      </section>

      <section class="handwriting-preview" aria-labelledby="handwriting-preview-title">
        <header>
          <strong id="handwriting-preview-title">发送预览</strong>
          <button type="button" class="handwriting-replay" :disabled="!hasContent || busy" @click="previewPlaying ? stopPreview(true) : startPreview()">
            <Play v-if="!previewPlaying" :size="15" />
            <X v-else :size="15" />
            {{ previewPlaying ? "停止预览" : "预览播放" }}
          </button>
        </header>
        <div v-if="displayCharacters.length" ref="previewGrid" class="handwriting-preview-grid">
          <div v-for="(_character, index) in displayCharacters" :key="index" class="handwriting-preview-cell"><canvas aria-hidden="true"></canvas></div>
        </div>
        <div v-else class="handwriting-empty">还没有可预览的字</div>
        <small v-if="displayCharacters.length">发送时会包含尚未点“完成此字”的最后一字。</small>
      </section>
    </div>

    <footer class="handwriting-composer-footer">
      <p v-if="replyLabel">将引用：{{ replyLabel }}</p>
        <p v-else>{{ totalPointCount }} 个采样点</p>
      <button type="button" class="handwriting-send" :disabled="!canSubmit" @click="submit"><Send :size="17" />发送</button>
    </footer>

    <div v-if="clearConfirmOpen" class="handwriting-confirm" role="dialog" aria-modal="true" aria-labelledby="handwriting-clear-title">
      <div>
        <Trash2 :size="22" />
        <strong id="handwriting-clear-title">清空全部手写内容？</strong>
        <p>已完成的字和当前字格都会被删除，此操作不能撤销。</p>
        <div>
          <button type="button" @click="clearConfirmOpen = false">取消</button>
          <button type="button" class="danger" @click="updateAfter(() => composer.clearAll()); clearConfirmOpen = false">确认清空</button>
        </div>
      </div>
    </div>
  </AppModal>
</template>

<style scoped>
:deep(.handwriting-composer-modal.app-modal-medium) { position: relative; grid-template-rows: auto minmax(0, 1fr) 56px !important; }
.handwriting-composer-body { min-height: 0; overflow: auto; padding: 16px; display: grid; gap: 18px; }
.handwriting-composer-body section > header { display: flex; align-items: center; gap: 10px; margin-bottom: 9px; }
.handwriting-composer-body section > header strong { color: #294737; }
.handwriting-composer-body section > header > span { color: #879388; font-size: 12px; }
.handwriting-text-action { margin-left: auto; border: 0; background: transparent; color: #47705a; padding: 6px; }
.handwriting-text-action.danger { color: #a24e43; }
.handwriting-empty { border: 1px dashed #d8ded5; padding: 14px; text-align: center; color: #929b91; font-size: 12px; }
.handwriting-completed-strip { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 5px; }
.handwriting-completed-cell, .handwriting-preview-cell { aspect-ratio: 1; border: 1px solid #e2e7df; background: #fff; padding: 0; overflow: hidden; }
.handwriting-completed-cell canvas, .handwriting-preview-cell canvas { display: block; width: 100%; height: 100%; }
.handwriting-completed small, .handwriting-preview small { display: block; color: #929b91; margin-top: 7px; }
.handwriting-current > header span { margin-left: auto; }
.handwriting-pad-actions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px; margin-top: 10px; }
.handwriting-pad-actions button, .handwriting-replay, .handwriting-send { min-height: 38px; border: 1px solid #d7e0d5; border-radius: 7px; background: #f8faf7; color: #355c48; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
.handwriting-status { min-height: 18px; margin: 7px 0 0; text-align: center; color: #7f8b80; font-size: 12px; }
.handwriting-status.error { color: #a24e43; }
.handwriting-preview > header { justify-content: space-between; }
.handwriting-preview-grid { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 5px; }
.handwriting-composer-footer { padding: 12px 16px max(12px, env(safe-area-inset-bottom)); border-top: 1px solid #e3e8df; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.handwriting-composer-footer p { color: #879388; font-size: 12px; }
.handwriting-send { min-width: 112px; background: #355c48; border-color: #355c48; color: #fff; }
.handwriting-confirm { position: absolute; inset: 0; z-index: 4; display: grid; place-items: center; padding: 20px; background: #17312680; }
.handwriting-confirm > div { width: min(360px, 100%); background: #fff; border-radius: 10px; padding: 22px; text-align: center; }
.handwriting-confirm strong { display: block; margin-top: 8px; }
.handwriting-confirm p { color: #788279; line-height: 1.6; }
.handwriting-confirm > div > div { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
.handwriting-confirm button { border: 1px solid #d7e0d5; border-radius: 7px; min-height: 36px; padding: 0 14px; }
.handwriting-confirm button.danger { background: #a24e43; border-color: #a24e43; color: #fff; }
button:disabled { opacity: .48; cursor: not-allowed; }
@media (max-width: 600px) {
  .handwriting-composer-body { padding: 12px; }
  .handwriting-completed-strip, .handwriting-preview-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); }
  .handwriting-current > header { align-items: flex-start; }
  .handwriting-current > header span { text-align: right; }
  .handwriting-pad-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .handwriting-pad-actions button:last-child { grid-column: 1 / -1; }
}
@media (max-width: 370px) {
  .handwriting-completed-strip, .handwriting-preview-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
</style>
