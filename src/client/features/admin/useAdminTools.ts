import { computed, ref, type Ref } from "vue";
import type {
  AdminAttachmentDTO,
  AdminBackupDTO,
  AdminChannelDTO,
  AdminLoginLogDTO,
  ChannelDTO,
  DeviceSessionDTO,
  FlashEffectSettingsDTO,
  ThemePaletteDTO
} from "@shared/types";
import type { ActivityLogCategory } from "@shared/activityLog";
import { api, authHeaders } from "../../api";
import { compactBytes } from "../../time";
import { useChatStore } from "../../store";
import {
  activityDuration,
  activityStateLabel,
  adminDate,
  adminDateTime,
  backgroundAttachmentLabel,
  directConversationActivity,
  directConversationLabel,
  displayedDeviceName,
  isImageAttachmentId,
  loginLogKindLabel,
  loginLogTone,
  musicProgressSummary
} from "./adminFormat";
import {
  useAppearanceSettings,
  type AppearanceSection,
  type AppearanceStyleHelpers
} from "./useAppearanceSettings";

export type AdminPage =
  | "home"
  | "pin"
  | "users"
  | "channels"
  | "reception"
  | "channelDetail"
  | "appearance"
  | "appearanceBrand"
  | "appearanceLogin"
  | "appearanceChat"
  | "appearanceParallax"
  | "appearanceThemes"
  | "appearanceFlash"
  | "data"
  | "backups"
  | "messages"
  | "resources"
  | "books"
  | "wechatRelay"
  | "demo"
  | "release";

export const adminAppearancePages = new Set<AdminPage>(["appearanceBrand", "appearanceLogin", "appearanceChat", "appearanceParallax", "appearanceThemes", "appearanceFlash"]);

export const adminDirectPageSize = 30;

export const adminPageMeta: Record<AdminPage, { title: string; description: string }> = {
  home: { title: "管理中心", description: "按功能进入独立管理页面" },
  pin: { title: "置顶公告", description: "管理当前频道顶部公告" },
  users: { title: "用户与权限", description: "新增用户、修改资料与管理权限" },
  channels: { title: "频道与私聊历史", description: "正式频道和历史会话分别管理" },
  reception: { title: "会客厅", description: "查看创建者、期限和用量，不读取聊天内容" },
  channelDetail: { title: "频道详情", description: "修改频道资料、成员和访问权限" },
  appearance: { title: "外观与体验", description: "每项外观配置都在独立页面完成" },
  appearanceBrand: { title: "品牌与标签页", description: "浏览器标题、收藏图标和应用入口" },
  appearanceLogin: { title: "登录页", description: "登录内容、背景、位置与注册入口" },
  appearanceChat: { title: "聊天室外观", description: "聊天区壁纸和显示方式" },
  appearanceParallax: { title: "卷轴背景", description: "选择多层卷轴套件并调整相对移动速度" },
  appearanceThemes: { title: "主题颜色", description: "创建和维护聊天室配色" },
  appearanceFlash: { title: "消息闪动特效", description: "配置闪动消息的颜色和节奏" },
  data: { title: "数据与系统", description: "备份、聊天记录、资源和审计记录" },
  backups: { title: "备份与迁移", description: "完整备份及聊天、用户数据导入导出" },
  messages: { title: "聊天记录", description: "按频道选择或清理聊天消息" },
  resources: { title: "资源管理", description: "查看、筛选、压缩和删除附件" },
  books: { title: "图书", description: "上传 EPUB 图书，管理图书室藏书" },
  wechatRelay: { title: "微信通知转发", description: "连接 NAS 微信、选择来源频道并测试发送" },
  demo: { title: "演示模式", description: "从 GitHub 载入或复位标准演示数据" },
  release: { title: "版本与更新", description: "当前版本、更新状态和发布记录" }
};

interface UseAdminToolsOptions extends AppearanceStyleHelpers {
  showAdmin: Ref<boolean>;
  showSettings: Ref<boolean>;
  showChatToolsMenu: Ref<boolean>;
  saveReadPosition: () => void;
  restoreChatSurface: () => Promise<void>;
  checkForUpdates: () => Promise<void>;
  ensureReleaseHistory: () => Promise<void>;
  pinnedNoticeText: () => string;
  replaceChannelSnapshot: (channel: ChannelDTO) => void;
  authMode: Ref<"login" | "register" | "reception">;
  activePalette: () => ThemePaletteDTO;
  flashEffect: () => FlashEffectSettingsDTO;
  flashEffectStep: Ref<number>;
}

