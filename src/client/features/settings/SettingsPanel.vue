<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { ComputedRef, Ref } from "vue";
import {
  Bell,
  BellOff,
  BookOpen,
  CircleOff,
  Info,
  Monitor,
  Palette,
  Save,
  Smartphone,
  Tablet,
  Trash2,
  Upload,
  Users,
  X
} from "lucide-vue-next";
import type {
  AccountDTO,
  BibleCombinedPassageMode,
  BibleOutputFormat,
  BiblePreferencesDTO,
  BibleQuotationStyle,
  BibleReferenceLabelMode,
  ChannelDTO,
  DeviceSessionDTO,
  ThemeDTO,
  VersionDTO
} from "@shared/types";
import { APP_VERSION, RELEASE_DATE, RELEASE_NOTES } from "@shared/release";
import { api } from "../../api";
import { useChatStore } from "../../store";
import AvatarImage from "../../components/ui/AvatarImage.vue";
import ChannelIcon from "../../components/ui/ChannelIcon.vue";
import AppField from "../../components/ui/AppField.vue";
import { settingsTabMeta, type SettingsTab } from "./settingsTabs";
import { useAccountSettings } from "./useAccountSettings";

interface SettingsPanelBindings {
  settingsTab: Ref<SettingsTab>;
  settingsLoadError: Ref<string>;
  selectSettingsTab: (tab: SettingsTab) => Promise<void>;
  closeSettingsPanel: () => Promise<void>;
  themeOptions: ComputedRef<ThemeDTO[]>;
  activeTheme: ComputedRef<string>;
  themeSwatchStyle: (theme: ThemeDTO) => { background: string };
  biblePreferences: () => BiblePreferencesDTO;
  devices: Ref<DeviceSessionDTO[]>;
  displayedDeviceName: (device: Pick<DeviceSessionDTO, "deviceName">) => string;
  revokeDevice: (device: DeviceSessionDTO) => Promise<void>;
  deviceLabel: (kind: string) => string;
  notificationMsg: Ref<string>;
  notificationEnabled: Ref<boolean>;
  notificationBusy: Ref<boolean>;
  notificationSupported: ComputedRef<boolean>;
  notificationPermissionLabel: ComputedRef<string>;
  sendTestNotification: () => Promise<void>;
  enableNotifications: () => Promise<void>;
  disableNotifications: () => Promise<void>;
  isChannelMuted: (channelId: number) => boolean;
  setChannelMuted: (channel: ChannelDTO, muted: boolean) => Promise<void>;
  avatarText: (name: string) => string;
  serverVersion: Ref<VersionDTO | null>;
  compareVersions: (a: string, b: string) => number;
  reloadToLatestVersion: () => Promise<void>;
  releaseHistory: Ref<Array<{ version: string; date: string; notes: readonly string[] }>>;
  releaseDeveloper: ComputedRef<string>;
}

const props = defineProps<{
  settings: SettingsPanelBindings;
}>();

const emit = defineEmits<{
  deleted: [];
}>();

const store = useChatStore();

const {
  accountDisplayName,
  accountCurrentPassword,
  accountNewPassword,
  accountConfirmPassword,
  accountDeletePassword,
  accountAvatarBusy,
  accountProfileBusy,
  accountPasswordBusy,
  accountDeleteBusy,
  accountProfileMsg,
  accountPasswordMsg,
  accountDeleteMsg,
  syncAccountSettings,
  uploadOwnAvatar,
  saveOwnProfile,
  changeOwnPassword,
  deleteOwnAccount
} = useAccountSettings({ onDeleted: () => emit("deleted") });

const {
  settingsTab,
  settingsLoadError,
  selectSettingsTab,
  closeSettingsPanel,
  themeOptions,
  activeTheme,
  themeSwatchStyle,
  biblePreferences,
  devices,
  displayedDeviceName,
  revokeDevice,
  deviceLabel,
  notificationMsg,
  notificationEnabled,
  notificationBusy,
  notificationSupported,
  notificationPermissionLabel,
  sendTestNotification,
  enableNotifications,
  disableNotifications,
  isChannelMuted,
  setChannelMuted,
  avatarText,
  serverVersion,
  compareVersions,
  reloadToLatestVersion,
  releaseHistory,
  releaseDeveloper
} = props.settings;

onMounted(() => {
  if (settingsTab.value === "account") syncAccountSettings();
});

async function selectTab(tab: SettingsTab) {
  if (tab === "account") syncAccountSettings();
  await selectSettingsTab(tab);
}

async function chooseTheme(theme: string) {
  const result = await api<{ account: AccountDTO }>("/api/me/preferences", { method: "PATCH", body: JSON.stringify({ theme }) });
  if (result.account) store.account = result.account;
}

