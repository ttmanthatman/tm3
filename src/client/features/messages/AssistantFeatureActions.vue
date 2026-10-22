<script setup lang="ts">
import type { AssistantFeatureId } from "@shared/assistantTools";

defineProps<{ actions: Array<{ feature: AssistantFeatureId; label: string }> }>();
const emit = defineEmits<{ open: [feature: AssistantFeatureId] }>();
</script>

<template>
  <div v-if="actions.length" class="assistant-feature-actions" role="group" aria-label="助手提供的聊天室功能">
    <button v-for="action in actions" :key="action.feature" type="button" class="assistant-feature-action" @click.stop="emit('open', action.feature)">{{ action.label }}</button>
  </div>
</template>

<style scoped>
.assistant-feature-actions { display: flex; flex-wrap: wrap; gap: 8px; min-width: 0; margin-top: 10px; }
.assistant-feature-action { max-width: 100%; min-height: 40px; padding: 7px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); color: var(--accent); font: inherit; line-height: 1.5; text-align: left; overflow-wrap: anywhere; cursor: pointer; }
.assistant-feature-action:hover { border-color: var(--accent); }
.assistant-feature-action:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
