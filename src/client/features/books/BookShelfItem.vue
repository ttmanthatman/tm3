<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { Check, Download, LoaderCircle, NotebookPen, Send, Trash2 } from "lucide-vue-next";
import type { BookDTO } from "@shared/types";
import type { BookDownloadState } from "../../books/cache";
import AppMenu from "../../components/AppMenu.vue";
import AppMenuItem from "../../components/AppMenuItem.vue";

const props = defineProps<{ book: BookDTO; coverUrl: string; progress: number; state: BookDownloadState; percent: number; canUseNotes: boolean }>();
const emit = defineEmits<{ open: []; invite: []; download: []; remove: []; notes: [] }>();
const card = ref<HTMLButtonElement | null>(null), menu = ref<HTMLElement | null>(null);
const position = ref<{ left: number; top: number } | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined, origin = { x: 0, y: 0 }, suppressClick = false;
function cancel() { clearTimeout(timer); timer = undefined; }
async function show(x: number, y: number) {
  cancel();
  position.value = { left: Math.max(8, Math.min(x, window.innerWidth - 232)), top: Math.max(8, Math.min(y, window.innerHeight - 272)) };
  await nextTick(); menu.value?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
}
function begin(event: PointerEvent) {
  if (event.button !== 0) return;
  cancel(); suppressClick = false; origin = { x: event.clientX, y: event.clientY };
  timer = setTimeout(() => { suppressClick = true; void show(origin.x, origin.y); }, 520);
}
function move(event: PointerEvent) { if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 10) cancel(); }
function open() { if (suppressClick) { suppressClick = false; return; } emit("open"); }
function close() { position.value = null; card.value?.focus(); }
function choose(action: "invite" | "download" | "remove" | "notes") {
  close();
  if (action === "invite") emit("invite");
  else if (action === "download") emit("download");
  else if (action === "remove") emit("remove");
  else emit("notes");
}
function keyboard(event: KeyboardEvent) {
  if (!position.value) return;
  if (event.key === "Escape" || event.key === "Tab") { if (event.key === "Escape") event.preventDefault(); close(); return; }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const buttons = [...(menu.value?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const index = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
  buttons[index]?.focus();
}
onMounted(() => document.addEventListener("keydown", keyboard));
onBeforeUnmount(() => { cancel(); document.removeEventListener("keydown", keyboard); });
</script>

<template>
  <article class="book-shelf-item" :data-book-id="book.id">
    <button ref="card" class="book-card" type="button" :aria-label="`阅读《${book.title}》`" aria-haspopup="menu" :aria-expanded="!!position"
      @click="open" @pointerdown="begin" @pointermove="move" @pointerup="cancel" @pointercancel="cancel" @pointerleave="cancel"
      @contextmenu.prevent="show($event.clientX, $event.clientY)"
      @keydown="event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); const box = card!.getBoundingClientRect(); show(box.left, box.top + 32); } }">
      <span class="book-cover">
        <img v-if="book.coverName" :src="coverUrl" alt="" loading="lazy" draggable="false" />
        <span v-else class="book-cover-fallback">{{ book.title }}</span>
        <span v-if="progress > .005" class="book-progress"><i :style="{ width: `${Math.round(progress * 100)}%` }" /></span>
        <span class="book-download-badge" :class="{ error: state === 'error', ready: state === 'ready' }" :aria-label="state === 'ready' ? '已下载' : state === 'downloading' ? `已下载 ${percent}%` : '未下载'">
          <LoaderCircle v-if="state === 'checking'" class="book-spin" :size="18" />
          <span v-else-if="state === 'downloading'" class="book-download-percent">{{ percent }}%</span>
          <Check v-else-if="state === 'ready'" :size="18" /><Download v-else :size="18" />
        </span>
      </span>
      <span class="book-card-title">{{ book.title }}</span><span class="book-card-author">{{ book.author || '佚名' }}</span>
    </button>
    <Teleport to="body">
      <div v-if="position" class="book-shelf-menu-backdrop" @click.self="close" @contextmenu.prevent.self="close">
        <div ref="menu" class="book-shelf-menu" :style="{ left: `${position.left}px`, top: `${position.top}px` }">
          <AppMenu :label="`《${book.title}》操作`">
            <p class="book-menu-title">{{ book.title }}</p>
            <AppMenuItem :disabled="!canUseNotes" @click="choose('invite')"><Send :size="18" />邀请共读</AppMenuItem>
            <AppMenuItem :disabled="state === 'ready' || state === 'downloading' || state === 'checking'" @click="choose('download')"><Download :size="18" />{{ state === 'ready' ? '已下载' : state === 'downloading' ? `下载中 ${percent}%` : '下载' }}</AppMenuItem>
            <AppMenuItem :disabled="state !== 'ready'" @click="choose('remove')"><Trash2 :size="18" />本地删除</AppMenuItem>
            <AppMenuItem :disabled="!canUseNotes" @click="choose('notes')"><NotebookPen :size="18" />查看笔记</AppMenuItem>
          </AppMenu>
        </div>
      </div>
    </Teleport>
  </article>
</template>

<style scoped>
.book-shelf-item { min-width: 0; }
.book-card { width: 100%; border: 0; background: none; padding: 0; text-align: left; cursor: pointer; font: inherit; color: inherit; user-select: none; -webkit-touch-callout: none; }
.book-cover { display: block; position: relative; aspect-ratio: 2 / 3; overflow: hidden; border-radius: 7px; background: #e7decc; box-shadow: 0 2px 8px #0002; }
.book-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.book-cover-fallback { display: grid; place-items: center; height: 100%; padding: 10px; font-size: 14px; color: #77644c; text-align: center; }
.book-download-badge { position: absolute; right: 8px; bottom: 8px; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; background: #29251ed9; color: #fff; border: 1px solid #fff9; box-shadow: 0 2px 5px #0004; }
.book-download-badge.ready { background: #4c6239e6; }
.book-download-badge.error { background: #992d2de6; }
.book-download-percent { font-size: 10px; font-weight: 800; font-variant-numeric: tabular-nums; }
.book-progress { position: absolute; left: 0; right: 0; bottom: 0; height: 4px; background: #ffffff73; }
.book-progress > i { display: block; height: 100%; background: #e0862a; }
.book-card-title { display: -webkit-box; margin-top: 8px; font-size: 13.5px; font-weight: 700; line-height: 1.3; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.book-card-author { display: block; margin-top: 2px; font-size: 11.5px; color: #97836a; }
.book-spin { animation: book-spin 1s linear infinite; } @keyframes book-spin { to { transform: rotate(360deg); } }
.book-shelf-menu-backdrop { position: fixed; inset: 0; z-index: 2100; }
.book-shelf-menu { position: absolute; width: 224px; max-width: calc(100vw - 16px); max-height: calc(100dvh - 16px); overflow-y: auto; }
.book-menu-title { margin: 4px 10px 6px; max-height: 42px; overflow: hidden; font-size: 13px; color: var(--muted); }
.book-shelf-menu :deep(.app-menu-item) { min-height: 44px; }
</style>
