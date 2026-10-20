<script setup lang="ts">
// 「连播到底」图标：播放三角里伸出一根向右的小箭头（播放完选中经文继续往后播）。
withDefaults(defineProps<{ size?: number }>(), { size: 16 });
</script>

<template>
  <svg xmlns="http://www.w3.org/2000/svg" :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polygon points="4 5 13 12 4 19 4 5" />
    <path d="M10 12h9" />
    <path d="m16 9 3 3-3 3" />
  </svg>
</template>
