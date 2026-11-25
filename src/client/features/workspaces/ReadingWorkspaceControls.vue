<script setup lang="ts">
import { computed, onBeforeUnmount } from "vue";
import { LayoutGrid, Maximize2, Minimize2, X } from "lucide-vue-next";
import { READING_ARRANGEMENTS, READING_PANELS, type ReadingArrangement, type ReadingPanel } from "./useReadingWorkspaceLayout";
const props = defineProps<{
  panels: ReadingPanel[]; selected: ReadingPanel | null; arrangement: ReadingArrangement;
  multiple: boolean; fourPanelAvailable: boolean; width: number; height: number; column: number; row: number;
}>();
const emit = defineEmits<{
  fourPanels: []; open: [panel: ReadingPanel]; close: [panel: ReadingPanel]; focus: [panel: ReadingPanel];
  fullscreen: [panel: ReadingPanel]; arrangement: [value: ReadingArrangement]; resize: [axis: "column" | "row", ratio: number];
}>();
const threeColumns = computed(() => props.arrangement === "grid" && props.panels.length === 3);
const dividerColumn = computed(() => threeColumns.value ? props.column * 2 / 3 : props.column);
const vertical = computed(() => props.multiple && props.arrangement !== "rows");
const horizontal = computed(() => props.multiple && (props.arrangement === "rows" || (props.arrangement === "grid" && props.panels.length === 4)));
let drag: { axis: "column" | "row"; pointerId: number; element: HTMLElement } | null = null;
function move(event: PointerEvent) {
  if (!drag || drag.pointerId !== event.pointerId) return;
  const bounds = drag.element.parentElement!.getBoundingClientRect();
  const ratio = drag.axis === "column" ? (event.clientX - bounds.left) / props.width : (event.clientY - bounds.top - 38) / (props.height - 38);
  emit("resize", drag.axis, drag.axis === "column" && threeColumns.value ? ratio * 1.5 : ratio);
}
function stop() {
  if (drag?.element.hasPointerCapture(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId);
  drag = null;
}
function start(event: PointerEvent, axis: "column" | "row") {
  if (event.button !== 0) return;
  const element = event.currentTarget as HTMLElement;
  drag = { axis, pointerId: event.pointerId, element };
  element.setPointerCapture(event.pointerId);
}
function key(event: KeyboardEvent, axis: "column" | "row") {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Enter"].includes(event.key)) return;
  event.preventDefault();
  const current = axis === "column" ? props.column : props.row;
  const next = event.key === "Enter" ? .5 : event.key === "Home" ? .2 : event.key === "End" ? .8
    : current + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -.02 : .02);
  emit("resize", axis, next);
}
onBeforeUnmount(stop);
</script>
<template>
  <nav class="reading-toolbar" aria-label="阅读面板">
    <div v-for="panel in READING_PANELS" :key="panel.id" class="reading-tab" :class="{ selected: selected === panel.id }">
      <button type="button" :aria-pressed="panels.includes(panel.id)" :aria-label="`打开${panel.label}面板`" @click="panels.includes(panel.id) ? emit('focus', panel.id) : emit('open', panel.id)">{{ panel.label }}</button>
      <template v-if="panels.includes(panel.id)">
        <button type="button" :aria-label="`${selected === panel.id ? '恢复' : '全屏'}${panel.label}面板`" @click="emit('fullscreen', panel.id)"><Minimize2 v-if="selected === panel.id" :size="13" /><Maximize2 v-else :size="13" /></button>
        <button type="button" :aria-label="`关闭${panel.label}面板`" @click="emit('close', panel.id)"><X :size="13" /></button>
      </template>
    </div>
    <button v-if="fourPanelAvailable && panels.length < 4" class="four-panels-btn" type="button" @click="emit('fourPanels')">
      <LayoutGrid :size="14" /> 四分屏
    </button>
    <select :value="arrangement" aria-label="面板排列方式" @change="emit('arrangement', ($event.target as HTMLSelectElement).value as ReadingArrangement)">
      <option v-for="item in READING_ARRANGEMENTS" :key="item.id" :value="item.id">{{ item.label }}</option>
    </select>
  </nav>
  <div v-if="vertical" class="reading-divider vertical" role="separator" tabindex="0" aria-label="调整面板左右比例" aria-orientation="vertical" :aria-valuenow="Math.round(column * 100)" aria-valuemin="20" aria-valuemax="80"
    :style="{ left: `${width * dividerColumn}px`, top: '38px', height: `${height - 38}px` }"
    @pointerdown="start($event, 'column')" @pointermove="move" @pointerup="stop" @pointercancel="stop" @lostpointercapture="stop" @keydown="key($event, 'column')" @dblclick="emit('resize', 'column', .5)"></div>
  <div v-if="horizontal" class="reading-divider horizontal" role="separator" tabindex="0" aria-label="调整面板上下比例" aria-orientation="horizontal" :aria-valuenow="Math.round(row * 100)" aria-valuemin="20" aria-valuemax="80"
    :style="{ top: `${38 + (height - 38) * row}px`, left: arrangement === 'grid' && panels.length === 3 ? `${width * column}px` : '0px' }"
    @pointerdown="start($event, 'row')" @pointermove="move" @pointerup="stop" @pointercancel="stop" @lostpointercapture="stop" @keydown="key($event, 'row')" @dblclick="emit('resize', 'row', .5)"></div>
</template>
<style scoped>
.reading-toolbar { position: absolute; inset: 0 0 auto; height: 38px; z-index: 4; display: flex; align-items: center; gap: 5px; padding: 3px 6px; background: #faf7f0; border-bottom: 1px solid #d9d1c4; color: #6d573d; overflow-x: auto; }
.reading-tab { display: flex; align-items: center; flex-shrink: 0; border-radius: 5px; }
.reading-tab:has([aria-pressed=true]) { background: #ece5d8; }
.reading-tab.selected { box-shadow: inset 0 0 0 1px #a87a45; }
.reading-tab button { min-height: 28px; padding: 0 5px; border: 0; display: inline-flex; align-items: center; background: transparent; color: inherit; cursor: pointer; font: inherit; font-size: 12px; white-space: nowrap; }
.four-panels-btn { display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; min-height: 28px; padding: 0 6px; border: 1px solid #d9d1c4; border-radius: 5px; background: #fffdf6; color: inherit; font: inherit; font-size: 12px; cursor: pointer; }
.reading-toolbar select { margin-left: auto; min-height: 28px; width: 92px; flex-shrink: 0; border: 1px solid #d9d1c4; border-radius: 5px; background: #fffdf6; color: inherit; font: inherit; font-size: 12px; }
.reading-divider { position: absolute; z-index: 6; touch-action: none; }
.reading-divider::after { content: ''; position: absolute; background: #b6ab97; }
.vertical { width: 7px; transform: translateX(-50%); cursor: col-resize; }
.vertical::after { top: 0; bottom: 0; left: 3px; width: 1px; }
.horizontal { left: 0; right: 0; height: 7px; transform: translateY(-50%); cursor: row-resize; }
.horizontal::after { left: 0; right: 0; top: 3px; height: 1px; }
.reading-divider:focus-visible { outline: 2px solid #a87a45; }
.reading-tab button:focus-visible { outline: 2px solid #a87a45; outline-offset: -2px; }
</style>