const bibleSettingsMsg = ref("");
const bibleOutputFormatOptions: Array<{ value: BibleOutputFormat; label: string; description: string }> = [
  { value: "continuousText", label: "连续正文", description: "创世记 1:1 起初，神创造天地。" },
  { value: "referenceVerseLines", label: "每节完整标签", description: "每行显示“书卷 章:节 经文”。" },
  { value: "referenceHeader", label: "首行引用", description: "第一行显示出处，后面逐节分行。" },
  { value: "numberedVerses", label: "每节带节号", description: "出处后逐行显示节号和经文。" }
];
const bibleReferenceLabelOptions: Array<{ value: BibleReferenceLabelMode; label: string }> = [
  { value: "normalizedFull", label: "改写为完整标签" },
  { value: "preserveInput", label: "保留原输入标签" },
  { value: "omit", label: "不显示引用标签" }
];
const bibleCombinedPassageOptions: Array<{ value: BibleCombinedPassageMode; label: string }> = [
  { value: "compactEllipsis", label: "合并为一段" },
  { value: "groupedLines", label: "按片段分行" }
];
const bibleQuotationStyleOptions: Array<{ value: BibleQuotationStyle; label: string }> = [
  { value: "fullWidth", label: "全角引号 “ ”" },
  { value: "halfWidth", label: "半角引号 \" \"" },
  { value: "square", label: "保留方引号 「 」" }
];

async function saveBiblePreference<K extends keyof BiblePreferencesDTO>(key: K, value: BiblePreferencesDTO[K]) {
  bibleSettingsMsg.value = "";
  const current = biblePreferences();
  const next = { ...current, [key]: value };
  try {
    const result = await api<{ account: AccountDTO }>("/api/me/preferences", { method: "PATCH", body: JSON.stringify({ biblePreferences: next }) });
    if (result.account) store.account = result.account;
    bibleSettingsMsg.value = "经文显示设置已保存";
  } catch {
    bibleSettingsMsg.value = "保存失败，请稍后再试";
  }
}

function deviceIcon(kind: string) {
  if (kind === "mobile") return Smartphone;
  if (kind === "tablet") return Tablet;
  return Monitor;
}
</script>

