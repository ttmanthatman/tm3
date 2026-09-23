<script setup lang="ts">
import { Check, Palette, X } from "lucide-vue-next";
import { computed, nextTick, ref } from "vue";
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
  glowEnabled: boolean;
  glowColor: HandwritingColor;
  glowDensity: number;
  glowWidth: number;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  select: [index: number];
  "slot-change": [index: number, color: HandwritingColor];
  "custom-change": [color: HandwritingColor];
  "paper-change": [enabled: boolean, color: HandwritingColor];
  "glow-change": [enabled: boolean, color: HandwritingColor, density: number, width: number];
}>();

const pickerInput = ref<HTMLInputElement | null>(null);
const editingSlot = ref(-1);
const pickerOpen = ref(false);
let longPressTimer = 0;
let longPressTriggered = false;
const pickerColor = computed<HandwritingColor>(() => {
  if (editingSlot.value === HANDWRITING_CUSTOM_COLOR_INDEX) return props.customColor;
  return props.colors[editingSlot.value] || props.customColor;
});

function openPicker(index: number) {
  if (props.disabled) return;
  editingSlot.value = index;
  pickerOpen.value = true;
  void nextTick(() => pickerInput.value?.focus());
}

function closePicker() {
  pickerOpen.value = false;
  editingSlot.value = -1;
}

function beginLongPress(index: number) {
  if (props.disabled) return;
  cancelLongPress();
  longPressTriggered = false;
  longPressTimer = window.setTimeout(() => {
    longPressTriggered = true;
    openPicker(index);
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

function handlePickerColor(event: Event) {
  const value = (event.target as HTMLInputElement).value.toLowerCase() as HandwritingColor;
  if (editingSlot.value === HANDWRITING_CUSTOM_COLOR_INDEX) {
    emit("custom-change", value);
    emit("select", HANDWRITING_CUSTOM_COLOR_INDEX);
  } else if (editingSlot.value >= 0) {
    emit("slot-change", editingSlot.value, value);
    emit("select", editingSlot.value);
  }
  closePicker();
}

function handlePaperColor(event: Event) {
  const value = (event.target as HTMLInputElement).value.toLowerCase() as HandwritingColor;
  emit("paper-change", props.paperEnabled, value);
}

function handleGlowColor(event: Event) {
  const value = (event.target as HTMLInputElement).value.toLowerCase() as HandwritingColor;
  emit("glow-change", props.glowEnabled, value, props.glowDensity, props.glowWidth);
}

function handleGlowAmount(kind: "density" | "width", event: Event) {
  const value = Math.max(0, Math.min(100, Number((event.target as HTMLInputElement).value)));
  emit(
    "glow-change",
    props.glowEnabled,
    props.glowColor,
    kind === "density" ? value : props.glowDensity,
    kind === "width" ? value : props.glowWidth
  );
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
        @contextmenu.prevent="openPicker(index)"
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
        @click="openPicker(HANDWRITING_CUSTOM_COLOR_INDEX)"
      >
        <Palette :size="16" />
        <Check v-if="selectedIndex === HANDWRITING_CUSTOM_COLOR_INDEX" class="custom-check" :size="11" />
      </button>
    </div>
    <div v-if="pickerOpen" class="handwriting-picker" role="dialog" aria-label="调色盘">
      <header>
        <strong>调色盘</strong>
        <button type="button" aria-label="关闭调色盘" @click="closePicker"><X :size="15" /></button>
      </header>
      <label>
        <input
          ref="pickerInput"
          type="color"
          :value="pickerColor"
          aria-label="调色盘颜色"
          @input="handlePickerColor"
        />
        <span>点按选择颜色</span>
      </label>
    </div>
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
    <div class="handwriting-glow-options" :class="{ enabled: glowEnabled }">
      <label class="handwriting-glow-toggle">
        <input
          type="checkbox"
          :checked="glowEnabled"
          :disabled="disabled"
          aria-label="光晕"
          @change="emit('glow-change', ($event.target as HTMLInputElement).checked, glowColor, glowDensity, glowWidth)"
        />
        <span>光晕</span>
      </label>
      <template v-if="glowEnabled">
        <label class="handwriting-glow-color">
          <span>光晕颜色</span>
          <input
            type="color"
            :value="glowColor"
            :disabled="disabled"
            aria-label="光晕颜色"
            @input="handleGlowColor"
          />
        </label>
        <label class="handwriting-glow-range">
          <span>光晕密度</span>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            :value="glowDensity"
            :disabled="disabled"
            aria-label="光晕密度"
            @input="handleGlowAmount('density', $event)"
          />
          <output aria-label="光晕密度数值">{{ glowDensity }}</output>
        </label>
        <label class="handwriting-glow-range">
          <span>光晕宽度</span>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            :value="glowWidth"
            :disabled="disabled"
            aria-label="光晕宽度"
            @input="handleGlowAmount('width', $event)"
          />
          <output aria-label="光晕宽度数值">{{ glowWidth }}</output>
        </label>
      </template>
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

.handwriting-picker {
  display: grid;
  gap: 8px;
  width: min(220px, 100%);
  margin-inline: auto;
  padding: 10px 12px;
  border: 1px solid #d7e0d5;
  border-radius: 10px;
  background: #f8faf7;
  box-shadow: 0 8px 24px #1731261c;
}

.handwriting-picker header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #355c48;
  font-size: 12px;
}

.handwriting-picker header button {
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: #65756a;
  display: grid;
  place-items: center;
}

.handwriting-picker label {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: #65756a;
  font-size: 12px;
  cursor: pointer;
}

.handwriting-picker input[type="color"] {
  width: 52px;
  height: 42px;
  padding: 3px;
  border: 1px solid #cfd8cf;
  border-radius: 9px;
  background: #fff;
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

.handwriting-glow-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 12px;
  padding: 9px 10px;
  border: 1px solid #d7e0d5;
  border-radius: 10px;
  background: #f8faf7;
  color: #526259;
  font-size: 12px;
}

.handwriting-glow-options.enabled {
  border-color: #b9cbbd;
}

.handwriting-glow-toggle,
.handwriting-glow-color,
.handwriting-glow-range {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.handwriting-glow-toggle {
  grid-column: 1 / -1;
  color: #355c48;
  font-weight: 600;
}

.handwriting-glow-color input[type="color"] {
  width: 38px;
  height: 28px;
  padding: 2px;
  border: 1px solid #cfd8cf;
  border-radius: 7px;
  background: #fff;
}

.handwriting-glow-range {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) 24px;
}

.handwriting-glow-range input[type="range"] {
  width: 100%;
  accent-color: #47705a;
}

.handwriting-glow-range output {
  color: #65756a;
  text-align: right;
  font-variant-numeric: tabular-nums;
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
