<script setup lang="ts">
import AppModal from "./AppModal.vue";
import AppButton from "./AppButton.vue";

withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    message: string;
    detail?: string;
    confirmText?: string;
    cancelText?: string;
    danger?: boolean;
    busy?: boolean;
    error?: string;
    closeLabel?: string;
  }>(),
  { detail: "", confirmText: "确认", cancelText: "取消", danger: false, busy: false, error: "", closeLabel: "关闭" }
);

const emit = defineEmits<{ close: []; confirm: [] }>();
</script>

<template>
  <AppModal :open="open" :title="title" :busy="busy" :close-label="closeLabel" @close="emit('close')">
    <div class="confirm-body">
      <p>{{ message }}</p>
      <strong v-if="detail">{{ detail }}</strong>
      <p v-if="error" class="form-error">{{ error }}</p>
      <div class="confirm-actions">
        <AppButton variant="ghost" :disabled="busy" @click="emit('close')">{{ cancelText }}</AppButton>
        <AppButton :variant="danger ? 'danger' : 'primary'" :disabled="busy" @click="emit('confirm')">{{ confirmText }}</AppButton>
      </div>
    </div>
  </AppModal>
</template>
