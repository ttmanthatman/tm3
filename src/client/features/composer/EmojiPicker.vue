<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from "vue";
import { Smile, X } from "lucide-vue-next";
import { wechatEmojis, type WechatEmoji } from "./wechatEmoji";

const props = defineProps<{ contextKey: string; composerPanel: "voice" | "more" | null; disabled: boolean }>();
const emit = defineEmits<{ choose: [emoji: WechatEmoji]; open: [] }>();
const pickerOpen = ref(false);
const query = ref("");
const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);
const panelId = useId();
const filteredEmojis = computed(() => {
  const search = query.value.trim().toLocaleLowerCase();
  return wechatEmojis.filter((emoji) => emoji.name.toLocaleLowerCase().includes(search));
});

function close(restoreFocus = false) {
  pickerOpen.value = false;
  if (restoreFocus) trigger.value?.focus();
}

async function toggle() {
  if (pickerOpen.value) return close();
  emit("open");
  query.value = "";
  pickerOpen.value = true;
  await nextTick();
  searchInput.value?.focus({ preventScroll: true });
}

function choose(emoji: WechatEmoji) {
  close();
  emit("choose", emoji);
}

watch(() => props.contextKey, () => close());
watch(() => [props.composerPanel, props.disabled], () => {
  if (props.composerPanel || props.disabled) close();
});
watch(pickerOpen, (open, _previous, onCleanup) => {
  if (!open) return;
  const outside = (event: PointerEvent) => {
    if (event.target instanceof Node && !root.value?.contains(event.target)) close();
  };
  const escape = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close(true);
  };
  document.addEventListener("pointerdown", outside);
  document.addEventListener("keydown", escape, true);
  onCleanup(() => {
    document.removeEventListener("pointerdown", outside);
    document.removeEventListener("keydown", escape, true);
  });
}, { flush: "post" });
</script>

<template>
  <div ref="root" class="emoji-picker">
    <button
      ref="trigger"
      type="button"
      class="icon-btn composer-edge-btn"
      :class="{ active: pickerOpen }"
      :disabled="disabled"
      aria-label="表情"
      :aria-expanded="pickerOpen"
      :aria-controls="pickerOpen ? panelId : undefined"
      aria-haspopup="dialog"
      @click="toggle"
    ><Smile :size="22" /></button>
    <section v-if="pickerOpen" :id="panelId" class="emoji-picker-panel" role="dialog" aria-label="微信表情">
      <div class="emoji-picker-head">
        <strong>表情</strong>
        <input ref="searchInput" v-model="query" type="search" placeholder="搜索表情" aria-label="搜索表情" />
        <button type="button" class="icon-btn" aria-label="关闭表情" @click="close(true)"><X :size="18" /></button>
      </div>
      <div class="emoji-picker-grid">
        <button
          v-for="emoji in filteredEmojis"
          :key="emoji.token"
          type="button"
          :aria-label="emoji.name"
          :title="emoji.name"
          @click="choose(emoji)"
        ><img :src="emoji.src" alt="" width="32" height="32" loading="lazy" draggable="false" /></button>
        <p v-if="!filteredEmojis.length" role="status">没有找到表情</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.emoji-picker { flex: 0 0 auto; }
.emoji-picker-panel {
  position: absolute;
  bottom: calc(100% + 8px);
  right: 0;
  width: min(360px, 100%);
  max-height: min(320px, 45dvh);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--panel);
  box-shadow: 0 8px 28px #0002;
  z-index: 6;
}
.emoji-picker-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.emoji-picker-head strong { flex: 0 0 auto; font-size: 14px; }
.emoji-picker-head input { flex: 1; min-width: 0; width: 100%; padding: 7px 9px; font-size: 14px; }
.emoji-picker-grid {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
  gap: 4px;
}
.emoji-picker-grid button { display: grid; place-items: center; min-height: 44px; padding: 4px; border: 0; border-radius: 6px; background: transparent; }
.emoji-picker-grid button:hover { background: color-mix(in srgb, var(--accent) 12%, var(--panel)); }
.emoji-picker-grid button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.emoji-picker-grid p { grid-column: 1 / -1; text-align: center; color: var(--muted); }
</style>
