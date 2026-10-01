<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { ZoomIn, ZoomOut } from "lucide-vue-next";

const props = defineProps<{ src: string }>();
const zoomed = ref(false);
const viewport = ref<HTMLElement | null>(null);

async function toggleZoom() {
  zoomed.value = !zoomed.value;
  await nextTick();
  const element = viewport.value;
  if (!element) return;
  element.scrollLeft = zoomed.value ? (element.scrollWidth - element.clientWidth) / 2 : 0;
  element.scrollTop = zoomed.value ? (element.scrollHeight - element.clientHeight) / 2 : 0;
}

watch(() => props.src, () => {
  zoomed.value = false;
  if (viewport.value) {
    viewport.value.scrollLeft = 0;
    viewport.value.scrollTop = 0;
  }
});
</script>

<template>
  <div ref="viewport" class="story-photo-viewport">
    <button type="button" class="story-photo-zoom" :class="{ zoomed }" :aria-label="zoomed ? '还原故事照片' : '放大故事照片'" :aria-pressed="zoomed" @click="toggleZoom">
      <img :src="src" alt="故事原图" draggable="false" />
    </button>
  </div>
  <button type="button" class="story-text-button story-photo-zoom-toggle" :aria-label="zoomed ? '还原故事照片' : '放大故事照片'" :aria-pressed="zoomed" @click="toggleZoom">
    <ZoomOut v-if="zoomed" :size="18" /><ZoomIn v-else :size="18" />{{ zoomed ? '还原照片' : '点击照片放大' }}
  </button>
</template>

<style scoped>
.story-photo-viewport { height: 65dvh; flex: 1 1 auto; min-height: 0; overflow: auto; overscroll-behavior: contain; }
.story-photo-zoom { display: block; width: 100%; height: 100%; padding: 0; border: 0; background: transparent; cursor: zoom-in; }
.story-photo-zoom.zoomed { width: 200%; height: 200%; cursor: zoom-out; }
.story-photo-zoom img { display: block; width: 100%; height: 100%; object-fit: contain; user-select: none; }
.story-photo-zoom:focus-visible { outline-offset: -3px; }
.story-photo-zoom-toggle { align-self: center; flex-shrink: 0; }
</style>
