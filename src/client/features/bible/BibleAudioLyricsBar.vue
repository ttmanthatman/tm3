<script setup lang="ts">
// 有声圣经卡拉OK提词器：只在「只看聊天」时由 App 悬浮在聊天室顶端（挂载位与进出场在全局 bible-audio-lyrics.css）。
// 当前句大字居中、下一句淡显，视觉语言沿用音乐歌词头。圣经页面内不显示——经文本身已高亮跟随。
// 纯展示组件：文本与播放状态由调用方提供；点击交给调用方（暂停/继续）。
import { computed, ref, watch } from "vue";

const props = withDefaults(defineProps<{
  reference: string;
  currentText: string;
  nextText: string;
  playing: boolean;
  transition?: boolean;
}>(), {
  transition: true
});

defineEmits<{ tap: [] }>();

const tapLabel = computed(() => props.playing ? `正在朗读 ${props.reference}，点击暂停` : `朗读已停在 ${props.reference}，点击继续`);

// 句子切换的过渡键：文本变化时旧句上滑淡出、新句自下滑入变形归位；transition 关闭时硬切。
const transitionKey = ref(0);
watch(() => props.currentText, () => { transitionKey.value += 1; });
</script>

<template>
  <button type="button" class="bible-audio-lyrics" :class="{ playing }" :aria-label="tapLabel" @click="$emit('tap')">
    <span class="bible-audio-lyrics-reference">{{ reference }}</span>
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
/* 定位（absolute/top/z-index）由全局 .chat-pane > .bible-audio-lyrics 负责，这里不写 position，避免同权重覆盖 */
.bible-audio-lyrics {
  width: 100%;
  min-width: 0;
  padding: calc(var(--safe-top) + 12px) clamp(18px, 5vw, 44px) 12px;
  border: 0;
  border-bottom: 1px solid rgba(255, 215, 159, .24);
  color: #fff;
  background:
    radial-gradient(circle at 18% 6%, rgba(255, 180, 85, .22), transparent 42%),
    radial-gradient(circle at 84% 92%, rgba(101, 126, 181, .16), transparent 38%),
    linear-gradient(148deg, rgba(18, 24, 37, .985), rgba(53, 38, 34, .975) 56%, rgba(15, 24, 39, .985));
  box-shadow: inset 0 -1px rgba(255, 225, 184, .16), 0 18px 42px rgba(8, 15, 28, .28);
  display: grid;
  justify-items: center;
  gap: 4px;
  overflow: hidden;
  cursor: pointer;
  font: inherit;
  text-align: center;
  transform-origin: top center;
  backdrop-filter: blur(24px) saturate(1.18);
  -webkit-tap-highlight-color: transparent;
}
.bible-audio-lyrics-reference { font-size: 12px; font-weight: 700; letter-spacing: .08em; color: rgba(255, 181, 77, .85); }
.bible-audio-lyrics-next {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  line-height: 1.3;
  color: rgba(255, 255, 255, .38);
}
/* 当前句占位固定 2 行：短经文不塌陷、换句时高度不变 */
.bible-audio-lyrics-current-wrap {
  position: relative;
  display: grid;
  width: 100%;
  justify-items: center;
  align-content: start;
  font-size: clamp(18px, 2.8vw, 24px);
  height: calc(1.45em * 2);
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
  -webkit-line-clamp: 2;
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
