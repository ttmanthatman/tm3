<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { X } from "lucide-vue-next";
import type { Bottle } from "@shared/social";
import ReadingShareCard from "../reading-shares/ReadingShareCard.vue";
const props = defineProps<{ bottle: Bottle & { text: string } }>();
const emit = defineEmits<{ close: [] }>();
const paper = ref<HTMLElement | null>(null);
let previousFocus: HTMLElement | null = null;
const opening = [10, 28, 24, 20, 21, 30, 15, 22, 15, 14, 14, 20][props.bottle.style] || 16;
const backgroundPosition = `${props.bottle.style % 4 * 100 / 3}% ${Math.floor(props.bottle.style / 4) * 50}%`;
const spriteStyle = {
  backgroundPosition,
  clipPath: `inset(${opening}% 0 0)`
};
onMounted(async () => { previousFocus = document.activeElement as HTMLElement | null; await nextTick(); paper.value?.focus({ preventScroll: true }); });
onBeforeUnmount(() => {
  const target = previousFocus?.isConnected ? previousFocus : document.querySelector<HTMLElement>('.composer button[aria-label="更多功能"]');
  target?.focus({ preventScroll: true });
});
</script>
<template>
  <section class="bottle-reading-stage" role="region" aria-label="匿名瓶中信" @keydown.esc.stop="emit('close')" @click.self="emit('close')">
    <div ref="paper" class="bottle-paper-focus" tabindex="-1">
      <ReadingShareCard kind="bible" :paper-seed="bottle.id" :text="bottle.text" class="bottle-scroll">
        <div class="opened-bottle" aria-label="已打开的漂流瓶" role="img" :data-bottle-style="bottle.style"><span class="letter-bottle-sprite" :style="spriteStyle"></span><span class="letter-bottle-sprite bottle-cork" :style="{ backgroundPosition, clipPath: `inset(0 0 ${100 - opening}%)` }"></span></div>
        <button type="button" class="letter-close" aria-label="收起瓶中信" @click="emit('close')"><X :size="19" /></button>
        <div class="bottle-letter-copy"><p>{{ bottle.text }}</p></div>
        <button type="button" class="letter-finish" @click="emit('close')">读完了，让它随风而去</button>
      </ReadingShareCard>
    </div>
  </section>
</template>
<style scoped>
.bottle-reading-stage { position: absolute; inset: 0; z-index: 18; display: grid; place-items: center; padding: 42px 20px 30px; overflow: hidden; background: transparent; container-type: size; }
.bottle-paper-focus { width: min(430px, 100%); min-width: 0; max-height: 100%; outline: none; }
.bottle-scroll { width: 100% !important; }
.bottle-scroll :deep(.reading-share-plant) { display: none; }
.bottle-scroll :deep(.reading-share-card-content) { padding: 76px 32px 30px; }
.bottle-scroll::after { content: ""; position: absolute; inset: 4px 0 auto; height: 15px; border-radius: 50% / 5px; background: linear-gradient(#c6aa7b, #fff2d7 42%, #dec398 75%, #9e7d4b); box-shadow: 0 3px 5px #67451b1a; pointer-events: none; }
.opened-bottle { position: absolute; z-index: 2; left: -9px; top: -34px; width: 85px; height: 112px; transform: rotate(-22deg); filter: drop-shadow(2px 3px 2px #382b2140); pointer-events: none; }
.letter-bottle-sprite { display: block; width: 100%; height: 100%; background-image: url('/bottles/bottles.webp'); background-size: 400% 300%; background-repeat: no-repeat; }
.bottle-cork { position: absolute; inset: 0; transform: translate(30px, -8px) rotate(28deg); transform-origin: 50% 12%; }
.letter-close { position: absolute; z-index: 2; right: 16px; top: 28px; display: grid; place-items: center; width: 36px; height: 36px; border: 0; border-radius: 50%; background: transparent; color: #755334; cursor: pointer; }
.bottle-letter-copy { max-height: max(40px, calc(100cqh - 260px)); overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; }
.bottle-letter-copy p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-family: "Songti SC", "STSong", serif; font-size: 19px; line-height: 1.95; color: #503c28; }
.letter-finish { display: block; margin: 25px auto 0; padding: 8px 0; border: 0; border-bottom: 1px solid #a8835266; background: transparent; color: #86613e; font: inherit; font-size: 13px; cursor: pointer; }
.letter-close:focus-visible, .letter-finish:focus-visible { outline: 2px solid #80603c; outline-offset: 3px; }
@media (max-width: 480px) { .bottle-reading-stage { padding-inline: 16px; } .bottle-scroll :deep(.reading-share-card-content) { padding-inline: 26px; } }
</style>