export function useAdminTools(options: UseAdminToolsOptions) {
  const store = useChatStore();
  const isAdmin = computed(() => !!store.account?.isAdmin);

  const adminPage = ref<AdminPage>("home");
  const adminPageLoading = ref(false);
  const adminPageError = ref("");
  const adminMsg = ref("");
  const noticeText = ref("");
  const adminChannels = ref<AdminChannelDTO[]>([]);
  const adminDirectConversations = ref<AdminChannelDTO[]>([]);
  const adminDirectTotal = ref(0);
  const adminDirectPage = ref(1);
  const adminDirectQuery = ref("");
  const adminSelectedChannelId = ref<number | null>(null);
  const channelEdits = ref<Record<number, { name: string; description: string; listColor: string; useListColor: boolean }>>({});
  const adminAttachments = ref<AdminAttachmentDTO[]>([]);
  const adminAttachmentsLoading = ref(false);
  const adminAttachmentsError = ref("");
  const adminBackups = ref<AdminBackupDTO[]>([]);
  const adminBackupBusy = ref(false);
  const adminLoginLogs = ref<AdminLoginLogDTO[]>([]);
  const adminLoginLogsBusy = ref(false);
  const adminLoginLogsMsg = ref("");
  const activityLogFilter = ref<"all" | ActivityLogCategory>("all");
  const dataChannelFilter = ref(0);
  const devices = ref<DeviceSessionDTO[]>([]);

  const adminChannelRows = computed(() => adminChannels.value);
  const adminSelectedChannel = computed(() => adminChannels.value.find((channel) => channel.id === adminSelectedChannelId.value) || null);
  const adminDirectPageCount = computed(() => Math.max(1, Math.ceil(adminDirectTotal.value / adminDirectPageSize)));
  const activeAdminPageMeta = computed(() => {
    if (adminPage.value === "channelDetail" && adminSelectedChannel.value) {
      return { title: adminSelectedChannel.value.name, description: "频道详情" };
    }
    return adminPageMeta[adminPage.value];
  });

  async function loadAdminAttachments() {
    adminAttachmentsLoading.value = true;
    adminAttachmentsError.value = "";
    try {
      const result = await api<{ attachments: AdminAttachmentDTO[] }>("/api/admin/attachments");
      adminAttachments.value = result.attachments;
    } catch (error) {
      adminAttachmentsError.value = error instanceof Error ? error.message : "资源索引加载失败";
    } finally {
      adminAttachmentsLoading.value = false;
    }
  }

  const appearance = useAppearanceSettings({
    adminMsg,
    adminAttachments,
    loadAdminAttachments,
    authMode: options.authMode,
    activePalette: options.activePalette,
    flashEffect: options.flashEffect,
    flashEffectStep: options.flashEffectStep,
    wallpaperUrl: options.wallpaperUrl,
    paletteStyle: options.paletteStyle,
    wallpaperFitStyle: options.wallpaperFitStyle,
    readableTextColor: options.readableTextColor,
    cleanFlashEffectSettings: options.cleanFlashEffectSettings
  });

  async function saveNotice() {
    if (!store.currentChannelId) return;
    const result = await api<{ pinned: NonNullable<typeof store.pinned> | null }>(`/api/channels/${store.currentChannelId}/pinned`, {
      method: "POST",
      body: JSON.stringify({
        body: { blocks: noticeText.value.trim() ? [{ id: "notice", type: "text", text: noticeText.value }] : [] },
        active: !!noticeText.value.trim()
      })
    });
    store.pinned = result.pinned;
    adminMsg.value = "已更新置顶";
  }

  async function loadAdmin() {
    options.showChatToolsMenu.value = false;
    options.saveReadPosition();
    options.showAdmin.value = true;
    adminPage.value = "home";
    adminPageError.value = "";
    adminMsg.value = "";
    if (!isAdmin.value) return;
    noticeText.value = options.pinnedNoticeText();
  }

  async function loadAdminChannels(page = adminDirectPage.value) {
    if (!isAdmin.value) return;
    const params = new URLSearchParams({
      directPage: String(page),
      directPageSize: String(adminDirectPageSize)
    });
    if (adminDirectQuery.value.trim()) params.set("q", adminDirectQuery.value.trim());
    const result = await api<{
      channels: AdminChannelDTO[];
      directConversations: AdminChannelDTO[];
      directTotal: number;
      directPage: number;
    }>(`/api/admin/channels?${params.toString()}`);
    adminChannels.value = result.channels.filter(Boolean);
    adminDirectConversations.value = result.directConversations.filter(Boolean);
    adminDirectTotal.value = result.directTotal;
    adminDirectPage.value = result.directPage;
    syncChannelEdits();
  }

  async function openAdminPage(page: AdminPage) {
    const wasAppearancePage = adminAppearancePages.has(adminPage.value);
    const nextIsAppearancePage = adminAppearancePages.has(page);
    if (wasAppearancePage && !nextIsAppearancePage && page !== "appearance") {
      appearance.abandonAppearanceDraft();
      appearance.appearancePreviewOpen.value = false;
    }
    adminPage.value = page;
    adminPageError.value = "";
    adminMsg.value = "";
    const sectionByPage: Partial<Record<AdminPage, AppearanceSection>> = {
      appearanceBrand: "brand",
      appearanceLogin: "login",
      appearanceChat: "chat",
      appearanceParallax: "parallax",
      appearanceThemes: "themes",
      appearanceFlash: "flash"
    };
    if (sectionByPage[page]) appearance.appearanceSection.value = sectionByPage[page]!;
    adminPageLoading.value = true;
    try {
      if (page === "channels") await loadAdminChannels();
      if (nextIsAppearancePage || page === "resources") await loadAdminAttachments();
      if (page === "backups") await loadAdminBackups();
      if (page === "release") await Promise.all([options.checkForUpdates(), options.ensureReleaseHistory()]);
    } catch (error) {
      adminPageError.value = error instanceof Error ? error.message : "页面加载失败，请稍后重试";
    } finally {
      adminPageLoading.value = false;
    }
  }

  function openAdminChannelDetail(channel: AdminChannelDTO) {
    adminSelectedChannelId.value = channel.id;
    void openAdminPage("channelDetail");
  }

  function returnFromAdminPage() {
    if (adminPage.value === "channelDetail") {
      void openAdminPage("channels");
      return;
    }
    if (adminAppearancePages.has(adminPage.value)) {
      void openAdminPage("appearance");
      return;
    }
    if (["backups", "messages", "resources", "demo"].includes(adminPage.value)) {
      void openAdminPage("data");
      return;
    }
    void openAdminPage("home");
  }

  function searchDirectConversations() {
    adminDirectPage.value = 1;
    void openAdminPage("channels");
  }

  function changeDirectConversationPage(delta: number) {
    const nextPage = Math.min(adminDirectPageCount.value, Math.max(1, adminDirectPage.value + delta));
    if (nextPage === adminDirectPage.value) return;
    adminDirectPage.value = nextPage;
    void openAdminPage("channels");
  }

  async function loadAdminData() {
    await Promise.all([loadAdminAttachments(), loadAdminBackups()]);
  }

  async function loadAdminBackups() {
    const result = await api<{ backups: AdminBackupDTO[] }>("/api/admin/backups");
    adminBackups.value = result.backups;
  }

  async function loadAdminLoginLogs() {
    if (!store.account?.isAdmin) return;
    adminLoginLogsBusy.value = true;
    adminLoginLogsMsg.value = "";
    try {
      const params = new URLSearchParams({ limit: "300", category: activityLogFilter.value });
      const result = await api<{ logs: AdminLoginLogDTO[] }>(`/api/admin/activity-logs?${params.toString()}`);
      adminLoginLogs.value = result.logs;
    } catch (error) {
      adminLoginLogsMsg.value = error instanceof Error ? error.message : "活动日志加载失败";
    } finally {
      adminLoginLogsBusy.value = false;
    }
  }

  async function setActivityLogFilter(filter: "all" | ActivityLogCategory) {
    activityLogFilter.value = filter;
    await loadAdminLoginLogs();
  }

  async function loadDevices() {
    if (!store.account) return;
    const result = await api<{ sessions: DeviceSessionDTO[] }>("/api/me/sessions").catch(() => ({ sessions: [] }));
    devices.value = result.sessions;
  }

  async function revokeDevice(device: DeviceSessionDTO) {
    await api<{ current: boolean }>(`/api/me/sessions/${device.id}`, { method: "DELETE" });
    if (device.current) {
      await store.logout(false);
      options.showSettings.value = false;
      return;
    }
    await loadDevices();
  }

  async function clearAdminMessages(channelId = dataChannelFilter.value) {
    const channel = channelId ? store.channels.find((item) => item.id === channelId) : null;
    const label = channel ? `频道“${channel.name}”` : "全部频道";
    if (!confirm(`清除${label}的所有聊天记录？相关上传文件也会删除。`)) return;
    const url = channelId ? `/api/admin/messages?channelId=${channelId}` : "/api/admin/messages";
    const result = await api<{ deleted: number }>(url, { method: "DELETE" });
    adminMsg.value = `已清除 ${result.deleted} 条聊天记录`;
    await loadAdminData();
    await store.loadChannels(channelId || store.currentChannelId);
  }

  async function deleteAdminAttachments(ids: string[]) {
    if (!ids.length) return;
    if (!confirm(`删除选中的 ${ids.length} 个附件？关联消息会保留为删除提示。`)) return;
    const result = await api<{ deleted: number; requested: number }>("/api/admin/attachments", {
      method: "DELETE",
      body: JSON.stringify({ ids })
    });
    adminMsg.value = `已删除 ${result.deleted} 个文件，处理 ${result.requested} 条附件记录`;
    await loadAdminData();
    await store.loadChannels(store.currentChannelId);
  }

  async function deleteAllAdminAttachments() {
    if (!adminAttachments.value.length) return;
    if (!confirm("删除所有上传文件、语音、头像和壁纸？关联消息会保留为删除提示，外观引用会被移除。")) return;
    const result = await api<{ deleted: number; requested: number }>("/api/admin/attachments", {
      method: "DELETE",
      body: JSON.stringify({ all: true })
    });
    adminMsg.value = `已删除 ${result.deleted} 个文件，处理 ${result.requested} 条附件记录`;
    await loadAdminData();
    await store.loadChannels(store.currentChannelId);
  }

  async function createAdminBackup() {
    if (adminBackupBusy.value) return;
    adminBackupBusy.value = true;
    adminMsg.value = "正在创建完整备份...";
    try {
      const result = await api<{ backup?: AdminBackupDTO }>("/api/admin/backups", { method: "POST" });
      await loadAdminBackups();
      if (result.backup) {
        await downloadAdminFile(result.backup.url, result.backup.fileName);
        adminMsg.value = `备份已创建并开始下载：${result.backup.fileName}`;
      } else {
        adminMsg.value = "备份已创建";
      }
    } catch (e: any) {
      adminMsg.value = e?.message || "备份失败";
    } finally {
      adminBackupBusy.value = false;
    }
  }

  async function deleteAdminBackup(backup: AdminBackupDTO) {
    if (!confirm(`删除备份“${backup.fileName}”？`)) return;
    const result = await api<{ backups: AdminBackupDTO[] }>(backup.url, { method: "DELETE" });
    adminBackups.value = result.backups;
    adminMsg.value = "备份已删除";
  }

  async function compressAdminAttachments(ids: string[]) {
    const targets = ids.filter(isImageAttachmentId);
    if (!targets.length) return;
    const result = await api<{ compressed: number; skipped: number; savedBytes: number; attachments: AdminAttachmentDTO[] }>("/api/admin/attachments/compress", {
      method: "POST",
      body: JSON.stringify({ ids: targets })
    });
    adminMsg.value = `已压缩 ${result.compressed} 张图片，跳过 ${result.skipped} 张，节省 ${compactBytes(result.savedBytes)}`;
    adminAttachments.value = result.attachments;
    await store.loadChannels(store.currentChannelId);
  }

  function syncChannelEdits() {
    const rows = adminChannelRows.value;
    channelEdits.value = Object.fromEntries(
      rows.map((channel) => [
        channel.id,
        {
          name: channel.name,
          description: channel.description || "",
          listColor: channel.listColor || "#e8f4ec",
          useListColor: !!channel.listColor
        }
      ])
    );
  }

  async function downloadAdminFile(url: string, filename: string) {
    const response = await fetch(url, { headers: authHeaders() });
    if (!response.ok) {
      const result = await response.json().catch(() => ({ message: "下载失败" }));
      alert(result.message || "下载失败");
      return;
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  }

  async function importAdminFile(url: string, event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    (event.target as HTMLInputElement).value = "";
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(url, { method: "POST", headers: authHeaders(), body: form });
    if (!response.ok) {
      const result = await response.json().catch(() => ({ message: "导入失败" }));
      alert(result.message || "导入失败");
      return;
    }
    await store.loadChannels();
    syncChannelEdits();
    adminMsg.value = "导入完成";
  }

  async function closeAdminPanel() {
    if (adminAppearancePages.has(adminPage.value)) appearance.abandonAppearanceDraft();
    options.showAdmin.value = false;
    appearance.appearancePreviewOpen.value = false;
    await options.restoreChatSurface();
  }

  async function updateChannel(channel: ChannelDTO) {
    const edit = channelEdits.value[channel.id];
    if (!edit) return;
    const result = await api<{ channel: ChannelDTO }>(`/api/channels/${channel.id}`, {
      method: "PATCH",
      body: JSON.stringify(channel.kind === "music"
        ? { listColor: edit.useListColor ? edit.listColor : null }
        : { name: edit.name, description: edit.description, listColor: edit.useListColor ? edit.listColor : null })
    });
    options.replaceChannelSnapshot(result.channel);
    syncChannelEdits();
    adminMsg.value = "频道已更新";
  }

  async function uploadChannelIcon(channel: ChannelDTO, event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    (event.target as HTMLInputElement).value = "";
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(`/api/channels/${channel.id}/icon`, { method: "POST", headers: authHeaders(), body: form });
    if (!response.ok) {
      const result = await response.json().catch(() => ({ message: "频道图标上传失败" }));
      alert(result.message || "频道图标上传失败");
      return;
    }
    const result = (await response.json()) as { channel: ChannelDTO };
    options.replaceChannelSnapshot(result.channel);
    syncChannelEdits();
    adminMsg.value = "频道图标已更新";
  }

  async function deleteChannel(channel: ChannelDTO) {
    if (channel.isDefault || channel.directKey || !channel.canManage) return;
    if (!confirm(`删除频道“${channel.name}”？频道内聊天记录会一并删除。`)) return;
    const fallbackChannelId = channel.id === store.currentChannelId ? store.previousChannelId : store.currentChannelId;
    await api(`/api/channels/${channel.id}`, { method: "DELETE" });
    await Promise.all([store.loadChannels(fallbackChannelId), loadAdminChannels()]);
    syncChannelEdits();
    adminMsg.value = `频道“${channel.name}”已删除`;
  }

  async function deleteDirectConversation(channel: AdminChannelDTO) {
    const label = directConversationLabel(channel);
    if (!confirm(`永久删除“${label}”的私聊历史？其中 ${channel.messageCount} 条消息和附件会一并删除，且无法恢复。`)) return;
    const fallbackChannelId = channel.id === store.currentChannelId ? store.previousChannelId : store.currentChannelId;
    await api(`/api/admin/direct-conversations/${channel.id}`, { method: "DELETE" });
    if (channel.id === store.currentChannelId) await store.loadChannels(fallbackChannelId);
    const targetPage = adminDirectConversations.value.length === 1 && adminDirectPage.value > 1 ? adminDirectPage.value - 1 : adminDirectPage.value;
    await loadAdminChannels(targetPage);
    adminMsg.value = `私聊历史“${label}”已删除`;
  }

  return {
    adminPage,
    adminPageLoading,
    adminPageError,
    adminMsg,
    noticeText,
    adminChannels,
    adminDirectConversations,
    adminDirectTotal,
    adminDirectPage,
    adminDirectQuery,
    adminSelectedChannelId,
    channelEdits,
    adminAttachments,
    adminAttachmentsLoading,
    adminAttachmentsError,
    adminBackups,
    adminBackupBusy,
    adminLoginLogs,
    adminLoginLogsBusy,
    adminLoginLogsMsg,
    activityLogFilter,
    dataChannelFilter,
    devices,
    adminChannelRows,
    adminSelectedChannel,
    adminDirectPageCount,
    adminAppearancePages,
    activeAdminPageMeta,
    saveNotice,
    loadAdmin,
    loadAdminChannels,
    openAdminPage,
    openAdminChannelDetail,
    returnFromAdminPage,
    searchDirectConversations,
    changeDirectConversationPage,
    loadAdminData,
    loadAdminAttachments,
    loadAdminBackups,
    loadAdminLoginLogs,
    setActivityLogFilter,
    loadDevices,
    revokeDevice,
    clearAdminMessages,
    deleteAdminAttachments,
    deleteAllAdminAttachments,
    createAdminBackup,
    deleteAdminBackup,
    compressAdminAttachments,
    syncChannelEdits,
    downloadAdminFile,
    importAdminFile,
    closeAdminPanel,
    updateChannel,
    uploadChannelIcon,
    deleteChannel,
    deleteDirectConversation,
    adminDate,
    adminDateTime,
    loginLogKindLabel,
    loginLogTone,
    displayedDeviceName,
    activityStateLabel,
    activityDuration,
    musicProgressSummary,
    backgroundAttachmentLabel,
    isImageAttachmentId,
    directConversationLabel,
    directConversationActivity,
    ...appearance
  };
}

export type AdminTools = ReturnType<typeof useAdminTools>;
