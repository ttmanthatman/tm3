<script setup lang="ts">
import { computed } from "vue";
import { AI_PROVIDERS, type AiProvider } from "@shared/aiProviders";
import type { useAiSettings } from "./useAiSettings";
const props = defineProps<{ edit: ReturnType<typeof useAiSettings>["aiSettingsEdit"]["value"] }>();
const edit = computed(() => props.edit);
</script>
<template>
  <section class="ai-settings-subsection ai-settings-card">
    <div class="ai-section-title"><strong>模型接入</strong><small>分别保存各平台密钥，角色可以选用不同平台。</small></div>
    <label>系统默认平台<select aria-label="系统默认平台" v-model="edit.provider"><option v-for="(item, id) in AI_PROVIDERS" :key="id" :value="id">{{ item.name }}</option></select></label>
    <details v-for="connection in edit.providers" :key="connection.provider" class="ai-provider-card" :open="connection.provider === edit.provider">
      <summary>{{ AI_PROVIDERS[connection.provider as AiProvider].name }} <small>{{ connection.apiKeyConfigured ? '密钥已配置' : '待配置密钥' }}</small></summary>
      <div class="ai-detail-fields">
        <label>API Key<input v-model="connection.apiKey" type="password" autocomplete="off" :placeholder="connection.apiKeyConfigured ? '已设置，留空不改' : '请输入 API Key'" /></label>
        <label v-if="connection.apiKeyConfigured" class="check-row"><input v-model="connection.clearApiKey" type="checkbox" />清除已保存的密钥</label>
        <label>默认模型<input v-model="connection.model" required maxlength="120" /></label>
        <label>服务地址<input v-model="connection.baseUrl" required type="url" /></label>
        <small v-if="connection.provider === 'volcengine'">Seed Character：填写已开通的模型 ID 或推理接入点 ID。</small>
      </div>
    </details>
  </section>
</template>
