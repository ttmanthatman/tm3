<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { BellRing, CheckCircle2, CircleOff, Link2, RefreshCw, Send, Server } from "lucide-vue-next";
import { api } from "../../api";
import { useChatStore } from "../../store";

type RelayConfig = {
  enabled: boolean;
  channelId: number | null;
  targetGroup: string;
  startAfterId: number;
  pendingAction: { id: string; type: "calibrate" | "test"; createdAt: string } | null;
};

type RelayAgent = {
  online: boolean;
  lastSeenAt: string | null;
  deviceName?: string;
  driverReady?: boolean;
  calibratedTarget?: string | null;
  queue?: Record<string, number>;
  attention?: number;
  lastError?: string | null;
  lastAction?: { type: "calibrate" | "test"; success: boolean; message: string; completedAt: string };
};

type RelayResponse = { configured: boolean; config: RelayConfig; agent: RelayAgent };

const store = useChatStore();
const loading = ref(true);
const busy = ref(false);
const message = ref("");
const error = ref("");
const configured = ref(false);
const config = ref<RelayConfig>({ enabled: false, channelId: null, targetGroup: "", startAfterId: 0, pendingAction: null });
const agent = ref<RelayAgent>({ online: false, lastSeenAt: null });
let refreshTimer: number | undefined;

const sourceChannels = computed(() => store.channels.filter((channel) => channel.kind === "standard" && !channel.directKey));
const pendingCount = computed(() => Object.entries(agent.value.queue || {})
  .filter(([state]) => state === "pending" || state === "processing")
  .reduce((sum, [, count]) => sum + count, 0));
const readyForTest = computed(() => agent.value.online && agent.value.driverReady && agent.value.calibratedTarget === config.value.targetGroup && !config.value.pendingAction);

function applyResponse(result: RelayResponse) {
  configured.value = result.configured;
  config.value = result.config;
  agent.value = result.agent;
}

async function load(silent = false) {
  if (!silent) loading.value = true;
  try {
    applyResponse(await api<RelayResponse>("/api/admin/wechat-relay"));
    error.value = "";
  } catch (cause) {
    if (!silent) error.value = cause instanceof Error ? cause.message : "微信转发状态加载失败";
  } finally {
    if (!silent) loading.value = false;
  }
}

async function save(showConfirmation = true) {
  busy.value = true;
  message.value = "";
  error.value = "";
  try {
    const result = await api<{ success: boolean; config: RelayConfig; agent: RelayAgent }>("/api/admin/wechat-relay", {
      method: "PUT",
      body: JSON.stringify({
        enabled: config.value.enabled,
        channelId: config.value.channelId,
        targetGroup: config.value.targetGroup.trim()
      })
    });
    config.value = result.config;
    agent.value = result.agent;
    if (showConfirmation) message.value = "微信通知转发设置已保存";
    return true;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "保存失败";
    return false;
  } finally {
    busy.value = false;
  }
}

async function requestAction(type: "calibrate" | "test") {
  if (!(await save(false))) return;
  busy.value = true;
  message.value = "";
  error.value = "";
  try {
    await api("/api/admin/wechat-relay/actions", { method: "POST", body: JSON.stringify({ type }) });
    message.value = type === "calibrate" ? "绑定指令已发送，请保持 XGS 群停留在微信前台" : "测试指令已发送，正在等待微信回报";
    await load(true);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "操作失败";
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  await load();
  refreshTimer = window.setInterval(() => void load(true), 5000);
});

onBeforeUnmount(() => {
  if (refreshTimer) window.clearInterval(refreshTimer);
});
</script>

