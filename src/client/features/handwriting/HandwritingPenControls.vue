<script setup lang="ts">
import { computed } from "vue";
import { HANDWRITING_DEFAULT_PREFERENCES, HANDWRITING_DEFAULT_BRUSH_ALGORITHM, HANDWRITING_DEFAULT_ROTATION_LAG, type HandwritingBrush, type HandwritingPen } from "@shared/handwriting";
const props = defineProps<{ pen: HandwritingPen; brush: HandwritingBrush; disabled: boolean }>();
const emit = defineEmits<{
  change: [pen: HandwritingPen, brush: HandwritingBrush];
}>();
const brushFields = computed(() => [
  { key: "sensitivity", label: "速度响应" },
  { key: "lag", label: "笔头滞后" },
  ...(props.brush.algorithm === "follow" ? [{ key: "rotationLag", label: "旋转滞后" } as const] : [])
] as const);
</script>

<template>
  <div class="handwriting-pen-controls">
    <div class="handwriting-pen-choice" role="group" aria-label="笔触">
      <button type="button" :disabled="disabled" :aria-pressed="pen === 'hard'" @click="emit('change', 'hard', brush)">硬笔</button>
      <button type="button" :disabled="disabled" :aria-pressed="pen === 'brush'" @click="emit('change', 'brush', brush)">毛笔</button>
    </div>
    <details v-if="pen === 'brush'" class="handwriting-brush-settings">
      <summary>毛笔参数</summary>
      <div class="handwriting-brush-sliders">
        <label>
          <span>粗细 <output>{{ brush.size }}</output></span>
          <input type="range" min="0" max="100" step="1" aria-label="毛笔粗细" :value="brush.size" :disabled="disabled" @input="emit('change', pen, { ...brush, size: Number(($event.target as HTMLInputElement).value) })">
        </label>
        <label>
          <span>算法</span>
          <select aria-label="毛笔算法" :value="brush.algorithm || HANDWRITING_DEFAULT_BRUSH_ALGORITHM" :disabled="disabled" @change="emit('change', pen, { ...brush, algorithm: ($event.target as HTMLSelectElement).value as HandwritingBrush['algorithm'] })">
            <option value="follow">峰随路转</option>
            <option value="slanted">石径斜</option>
          </select>
        </label>
        <label v-for="field in brushFields" :key="field.key">
          <span>{{ field.label }} <output>{{ brush[field.key] ?? HANDWRITING_DEFAULT_ROTATION_LAG }}</output></span>
          <input type="range" min="0" max="100" step="1" :aria-label="`毛笔${field.label}`" :value="brush[field.key] ?? HANDWRITING_DEFAULT_ROTATION_LAG" :disabled="disabled" @change="emit('change', pen, { ...brush, [field.key]: Number(($event.target as HTMLInputElement).value) })">
        </label>
        <button type="button" :disabled="disabled" @click="emit('change', pen, { ...HANDWRITING_DEFAULT_PREFERENCES.brush })">恢复默认参数</button>
        <small>参数随账号保存，对下一笔生效。{{ brush.algorithm === 'follow' ? '峰随路转：转折时笔毛先弯折，再随运笔逐渐转锋；旋转滞后越大，转锋越慢。停顿保持锋向，继续运笔后恢复。' : '石径斜：笔锋固定斜 45°。' }}</small>
      </div>
    </details>
    <span class="handwriting-pen-hint">{{ pen === 'brush' ? '慢写铺开 · 快写收细' : '圆头 · 均匀粗细' }}</span>
  </div>
</template>

<style scoped>
.handwriting-pen-controls { display: grid; grid-template-columns: max-content max-content minmax(0, 1fr); align-items: center; gap: 0 8px; margin-bottom: 8px; color: #355c48; font-size: 12px; }
.handwriting-pen-choice { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
button { border: 1px solid #d7e0d5; border-radius: 7px; min-height: 34px; padding: 4px 14px; background: #f8faf7; color: inherit; }
button[aria-pressed="true"] { background: #355c48; color: #fff; }
.handwriting-pen-hint { grid-column: 3; grid-row: 1; justify-self: end; color: #788279; text-align: right; }
.handwriting-brush-settings { display: contents; }
.handwriting-brush-settings::details-content { display: contents; }
.handwriting-brush-settings:not([open]) .handwriting-brush-sliders { display: none; }
summary { grid-column: 2; grid-row: 1; cursor: pointer; padding: 8px 0; white-space: nowrap; }
.handwriting-brush-sliders { grid-column: 1 / -1; grid-row: 2; display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 8px; padding: 8px 0; }
label { min-width: 0; }
label span { display: flex; justify-content: space-between; }
select { width: 100%; min-height: 34px; border: 1px solid #d7e0d5; border-radius: 7px; background: #f8faf7; color: inherit; margin-top: 8px; }
input { width: 100%; margin: 8px 0; accent-color: #355c48; }
small { grid-column: 1 / -1; color: #788279; line-height: 1.5; }
button:disabled { opacity: .48; }
</style>
