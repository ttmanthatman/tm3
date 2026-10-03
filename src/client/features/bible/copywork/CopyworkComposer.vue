<script setup lang="ts">
import { nextTick, computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  COPYWORK_MAX_BYTES,
  COPYWORK_MAX_POINTS,
  copyworkCharacters,
  layoutCopywork,
  normalizeCopyworkGlyph,
  type CopyworkDTO,
  type CopyworkGlyph,
  type CopyworkSpacing
} from "@shared/bibleCopywork";
import {
  normalizeHandwritingPreferences,
  type HandwritingBrush,
  type HandwritingCharacter,
  type HandwritingPen
} from "@shared/handwriting";
import AppModal from "../../../components/ui/AppModal.vue";
import HandwritingPenControls from "../../handwriting/HandwritingPenControls.vue";
import { useHandwritingPreferences } from "../../handwriting/handwritingPreferences";
import HandwritingPad from "../../handwriting/HandwritingPad.vue";
import {
  useHandwritingComposer,
  type HandwritingInputPoint
} from "../../handwriting/useHandwritingComposer";
import { createHandwritingDraftScheduler } from "../../handwriting/handwritingDraftScheduler";
import CopyworkPage from "./CopyworkPage.vue";
import { measureCopyworkInk } from "./copyworkInk";
import { copyworkDrafts, type CopyworkDraft } from "./copyworkDrafts";
import { copyworkWrite as api } from "./copyworkApi";
import { useChatStore } from "../../../store";
const props = defineProps<{ draft: CopyworkDraft }>();
const emit = defineEmits<{ close: []; saved: [work: CopyworkDTO] }>();
const composer = useHandwritingComposer();
const body = ref<HTMLElement | null>(null);
const store = useChatStore();
const pendingCharacters = ref<Record<number, HandwritingCharacter>>(
  props.draft.pendingCharacters || {}
);
const { save: savePreferences, error: preferencesError } = useHandwritingPreferences(store);
const preferences = computed(() => normalizeHandwritingPreferences(store.account?.handwritingPreferences));
const brush = computed(() => preferences.value.brush);
function changePen(nextPen: HandwritingPen, nextBrush: HandwritingBrush) {
  pen.value = nextPen;
  void savePreferences({ ...preferences.value, pen: nextPen, brush: nextBrush });
}
const glyphs = ref<CopyworkGlyph[]>(props.draft.glyphs);
const index = ref(props.draft.index);
const spacing = ref<CopyworkSpacing>(props.draft.spacing);
const pen = ref<HandwritingPen>("brush");
const color = ref("#263b33");
const toolsOpen = ref(false);
const guides = ref(false);
const complete = ref(false);
const busy = ref(false);
const status = ref("草稿保存在本机");
const error = ref("");
const page = ref(0);
let pendingId = props.draft.uploadId || "";
let saveChain: Promise<unknown> = Promise.resolve();
let disposed = false;
const chars = computed(() => copyworkCharacters(props.draft.source.text));
const pages = computed(() =>
  layoutCopywork(
    glyphs.value.map((g) => g.bounds),
    props.draft.source.text,
    spacing.value
  )
);
const displayGlyphs = computed(() => glyphs.value.map((g, i) => ({ ...g, index: i })));
const activePage = computed(() => pages.value[Math.min(page.value, pages.value.length - 1)] || []);
function load(character: HandwritingCharacter = { strokes: [] }) {
  composer.load({
    key: props.draft.id,
    revision: 0,
    payload: character.strokes.length
      ? { kind: "handwriting", version: 1, characters: [character] }
      : null
  });
  composer.setPen(pen.value, brush.value);
  composer.selectColor(color.value);
}
load(props.draft.current);
complete.value = index.value >= chars.value.length;
function persist() {
  if (disposed) return;
  const draft: CopyworkDraft = JSON.parse(
    JSON.stringify({
      ...props.draft,
      glyphs: glyphs.value,
      current: composer.current.value,
      spacing: spacing.value,
      index: index.value,
      uploadId: pendingId,
      pendingCharacters: pendingCharacters.value,
      updatedAt: Date.now()
    })
  ) as CopyworkDraft;
  saveChain = saveChain
    .catch(() => undefined)
    .then(() => copyworkDrafts.save(draft))
    .then(() => {
      status.value = "草稿已保存 · 仅本机";
    })
    .catch((e: unknown) => {
      error.value = e instanceof Error ? e.message : "草稿保存失败，请不要关闭页面";
      throw e;
    });
  void saveChain.catch(() => undefined);
}
const scheduler = createHandwritingDraftScheduler({ persist });
function changed() {
  pendingId = "";
  scheduler.request();
}
function start(id: number, point: HandwritingInputPoint) {
  if (busy.value) return;
  if (composer.beginStroke(point, id)) changed();
}
function point(id: number, input: HandwritingInputPoint) {
  if (!busy.value) composer.appendPoint(id, input);
}
function end(id: number, input?: HandwritingInputPoint) {
  if (composer.endStroke(id, input)) scheduler.flush();
}
function cancel(id: number) {
  composer.cancelStroke(id);
  scheduler.flush();
}
function undo() {
  composer.undoStroke();
  changed();
}
function clear() {
  composer.clearCurrent();
  changed();
}
function edit(i: number) {
  if (busy.value) return;
  // Switching edits never confirms an unfinished character.
  if (!complete.value && index.value !== i)
    pendingCharacters.value[index.value] = JSON.parse(
      JSON.stringify(composer.current.value)
    ) as HandwritingCharacter;
  index.value = i;
  complete.value = false;
  load(pendingCharacters.value[i] || glyphs.value[i]?.character);
  delete pendingCharacters.value[i];
  void nextTick(() => body.value?.scrollTo({ top: 0 }));
  scheduler.flush();
}
function finish() {
  error.value = "";
  try {
    const character = JSON.parse(JSON.stringify(composer.current.value)) as HandwritingCharacter;
    const glyph = normalizeCopyworkGlyph({ character, bounds: measureCopyworkInk(character) });
    const next = [...glyphs.value];
    next[index.value] = glyph;
    const points = next.reduce(
      (sum, g) => sum + g.character.strokes.reduce((n, s) => n + s.points.length, 0),
      0
    );
    if (
      points > COPYWORK_MAX_POINTS ||
      new TextEncoder().encode(JSON.stringify(next)).length > COPYWORK_MAX_BYTES
    )
      throw new Error("笔迹容量已满，请简化当前字后重试");
    glyphs.value = next;
    pendingId = "";
    {
      delete pendingCharacters.value[index.value];
      const pending = Object.keys(pendingCharacters.value)
        .map(Number)
        .sort((a, b) => a - b)[0];
      index.value = pending ?? Math.min(glyphs.value.length, chars.value.length);
      if (index.value === chars.value.length) {
        complete.value = true;
        load();
        page.value = 0;
      } else {
        load(pendingCharacters.value[index.value]);
        delete pendingCharacters.value[index.value];
        page.value = pages.value.length - 1;
      }
    }
    scheduler.flush();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "请先写下这个字";
  }
}
async function close() {
  scheduler.flush();
  try {
    await saveChain;
    emit("close");
  } catch {
    /* Visible error retains the open draft. */
  }
}
async function save() {
  if (busy.value || glyphs.value.length !== chars.value.length) return;
  busy.value = true;
  error.value = "";
  pendingId ||= crypto.randomUUID();
  scheduler.flush();
  try {
    await saveChain;
    const source = props.draft.source;
    const result = await api<{ id: string; completed: boolean }>("/api/bible/copyworks", {
      method: "POST",
      body: JSON.stringify({
        id: pendingId,
        spacing: spacing.value,
        translation: source.translation,
        bookCode: source.bookCode,
        chapter: source.chapter,
        verseStart: source.verseStart,
        verseEnd: source.verseEnd
      })
    });
    if (!result.completed)
      for (let i = 0; i < glyphs.value.length; i++) {
        status.value = `正在保存 ${i + 1} / ${glyphs.value.length} 字`;
        await api(`/api/bible/copyworks/${result.id}/glyphs/${i}`, {
          method: "PUT",
          body: JSON.stringify(glyphs.value[i])
        });
      }
    const saved = await api<{ work: CopyworkDTO }>(`/api/bible/copyworks/${result.id}/complete`, {
      method: "POST"
    });
    scheduler.stop();
    disposed = true;
    try {
      await copyworkDrafts.remove(props.draft.id);
    } catch {
      status.value = "作品已保存，本机草稿未能移除";
    }
    emit("saved", saved.work);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "保存失败，草稿仍在，可重试";
  } finally {
    busy.value = false;
  }
}
function visibility() {
  if (document.hidden) scheduler.flush();
}
watch([pen, color, brush], () => {
  composer.setPen(pen.value, brush.value);
  composer.selectColor(color.value);
});
watch(spacing, () => {
  pendingId = "";
  page.value = 0;
  scheduler.flush();
});
onMounted(() => {
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("pagehide", persist);
  scheduler.flush();
});
onBeforeUnmount(() => {
  scheduler.stop();
  if (!disposed) persist();
  document.removeEventListener("visibilitychange", visibility);
  window.removeEventListener("pagehide", persist);
});
</script>
<template>
  <AppModal
    class="copywork-composer-shell"
    :open="true"
    :busy="busy"
    title="经文抄写"
    size="medium"
    content-class="copywork-composer"
    @close="close"
  >
    <div ref="body" class="copywork-composer-body" :class="{ finished: complete }">
      <section v-if="!complete" class="writing-column">
        <div class="writing-heading">
          <span>{{ draft.source.reference }}</span
          ><span>{{ index + 1 }} / {{ chars.length }}</span>
        </div>
        <div class="prompt-line" aria-live="polite">
          <span>{{ chars.slice(Math.max(0, index - 3), index).join("") }}</span
          ><strong>{{ chars[index] }}</strong
          ><span>{{ chars.slice(index + 1, index + 4).join("") }}</span>
        </div>
        <details class="source-context">
          <summary>查看抄写原文</summary>
          <p>{{ draft.source.text }}</p>
          <small>抄写来源，未识别或核对手写内容。</small>
        </details>
        <div class="writing-surface" :class="{ guides }">
          <HandwritingPad
            :strokes="composer.current.value.strokes"
            :disabled="busy"
            background-color="#fffaf0"
            aria-label="经文抄写手写板"
            @stroke-start="start"
            @stroke-point="point"
            @stroke-end="end"
            @stroke-cancel="cancel"
          />
        </div>
        <div class="writing-actions">
          <button @click="undo">撤销</button><button @click="clear">重写本字</button
          ><button
            class="primary"
            :disabled="!composer.current.value.strokes.length"
            @click="finish()"
          >
            写好了
          </button>
        </div>
        <button class="quiet" :aria-expanded="toolsOpen" @click="toolsOpen = !toolsOpen">
          笔与纸
        </button>
        <div v-if="toolsOpen" class="writing-tools">
          <HandwritingPenControls :pen="pen" :brush="brush" :disabled="busy" @change="changePen" />
          <p v-if="preferencesError" role="alert">{{ preferencesError }}</p>
          <label>墨色 <input v-model="color" type="color" /></label>
          <label><input v-model="guides" type="checkbox" />辅助线</label>
        </div>
      </section>
      <section class="preview-column">
        <div class="preview-heading">
          <h2>{{ complete ? "亲手写下，慢慢珍藏" : "我的册页" }}</h2>
          <p>{{ complete ? "检查册页，点击任一字仍可重写。" : "保留每一笔，也保留你的字形。" }}</p>
        </div>
        <CopyworkPage
          :glyphs="displayGlyphs"
          :placements="activePage"
          :source="draft.source"
          :editable="!busy"
          @edit="edit"
        />
        <div class="page-actions">
          <button :disabled="page <= 0" @click="page--">上一页</button
          ><span>{{ page + 1 }} / {{ pages.length }}</span
          ><button :disabled="page >= pages.length - 1" @click="page++">下一页</button>
        </div>
        <label class="spacing-control"
          >字距
          <select v-model="spacing" :disabled="busy">
            <option value="compact">紧凑</option>
            <option value="normal">适中</option>
            <option value="loose">舒展</option>
          </select></label
        >
      </section>
    </div>
    <footer class="copywork-composer-footer">
      <div>
        <small role="status">{{ status }}</small>
        <p v-if="error || composer.errorMessage.value" role="alert">
          {{ error || composer.errorMessage.value }}
        </p>
      </div>
      <button v-if="complete" class="primary" :disabled="busy" @click="save">
        {{ busy ? "正在保存…" : "存入我的圣经" }}</button
      ><button v-else @click="close">下次继续写</button>
    </footer>
  </AppModal>
