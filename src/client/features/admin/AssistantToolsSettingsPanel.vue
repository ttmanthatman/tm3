<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { api } from "../../api";

import type { AssistantToolsSettingsDTO } from "@shared/assistantTools";

const enabled = ref(true);
const maxCalls = ref(8);
const functions = ref<AssistantToolsSettingsDTO["functions"]>([]);
const loading = ref(true);
const loaded = ref(false);
const saveBusy = ref(false);
const error = ref("");
const status = ref("");
const lifetime = new AbortController();
const callsValid = computed(() => Number.isInteger(maxCalls.value) && maxCalls.value >= 1 && maxCalls.value <= 12);

function applySettings(settings: AssistantToolsSettingsDTO) {
  enabled.value = settings.enabled;
  maxCalls.value = settings.maxCalls;
  functions.value = settings.functions;
}

async function loadSettings() {
  loading.value = true;
  error.value = "";
  status.value = "";
  try {
    const settings = await api<AssistantToolsSettingsDTO>("/api/admin/assistant-tools", { signal: lifetime.signal });
    if (lifetime.signal.aborted) return;
    applySettings(settings);
    loaded.value = true;
  } catch (cause) {
    if (!lifetime.signal.aborted) error.value = cause instanceof Error ? cause.message : "功能调用设置加载失败";
  } finally {
    if (!lifetime.signal.aborted) loading.value = false;
  }
}

async function saveSettings() {
  if (!loaded.value || loading.value || saveBusy.value || !callsValid.value) return;
  saveBusy.value = true;
  error.value = "";
  status.value = "";
  try {
    const settings = await api<AssistantToolsSettingsDTO>("/api/admin/assistant-tools", {
      method: "POST",
      signal: lifetime.signal,
      body: JSON.stringify({ enabled: enabled.value, maxCalls: maxCalls.value })
    });
    if (lifetime.signal.aborted) return;
    applySettings(settings);
    status.value = "功能调用设置已保存";
  } catch (cause) {
    if (!lifetime.signal.aborted) error.value = cause instanceof Error ? cause.message : "功能调用设置保存失败";
  } finally {
    if (!lifetime.signal.aborted) saveBusy.value = false;
  }
}

onMounted(loadSettings);
onBeforeUnmount(() => lifetime.abort());
</script>

<template>
  <section class="assistant-tools-settings" aria-label="AI 助手功能调用">
    <header class="assistant-tools-intro">
      <strong>功能调用</strong>
      <p>助手可查询资料，并把聊天室功能交给提问用户打开。新注册的功能自动可用，无需逐项配置。</p>
      <p>助手沿用提问用户的权限。删除频道、退出频道及账号管理不会开放给助手。</p>
    </header>
    <p v-if="loading" role="status">正在加载功能调用设置……</p>
    <template v-else-if="loaded">
      <div class="assistant-tools-controls">
        <label class="assistant-tools-toggle"><input v-model="enabled" type="checkbox" :disabled="saveBusy" />允许 AI 助手调用聊天室功能</label>
        <label class="assistant-tools-limit">
          <span>每次回答最多调用次数</span>
          <input v-model.number="maxCalls" @keydown.enter.prevent="saveSettings" type="number" min="1" max="12" step="1" :disabled="saveBusy" :aria-invalid="!callsValid" aria-describedby="assistant-tools-limit-help" />
        </label>
        <small id="assistant-tools-limit-help">可设为 1–12 次，限制一次回答调用的功能数量。</small>
        <p v-if="!callsValid" class="assistant-tools-error" role="alert">请输入 1 到 12 之间的整数。</p>
        <p v-if="!enabled" class="assistant-tools-muted">功能调用已关闭，助手仍可进行普通文字对话。</p>
        <button type="button" class="primary-btn" :disabled="saveBusy || !callsValid" @click="saveSettings">{{ saveBusy ? '正在保存……' : '保存功能调用设置' }}</button>
      </div>
      <section class="assistant-tools-directory" aria-label="可用功能目录">
        <h3>可用功能（{{ functions.length }}）</h3>
        <ul v-if="functions.length">
          <li v-for="item in functions" :key="item.name">
            <div><code>{{ item.name }}</code><span class="assistant-tools-kind">{{ item.kind === 'read' ? '查询' : '展示' }}</span></div>
            <p>{{ item.description }}</p>
          </li>
        </ul>
        <p v-else class="assistant-tools-muted">暂无已注册的功能。</p>
      </section>
    </template>
    <p v-if="status" class="assistant-tools-status" role="status">{{ status }}</p>
    <p v-if="error" class="assistant-tools-error" role="alert">{{ error }}</p>
    <button v-if="!loading && !loaded" type="button" class="mini-btn secondary" @click="loadSettings">重新加载功能调用设置</button>
  </section>
</template>

<style scoped>
.assistant-tools-settings { display: grid; gap: 16px; min-width: 0; }
.assistant-tools-intro p { margin: 8px 0 0; color: var(--muted); line-height: 1.6; }
.assistant-tools-controls { display: grid; justify-items: start; gap: 10px; min-width: 0; padding: 16px; border: 1px solid var(--line); border-radius: 10px; }
.assistant-tools-toggle { display: flex; align-items: flex-start; gap: 8px; line-height: 1.5; }
.assistant-tools-toggle input { flex: 0 0 auto; margin-top: 4px; accent-color: var(--accent); }
.assistant-tools-limit { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.assistant-tools-limit input { width: 84px; max-width: 100%; min-height: 38px; padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; font: inherit; }
.assistant-tools-controls small, .assistant-tools-muted { color: var(--muted); }
.assistant-tools-controls p { margin: 0; }
.assistant-tools-controls button { max-width: 100%; min-height: 40px; white-space: normal; }
.assistant-tools-directory { min-width: 0; }
.assistant-tools-directory h3 { margin: 0 0 10px; font-size: 15px; }
.assistant-tools-directory ul { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.assistant-tools-directory li { min-width: 0; padding: 12px; border: 1px solid var(--line); border-radius: 8px; overflow-wrap: anywhere; }
.assistant-tools-directory li > div { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.assistant-tools-directory code { min-width: 0; font-size: 13px; }
.assistant-tools-kind { flex: 0 0 auto; border-radius: 4px; padding: 2px 6px; color: var(--muted); background: var(--panel); font-size: 12px; }
.assistant-tools-directory li p { margin: 7px 0 0; color: var(--muted); line-height: 1.5; }
.assistant-tools-error { color: #b42318; overflow-wrap: anywhere; }
.assistant-tools-status { color: #247446; }
</style>
