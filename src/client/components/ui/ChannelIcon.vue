<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ icon?: string | null; kind?: string }>();
const url = computed(() => {
  const icon = props.icon;
  if (!icon) return "/images/icon-192.png";
  return icon.startsWith("/") ? icon : `/backgrounds/${icon}`;
});
</script>

<template>
  <span v-if="kind === 'music'" class="channel-icon-glyph" aria-hidden="true">歌</span>
  <img v-else :src="url" alt="" />
</template>