</template>
<style scoped>
:deep(.copywork-composer) {
  width: min(1100px, 100%);
  max-height: calc(100dvh - 24px);
  display: flex;
  flex-direction: column;
  background: #f6f1e7;
  color: #564632;
}
.copywork-composer-body {
  overflow: auto;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 340px;
  gap: 36px;
  padding: 24px;
}
.writing-column {
  min-width: 0;
}
.writing-heading {
  display: flex;
  justify-content: space-between;
  color: #83705a;
  font-size: 13px;
}
.prompt-line {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 18px;
  height: 76px;
  font-family: "Songti SC", serif;
}
.prompt-line span {
  color: #ab9e8c;
  letter-spacing: 0.15em;
}
.prompt-line strong {
  font-size: 42px;
  font-weight: 400;
}
.source-context {
  font-size: 13px;
  margin-bottom: 12px;
}
.source-context p {
  line-height: 1.8;
}
.source-context small {
  color: #827461;
}
.writing-surface {
  max-width: 440px;
  margin: auto;
}
.writing-surface :deep(.handwriting-pad) {
  border: 0;
  background: #fffaf0;
  border-radius: 3px;
}
.writing-surface.guides {
  outline: 1px dashed #b5a992;
}
.writing-surface.guides :deep(canvas) {
  background-image:
    linear-gradient(90deg, transparent 49.8%, #ac927033 50%, transparent 50.2%),
    linear-gradient(transparent 49.8%, #ac927033 50%, transparent 50.2%);
}
.writing-actions,
.page-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 12px 0;
}
button,
select {
  min-height: 42px;
  padding: 7px 14px;
  border: 1px solid #d9ceba;
  border-radius: 8px;
  background: #fffbf3;
  color: #65523b;
  font: inherit;
  cursor: pointer;
}
button:disabled {
  opacity: 0.45;
  cursor: default;
}
button.primary {
  background: #415c4c;
  border-color: #415c4c;
  color: #fff;
  padding-inline: 24px;
}
.quiet {
  border: 0;
  background: transparent;
}
.writing-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  align-items: center;
  font-size: 13px;
}
.writing-tools > .handwriting-pen-controls,
.writing-tools > [role="alert"] {
  flex-basis: 100%;
}
.writing-tools label {
  display: flex;
  align-items: center;
  gap: 6px;
}
.writing-tools input[type="range"] {
  width: 100px;
}
.preview-heading h2 {
  font:
    24px "Songti SC",
    serif;
  margin: 0 0 8px;
}
.preview-heading p {
  color: #8b7c69;
  font-size: 13px;
  margin: 0 0 20px;
}
.page-actions {
  font-size: 12px;
}
.page-actions button {
  min-height: 36px;
}
.spacing-control {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-size: 13px;
}
.finished {
  display: block;
}
.finished .preview-column {
  max-width: 500px;
  margin: auto;
}
.copywork-composer-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 12px 24px max(12px, env(safe-area-inset-bottom));
  border-top: 1px solid #e1d8c9;
}
.copywork-composer-footer small {
  color: #83735d;
}
.copywork-composer-footer p {
  color: #a14332;
  font-size: 13px;
  margin: 5px 0;
}
@media (max-width: 700px) {
  .copywork-composer-shell {
    padding: 0;
  }
  :deep(.modal-head) {
    padding-top: max(12px, env(safe-area-inset-top));
  }
  :deep(.copywork-composer) {
    width: 100%;
    height: 100dvh;
    max-height: 100dvh;
    border-radius: 0;
  }
  .copywork-composer-body {
    display: block;
    padding: 14px 18px;
  }
  .preview-column {
    max-width: 320px;
    margin: 24px auto;
  }
  .writing-surface {
    max-width: min(100%, 40dvh);
  }
  .copywork-composer-footer {
    padding-inline: 16px;
    font-size: 12px;
  }
  .copywork-composer-footer .primary {
    padding-inline: 14px;
  }
  .prompt-line {
    height: 62px;
  }
}
</style>
