<script setup lang="ts">
import AppModal from "../../components/ui/AppModal.vue";

withDefaults(defineProps<{ open: boolean; busy?: boolean; error?: string }>(), { busy: false, error: "" });
const emit = defineEmits<{ close: []; confirm: [] }>();
</script>

<template>
  <AppModal
    :open="open"
    title="终止接龙"
    :busy="busy"
    aria-label="确认终止接龙"
    close-label="关闭终止接龙确认"
    content-class="chain-end-modal"
    @close="emit('close')"
  >
    <div class="chain-end-body">
      <strong>想好了吗？</strong>
      <p>终止后所有人都不能再参与这条接龙。</p>
      <p v-if="error" class="error-text" role="alert">{{ error }}</p>
    </div>
    <footer class="modal-actions chain-end-actions">
      <button class="mini-btn secondary" type="button" :disabled="busy" @click="emit('close')">再想想</button>
      <button class="mini-btn danger-action" type="button" :disabled="busy" @click="emit('confirm')">
        {{ busy ? "正在终止…" : "确认终止" }}
      </button>
    </footer>
  </AppModal>
</template>

<style scoped>
.chain-end-body {
  display: grid;
  gap: 8px;
  padding: 18px 20px 8px;
}

.chain-end-body strong {
  font-size: 18px;
}

.chain-end-body p {
  margin: 0;
  color: var(--muted);
  line-height: 1.55;
}

.chain-end-actions {
  padding: 14px 20px 18px;
}
</style>
