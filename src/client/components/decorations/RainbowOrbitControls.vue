<script setup lang="ts">
import { RAINBOW_MAX_COLORS, RAINBOW_MAX_WIDTH, cleanRainbowOrbit, type RainbowOrbitSettings } from "@shared/rainbowOrbit";
import MessageBoxDecoration from "./MessageBoxDecoration.vue";
const settings = defineModel<RainbowOrbitSettings>({ required: true });
function move(index: number, direction: number) {
  const colors = [...settings.value.colors];
  [colors[index], colors[index + direction]] = [colors[index + direction], colors[index]];
  settings.value = { ...settings.value, colors };
}
</script>
<template>
  <div class="rainbow-controls">
    <h3>消息框装饰 · 彩虹环绕</h3>
    <div class="rainbow-preview"><MessageBoxDecoration :settings="settings" /><span>彩色描线与光晕同步环绕</span></div>
    <label>光晕内宽度 <output>{{ settings.innerWidth }} px</output><input v-model.number="settings.innerWidth" aria-label="光晕内宽度" type="range" min="0" :max="RAINBOW_MAX_WIDTH" /></label>
    <label>光晕外宽度 <output>{{ settings.outerWidth }} px</output><input v-model.number="settings.outerWidth" aria-label="光晕外宽度" type="range" min="0" :max="RAINBOW_MAX_WIDTH" /></label>
    <p>色彩队列 · {{ settings.colors.length }} / {{ RAINBOW_MAX_COLORS }}（依次渐变，首尾相接）</p>
    <div class="rainbow-colors">
      <div v-for="(_, i) in settings.colors" :key="i" class="rainbow-color">
        <span>{{ i + 1 }}</span><input v-model="settings.colors[i]" type="color" :aria-label="`颜色 ${i + 1}`" />
        <button type="button" :disabled="i === 0" :aria-label="`前移颜色 ${i + 1}`" @click="move(i, -1)">←</button>
        <button type="button" :disabled="i === settings.colors.length - 1" :aria-label="`后移颜色 ${i + 1}`" @click="move(i, 1)">→</button>
        <button type="button" :disabled="settings.colors.length <= 1" :aria-label="`删除颜色 ${i + 1}`" @click="settings.colors.splice(i, 1)">删除</button>
      </div>
    </div>
    <div class="rainbow-actions"><button type="button" :disabled="settings.colors.length >= RAINBOW_MAX_COLORS" @click="settings.colors.push(settings.colors[settings.colors.length - 1])">添加颜色</button><button type="button" @click="settings = cleanRainbowOrbit()">恢复默认</button></div>
  </div>
</template>
<style scoped>
.rainbow-controls { min-width: 0; display: grid; gap: 14px; }
.rainbow-preview { position: relative; border-radius: 6px; padding: 20px 12px; margin: 12px 0; background: var(--panel, #fff); }
.rainbow-controls label { display: grid; grid-template-columns: 1fr auto; gap: 8px; }
.rainbow-controls input[type="range"] { grid-column: 1 / -1; width: 100%; }
.rainbow-colors { display: grid; gap: 8px; max-height: 320px; overflow-y: auto; }
.rainbow-color { display: flex; align-items: center; gap: 6px; }
.rainbow-color input[type="color"] { width: 44px; min-width: 36px; height: 32px; padding: 2px; }
.rainbow-color button { padding: 5px 8px; }
.rainbow-actions { display: flex; flex-wrap: wrap; gap: 8px; }
</style>
