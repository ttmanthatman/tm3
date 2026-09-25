<script setup lang="ts">
import { HANDWRITING_DEFAULT_BRUSH, type HandwritingBrush, type HandwritingPen } from "@shared/handwriting";
const props = defineProps<{ pen: HandwritingPen; brush: HandwritingBrush; disabled: boolean }>();
const emit = defineEmits<{ change: [pen: HandwritingPen, brush: HandwritingBrush] }>();
const fields = [
  { key: "size", label: "粗细" },
  { key: "sensitivity", label: "速度响应" },
  { key: "lag", label: "笔头滞后" }
] as const;
function adjust(key: keyof HandwritingBrush, event: Event) {
  emit("change", props.pen, { ...props.brush, [key]: Number((event.target as HTMLInputElement).value) });
}
</script>

<template>
  <div class="handwriting-pen-controls">
    <div class="handwriting-pen-choice" role="group" aria-label="笔触">
      <button type="button" :disabled="disabled" :aria-pressed="pen === 'hard'" @click="emit('change', 'hard', brush)">硬笔</button>
      <button type="button" :disabled="disabled" :aria-pressed="pen === 'brush'" @click="emit('change', 'brush', brush)">毛笔</button>
      <span>{{ pen === 'brush' ? '慢写铺开 · 快写收细' : '圆头 · 均匀粗细' }}</span>
    </div>
    <details v-if="pen === 'brush'" class="handwriting-brush-settings">
      <summary>毛笔参数</summary>
      <div class="handwriting-brush-sliders">
        <label v-for="field in fields" :key="field.key">
          <span>{{ field.label }} <output>{{ brush[field.key] }}</output></span>
          <input type="range" min="0" max="100" step="1" :aria-label="`毛笔${field.label}`" :value="brush[field.key]" :disabled="disabled" @input="adjust(field.key, $event)">
        </label>
        <button type="button" :disabled="disabled" @click="emit('change', pen, { ...HANDWRITING_DEFAULT_BRUSH })">恢复默认</button>
        <small>随账号保存，对下一笔生效。速度响应越高，快慢粗细差异越大；滞后越高，转弯越柔和。</small>
      </div>
    </details>
  </div>
</template>

<style scoped>
.handwriting-pen-controls { margin-bottom: 8px; color: #355c48; font-size: 12px; }
.handwriting-pen-choice { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
button { border: 1px solid #d7e0d5; border-radius: 7px; min-height: 34px; padding: 4px 14px; background: #f8faf7; color: inherit; }
button[aria-pressed="true"] { background: #355c48; color: #fff; }
.handwriting-pen-choice > span { margin-left: auto; color: #788279; }
summary { cursor: pointer; padding: 8px 0 2px; }
.handwriting-brush-sliders { display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 8px; padding: 8px 0; }
label { min-width: 0; }
label span { display: flex; justify-content: space-between; }
input { width: 100%; margin: 8px 0; accent-color: #355c48; }
small { grid-column: 1 / -1; color: #788279; line-height: 1.5; }
button:disabled { opacity: .48; }
</style>
