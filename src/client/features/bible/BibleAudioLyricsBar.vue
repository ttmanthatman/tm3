<script setup lang="ts">
// 有声圣经卡拉OK逐节条：当前节大字居中、上一/下一节淡显，视觉语言沿用音乐歌词条。
// 纯展示组件：文本由工作区按当前朗读位置提供。
import { ref, watch } from "vue";

const props = defineProps<{
  reference: string;
  currentText: string;
  previousText: string;
  nextText: string;
  playing: boolean;
}>();

defineEmits<{ tap: [] }>();

// 节切换时轻微上滑淡入，让“滚动歌词”的感觉连续。
const transitionKey = ref(0);
watch(() => props.currentText, () => { transitionKey.value += 1; });
</script>

<template>
  <button type="button" class="bible-audio-lyrics" :class="{ playing }" :aria-label="`正在朗读 ${reference}，点击暂停或继续`" @click="$emit('tap')">
    <span class="bible-audio-lyrics-reference">{{ reference }}</span>
    <span class="bible-audio-lyrics-previous" aria-hidden="true">{{ previousText }}</span>
    <Transition name="bible-audio-lyrics-swap" mode="out-in">
      <span :key="transitionKey" class="bible-audio-lyrics-current">{{ currentText }}</span>
    </Transition>
    <span class="bible-audio-lyrics-next" aria-hidden="true">{{ nextText }}</span>
  </button>
</template>

<style scoped>
.bible-audio-lyrics {
  position: relative;
  z-index: 6;
  width: 100%;
  min-width: 0;
  padding: 10px clamp(16px, 5vw, 44px) calc(10px + var(--safe-bottom));
  border: 0;
  border-top: 1px solid rgba(255, 215, 159, .22);
  color: #fff;
  background:
    radial-gradient(circle at 18% 6%, rgba(255, 180, 85, .22), transparent 42%),
    radial-gradient(circle at 84% 92%, rgba(101, 126, 181, .16), transparent 38%),
    linear-gradient(148deg, rgba(18, 24, 37, .985), rgba(53, 38, 34, .975) 56%, rgba(15, 24, 39, .985));
  box-shadow: inset 0 1px rgba(255, 225, 184, .14), 0 -12px 32px rgba(8, 15, 28, .22);
  display: grid;
  justify-items: center;
  gap: 3px;
  overflow: hidden;
  cursor: pointer;
  font: inherit;
  text-align: center;
  -webkit-tap-highlight-color: transparent;
}
.bible-audio-lyrics-reference { font-size: 12px; font-weight: 700; letter-spacing: .08em; color: rgba(255, 181, 77, .85); }
.bible-audio-lyrics-previous, .bible-audio-lyrics-next {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  line-height: 1.3;
  color: rgba(255, 255, 255, .38);
}
.bible-audio-lyrics-current {
  display: block;
  max-width: 100%;
  font-size: clamp(17px, 2.6vw, 22px);
  font-weight: 800;
  line-height: 1.45;
  letter-spacing: .02em;
  color: #ffb54d;
  text-shadow: 0 0 9px rgba(255, 137, 28, .5), 0 1px 0 rgba(0, 0, 0, .35);
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
}
.bible-audio-lyrics:not(.playing) .bible-audio-lyrics-current { color: rgba(255, 213, 160, .72); text-shadow: none; }
.bible-audio-lyrics-swap-enter-active, .bible-audio-lyrics-swap-leave-active { transition: opacity 160ms ease, transform 160ms ease; }
.bible-audio-lyrics-swap-enter-from { opacity: 0; transform: translateY(8px); }
.bible-audio-lyrics-swap-leave-to { opacity: 0; transform: translateY(-8px); }
@media (prefers-reduced-motion: reduce) {
  .bible-audio-lyrics-swap-enter-active, .bible-audio-lyrics-swap-leave-active { transition: none; }
}
</style>
