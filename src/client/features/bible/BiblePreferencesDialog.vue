<script setup lang="ts">
// 圣经偏好设置：纸质卡片式设计语言（米色纸面 + 宋体标题 + 赭石强调色），与阅读窗格一致。
// 字号一栏即时生效：每次调节立刻 emit 给工作区应用阅读字号并自动保存，无需点「保存偏好」。
import { ref, watch } from "vue";
import type { BiblePreferencesDTO } from "@shared/types";
import { Minus, Plus } from "lucide-vue-next";
import AppModal from "../../components/ui/AppModal.vue";
import { useBibleAccountState } from "./useBibleAccountState";
import { BIBLE_FONT_MAX, BIBLE_FONT_MIN, clampBibleFontSize } from "./bibleFont";
const props = defineProps<{ open: boolean; fontSize: number }>();
const emit = defineEmits<{ close: []; "font-size": [size: number] }>();
const { preferences, preferencesBusy, savePreferences, refreshPreferences } = useBibleAccountState();
const draft = ref<Partial<BiblePreferencesDTO>>({});
const size = ref(props.fontSize);
const error = ref("");
const loading = ref(false);
watch(() => props.fontSize, value => { size.value = value; });
watch(() => props.open, async (open) => {
  if (!open) return;
  error.value = "";
  loading.value = true;
  draft.value = {};
  size.value = props.fontSize;
  try {
    await refreshPreferences();
    draft.value = {
      shareIncludeTranslation: preferences.value?.shareIncludeTranslation ?? false,
      shareConfirm: preferences.value?.shareConfirm ?? true,
      defaultSearchMode: preferences.value?.defaultSearchMode ?? "topic",
      notesAlwaysPublic: preferences.value?.notesAlwaysPublic ?? false
    };
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "偏好加载失败"; }
  finally { loading.value = false; }
});
function applyFontSize(value: number) {
  const next = clampBibleFontSize(value);
  if (next === size.value) return;
  size.value = next;
  emit("font-size", next);
}
function handleFontSizeInput(event: Event) {
  applyFontSize(Number((event.target as HTMLInputElement).value));
}
async function save() {
  try { await savePreferences({ ...draft.value, fontSize: size.value }); emit("close"); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : "保存失败，请重试"; }
}
</script>
<template>
  <AppModal :open="open" title="圣经偏好设置" :busy="preferencesBusy" content-class="bible-preferences-dialog" @close="emit('close')">
    <form class="preferences-form" @submit.prevent="save">
      <p class="preferences-hint">随账号保存，在其他设备登录后也会生效。</p>
      <p v-if="loading" role="status">正在同步偏好…</p>
      <template v-else>
        <section class="preferences-card" aria-label="正文阅读">
          <header><h3>经文字号</h3><output class="font-size-value">{{ size }} 号</output></header>
          <div class="font-stepper">
            <button type="button" :disabled="size <= BIBLE_FONT_MIN" aria-label="减小字号" title="减小字号" @click="applyFontSize(size - 1)"><Minus :size="15" /></button>
            <input
              type="range"
              class="font-size-slider"
              :style="{ '--font-size-progress': `${((size - BIBLE_FONT_MIN) / (BIBLE_FONT_MAX - BIBLE_FONT_MIN)) * 100}%` }"
              :min="BIBLE_FONT_MIN"
              :max="BIBLE_FONT_MAX"
              step="1"
              :value="size"
              aria-label="经文字号"
              @input="handleFontSizeInput"
            />
            <button type="button" :disabled="size >= BIBLE_FONT_MAX" aria-label="增大字号" title="增大字号" @click="applyFontSize(size + 1)"><Plus :size="15" /></button>
          </div>
          <p class="font-preview" aria-hidden="true" :style="{ fontSize: `${size}px` }">你的话是我脚前的灯，是我路上的光。</p>
          <small class="pref-note">调节即时生效，并自动保存到账号。</small>
        </section>
        <section class="preferences-card" aria-label="经文分享">
          <header><h3>经文分享</h3></header>
          <label class="pref-switch"><input v-model="draft.shareIncludeTranslation" type="checkbox" /><span class="switch" aria-hidden="true"></span><span class="pref-text">发送经文时显示版本信息</span></label>
          <label class="pref-switch"><input v-model="draft.shareConfirm" type="checkbox" /><span class="switch" aria-hidden="true"></span><span class="pref-text">发送经文前显示确认窗口</span></label>
          <small class="pref-note">关闭确认后，点“发送”会直接发送到当前聊天室；失败时仍可重试。</small>
        </section>
        <section class="preferences-card" aria-label="检索与笔记">
          <header><h3>检索与笔记</h3></header>
          <fieldset class="pref-segment">
            <legend>默认检索方式</legend>
            <div class="segment-options">
              <label><input v-model="draft.defaultSearchMode" type="radio" value="topic" /><span>主题检索</span></label>
              <label><input v-model="draft.defaultSearchMode" type="radio" value="text" /><span>文本检索</span></label>
            </div>
          </fieldset>
          <label class="pref-switch"><input v-model="draft.notesAlwaysPublic" type="checkbox" /><span class="switch" aria-hidden="true"></span><span class="pref-text">新笔记默认公开并跳过公开确认</span></label>
          <small class="pref-note">关闭后，每次完成新笔记时询问是否公开。</small>
        </section>
        <p v-if="error" role="alert">{{ error }}</p>
        <footer>
          <span class="preferences-footnote">字号即时生效，其余项保存后同步</span>
          <button type="submit" :disabled="preferencesBusy">{{ preferencesBusy ? '保存中…' : '保存偏好' }}</button>
        </footer>
      </template>
    </form>
  </AppModal>
