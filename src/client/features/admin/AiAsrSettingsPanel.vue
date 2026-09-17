<script setup lang="ts">
import type { AsrSettingsDTO } from "@shared/types";

// ASR (语音识别) tab of the AI settings page. The edit object lives in
// useAiSettings' aiSettingsEdit.asr and is mutated in place, matching how the
// other tabs edit aiSettingsEdit directly; the shared form save button in
// App.vue submits it through saveAiSettings.
export interface AsrSettingsEdit {
  enabled: boolean;
  apiKey: string;
  clearApiKey: boolean;
  baseUrl: string;
  model: string;
  language: "auto" | "zh" | "en";
}

defineProps<{
  edit: AsrSettingsEdit;
  configured?: AsrSettingsDTO;
}>();
</script>

<template>
  <section class="ai-settings-subsection ai-settings-card">
    <div class="ai-section-title">
      <strong>语音识别</strong>
      <small>语音消息「转文字」的接入配置</small>
    </div>
    <label class="check-row"><input v-model="edit.enabled" type="checkbox" /> 启用语音转文字</label>
    <label>API Key</label>
    <input
      v-model="edit.apiKey"
      type="password"
      autocomplete="off"
      :placeholder="configured?.apiKeyConfigured ? '已设置，留空不改' : '请输入语音识别服务 API Key'"
    />
    <label v-if="configured?.apiKeyConfigured" class="check-row"><input v-model="edit.clearApiKey" type="checkbox" /> 清除已保存的 API Key</label>
    <label>Base URL</label>
    <input v-model="edit.baseUrl" type="text" autocomplete="off" placeholder="语音识别服务的接口地址" />
    <label>模型</label>
    <input v-model="edit.model" type="text" autocomplete="off" placeholder="识别模型名称" />
    <label>识别语言</label>
    <select v-model="edit.language">
      <option value="auto">自动检测</option>
      <option value="zh">中文</option>
      <option value="en">英文</option>
    </select>
  </section>
</template>
