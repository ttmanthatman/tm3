<script setup lang="ts">
withDefaults(
  defineProps<{
    label: string;
    inputId?: string;
    hint?: string;
    error?: string;
    disabled?: boolean;
  }>(),
  { inputId: "", hint: "", error: "", disabled: false }
);
</script>

<template>
  <div class="app-field" :data-disabled="disabled || undefined">
    <label :for="inputId || undefined">{{ label }}</label>
    <slot />
    <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    <p v-else-if="hint" class="settings-note">{{ hint }}</p>
  </div>
</template>
