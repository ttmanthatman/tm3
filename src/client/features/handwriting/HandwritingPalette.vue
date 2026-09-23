<script setup lang="ts">
import { Check, Palette } from "lucide-vue-next";
import { ref } from "vue";
import {
  HANDWRITING_CUSTOM_COLOR_INDEX,
  HANDWRITING_PRESET_LABELS,
  type HandwritingColor
} from "@shared/handwriting";

const props = defineProps<{
  colors: HandwritingColor[];
  customColor: HandwritingColor;
  selectedIndex: number;
  paperEnabled: boolean;
  paperColor: HandwritingColor;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  select: [index: number];
  "slot-change": [index: number, color: HandwritingColor];
  "custom-change": [color: HandwritingColor];
  "paper-change": [enabled: boolean, color: HandwritingColor];
}>();

const slotColorInput = ref<HTMLInputElement | null>(null);
const customColorInput = ref<HTMLInputElement | null>(null);
const editingSlot = ref(-1);
let longPressTimer = 0;
let longPressTriggered = false;

function revealColorPicker(input: HTMLInputElement) {
  try {
    if (input.showPicker) input.showPicker();
    else input.click();
  } catch {
    input.click();
  }
}

function openSlotPicker(index: number) {
  if (props.disabled) return;
  editingSlot.value = index;
  const input = slotColorInput.value;
  if (!input) return;
  input.value = props.colors[index];
  revealColorPicker(input);
}

function openCustomPicker() {
  if (props.disabled) return;
  const input = customColorInput.value;
  if (!input) return;
  input.value = props.customColor;
  revealColorPicker(input);
}

function beginLongPress(index: number) {
  if (props.disabled) return;
  cancelLongPress();
  longPressTriggered = false;
  longPressTimer = window.setTimeout(() => {
    longPressTriggered = true;
    openSlotPicker(index);
  }, 450);
}

function cancelLongPress() {
  if (longPressTimer) window.clearTimeout(longPressTimer);
  longPressTimer = 0;
}

function finishLongPress() {
  cancelLongPress();
  window.setTimeout(() => { longPressTriggered = false; }, 300);
}

function selectSlot(index: number) {
  if (props.disabled || longPressTriggered) return;
  emit("select", index);
}

function handleSlotColor(event: Event) {
  const value = (event.target as HTMLInputElement).value;
  if (editingSlot.value < 0) return;
  emit("slot-change", editingSlot.value, value.toLowerCase() as HandwritingColor);
  emit("select", editingSlot.value);
}

function handleCustomColor(event: Event) {
  const value = (event.target as HTMLInputElement).value.toLowerCase() as HandwritingColor;
  emit("custom-change", value);
  emit("select", HANDWRITING_CUSTOM_COLOR_INDEX);
}

function handlePaperColor(event: Event) {
  const value = (event.target as HTMLInputElement).value.toLowerCase() as HandwritingColor;
  emit("paper-change", props.paperEnabled, value);
}
</script>

