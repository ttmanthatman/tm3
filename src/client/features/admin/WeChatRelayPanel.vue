<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { BellRing, CheckCircle2, CircleOff, Copy, ExternalLink, Info, KeyRound, Link2, LogIn, RefreshCw, Send, Server, Users } from "lucide-vue-next";
import { api } from "../../api";
import { useChatStore } from "../../store";
import {
  DEFAULT_WECHAT_RELAY_TEMPLATES,
  WECHAT_RELAY_TEMPLATE_VARIABLES,
  type WeChatRelayTemplateKey,
  type WeChatRelayTemplates,
  type WeChatRelayUserMapping
} from "../../../shared/wechatRelayNotifications";

type RelayConfig = {
  enabled: boolean;
  channelId: number | null;
  targetGroup: string;
  startAfterId: number;
  pendingAction: { id: string; type: "calibrate" | "test"; createdAt: string } | null;
  templates: WeChatRelayTemplates;
  systemPrefix: string;
  userMappings: WeChatRelayUserMapping[];
};

type RelayUser = { accountId: number; username: string; displayName: string };

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

type RelayResponse = {
  configured: boolean;
  tokenSource: "admin" | "environment" | "none";
  nasAccessUrl: string | null;
  config: RelayConfig;
  users: RelayUser[];
  agent: RelayAgent;
};

const templateSections: Array<{ key: WeChatRelayTemplateKey; title: string; hint: string }> = [
  { key: "message", title: "普通发言", hint: "例如：{name}说话了" },
  { key: "mention", title: "@ 提到别人", hint: "例如：{name}给你说话了" },
  { key: "prayer", title: "新代祷事项", hint: "例如：{name}发送了代祷事项" },
  { key: "prayerUpdate", title: "代祷更新", hint: "例如：代祷信息更新了" },
  { key: "image", title: "图片", hint: "例如：{name}分享了一张图片" },
  { key: "file", title: "普通文件", hint: "可使用 {fileName} 和 {fileSize}" },
  { key: "voice", title: "语音", hint: "例如：{name}发来了一条语音" },
  { key: "musicPlaylist", title: "歌单分享", hint: "例如：{name}分享了一个歌单" },
  { key: "chain", title: "接龙", hint: "可使用 {content} 显示接龙主题" },
  { key: "whyTopic", title: "‘为什么’话题卡", hint: "例如：{name}分享了一个新话题" },
  { key: "pinned", title: "置顶消息", hint: "建议保留 {systemPrefix}、{channel}、{title}" },
  { key: "versionUpdate", title: "系统版本升级", hint: "可使用 {systemPrefix} 和 {version}" },
  { key: "system", title: "其他系统消息", hint: "建议保留 {systemPrefix}" },
  { key: "other", title: "其他动态", hint: "未归入以上类型时使用" }
];

function templateText(templates: WeChatRelayTemplates) {
  return Object.fromEntries(templateSections.map(({ key }) => [key, templates[key].join("\n")])) as Record<WeChatRelayTemplateKey, string>;
}

const store = useChatStore();
const loading = ref(true);
const busy = ref(false);
const message = ref("");
const error = ref("");
const configured = ref(false);
const tokenSource = ref<RelayResponse["tokenSource"]>("none");
const tokenInput = ref("");
const tokenVisible = ref(false);
const nasAccessUrl = ref<string | null>(null);
const config = ref<RelayConfig>({
  enabled: false,
  channelId: null,
  targetGroup: "",
  startAfterId: 0,
  pendingAction: null,
  templates: DEFAULT_WECHAT_RELAY_TEMPLATES,
  systemPrefix: "系统消息",
  userMappings: []
});
const templateDraft = ref(templateText(DEFAULT_WECHAT_RELAY_TEMPLATES));
const users = ref<RelayUser[]>([]);
const mappingDraft = ref<Record<number, string>>({});
const agent = ref<RelayAgent>({ online: false, lastSeenAt: null });
let refreshTimer: number | undefined;

const sourceChannels = computed(() => store.channels.filter((channel) => channel.kind === "standard" && !channel.directKey));
const pendingCount = computed(() => Object.entries(agent.value.queue || {})
  .filter(([state]) => state === "pending" || state === "processing")
  .reduce((sum, [, count]) => sum + count, 0));
