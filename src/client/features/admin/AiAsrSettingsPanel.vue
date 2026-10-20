<script setup lang="ts">
import type { AsrSettingsDTO } from "@shared/types";
import { computed } from "vue";

// ASR (语音识别) tab of the AI settings page. The edit object lives in
// useAiSettings' aiSettingsEdit.asr; updates replace the parent-owned draft
// through v-model, and the shared save button submits it through saveAiSettings.
export interface AsrSettingsEdit {
  provider: "mimo" | "paraformer";
  paraformer: { apiKey: string; clearApiKey: boolean; baseUrl: string; language: "auto" | "zh" | "en" };
  enabled: boolean;
  apiKey: string;
  clearApiKey: boolean;
  baseUrl: string;
  model: string;
  language: "auto" | "zh" | "en";
}

const props = defineProps<{
  edit: AsrSettingsEdit;
  configured?: AsrSettingsDTO;
}>();
const emit = defineEmits<{ "update:edit": [edit: AsrSettingsEdit] }>();
const selectedEdit = computed(() => props.edit.provider === "paraformer" ? props.edit.paraformer : props.edit);
const keyConfigured = computed(() => props.edit.provider === "paraformer" ? props.configured?.paraformer?.apiKeyConfigured : props.configured?.apiKeyConfigured);

function updateEdit(patch: Partial<AsrSettingsEdit>) {
  emit("update:edit", { ...props.edit, ...patch });
}

function updateSelectedEdit(patch: Partial<AsrSettingsEdit["paraformer"]>) {
  updateEdit(props.edit.provider === "paraformer" ? { paraformer: { ...props.edit.paraformer, ...patch } } : patch);
}

const enabled = computed({ get: () => props.edit.enabled, set: (enabled: boolean) => updateEdit({ enabled }) });
const provider = computed({ get: () => props.edit.provider, set: (provider: AsrSettingsEdit["provider"]) => updateEdit({ provider }) });
const model = computed({ get: () => props.edit.model, set: (model: string) => updateEdit({ model }) });
const apiKey = computed({ get: () => selectedEdit.value.apiKey, set: (apiKey: string) => updateSelectedEdit({ apiKey }) });
const clearApiKey = computed({ get: () => selectedEdit.value.clearApiKey, set: (clearApiKey: boolean) => updateSelectedEdit({ clearApiKey }) });
const baseUrl = computed({ get: () => selectedEdit.value.baseUrl, set: (baseUrl: string) => updateSelectedEdit({ baseUrl }) });
const language = computed({ get: () => selectedEdit.value.language, set: (language: AsrSettingsEdit["language"]) => updateSelectedEdit({ language }) });
</script>

<template>
  <section class="ai-settings-subsection ai-settings-card">
    <div class="ai-section-title">
      <strong>语音识别</strong>
      <small>语音消息「转文字」的接入配置</small>
    </div>
    <label class="check-row"><input v-model="enabled" type="checkbox" /> 启用语音转文字</label>
    <label>识别服务</label>
    <select v-model="provider">
      <option value="mimo">MiMo</option>
      <option value="paraformer">阿里云 Paraformer（同步字幕）</option>
    </select>
    <small>{{ edit.provider === 'paraformer' ? '返回字词时间戳，播放时显示同步字幕。请使用阿里云百炼北京地域的 API Key。' : '返回完整文字，保留原有 MiMo 接入。' }}</small>
    <label>API Key</label>
    <input
      v-model="apiKey"
      type="password"
      autocomplete="off"
      :placeholder="keyConfigured ? '已设置，留空不改' : '请输入语音识别服务 API Key'"
    />
    <label v-if="keyConfigured" class="check-row"><input v-model="clearApiKey" type="checkbox" /> 清除当前服务的 API Key</label>
    <label>{{ edit.provider === 'paraformer' ? 'WebSocket URL' : 'Base URL' }}</label>
    <input v-model="baseUrl" type="text" autocomplete="off" placeholder="语音识别服务的接口地址" />
    <label>模型</label>
    <input v-if="edit.provider === 'mimo'" v-model="model" type="text" autocomplete="off" placeholder="识别模型名称" />
    <input v-else value="paraformer-realtime-v2" type="text" readonly />
    <label>识别语言</label>
    <select v-model="language">
      <option value="auto">自动检测</option>
      <option value="zh">中文</option>
      <option value="en">英文</option>
    </select>
  </section>
</template>
