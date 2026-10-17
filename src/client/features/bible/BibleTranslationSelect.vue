<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId } from "vue";
import { Check, ChevronDown } from "lucide-vue-next";
import type { BibleCatalogDTO } from "@shared/types";
import AppMenu from "../../components/AppMenu.vue";
import AppMenuItem from "../../components/AppMenuItem.vue";
const props = defineProps<{ modelValue: string; translations: BibleCatalogDTO["translations"]; label: string }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
const menuOpen = ref(false), root = ref<HTMLElement | null>(null), trigger = ref<HTMLButtonElement | null>(null);
const menuId = useId();
const selectedName = computed(() => props.translations.find(item => item.id === props.modelValue)?.shortName || "选择译本");
function close(focus = false) { menuOpen.value = false; if (focus) trigger.value?.focus(); }
function select(id: string) { emit("update:modelValue", id); close(true); }
function outside(event: PointerEvent) {
  if (event.target instanceof Node && !root.value?.contains(event.target)) close();
}
function escape(event: KeyboardEvent) {
  if (event.key !== "Escape" || !menuOpen.value) return;
  event.preventDefault(); event.stopPropagation(); close(true);
}
async function move(event: KeyboardEvent) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault(); menuOpen.value = true;
  await nextTick();
  const items = Array.from(root.value?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') || []);
  if (!items.length) return;
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  const index = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current < 0 ? (event.key === "ArrowUp" ? items.length - 1 : 0) : (current + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length);
  items[index].focus();
}
onMounted(() => {
  document.addEventListener("pointerdown", outside);
  document.addEventListener("keydown", escape, true);
});
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", outside);
  document.removeEventListener("keydown", escape, true);
});
</script>
<template>
  <span ref="root" class="bible-translation-select" @keydown="move">
    <button ref="trigger" type="button" class="bible-translation-trigger" :aria-label="label" aria-haspopup="menu" :aria-expanded="menuOpen" :aria-controls="menuId" @click="menuOpen = !menuOpen">
      <span>{{ selectedName }}</span><ChevronDown :size="14" aria-hidden="true" />
    </button>
    <AppMenu v-if="menuOpen" :id="menuId" class="bible-translation-menu" :label="label">
      <AppMenuItem v-for="translation in translations" :key="translation.id" role="menuitemradio" :aria-checked="modelValue === translation.id" :active="modelValue === translation.id" @click="select(translation.id)">
        <Check :size="16" :style="{ visibility: modelValue === translation.id ? 'visible' : 'hidden' }" aria-hidden="true" /><span>{{ translation.shortName }}</span>
      </AppMenuItem>
    </AppMenu>
  </span>
</template>
<style scoped>
.bible-translation-select { position: relative; display: inline-flex; min-width: 0; max-width: 100%; color: #725537; font: inherit; font-size: 13px; font-weight: 600; line-height: 1.4; --panel: #f3ecde; --line: #cdbb9f; --text: #604b32; --accent: #80613f; --accent-dark: #654a31; --button-text: #fffaf1; }
.bible-translation-trigger { display: inline-flex; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; max-width: 100%; min-height: 34px; padding: 6px 10px; border: 1px solid #d9cbb8; border-radius: 8px; color: inherit; background: #f3ecde; font: inherit; cursor: pointer; }
.bible-translation-trigger:focus-visible { outline: 2px solid #967046; outline-offset: 2px; }
.bible-translation-menu { position: absolute; z-index: 60; top: calc(100% + 6px); left: 0; width: 160px; max-width: calc(100vw - 24px); }
</style>