</template>
<style scoped>
:global(.bible-preferences-dialog) {
  max-height: calc(var(--app-height, 100dvh) - 32px);
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(117, 84, 47, .22);
  border-radius: 16px;
  background: #f6efe2;
  box-shadow: 0 18px 48px rgba(45, 33, 22, .28);
  overflow: hidden;
}
:global(.bible-preferences-dialog .modal-head) { background: transparent; border-bottom: 1px solid rgba(117, 84, 47, .16); }
:global(.bible-preferences-dialog .modal-head strong) { font-family: "Songti SC", "STSong", serif; font-size: 17px; letter-spacing: .05em; color: #6d5135; }
.preferences-form { padding: 14px 16px 16px; overflow-y: auto; display: grid; gap: 12px; color: #5c4630; font-size: 14px; }
.preferences-hint { margin: 0; color: #8b7259; font-size: 12.5px; }
p[role=status] { margin: 0; color: #8b7259; }
.preferences-card { display: grid; gap: 10px; padding: 12px 14px; border: 1px solid rgba(203, 184, 155, .6); border-radius: 12px; background: rgba(255, 252, 245, .85); }
.preferences-card header { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.preferences-card h3 { margin: 0; font-family: "Songti SC", "STSong", serif; font-size: 15px; font-weight: 700; letter-spacing: .08em; color: #6d5135; }
.font-size-value { font-size: 13px; font-weight: 800; font-variant-numeric: tabular-nums; color: #b9582b; }
.font-stepper { display: flex; align-items: center; gap: 10px; }
.font-stepper button { flex: none; width: 34px; height: 34px; border: 1px solid rgba(128, 97, 63, .32); border-radius: 999px; display: grid; place-items: center; background: #fffaf1; color: #654a31; cursor: pointer; }
.font-stepper button:not(:disabled):hover { background: #f3e7d3; }
.font-stepper button:disabled { opacity: .38; cursor: not-allowed; }
.font-size-slider {
  -webkit-appearance: none;
  appearance: none;
  flex: 1;
  min-width: 0;
  height: 24px;
  margin: 0;
  background: transparent;
  cursor: pointer;
}
.font-size-slider::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 999px;
  background: linear-gradient(to right, #b9582b var(--font-size-progress, 0%), rgba(203, 184, 155, .55) var(--font-size-progress, 0%));
}
.font-size-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 16px; height: 16px;
  margin-top: -6px;
  border-radius: 50%;
  background: #b9582b;
  border: 2px solid #fffaf1;
  box-shadow: 0 1px 4px rgba(74, 52, 29, .35);
}
.font-size-slider::-moz-range-track { height: 4px; border-radius: 999px; background: rgba(203, 184, 155, .55); }
.font-size-slider::-moz-range-progress { height: 4px; border-radius: 999px; background: #b9582b; }
.font-size-slider::-moz-range-thumb { width: 12px; height: 12px; border-radius: 50%; background: #b9582b; border: 2px solid #fffaf1; }
.font-preview { margin: 0; padding: 10px 12px; border: 1px dashed rgba(203, 184, 155, .75); border-radius: 10px; background: #fffdf6; color: #4f3b29; font-family: "Songti SC", "STSong", serif; line-height: 1.9; text-align: center; overflow-wrap: anywhere; transition: font-size 120ms ease; }
.pref-note { color: #8b7259; line-height: 1.55; font-size: 12px; }
.pref-switch { position: relative; display: flex; align-items: center; gap: 10px; min-height: 32px; cursor: pointer; }
/* 真实 input 覆盖整行并完全透明：点击轨迹/文字都落在原生控件上，键盘与读屏语义不变 */
.pref-switch input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.pref-switch .switch { flex: none; position: relative; width: 40px; height: 22px; border-radius: 999px; background: #d3c3a8; transition: background 160ms ease; }
.pref-switch .switch::after { content: ""; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fffdf7; box-shadow: 0 1px 3px rgba(74, 52, 29, .3); transition: transform 160ms ease; }
.pref-switch input:checked + .switch { background: #b9582b; }
.pref-switch input:checked + .switch::after { transform: translateX(18px); }
.pref-switch input:focus-visible + .switch { outline: 2px solid rgba(185, 88, 43, .55); outline-offset: 2px; }
.pref-text { min-width: 0; }
.pref-segment { border: 0; margin: 0; padding: 0; display: grid; gap: 7px; }
.pref-segment legend { padding: 0; font-size: 13px; color: #5c4630; }
.segment-options { display: inline-flex; gap: 2px; padding: 3px; border-radius: 999px; background: rgba(203, 184, 155, .38); width: fit-content; }
.segment-options label { position: relative; display: inline-flex; }
.segment-options input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
.segment-options span { display: grid; place-items: center; min-width: 96px; min-height: 32px; padding: 0 12px; border-radius: 999px; color: #6d5135; font-size: 13px; font-weight: 700; cursor: pointer; transition: background 140ms ease, color 140ms ease; }
.segment-options input:checked + span { background: #fffaf1; color: #8a4a22; box-shadow: 0 1px 4px rgba(74, 52, 29, .16); }
.segment-options input:focus-visible + span { outline: 2px solid rgba(185, 88, 43, .55); outline-offset: 2px; }
[role=alert] { margin: 0; color: #a33429; }
footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.preferences-footnote { color: #8b7259; font-size: 12px; }
footer button { min-height: 40px; padding: 8px 22px; border: 0; border-radius: 999px; background: #b9582b; color: white; font: inherit; font-weight: 700; cursor: pointer; box-shadow: 0 6px 16px rgba(185, 88, 43, .26); }
footer button:disabled { opacity: .55; cursor: wait; }
@media (prefers-reduced-motion: reduce) {
  .pref-switch .switch, .pref-switch .switch::after, .segment-options span, .font-preview { transition: none; }
}
</style>