<template>
  <section class="wechat-relay-panel">
    <div v-if="loading" class="relay-state"><span class="loading-dot"></span>正在读取 NAS 状态...</div>
    <template v-else>
      <div class="relay-status-card" :class="{ online: agent.online }">
        <span class="relay-status-icon"><Server :size="22" /></span>
        <div>
          <strong>{{ agent.online ? "NAS 微信在线" : "NAS 微信离线" }}</strong>
          <small>{{ agent.deviceName || "NAS 微信虚拟机" }}<template v-if="agent.lastSeenAt"> · {{ new Date(agent.lastSeenAt).toLocaleString() }}</template></small>
        </div>
        <span class="relay-status-pill">{{ agent.online ? "已连接" : "未连接" }}</span>
      </div>

      <div v-if="!configured" class="relay-warning"><CircleOff :size="18" />服务器尚未配置发送设备令牌，转发不会启动。</div>

      <div class="relay-grid">
        <label>
          <span>来源频道</span>
          <select v-model.number="config.channelId" :disabled="busy">
            <option :value="null">请选择频道</option>
            <option v-for="channel in sourceChannels" :key="channel.id" :value="channel.id">{{ channel.name }}</option>
          </select>
          <small>启用后只转发保存设置之后的新消息，不补发历史记录。</small>
        </label>

        <label>
          <span>目标微信群</span>
          <input v-model="config.targetGroup" maxlength="80" placeholder="例如：XGS" :disabled="busy" />
          <small>群名只是提示；真正的目标保护来自下方的画面绑定。</small>
        </label>
      </div>

      <div class="relay-bind-card">
        <div>
          <span class="relay-bind-icon"><Link2 :size="20" /></span>
          <span>
            <strong>绑定当前微信群</strong>
            <small v-if="agent.driverReady && agent.calibratedTarget === config.targetGroup"><CheckCircle2 :size="14" />已绑定 {{ agent.calibratedTarget }}</small>
            <small v-else>先在 NAS 微信中打开目标群并保持在前台，再点击绑定。</small>
          </span>
        </div>
        <button class="mini-btn secondary" :disabled="busy || !agent.online || !config.targetGroup.trim() || !!config.pendingAction" @click="requestAction('calibrate')">
          <RefreshCw :size="15" />绑定当前群
        </button>
      </div>

      <label class="relay-enable-row">
        <input v-model="config.enabled" type="checkbox" :disabled="busy" />
        <span><strong>启用微信通知转发</strong><small>关闭时 NAS 保持在线，但不会读取或发送频道消息。</small></span>
      </label>

      <div class="relay-actions">
        <button class="primary-btn" :disabled="busy || !configured" @click="save()">保存设置</button>
        <button class="mini-btn secondary" :disabled="busy || !readyForTest" @click="requestAction('test')"><Send :size="15" />发送测试消息</button>
      </div>

      <div class="relay-summary">
        <span><BellRing :size="16" />待发送 {{ pendingCount }} 条</span>
        <span :class="{ danger: (agent.attention || 0) > 0 }">需处理 {{ agent.attention || 0 }} 条</span>
        <span v-if="config.pendingAction">正在执行：{{ config.pendingAction.type === "calibrate" ? "绑定群" : "测试发送" }}</span>
      </div>

      <p v-if="agent.lastAction" class="relay-last-action" :class="{ error: !agent.lastAction.success }">
        {{ agent.lastAction.success ? "完成：" : "失败：" }}{{ agent.lastAction.message }}
      </p>
      <p v-if="agent.lastError" class="relay-message error">{{ agent.lastError }}</p>
      <p v-if="message" class="relay-message">{{ message }}</p>
      <p v-if="error" class="relay-message error" role="alert">{{ error }}</p>
    </template>
  </section>
</template>

<style scoped>
.wechat-relay-panel { display: grid; gap: 16px; max-width: 820px; margin: 0 auto; }
.relay-state { min-height: 180px; display: flex; align-items: center; justify-content: center; gap: 10px; color: var(--muted); }
.relay-status-card, .relay-bind-card { display: flex; align-items: center; gap: 13px; padding: 15px; border: 1px solid var(--line); border-radius: 14px; background: color-mix(in srgb, var(--panel) 90%, var(--bg)); }
.relay-status-card.online { border-color: color-mix(in srgb, var(--accent) 45%, var(--line)); }
.relay-status-icon, .relay-bind-icon { width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, transparent); }
.relay-status-card > div, .relay-bind-card > div > span:last-child { display: grid; gap: 3px; flex: 1; }
.relay-status-card small, .relay-bind-card small, .relay-grid small, .relay-enable-row small { color: var(--muted); }
.relay-status-pill { margin-left: auto; padding: 4px 9px; border-radius: 999px; font-size: 12px; color: var(--muted); background: var(--bg); }
.online .relay-status-pill { color: var(--accent-dark); background: color-mix(in srgb, var(--accent) 12%, var(--panel)); }
.relay-warning, .relay-message, .relay-last-action { margin: 0; padding: 10px 12px; border-radius: 10px; background: color-mix(in srgb, #f59e0b 12%, var(--panel)); display: flex; gap: 8px; align-items: center; }
.relay-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.relay-grid label { display: grid; gap: 7px; }
.relay-grid select, .relay-grid input { width: 100%; }
.relay-bind-card { justify-content: space-between; }
.relay-bind-card > div { display: flex; align-items: center; gap: 12px; flex: 1; }
.relay-bind-card small { display: flex; align-items: center; gap: 5px; }
.relay-enable-row { display: flex; align-items: flex-start; gap: 11px; padding: 14px; border: 1px solid var(--line); border-radius: 12px; }
.relay-enable-row input { margin-top: 3px; }
.relay-enable-row span { display: grid; gap: 3px; }
.relay-actions, .relay-summary { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.relay-summary { color: var(--muted); font-size: 13px; }
.relay-summary span { display: inline-flex; align-items: center; gap: 5px; }
.danger, .relay-message.error, .relay-last-action.error { color: #b42318; }
.relay-message.error, .relay-last-action.error { background: color-mix(in srgb, #ef4444 10%, var(--panel)); }
@media (max-width: 680px) { .relay-grid { grid-template-columns: 1fr; } .relay-bind-card { align-items: stretch; flex-direction: column; } .relay-bind-card button { width: 100%; justify-content: center; } }
</style>
