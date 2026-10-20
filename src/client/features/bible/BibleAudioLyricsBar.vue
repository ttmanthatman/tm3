<script setup lang="ts">
// 有声圣经卡拉OK提词器：当前句大字居中、上下句淡显，视觉语言沿用音乐歌词头。
// 两种形态：bar = 工作区底部逐节条；chat = 只看聊天时悬浮在聊天室顶端的提词器（定位样式在全局 bible-audio-lyrics.css）。
// 纯展示组件：文本与播放状态由调用方提供；点击始终交给调用方（暂停/继续）。
import { computed, ref, watch } from "vue";

const props = withDefaults(defineProps<{
  reference: string;
  currentText: string;
  previousText: string;
  nextText: string;
  playing: boolean;
  variant?: "bar" | "chat";
  transition?: boolean;
}>(), {
  variant: "bar",
  transition: true
});

defineEmits<{ tap: [] }>();

const tapLabel = computed(() => props.playing ? `正在朗读 ${props.reference}，点击暂停` : `朗读已停在 ${props.reference}，点击继续`);

// 句子切换的过渡键：文本变化时旧句上滑淡出、新句自下滑入变形归位；transition 关闭时硬切。
const transitionKey = ref(0);
watch(() => props.currentText, () => { transitionKey.value += 1; });
</script>

<template>
  <button type="button" class="bible-audio-lyrics" :class="[variant, { playing }]" :aria-label="tapLabel" @click="$emit('tap')">
    <span class="bible-audio-lyrics-reference">{{ reference }}</span>
    <span v-if="variant === 'bar'" class="bible-audio-lyrics-previous" aria-hidden="true">{{ previousText }}</span>
    <span class="bible-audio-lyrics-current-wrap">
      <Transition v-if="transition" name="bible-audio-lyrics-roll">
        <span :key="transitionKey" class="bible-audio-lyrics-current">{{ currentText }}</span>
      </Transition>
      <span v-else :key="transitionKey" class="bible-audio-lyrics-current">{{ currentText }}</span>
    </span>
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
/* 当前句占位固定为最大行数（正文 3 行），短经文不塌陷、换句时条高不变 */
.bible-audio-lyrics-current-wrap {
  position: relative;
  display: grid;
  width: 100%;
  justify-items: center;
  align-content: start;
  font-size: clamp(17px, 2.6vw, 22px);
  height: calc(1.45em * 3);
}
.bible-audio-lyrics-current {
  display: block;
  max-width: 100%;
  font-size: inherit;
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
/* 换句滑动变形：旧句缩小上浮淡出、新句自下方滑入归位，两句短暂交叠 */
.bible-audio-lyrics-roll-leave-active { position: absolute; inset: 0; transition: transform 360ms cubic-bezier(.4, .1, .6, 1), opacity 280ms ease, filter 280ms ease; }
.bible-audio-lyrics-roll-enter-active { transition: transform 440ms cubic-bezier(.22, .9, .26, 1), opacity 380ms ease, filter 380ms ease; }
.bible-audio-lyrics-roll-enter-from { opacity: 0; transform: translateY(20px) scale(.955); filter: blur(3px); }
.bible-audio-lyrics-roll-leave-to { opacity: 0; transform: translateY(-18px) scale(.93); filter: blur(3px); }
@media (prefers-reduced-motion: reduce) {
  .bible-audio-lyrics-roll-enter-active, .bible-audio-lyrics-roll-leave-active { transition: none; }
}
</style>
