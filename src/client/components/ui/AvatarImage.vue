<script setup lang="ts">
import { computed, ref, watch } from "vue";

const props = defineProps<{ path?: string | null }>();
const failed = ref(false);
watch(
  () => props.path,
  () => {
    failed.value = false;
  }
);
const url = computed(() => {
  const path = props.path;
  if (!path) return "";
  return path.startsWith("/") ? path : `/avatars/${path}`;
});
</script>

<template>
  <img v-if="url && !failed" :src="url" alt="" decoding="async" @error="failed = true" />
  <slot v-else />
</template>
