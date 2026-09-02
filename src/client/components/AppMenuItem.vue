<script setup lang="ts">
withDefaults(defineProps<{ active?: boolean }>(), { active: false });
</script>

<template>
  <button class="app-menu-item" type="button" role="menuitem" :class="{ active }">
    <slot />
  </button>
</template>

<style scoped>
.app-menu-item {
  width: 100%;
  min-height: 40px;
  padding: 0 10px;
  border: 0;
  border-radius: 7px;
  display: flex;
  align-items: center;
  gap: 9px;
  color: var(--text);
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: color 90ms ease, background-color 90ms ease;
}

.app-menu-item.active {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.app-menu-item:hover,
.app-menu-item:focus-visible {
  color: var(--button-text);
  background: var(--accent);
  outline: none;
}

.app-menu-item:active {
  background: var(--accent-dark);
}

.app-menu-item:disabled {
  color: var(--muted);
  background: transparent;
  cursor: default;
  opacity: 0.56;
}
</style>