const readyForTest = computed(() => agent.value.online && agent.value.driverReady && agent.value.calibratedTarget === config.value.targetGroup && !config.value.pendingAction);
const nasConfigText = computed(() => tokenInput.value.trim()
  ? `RELAY_BASE_URL=${window.location.origin}\nRELAY_AGENT_TOKEN=${tokenInput.value.trim()}`
  : "");

function applyResponse(result: RelayResponse, refreshForm = true) {
  configured.value = result.configured;
  tokenSource.value = result.tokenSource;
  nasAccessUrl.value = result.nasAccessUrl;
  users.value = result.users;
  if (refreshForm) {
    config.value = result.config;
    templateDraft.value = templateText(result.config.templates);
    mappingDraft.value = Object.fromEntries(result.config.userMappings.map((mapping) => [mapping.accountId, mapping.wechatName]));
  } else {
    config.value.startAfterId = result.config.startAfterId;
    config.value.pendingAction = result.config.pendingAction;
  }
  agent.value = result.agent;
}

async function load(silent = false) {
  if (!silent) loading.value = true;
  try {
    applyResponse(await api<RelayResponse>("/api/admin/wechat-relay"), !silent);
    error.value = "";
  } catch (cause) {
    if (!silent) error.value = cause instanceof Error ? cause.message : "微信转发状态加载失败";
  } finally {
    if (!silent) loading.value = false;
  }
}

function parsedTemplates(): WeChatRelayTemplates {
  return Object.fromEntries(templateSections.map(({ key }) => [
    key,
    templateDraft.value[key].split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  ])) as WeChatRelayTemplates;
}

function parsedMappings() {
  return users.value.flatMap((user) => {
    const wechatName = mappingDraft.value[user.accountId]?.trim();
    return wechatName ? [{ accountId: user.accountId, wechatName }] : [];
  });
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
        targetGroup: config.value.targetGroup.trim(),
        templates: parsedTemplates(),
        systemPrefix: config.value.systemPrefix.trim(),
        userMappings: parsedMappings()
      })
    });
    config.value = result.config;
    templateDraft.value = templateText(result.config.templates);
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

async function saveToken() {
  busy.value = true;
  message.value = "";
  error.value = "";
  try {
    const result = await api<{ success: boolean; configured: boolean; tokenSource: RelayResponse["tokenSource"] }>("/api/admin/wechat-relay/token", {
      method: "PUT",
      body: JSON.stringify({ token: tokenInput.value.trim() })
    });
    configured.value = result.configured;
    tokenSource.value = result.tokenSource;
    message.value = "设备令牌已保存。现在把同一个令牌填入 NAS 转发设备并重启转发服务。";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "设备令牌保存失败";
  } finally {
    busy.value = false;
  }
}

async function generateToken() {
  if (configured.value && !window.confirm("生成新令牌会让使用旧令牌的设备立即断开。确定继续吗？")) return;
  busy.value = true;
  message.value = "";
  error.value = "";
  try {
    const result = await api<{ success: boolean; token: string; configured: boolean; tokenSource: RelayResponse["tokenSource"] }>("/api/admin/wechat-relay/token", {
      method: "POST"
    });
    tokenInput.value = result.token;
    tokenVisible.value = true;
    configured.value = result.configured;
    tokenSource.value = result.tokenSource;
    message.value = "新令牌已经生效，只会显示这一次。请立即复制到 NAS 转发设备。";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "新令牌生成失败";
  } finally {
    busy.value = false;
  }
}

async function copyToken() {
  if (!tokenInput.value) return;
  try {
    await navigator.clipboard.writeText(tokenInput.value);
    message.value = "设备令牌已复制";
  } catch {
    error.value = "无法自动复制，请手动选择令牌复制";
  }
}

async function copyNasConfig() {
  if (!nasConfigText.value) return;
  try {
    await navigator.clipboard.writeText(nasConfigText.value);
    message.value = "生产站的 NAS 配置已复制，请粘贴到 NAS 虚拟机桌面的“微信转发连接设置”并点击“验证并连接”";
  } catch {
    error.value = "无法自动复制 NAS 配置，请分别复制生产站地址和设备令牌";
  }
}

