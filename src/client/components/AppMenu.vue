<script setup lang="ts">
defineProps<{ label: string }>();
</script>

<template>
  <div class="app-menu" role="menu" :aria-label="label">
    <slot />
  </div>
</template>

<style scoped>
.app-menu {
  box-sizing: border-box;
  padding: 6px;
  display: grid;
  gap: 3px;
  border: 1px solid color-mix(in srgb, var(--line) 82%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--panel) 96%, transparent);
  box-shadow: 0 12px 30px rgba(15, 23, 42, 0.2);
  backdrop-filter: blur(14px) saturate(135%);
}
</style>
