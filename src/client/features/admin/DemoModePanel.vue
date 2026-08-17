<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { CloudDownload, RotateCcw, ShieldCheck } from "lucide-vue-next";
import type { DemoModeStatusDTO } from "@shared/demoMode";
import { api, getToken } from "../../api";

const status = ref<DemoModeStatusDTO | null>(null);
const loading = ref(true);
const checking = ref(false);
const resetting = ref(false);
const message = ref("");
const error = ref("");

const actionLabel = computed(() => status.value?.active ? "复位演示数据" : "载入演示模式");

async function loadStatus() {
  loading.value = true;
  error.value = "";
  try {
    status.value = await api<DemoModeStatusDTO>("/api/admin/demo/status");
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "无法读取演示模式状态";
  } finally {
    loading.value = false;
  }
}

async function checkRemote() {
  checking.value = true;
  error.value = "";
  message.value = "";
  try {
    status.value = await api<DemoModeStatusDTO>("/api/admin/demo/check", { method: "POST" });
    message.value = `GitHub 上可用的演示数据：${status.value.manifest?.datasetVersion || "未知版本"}`;
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "检查演示数据失败";
  } finally {
    checking.value = false;
  }
}

async function resetDemo() {
  const warning = status.value?.active
    ? "确定把演示站恢复到标准状态吗？演示期间新增、修改或删除的数据都会消失。"
    : "确定载入演示模式吗？系统会先自动备份，然后替换当前账号、频道、消息和外观数据。";
  if (!window.confirm(warning)) return;
  resetting.value = true;
  error.value = "";
  message.value = "正在从 GitHub 校验并复位演示数据，请不要关闭页面……";
  try {
    const result = await api<{ success: true; status: DemoModeStatusDTO }>("/api/admin/demo/reset", {
      method: "POST",
      body: JSON.stringify({ confirmation: "RESET DEMO" })
    });
    status.value = result.status;
    message.value = "演示数据已经复位，正在重新载入聊天室。";
    const token = getToken();
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith("team-chat-") && key !== "team-chat-token") localStorage.removeItem(key);
    }
    navigator.serviceWorker?.controller?.postMessage({ type: "CLEAR_PRIVATE_CACHE", token });
    window.setTimeout(() => window.location.reload(), 1000);
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "演示数据复位失败";
    message.value = "";
  } finally {
    resetting.value = false;
  }
}

onMounted(loadStatus);
</script>

<template>
  <section class="demo-mode-panel">
    <div v-if="loading" class="demo-state">正在读取服务器设置……</div>
    <template v-else-if="status">
      <article class="demo-summary">
        <span class="demo-icon"><ShieldCheck :size="23" /></span>
        <div>
          <strong>{{ status.active ? "当前处于演示模式" : "服务器已允许演示模式" }}</strong>
          <small v-if="status.active">数据版本 {{ status.datasetVersion || "未知" }} · 最近复位 {{ status.lastResetAt ? new Date(status.lastResetAt).toLocaleString() : "尚无记录" }}</small>
          <small v-else>正式站默认看不到这里；只有服务器端明确启用后才会出现。</small>
        </div>
      </article>

      <div class="demo-explanation">
        <b>复位内容</b>
        <p>演示账号、频道、消息、互动、音乐资料、头像、聊天壁纸、卷轴素材和登录背景都会恢复。服务器密码、DeepSeek 密钥、推送密钥和运维管理员账号不会被覆盖。</p>
      </div>

      <article v-if="status.manifest" class="demo-manifest">
        <b>GitHub 数据 {{ status.manifest.datasetVersion }}</b>
        <small>
          {{ status.manifest.summary.accounts }} 个用户 ·
          {{ status.manifest.summary.channels }} 个频道 ·
          {{ status.manifest.summary.messages }} 条消息 ·
          {{ status.manifest.summary.assets }} 个素材
        </small>
      </article>

      <div class="demo-actions">
        <button class="mini-btn secondary" :disabled="checking || resetting" @click="checkRemote">
          <CloudDownload :size="16" />{{ checking ? "正在检查……" : "检查 GitHub 演示数据" }}
        </button>
        <button class="primary-btn" :disabled="resetting || status.busy" @click="resetDemo">
          <RotateCcw :size="16" />{{ resetting || status.busy ? "正在复位……" : actionLabel }}
        </button>
      </div>
      <p class="demo-source">数据源：{{ status.source }}</p>
    </template>
    <p v-if="message" class="demo-message" role="status">{{ message }}</p>
    <p v-if="error" class="demo-error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.demo-mode-panel {
  display: grid;
  gap: 16px;
}

.demo-state,
.demo-summary,
.demo-explanation,
.demo-manifest {
  border: 1px solid var(--line);
  border-radius: 14px;
  background: color-mix(in srgb, var(--panel) 94%, var(--accent) 6%);
  padding: 16px;
}

.demo-summary {
  display: flex;
  align-items: center;
  gap: 13px;
}

.demo-summary div,
.demo-manifest {
  display: grid;
  gap: 5px;
}

.demo-summary small,
.demo-manifest small,
.demo-explanation p,
.demo-source {
  color: var(--muted);
  line-height: 1.55;
}

.demo-icon {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 12px;
  color: var(--button-text);
  background: var(--accent);
  flex: 0 0 auto;
}

.demo-explanation p {
  margin: 7px 0 0;
}

.demo-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.demo-actions button {
  min-height: 42px;
}

.demo-source {
  margin: 0;
  overflow-wrap: anywhere;
  font-size: 12px;
}

.demo-message,
.demo-error {
  margin: 0;
  border-radius: 10px;
  padding: 11px 13px;
}

.demo-message {
  background: color-mix(in srgb, var(--accent) 12%, var(--panel));
}

.demo-error {
  color: #b91c1c;
  background: #fef2f2;
}

@media (max-width: 520px) {
  .demo-actions,
  .demo-actions button {
    width: 100%;
  }
}
</style>
