<script setup lang="ts">
import { nextTick, onMounted, onBeforeUnmount, ref } from "vue";
import { BookOpen, Library } from "lucide-vue-next";
import AppMenu from "../../components/AppMenu.vue";
import AppMenuItem from "../../components/AppMenuItem.vue";

const props = defineProps<{ openShelf: () => void; openStudy: () => void; studyActive: boolean }>();
const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const open = ref(false);

const items = () => [...(root.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
function close(focus = false) {
  open.value = false;
  if (focus) trigger.value?.focus({ preventScroll: true });
}
async function show(last = false) {
  open.value = true;
  await nextTick();
  items().at(last ? -1 : 0)?.focus();
}
function select(action: () => void) {
  close(true);
  action();
}
function navigate(event: KeyboardEvent) {
  if (!open.value) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    close(true);
    return;
  }
  if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  const buttons = items();
  const current = buttons.findIndex(button => button === document.activeElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
    : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next]?.focus();
}
function outside(event: PointerEvent | FocusEvent) {
  const target = event instanceof FocusEvent ? event.relatedTarget : event.target;
  if (target instanceof Node && !root.value?.contains(target)) close();
}
onMounted(() => document.addEventListener("pointerdown", outside));
onBeforeUnmount(() => document.removeEventListener("pointerdown", outside));
</script>

<template>
  <div ref="root" class="book-header-menu" @keydown="navigate" @focusout="outside">
    <button
      ref="trigger" class="icon-btn book-header-trigger" type="button" aria-label="打开图书室" title="图书室"
      aria-haspopup="menu" :aria-expanded="open" :class="{ active: open }"
      @click.stop="open ? close() : show()" @keydown.down.stop.prevent="show()" @keydown.up.stop.prevent="show(true)"
    ><Library :size="20" /></button>
    <AppMenu v-if="open" class="book-header-options" label="图书室" @click.stop>
      <AppMenuItem @click="select(props.openShelf)"><Library :size="17" /><span>书架</span></AppMenuItem>
      <AppMenuItem :active="studyActive" @click="select(props.openStudy)"><BookOpen :size="17" /><span>查经</span></AppMenuItem>
    </AppMenu>
  </div>
</template>
<style scoped>
.book-header-menu { position: relative; flex: 0 0 auto; }
.book-header-options { position: absolute; top: calc(100% + 6px); right: 0; z-index: 44; width: 132px; }
</style>
