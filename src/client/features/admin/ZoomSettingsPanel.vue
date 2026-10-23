<script setup lang="ts">
import { ref, watch } from "vue";
import { useZoomMeeting } from "../zoom/useZoomMeeting";

const zoom = useZoomMeeting();
const url = ref("");
const busy = ref(false);
const message = ref("");
const error = ref("");
watch(zoom.ready, ready => { if (ready) url.value = zoom.settings.value.url; });
async function save() {
  busy.value = true;
  error.value = "";
  message.value = "";
  try { await zoom.save("link", { url: url.value }); message.value = "Zoom 会议链接已保存"; }
  catch (reason) { error.value = reason instanceof Error ? reason.message : "会议链接保存失败"; }
  finally { busy.value = false; }
}
</script>

<template>
  <form class="zoom-settings form-grid" @submit.prevent="save">
    <label>Zoom 会议链接<input v-model="url" type="url" maxlength="2048" placeholder="https://…" :disabled="busy || !zoom.ready.value" /></label>
    <small>点击顶栏 Zoom 图标打开会议链接；长按图标可切换全站会议状态并设置持续时间。</small>
    <p v-if="error || zoom.error.value" class="error" role="alert">{{ error || zoom.error.value }}</p>
    <p v-if="message" role="status">{{ message }}</p>
    <button class="primary-btn" type="submit" :disabled="busy || !zoom.ready.value">{{ busy ? '保存中…' : '保存会议链接' }}</button>
  </form>
</template>

<style scoped>
.zoom-settings { max-width: 640px; }
.zoom-settings label { display: grid; gap: 8px; }
.zoom-settings input { width: 100%; box-sizing: border-box; }
.zoom-settings small { color: var(--muted); line-height: 1.6; }
</style>
