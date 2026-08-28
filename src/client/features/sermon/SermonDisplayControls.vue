<script setup lang="ts">
import { computed, ref } from "vue";
import { Minus, Plus } from "lucide-vue-next";
import type { SermonDisplayDTO, SermonFontFamily } from "@shared/types";
import { isLightSermonBackground } from "./sermonDisplay";
import { SERMON_BG_PRESETS, SERMON_TEXT_COLORS, sermonThemePatch } from "./sermonThemes";

// 讲道台显示设置控件组：移动端演示视图底栏与桌面端双栏左列共用，
// 所有改动以 sermon:display 部分补丁形式上抛。
const props = defineProps<{ display: SermonDisplayDTO }>();
const emit = defineEmits<{ update: [patch: Partial<SermonDisplayDTO>] }>();

const SERMON_FONT_SCALE_MIN = 0.7;
const SERMON_FONT_SCALE_MAX = 1.6;
const SERMON_MARGIN_MIN = 2;
const SERMON_MARGIN_MAX = 20;

const SERMON_FONT_OPTIONS: Array<{ value: SermonFontFamily; label: string }> = [
  { value: "songti", label: "宋体" },
  { value: "pingfang", label: "苹方" },
  { value: "heiti", label: "黑体" },
  { value: "kaiti", label: "楷体" }
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
  if (/^#[0-9a-fA-F]{6}$/.test(value)) {
    emit("update", { background: value, textColor: isLightSermonBackground(value) ? "#1f2937" : "#f8f4e8" });
  }
}

function onCustomTextColor(event: Event) {
  const value = (event.target as HTMLInputElement).value;
  if (/^#[0-9a-fA-F]{6}$/.test(value)) emit("update", { textColor: value });
}
</script>

<template>
  <div class="sermon-display-settings">
    <section class="sermon-setting-group sermon-setting-type">
      <h4>文字排版</h4>
      <div class="sermon-font-row">
        <label class="sermon-font-select">
          <span>字体</span>
          <select
            :value="display.fontFamily"
            aria-label="经文字体"
            @change="emit('update', { fontFamily: ($event.target as HTMLSelectElement).value as SermonFontFamily })"
          >
            <option v-for="option in SERMON_FONT_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>
        <div class="sermon-font-stepper" role="group" :aria-label="`经文字体倍率，当前 ${fontScale.toFixed(1)} 倍`">
          <button type="button" :disabled="fontScale <= SERMON_FONT_SCALE_MIN" aria-label="减小字体" @click="adjustFont(-1)"><Minus :size="15" /></button>
          <span aria-live="polite">{{ fontScale.toFixed(1) }}×</span>
          <button type="button" :disabled="fontScale >= SERMON_FONT_SCALE_MAX" aria-label="增大字体" @click="adjustFont(1)"><Plus :size="15" /></button>
        </div>
      </div>
      <label class="sermon-margin-slider">
        <span>版心边距</span>
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
        <strong aria-live="polite">{{ marginShown }}%</strong>
      </label>
    </section>

    <section class="sermon-setting-group sermon-setting-theme">
      <h4>背景主题</h4>
      <div class="sermon-theme-grid" role="group" aria-label="背景主题">
        <button
          v-for="preset in SERMON_BG_PRESETS"
          :key="preset.value"
          type="button"
          class="sermon-theme-option"
          :class="{ active: display.background === preset.value }"
          :aria-pressed="display.background === preset.value"
          @click="emit('update', sermonThemePatch(preset))"
        >
          <i :style="{ background: preset.chip, color: preset.textColor }">文</i>
          <span>{{ preset.label }}</span>
        </button>
        <label class="sermon-color-custom">
          <input type="color" :value="customBackground" aria-label="自定义背景色" @change="onCustomBackground" />
          <span>自定义</span>
        </label>
      </div>
    </section>

    <section class="sermon-setting-group sermon-setting-color">
      <h4>文字颜色</h4>
      <div class="sermon-text-color-picker" role="group" aria-label="文字颜色">
        <button
          v-for="color in SERMON_TEXT_COLORS"
          :key="color"
          type="button"
          class="sermon-text-swatch"
          :class="{ active: (display.textColor || '#f8f4e8').toLowerCase() === color.toLowerCase() }"
          :style="{ background: color }"
          :aria-label="`文字颜色 ${color}`"
          :aria-pressed="(display.textColor || '#f8f4e8').toLowerCase() === color.toLowerCase()"
          @click="emit('update', { textColor: color })"
        ></button>
        <input type="color" :value="display.textColor || '#f8f4e8'" aria-label="自定义文字颜色" @change="onCustomTextColor" />
      </div>
      <small>选择主题时会自动搭配清晰的文字颜色，也可单独调整。</small>
    </section>
  </div>
</template>
