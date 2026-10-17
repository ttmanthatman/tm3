<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { ChevronDown, Trash2 } from "lucide-vue-next";
import type { BibleSearchHistoryDTO } from "@shared/types";
defineProps<{ id: string; entries: BibleSearchHistoryDTO[]; error: string }>();
const emit = defineEmits<{ select: [entry: BibleSearchHistoryDTO]; clear: []; retry: [] }>();
const historyOpen = ref(false);
const root = ref<HTMLElement | null>(null), trigger = ref<HTMLButtonElement | null>(null);
function closeFromOutside(event: PointerEvent) {
  if (event.target instanceof Node && !root.value?.contains(event.target)) historyOpen.value = false;
}
function closeFromEscape(event: KeyboardEvent) {
  if (event.key !== "Escape" || !historyOpen.value) return;
  event.preventDefault(); event.stopPropagation(); historyOpen.value = false; trigger.value?.focus();
}
function select(entry: BibleSearchHistoryDTO) { historyOpen.value = false; emit("select", entry); }
onMounted(() => {
  document.addEventListener("pointerdown", closeFromOutside);
  document.addEventListener("keydown", closeFromEscape, true);
});
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", closeFromOutside);
  document.removeEventListener("keydown", closeFromEscape, true);
});
</script>
<template>
  <div ref="root" class="bible-search-history-control">
    <button ref="trigger" class="bible-history-trigger" type="button" aria-label="搜索历史" :aria-expanded="historyOpen" :aria-controls="id" @click="historyOpen = !historyOpen"><ChevronDown :size="16" /></button>
    <section v-if="historyOpen" :id="id" class="bible-search-history" aria-label="经文搜索历史">
      <header><strong>搜索历史</strong><button type="button" :disabled="!entries.length" @click="emit('clear')"><Trash2 :size="14" />清空</button></header>
      <p v-if="error" role="alert">{{ error }} <button type="button" @click="emit('retry')">重试同步</button></p>
      <div v-if="entries.length" class="bible-history-list">
        <button v-for="entry in entries" :key="`${entry.kind}:${entry.translation}:${entry.query}`" type="button" @click="select(entry)">
          <span>{{ entry.kind === 'topic' ? 'AI主题' : '原文' }}</span><strong>{{ entry.query }}</strong><small>{{ entry.count }} {{ entry.kind === 'topic' ? '处' : '节' }}</small>
        </button>
      </div>
      <p v-else>还没有搜索历史</p>
    </section>
  </div>
</template>
<style scoped>
.bible-search-history-control { display: contents; }
button { font: inherit; cursor: pointer; color: #725537; }
.bible-history-trigger { position: absolute; right: 0; top: 0; width: 40px; height: 48px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 0 11px 11px 0; background: transparent; }
.bible-history-trigger:hover, .bible-history-trigger[aria-expanded=true] { background: #e5d7c255; }
.bible-history-trigger[aria-expanded=true] svg { transform: rotate(180deg); }
button:focus-visible { outline: 2px solid #967046; outline-offset: 2px; }
.bible-search-history { position: absolute; z-index: 10; left: 0; right: 0; top: calc(100% + 6px); max-height: min(320px, 45dvh); overflow-y: auto; padding: 10px; border: 1px solid #cdbb9f; border-radius: 11px; color: #604b32; background: #e9dfcf; box-shadow: 0 10px 24px #4b33192b; font: inherit; font-size: 13px; line-height: 1.5; }
header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 0 2px 8px; }
header button, p button { display: inline-flex; align-items: center; gap: 4px; min-height: 28px; border: 0; background: transparent; }
button:disabled { opacity: .45; cursor: default; }
p { margin: 0; padding: 8px 2px; }
[role=alert] { color: #a4382c; }
.bible-history-list { display: grid; gap: 4px; }
.bible-history-list > button { min-width: 0; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 8px; min-height: 42px; padding: 8px; border: 0; border-radius: 7px; background: transparent; text-align: left; }
.bible-history-list > button:hover { background: #eee2cf; }
span, small { color: #92775b; font-size: 11px; }
strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