async function removeToken() {
  if (!window.confirm("移除管理员设置的令牌后，NAS 设备可能立即断开。确定移除吗？")) return;
  busy.value = true;
  message.value = "";
  error.value = "";
  try {
    const result = await api<{ success: boolean; configured: boolean; tokenSource: RelayResponse["tokenSource"] }>("/api/admin/wechat-relay/token", { method: "DELETE" });
    configured.value = result.configured;
    tokenSource.value = result.tokenSource;
    tokenInput.value = "";
    message.value = result.configured ? "管理员令牌已移除，服务器已恢复使用环境变量令牌" : "设备令牌已移除";
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "设备令牌移除失败";
  } finally {
    busy.value = false;
  }
}

function templatePreview(key: WeChatRelayTemplateKey) {
  const first = templateDraft.value[key].split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "请至少填写一条提醒";
  const examples: Record<string, string> = Object.fromEntries(WECHAT_RELAY_TEMPLATE_VARIABLES.map((variable) => [variable.key, variable.example]));
  examples.systemPrefix = config.value.systemPrefix.trim() || "系统消息";
  return first.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (match, name: string) => examples[name] || match);
}

function templateVariableLabel(key: string) {
  return `{${key}}`;
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

      <div v-if="!configured" class="relay-warning"><CircleOff :size="18" />尚未设置发送设备令牌。请在下方生成新令牌，或填入 NAS 设备正在使用的令牌。</div>

      <section class="relay-section-card">
        <div class="relay-section-heading">
          <span class="relay-bind-icon"><KeyRound :size="20" /></span>
          <span>
            <strong>连接微信发送设备</strong>
            <small v-if="tokenSource === 'admin'">管理员令牌已设置；明文不会保存在服务器中。</small>
            <small v-else-if="tokenSource === 'environment'">当前使用服务器环境变量中的兼容令牌。</small>
            <small v-else>生成或输入令牌后，把同一个令牌配置到 NAS 转发设备。</small>
          </span>
        </div>
        <div class="relay-token-row">
          <input
            v-model="tokenInput"
            :type="tokenVisible ? 'text' : 'password'"
            minlength="24"
            maxlength="256"
            autocomplete="new-password"
            placeholder="输入至少 24 位设备令牌"
            :disabled="busy"
          />
          <button class="mini-btn secondary" :disabled="busy || !tokenInput.trim()" @click="copyToken"><Copy :size="15" />复制</button>
        </div>
        <div class="relay-token-actions">
          <label><input v-model="tokenVisible" type="checkbox" />显示本次输入的令牌</label>
          <span class="relay-action-spacer"></span>
          <button v-if="tokenSource === 'admin'" class="mini-btn secondary" :disabled="busy" @click="removeToken">移除令牌</button>
          <button class="mini-btn secondary" :disabled="busy" @click="generateToken"><RefreshCw :size="15" />生成新令牌</button>
          <button class="mini-btn secondary" :disabled="busy || !nasConfigText" @click="copyNasConfig"><Copy :size="15" />复制 NAS 配置</button>
          <button class="mini-btn secondary" :disabled="busy || tokenInput.trim().length < 24" @click="saveToken">保存输入令牌</button>
        </div>
        <small class="relay-help">令牌只负责认证聊天室服务器与 NAS 设备，不是微信密码。生成的新令牌刷新页面后不会再次显示。</small>
      </section>

      <section class="relay-section-card relay-login-card">
        <div class="relay-section-heading">
          <span class="relay-bind-icon"><LogIn :size="20" /></span>
          <span>
            <strong>确认 NAS 微信已登录</strong>
            <small>NAS 虚拟机里的官方微信必须登录负责转发通知的账号，否则设备即使在线也无法发送。</small>
          </span>
        </div>
        <div class="relay-nas-access">
          <a v-if="nasAccessUrl" class="mini-btn secondary" :href="nasAccessUrl" target="_blank" rel="noopener noreferrer">
            打开 NAS 微信访问页<ExternalLink :size="14" />
          </a>
          <span v-else class="relay-nas-missing"><CircleOff :size="16" />服务器尚未配置 NAS 微信访问页（WECHAT_RELAY_NAS_ACCESS_URL）。</span>
          <a v-if="nasAccessUrl" class="relay-nas-url" :href="nasAccessUrl" target="_blank" rel="noopener noreferrer">{{ nasAccessUrl }}</a>
        </div>
        <small class="relay-help">登录确认后，回到本页等待“NAS 微信在线”，再打开目标群、绑定当前群并发送测试消息。</small>
      </section>

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

      <section class="relay-section-card">
        <div class="relay-section-heading">
          <span class="relay-bind-icon"><Users :size="20" /></span>
          <span>
            <strong>聊天室用户与微信用户一一对应</strong>
            <small>填写目标微信群里的准确昵称或群备注。聊天室消息明确 @ 到已映射用户时，NAS 会在微信候选列表出现并通过画面校验后，选择该成员形成真正的群 @。</small>
          </span>
        </div>
        <div class="relay-mapping-list">
          <label v-for="user in users" :key="user.accountId" class="relay-mapping-row">
            <span><strong>{{ user.displayName }}</strong><small>@{{ user.username }}</small></span>
            <input v-model="mappingDraft[user.accountId]" maxlength="80" :placeholder="`微信昵称或群备注（${user.displayName}）`" :disabled="busy" />
          </label>
        </div>
        <small class="relay-help">微信名不能重复；留空表示该聊天室用户不做定向微信 @。如果微信候选列表没有出现或没有收起，NAS 会清空输入并暂停该条发送，不会盲选成员。</small>
      </section>

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

      <section class="relay-section-card">
        <div class="relay-section-heading relay-template-heading">
          <span class="relay-bind-icon"><BellRing :size="20" /></span>
          <span>
            <strong>通知说法</strong>
            <small>每行一种说法，同类提醒会自动轮换。普通发言、@、各类附件、接龙、置顶、版本升级和其他系统消息都可单独指定。</small>
          </span>
        </div>
        <label class="relay-prefix-row">
          <span><strong>系统消息前缀</strong><small>置顶、版本升级和其他系统消息可通过 <code>{systemPrefix}</code> 使用。</small></span>
          <input v-model="config.systemPrefix" maxlength="40" placeholder="系统消息" :disabled="busy" />
        </label>
        <details class="relay-variable-help">
          <summary><Info :size="16" />查看通知内容可用参数</summary>
          <div class="relay-variable-grid">
            <div v-for="variable in WECHAT_RELAY_TEMPLATE_VARIABLES" :key="variable.key">
              <code>{{ templateVariableLabel(variable.key) }}</code>
              <span>{{ variable.label }}</span>
              <small>例如：{{ variable.example }}</small>
            </div>
          </div>
          <p><code>{content}</code> 会发送去除 HTML 后最多 200 个字符的正文摘要；不需要正文时不要在模板中加入它。<code>{mentions}</code> 是聊天室昵称，<code>{wechatMentions}</code> 是映射后的微信名；真正的微信群 @ 会由 NAS 另行插入，不依赖模板里的文字。</p>
        </details>
        <div class="relay-template-grid">
          <label v-for="section in templateSections" :key="section.key">
            <span><strong>{{ section.title }}</strong><small>{{ section.hint }}</small></span>
            <textarea v-model="templateDraft[section.key]" rows="3" maxlength="800" :disabled="busy"></textarea>
            <small class="relay-preview">预览：{{ templatePreview(section.key) }}</small>
          </label>
        </div>
        <small class="relay-help">不支持的参数会被服务器拒绝。修改后的说法只影响之后进入发送队列的新提醒；已经排队的提醒保持原样，重试时也不会换文案。</small>
      </section>

      <label class="relay-enable-row">
        <input v-model="config.enabled" type="checkbox" :disabled="busy" />
        <span><strong>启用微信通知转发</strong><small>关闭时 NAS 保持在线，但不会读取或发送频道消息。</small></span>
      </label>

      <div class="relay-actions">
        <button class="primary-btn" :disabled="busy || !configured" @click="save()">保存频道、用户映射与通知说法</button>
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
.relay-section-card { display: grid; gap: 13px; padding: 15px; border: 1px solid var(--line); border-radius: 14px; background: color-mix(in srgb, var(--panel) 92%, var(--bg)); }
.relay-section-heading { display: flex; align-items: center; gap: 12px; }
.relay-section-heading > span:last-child { display: grid; gap: 3px; min-width: 0; }
.relay-section-heading small, .relay-help, .relay-template-grid small { color: var(--muted); }
.relay-token-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
.relay-token-row input { width: 100%; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.relay-token-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.relay-token-actions label { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); font-size: 13px; }
.relay-action-spacer { flex: 1; }
.relay-help { line-height: 1.55; }
.relay-login-card { border-color: color-mix(in srgb, var(--accent) 32%, var(--line)); }
.relay-nas-access { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.relay-nas-url { min-width: 0; overflow-wrap: anywhere; color: var(--accent-dark); font-size: 13px; }
.relay-nas-missing { display: inline-flex; align-items: center; gap: 7px; color: #b45309; line-height: 1.45; }
.relay-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.relay-grid label { display: grid; gap: 7px; }
.relay-grid select, .relay-grid input { width: 100%; }
.relay-mapping-list { display: grid; gap: 9px; }
.relay-mapping-row { display: grid; grid-template-columns: minmax(150px, .7fr) minmax(220px, 1.3fr); align-items: center; gap: 12px; }
.relay-mapping-row > span, .relay-prefix-row > span { display: grid; gap: 2px; }
.relay-mapping-row input, .relay-prefix-row input { width: 100%; }
.relay-bind-card { justify-content: space-between; }
.relay-bind-card > div { display: flex; align-items: center; gap: 12px; flex: 1; }
.relay-bind-card small { display: flex; align-items: center; gap: 5px; }
.relay-enable-row { display: flex; align-items: flex-start; gap: 11px; padding: 14px; border: 1px solid var(--line); border-radius: 12px; }
.relay-enable-row input { margin-top: 3px; }
.relay-enable-row span { display: grid; gap: 3px; }
.relay-template-heading code { color: var(--text); }
.relay-prefix-row { display: grid; grid-template-columns: minmax(180px, .7fr) minmax(220px, 1.3fr); align-items: center; gap: 12px; padding: 11px; border-radius: 10px; background: var(--bg); }
.relay-variable-help { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
.relay-variable-help summary { display: flex; align-items: center; gap: 7px; cursor: pointer; font-weight: 650; }
.relay-variable-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 12px; }
.relay-variable-grid > div { display: grid; gap: 2px; min-width: 0; padding: 8px; border-radius: 8px; background: var(--bg); }
.relay-variable-grid code { color: var(--accent-dark); overflow-wrap: anywhere; }
.relay-variable-grid small, .relay-variable-help p { color: var(--muted); line-height: 1.5; }
.relay-variable-help p { margin: 10px 0 0; font-size: 13px; }
.relay-template-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.relay-template-grid label { display: grid; gap: 6px; min-width: 0; }
.relay-template-grid label > span { display: grid; gap: 2px; }
.relay-template-grid textarea { width: 100%; min-height: 86px; resize: vertical; line-height: 1.55; }
.relay-preview { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.relay-actions, .relay-summary { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.relay-summary { color: var(--muted); font-size: 13px; }
.relay-summary span { display: inline-flex; align-items: center; gap: 5px; }
.danger, .relay-message.error, .relay-last-action.error { color: #b42318; }
.relay-message.error, .relay-last-action.error { background: color-mix(in srgb, #ef4444 10%, var(--panel)); }
@media (max-width: 680px) {
  .relay-grid, .relay-template-grid, .relay-variable-grid, .relay-mapping-row, .relay-prefix-row { grid-template-columns: 1fr; }
  .relay-bind-card { align-items: stretch; flex-direction: column; }
  .relay-bind-card button { width: 100%; justify-content: center; }
  .relay-token-row { grid-template-columns: 1fr; }
  .relay-token-row button { width: 100%; justify-content: center; }
  .relay-action-spacer { display: none; }
  .relay-token-actions > button { flex: 1 1 140px; justify-content: center; }
}
</style>