<template>
    <section class="modal-shell" role="dialog" aria-modal="true" aria-label="个人设置" @click.self="closeSettingsPanel">
      <div class="settings-modal">
        <aside class="settings-sidebar">
          <header class="settings-profile">
            <div class="avatar">
              <AvatarImage :path="store.account?.avatarPath">
                <span>{{ avatarText(store.account?.displayName || '') }}</span>
              </AvatarImage>
            </div>
            <span><strong>{{ store.account?.displayName }}</strong><small>@{{ store.account?.username }}</small></span>
          </header>
          <nav class="settings-nav" aria-label="设置分类">
            <button :class="{ active: settingsTab === 'account' }" @click="selectTab('account')"><Users :size="19" /><span><b>账号</b><small>头像与安全</small></span></button>
            <button :class="{ active: settingsTab === 'appearance' }" @click="selectTab('appearance')"><Palette :size="19" /><span><b>外观</b><small>主题与颜色</small></span></button>
            <button :class="{ active: settingsTab === 'bible' }" @click="selectTab('bible')"><BookOpen :size="19" /><span><b>经文显示</b><small>格式与引用</small></span></button>
            <button :class="{ active: settingsTab === 'notifications' }" @click="selectTab('notifications')"><Bell :size="19" /><span><b>通知</b><small>设备与频道</small></span></button>
            <button :class="{ active: settingsTab === 'devices' }" @click="selectTab('devices')"><Monitor :size="19" /><span><b>登录设备</b><small>会话与安全</small></span></button>
            <button :class="{ active: settingsTab === 'release' }" @click="selectTab('release')"><Info :size="19" /><span><b>关于</b><small>版本与更新</small></span></button>
          </nav>
          <small class="settings-sidebar-version">Team Chat v{{ APP_VERSION }}</small>
        </aside>
        <div class="settings-content">
          <header class="settings-content-head">
            <div>
              <strong>{{ settingsTabMeta[settingsTab].title }}</strong>
              <small>{{ settingsTabMeta[settingsTab].description }}</small>
            </div>
            <button class="icon-btn" @click="closeSettingsPanel" aria-label="关闭设置"><X :size="20" /></button>
          </header>
          <div class="admin-body settings-body">
          <div v-if="settingsLoadError" class="settings-load-error" role="alert"><CircleOff :size="17" /><span>{{ settingsLoadError }}</span><button @click="selectTab(settingsTab)">重试</button></div>
          <section v-if="settingsTab === 'account'" class="form-grid settings-section account-settings">
            <div class="settings-section-head"><strong>个人账号</strong><small>头像和昵称会显示在聊天消息旁。</small></div>
            <label class="account-avatar-card" :class="{ busy: accountAvatarBusy }">
              <span class="avatar account-settings-avatar">
                <AvatarImage :path="store.account?.avatarPath">
                  <span>{{ avatarText(store.account?.displayName || '') }}</span>
                </AvatarImage>
              </span>
              <span><strong>{{ accountAvatarBusy ? "正在上传头像" : "更换头像" }}</strong><small>选择 JPG、PNG、GIF 或 WebP 图片</small></span>
              <Upload :size="19" />
              <input class="hidden" type="file" accept="image/*" :disabled="accountAvatarBusy" @change="uploadOwnAvatar" />
            </label>
            <label for="account-display-name">昵称</label>
            <div class="account-inline-form">
              <input id="account-display-name" v-model="accountDisplayName" maxlength="80" autocomplete="nickname" />
              <button class="primary-btn" :disabled="accountProfileBusy" @click="saveOwnProfile"><Save :size="16" />{{ accountProfileBusy ? "保存中" : "保存昵称" }}</button>
            </div>
            <p v-if="accountProfileMsg" class="settings-note">{{ accountProfileMsg }}</p>

            <div class="account-security-grid">
              <div class="account-setting-card">
                <div><strong>修改密码</strong><small>修改后，其他已登录设备会自动退出。</small></div>
                <AppField label="当前密码" input-id="account-current-password">
                  <input id="account-current-password" v-model="accountCurrentPassword" type="password" maxlength="128" autocomplete="current-password" />
                </AppField>
                <AppField label="新密码" input-id="account-new-password">
                  <input id="account-new-password" v-model="accountNewPassword" type="password" minlength="10" maxlength="128" autocomplete="new-password" />
                </AppField>
                <label>再次输入新密码<input v-model="accountConfirmPassword" type="password" minlength="10" maxlength="128" autocomplete="new-password" /></label>
                <button class="primary-btn" :disabled="accountPasswordBusy" @click="changeOwnPassword">{{ accountPasswordBusy ? "修改中" : "修改密码" }}</button>
                <p v-if="accountPasswordMsg" class="settings-note">{{ accountPasswordMsg }}</p>
              </div>
              <div class="account-setting-card account-danger-card">
                <div><strong>删除账号</strong><small>账号与个人数据将永久删除，历史消息会匿名保留。</small></div>
                <label>当前密码<input v-model="accountDeletePassword" type="password" maxlength="128" autocomplete="current-password" /></label>
                <button class="mini-btn danger-action" :disabled="accountDeleteBusy" @click="deleteOwnAccount"><Trash2 :size="16" />{{ accountDeleteBusy ? "删除中" : "永久删除账号" }}</button>
                <p v-if="accountDeleteMsg" class="settings-note">{{ accountDeleteMsg }}</p>
              </div>
            </div>
          </section>
          <section v-if="settingsTab === 'appearance'" class="form-grid settings-section">
            <div class="settings-section-head"><strong>聊天主题</strong><small>仅影响你的账号，可随时切换。</small></div>
            <label>主题</label>
            <div class="theme-grid">
              <button
                v-for="theme in themeOptions"
                :key="theme.id"
                class="theme-tile"
                :class="{ active: activeTheme === theme.id }"
                @click="chooseTheme(theme.id)"
              >
                <span :style="themeSwatchStyle(theme)"></span>
                <b>{{ theme.name }}</b>
              </button>
            </div>
          </section>

          <section v-if="settingsTab === 'bible'" class="form-grid settings-section">
            <div class="settings-section-head"><strong>经文阅读</strong><small>保持聊天原文不变，只调整展开后的排版。</small></div>
            <label>经文弹出格式</label>
            <div class="bible-settings-grid">
              <button
                v-for="option in bibleOutputFormatOptions"
                :key="option.value"
                class="bible-setting-tile"
                :class="{ active: biblePreferences().outputFormat === option.value }"
                @click="saveBiblePreference('outputFormat', option.value)"
              >
                <b>{{ option.label }}</b>
                <small>{{ option.description }}</small>
              </button>
            </div>
            <label>引用标签</label>
            <select :value="biblePreferences().referenceLabelMode" @change="saveBiblePreference('referenceLabelMode', ($event.target as HTMLSelectElement).value as BibleReferenceLabelMode)">
              <option v-for="option in bibleReferenceLabelOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
            <label>组合经文</label>
            <select :value="biblePreferences().combinedPassageMode" @change="saveBiblePreference('combinedPassageMode', ($event.target as HTMLSelectElement).value as BibleCombinedPassageMode)">
              <option v-for="option in bibleCombinedPassageOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
            <label>引号样式</label>
            <select :value="biblePreferences().quotationStyle" @change="saveBiblePreference('quotationStyle', ($event.target as HTMLSelectElement).value as BibleQuotationStyle)">
              <option v-for="option in bibleQuotationStyleOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
            <p class="settings-note">这些设置只影响你自己看到的经文弹出内容，不会改动聊天消息原文。</p>
            <p v-if="bibleSettingsMsg" class="settings-note">{{ bibleSettingsMsg }}</p>
          </section>

          <section v-if="settingsTab === 'devices'" class="form-grid settings-section">
            <div class="settings-section-head"><strong>会话安全</strong><small>不认识的设备应立即登出；当前设备退出后需要重新登录。</small></div>
            <label>已登录设备</label>
            <div class="device-list">
              <div v-for="device in devices" :key="device.id" class="device-row">
                <component :is="deviceIcon(device.deviceKind)" :size="20" />
                <span>
                  <b>{{ displayedDeviceName(device) }}</b>
                  <small>{{ deviceLabel(device.deviceKind) }} · {{ new Date(device.lastSeenAt).toLocaleString() }}<template v-if="device.current"> · 当前设备</template></small>
                </span>
                <button class="mini-btn secondary" @click="revokeDevice(device)">登出</button>
              </div>
            </div>
          </section>

          <section v-if="settingsTab === 'notifications'" class="form-grid settings-section">
            <div class="settings-section-head"><strong>消息提醒</strong><small>先开启当前设备，再按频道精细控制。</small></div>
            <label>本设备通知</label>
            <div class="notification-card">
              <div>
                <strong>{{ notificationEnabled ? "已开启" : "未开启" }}</strong>
                <small>权限：{{ notificationPermissionLabel }}</small>
              </div>
              <div v-if="notificationEnabled" class="notification-card-actions">
                <button class="mini-btn" :disabled="notificationBusy" @click="sendTestNotification"><Bell :size="15" />测试</button>
                <button class="mini-btn secondary" :disabled="notificationBusy" @click="disableNotifications"><BellOff :size="15" />关闭</button>
              </div>
              <button v-else class="primary-btn" :disabled="notificationBusy || !notificationSupported" @click="enableNotifications"><Bell :size="16" />开启</button>
            </div>
            <label>频道通知</label>
            <div class="notification-channel-list">
              <article v-for="channel in store.channels" :key="channel.id" class="notification-channel-row">
                <span class="channel-icon"><ChannelIcon :icon="channel.icon" :kind="channel.kind" /></span>
                <div>
                  <strong>{{ channel.name }}</strong>
                  <small>{{ isChannelMuted(channel.id) ? "不通知普通消息" : "通知普通消息" }}</small>
                </div>
                <button class="icon-btn" :aria-label="isChannelMuted(channel.id) ? '开启频道通知' : '关闭频道通知'" @click="setChannelMuted(channel, !isChannelMuted(channel.id))">
                  <BellOff v-if="isChannelMuted(channel.id)" :size="18" />
                  <Bell v-else :size="18" />
                </button>
              </article>
            </div>
            <p v-if="notificationMsg" class="settings-note">{{ notificationMsg }}</p>
          </section>

          <section v-if="settingsTab === 'release'" class="release-panel settings-section">
            <div class="release-head">
              <span>当前版本</span>
              <strong>v{{ APP_VERSION }}</strong>
              <small>{{ RELEASE_DATE }} · 开发者：{{ releaseDeveloper }}</small>
            </div>
            <div v-if="serverVersion && compareVersions(serverVersion.version, APP_VERSION) > 0" class="release-update-card">
              <div>
                <b>发现服务器新版本 v{{ serverVersion.version }}</b>
                <small>当前手机里的版本是 v{{ APP_VERSION }}</small>
              </div>
              <button class="mini-btn" @click="reloadToLatestVersion">刷新到最新版</button>
            </div>
            <div class="release-current">
              <b>本次更新</b>
              <ol>
                <li v-for="note in RELEASE_NOTES" :key="note">{{ note }}</li>
              </ol>
            </div>
            <div class="release-history">
              <article v-for="release in releaseHistory" :key="release.version" class="release-entry">
                <h3>v{{ release.version }} <small>{{ release.date }}</small></h3>
                <ol>
                  <li v-for="note in release.notes" :key="note">{{ note }}</li>
                </ol>
              </article>
            </div>
          </section>
          </div>
        </div>
      </div>
    </section>
</template>