<template>
  <div class="handwriting-palette-panel">
    <div class="handwriting-palette-heading">
      <span>笔画颜色</span>
      <small>小秘密：长按调出调色盘</small>
    </div>
    <div class="handwriting-palette" role="group" aria-label="笔画颜色">
      <button
        v-for="(color, index) in colors"
        :key="index"
        type="button"
        class="handwriting-color"
        :class="{ selected: selectedIndex === index }"
        :style="{ '--swatch-color': color }"
        :aria-label="`选择${HANDWRITING_PRESET_LABELS[index]}`"
        :aria-pressed="selectedIndex === index"
        :title="`${HANDWRITING_PRESET_LABELS[index]}（长按可换色）`"
        :disabled="disabled"
        @pointerdown="beginLongPress(index)"
        @pointerup="finishLongPress"
        @pointercancel="finishLongPress"
        @pointerleave="finishLongPress"
        @contextmenu.prevent="openSlotPicker(index)"
        @click="selectSlot(index)"
      ><Check v-if="selectedIndex === index" :size="14" /></button>
      <button
        type="button"
        class="handwriting-color handwriting-custom-color"
        :class="{ selected: selectedIndex === HANDWRITING_CUSTOM_COLOR_INDEX }"
        :style="{ '--swatch-color': customColor }"
        aria-label="自定义颜色"
        :aria-pressed="selectedIndex === HANDWRITING_CUSTOM_COLOR_INDEX"
        title="选择自定义颜色"
        :disabled="disabled"
        @click="openCustomPicker"
      >
        <Palette :size="16" />
        <Check v-if="selectedIndex === HANDWRITING_CUSTOM_COLOR_INDEX" class="custom-check" :size="11" />
      </button>
    </div>
    <input
      ref="slotColorInput"
      class="handwriting-color-input"
      type="color"
      :value="editingSlot >= 0 ? colors[editingSlot] : colors[Math.min(selectedIndex, colors.length - 1)]"
      aria-label="替换颜色按钮"
      @input="handleSlotColor"
    />
    <input
      ref="customColorInput"
      class="handwriting-color-input"
      type="color"
      :value="customColor"
      aria-label="自定义笔画颜色"
      @input="handleCustomColor"
    />
    <div class="handwriting-paper-options">
      <label class="handwriting-paper-toggle">
        <input
          type="checkbox"
          :checked="paperEnabled"
          :disabled="disabled"
          @change="emit('paper-change', ($event.target as HTMLInputElement).checked, paperColor)"
        />
        <span>显示纸张</span>
      </label>
      <label v-if="paperEnabled" class="handwriting-paper-color">
        <span>纸张颜色</span>
        <input
          type="color"
          :value="paperColor"
          :disabled="disabled"
          aria-label="纸张颜色"
          @input="handlePaperColor"
        />
      </label>
    </div>
  </div>
</template>

<style scoped>
.handwriting-palette-panel {
  display: grid;
  gap: 8px;
}

.handwriting-palette-heading {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 8px;
  color: #526259;
  font-size: 12px;
}

.handwriting-palette-heading small {
  color: #8a6d45;
  font-size: 11px;
}

.handwriting-palette {
  display: grid;
  grid-template-columns: repeat(8, 30px);
  justify-content: center;
  gap: 7px;
}

.handwriting-color {
  --swatch-color: #263b33;
  position: relative;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 3px solid #fff;
  border-radius: 50%;
  background: var(--swatch-color);
  color: #fff;
  display: grid;
  place-items: center;
  box-shadow: 0 0 0 1px #cfd8cf;
  touch-action: manipulation;
}

.handwriting-color.selected {
  box-shadow: 0 0 0 2px #355c48;
}

.handwriting-custom-color {
  background:
    linear-gradient(135deg, #ff4d6d 0 20%, #ff8a3d 20% 40%, #f4c430 40% 60%, #24b86a 60% 80%, #268cff 80%);
  color: #fff;
  text-shadow: 0 1px 2px #3336;
}

.handwriting-custom-color .custom-check {
  position: absolute;
  right: -3px;
  bottom: -3px;
  border-radius: 50%;
  background: #355c48;
}

.handwriting-color-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.handwriting-paper-options {
  min-height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  color: #526259;
  font-size: 12px;
}

.handwriting-paper-toggle,
.handwriting-paper-color {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.handwriting-paper-toggle input {
  accent-color: #355c48;
}

.handwriting-paper-color input {
  width: 34px;
  height: 24px;
  padding: 1px;
  border: 1px solid #d7e0d5;
  border-radius: 6px;
  background: #fff;
}

@media (max-width: 370px) {
  .handwriting-palette { gap: 5px; }
  .handwriting-palette-heading { flex-direction: column; align-items: center; gap: 2px; }
}
</style>
