<script setup lang="ts">
import AppModal from "../../components/ui/AppModal.vue";

const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <Teleport to="body">
    <AppModal :open="true" title="使用说明" size="medium" content-class="chat-usage-help" @close="emit('close')">
      <div class="chat-usage-help-content"><p>还没写呢……</p></div>
    </AppModal>
  </Teleport>
</template>

<style scoped>
:deep(.chat-usage-help) {
  color: #40344e;
  background: radial-gradient(ellipse at 12% 12%, #fff7dfcc 0, transparent 46%), radial-gradient(ellipse at 90% 32%, #fbd1dba8 0, transparent 52%), radial-gradient(ellipse at 15% 92%, #c4d3f1b3 0, transparent 55%), linear-gradient(155deg, #ffe8bd 0%, #f7d4d9 42%, #d8d0ee 73%, #c8dced 100%);
  height: min(480px, calc(var(--app-height, 100dvh) - var(--safe-top, 0px) - var(--safe-bottom, 0px) - 24px));
  grid-template-rows: auto minmax(0, 1fr);
}
:deep(.chat-usage-help .modal-head) { color: #40344e; background: #fff8ef33; border-bottom-color: #7c577b24; }
.chat-usage-help-content { min-height: 0; overflow: auto; overscroll-behavior: contain; display: grid; place-items: center; padding: 24px; }
.chat-usage-help-content p { margin: 0; overflow-wrap: anywhere; }
</style>
