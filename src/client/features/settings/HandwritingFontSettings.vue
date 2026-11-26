<script setup lang="ts">
import { onMounted, ref } from "vue";
import { Upload, Trash2 } from "lucide-vue-next";
import { handwritingFont, initializeHandwritingFont, setHandwritingFont } from "./handwritingFont";

const { fileName, busy, error } = handwritingFont;
const input = ref<HTMLInputElement | null>(null);
const status = ref("");
onMounted(initializeHandwritingFont);

async function upload(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  target.value = "";
  if (!file) return;
  status.value = "";
  if (await setHandwritingFont(file)) status.value = "手写字体已保存";
}
async function remove() {
  status.value = "";
  if (await setHandwritingFont(null)) status.value = "已恢复默认字体";
}
</script>
<template>
  <div class="handwriting-font-settings">
    <div class="settings-section-head"><strong>手写字体</strong><small>用于分享感言和读书笔记，与书中引文区分。字体仅保存在当前浏览器，不会上传到服务器。</small></div>
    <p class="settings-note">{{ fileName || '未上传：使用默认中文无衬线字体，书中引文保留宋体。' }}</p>
    <div class="handwriting-font-actions">
      <input ref="input" class="hidden" type="file" accept=".ttf,.otf,.woff,.woff2" aria-label="上传手写字体" :disabled="busy" @change="upload" />
      <button type="button" class="mini-btn" :disabled="busy" @click="input?.click()"><Upload :size="16" />{{ busy ? '正在读取字体…' : fileName ? '更换手写字体' : '上传手写字体' }}</button>
      <button v-if="fileName" type="button" class="mini-btn secondary" :disabled="busy" @click="remove"><Trash2 :size="16" />恢复默认字体</button>
    </div>
    <small class="settings-note">支持 TTF、OTF、WOFF、WOFF2，最大 30 MB。更换设备或浏览器需重新上传。</small>
    <p class="handwriting-font-preview">愿每一次阅读，都留下心里的回响。</p>
    <p v-if="error" class="settings-note" role="alert">{{ error }}</p>
    <p v-else-if="status" class="settings-note" role="status">{{ status }}</p>
  </div>
</template>
<style scoped>
.handwriting-font-settings { display: grid; gap: 12px; min-width: 0; margin-top: 12px; }
.handwriting-font-settings p { margin: 0; overflow-wrap: anywhere; }
.handwriting-font-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.handwriting-font-preview { padding: 16px; border: 1px solid var(--border, #d9ddd6); border-radius: 12px; font-family: var(--reading-comment-font, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif); font-size: 20px; line-height: 1.8; }
</style>
