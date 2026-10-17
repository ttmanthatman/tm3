<script setup lang="ts">
import { ref, watch } from "vue";
import type { BiblePreferencesDTO } from "@shared/types";
import AppModal from "../../components/ui/AppModal.vue";
import { useBibleAccountState } from "./useBibleAccountState";
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();
const { preferences, preferencesBusy, savePreferences, refreshPreferences } = useBibleAccountState();
const draft = ref<Partial<BiblePreferencesDTO>>({});
const error = ref("");
const loading = ref(false);
watch(() => props.open, async (open) => {
  if (!open) return;
  error.value = "";
  loading.value = true;
  draft.value = {};
  try {
    await refreshPreferences();
    draft.value = {
      shareIncludeTranslation: preferences.value?.shareIncludeTranslation ?? false,
      shareConfirm: preferences.value?.shareConfirm ?? true,
      defaultSearchMode: preferences.value?.defaultSearchMode ?? "topic",
      fontSize: preferences.value?.fontSize ?? 20,
      notesAlwaysPublic: preferences.value?.notesAlwaysPublic ?? false
    };
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "偏好加载失败"; }
  finally { loading.value = false; }
});
async function save() {
  try { await savePreferences(draft.value); emit("close"); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : "保存失败，请重试"; }
}
</script>
<template>
  <AppModal :open="open" title="圣经偏好设置" :busy="preferencesBusy" content-class="bible-preferences-dialog" @close="emit('close')">
    <form class="preferences-form" @submit.prevent="save">
      <p>随账号保存，在其他设备登录后也会生效。</p>
      <p v-if="loading" role="status">正在同步偏好…</p>
      <template v-else>
      <label><input v-model="draft.shareIncludeTranslation" type="checkbox" />发送经文时显示版本信息</label>
      <label><input v-model="draft.shareConfirm" type="checkbox" />发送经文前显示确认窗口</label>
      <small>关闭确认后，点“发送”会直接发送到当前聊天室；失败时仍可重试。</small>
      <label>默认检索方式<select v-model="draft.defaultSearchMode"><option value="topic">主题检索</option><option value="text">文本检索</option></select></label>
      <label>经文字号<input v-model.number="draft.fontSize" type="number" min="16" max="40" required /></label>
      <label><input v-model="draft.notesAlwaysPublic" type="checkbox" />新笔记默认公开并跳过公开确认</label>
      <small>关闭后，每次完成新笔记时询问是否公开。</small>
      <p v-if="error" role="alert">{{ error }}</p>
      <footer><button type="submit" :disabled="preferencesBusy || !Object.keys(draft).length">{{ preferencesBusy ? '保存中…' : '保存偏好' }}</button></footer>
      </template>
    </form>
  </AppModal>
</template>
<style scoped>
:global(.bible-preferences-dialog) { max-height: calc(var(--app-height, 100dvh) - 32px); display: flex; flex-direction: column; }
.preferences-form { padding: 0 16px 16px; overflow-y: auto; display: grid; gap: 16px; color: #604b32; }
p { margin: 0; } small { color: #806b55; line-height: 1.5; }
label { min-height: 36px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
input[type=checkbox] { width: 20px; height: 20px; accent-color: #80613f; }
select, input[type=number] { min-height: 40px; max-width: 100%; border: 1px solid #cbb797; border-radius: 8px; padding: 6px; font: inherit; }
footer { display: flex; justify-content: end; } button { min-height: 44px; border: 0; border-radius: 8px; padding: 8px 16px; background: #80613f; color: white; font: inherit; }
[role=alert] { color: #a33429; }
</style>
