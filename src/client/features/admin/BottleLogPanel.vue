<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../../api";
import type { AdminBottleLog } from "@shared/social";
import { adminDateTime } from "./adminFormat";

const logs = ref<AdminBottleLog[]>([]);
const busy = ref(false);
const error = ref("");
async function load() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    logs.value = (await api<{ logs: AdminBottleLog[] }>("/api/admin/bottle-logs?limit=300")).logs;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "漂流瓶日志加载失败";
  } finally {
    busy.value = false;
  }
}
onMounted(load);
</script>

<template>
  <section class="bottle-log-panel" aria-label="漂流瓶日志">
    <div class="bottle-log-toolbar">
      <small>最近 300 个漂流瓶，按发送或拾取的最新时间排列。</small>
      <button class="mini-btn secondary" :disabled="busy" @click="load">{{ busy ? "刷新中" : "刷新" }}</button>
    </div>
    <p v-if="error" class="settings-note" role="alert">{{ error }}</p>
    <p v-if="busy && !logs.length" class="settings-note">正在加载漂流瓶日志...</p>
    <p v-else-if="!logs.length && !error" class="settings-note">还没有漂流瓶日志。</p>
    <div v-else class="login-log-list">
      <article v-for="log in logs" :key="log.id" class="bottle-log-row">
        <div class="bottle-log-heading"><strong>{{ log.channelName }}</strong><span>{{ log.openedAt ? "已捡起" : "待拾取" }}</span></div>
        <small class="bottle-log-id">瓶子 {{ log.id }}</small>
        <dl>
          <div><dt>发送者</dt><dd>{{ log.senderName || "未知（旧瓶子未记录）" }}<span v-if="log.senderUsername"> @{{ log.senderUsername }}</span><time v-if="log.sentAt"> · {{ adminDateTime(log.sentAt) }}</time></dd></div>
          <div><dt>拾取者</dt><dd>{{ log.readerName || "尚未被捡起" }}<span v-if="log.readerUsername"> @{{ log.readerUsername }}</span><time v-if="log.openedAt"> · {{ adminDateTime(log.openedAt) }}</time></dd></div>
          <div><dt>内容</dt><dd class="bottle-log-text">{{ log.text }}</dd></div>
        </dl>
      </article>
    </div>
  </section>
</template>

<style scoped>
.bottle-log-panel, .bottle-log-row { min-width: 0; }
.bottle-log-toolbar, .bottle-log-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.bottle-log-toolbar { margin: 12px 0; }
.bottle-log-row { padding: 14px; border: 1px solid color-mix(in srgb, currentColor 14%, transparent); border-radius: 10px; overflow-wrap: anywhere; }
.bottle-log-heading span, .bottle-log-id { font-size: 12px; opacity: 0.7; }
.bottle-log-id { display: block; margin-top: 6px; }
dl { display: grid; gap: 10px; margin: 12px 0 0; }
dt { font-size: 12px; font-weight: 600; margin-bottom: 4px; }
dd { margin: 0; font-size: 13px; line-height: 1.6; }
.bottle-log-text { white-space: pre-wrap; max-height: 300px; overflow: auto; }
</style>
