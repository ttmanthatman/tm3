<script setup lang="ts">
import { computed, ref } from "vue";
import { Minus, Plus } from "lucide-vue-next";
import type { SermonDisplayDTO, SermonFontFamily } from "@shared/types";

// 讲道台显示设置控件组：移动端演示视图底栏与桌面端双栏左列共用，
// 所有改动以 sermon:display 部分补丁形式上抛。
const props = defineProps<{ display: SermonDisplayDTO }>();
const emit = defineEmits<{ update: [patch: Partial<SermonDisplayDTO>] }>();

const SERMON_FONT_SCALE_MIN = 0.7;
const SERMON_FONT_SCALE_MAX = 1.6;
const SERMON_MARGIN_MIN = 2;
const SERMON_MARGIN_MAX = 20;

const SERMON_FONT_OPTIONS: Array<{ value: SermonFontFamily; label: string }> = [
  { value: "puhuiti", label: "阿里巴巴普惠体" },
  { value: "songti", label: "宋体" },
  { value: "system", label: "系统黑体" }
];

const SERMON_BG_PRESETS: Array<{ value: string; label: string; chip: string }> = [
  { value: "gradient", label: "渐变", chip: "linear-gradient(160deg, #0a0f22, #2a1e3a)" },
  { value: "dark", label: "深蓝", chip: "#0f172a" },
  { value: "light", label: "浅白", chip: "#fafaf7" },
  { value: "sepia", label: "米色", chip: "#f3ead7" },
  { value: "midnight", label: "纯黑", chip: "#000000" }
];

const fontScale = computed(() => props.display.fontScale);
// 边距滑块拖动中先在本地显示实时百分比，松手（change）后才提交。
const marginDraft = ref<number | null>(null);
const marginShown = computed(() => marginDraft.value ?? props.display.marginPct);
const customBackground = computed(() => (props.display.background.startsWith("#") ? props.display.background : "#0f172a"));

function adjustFont(direction: -1 | 1) {
  const next = Math.round((fontScale.value + direction * 0.1) * 10) / 10;
  if (next < SERMON_FONT_SCALE_MIN - 1e-9 || next > SERMON_FONT_SCALE_MAX + 1e-9) return;
  emit("update", { fontScale: next });
}

function onMarginInput(event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  if (Number.isFinite(value)) marginDraft.value = value;
}

function onMarginChange(event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  marginDraft.value = null;
  if (Number.isFinite(value) && value !== props.display.marginPct) emit("update", { marginPct: value });
}

function onCustomBackground(event: Event) {
  const value = (event.target as HTMLInputElement).value;
  if (/^#[0-9a-fA-F]{6}$/.test(value)) emit("update", { background: value });
}
</script>

<template>
  <div class="sermon-display-settings">
    <div class="sermon-font-picker" role="group" aria-label="经文字体">
      <button
        v-for="option in SERMON_FONT_OPTIONS"
        :key="option.value"
        type="button"
        :class="{ active: display.fontFamily === option.value }"
        :aria-pressed="display.fontFamily === option.value"
        @click="emit('update', { fontFamily: option.value })"
      >{{ option.label }}</button>
    </div>
    <div class="sermon-font-stepper" role="group" :aria-label="`经文字体倍率，当前 ${fontScale.toFixed(1)} 倍`">
      <button type="button" :disabled="fontScale <= SERMON_FONT_SCALE_MIN" aria-label="减小字体" @click="adjustFont(-1)"><Minus :size="15" /></button>
      <span aria-live="polite">{{ fontScale.toFixed(1) }}×</span>
      <button type="button" :disabled="fontScale >= SERMON_FONT_SCALE_MAX" aria-label="增大字体" @click="adjustFont(1)"><Plus :size="15" /></button>
    </div>
    <label class="sermon-margin-slider">
      <span>边距</span>
      <input
        type="range"
        :min="SERMON_MARGIN_MIN"
        :max="SERMON_MARGIN_MAX"
        step="1"
        :value="marginShown"
        aria-label="版心边距"
        @input="onMarginInput"
        @change="onMarginChange"
      />
      <span aria-live="polite">{{ marginShown }}%</span>
    </label>
    <div class="sermon-bg-picker" role="group" aria-label="背景">
      <button
        v-for="preset in SERMON_BG_PRESETS"
        :key="preset.value"
        type="button"
        class="sermon-bg-swatch"
        :class="{ active: display.background === preset.value }"
        :style="{ background: preset.chip }"
        :aria-label="preset.label"
        :aria-pressed="display.background === preset.value"
        @click="emit('update', { background: preset.value })"
      ></button>
      <input type="color" :value="customBackground" aria-label="自定义背景色" @change="onCustomBackground" />
    </div>
  </div>
</template>
