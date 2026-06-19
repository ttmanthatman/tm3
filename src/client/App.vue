<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  AtSign,
  Bell,
  BellOff,
  BookOpen,
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  CloudRain,
  Droplet,
  Download,
  FilePlus,
  FileUp,
  CheckCircle2,
  CircleOff,
  HeartHandshake,
  Image as ImageIcon,
  Info,
  LogOut,
  Menu,
  MessageSquareQuote,
  MessageCircle,
  Mic,
  Monitor,
  Pause,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  PartyPopper,
  Pin,
  Plane,
  Play,
  Plus,
  RotateCcw,
  Save,
  Send,
  Sparkles,
  Smartphone,
  Settings,
  Square,
  Sun,
  Tablet,
  Trash2,
  Upload,
  Users,
  Vibrate,
  Waves,
  WandSparkles,
  X
} from "lucide-vue-next";
import type {
  AccountDTO,
  AdminAttachmentDTO,
  AppearanceDTO,
  AiSettingsDTO,
  BibleLookupDTO,
  ChainPayload,
  ChannelDTO,
  DeviceSessionDTO,
  FlashEffectSettingsDTO,
  MessageDTO,
  MessageEffect,
  MessageEffectPayload,
  PrayerPayload,
  PrayerStatus,
  UpdateCheckDTO,
  UpdateStatusDTO,
  VersionDTO,
  ThemeDTO,
  ThemePaletteDTO
} from "@shared/types";
import { api, authHeaders, getToken, login, register } from "./api";
import { compactBytes, formatSeparator, shouldShowSeparator } from "./time";
import { useChatStore } from "./store";
import { APP_VERSION, RELEASE_DATE, RELEASE_DEVELOPER, RELEASE_HISTORY, RELEASE_NOTES } from "@shared/release";

const store = useChatStore();
type UploadStatus = "uploading" | "processing" | "failed";
type PendingUpload = {
  file: File;
  options: { voice?: boolean; durationMs?: number; waveform?: number[] };
  progress: number;
  status: UploadStatus;
  message?: string;
};
const username = ref("");
const password = ref("");
const displayName = ref("");
const authMode = ref<"login" | "register">("login");
const loginError = ref("");
const input = ref("");
const composerCaret = ref(0);
const composerSuggestionIndex = ref(0);
const composerSuggestionSuppressed = ref(false);
const replyTo = ref<MessageDTO | null>(null);
const showChannels = ref(false);
const showMembers = ref(false);
const channelsCollapsed = ref(false);
const membersCollapsed = ref(false);
const showAdmin = ref(false);
const showSettings = ref(false);
const isAiSettingsRoute = ref(window.location.pathname === "/ai-settings");
const fileInput = ref<HTMLInputElement | null>(null);
const photoInput = ref<HTMLInputElement | null>(null);
const composerInput = ref<HTMLTextAreaElement | null>(null);
const scroller = ref<HTMLElement | null>(null);
const rainCanvas = ref<HTMLCanvasElement | null>(null);
const dripLayer = ref<HTMLElement | null>(null);
const adminTab = ref<"users" | "channels" | "virtuals" | "pin" | "appearance" | "data" | "release">("pin");
const settingsTab = ref<"appearance" | "devices" | "notifications" | "release">("appearance");
const adminMsg = ref("");
const newUser = ref({ username: "", displayName: "", password: "" });
const newChannel = ref({ name: "", description: "", isPrivate: false });
const newVirtual = ref({ username: "", displayName: "" });
const virtuals = ref<any[]>([]);
const accounts = ref<any[]>([]);
const accountEdits = ref<Record<number, { displayName: string; isAdmin: boolean; password: string }>>({});
const channelEdits = ref<Record<number, { name: string; description: string }>>({});
type WallpaperFit = AppearanceDTO["wallpaperFit"];
type LoginFormPosition = AppearanceDTO["loginFormPosition"];
const wallpaperFitOptions: Array<{ value: WallpaperFit; label: string }> = [
  { value: "cover", label: "填满" },
  { value: "contain", label: "适合" },
  { value: "stretch", label: "拉伸" },
  { value: "repeat", label: "平铺" }
];
const loginPositionOptions: Array<{ value: LoginFormPosition; label: string }> = [
  { value: "top", label: "上" },
  { value: "middle", label: "中" },
  { value: "bottom", label: "下" }
];
const loginAppearanceEdit = ref({
  appTitle: "Team Chat",
  loginTitle: "Team Chat",
  loginSubtitle: "轻快、稳定的团队聊天。",
  loginShowIcon: true,
  loginShowSubtitle: true,
  loginFormPosition: "middle" as LoginFormPosition,
  loginBackgroundFit: "cover" as WallpaperFit,
  wallpaperFit: "cover" as WallpaperFit,
  registrationEnabled: false
});
const flashEffectEdit = ref<FlashEffectSettingsDTO>({
  colors: ["#fff176", "#ef4444", "#60a5fa", "#6d28d9", "#34d399", "#111827"],
  intervalSeconds: 0.4,
  transitionMode: "smooth"
});
const flashEffectStep = ref(0);
let flashEffectTimer = 0;
const adminAttachments = ref<AdminAttachmentDTO[]>([]);
const selectedAttachmentIds = ref<string[]>([]);
const dataChannelFilter = ref(0);
const devices = ref<DeviceSessionDTO[]>([]);
const notificationMsg = ref("");
const notificationPublicKey = ref("");
const notificationPermission = ref(typeof Notification === "undefined" ? "default" : Notification.permission);
const notificationEnabled = ref(false);
const notificationBusy = ref(false);
const mutedChannelIds = ref<Set<number>>(new Set());
const aiSettings = ref<AiSettingsDTO | null>(null);
const aiSettingsEdit = ref({
  enabled: true,
  apiKey: "",
  clearApiKey: false,
  promptCommand: "",
  cardCooldownSeconds: 30,
  userLimitPerMinute: 3,
  maxSuccessPerMessage: 7
});
const aiSettingsBusy = ref(false);
const aiSettingsMsg = ref("");
const aiSettingsShowAdvanced = ref(false);
const noticeText = ref("");
const pinnedExpanded = ref(false);
const showChainModal = ref(false);
const chainTopic = ref("");
const pendingChain = ref<MessageDTO | null>(null);
const pendingDownload = ref<MessageDTO | null>(null);
const pendingRecall = ref<MessageDTO | null>(null);
const pendingPrayer = ref<MessageDTO | null>(null);
const expandedAiSuggestionMessageIds = ref<Set<number>>(new Set());
const aiSuggestionBusyIds = ref<Set<number>>(new Set());
const aiSuggestionErrors = ref<Record<number, string>>({});
const expandedBibleReferenceKeys = ref<Set<string>>(new Set());
const bibleLookupCache = ref<Record<string, BibleLookupDTO | null>>({});
const bibleLookupBusyKeys = ref<Set<string>>(new Set());
const previewMessage = ref<MessageDTO | null>(null);
const imagePreviewScale = ref(1);
const imagePreviewOffset = ref({ x: 0, y: 0 });
const chainPromptPosition = ref({ x: 0, y: 0 });
const downloadPromptPosition = ref({ x: 0, y: 0 });
const recallPromptPosition = ref({ x: 0, y: 0 });
const prayerPromptPosition = ref({ x: 0, y: 0 });
const memberPromptPosition = ref({ x: 0, y: 0 });
type MemberActionTarget = { id: number; accountId?: number; kind: string; username?: string; displayName: string; avatarPath?: string | null; role?: string };
const selectedMember = ref<MemberActionTarget | null>(null);
type MentionToast = { id: number; channelId: number; channelName: string; senderName: string; text: string };
type TopNotice = {
  id: string;
  kind: "mention" | "typing";
  title: string;
  body: string;
  channelId?: number;
  messageId?: number;
};
const mentionToasts = ref<MentionToast[]>([]);
const acknowledgedMentionIds = ref<Set<number>>(new Set());
const topNoticeIndex = ref(0);
const pausedEffectIds = ref<Set<number>>(new Set());
const messageSelectionMode = ref(false);
const selectedMessageIds = ref<Set<number>>(new Set());
const pendingCloseChannel = ref<ChannelDTO | null>(null);
const composerPanel = ref<"voice" | "more" | null>(null);
const mediaRecorder = ref<MediaRecorder | null>(null);
const audioChunks = ref<Blob[]>([]);
const isRecording = ref(false);
const audioPreviewUrl = ref("");
const audioFile = ref<File | null>(null);
const audioPreviewWaveform = ref<number[]>([]);
const audioPreviewDurationMs = ref(0);
const previewAudioEl = ref<HTMLAudioElement | null>(null);
const previewPlaying = ref(false);
const previewProgress = ref(0);
const pendingUploads = ref<Record<number, PendingUpload>>({});
const voiceSending = ref(false);
const playingVoiceId = ref<number | null>(null);
const voiceProgress = ref<Record<number, number>>({});
const voiceDurations = ref<Record<number, number>>({});
const recordingDuration = ref(0);
const recordingStatus = ref("");
const serverVersion = ref<VersionDTO | null>(null);
const staleVersionVisible = ref(false);
const staleVersionMessage = ref("");
const updateCheck = ref<UpdateCheckDTO | null>(null);
const updateStatus = ref<UpdateStatusDTO | null>(null);
const updateBusy = ref(false);
const rainActive = ref(false);
const waterTilt = ref({ x: 0, y: 0 });
const hasUnreadMessages = ref(false);
let recordingTimer: number | undefined;
let versionCheckTimer: number | undefined;
let updateStatusTimer: number | undefined;
let rainAnimationFrame: number | undefined;
let rainUntil = 0;
let rainDrops: RainDrop[] = [];
let dripAnimationFrame: number | undefined;
let dripLastFrame = 0;
let dripLastSpawn = 0;
let dripParticles: DripParticle[] = [];
let loadingHistoryFromScroll = false;
let loadingNewerFromScroll = false;
const voicePlayers = new Map<number, HTMLAudioElement>();
const longPressMs = 520;
const rainDurationMs = 15_000;
const playedRainEffectIds = new Set<number>();
let longPressTimer: number | undefined;
let longPressStartedAt = { x: 0, y: 0 };
let suppressNextTapUntil = 0;
let imagePanStart = { x: 0, y: 0, offsetX: 0, offsetY: 0 };
let imagePinchStart: { distance: number; scale: number } | null = null;
let topNoticeTimer: number | undefined;
let deviceOrientationPermissionRequested = false;
const defaultPalette: ThemePaletteDTO = {
  accent: "#1aad19",
  accentDark: "#129611",
  buttonText: "#ffffff",
  bg: "#ededed",
  chatBg: "#ededed",
  panel: "#f7f7f7",
  line: "#d9d9d9",
  text: "#111111",
  muted: "#7b7b7b",
  bubbleOther: "#ffffff",
  bubbleOtherText: "#111111",
  bubbleMine: "#95ec69",
  bubbleMineText: "#111111"
};
const builtInThemes: ThemeDTO[] = [
  { id: "wechat", name: "微信绿", palette: { ...defaultPalette } },
  {
    id: "jade",
    name: "竹影",
    palette: {
      ...defaultPalette,
      accent: "#0f8f72",
      accentDark: "#0a6f5d",
      bg: "#e8efed",
      chatBg: "#edf4f1",
      panel: "#f7faf8",
      line: "#cfded9",
      text: "#13201d",
      muted: "#64756f",
      bubbleOther: "#ffffff",
      bubbleMine: "#bfead8"
    }
  },
  {
    id: "paper",
    name: "纸墨",
    palette: {
      ...defaultPalette,
      accent: "#33658a",
      accentDark: "#274c68",
      bg: "#f1f0ea",
      chatBg: "#f6f5ef",
      panel: "#fbfaf6",
      line: "#ddd8ca",
      text: "#202124",
      muted: "#6f6a61",
      bubbleOther: "#ffffff",
      bubbleMine: "#d7e7f3"
    }
  },
  {
    id: "night",
    name: "夜航",
    palette: {
      ...defaultPalette,
      accent: "#35a7ff",
      accentDark: "#1e7ec4",
      buttonText: "#07131f",
      bg: "#171b20",
      chatBg: "#1d232a",
      panel: "#222932",
      line: "#3a4450",
      text: "#f5f7fa",
      muted: "#a8b3bf",
      bubbleOther: "#2c343e",
      bubbleOtherText: "#f5f7fa",
      bubbleMine: "#245d82",
      bubbleMineText: "#ffffff"
    }
  }
];
const colorFields: Array<{ key: keyof ThemePaletteDTO; label: string }> = [
  { key: "accent", label: "按钮颜色" },
  { key: "accentDark", label: "按钮按下" },
  { key: "buttonText", label: "按钮文字" },
  { key: "bubbleMine", label: "我的气泡背景" },
  { key: "bubbleMineText", label: "我的气泡文字" },
  { key: "bubbleOther", label: "对方气泡背景" },
  { key: "bubbleOtherText", label: "对方气泡文字" },
  { key: "bg", label: "页面背景" },
  { key: "chatBg", label: "聊天区背景" },
  { key: "panel", label: "面板背景" },
  { key: "text", label: "主文字" },
  { key: "muted", label: "辅助文字" },
  { key: "line", label: "边框线" }
];
const customThemeEdit = ref<ThemeDTO>({ id: "", name: "我的主题", palette: { ...defaultPalette } });
type IconComponent = typeof Sparkles;
type RainDrop = { x: number; y: number; length: number; speed: number; width: number; sway: number; alpha: number };
type DripParticle = {
  el: HTMLSpanElement;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  sourceId: number;
};
const effectCommands: Array<{ command: string; effect: MessageEffect; label: string; hint: string; icon: IconComponent }> = [
  { command: "/闪动", effect: "flash", label: "闪动", hint: "气泡持续换色", icon: Sparkles },
  { command: "/流光", effect: "shine", label: "流光", hint: "文字金属反光", icon: WandSparkles },
  { command: "/震动", effect: "shake", label: "震动", hint: "气泡持续颤抖", icon: Vibrate },
  { command: "/飞机", effect: "fly", label: "飞机", hint: "文字横向循环飞行", icon: Plane },
  { command: "/光芒万丈", effect: "sunburst", label: "光芒万丈", hint: "气泡向外放射太阳光", icon: Sun },
  { command: "/跑马灯", effect: "marquee", label: "跑马灯", hint: "节日彩灯绕气泡追逐", icon: PartyPopper },
  { command: "/水波", effect: "water", label: "水波", hint: "气泡像水面一样荡漾", icon: Waves },
  { command: "/水滴", effect: "drip", label: "水滴", hint: "液滴下落并撞出水花", icon: Droplet },
  { command: "/下雨", effect: "rain", label: "下雨", hint: "聊天室下 15 秒大雨", icon: CloudRain }
];
const prayerCommand = { command: "/代祷", label: "代祷", hint: "生成频道代祷卡片", icon: HeartHandshake };
type SlashCommandSuggestion =
  | { kind: "prayer"; command: string; label: string; hint: string; icon: IconComponent }
  | ({ kind: "effect" } & (typeof effectCommands)[number]);

type VoicePayload = {
  kind?: string;
  durationMs?: number;
  waveform?: number[];
  mimeType?: string;
};

onMounted(async () => {
  hydratePlayedRainEffectIds();
  document.addEventListener("pointerdown", closeTapPromptsFromOutside);
  window.addEventListener("deviceorientation", handleDeviceOrientation, { passive: true });
  await store.bootstrap();
  if (isAiSettingsRoute.value && store.account?.isAdmin) await loadAiSettings();
  await checkServerVersion();
  versionCheckTimer = window.setInterval(() => void checkServerVersion(), 60_000);
  await switchToLinkedChannel();
  scrollBottom(false);
});

watch(
  () => [store.currentChannelId, store.prayerOnly] as const,
  () => {
    stopAllVoicePlayback();
    selectedMember.value = null;
    pendingCloseChannel.value = null;
    pendingChain.value = null;
    pendingDownload.value = null;
    pendingRecall.value = null;
    pendingPrayer.value = null;
    selectedMessageIds.value = new Set();
    messageSelectionMode.value = false;
    composerPanel.value = null;
    hasUnreadMessages.value = false;
    nextTick(() => {
      scrollBottom(false);
    });
  }
);

watch(
  () => store.messages.length,
  (length, previousLength) => {
    const latest = store.messages[store.messages.length - 1];
    const shouldFollow = !store.loadingOlderMessages && (!previousLength || length < previousLength || isNearMessageBottom(220) || (latest ? isMine(latest) : false));
    nextTick(() => {
      if (shouldFollow) scrollBottom(false);
    });
  }
);

watch(
  () => store.lastIncomingMessage?.id,
  () => {
    if (store.lastIncomingMessage) {
      queueMentionToast(store.lastIncomingMessage);
      triggerOneShotMessageEffects(store.lastIncomingMessage);
      if (store.lastIncomingMessage.channelId === store.currentChannelId && !isMine(store.lastIncomingMessage) && !isNearMessageBottom(220)) {
        hasUnreadMessages.value = true;
      }
    }
  }
);

watch(
  () => [store.messages.map((message) => `${message.id}:${messageEffect(message) || "none"}`).join("|"), [...pausedEffectIds.value].join(",")] as const,
  () => {
    nextTick(() => ensureDripPhysics());
  },
  { flush: "post" }
);

watch(
  () => topNoticeItems.value.length,
  (length) => {
    if (topNoticeIndex.value >= length) topNoticeIndex.value = 0;
    if (topNoticeTimer) {
      window.clearInterval(topNoticeTimer);
      topNoticeTimer = undefined;
    }
    if (length > 1) {
      topNoticeTimer = window.setInterval(() => {
        topNoticeIndex.value = (topNoticeIndex.value + 1) % Math.max(1, topNoticeItems.value.length);
      }, 3600);
    }
  },
  { immediate: true }
);

watch(
  () => store.account?.id,
  () => {
    mentionToasts.value = [];
    acknowledgedMentionIds.value = loadAcknowledgedMentionIds();
    topNoticeIndex.value = 0;
  },
  { immediate: true }
);

watch(
  () => store.account?.isAdmin,
  (isAdminAccount) => {
    if (isAiSettingsRoute.value && isAdminAccount) void loadAiSettings();
  }
);

watch(
  () => store.channels.map((channel) => `${channel.id}:${channel.name}:${channel.description}:${channel.icon}`).join("|"),
  () => syncChannelEdits()
);

watch(
  () => store.appearance,
  () => {
    syncLoginAppearanceEdit();
    applyAppChrome();
  },
  { deep: true, immediate: true }
);

watch(adminTab, (tab) => {
  if (tab === "appearance" && showAdmin.value) void loadAdminAttachments();
  if (tab === "data" && showAdmin.value) loadAdminData();
  if (tab === "release" && showAdmin.value) void checkForUpdates();
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", closeTapPromptsFromOutside);
  window.removeEventListener("deviceorientation", handleDeviceOrientation);
  if (topNoticeTimer) window.clearInterval(topNoticeTimer);
  if (versionCheckTimer) window.clearInterval(versionCheckTimer);
  if (updateStatusTimer) window.clearInterval(updateStatusTimer);
  if (flashEffectTimer) window.clearInterval(flashEffectTimer);
  stopRainEffect();
  stopDripPhysics(true);
  stopAllVoicePlayback();
  resetRecording();
});

const currentChannel = computed(() => store.currentChannel);
const typingNoticeItems = computed<TopNotice[]>(() =>
  Object.entries(store.typing).map(([actorId, item]) => ({
    id: `typing-${actorId}`,
    kind: "typing",
    title: `${item.displayName} 正在输入`,
    body: currentChannel.value?.name || "当前频道",
    channelId: store.currentChannelId
  }))
);
const mentionNoticeItems = computed<TopNotice[]>(() =>
  mentionToasts.value.map((toast) => ({
    id: `mention-${toast.id}`,
    kind: "mention",
    title: `${toast.senderName} @了你`,
    body: `${toast.channelName} · ${toast.text}`,
    channelId: toast.channelId,
    messageId: toast.id
  }))
);
const topNoticeItems = computed<TopNotice[]>(() => [...mentionNoticeItems.value, ...typingNoticeItems.value]);
const activeTopNotice = computed(() => topNoticeItems.value[topNoticeIndex.value % Math.max(1, topNoticeItems.value.length)] || null);
const isAdmin = computed(() => !!store.account?.isAdmin);
const themeOptions = computed<ThemeDTO[]>(() => [...builtInThemes, ...(store.appearance.customThemes || [])]);
const activeTheme = computed(() => (themeOptions.value.some((theme) => theme.id === store.account?.theme) ? store.account?.theme || "wechat" : "wechat"));
const activeThemeConfig = computed(() => themeOptions.value.find((theme) => theme.id === activeTheme.value) || builtInThemes[0]);
const activePalette = computed(() => activeThemeConfig.value.palette);
const themeStyle = computed(() => paletteStyle(activePalette.value));
const flashEffect = computed(() => cleanFlashEffectSettings(store.appearance.flashEffect));
const activeFlashColor = computed(() => {
  const colors = flashEffect.value.colors;
  return colors[flashEffectStep.value % colors.length] || colors[0];
});
const hasWallpaper = computed(() => !!store.appearance.wallpaperPath);
const hasLoginBackground = computed(() => !!store.appearance.loginBackgroundPath);
const wallpaperBackground = computed(() => wallpaperFitStyle(store.appearance.wallpaperFit));
const loginBackground = computed(() => wallpaperFitStyle(store.appearance.loginBackgroundFit));
const appearanceStyle = computed(() => ({
  ...themeStyle.value,
  "--message-flash-bg": activeFlashColor.value,
  "--message-flash-text": readableTextColor(activeFlashColor.value),
  "--message-flash-interval": `${flashEffect.value.intervalSeconds}s`,
  "--water-tilt-x": `${waterTilt.value.x.toFixed(2)}px`,
  "--water-tilt-y": `${waterTilt.value.y.toFixed(2)}px`,
  "--water-tilt-rotate": `${(waterTilt.value.x * 0.26).toFixed(2)}deg`,
  "--wallpaper-image": hasWallpaper.value ? `url("${wallpaperUrl(store.appearance.wallpaperPath)}")` : "none",
  "--wallpaper-size": wallpaperBackground.value.size,
  "--wallpaper-repeat": wallpaperBackground.value.repeat,
  "--login-background-image": hasLoginBackground.value ? `url("${wallpaperUrl(store.appearance.loginBackgroundPath)}")` : "none",
  "--login-background-size": loginBackground.value.size,
  "--login-background-repeat": loginBackground.value.repeat
}));

watch(
  () => `${flashEffect.value.colors.join(",")}:${flashEffect.value.intervalSeconds}:${flashEffect.value.transitionMode}`,
  () => restartFlashEffectTimer(),
  { immediate: true }
);

const loginShellClass = computed(() => `login-position-${store.appearance.loginFormPosition || "middle"}`);
const canDeleteCurrentChannel = computed(() => !!currentChannel.value?.canManage && !currentChannel.value.isDefault && !currentChannel.value.directKey);
const messageLoadBanner = computed(() => {
  if (store.messageLoadError) return { kind: "error", text: `${store.messageLoadError}，点按重试` };
  if (store.loadingInitialMessages && !store.messages.length) return { kind: "loading", text: "正在加载最近消息..." };
  if (store.loadingOlderMessages) return { kind: "loading", text: "正在加载更早消息..." };
  if (store.loadingNewerMessages) return { kind: "loading", text: "正在加载较新消息..." };
  if (store.oldestMessageReached && store.messages.length && !store.hasOlderMessages && !store.prefetchedOlderMessages.length) return { kind: "done", text: "已到最早消息" };
  return null;
});
const pinnedText = computed(() => {
  const pinned = store.pinned;
  if (!pinned) return "";
  if (pinned.kind === "notice") return pinned.content || "置顶公告";
  const message = pinned.message;
  if (!message) return "置顶消息";
  if (message.type === "chain") return `接龙：${chainPayload(message).topic}`;
  if (message.type === "image") return "[图片]";
  if (message.type === "file") return message.fileName || "[文件]";
  return message.content || "置顶消息";
});
const releaseHistory = computed(() => RELEASE_HISTORY.filter((release) => release.version !== APP_VERSION));
const releaseDeveloper = computed(() => serverVersion.value?.developer || RELEASE_DEVELOPER);
const selectedAttachmentCount = computed(() => selectedAttachmentIds.value.length);
const allAttachmentsSelected = computed(() => adminAttachments.value.length > 0 && selectedAttachmentIds.value.length === adminAttachments.value.length);
const backgroundAttachmentOptions = computed(() => adminAttachments.value.filter((item) => item.kind === "background" && item.url));
const selectableMessages = computed(() => store.messages.filter((message) => message.id > 0));
const selectedMessageCount = computed(() => selectedMessageIds.value.size);
const visibleMessagesSelected = computed(() => selectableMessages.value.length > 0 && selectableMessages.value.every((message) => selectedMessageIds.value.has(message.id)));
const notificationSupported = computed(() => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window);
const notificationPermissionLabel = computed(() => {
  if (!notificationSupported.value) return "当前浏览器不支持";
  if (notificationPermission.value === "granted") return "已允许";
  if (notificationPermission.value === "denied") return "已拒绝";
  return "未开启";
});
const slashCommandToken = computed(() => slashCommandTokenAtCursor(input.value, composerCaret.value));
const matchingSlashCommands = computed<SlashCommandSuggestion[]>(() => {
  const token = slashCommandToken.value;
  if (!token) return [];
  if (token.kind === "prayer-effect") {
    return effectCommands.filter((item) => item.command.startsWith(token.query)).map((item) => ({ ...item, kind: "effect" as const }));
  }
  return [
    { ...prayerCommand, kind: "prayer" as const },
    ...effectCommands.map((item) => ({ ...item, kind: "effect" as const }))
  ].filter((item) => item.command.startsWith(token.query));
});
const mentionToken = computed(() => mentionTokenAtCursor(input.value, composerCaret.value));
const matchingMentionMembers = computed(() => {
  const token = mentionToken.value;
  if (!token) return [];
  const query = token.query.trim().toLowerCase();
  return store.members
    .filter((member) => {
      if (!member.displayName.trim()) return false;
      if (!query) return true;
      return member.displayName.toLowerCase().includes(query) || (member.username || "").toLowerCase().includes(query);
    })
    .slice(0, 8);
});
const activeComposerSuggestionKind = computed<"mention" | "effect" | null>(() => {
  if (matchingMentionMembers.value.length > 0) return "mention";
  if (matchingSlashCommands.value.length > 0) return "effect";
  return null;
});
const composerSuggestionCount = computed(() =>
  activeComposerSuggestionKind.value === "mention" ? matchingMentionMembers.value.length : matchingSlashCommands.value.length
);
const showComposerSuggestionMenu = computed(() => !composerSuggestionSuppressed.value && !!activeComposerSuggestionKind.value && composerSuggestionCount.value > 0);
watch(composerSuggestionCount, (count) => {
  if (composerSuggestionIndex.value >= count) composerSuggestionIndex.value = 0;
});
const canSendText = computed(() => !!parseComposerText(input.value).content);
const loginBrand = computed(() => ({
  iconPath: store.appearance.loginIconPath || "/images/icon-192.svg",
  showIcon: store.appearance.loginShowIcon !== false,
  title: store.appearance.loginTitle || "Team Chat",
  subtitle: store.appearance.loginSubtitle,
  showSubtitle: store.appearance.loginShowSubtitle !== false
}));
const chainPromptStyle = computed(() => ({
  left: `${chainPromptPosition.value.x}px`,
  top: `${chainPromptPosition.value.y}px`
}));
const memberPromptStyle = computed(() => ({
  left: `${memberPromptPosition.value.x}px`,
  top: `${memberPromptPosition.value.y}px`
}));
const downloadPromptStyle = computed(() => ({
  left: `${downloadPromptPosition.value.x}px`,
  top: `${downloadPromptPosition.value.y}px`
}));
const recallPromptStyle = computed(() => ({
  left: `${recallPromptPosition.value.x}px`,
  top: `${recallPromptPosition.value.y}px`
}));
const prayerPromptStyle = computed(() => ({
  left: `${prayerPromptPosition.value.x}px`,
  top: `${prayerPromptPosition.value.y}px`
}));
const updateProgress = computed(() => Math.min(100, Math.max(0, Number(updateStatus.value?.progress || 0))));
const updateStateText = computed(() => {
  const state = updateStatus.value?.state || "idle";
  if (state === "running") return "更新中";
  if (state === "complete") return "已完成";
  if (state === "failed") return "更新失败";
  return "未开始";
});
let nextPendingMessageId = -1;

function pendingUploadFor(message: MessageDTO) {
  return pendingUploads.value[message.id];
}

function pendingUploadLabel(upload: PendingUpload) {
  if (upload.status === "failed") return upload.message || "发送失败";
  if (upload.status === "processing") return upload.message || "正在发布";
  return `上传中 ${upload.progress}%`;
}

function setPendingUpload(id: number, patch: Partial<PendingUpload>) {
  const current = pendingUploads.value[id];
  if (!current) return;
  pendingUploads.value = { ...pendingUploads.value, [id]: { ...current, ...patch } };
}

function removePendingUpload(id: number) {
  const next = { ...pendingUploads.value };
  delete next[id];
  pendingUploads.value = next;
}

function pushPendingVoiceMessage(file: File, options: { durationMs?: number; waveform?: number[] }) {
  if (!store.currentChannelId || !store.account) return 0;
  const id = nextPendingMessageId;
  nextPendingMessageId -= 1;
  pendingUploads.value = {
    ...pendingUploads.value,
    [id]: {
      file,
      options: { voice: true, durationMs: options.durationMs, waveform: options.waveform },
      progress: 0,
      status: "uploading"
    }
  };
  store.appendLocalMessage({
    id,
    channelId: store.currentChannelId,
    sender: {
      id: store.account.actorId,
      kind: "human",
      username: store.account.username,
      displayName: store.account.displayName,
      avatarPath: store.account.avatarPath
    },
    content: "",
    type: "file",
    payload: { kind: "voice", durationMs: options.durationMs, waveform: options.waveform },
    fileName: file.name,
    fileSize: file.size,
    voiceListened: true,
    createdAt: new Date().toISOString()
  });
  void nextTick(() => scrollBottom(true));
  return id;
}

function replacePendingMessage(pendingId: number, message: MessageDTO) {
  store.replaceMessage(message, pendingId);
}

const timeline = computed(() => {
  const rows: Array<{ kind: "time"; label: string; id: string } | { kind: "message"; message: MessageDTO }> = [];
  let prev: string | undefined;
  for (const message of store.messages) {
    if (shouldShowSeparator(prev, message.createdAt)) rows.push({ kind: "time", label: formatSeparator(message.createdAt), id: `t-${message.id}` });
    rows.push({ kind: "message", message });
    prev = message.createdAt;
  }
  return rows;
});

function plainTextFromHtml(value: string) {
  const el = document.createElement("div");
  el.innerHTML = value;
  return (el.textContent || el.innerText || "").replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function messageMentionsCurrentUser(message: MessageDTO) {
  if (!store.account || isMine(message) || message.type !== "text") return false;
  const text = plainTextFromHtml(message.content);
  const names = [store.account.displayName, store.account.username].filter((name): name is string => !!name?.trim());
  return names.some((name) => {
    const pattern = new RegExp(`(^|[\\s，。！？、,.!?:;；：])@${escapeRegExp(name.trim())}(?=$|[\\s，。！？、,.!?:;；：])`);
    return pattern.test(text);
  });
}

function messagePreviewText(message: MessageDTO) {
  const text = plainTextFromHtml(message.content || message.fileName || "");
  return text.length > 48 ? `${text.slice(0, 48)}...` : text || "新消息";
}

function channelName(channelId: number) {
  return store.channels.find((channel) => channel.id === channelId)?.name || "聊天室";
}

function queueMentionToast(message: MessageDTO) {
  if (!messageMentionsCurrentUser(message) || mentionToasts.value.some((toast) => toast.id === message.id)) return;
  mentionToasts.value = [
    ...mentionToasts.value,
    {
      id: message.id,
      channelId: message.channelId,
      channelName: channelName(message.channelId),
      senderName: message.sender.displayName,
      text: messagePreviewText(message)
    }
  ].slice(-8);
}

function mentionAcknowledgementKey() {
  return store.account ? `team-chat-mention-acknowledged-${store.account.id}` : "";
}

function loadAcknowledgedMentionIds() {
  const key = mentionAcknowledgementKey();
  if (!key) return new Set<number>();
  try {
    const ids = JSON.parse(localStorage.getItem(key) || "[]");
    return new Set(Array.isArray(ids) ? ids.map(Number).filter(Number.isFinite) : []);
  } catch {
    return new Set<number>();
  }
}

function saveAcknowledgedMentionIds() {
  const key = mentionAcknowledgementKey();
  if (!key) return;
  const ids = [...acknowledgedMentionIds.value].slice(-500);
  localStorage.setItem(key, JSON.stringify(ids));
}

function isMentionAlertActive(message: MessageDTO) {
  return messageMentionsCurrentUser(message) && !acknowledgedMentionIds.value.has(message.id);
}

function acknowledgeMentionAlert(message: MessageDTO) {
  if (!isMentionAlertActive(message)) return false;
  acknowledgedMentionIds.value = new Set([...acknowledgedMentionIds.value, message.id]);
  saveAcknowledgedMentionIds();
  return true;
}

function isNearMessageBottom(distance = 96) {
  const el = scroller.value;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < distance;
}

async function jumpToMessageInChannel(channelId: number, messageId: number) {
  if (store.currentChannelId !== channelId) {
    await store.switchChannel(channelId);
    await nextTick();
  }
  jumpToReply(messageId);
}

async function openTopNotice(notice: TopNotice) {
  if (notice.kind !== "mention" || !notice.channelId || !notice.messageId) return;
  await jumpToMessageInChannel(notice.channelId, notice.messageId);
}

async function doLogin() {
  loginError.value = "";
  try {
    const account =
      authMode.value === "register"
        ? await register(username.value.trim(), displayName.value.trim(), password.value)
        : await login(username.value.trim(), password.value);
    await store.afterLogin(account);
    if (isAiSettingsRoute.value) {
      if (account.isAdmin) await loadAiSettings();
      return;
    }
    await switchToLinkedChannel();
    await nextTick();
    scrollBottom(false);
  } catch (error) {
    loginError.value = error instanceof Error ? error.message : authMode.value === "register" ? "注册失败" : "登录失败";
  }
}

async function switchToLinkedChannel() {
  const params = new URLSearchParams(window.location.search);
  const channelId = Number(params.get("channelId") || 0);
  if (!channelId || !store.channels.some((channel) => channel.id === channelId)) return;
  await store.switchChannel(channelId);
  params.delete("channelId");
  const nextQuery = params.toString();
  window.history.replaceState({}, "", `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash}`);
}

async function openSettings(tab: "appearance" | "devices" | "notifications" | "release" = "appearance") {
  settingsTab.value = tab;
  showSettings.value = true;
  if (tab === "devices") await loadDevices();
  if (tab === "notifications") await loadNotificationSettings();
  if (tab === "release") await checkServerVersion();
}

function returnToChat() {
  isAiSettingsRoute.value = false;
  window.history.pushState({}, "", "/");
}

function syncAiSettingsEdit(settings: AiSettingsDTO) {
  aiSettings.value = settings;
  aiSettingsEdit.value = {
    enabled: settings.enabled,
    apiKey: "",
    clearApiKey: false,
    promptCommand: settings.promptCommand,
    cardCooldownSeconds: settings.cardCooldownSeconds,
    userLimitPerMinute: settings.userLimitPerMinute,
    maxSuccessPerMessage: settings.maxSuccessPerMessage
  };
}

async function loadAiSettings() {
  if (!store.account?.isAdmin) return;
  aiSettingsBusy.value = true;
  aiSettingsMsg.value = "";
  try {
    syncAiSettingsEdit(await api<AiSettingsDTO>("/api/admin/ai-settings"));
  } catch (error) {
    aiSettingsMsg.value = error instanceof Error ? error.message : "AI 设置加载失败";
  } finally {
    aiSettingsBusy.value = false;
  }
}

async function saveAiSettings() {
  if (!store.account?.isAdmin) return;
  aiSettingsBusy.value = true;
  aiSettingsMsg.value = "";
  try {
    const payload = {
      enabled: aiSettingsEdit.value.enabled,
      apiKey: aiSettingsEdit.value.apiKey.trim() || undefined,
      clearApiKey: aiSettingsEdit.value.clearApiKey,
      promptCommand: aiSettingsEdit.value.promptCommand,
      cardCooldownSeconds: Number(aiSettingsEdit.value.cardCooldownSeconds),
      userLimitPerMinute: Number(aiSettingsEdit.value.userLimitPerMinute),
      maxSuccessPerMessage: Number(aiSettingsEdit.value.maxSuccessPerMessage)
    };
    syncAiSettingsEdit(await api<AiSettingsDTO>("/api/admin/ai-settings", { method: "POST", body: JSON.stringify(payload) }));
    aiSettingsMsg.value = "AI 设置已保存";
  } catch (error) {
    aiSettingsMsg.value = error instanceof Error ? error.message : "AI 设置保存失败";
  } finally {
    aiSettingsBusy.value = false;
  }
}

async function loadDevices() {
  if (!store.account) return;
  const result = await api<{ sessions: DeviceSessionDTO[] }>("/api/me/sessions").catch(() => ({ sessions: [] }));
  devices.value = result.sessions;
}

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) output[index] = raw.charCodeAt(index);
  return output;
}

async function currentPushSubscription() {
  if (!notificationSupported.value) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

async function loadNotificationSettings() {
  if (!store.account) return;
  notificationMsg.value = "";
  if ("Notification" in window) notificationPermission.value = Notification.permission;
  const result = await api<{ publicKey: string; pushReady: boolean; subscriptions: number; mutedChannelIds: number[] }>("/api/notifications/settings").catch(() => ({
    publicKey: "",
    pushReady: false,
    subscriptions: 0,
    mutedChannelIds: []
  }));
  notificationPublicKey.value = result.publicKey;
  mutedChannelIds.value = new Set(result.mutedChannelIds || []);
  const subscription = await currentPushSubscription().catch(() => null);
  notificationEnabled.value = !!subscription && notificationPermission.value === "granted";
}

async function enableNotifications() {
  notificationMsg.value = "";
  if (!notificationSupported.value) {
    notificationMsg.value = "当前浏览器不支持通知";
    return;
  }
  notificationBusy.value = true;
  try {
    if (!notificationPublicKey.value) await loadNotificationSettings();
    if (!notificationPublicKey.value) throw new Error("服务器推送未就绪");
    const permission = await Notification.requestPermission();
    notificationPermission.value = permission;
    if (permission !== "granted") {
      notificationMsg.value = "浏览器未允许通知";
      return;
    }
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ||
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(notificationPublicKey.value)
      }));
    await api("/api/push-subscriptions", { method: "POST", body: JSON.stringify(subscription.toJSON()) });
    notificationEnabled.value = true;
    notificationMsg.value = "已开启本设备通知";
  } catch (error) {
    notificationMsg.value = error instanceof Error ? error.message : "开启通知失败";
  } finally {
    notificationBusy.value = false;
  }
}

async function disableNotifications() {
  notificationMsg.value = "";
  notificationBusy.value = true;
  try {
    const subscription = await currentPushSubscription();
    const endpoint = subscription?.endpoint;
    if (subscription) await subscription.unsubscribe();
    await api("/api/push-subscriptions", { method: "DELETE", body: JSON.stringify({ endpoint }) });
    notificationEnabled.value = false;
    notificationMsg.value = "已关闭本设备通知";
  } catch (error) {
    notificationMsg.value = error instanceof Error ? error.message : "关闭通知失败";
  } finally {
    notificationBusy.value = false;
  }
}

function isChannelMuted(channelId: number) {
  return mutedChannelIds.value.has(channelId);
}

async function setChannelMuted(channel: ChannelDTO, muted: boolean) {
  await api(`/api/notifications/channels/${channel.id}`, { method: "PATCH", body: JSON.stringify({ muted }) });
  const next = new Set(mutedChannelIds.value);
  if (muted) next.add(channel.id);
  else next.delete(channel.id);
  mutedChannelIds.value = next;
  notificationMsg.value = muted ? `已关闭“${channel.name}”通知` : `已开启“${channel.name}”通知`;
}

async function revokeDevice(device: DeviceSessionDTO) {
  await api<{ current: boolean }>(`/api/me/sessions/${device.id}`, { method: "DELETE" });
  if (device.current) {
    await store.logout(false);
    showSettings.value = false;
    return;
  }
  await loadDevices();
}

async function chooseTheme(theme: string) {
  const result = await api<{ account: AccountDTO }>("/api/me/preferences", { method: "PATCH", body: JSON.stringify({ theme }) });
  if (result.account) store.account = result.account;
}

function deviceLabel(kind: string) {
  if (kind === "mobile") return "手机";
  if (kind === "tablet") return "平板";
  return "电脑";
}

function deviceIcon(kind: string) {
  if (kind === "mobile") return Smartphone;
  if (kind === "tablet") return Tablet;
  return Monitor;
}

function compareVersions(a: string, b: string) {
  const left = a.split(".").map((part) => Number(part.replace(/\D.*/, "")) || 0);
  const right = b.split(".").map((part) => Number(part.replace(/\D.*/, "")) || 0);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0);
    if (diff) return diff;
  }
  return 0;
}

async function clearAppCaches() {
  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.update().catch(() => undefined)));
  }
  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }
}

async function reloadToLatestVersion() {
  staleVersionMessage.value = "正在刷新到最新版本...";
  await clearAppCaches().catch(() => undefined);
  window.location.reload();
}

async function checkServerVersion() {
  const version = await api<VersionDTO>("/api/version").catch(() => null);
  if (!version) return;
  serverVersion.value = version;
  if (compareVersions(version.version, APP_VERSION) <= 0) return;
  staleVersionMessage.value = `服务器已更新到 v${version.version}，当前是 v${APP_VERSION}`;
  staleVersionVisible.value = true;
  const hasDraft = !!input.value.trim() || !!replyTo.value || Object.keys(pendingUploads.value).length > 0;
  if (!hasDraft) window.setTimeout(() => void reloadToLatestVersion(), 1200);
}

async function loadUpdateStatus() {
  const status = await api<UpdateStatusDTO>("/api/admin/update/status").catch(() => null);
  if (!status) return;
  updateStatus.value = status;
  if (status.state !== "running" && updateStatusTimer) {
    window.clearInterval(updateStatusTimer);
    updateStatusTimer = undefined;
  }
}

function startUpdatePolling() {
  if (updateStatusTimer) window.clearInterval(updateStatusTimer);
  updateStatusTimer = window.setInterval(() => void loadUpdateStatus(), 2000);
}

async function checkForUpdates() {
  if (!isAdmin.value) return;
  updateBusy.value = true;
  try {
    const result = await api<UpdateCheckDTO>("/api/admin/update/check");
    updateCheck.value = result;
    updateStatus.value = result.status;
    if (result.status.state === "running") startUpdatePolling();
  } catch (error) {
    adminMsg.value = error instanceof Error ? error.message : "检查更新失败";
  } finally {
    updateBusy.value = false;
  }
}

async function startServerUpdate() {
  if (!isAdmin.value || updateBusy.value) return;
  updateBusy.value = true;
  adminMsg.value = "已开始更新，服务器会在完成后自动重启。";
  try {
    await api("/api/admin/update/start", { method: "POST", body: JSON.stringify({}) });
  } catch {
    // Restart may interrupt the request; the status poll will pick up progress when the server returns.
  } finally {
    await loadUpdateStatus();
    startUpdatePolling();
    updateBusy.value = false;
  }
}

function parseComposerText(value: string): { content: string; effect?: MessageEffect; type?: "text" | "prayer" } {
  const trimmed = value.trim();
  if (trimmed === "/代祷" || trimmed.startsWith("/代祷 ") || trimmed.startsWith("/代祷\n")) {
    let content = trimmed.slice("/代祷".length).trim();
    let effect: MessageEffect | undefined;
    const effectCommand = effectCommands.find((item) => content === item.command || content.startsWith(`${item.command} `) || content.startsWith(`${item.command}\n`));
    if (effectCommand) {
      effect = effectCommand.effect;
      content = content.slice(effectCommand.command.length).trim();
    }
    return { content, effect, type: "prayer" };
  }
  const command = effectCommands.find((item) => trimmed === item.command || trimmed.startsWith(`${item.command} `) || trimmed.startsWith(`${item.command}\n`));
  if (!command) return { content: trimmed };
  return { content: trimmed.slice(command.command.length).trim(), effect: command.effect, type: "text" };
}

function mentionTokenAtCursor(value: string, caret: number) {
  const beforeCursor = value.slice(0, caret);
  const match = beforeCursor.match(/(^|[\s，。！？、,.!?:;；：])@([^\s@，。！？、,.!?:;；：]*)$/);
  if (!match) return null;
  return {
    start: beforeCursor.length - match[2].length - 1,
    end: caret,
    query: match[2]
  };
}

function slashCommandTokenAtCursor(value: string, caret: number) {
  const beforeCursor = value.slice(0, caret);
  const firstLine = beforeCursor.split(/\r?\n/, 1)[0] || "";
  if (firstLine === "/" || /^\/[^\s/]*$/.test(firstLine)) {
    return { kind: "root" as const, start: 0, end: caret, query: firstLine };
  }
  const prayerEffectMatch = beforeCursor.match(/^\/代祷\s+(\/[^\s/]*)$/);
  if (prayerEffectMatch) {
    return {
      kind: "prayer-effect" as const,
      start: beforeCursor.length - prayerEffectMatch[1].length,
      end: caret,
      query: prayerEffectMatch[1]
    };
  }
  return null;
}

function syncComposerCaret() {
  const el = composerInput.value;
  composerCaret.value = el?.selectionStart ?? input.value.length;
}

function chooseSlashCommand(item: SlashCommandSuggestion) {
  const token = slashCommandToken.value;
  const command = item.command;
  const start = token?.start ?? 0;
  const end = token?.end ?? input.value.length;
  input.value = `${input.value.slice(0, start)}${command} ${input.value.slice(end)}`;
  composerPanel.value = null;
  composerSuggestionSuppressed.value = true;
  nextTick(() => {
    composerInput.value?.focus();
    const cursor = start + command.length + 1;
    composerInput.value?.setSelectionRange(cursor, cursor);
    syncComposerCaret();
  });
}

function startPrayerComposer() {
  input.value = "/代祷 ";
  composerPanel.value = null;
  nextTick(() => {
    composerInput.value?.focus();
    composerInput.value?.setSelectionRange(input.value.length, input.value.length);
    syncComposerCaret();
  });
}

function chooseMentionSuggestion(member: { displayName: string }) {
  const token = mentionToken.value;
  const mention = `@${member.displayName} `;
  const start = token?.start ?? input.value.length;
  const end = token?.end ?? input.value.length;
  input.value = `${input.value.slice(0, start)}${mention}${input.value.slice(end)}`;
  composerPanel.value = null;
  composerSuggestionSuppressed.value = true;
  nextTick(() => {
    composerInput.value?.focus();
    const cursor = start + mention.length;
    composerInput.value?.setSelectionRange(cursor, cursor);
    syncComposerCaret();
  });
}

function chooseActiveComposerSuggestion() {
  const index = Math.min(composerSuggestionIndex.value, Math.max(0, composerSuggestionCount.value - 1));
  if (activeComposerSuggestionKind.value === "mention") {
    const member = matchingMentionMembers.value[index];
    if (member) chooseMentionSuggestion(member);
    return;
  }
  const command = matchingSlashCommands.value[index];
  if (command) chooseSlashCommand(command);
}

async function sendText() {
  const parsed = parseComposerText(input.value);
  const content = parsed.content;
  if (!content || !store.currentChannelId) return;
  const originalInput = input.value;
  const messageType = parsed.type || (store.prayerOnly ? "prayer" : "text");
  const payload = {
    channelId: store.currentChannelId,
    content,
    type: messageType,
    payload: messageType === "prayer" ? { kind: "prayer", status: "active", ...(parsed.effect ? { effect: parsed.effect } : {}) } : parsed.effect ? { effect: parsed.effect } : undefined,
    replyToId: replyTo.value?.id || null
  };
  input.value = "";
  replyTo.value = null;
  store.socket?.emit("message:send", payload, async (ack: { success: boolean; message?: string }) => {
    if (!ack?.success) {
      input.value = originalInput;
      alert(ack?.message || "发送失败");
    }
  });
}

function mentionMember(member: { displayName: string }) {
  const mention = `@${member.displayName} `;
  const el = composerInput.value;
  if (!el) {
    input.value = `${input.value}${mention}`;
    return;
  }
  const start = el.selectionStart ?? input.value.length;
  const end = el.selectionEnd ?? input.value.length;
  input.value = `${input.value.slice(0, start)}${mention}${input.value.slice(end)}`;
  nextTick(() => {
    el.focus();
    const cursor = start + mention.length;
    el.setSelectionRange(cursor, cursor);
  });
}

function openMemberActions(member: MemberActionTarget, event?: MouseEvent) {
  memberPromptPosition.value = positionPromptNearEvent(event, { width: 178, height: 52 });
  selectedMember.value = member;
  pendingChain.value = null;
}

function mentionSelectedMember() {
  if (!selectedMember.value) return;
  mentionMember(selectedMember.value);
  selectedMember.value = null;
  showMembers.value = false;
}

async function startPrivateChat(member: MemberActionTarget) {
  if (!member.accountId || member.accountId === store.account?.id) return;
  const result = await api<{ channel: ChannelDTO }>("/api/direct-channels", { method: "POST", body: JSON.stringify({ accountId: member.accountId }) });
  selectedMember.value = null;
  showMembers.value = false;
  if (result.channel && !store.channels.some((channel) => channel.id === result.channel.id)) {
    store.channels = [result.channel, ...store.channels];
  }
  await store.switchChannel(result.channel.id);
  await nextTick();
  scrollBottom(false);
}

function requestCloseChannel() {
  if (!currentChannel.value?.directKey) return;
  pendingCloseChannel.value = currentChannel.value;
}

async function closePendingChannel() {
  const channel = pendingCloseChannel.value;
  if (!channel) return;
  const fallbackChannelId = store.previousChannelId;
  await api(`/api/channels/${channel.id}/membership`, { method: "DELETE" });
  pendingCloseChannel.value = null;
  await store.loadChannels(fallbackChannelId);
  await nextTick();
  scrollBottom(false);
}

function toggleMorePanel() {
  if (isRecording.value) return;
  composerPanel.value = composerPanel.value === "more" ? null : "more";
}

async function toggleVoicePanel() {
  if (isRecording.value) {
    stopRecording();
    return;
  }
  if (composerPanel.value !== "voice") {
    composerPanel.value = "voice";
    await startRecording();
    return;
  }
  if (!audioFile.value) {
    await startRecording();
  }
}

function onInput() {
  syncComposerCaret();
  composerSuggestionIndex.value = 0;
  composerSuggestionSuppressed.value = false;
  if (!store.currentChannelId) return;
  store.socket?.emit("message:typing", { channelId: store.currentChannelId, state: "start" });
}

function onKeydown(event: KeyboardEvent) {
  if (showComposerSuggestionMenu.value) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const count = composerSuggestionCount.value;
      composerSuggestionIndex.value = count ? (composerSuggestionIndex.value + direction + count) % count : 0;
      return;
    }
    if ((event.key === "Enter" && !event.shiftKey && !event.isComposing) || event.key === "Tab") {
      event.preventDefault();
      chooseActiveComposerSuggestion();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      composerSuggestionSuppressed.value = true;
      return;
    }
  }
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    sendText();
  }
}

function pickReply(message: MessageDTO) {
  replyTo.value = message;
}

function messageEffect(message: MessageDTO): MessageEffect | null {
  const payload = message.payload as MessageEffectPayload | undefined;
  const effect = payload?.effect;
  return effect && effectCommands.some((item) => item.effect === effect) ? effect : null;
}

function isMessageEffectPaused(message: MessageDTO) {
  return pausedEffectIds.value.has(message.id);
}

function toggleMessageEffect(message: MessageDTO) {
  const effect = messageEffect(message);
  if (!effect || effect === "rain") return false;
  const next = new Set(pausedEffectIds.value);
  if (next.has(message.id)) next.delete(message.id);
  else next.add(message.id);
  pausedEffectIds.value = next;
  return true;
}

function messageEffectClass(message: MessageDTO) {
  const effect = messageEffect(message);
  if (!effect || isMessageEffectPaused(message)) return {};
  return {
    "message-effect-flash": effect === "flash",
    "message-effect-shine": effect === "shine",
    "message-effect-shake": effect === "shake",
    "message-effect-fly": effect === "fly",
    "message-effect-sunburst": effect === "sunburst",
    "message-effect-marquee": effect === "marquee",
    "message-effect-water": effect === "water",
    "message-effect-drip": effect === "drip",
    "message-effect-rain": effect === "rain"
  };
}

function messageEffectStyle(message: MessageDTO) {
  const effect = messageEffect(message);
  if (effect !== "flash" || isMessageEffectPaused(message)) return {};
  const interval = `${flashEffect.value.intervalSeconds}s`;
  const transition = flashEffect.value.transitionMode === "smooth" ? `background ${interval} linear, color ${interval} linear` : "none";
  return {
    background: activeFlashColor.value,
    color: readableTextColor(activeFlashColor.value),
    transition
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function handleDeviceOrientation(event: DeviceOrientationEvent) {
  const gamma = Number.isFinite(event.gamma) ? Number(event.gamma) : 0;
  const beta = Number.isFinite(event.beta) ? Number(event.beta) : 0;
  waterTilt.value = {
    x: clamp(gamma, -36, 36) * 0.42,
    y: clamp(beta - 35, -42, 42) * 0.28
  };
}

function requestDeviceOrientationPermissionOnce() {
  if (deviceOrientationPermissionRequested || typeof DeviceOrientationEvent === "undefined") return;
  const eventWithPermission = DeviceOrientationEvent as typeof DeviceOrientationEvent & {
    requestPermission?: () => Promise<"granted" | "denied">;
  };
  if (!eventWithPermission.requestPermission) return;
  deviceOrientationPermissionRequested = true;
  void eventWithPermission.requestPermission().catch(() => undefined);
}

function handleBubblePointerMove(message: MessageDTO, event: PointerEvent) {
  moveMessageLongPress(event);
  stirWaterMessage(message, event);
}

function handleBubblePointerLeave(message: MessageDTO, event: PointerEvent) {
  clearMessageLongPress();
  settleWaterMessage(message, event);
}

function stirWaterMessage(message: MessageDTO, event: PointerEvent) {
  if (messageEffect(message) !== "water" || isMessageEffectPaused(message)) return;
  const bubble = event.currentTarget;
  if (!(bubble instanceof HTMLElement)) return;
  const rect = bubble.getBoundingClientRect();
  const x = clamp(((event.clientX - rect.left) / Math.max(1, rect.width)) * 100, 0, 100);
  const y = clamp(((event.clientY - rect.top) / Math.max(1, rect.height)) * 100, 0, 100);
  bubble.style.setProperty("--water-pointer-x", `${x.toFixed(1)}%`);
  bubble.style.setProperty("--water-pointer-y", `${y.toFixed(1)}%`);
  bubble.style.setProperty("--water-stir-size", "38%");
  bubble.style.setProperty("--water-stir-opacity", "0.54");
  bubble.style.setProperty("--water-ripple-wide", "200px");
  bubble.style.setProperty("--water-ripple-tall", "82px");
  bubble.style.setProperty("--water-ripple-opacity", "0.87");
}

function settleWaterMessage(message: MessageDTO, event: PointerEvent) {
  if (messageEffect(message) !== "water") return;
  const bubble = event.currentTarget;
  if (bubble instanceof HTMLElement) {
    bubble.style.setProperty("--water-stir-size", "20%");
    bubble.style.setProperty("--water-stir-opacity", "0.12");
    bubble.style.setProperty("--water-ripple-wide", "130px");
    bubble.style.setProperty("--water-ripple-tall", "54px");
    bubble.style.setProperty("--water-ripple-opacity", "0.55");
  }
}

function triggerOneShotMessageEffects(message: MessageDTO) {
  if (messageEffect(message) === "rain") void startRainForMessage(message.id);
}

function hydratePlayedRainEffectIds() {
  playedRainEffectIds.clear();
  for (const id of readPlayedRainEffectIds()) playedRainEffectIds.add(id);
}

function readPlayedRainEffectIds() {
  try {
    return JSON.parse(localStorage.getItem("team-chat-played-rain-effects") || "[]")
      .map((value: unknown) => Number(value))
      .filter((value: number) => Number.isFinite(value) && value > 0)
      .slice(-180);
  } catch {
    return [];
  }
}

function persistPlayedRainEffectIds() {
  try {
    localStorage.setItem("team-chat-played-rain-effects", JSON.stringify([...playedRainEffectIds].slice(-180)));
  } catch {
    // Private browsing or quota limits should not block chat effects.
  }
}

async function startRainForMessage(messageId: number) {
  if (messageId <= 0 || playedRainEffectIds.has(messageId)) return;
  playedRainEffectIds.add(messageId);
  persistPlayedRainEffectIds();
  if (rainActive.value) return;
  rainActive.value = true;
  rainUntil = performance.now() + rainDurationMs;
  await nextTick();
  const canvas = rainCanvas.value;
  if (!canvas) {
    rainActive.value = false;
    return;
  }
  rainDrops = [];
  rainAnimationFrame = requestAnimationFrame(drawRainFrame);
}

function stopRainEffect() {
  if (rainAnimationFrame) window.cancelAnimationFrame(rainAnimationFrame);
  rainAnimationFrame = undefined;
  rainActive.value = false;
  rainUntil = 0;
  rainDrops = [];
  const canvas = rainCanvas.value;
  const context = canvas?.getContext("2d");
  if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
}

function drawRainFrame(now: number) {
  const canvas = rainCanvas.value;
  const context = canvas?.getContext("2d");
  if (!canvas || !context || now >= rainUntil) {
    stopRainEffect();
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    rainDrops = [];
  }
  if (!rainDrops.length) rainDrops = makeRainDrops(width, height);
  const remaining = clamp((rainUntil - now) / rainDurationMs, 0, 1);
  context.clearRect(0, 0, width, height);
  context.fillStyle = `rgba(12, 24, 38, ${0.12 * Math.min(1, remaining + 0.35)})`;
  context.fillRect(0, 0, width, height);
  context.lineCap = "round";
  for (const drop of rainDrops) {
    drop.y += drop.speed;
    drop.x += drop.sway;
    if (drop.y > height + drop.length) {
      drop.y = -drop.length - Math.random() * height * 0.45;
      drop.x = Math.random() * width;
    }
    if (drop.x > width + 28) drop.x = -28;
    if (drop.x < -28) drop.x = width + 28;
    context.globalAlpha = drop.alpha * Math.min(1, remaining * 1.7);
    context.lineWidth = drop.width;
    context.strokeStyle = "#d9f2ff";
    context.beginPath();
    context.moveTo(drop.x, drop.y);
    context.lineTo(drop.x - drop.length * 0.25, drop.y + drop.length);
    context.stroke();
  }
  context.globalAlpha = 1;
  rainAnimationFrame = requestAnimationFrame(drawRainFrame);
}

function makeRainDrops(width: number, height: number): RainDrop[] {
  const count = Math.min(260, Math.max(110, Math.floor((width * height) / 3200)));
  return Array.from({ length: count }, () => ({
    x: Math.random() * width,
    y: Math.random() * height - height,
    length: 13 + Math.random() * 24,
    speed: 9 + Math.random() * 15,
    width: 0.7 + Math.random() * 1.3,
    sway: -1.9 - Math.random() * 1.4,
    alpha: 0.28 + Math.random() * 0.52
  }));
}

function ensureDripPhysics() {
  const active = hasActiveDripMessages();
  if ((active || dripParticles.length) && !dripAnimationFrame) {
    dripLastFrame = 0;
    dripLastSpawn = 0;
    dripAnimationFrame = requestAnimationFrame(updateDripPhysics);
  }
}

function stopDripPhysics(clear = false) {
  if (dripAnimationFrame) window.cancelAnimationFrame(dripAnimationFrame);
  dripAnimationFrame = undefined;
  dripLastFrame = 0;
  dripLastSpawn = 0;
  if (clear) {
    for (const particle of dripParticles) particle.el.remove();
    dripParticles = [];
    dripLayer.value?.querySelectorAll(".water-splash").forEach((node) => node.remove());
  }
}

function hasActiveDripMessages() {
  return store.messages.some((message) => messageEffect(message) === "drip" && !isMessageEffectPaused(message));
}

function updateDripPhysics(now: number) {
  const layer = dripLayer.value;
  if (!layer) {
    stopDripPhysics(true);
    return;
  }
  const active = hasActiveDripMessages();
  const dt = Math.min(2.2, Math.max(0.6, ((dripLastFrame ? now - dripLastFrame : 16) / 16.67)));
  dripLastFrame = now;
  if (active && now - dripLastSpawn > 520) {
    spawnDripParticles(layer);
    dripLastSpawn = now;
  }
  const layerRect = layer.getBoundingClientRect();
  const nextParticles: DripParticle[] = [];
  for (const particle of dripParticles) {
    particle.vy += 0.26 * dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    const hit = findDripHit(layer, particle);
    if (hit) {
      particle.el.remove();
      createWaterSplash(layer, particle.x, hit.y);
      continue;
    }
    if (particle.y > layerRect.height + 28) {
      particle.el.remove();
      continue;
    }
    particle.el.style.transform = `translate3d(${particle.x.toFixed(1)}px, ${particle.y.toFixed(1)}px, 0)`;
    nextParticles.push(particle);
  }
  dripParticles = nextParticles;
  if (active || dripParticles.length) {
    dripAnimationFrame = requestAnimationFrame(updateDripPhysics);
  } else {
    stopDripPhysics();
  }
}

function spawnDripParticles(layer: HTMLElement) {
  const layerRect = layer.getBoundingClientRect();
  for (const { message, bubble } of activeDripBubbles().slice(-6)) {
    const rect = bubble.getBoundingClientRect();
    if (rect.bottom < layerRect.top || rect.top > layerRect.bottom) continue;
    const count = Math.random() > 0.74 ? 2 : 1;
    for (let i = 0; i < count; i += 1) {
      const radius = 3 + Math.random() * 2.6;
      const el = document.createElement("span");
      el.className = "drip-drop";
      el.style.width = `${radius * 2}px`;
      el.style.height = `${radius * 2}px`;
      layer.appendChild(el);
      const x = rect.left - layerRect.left + 8 + Math.random() * Math.max(8, rect.width - 16);
      const y = rect.bottom - layerRect.top - radius;
      const particle: DripParticle = {
        el,
        x,
        y,
        vx: (Math.random() - 0.5) * 0.9,
        vy: 0.35 + Math.random() * 0.5,
        radius,
        sourceId: message.id
      };
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      dripParticles.push(particle);
    }
  }
}

function activeDripBubbles() {
  const root = scroller.value;
  if (!root) return [];
  return store.messages
    .filter((message) => messageEffect(message) === "drip" && !isMessageEffectPaused(message))
    .map((message) => {
      const row = root.querySelector<HTMLElement>(`.message-row[data-message-id="${message.id}"]`);
      const bubble = row?.querySelector<HTMLElement>(".message-effect-drip");
      return bubble ? { message, bubble } : null;
    })
    .filter((item): item is { message: MessageDTO; bubble: HTMLElement } => !!item);
}

function findDripHit(layer: HTMLElement, particle: DripParticle) {
  const root = scroller.value;
  if (!root) return null;
  const layerRect = layer.getBoundingClientRect();
  const particleBottom = particle.y + particle.radius * 2;
  for (const row of root.querySelectorAll<HTMLElement>(".message-row[data-message-id]")) {
    const id = Number(row.dataset.messageId || 0);
    if (!id || id === particle.sourceId) continue;
    const bubble = row.querySelector<HTMLElement>(".bubble");
    if (!bubble) continue;
    const rect = bubble.getBoundingClientRect();
    const left = rect.left - layerRect.left;
    const right = rect.right - layerRect.left;
    const top = rect.top - layerRect.top;
    const bottom = rect.bottom - layerRect.top;
    if (particle.x >= left - particle.radius && particle.x <= right + particle.radius && particleBottom >= top && particle.y <= bottom) {
      return { x: particle.x, y: top };
    }
  }
  return null;
}

function createWaterSplash(layer: HTMLElement, x: number, y: number) {
  const splash = document.createElement("span");
  splash.className = "water-splash";
  splash.style.setProperty("--splash-x", `${x.toFixed(1)}px`);
  splash.style.setProperty("--splash-y", `${y.toFixed(1)}px`);
  layer.appendChild(splash);
  window.setTimeout(() => splash.remove(), 620);
}

function isMobileChatInteraction() {
  return window.matchMedia("(hover: none), (pointer: coarse), (max-width: 760px)").matches;
}

function beginMessageLongPress(message: MessageDTO, event: PointerEvent) {
  if (messageEffect(message) === "water") requestDeviceOrientationPermissionOnce();
  if (isMobileChatInteraction()) return;
  if (message.type === "system" || event.button !== 0) return;
  const target = event.target;
  if (target instanceof Element && target.closest(".reply-preview, .chain-card button, .voice-card button, .prayer-actions, .message-select-btn, a, audio, video, iframe")) return;
  longPressStartedAt = { x: event.clientX, y: event.clientY };
  clearMessageLongPress();
  longPressTimer = window.setTimeout(() => {
    pickReply(message);
    pendingChain.value = null;
    pendingDownload.value = null;
    suppressNextTapUntil = Date.now() + 650;
    navigator.vibrate?.(12);
  }, longPressMs);
}

function moveMessageLongPress(event: PointerEvent) {
  if (!longPressTimer) return;
  const distance = Math.hypot(event.clientX - longPressStartedAt.x, event.clientY - longPressStartedAt.y);
  if (distance > 10) clearMessageLongPress();
}

function clearMessageLongPress() {
  if (longPressTimer) window.clearTimeout(longPressTimer);
  longPressTimer = undefined;
}

function handleBubbleClick(message: MessageDTO, event: MouseEvent) {
  if (Date.now() < suppressNextTapUntil) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (messageSelectionMode.value && isAdmin.value && message.id > 0) {
    toggleMessageSelected(message);
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  acknowledgeMentionAlert(message);
  if (canRecallMessage(message)) {
    openRecallPrompt(message, event);
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (toggleMessageEffect(message)) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (isMobileChatInteraction()) {
    if (message.type !== "chain") pickReply(message);
    return;
  }
  if (message.type !== "chain") return;
  event.stopPropagation();
  confirmJoinChain(message, event);
}

function openAttachmentFromTap(message: MessageDTO, event?: MouseEvent) {
  if (Date.now() < suppressNextTapUntil) return;
  if (event) event.stopPropagation();
  if (messageSelectionMode.value && isAdmin.value && message.id > 0) {
    toggleMessageSelected(message);
    return;
  }
  if (canRecallMessage(message)) {
    openRecallPrompt(message, event);
    return;
  }
  if (isMobileChatInteraction()) {
    if (message.type !== "chain") pickReply(message);
    if (message.type === "image") openPreviewMessage(message);
    return;
  }
  if (canPreviewMessage(message)) {
    openPreviewMessage(message);
    return;
  }
  requestDownload(message, event);
}

function openPreviewMessage(message: MessageDTO) {
  previewMessage.value = message;
  pendingDownload.value = null;
  resetImagePreviewTransform();
}

function resetImagePreviewTransform() {
  imagePreviewScale.value = 1;
  imagePreviewOffset.value = { x: 0, y: 0 };
  imagePinchStart = null;
}

function closePreviewMessage() {
  previewMessage.value = null;
  resetImagePreviewTransform();
}

function clampImageScale(value: number) {
  return Math.min(5, Math.max(1, value));
}

function imagePreviewTransform() {
  return {
    transform: `translate3d(${imagePreviewOffset.value.x}px, ${imagePreviewOffset.value.y}px, 0) scale(${imagePreviewScale.value})`
  };
}

function touchDistance(touches: TouchList) {
  const first = touches[0];
  const second = touches[1];
  return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
}

function onImagePreviewTouchStart(event: TouchEvent) {
  if (event.touches.length === 2) {
    imagePinchStart = { distance: touchDistance(event.touches), scale: imagePreviewScale.value };
    return;
  }
  if (event.touches.length === 1) {
    imagePanStart = {
      x: event.touches[0].clientX,
      y: event.touches[0].clientY,
      offsetX: imagePreviewOffset.value.x,
      offsetY: imagePreviewOffset.value.y
    };
  }
}

function onImagePreviewTouchMove(event: TouchEvent) {
  if (event.touches.length === 2 && imagePinchStart) {
    event.preventDefault();
    imagePreviewScale.value = clampImageScale(imagePinchStart.scale * (touchDistance(event.touches) / Math.max(1, imagePinchStart.distance)));
    return;
  }
  if (event.touches.length === 1 && imagePreviewScale.value > 1) {
    event.preventDefault();
    imagePreviewOffset.value = {
      x: imagePanStart.offsetX + event.touches[0].clientX - imagePanStart.x,
      y: imagePanStart.offsetY + event.touches[0].clientY - imagePanStart.y
    };
  }
}

function endImagePreviewTouch() {
  imagePinchStart = null;
}

function onImagePreviewPointerDown(event: PointerEvent) {
  if (event.pointerType === "touch" || imagePreviewScale.value <= 1) return;
  imagePanStart = {
    x: event.clientX,
    y: event.clientY,
    offsetX: imagePreviewOffset.value.x,
    offsetY: imagePreviewOffset.value.y
  };
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function onImagePreviewPointerMove(event: PointerEvent) {
  if (event.pointerType === "touch" || imagePreviewScale.value <= 1 || !(event.buttons & 1)) return;
  imagePreviewOffset.value = {
    x: imagePanStart.offsetX + event.clientX - imagePanStart.x,
    y: imagePanStart.offsetY + event.clientY - imagePanStart.y
  };
}

function onImagePreviewWheel(event: WheelEvent) {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  imagePreviewScale.value = clampImageScale(imagePreviewScale.value + (event.deltaY < 0 ? 0.18 : -0.18));
  if (imagePreviewScale.value === 1) imagePreviewOffset.value = { x: 0, y: 0 };
}

function requestDownload(message: MessageDTO, event?: MouseEvent) {
  downloadPromptPosition.value = positionPromptNearEvent(event, { width: 184, height: 82 });
  pendingDownload.value = message;
  pendingChain.value = null;
  pendingRecall.value = null;
  pendingPrayer.value = null;
  selectedMember.value = null;
}

function requestPrayerPrayed(message: MessageDTO, event?: MouseEvent) {
  if (prayerPayload(message).status !== "active") return;
  prayerPromptPosition.value = positionPromptNearEvent(event, { width: 238, height: 104 });
  pendingPrayer.value = message;
  pendingChain.value = null;
  pendingDownload.value = null;
  pendingRecall.value = null;
  selectedMember.value = null;
}

function fileDownloadUrl(message: MessageDTO) {
  return `${fileUrl(message)}&download=1`;
}

function downloadFile(message: MessageDTO) {
  const link = document.createElement("a");
  link.href = fileDownloadUrl(message);
  link.download = message.fileName || "附件";
  document.body.appendChild(link);
  link.click();
  link.remove();
  pendingDownload.value = null;
}

function fileExtension(message: MessageDTO) {
  return (message.fileName || "").split(".").pop()?.toLowerCase() || "";
}

function isPdfMessage(message: MessageDTO) {
  return message.type === "file" && fileExtension(message) === "pdf";
}

function isVideoMessage(message: MessageDTO) {
  return message.type === "file" && /\.(mp4|m4v|mov)$/i.test(message.fileName || "");
}

function canPreviewMessage(message: MessageDTO) {
  return message.type === "image" || isAudioMessage(message) || isVideoMessage(message) || isPdfMessage(message);
}

function isDocumentMessage(message: MessageDTO) {
  return message.type === "file" && /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|pages|numbers|key|txt|csv)$/i.test(message.fileName || "");
}

function documentIconSrc(message: MessageDTO) {
  const ext = fileExtension(message);
  if (ext === "pdf") return "/images/file-icons/pdf.png";
  if (["doc", "docx", "pages"].includes(ext)) return "/images/file-icons/word.png";
  if (["xls", "xlsx", "numbers", "csv"].includes(ext)) return "/images/file-icons/excel.png";
  if (["ppt", "pptx", "key"].includes(ext)) return "/images/file-icons/powerpoint.png";
  if (["txt", "md", "rtf"].includes(ext)) return "/images/file-icons/text.png";
  return "/images/file-icons/document.png";
}

function documentKindLabel(message: MessageDTO) {
  const ext = fileExtension(message);
  if (ext === "pdf") return "PDF";
  if (["doc", "docx", "pages"].includes(ext)) return "Word 文档";
  if (["xls", "xlsx", "numbers", "csv"].includes(ext)) return "Excel 表格";
  if (["ppt", "pptx", "key"].includes(ext)) return "演示文稿";
  if (["txt", "md", "rtf"].includes(ext)) return "文本文件";
  if (["zip", "rar", "7z"].includes(ext)) return "压缩包";
  return "文件";
}

async function jumpToReply(id: number) {
  let el = document.querySelector(`[data-message-id="${id}"]`);
  if (!el && id > 0) {
    await loadUntilMessageVisible(id);
    await nextTick();
    el = document.querySelector(`[data-message-id="${id}"]`);
  }
  el?.scrollIntoView({ block: "center", behavior: "smooth" });
  el?.classList.add("flash");
  setTimeout(() => el?.classList.remove("flash"), 900);
}

async function loadUntilMessageVisible(id: number) {
  for (let attempts = 0; attempts < 30; attempts += 1) {
    if (document.querySelector(`[data-message-id="${id}"]`)) return true;
    const positiveMessages = store.messages.filter((message) => message.id > 0);
    const oldest = positiveMessages[0]?.id || 0;
    const newest = positiveMessages[positiveMessages.length - 1]?.id || 0;
    if (oldest && id < oldest && (store.hasOlderMessages || store.prefetchedOlderMessages.length)) {
      const loaded = await store.loadOlderMessages();
      await nextTick();
      if (!loaded) return false;
      continue;
    }
    if (newest && id > newest && store.hasNewerMessages) {
      const loaded = await store.loadNewerMessages();
      await nextTick();
      if (!loaded) return false;
      continue;
    }
    return false;
  }
  return false;
}

async function createChain() {
  if (!store.currentChannelId) return;
  const topic = chainTopic.value.trim();
  if (!topic) return;
  try {
    await api("/api/messages", {
      method: "POST",
      body: JSON.stringify({ channelId: store.currentChannelId, type: "chain", chainTopic: topic, replyToId: replyTo.value?.id || null })
    });
    chainTopic.value = "";
    showChainModal.value = false;
    composerPanel.value = null;
  } catch (error) {
    alert(error instanceof Error ? error.message : "接龙发布失败");
  }
}

function openChainModal() {
  chainTopic.value = "";
  showChainModal.value = true;
  composerPanel.value = null;
}

function confirmJoinChain(message: MessageDTO, event?: MouseEvent) {
  chainPromptPosition.value = positionPromptNearEvent(event, { width: 164, height: 82 });
  pendingChain.value = message;
  pendingRecall.value = null;
  pendingPrayer.value = null;
  selectedMember.value = null;
}

function positionPromptNearEvent(event: MouseEvent | undefined, size: { width: number; height: number }) {
  const margin = 12;
  const safeTop = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--safe-top")) || 0;
  const pointerX = event?.clientX ?? window.innerWidth / 2;
  const pointerY = event?.clientY ?? window.innerHeight / 2;
  const maxX = Math.max(margin, window.innerWidth - size.width - margin);
  const maxY = Math.max(safeTop + margin, window.innerHeight - size.height - margin);
  return {
    x: Math.min(Math.max(pointerX + 10, margin), maxX),
    y: Math.min(Math.max(pointerY + 10, safeTop + margin), maxY)
  };
}

function closeTapPromptsFromOutside(event: PointerEvent) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (pendingChain.value && !target.closest("[data-chain-popover]") && !target.closest("[data-chain-bubble]")) {
    pendingChain.value = null;
  }
  if (pendingDownload.value && !target.closest("[data-download-popover]") && !target.closest("[data-file-card]")) {
    pendingDownload.value = null;
  }
  if (pendingRecall.value && !target.closest("[data-recall-popover]") && !target.closest(".bubble")) {
    pendingRecall.value = null;
  }
  if (pendingPrayer.value && !target.closest("[data-prayer-popover]") && !target.closest(".prayer-actions")) {
    pendingPrayer.value = null;
  }
  if (selectedMember.value && !target.closest("[data-member-popover]") && !target.closest(".member-row")) {
    selectedMember.value = null;
  }
}

function toggleMessageSelectionMode() {
  messageSelectionMode.value = !messageSelectionMode.value;
  selectedMessageIds.value = new Set();
  pendingChain.value = null;
  pendingDownload.value = null;
  pendingRecall.value = null;
  pendingPrayer.value = null;
}

function startMessageSelectionMode() {
  showAdmin.value = false;
  messageSelectionMode.value = true;
  selectedMessageIds.value = new Set();
  nextTick(() => scrollBottom(false));
}

function toggleMessageSelected(message: MessageDTO) {
  if (message.id <= 0) return;
  const next = new Set(selectedMessageIds.value);
  if (next.has(message.id)) next.delete(message.id);
  else next.add(message.id);
  selectedMessageIds.value = next;
}

function toggleVisibleMessageSelection() {
  selectedMessageIds.value = visibleMessagesSelected.value ? new Set() : new Set(selectableMessages.value.map((message) => message.id));
}

async function deleteSelectedMessages() {
  const ids = [...selectedMessageIds.value];
  if (!ids.length) return;
  if (!confirm(`删除选中的 ${ids.length} 条聊天记录？附件文件也会一并删除。`)) return;
  const result = await api<{ deleted: number }>("/api/admin/messages", {
    method: "DELETE",
    body: JSON.stringify({ ids })
  });
  adminMsg.value = `已删除 ${result.deleted} 条聊天记录`;
  selectedMessageIds.value = new Set();
  await store.loadMessages();
}

async function joinPendingChain() {
  const message = pendingChain.value;
  if (!message) return;
  try {
    await api("/api/messages", {
      method: "POST",
      body: JSON.stringify({ channelId: message.channelId, type: "chain", chainRootId: message.chainRootId || message.id })
    });
    pendingChain.value = null;
  } catch (error) {
    alert(error instanceof Error ? error.message : "参与接龙失败");
  }
}

async function uploadFile(file: File, options: { voice?: boolean; durationMs?: number; waveform?: number[]; pendingMessageId?: number } = {}) {
  if (!store.currentChannelId) return false;
  const form = new FormData();
  form.append("channelId", String(store.currentChannelId));
  if (options.voice) {
    form.append("voice", "1");
    form.append("durationMs", String(options.durationMs || 0));
    form.append("waveform", JSON.stringify(options.waveform || []));
  }
  form.append("file", file);
  try {
    const result = await new Promise<{ success: boolean; message?: MessageDTO; error?: string }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/files/upload");
      const headers = authHeaders();
      for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, String(value));
      xhr.upload.onprogress = (event) => {
        if (!options.pendingMessageId || !event.lengthComputable) return;
        setPendingUpload(options.pendingMessageId, { progress: Math.max(1, Math.round((event.loaded / event.total) * 92)), status: "uploading" });
      };
      xhr.onload = () => {
        let payload: { success?: boolean; message?: MessageDTO; error?: string; messageText?: string } = {};
        try {
          payload = JSON.parse(xhr.responseText || "{}") as typeof payload;
        } catch {
          payload = { error: xhr.responseText || "上传失败" };
        }
        if (xhr.status >= 200 && xhr.status < 300 && payload.success && payload.message) {
          resolve({ success: true, message: payload.message });
          return;
        }
        resolve({ success: false, error: payload.error || payload.messageText || (payload as { message?: string }).message || `HTTP ${xhr.status}` });
      };
      xhr.onerror = () => reject(new Error("网络连接失败"));
      xhr.onabort = () => reject(new Error("上传已取消"));
      xhr.send(form);
    });
    if (!result.success || !result.message) {
      if (options.pendingMessageId) setPendingUpload(options.pendingMessageId, { status: "failed", message: result.error || "上传失败" });
      else alert(result.error || "上传失败");
      return false;
    }
    if (options.pendingMessageId) {
      setPendingUpload(options.pendingMessageId, { progress: 100, status: "processing", message: "正在发布" });
      replacePendingMessage(options.pendingMessageId, result.message);
      removePendingUpload(options.pendingMessageId);
    }
    composerPanel.value = null;
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "上传失败";
    if (options.pendingMessageId) setPendingUpload(options.pendingMessageId, { status: "failed", message });
    else alert(message);
    return false;
  }
}

function pickAudioMimeType() {
  const recorder = window.MediaRecorder;
  const candidates = ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  return candidates.find((type) => recorder.isTypeSupported?.(type)) || "";
}

function audioExtensionFromMime(type: string) {
  if (type.includes("mp4") || type.includes("aac")) return "m4a";
  if (type.includes("ogg")) return "ogg";
  if (type.includes("mpeg")) return "mp3";
  if (type.includes("wav")) return "wav";
  return "webm";
}

function clearRecordingTimer() {
  if (recordingTimer) window.clearInterval(recordingTimer);
  recordingTimer = undefined;
}

function resetRecording() {
  if (mediaRecorder.value && mediaRecorder.value.state !== "inactive") mediaRecorder.value.stop();
  previewAudioEl.value?.pause();
  mediaRecorder.value = null;
  audioChunks.value = [];
  isRecording.value = false;
  recordingDuration.value = 0;
  recordingStatus.value = "";
  audioFile.value = null;
  audioPreviewWaveform.value = [];
  audioPreviewDurationMs.value = 0;
  previewPlaying.value = false;
  previewProgress.value = 0;
  clearRecordingTimer();
  if (audioPreviewUrl.value) URL.revokeObjectURL(audioPreviewUrl.value);
  audioPreviewUrl.value = "";
}

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    alert("当前浏览器不支持录音");
    return;
  }
  resetRecording();
  recordingStatus.value = "准备录音…";
  let stream: MediaStream | undefined;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    const activeStream = stream;
    const mimeType = pickAudioMimeType();
    const recorderOptions: MediaRecorderOptions = { audioBitsPerSecond: 16000 };
    if (mimeType) recorderOptions.mimeType = mimeType;
    const recorder = new MediaRecorder(stream, recorderOptions);
    mediaRecorder.value = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) audioChunks.value.push(event.data);
    };
    recorder.onstop = () => {
      activeStream.getTracks().forEach((track) => track.stop());
      clearRecordingTimer();
      isRecording.value = false;
      const type = recorder.mimeType || mimeType || "audio/webm";
      const blob = new Blob(audioChunks.value, { type });
      if (!blob.size) {
        recordingStatus.value = "没有录到声音";
        return;
      }
      const ext = audioExtensionFromMime(type);
      audioFile.value = new File([blob], `语音消息-${Date.now()}.${ext}`, { type });
      audioPreviewUrl.value = URL.createObjectURL(blob);
      audioPreviewDurationMs.value = recordingDuration.value;
      audioPreviewWaveform.value = fallbackWaveform(Date.now());
      void analyzeAudioBlob(blob).then((result) => {
        audioPreviewDurationMs.value = result.durationMs || recordingDuration.value;
        audioPreviewWaveform.value = result.waveform;
      });
      recordingStatus.value = "录音已完成";
    };
    recorder.start(1000);
    isRecording.value = true;
    recordingStatus.value = "正在录音";
    const startedAt = Date.now();
    recordingTimer = window.setInterval(() => {
      recordingDuration.value = Date.now() - startedAt;
    }, 250);
  } catch {
    stream?.getTracks().forEach((track) => track.stop());
    recordingStatus.value = "";
    composerPanel.value = null;
    alert("无法开始录音，请允许麦克风权限");
  }
}

function stopRecording() {
  if (mediaRecorder.value && mediaRecorder.value.state !== "inactive") {
    mediaRecorder.value.stop();
  }
}

async function sendVoice() {
  if (!audioFile.value || voiceSending.value) return;
  const file = audioFile.value;
  const options = { durationMs: audioPreviewDurationMs.value || recordingDuration.value, waveform: audioPreviewWaveform.value };
  const pendingMessageId = pushPendingVoiceMessage(file, options);
  if (!pendingMessageId) return;
  voiceSending.value = true;
  resetRecording();
  composerPanel.value = null;
  try {
    await uploadFile(file, { voice: true, ...options, pendingMessageId });
  } finally {
    voiceSending.value = false;
  }
}

function removePendingMessage(id: number) {
  store.removeMessage(id);
  removePendingUpload(id);
}

async function retryPendingUpload(id: number) {
  const upload = pendingUploads.value[id];
  if (!upload || upload.status !== "failed") return;
  setPendingUpload(id, { status: "uploading", progress: 0, message: "" });
  await uploadFile(upload.file, { ...upload.options, pendingMessageId: id });
}

function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function isAudioMessage(message: MessageDTO) {
  return message.type === "file" && !isVideoMessage(message) && /\.(webm|mp3|m4a|wav|ogg|aac)$/i.test(message.fileName || "");
}

function voicePayload(message: MessageDTO): VoicePayload {
  const payload = message.payload as VoicePayload | undefined;
  return payload?.kind === "voice" ? payload : {};
}

function isVoiceMessage(message: MessageDTO) {
  return isAudioMessage(message) && voicePayload(message).kind === "voice";
}

function hasUnlistenedVoice(message: MessageDTO) {
  return isVoiceMessage(message) && message.sender.id !== store.account?.actorId && !message.voiceListened;
}

function normalizedWaveform(input?: number[]) {
  if (!Array.isArray(input) || !input.length) return [];
  return input.slice(0, 64).map((bar) => Math.min(1, Math.max(0.08, Number(bar) || 0.08)));
}

function fallbackWaveform(seed: number, bars = 48) {
  return Array.from({ length: bars }, (_, index) => {
    const value = Math.abs(Math.sin((index + 1) * 1.37 + seed * 0.013) * 0.75 + Math.sin(index * 0.41) * 0.25);
    return Math.min(1, Math.max(0.16, value));
  });
}

async function analyzeAudioBlob(blob: Blob, bars = 48) {
  const fallback = { durationMs: audioPreviewDurationMs.value || recordingDuration.value, waveform: fallbackWaveform(Date.now(), bars) };
  try {
    const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return fallback;
    const context = new AudioContextCtor();
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    const channel = buffer.getChannelData(0);
    const blockSize = Math.max(1, Math.floor(channel.length / bars));
    const waveform = Array.from({ length: bars }, (_, index) => {
      const start = index * blockSize;
      const end = Math.min(channel.length, start + blockSize);
      let sum = 0;
      for (let cursor = start; cursor < end; cursor += 1) sum += Math.abs(channel[cursor]);
      return sum / Math.max(1, end - start);
    });
    await context.close();
    const max = Math.max(...waveform, 0.01);
    return { durationMs: Math.round(buffer.duration * 1000), waveform: waveform.map((bar) => Math.min(1, Math.max(0.1, bar / max))) };
  } catch {
    return fallback;
  }
}

function waveformForMessage(message: MessageDTO) {
  const bars = normalizedWaveform(voicePayload(message).waveform);
  return bars.length ? bars : fallbackWaveform(message.id);
}

function voiceDurationMs(message: MessageDTO) {
  return voiceDurations.value[message.id] || voicePayload(message).durationMs || 0;
}

function voiceProgressValue(message: MessageDTO) {
  return voiceProgress.value[message.id] || 0;
}

function voiceBarStyle(bar: number, index: number, total: number, progress: number) {
  return {
    height: `${Math.round(7 + bar * 25)}px`,
    opacity: index / Math.max(1, total) <= progress ? 1 : 0.52
  };
}

function setVoiceProgress(id: number, value: number) {
  voiceProgress.value = { ...voiceProgress.value, [id]: Math.min(1, Math.max(0, value)) };
}

function setVoiceDuration(id: number, value: number) {
  if (!Number.isFinite(value) || value <= 0) return;
  voiceDurations.value = { ...voiceDurations.value, [id]: Math.round(value * 1000) };
}

function stopAllVoicePlayback(exceptId?: number) {
  for (const [id, audio] of voicePlayers) {
    if (id === exceptId) continue;
    audio.pause();
    audio.currentTime = 0;
    setVoiceProgress(id, 0);
  }
  if (!exceptId) playingVoiceId.value = null;
}

function getVoicePlayer(message: MessageDTO) {
  let audio = voicePlayers.get(message.id);
  if (audio) return audio;
  audio = new Audio(fileUrl(message));
  audio.preload = "metadata";
  audio.setAttribute("playsinline", "true");
  audio.setAttribute("webkit-playsinline", "true");
  audio.addEventListener("loadedmetadata", () => setVoiceDuration(message.id, audio!.duration));
  audio.addEventListener("timeupdate", () => {
    if (audio?.duration) setVoiceProgress(message.id, audio.currentTime / audio.duration);
  });
  audio.addEventListener("ended", () => {
    setVoiceProgress(message.id, 1);
    if (playingVoiceId.value === message.id) playingVoiceId.value = null;
  });
  audio.addEventListener("pause", () => {
    if (playingVoiceId.value === message.id && !audio?.ended) playingVoiceId.value = null;
  });
  voicePlayers.set(message.id, audio);
  return audio;
}

async function markVoiceListened(message: MessageDTO) {
  if (!hasUnlistenedVoice(message)) return;
  message.voiceListened = true;
  try {
    await api(`/api/messages/${message.id}/voice-listened`, { method: "POST", body: JSON.stringify({}) });
  } catch {
    message.voiceListened = false;
  }
}

function toggleVoicePlayback(message: MessageDTO) {
  const audio = getVoicePlayer(message);
  if (playingVoiceId.value === message.id) {
    audio.pause();
    playingVoiceId.value = null;
    return;
  }
  stopAllVoicePlayback(message.id);
  playingVoiceId.value = message.id;
  const playAttempt = audio.play();
  void markVoiceListened(message);
  playAttempt.catch(() => {
    playingVoiceId.value = null;
  });
}

function togglePreviewPlayback() {
  const audio = previewAudioEl.value;
  if (!audio) return;
  if (previewPlaying.value) {
    audio.pause();
    previewPlaying.value = false;
    return;
  }
  void audio.play();
  previewPlaying.value = true;
}

function updatePreviewProgress() {
  const audio = previewAudioEl.value;
  if (!audio?.duration) return;
  previewProgress.value = Math.min(1, Math.max(0, audio.currentTime / audio.duration));
}

function syncPreviewMetadata() {
  const audio = previewAudioEl.value;
  if (audio?.duration) audioPreviewDurationMs.value = Math.round(audio.duration * 1000);
}

function endPreviewPlayback() {
  previewPlaying.value = false;
  previewProgress.value = 0;
}

function scrollBottom(smooth = true) {
  const el = scroller.value;
  if (!el) return;
  el.scrollTo({ top: el.scrollHeight + 1000, behavior: smooth ? "smooth" : "auto" });
  hasUnreadMessages.value = false;
}

function focusComposer() {
  requestAnimationFrame(() => scrollBottom(false));
}

async function handleMessagesScroll() {
  const el = scroller.value;
  if (!el) return;
  if (isNearMessageBottom(120)) hasUnreadMessages.value = false;
  if (el.scrollTop < 180 && !loadingHistoryFromScroll && (store.hasOlderMessages || store.prefetchedOlderMessages.length)) {
    loadingHistoryFromScroll = true;
    const beforeHeight = el.scrollHeight;
    const beforeTop = el.scrollTop;
    const loaded = await store.loadOlderMessages();
    await nextTick();
    if (loaded && scroller.value === el) {
      el.scrollTop = el.scrollHeight - beforeHeight + beforeTop;
    }
    loadingHistoryFromScroll = false;
  }
  if (isNearMessageBottom(180) && store.hasNewerMessages && !loadingNewerFromScroll) {
    loadingNewerFromScroll = true;
    const loaded = await store.loadNewerMessages();
    await nextTick();
    if (loaded) scrollBottom(false);
    loadingNewerFromScroll = false;
  }
}

async function retryMessageLoad() {
  if (store.loadingInitialMessages || store.loadingOlderMessages || store.loadingNewerMessages) return;
  if (!store.messages.length) {
    await store.loadMessages().catch(() => undefined);
    await nextTick();
    scrollBottom(false);
    return;
  }
  await handleMessagesScroll();
}

async function scrollToNewest() {
  while (store.hasNewerMessages) {
    const loaded = await store.loadNewerMessages();
    if (!loaded) break;
  }
  await nextTick();
  scrollBottom(true);
}

function avatarText(name: string) {
  return (name || "?").slice(0, 1).toUpperCase();
}

function avatarUrl(path?: string | null) {
  if (!path) return "";
  return path.startsWith("/") ? path : `/avatars/${path}`;
}

function isAccountOnline(accountId?: number | null) {
  return !!accountId && store.online.some((user) => user.accountId === accountId);
}

function isActorOnline(actorId?: number | null) {
  return !!actorId && store.online.some((user) => user.actorId === actorId);
}

function wallpaperUrl(path?: string | null) {
  if (!path) return "";
  return path.startsWith("/") ? path : `/backgrounds/${path}`;
}

function ensureIconLink(rel: string) {
  let link = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!link) {
    link = document.createElement("link");
    link.rel = rel;
    document.head.appendChild(link);
  }
  return link;
}

function applyAppChrome() {
  const iconPath = store.appearance.appIconPath ? wallpaperUrl(store.appearance.appIconPath) : "/images/icon-192.svg";
  document.title = store.appearance.appTitle || "Team Chat";
  ensureIconLink("icon").href = iconPath;
  ensureIconLink("apple-touch-icon").href = iconPath;
}

function paletteStyle(palette: ThemePaletteDTO) {
  return {
    "--accent": palette.accent,
    "--accent-dark": palette.accentDark,
    "--button-text": palette.buttonText,
    "--bg": palette.bg,
    "--chat-bg": palette.chatBg,
    "--panel": palette.panel,
    "--line": palette.line,
    "--text": palette.text,
    "--muted": palette.muted,
    "--bubble-other": palette.bubbleOther,
    "--bubble-other-text": palette.bubbleOtherText,
    "--bubble-mine": palette.bubbleMine,
    "--bubble-mine-text": palette.bubbleMineText
  };
}

function cleanFlashEffectSettings(input?: FlashEffectSettingsDTO | null): FlashEffectSettingsDTO {
  const colors = (Array.isArray(input?.colors) ? input.colors : [])
    .filter((color) => /^#[0-9a-fA-F]{6}$/.test(color))
    .map((color) => color.toLowerCase())
    .slice(0, 10);
  const seconds = Number(input?.intervalSeconds);
  const transitionMode = input?.transitionMode === "step" ? "step" : "smooth";
  return {
    colors: colors.length ? colors : ["#fff176", "#ef4444", "#60a5fa", "#6d28d9", "#34d399", "#111827"],
    intervalSeconds: Math.round(Math.min(10, Math.max(0.01, Number.isFinite(seconds) ? seconds : 0.4)) * 100) / 100,
    transitionMode
  };
}

function readableTextColor(hex: string) {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#111111" : "#ffffff";
}

function restartFlashEffectTimer() {
  if (flashEffectTimer) window.clearInterval(flashEffectTimer);
  flashEffectStep.value = 0;
  flashEffectTimer = window.setInterval(() => {
    flashEffectStep.value = (flashEffectStep.value + 1) % flashEffect.value.colors.length;
  }, Math.max(10, Math.round(flashEffect.value.intervalSeconds * 1000)));
}

function wallpaperFitStyle(fit?: WallpaperFit | null) {
  if (fit === "contain") return { size: "contain", repeat: "no-repeat" };
  if (fit === "stretch") return { size: "100% 100%", repeat: "no-repeat" };
  if (fit === "repeat") return { size: "auto", repeat: "repeat" };
  return { size: "cover", repeat: "no-repeat" };
}

function themeSwatchStyle(theme: ThemeDTO) {
  return {
    background: `linear-gradient(135deg, ${theme.palette.accent} 0 33%, ${theme.palette.bubbleMine} 33% 66%, ${theme.palette.panel} 66%)`
  };
}

function fileUrl(message: MessageDTO) {
  return `/api/files/${message.id}?token=${encodeURIComponent(getToken())}`;
}

function chainPayload(message: MessageDTO): ChainPayload {
  return (message.payload as ChainPayload) || { topic: message.content || "接龙", participants: [] };
}

function prayerPayload(message: MessageDTO): PrayerPayload {
  const raw = (message.payload || {}) as Partial<PrayerPayload>;
  const status = raw.status === "closed" || raw.status === "answered" ? raw.status : "active";
  return {
    kind: "prayer",
    status,
    statusAt: raw.statusAt,
    statusBy: raw.statusBy,
    effect: raw.effect,
    prayerCount: Number(raw.prayerCount || 0),
    prayerActionCount: Number(raw.prayerActionCount || 0),
    currentUserPrayed: !!raw.currentUserPrayed,
    prayedBy: Array.isArray(raw.prayedBy) ? raw.prayedBy : [],
    aiSuggestions: Array.isArray(raw.aiSuggestions) ? raw.aiSuggestions : [],
    aiSuggestionSuccessCount: Number(raw.aiSuggestionSuccessCount || 0),
    aiSuggestionMaxSuccess: Number(raw.aiSuggestionMaxSuccess || 7)
  };
}

function prayerStatusText(status: PrayerStatus) {
  if (status === "answered") return "已蒙应允";
  if (status === "closed") return "无需再代祷";
  return "正在代祷";
}

function prayerActionText(message: MessageDTO) {
  const payload = prayerPayload(message);
  if (!payload.prayerCount) return "还没有人记录祷告";
  const names = payload.prayedBy
    .slice(0, 3)
    .map((item) => item.displayName)
    .join("、");
  return `${names}${payload.prayerCount > 3 ? ` 等 ${payload.prayerCount} 人` : ""} 已为此祷告`;
}

function prayerLatestTime(message: MessageDTO) {
  const latest = prayerPayload(message).prayedBy[0]?.latestPrayedAt;
  return latest ? adminDate(latest) : "";
}

function prayerAiSuggestions(message: MessageDTO) {
  return prayerPayload(message).aiSuggestions || [];
}

function prayerAiSuggestionCount(message: MessageDTO) {
  return prayerPayload(message).aiSuggestionSuccessCount || 0;
}

function prayerAiSuggestionMax(message: MessageDTO) {
  return prayerPayload(message).aiSuggestionMaxSuccess || 7;
}

function prayerAiLimitReached(message: MessageDTO) {
  return prayerAiSuggestionCount(message) >= prayerAiSuggestionMax(message);
}

function isPrayerAiExpanded(message: MessageDTO) {
  return expandedAiSuggestionMessageIds.value.has(message.id);
}

function isPrayerAiBusy(message: MessageDTO) {
  return aiSuggestionBusyIds.value.has(message.id);
}

function setPrayerAiExpanded(message: MessageDTO, expanded: boolean) {
  const next = new Set(expandedAiSuggestionMessageIds.value);
  if (expanded) next.add(message.id);
  else next.delete(message.id);
  expandedAiSuggestionMessageIds.value = next;
}

function setPrayerAiBusy(message: MessageDTO, busy: boolean) {
  const next = new Set(aiSuggestionBusyIds.value);
  if (busy) next.add(message.id);
  else next.delete(message.id);
  aiSuggestionBusyIds.value = next;
}

function setPrayerAiError(message: MessageDTO, text = "") {
  aiSuggestionErrors.value = { ...aiSuggestionErrors.value, [message.id]: text };
}

function bibleReferenceKey(suggestionId: number, reference: string) {
  return `${suggestionId}:${reference}`;
}

function isBibleReferenceExpanded(suggestionId: number, reference: string) {
  return expandedBibleReferenceKeys.value.has(bibleReferenceKey(suggestionId, reference));
}

function isBibleReferenceBusy(suggestionId: number, reference: string) {
  return bibleLookupBusyKeys.value.has(bibleReferenceKey(suggestionId, reference));
}

function bibleReferenceLookup(suggestionId: number, reference: string) {
  const key = bibleReferenceKey(suggestionId, reference);
  return Object.prototype.hasOwnProperty.call(bibleLookupCache.value, key) ? bibleLookupCache.value[key] : undefined;
}

function setBibleReferenceBusy(key: string, busy: boolean) {
  const next = new Set(bibleLookupBusyKeys.value);
  if (busy) next.add(key);
  else next.delete(key);
  bibleLookupBusyKeys.value = next;
}

async function toggleBibleReference(suggestionId: number, reference: string) {
  const key = bibleReferenceKey(suggestionId, reference);
  const next = new Set(expandedBibleReferenceKeys.value);
  if (next.has(key)) {
    next.delete(key);
    expandedBibleReferenceKeys.value = next;
    return;
  }
  next.add(key);
  expandedBibleReferenceKeys.value = next;
  if (Object.prototype.hasOwnProperty.call(bibleLookupCache.value, key) || bibleLookupBusyKeys.value.has(key)) return;
  setBibleReferenceBusy(key, true);
  try {
    const result = await api<{ success: boolean; result?: BibleLookupDTO; message?: string }>(`/api/bible/lookup?reference=${encodeURIComponent(reference)}`);
    bibleLookupCache.value = { ...bibleLookupCache.value, [key]: result.success && result.result ? result.result : null };
  } catch {
    bibleLookupCache.value = { ...bibleLookupCache.value, [key]: null };
  } finally {
    setBibleReferenceBusy(key, false);
  }
}

async function togglePrayerAiSuggestions(message: MessageDTO) {
  const hasSuggestions = prayerAiSuggestions(message).length > 0;
  if (!hasSuggestions && !isPrayerAiBusy(message)) {
    setPrayerAiExpanded(message, true);
    await generatePrayerAiSuggestions(message);
    return;
  }
  setPrayerAiExpanded(message, !isPrayerAiExpanded(message));
}

async function generatePrayerAiSuggestions(message: MessageDTO) {
  if (isPrayerAiBusy(message) || prayerAiLimitReached(message)) return;
  setPrayerAiExpanded(message, true);
  setPrayerAiBusy(message, true);
  setPrayerAiError(message);
  try {
    const result = await api<{ success: boolean; message: MessageDTO }>(`/api/messages/${message.id}/ai-suggestions/related-verses`, {
      method: "POST",
      body: JSON.stringify({})
    });
    store.replaceMessage(result.message);
  } catch (error) {
    setPrayerAiError(message, error instanceof Error ? error.message : "生成失败，可以稍后重试。");
  } finally {
    setPrayerAiBusy(message, false);
  }
}

async function markPrayerPrayed(message: MessageDTO) {
  await api(`/api/messages/${message.id}/prayed`, { method: "POST", body: JSON.stringify({}) });
  pendingPrayer.value = null;
  await store.loadMessages();
}

async function updatePrayerStatus(message: MessageDTO, status: "closed" | "answered") {
  await api(`/api/messages/${message.id}/prayer-status`, { method: "PATCH", body: JSON.stringify({ status }) });
  await store.loadMessages();
}

async function withdrawPrayer(message: MessageDTO) {
  if (!confirm("撤回这条代祷事项？")) return;
  await api(`/api/messages/${message.id}/prayer`, { method: "DELETE" });
  await store.loadMessages();
}

function isMine(message: MessageDTO) {
  return message.sender.id === store.account?.actorId || (!!message.sender.username && message.sender.username === store.account?.username);
}

function recallRemainingMs(message: MessageDTO) {
  return 120_000 - (Date.now() - new Date(message.createdAt).getTime());
}

function canRecallMessage(message: MessageDTO) {
  return message.id > 0 && message.type !== "system" && isMine(message) && recallRemainingMs(message) > 0;
}

function recallRemainingText(message: MessageDTO) {
  const seconds = Math.max(0, Math.ceil(recallRemainingMs(message) / 1000));
  return `${seconds} 秒内可撤回`;
}

function openRecallPrompt(message: MessageDTO, event?: MouseEvent) {
  recallPromptPosition.value = positionPromptNearEvent(event, { width: 210, height: 104 });
  pendingRecall.value = message;
  pendingChain.value = null;
  pendingDownload.value = null;
  pendingPrayer.value = null;
  selectedMember.value = null;
}

async function recallPendingMessage() {
  const message = pendingRecall.value;
  if (!message) return;
  try {
    await api(`/api/messages/${message.id}/recall`, { method: "POST", body: JSON.stringify({}) });
    pendingRecall.value = null;
    await store.loadMessages();
  } catch (error) {
    alert(error instanceof Error ? error.message : "撤回失败");
  }
}

function channelIconUrl(channel?: Pick<ChannelDTO, "icon"> | null) {
  return channel?.icon ? wallpaperUrl(channel.icon) : "/images/icon-192.svg";
}

async function saveNotice() {
  if (!store.currentChannelId) return;
  await api(`/api/channels/${store.currentChannelId}/pinned`, {
    method: "POST",
    body: JSON.stringify({ kind: "notice", content: noticeText.value, active: !!noticeText.value.trim() })
  });
  adminMsg.value = "已更新置顶";
}

async function loadAdmin() {
  syncChannelEdits();
  showAdmin.value = true;
  if (!isAdmin.value) return;
  const [a, v] = await Promise.all([api<{ accounts: any[] }>("/api/admin/accounts"), api<{ characters: any[] }>("/api/virtual-characters")]);
  accounts.value = a.accounts;
  syncAccountEdits();
  syncChannelEdits();
  virtuals.value = v.characters;
  noticeText.value = store.pinned?.kind === "notice" ? store.pinned.content || "" : "";
  if (adminTab.value === "appearance") await loadAdminAttachments();
  if (adminTab.value === "data") await loadAdminData();
  if (adminTab.value === "release") await checkForUpdates();
}

async function loadAdminData() {
  await loadAdminAttachments();
}

async function loadAdminAttachments() {
  const result = await api<{ attachments: AdminAttachmentDTO[] }>("/api/admin/attachments");
  adminAttachments.value = result.attachments;
  const available = new Set(result.attachments.map((item) => item.id));
  selectedAttachmentIds.value = selectedAttachmentIds.value.filter((id) => available.has(id));
}

function adminDate(value?: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function attachmentKindLabel(kind: AdminAttachmentDTO["kind"]) {
  if (kind === "avatar") return "头像";
  if (kind === "background") return "图片";
  return "上传";
}

function attachmentUsage(item: AdminAttachmentDTO) {
  return item.usage.length ? item.usage.join(" · ") : "未关联";
}

function backgroundAttachmentLabel(item: AdminAttachmentDTO) {
  const usage = item.usage.length ? item.usage.join("、") : "未使用";
  const date = adminDate(item.createdAt);
  return `${date ? `${date} · ` : ""}${usage} · ${item.label}`;
}

function toggleAllAttachments() {
  selectedAttachmentIds.value = allAttachmentsSelected.value ? [] : adminAttachments.value.map((item) => item.id);
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
  selectedAttachmentIds.value = [];
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
  selectedAttachmentIds.value = [];
  await loadAdminData();
  await store.loadChannels(store.currentChannelId);
}

function syncAccountEdits() {
  accountEdits.value = Object.fromEntries(
    accounts.value.map((account) => [
      account.id,
      {
        displayName: account.displayName,
        isAdmin: !!account.isAdmin,
        password: ""
      }
    ])
  );
}

function syncChannelEdits() {
  channelEdits.value = Object.fromEntries(
    store.channels.map((channel) => [
      channel.id,
      {
        name: channel.name,
        description: channel.description || ""
      }
    ])
  );
}

async function addUser() {
  adminMsg.value = "";
  await api("/api/admin/accounts", { method: "POST", body: JSON.stringify(newUser.value) });
  newUser.value = { username: "", displayName: "", password: "" };
  const a = await api<{ accounts: any[] }>("/api/admin/accounts");
  accounts.value = a.accounts;
  syncAccountEdits();
  adminMsg.value = "用户已添加";
}

async function updateAccount(account: any) {
  const edit = accountEdits.value[account.id];
  if (!edit) return;
  const result = await api<{ account: any }>(`/api/admin/accounts/${account.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      displayName: edit.displayName,
      isAdmin: edit.isAdmin,
      password: edit.password || undefined
    })
  });
  const index = accounts.value.findIndex((row) => row.id === account.id);
  if (index >= 0) accounts.value[index] = result.account;
  if (store.account?.id === result.account.id) store.account = result.account;
  syncAccountEdits();
  adminMsg.value = "用户资料已更新";
}

async function uploadAccountAvatar(account: any, event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  (event.target as HTMLInputElement).value = "";
  if (!file) return;
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`/api/admin/accounts/${account.id}/avatar`, { method: "POST", headers: authHeaders(), body: form });
  if (!response.ok) {
    const result = await response.json().catch(() => ({ message: "头像上传失败" }));
    alert(result.message || "头像上传失败");
    return;
  }
  const result = (await response.json()) as { account: any };
  const index = accounts.value.findIndex((row) => row.id === account.id);
  if (index >= 0) accounts.value[index] = result.account;
  if (store.account?.id === result.account.id) store.account = result.account;
  adminMsg.value = "头像已更新";
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
  const a = await api<{ accounts: any[] }>("/api/admin/accounts");
  accounts.value = a.accounts;
  syncAccountEdits();
  adminMsg.value = "导入完成";
}

async function deleteAccountAttachments(account: any) {
  if (!confirm(`删除 ${account.displayName} 发过的所有附件？消息会保留为删除提示。`)) return;
  const result = await api<{ deleted: number }>(`/api/admin/accounts/${account.id}/attachments`, { method: "DELETE" });
  adminMsg.value = `已删除 ${result.deleted} 个附件`;
  await store.loadMessages();
}

async function uploadWallpaper(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  (event.target as HTMLInputElement).value = "";
  if (!file) return;
  const form = new FormData();
  form.append("file", file);
  const response = await fetch("/api/admin/appearance/wallpaper", { method: "POST", headers: authHeaders(), body: form });
  if (!response.ok) {
    const result = await response.json().catch(() => ({ message: "壁纸上传失败" }));
    alert(result.message || "壁纸上传失败");
    return;
  }
  const result = (await response.json()) as { appearance: AppearanceDTO };
  store.appearance = result.appearance;
  await loadAdminAttachments().catch(() => undefined);
  adminMsg.value = "壁纸已更新";
}

async function uploadLoginBackground(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  (event.target as HTMLInputElement).value = "";
  if (!file) return;
  const form = new FormData();
  form.append("file", file);
  const response = await fetch("/api/admin/appearance/login-background", { method: "POST", headers: authHeaders(), body: form });
  if (!response.ok) {
    const result = await response.json().catch(() => ({ message: "登录页背景上传失败" }));
    alert(result.message || "登录页背景上传失败");
    return;
  }
  const result = (await response.json()) as { appearance: AppearanceDTO };
  store.appearance = result.appearance;
  await loadAdminAttachments().catch(() => undefined);
  adminMsg.value = "登录页背景已更新";
}

async function uploadLoginIcon(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  (event.target as HTMLInputElement).value = "";
  if (!file) return;
  const form = new FormData();
  form.append("file", file);
  const response = await fetch("/api/admin/appearance/login-icon", { method: "POST", headers: authHeaders(), body: form });
  if (!response.ok) {
    const result = await response.json().catch(() => ({ message: "登录页图标上传失败" }));
    alert(result.message || "登录页图标上传失败");
    return;
  }
  const result = (await response.json()) as { appearance: AppearanceDTO };
  store.appearance = result.appearance;
  await loadAdminAttachments().catch(() => undefined);
  adminMsg.value = "登录页图标已更新";
}

async function uploadAppIcon(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  (event.target as HTMLInputElement).value = "";
  if (!file) return;
  const form = new FormData();
  form.append("file", file);
  const response = await fetch("/api/admin/appearance/app-icon", { method: "POST", headers: authHeaders(), body: form });
  if (!response.ok) {
    const result = await response.json().catch(() => ({ message: "标签页图标上传失败" }));
    alert(result.message || "标签页图标上传失败");
    return;
  }
  const result = (await response.json()) as { appearance: AppearanceDTO };
  store.appearance = result.appearance;
  await loadAdminAttachments().catch(() => undefined);
  adminMsg.value = "标签页图标已更新";
}

async function reuseAppearanceBackground(field: "wallpaperPath" | "loginBackgroundPath", fileName: string, message: string) {
  const image = backgroundAttachmentOptions.value.find((item) => item.fileName === fileName);
  if (!image) return;
  const result = await api<{ appearance: AppearanceDTO }>("/api/admin/appearance", {
    method: "POST",
    body: JSON.stringify({ [field]: image.fileName })
  });
  store.appearance = result.appearance;
  await loadAdminAttachments().catch(() => undefined);
  adminMsg.value = message;
}

async function reuseWallpaper(event: Event) {
  const fileName = (event.target as HTMLSelectElement).value;
  if (!fileName) return;
  await reuseAppearanceBackground("wallpaperPath", fileName, "已使用已上传图片作为壁纸");
}

async function reuseLoginBackground(event: Event) {
  const fileName = (event.target as HTMLSelectElement).value;
  if (!fileName) return;
  await reuseAppearanceBackground("loginBackgroundPath", fileName, "已使用已上传图片作为登录背景");
}

async function clearWallpaper() {
  const result = await api<{ appearance: AppearanceDTO }>("/api/admin/appearance", { method: "POST", body: JSON.stringify({ wallpaperPath: null }) });
  store.appearance = result.appearance;
  await loadAdminAttachments().catch(() => undefined);
  adminMsg.value = "壁纸已移除";
}

async function clearLoginBackground() {
  const result = await api<{ appearance: AppearanceDTO }>("/api/admin/appearance", { method: "POST", body: JSON.stringify({ loginBackgroundPath: null }) });
  store.appearance = result.appearance;
  await loadAdminAttachments().catch(() => undefined);
  adminMsg.value = "登录页背景已移除";
}

async function clearLoginIcon() {
  const result = await api<{ appearance: AppearanceDTO }>("/api/admin/appearance", { method: "POST", body: JSON.stringify({ loginIconPath: null }) });
  store.appearance = result.appearance;
  await loadAdminAttachments().catch(() => undefined);
  adminMsg.value = "登录页图标图片已移除";
}

async function clearAppIcon() {
  const result = await api<{ appearance: AppearanceDTO }>("/api/admin/appearance", { method: "POST", body: JSON.stringify({ appIconPath: null }) });
  store.appearance = result.appearance;
  await loadAdminAttachments().catch(() => undefined);
  adminMsg.value = "标签页图标已恢复默认";
}

function syncLoginAppearanceEdit() {
  loginAppearanceEdit.value = {
    appTitle: store.appearance.appTitle || "Team Chat",
    loginTitle: store.appearance.loginTitle || "Team Chat",
    loginSubtitle: store.appearance.loginSubtitle || "",
    loginShowIcon: store.appearance.loginShowIcon !== false,
    loginShowSubtitle: store.appearance.loginShowSubtitle !== false,
    loginFormPosition: store.appearance.loginFormPosition || "middle",
    loginBackgroundFit: store.appearance.loginBackgroundFit || "cover",
    wallpaperFit: store.appearance.wallpaperFit || "cover",
    registrationEnabled: !!store.appearance.registrationEnabled
  };
  flashEffectEdit.value = {
    colors: [...flashEffect.value.colors],
    intervalSeconds: flashEffect.value.intervalSeconds,
    transitionMode: flashEffect.value.transitionMode
  };
  if (!store.appearance.registrationEnabled && authMode.value === "register") authMode.value = "login";
}

function addFlashColor() {
  if (flashEffectEdit.value.colors.length >= 10) return;
  flashEffectEdit.value.colors.push(flashEffectEdit.value.colors[flashEffectEdit.value.colors.length - 1] || "#fff176");
}

function removeFlashColor(index: number) {
  if (flashEffectEdit.value.colors.length <= 1) return;
  flashEffectEdit.value.colors.splice(index, 1);
}

async function saveFlashEffect() {
  const result = await api<{ appearance: AppearanceDTO }>("/api/admin/appearance", {
    method: "POST",
    body: JSON.stringify({ flashEffect: cleanFlashEffectSettings(flashEffectEdit.value) })
  });
  store.appearance = result.appearance;
  adminMsg.value = "闪动特效已保存";
}

async function saveLoginAppearance() {
  const result = await api<{ appearance: AppearanceDTO }>("/api/admin/appearance", {
    method: "POST",
    body: JSON.stringify({
      appTitle: loginAppearanceEdit.value.appTitle,
      loginTitle: loginAppearanceEdit.value.loginTitle,
      loginSubtitle: loginAppearanceEdit.value.loginSubtitle,
      loginShowIcon: loginAppearanceEdit.value.loginShowIcon,
      loginShowSubtitle: loginAppearanceEdit.value.loginShowSubtitle,
      loginFormPosition: loginAppearanceEdit.value.loginFormPosition,
      loginBackgroundFit: loginAppearanceEdit.value.loginBackgroundFit,
      wallpaperFit: loginAppearanceEdit.value.wallpaperFit,
      registrationEnabled: loginAppearanceEdit.value.registrationEnabled
    })
  });
  store.appearance = result.appearance;
  adminMsg.value = "登录页和注册设置已保存";
}

function themeSlug(name: string) {
  const ascii = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  return ascii || `theme-${Date.now().toString(36)}`;
}

function editTheme(theme: ThemeDTO) {
  customThemeEdit.value = {
    id: builtInThemes.some((item) => item.id === theme.id) ? "" : theme.id,
    name: builtInThemes.some((item) => item.id === theme.id) ? `${theme.name}副本` : theme.name,
    palette: { ...theme.palette }
  };
}

function resetThemeEditor() {
  customThemeEdit.value = { id: "", name: "我的主题", palette: { ...activePalette.value } };
}

async function saveCustomTheme() {
  const id = customThemeEdit.value.id || themeSlug(customThemeEdit.value.name);
  const theme: ThemeDTO = {
    id,
    name: customThemeEdit.value.name.trim() || "自定义主题",
    palette: { ...customThemeEdit.value.palette }
  };
  const existing = store.appearance.customThemes || [];
  const nextThemes = existing.some((item) => item.id === id) ? existing.map((item) => (item.id === id ? theme : item)) : [...existing, theme];
  const result = await api<{ appearance: AppearanceDTO }>("/api/admin/appearance", {
    method: "POST",
    body: JSON.stringify({ customThemes: nextThemes })
  });
  store.appearance = result.appearance;
  customThemeEdit.value = { ...theme, palette: { ...theme.palette } };
  adminMsg.value = "主题已保存";
}

async function deleteCustomTheme(theme: ThemeDTO) {
  if (!confirm(`删除主题“${theme.name}”？使用该主题的成员会回到默认主题。`)) return;
  const nextThemes = (store.appearance.customThemes || []).filter((item) => item.id !== theme.id);
  const result = await api<{ appearance: AppearanceDTO }>("/api/admin/appearance", {
    method: "POST",
    body: JSON.stringify({ customThemes: nextThemes })
  });
  store.appearance = result.appearance;
  if (customThemeEdit.value.id === theme.id) resetThemeEditor();
  adminMsg.value = "主题已删除";
}

async function addChannel() {
  await api("/api/channels", { method: "POST", body: JSON.stringify(newChannel.value) });
  newChannel.value = { name: "", description: "", isPrivate: false };
  await store.loadChannels();
  syncChannelEdits();
  adminMsg.value = "频道已创建";
}

async function updateChannel(channel: ChannelDTO) {
  const edit = channelEdits.value[channel.id];
  if (!edit) return;
  const result = await api<{ channel: ChannelDTO }>(`/api/channels/${channel.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: edit.name,
      description: edit.description
    })
  });
  const index = store.channels.findIndex((row) => row.id === channel.id);
  if (index >= 0) store.channels[index] = result.channel;
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
  const index = store.channels.findIndex((row) => row.id === channel.id);
  if (index >= 0) store.channels[index] = result.channel;
  syncChannelEdits();
  adminMsg.value = "频道图标已更新";
}

async function deleteChannel(channel: ChannelDTO) {
  if (channel.isDefault || channel.directKey || !channel.canManage) return;
  if (!confirm(`删除频道“${channel.name}”？频道内聊天记录会一并删除。`)) return;
  const fallbackChannelId = channel.id === store.currentChannelId ? store.previousChannelId : store.currentChannelId;
  await api(`/api/channels/${channel.id}`, { method: "DELETE" });
  await store.loadChannels(fallbackChannelId);
  syncChannelEdits();
  adminMsg.value = `频道“${channel.name}”已删除`;
}

async function addVirtual() {
  await api("/api/virtual-characters", {
    method: "POST",
    body: JSON.stringify({
      username: newVirtual.value.username,
      displayName: newVirtual.value.displayName,
      enabled: true
    })
  });
  newVirtual.value = { username: "", displayName: "" };
  virtuals.value = (await api<{ characters: any[] }>("/api/virtual-characters")).characters;
  adminMsg.value = "虚拟角色已创建";
}

async function toggleVirtual(character: any) {
  await api(`/api/virtual-characters/${character.id}`, {
    method: "PUT",
    body: JSON.stringify({ enabled: !character.enabled })
  });
  virtuals.value = (await api<{ characters: any[] }>("/api/virtual-characters")).characters;
}
</script>

<template>
  <main v-if="isAiSettingsRoute && store.account?.isAdmin" class="ai-settings-page" :style="appearanceStyle">
    <section class="ai-settings-panel">
      <header class="ai-settings-head">
        <div>
          <strong>AI 经文建议</strong>
          <small>DeepSeek v4 flash · 思考关闭</small>
        </div>
        <button class="mini-btn secondary" @click="returnToChat">回到聊天</button>
      </header>
      <form class="form-grid ai-settings-form" @submit.prevent="saveAiSettings">
        <label class="check-row"><input v-model="aiSettingsEdit.enabled" type="checkbox" /> 启用代祷经文建议</label>
        <label>DeepSeek API Key</label>
        <input v-model="aiSettingsEdit.apiKey" type="password" autocomplete="off" :placeholder="aiSettings?.apiKeyConfigured ? '已设置，留空不改' : '请输入 DeepSeek API Key'" />
        <label v-if="aiSettings?.apiKeyConfigured" class="check-row"><input v-model="aiSettingsEdit.clearApiKey" type="checkbox" /> 清除已保存的 API Key</label>
        <div class="ai-defaults">
          <span>Base URL：{{ aiSettings?.baseUrl || 'https://api.deepseek.com' }}</span>
          <span>Model：{{ aiSettings?.model || 'deepseek-v4-flash' }}</span>
        </div>
        <button class="text-btn ai-advanced-toggle" type="button" @click="aiSettingsShowAdvanced = !aiSettingsShowAdvanced">
          {{ aiSettingsShowAdvanced ? "收起高级设置" : "高级设置" }}
        </button>
        <div v-if="aiSettingsShowAdvanced" class="ai-advanced-fields">
          <label>提示词命令</label>
          <textarea v-model="aiSettingsEdit.promptCommand" rows="9"></textarea>
          <label>同一代祷卡片冷却秒数</label>
          <input v-model.number="aiSettingsEdit.cardCooldownSeconds" type="number" min="0" max="3600" step="1" />
          <label>同一用户每分钟最多生成</label>
          <input v-model.number="aiSettingsEdit.userLimitPerMinute" type="number" min="1" max="60" step="1" />
          <label>每张代祷卡片最多成功生成</label>
          <input v-model.number="aiSettingsEdit.maxSuccessPerMessage" type="number" min="1" max="20" step="1" />
        </div>
        <button class="primary-btn" type="submit" :disabled="aiSettingsBusy">{{ aiSettingsBusy ? "保存中" : "保存 AI 设置" }}</button>
        <p v-if="aiSettingsMsg" class="settings-note">{{ aiSettingsMsg }}</p>
      </form>
    </section>
  </main>

  <main v-else-if="!store.account" class="login-shell" :class="loginShellClass" :style="appearanceStyle">
    <section class="login-panel">
      <div v-if="loginBrand.showIcon" class="login-mark">
        <img :src="wallpaperUrl(loginBrand.iconPath)" alt="" />
      </div>
      <h1>{{ loginBrand.title }}</h1>
      <p v-if="loginBrand.showSubtitle && loginBrand.subtitle">{{ loginBrand.subtitle }}</p>
      <form @submit.prevent="doLogin">
        <input v-model="username" autocomplete="username" placeholder="用户名" />
        <input v-if="authMode === 'register'" v-model="displayName" autocomplete="name" placeholder="显示名" />
        <input v-model="password" autocomplete="current-password" placeholder="密码" type="password" />
        <button class="primary-btn" type="submit">{{ authMode === "register" ? "注册并登录" : "登录" }}</button>
      </form>
      <button v-if="store.appearance.registrationEnabled" class="text-btn login-mode-btn" @click="authMode = authMode === 'register' ? 'login' : 'register'; loginError = ''">
        {{ authMode === "register" ? "已有账号，返回登录" : "没有账号？注册" }}
      </button>
      <div v-if="loginError" class="form-error">{{ loginError }}</div>
    </section>
  </main>

  <main v-else-if="isAiSettingsRoute" class="ai-settings-page" :style="appearanceStyle">
    <section class="ai-settings-panel ai-denied-panel">
      <BookOpen :size="30" />
      <strong>无权访问 AI 设置</strong>
      <p>只有管理员可以配置 DeepSeek API Key 和代祷经文建议。</p>
      <button class="primary-btn" @click="returnToChat">回到聊天</button>
    </section>
  </main>

  <main v-else class="app-shell" :class="{ 'channels-collapsed': channelsCollapsed, 'members-collapsed': membersCollapsed }" :style="appearanceStyle">
    <section v-if="staleVersionVisible" class="version-refresh-banner">
      <span>{{ staleVersionMessage }}</span>
      <button class="mini-btn secondary" @click="reloadToLatestVersion">立即刷新</button>
    </section>

    <aside class="channel-pane" :class="{ open: showChannels, collapsed: channelsCollapsed }">
      <header class="pane-head">
        <strong>聊天室</strong>
        <button class="icon-btn desktop-only" @click="channelsCollapsed = true" aria-label="收起频道"><PanelLeftClose :size="20" /></button>
        <button class="icon-btn mobile-only" @click="showChannels = false" aria-label="关闭频道"><X :size="20" /></button>
      </header>
      <template v-for="channel in store.channels" :key="channel.id">
        <button
          class="channel-row"
          :class="{ active: channel.id === store.currentChannelId && !store.prayerOnly }"
          @click="store.switchChannel(channel.id); showChannels = false"
        >
          <span class="channel-icon"><img :src="channelIconUrl(channel)" alt="" /></span>
          <span>
            <b>{{ channel.name }}</b>
            <small>{{ channel.isPrivate ? "私密频道" : "公开频道" }}</small>
          </span>
        </button>
        <button
          class="channel-row channel-subrow"
          :class="{ active: channel.id === store.currentChannelId && store.prayerOnly }"
          @click="store.switchPrayerView(channel.id); showChannels = false"
        >
          <span class="channel-icon prayer-icon"><HeartHandshake :size="20" /></span>
          <span>
            <b>代祷事项</b>
            <small>{{ channel.name }}</small>
          </span>
        </button>
      </template>
      <footer class="profile-row">
        <div class="avatar">
          <img v-if="avatarUrl(store.account.avatarPath)" :src="avatarUrl(store.account.avatarPath)" alt="" />
          <span v-else>{{ avatarText(store.account.displayName) }}</span>
        </div>
        <div>
          <b>{{ store.account.displayName }}</b>
          <small>{{ store.account.isAdmin ? "管理员" : "成员" }}</small>
        </div>
        <button class="icon-btn" @click="openSettings()" aria-label="设置"><Settings :size="18" /></button>
        <button class="icon-btn" @click="store.logout()" aria-label="退出"><LogOut :size="18" /></button>
      </footer>
    </aside>

    <section class="chat-pane">
      <canvas v-if="rainActive" ref="rainCanvas" class="rain-canvas" aria-hidden="true"></canvas>
      <div ref="dripLayer" class="drip-layer" aria-hidden="true"></div>
      <header class="chat-head">
        <button class="icon-btn mobile-only" @click="showChannels = true" aria-label="频道"><ChevronLeft :size="22" /></button>
        <button v-if="channelsCollapsed" class="icon-btn desktop-only" @click="channelsCollapsed = false" aria-label="展开频道"><PanelLeftOpen :size="20" /></button>
        <div class="chat-title">
          <strong>{{ store.prayerOnly ? `${currentChannel?.name || "聊天室"} · 代祷事项` : currentChannel?.name || "聊天室" }}</strong>
          <small>{{ store.prayerOnly ? "只显示本频道代祷卡片" : `${store.members.length} 人/角色` }}</small>
        </div>
        <button class="icon-btn" @click="membersCollapsed = false; showMembers = !showMembers" aria-label="成员">
          <PanelRightOpen v-if="membersCollapsed" :size="20" />
          <Users v-else :size="20" />
        </button>
        <button v-if="currentChannel?.directKey" class="icon-btn" @click="requestCloseChannel" aria-label="关闭私聊"><X :size="20" /></button>
        <button v-if="canDeleteCurrentChannel" class="icon-btn danger" @click="currentChannel && deleteChannel(currentChannel)" aria-label="删除频道"><Trash2 :size="19" /></button>
        <button v-if="isAdmin" class="icon-btn" :class="{ active: messageSelectionMode }" @click="toggleMessageSelectionMode" aria-label="多选聊天记录"><CheckCircle2 :size="20" /></button>
        <button v-if="isAdmin" class="icon-btn" @click="loadAdmin" aria-label="管理"><Settings :size="20" /></button>
      </header>

      <section v-if="messageSelectionMode" class="message-selection-bar">
        <span>已选择 {{ selectedMessageCount }} 条</span>
        <button class="mini-btn secondary" @click="toggleVisibleMessageSelection">{{ visibleMessagesSelected ? "取消全选" : "全选当前" }}</button>
        <button class="mini-btn danger-action" :disabled="!selectedMessageCount" @click="deleteSelectedMessages"><Trash2 :size="15" />删除</button>
        <button class="mini-btn secondary" @click="toggleMessageSelectionMode">完成</button>
      </section>

      <section v-if="activeTopNotice" class="top-notice-shell" :class="`top-notice-${activeTopNotice.kind}`">
        <button class="top-notice-card" :class="{ clickable: activeTopNotice.kind === 'mention' }" @click="openTopNotice(activeTopNotice)">
          <span class="top-notice-icon">
            <AtSign v-if="activeTopNotice.kind === 'mention'" :size="16" />
            <MessageCircle v-else :size="16" />
          </span>
          <span class="top-notice-copy">
            <strong>{{ activeTopNotice.title }}</strong>
            <small>{{ activeTopNotice.body }}</small>
          </span>
          <span v-if="topNoticeItems.length > 1" class="top-notice-count">{{ (topNoticeIndex % topNoticeItems.length) + 1 }}/{{ topNoticeItems.length }}</span>
        </button>
      </section>

      <section v-if="store.pinned" class="pin-card" :class="{ expanded: pinnedExpanded }">
        <button class="pin-card-head" @click="pinnedExpanded = !pinnedExpanded" :aria-expanded="pinnedExpanded">
          <Pin :size="16" />
          <span>{{ pinnedText }}</span>
          <ChevronUp v-if="pinnedExpanded" :size="17" />
          <ChevronDown v-else :size="17" />
        </button>
        <div v-if="pinnedExpanded" class="pin-card-body">
          <p>{{ pinnedText }}</p>
          <button v-if="store.pinned.messageId" class="text-btn" @click="jumpToReply(store.pinned.messageId)">定位到原消息</button>
        </div>
      </section>

      <div ref="scroller" class="messages-scroll" @scroll.passive="handleMessagesScroll">
        <button
          v-if="messageLoadBanner"
          type="button"
          class="message-load-banner"
          :class="`message-load-${messageLoadBanner.kind}`"
          :disabled="messageLoadBanner.kind !== 'error'"
          @click="messageLoadBanner.kind === 'error' && retryMessageLoad()"
        >
          {{ messageLoadBanner.text }}
        </button>
        <div v-if="store.loadingInitialMessages && !store.messages.length" class="message-skeleton-list" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
        </div>
        <template v-for="row in timeline" :key="row.kind === 'time' ? row.id : row.message.id">
          <div v-if="row.kind === 'time'" class="time-separator">{{ row.label }}</div>
          <article
            v-else
            class="message-row"
            :class="{ mine: isMine(row.message), virtual: row.message.sender.kind === 'virtual', system: row.message.type === 'system', 'mention-alert': isMentionAlertActive(row.message), selecting: messageSelectionMode, selected: selectedMessageIds.has(row.message.id) }"
            :data-message-id="row.message.id"
          >
            <button
              v-if="messageSelectionMode && row.message.id > 0"
              class="message-select-btn"
              :class="{ selected: selectedMessageIds.has(row.message.id) }"
              @click.stop="toggleMessageSelected(row.message)"
              :aria-label="selectedMessageIds.has(row.message.id) ? '取消选择消息' : '选择消息'"
            >
              <CheckCircle2 :size="18" />
            </button>
            <div class="avatar presence-avatar" :class="{ bot: row.message.sender.kind === 'virtual' }">
              <img v-if="avatarUrl(row.message.sender.avatarPath)" :src="avatarUrl(row.message.sender.avatarPath)" alt="" />
              <span v-else>{{ avatarText(row.message.sender.displayName) }}</span>
              <i v-if="isActorOnline(row.message.sender.id)" class="online-dot" aria-label="在线"></i>
            </div>
            <div class="bubble-wrap">
              <div class="sender-line">
                <span>{{ row.message.sender.displayName }}</span>
                <em v-if="row.message.sender.kind === 'virtual'">虚拟角色</em>
              </div>
              <div
                class="bubble"
                :class="[{ 'media-bubble': row.message.type === 'image' || row.message.type === 'file', 'prayer-bubble': row.message.type === 'prayer' }, messageEffectClass(row.message)]"
                :style="messageEffectStyle(row.message)"
                :data-chain-bubble="row.message.type === 'chain' ? 'true' : null"
                @pointerdown="beginMessageLongPress(row.message, $event)"
                @pointermove="handleBubblePointerMove(row.message, $event)"
                @pointerup="clearMessageLongPress"
                @pointercancel="handleBubblePointerLeave(row.message, $event)"
                @pointerleave="handleBubblePointerLeave(row.message, $event)"
                @contextmenu.prevent
                @click="handleBubbleClick(row.message, $event)"
              >
                <button v-if="row.message.replyTo" class="reply-preview" @click.stop="jumpToReply(row.message.replyTo.id)">
                  <MessageSquareQuote :size="14" />
                  {{ row.message.replyTo.senderName }}：{{ row.message.replyTo.content || row.message.replyTo.type }}
                </button>
                <template v-if="row.message.type === 'chain'">
                  <div class="chain-card">
                    <h3>{{ chainPayload(row.message).topic }}</h3>
                    <ol>
                      <li v-for="(p, idx) in chainPayload(row.message).participants" :key="idx">
                        <span>{{ idx + 1 }}. {{ p.name }}</span>
                        <small v-if="p.text">{{ p.text }}</small>
                      </li>
                    </ol>
                    <button class="mini-btn" @click.stop="confirmJoinChain(row.message, $event)">参与接龙</button>
                  </div>
                </template>
                <template v-else-if="row.message.type === 'prayer'">
                  <div class="prayer-card" :class="`status-${prayerPayload(row.message).status}`">
                    <div class="prayer-card-head">
                      <span><HeartHandshake :size="17" /></span>
                      <strong>代祷事项</strong>
                      <em>{{ prayerStatusText(prayerPayload(row.message).status) }}</em>
                    </div>
                    <p class="prayer-text" v-html="row.message.content"></p>
                    <div class="prayer-stats">
                      <strong>已有 {{ prayerPayload(row.message).prayerCount }} 人为此祷告</strong>
                      <small>{{ prayerActionText(row.message) }}<template v-if="prayerLatestTime(row.message)"> · 最近 {{ prayerLatestTime(row.message) }}</template></small>
                    </div>
                    <div v-if="prayerPayload(row.message).prayedBy.length" class="prayer-people" aria-label="已祷告成员">
                      <span v-for="person in prayerPayload(row.message).prayedBy.slice(0, 6)" :key="person.accountId" class="mini-avatar" :title="`${person.displayName} · ${person.times} 次`">
                        <img v-if="avatarUrl(person.avatarPath)" :src="avatarUrl(person.avatarPath)" alt="" />
                        <span v-else>{{ avatarText(person.displayName) }}</span>
                      </span>
                    </div>
                    <div class="prayer-actions">
                      <button v-if="prayerPayload(row.message).status === 'active'" class="mini-btn" @click.stop="requestPrayerPrayed(row.message, $event)">
                        <CheckCircle2 :size="15" />{{ prayerPayload(row.message).currentUserPrayed ? "再次记录祷告" : "我已祷告" }}
                      </button>
                      <template v-if="isMine(row.message) && prayerPayload(row.message).status === 'active'">
                        <button class="mini-btn secondary" @click.stop="updatePrayerStatus(row.message, 'closed')"><CircleOff :size="15" />无需再代祷</button>
                        <button class="mini-btn secondary" @click.stop="updatePrayerStatus(row.message, 'answered')"><CheckCircle2 :size="15" />已蒙应允</button>
                      </template>
                      <button v-if="isMine(row.message)" class="mini-btn danger-soft" @click.stop="withdrawPrayer(row.message)"><Trash2 :size="15" />撤回</button>
                    </div>
                    <div class="prayer-ai" @click.stop>
                      <button class="prayer-ai-toggle" type="button" @click="togglePrayerAiSuggestions(row.message)">
                        <BookOpen :size="15" />
                        <span>也许相关的经文<template v-if="prayerAiSuggestionCount(row.message)"> · {{ prayerAiSuggestionCount(row.message) }}</template></span>
                        <ChevronUp v-if="isPrayerAiExpanded(row.message)" :size="15" />
                        <ChevronDown v-else :size="15" />
                      </button>
                      <div v-if="isPrayerAiExpanded(row.message)" class="prayer-ai-body">
                        <article v-for="suggestion in prayerAiSuggestions(row.message)" :key="suggestion.id" class="prayer-ai-suggestion">
                          <div class="prayer-ai-meta">
                            <span>{{ adminDate(suggestion.createdAt) }}</span>
                            <small v-if="suggestion.createdByName">由 {{ suggestion.createdByName }} 生成</small>
                          </div>
                          <div v-for="reference in suggestion.references" :key="`${suggestion.id}-${reference}`" class="prayer-ai-reference">
                            <button class="prayer-ai-reference-btn" type="button" @click="toggleBibleReference(suggestion.id, reference)">
                              <span>{{ reference }}</span>
                              <ChevronUp v-if="isBibleReferenceExpanded(suggestion.id, reference)" :size="14" />
                              <ChevronDown v-else :size="14" />
                            </button>
                            <div v-if="isBibleReferenceExpanded(suggestion.id, reference)" class="prayer-ai-verses">
                              <p v-if="isBibleReferenceBusy(suggestion.id, reference)" class="prayer-ai-empty">正在查找经文...</p>
                              <template v-else-if="bibleReferenceLookup(suggestion.id, reference)?.verses.length">
                                <small>{{ bibleReferenceLookup(suggestion.id, reference)?.normalizedReference }} · {{ bibleReferenceLookup(suggestion.id, reference)?.translation }}</small>
                                <p v-for="verse in bibleReferenceLookup(suggestion.id, reference)?.verses" :key="`${suggestion.id}-${reference}-${verse.reference}`">
                                  <strong>{{ verse.reference }}</strong>
                                  <span>{{ verse.text }}</span>
                                </p>
                              </template>
                              <p v-else class="prayer-ai-empty">暂时找不到这处经文</p>
                            </div>
                          </div>
                        </article>
                        <p v-if="!prayerAiSuggestions(row.message).length && !isPrayerAiBusy(row.message)" class="prayer-ai-empty">还没有经文建议</p>
                        <p v-if="aiSuggestionErrors[row.message.id]" class="prayer-ai-error">{{ aiSuggestionErrors[row.message.id] }}</p>
                        <div class="prayer-ai-actions">
                          <button
                            class="mini-btn secondary"
                            :disabled="isPrayerAiBusy(row.message) || prayerAiLimitReached(row.message)"
                            @click="generatePrayerAiSuggestions(row.message)"
                          >
                            {{ isPrayerAiBusy(row.message) ? "正在寻找相关经文..." : prayerAiSuggestions(row.message).length ? "换一组" : "生成建议" }}
                          </button>
                          <small v-if="prayerAiLimitReached(row.message)">这张代祷卡片的经文建议已达到上限</small>
                        </div>
                      </div>
                    </div>
                  </div>
                </template>
                <template v-else-if="row.message.type === 'image'">
                  <button class="image-preview-button" @click.stop="openAttachmentFromTap(row.message, $event)">
                    <img class="chat-image" :src="fileUrl(row.message)" alt="图片" />
                  </button>
                </template>
                <template v-else-if="isVoiceMessage(row.message)">
                  <div v-if="pendingUploadFor(row.message)" class="voice-card voice-upload-card" :class="{ failed: pendingUploadFor(row.message)?.status === 'failed' }" @click.stop>
                    <span class="voice-play upload-spinner">
                      <Upload v-if="pendingUploadFor(row.message)?.status !== 'failed'" :size="18" />
                      <X v-else :size="18" />
                    </span>
                    <div class="voice-upload-body">
                      <div class="voice-upload-bar">
                        <span :style="{ width: `${pendingUploadFor(row.message)?.progress || 0}%` }"></span>
                      </div>
                      <small>{{ pendingUploadLabel(pendingUploadFor(row.message)!) }}</small>
                    </div>
                    <div class="voice-upload-actions">
                      <button v-if="pendingUploadFor(row.message)?.status === 'failed'" class="mini-icon-btn" @click="retryPendingUpload(row.message.id)" aria-label="重试语音发送">
                        <RotateCcw :size="15" />
                      </button>
                      <button class="mini-icon-btn" @click="removePendingMessage(row.message.id)" aria-label="移除语音发送状态"><Trash2 :size="15" /></button>
                    </div>
                  </div>
                  <div v-else class="voice-card" :class="{ playing: playingVoiceId === row.message.id, unread: hasUnlistenedVoice(row.message) }" @click.stop>
                    <button class="voice-play" @click="toggleVoicePlayback(row.message)" :aria-label="playingVoiceId === row.message.id ? '暂停语音' : '播放语音'">
                      <Pause v-if="playingVoiceId === row.message.id" :size="20" />
                      <Play v-else :size="20" />
                    </button>
                    <button class="voice-waveform" @click="toggleVoicePlayback(row.message)" aria-label="播放语音波形">
                      <span
                        v-for="(bar, idx) in waveformForMessage(row.message)"
                        :key="idx"
                        class="voice-bar"
                        :class="{ active: idx / waveformForMessage(row.message).length <= voiceProgressValue(row.message) }"
                        :style="voiceBarStyle(bar, idx, waveformForMessage(row.message).length, voiceProgressValue(row.message))"
                      ></span>
                    </button>
                    <div class="voice-meta">
                      <span>{{ formatDuration(voiceDurationMs(row.message)) }}</span>
                      <small>{{ compactBytes(row.message.fileSize) }}</small>
                    </div>
                    <span v-if="hasUnlistenedVoice(row.message)" class="voice-unread-dot" aria-label="未收听"></span>
                  </div>
                </template>
                <template v-else-if="isAudioMessage(row.message)">
                  <button class="media-file-card audio-file-card" @click.stop="openAttachmentFromTap(row.message, $event)">
                    <span class="media-file-icon"><Mic :size="22" /></span>
                    <span>{{ row.message.fileName }}</span>
                    <small>音频 · {{ compactBytes(row.message.fileSize) }}</small>
                  </button>
                </template>
                <template v-else-if="isVideoMessage(row.message)">
                  <button class="media-file-card video-file-card" @click.stop="openAttachmentFromTap(row.message, $event)">
                    <span class="media-file-icon"><Play :size="22" /></span>
                    <span>{{ row.message.fileName }}</span>
                    <small>{{ compactBytes(row.message.fileSize) }}</small>
                  </button>
                </template>
                <template v-else-if="row.message.type === 'file'">
                  <button class="file-card" data-file-card @click.stop="openAttachmentFromTap(row.message, $event)">
                    <img v-if="isDocumentMessage(row.message)" class="file-card-icon" :src="documentIconSrc(row.message)" alt="" />
                    <span v-else class="generic-file-icon"><Download :size="18" /></span>
                    <span>{{ row.message.fileName }}</span>
                    <small>{{ documentKindLabel(row.message) }} · {{ compactBytes(row.message.fileSize) }}</small>
                  </button>
                </template>
                <p v-else class="message-text" v-html="row.message.content"></p>
              </div>
            </div>
          </article>
        </template>
      </div>

      <button v-if="hasUnreadMessages" type="button" class="new-message-jump" @click="scrollToNewest">有新消息</button>

      <footer class="composer">
        <div v-if="replyTo" class="reply-bar">
          <button class="icon-btn" @click="replyTo = null" aria-label="取消引用"><X :size="16" /></button>
          <span>引用 {{ replyTo.sender.displayName }}：{{ replyTo.content || replyTo.type }}</span>
        </div>
        <div class="composer-input-shell">
          <div class="composer-main" :class="{ raised: composerPanel }">
            <button class="icon-btn" :class="{ active: composerPanel === 'voice' }" @click="toggleVoicePanel" aria-label="语音消息"><Mic :size="22" /></button>
            <textarea
              ref="composerInput"
              v-model="input"
              rows="1"
              :placeholder="store.prayerOnly ? '输入代祷事项' : '输入消息'"
              @focus="focusComposer(); syncComposerCaret()"
              @input="onInput"
              @click="syncComposerCaret"
              @keyup="syncComposerCaret"
              @keydown="onKeydown"
            ></textarea>
            <button class="send-btn" :disabled="!canSendText" @click="sendText" aria-label="发送"><Send :size="19" /></button>
            <button class="icon-btn" :class="{ active: composerPanel === 'more' }" @click="toggleMorePanel" aria-label="更多功能"><Plus :size="22" /></button>
            <input ref="fileInput" class="hidden" type="file" @change="(e: Event) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) uploadFile(f); (e.target as HTMLInputElement).value = '' }" />
            <input ref="photoInput" class="hidden" type="file" accept="image/*" @change="(e: Event) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) uploadFile(f); (e.target as HTMLInputElement).value = '' }" />
          </div>
          <div v-if="showComposerSuggestionMenu" class="composer-suggestion-menu">
            <template v-if="activeComposerSuggestionKind === 'mention'">
              <button
                v-for="(member, index) in matchingMentionMembers"
                :key="member.id"
                type="button"
                class="composer-suggestion"
                :class="{ active: index === composerSuggestionIndex }"
                @click="chooseMentionSuggestion(member)"
              >
                <div class="avatar presence-avatar" :class="{ bot: member.kind === 'virtual' }">
                  <img v-if="avatarUrl(member.avatarPath)" :src="avatarUrl(member.avatarPath)" alt="" />
                  <span v-else>{{ avatarText(member.displayName) }}</span>
                  <i v-if="isAccountOnline(member.accountId)" class="online-dot" aria-label="在线"></i>
                </div>
                <span>{{ member.displayName }}</span>
                <small>{{ member.username ? `@${member.username}` : member.kind === 'virtual' ? '虚拟角色' : '频道成员' }}</small>
              </button>
            </template>
            <template v-else>
              <button
                v-for="(item, index) in matchingSlashCommands"
                :key="item.command"
                type="button"
                class="composer-suggestion"
                :class="{ active: index === composerSuggestionIndex }"
                @click="chooseSlashCommand(item)"
              >
                <component :is="item.icon" :size="18" />
                <span>{{ item.command }}</span>
                <small>{{ item.hint }}</small>
              </button>
            </template>
          </div>
        </div>
        <div v-if="composerPanel === 'voice'" class="composer-drawer voice-drawer">
          <div class="record-strip" :class="{ recording: isRecording }">
            <span class="record-dot"></span>
            <strong>{{ recordingStatus || "点击麦克风开始录音" }}</strong>
            <small>{{ formatDuration(recordingDuration) }}</small>
            <button v-if="isRecording" class="icon-btn" @click="stopRecording" aria-label="停止录音"><Square :size="18" /></button>
            <button v-else class="icon-btn" @click="startRecording" aria-label="重新录音"><RotateCcw :size="18" /></button>
          </div>
          <div v-if="audioPreviewUrl" class="voice-preview">
            <audio
              ref="previewAudioEl"
              class="hidden"
              :src="audioPreviewUrl"
              preload="metadata"
              @timeupdate="updatePreviewProgress"
              @loadedmetadata="syncPreviewMetadata"
              @ended="endPreviewPlayback"
              @pause="previewPlaying = false"
            ></audio>
            <button class="icon-btn danger" @click="resetRecording" aria-label="删除录音"><Trash2 :size="18" /></button>
            <div class="voice-preview-card">
              <button class="preview-play" @click="togglePreviewPlayback" :aria-label="previewPlaying ? '暂停预览' : '播放预览'">
                <Pause v-if="previewPlaying" :size="20" />
                <Play v-else :size="20" />
              </button>
              <div class="preview-waveform">
                <span
                  v-for="(bar, idx) in audioPreviewWaveform"
                  :key="idx"
                  class="voice-bar"
                  :class="{ active: idx / audioPreviewWaveform.length <= previewProgress }"
                  :style="voiceBarStyle(bar, idx, audioPreviewWaveform.length, previewProgress)"
                ></span>
              </div>
              <span>{{ formatDuration(audioPreviewDurationMs) }}</span>
            </div>
            <button class="send-btn" :disabled="voiceSending" @click="sendVoice">{{ voiceSending ? "发送中" : "发送" }}</button>
          </div>
        </div>
        <div v-if="composerPanel === 'more'" class="composer-drawer more-drawer">
          <button class="tool-tile" @click="fileInput?.click()">
            <span><FileUp :size="25" /></span>
            <small>文件</small>
          </button>
          <button class="tool-tile" @click="photoInput?.click()">
            <span><ImageIcon :size="25" /></span>
            <small>照片</small>
          </button>
          <button class="tool-tile" @click="openChainModal">
            <span><Plus :size="25" /></span>
            <small>接龙</small>
          </button>
          <button class="tool-tile" @click="startPrayerComposer">
            <span><HeartHandshake :size="25" /></span>
            <small>代祷</small>
          </button>
        </div>
      </footer>
    </section>

    <aside class="member-pane" :class="{ open: showMembers, collapsed: membersCollapsed }">
      <header class="pane-head">
        <strong>成员</strong>
        <button class="icon-btn desktop-only" @click="membersCollapsed = true; showMembers = false" aria-label="收起成员"><PanelRightClose :size="20" /></button>
        <button class="icon-btn tablet-down" @click="showMembers = false" aria-label="关闭成员"><X :size="20" /></button>
      </header>
      <div class="member-list">
        <button v-for="member in store.members" :key="member.id" class="member-row" @click="openMemberActions(member, $event)">
          <div class="avatar presence-avatar" :class="{ bot: member.kind === 'virtual' }">
            <img v-if="avatarUrl(member.avatarPath)" :src="avatarUrl(member.avatarPath)" alt="" />
            <span v-else>{{ avatarText(member.displayName) }}</span>
            <i v-if="isAccountOnline(member.accountId)" class="online-dot" aria-label="在线"></i>
          </div>
          <span>{{ member.displayName }}</span>
          <Bot v-if="member.kind === 'virtual'" :size="15" />
        </button>
      </div>
    </aside>

    <div v-if="showChannels || showMembers" class="scrim" @click="showChannels = false; showMembers = false"></div>

    <section v-if="showChainModal" class="modal-shell">
      <form class="small-modal" @submit.prevent="createChain">
        <header class="modal-head">
          <strong>发起接龙</strong>
          <button class="icon-btn" type="button" @click="showChainModal = false" aria-label="关闭接龙"><X :size="20" /></button>
        </header>
        <div class="form-grid modal-form">
          <label>接龙信息</label>
          <input v-model="chainTopic" autocomplete="off" placeholder="例如：周六聚餐报名" />
          <button class="primary-btn" type="submit" :disabled="!chainTopic.trim()">发布接龙</button>
        </div>
      </form>
    </section>

    <section v-if="pendingChain" class="tap-popover chain-join-popover" :style="chainPromptStyle" data-chain-popover>
      <div class="tap-popover-card">
        <div class="compact-confirm">
          <span>确认接龙？</span>
          <div class="compact-actions">
            <button class="mini-btn secondary" @click="pendingChain = null">否</button>
            <button class="mini-btn" @click="joinPendingChain">是</button>
          </div>
        </div>
      </div>
    </section>

    <section v-if="pendingDownload" class="tap-popover download-popover" :style="downloadPromptStyle" data-download-popover>
      <div class="tap-popover-card">
        <div class="compact-confirm">
          <span>无法预览，下载？</span>
          <div class="compact-actions">
            <button class="mini-btn secondary" @click="pendingDownload = null">否</button>
            <button class="mini-btn" @click="downloadFile(pendingDownload)">是</button>
          </div>
        </div>
      </div>
    </section>

    <section v-if="pendingRecall" class="tap-popover recall-popover" :style="recallPromptStyle" data-recall-popover>
      <div class="tap-popover-card">
        <div class="compact-confirm">
          <span>撤回这条消息？</span>
          <small>{{ recallRemainingText(pendingRecall) }}</small>
          <div class="compact-actions">
            <button class="mini-btn secondary" @click="pendingRecall = null">取消</button>
            <button class="mini-btn danger-soft" @click="recallPendingMessage">撤回</button>
          </div>
        </div>
      </div>
    </section>

    <section v-if="pendingPrayer" class="tap-popover prayer-popover" :style="prayerPromptStyle" data-prayer-popover>
      <div class="tap-popover-card">
        <div class="compact-confirm">
          <span>{{ prayerPayload(pendingPrayer).currentUserPrayed ? "再次记录祷告？" : "记录已祷告？" }}</span>
          <small>{{ prayerPayload(pendingPrayer).currentUserPrayed ? "会为这张卡片再增加一次祷告记录" : "确认后大家会看到你已经为此祷告" }}</small>
          <div class="compact-actions">
            <button class="mini-btn secondary" @click="pendingPrayer = null">不小心点错了</button>
            <button class="mini-btn" @click="markPrayerPrayed(pendingPrayer)">我确实为此祷告过了</button>
          </div>
        </div>
      </div>
    </section>

    <section v-if="selectedMember" class="tap-popover" :style="memberPromptStyle" data-member-popover>
      <div class="tap-popover-card member-action-popover">
        <div class="member-action-body">
          <div class="member-popover-actions">
            <button class="mini-btn" @click="mentionSelectedMember"><AtSign :size="15" />提及 @</button>
            <button class="mini-btn secondary" :disabled="!selectedMember.accountId || selectedMember.accountId === store.account.id" @click="startPrivateChat(selectedMember)">
              <MessageCircle :size="15" />私聊
            </button>
          </div>
        </div>
      </div>
    </section>

    <section v-if="previewMessage" class="modal-shell media-preview-shell" :class="{ image: previewMessage.type === 'image' }" @click.self="closePreviewMessage">
      <div class="media-preview-modal" :class="{ 'image-preview-modal': previewMessage.type === 'image' }">
        <header v-if="previewMessage.type !== 'image'" class="modal-head">
          <strong>{{ previewMessage.fileName || "图片预览" }}</strong>
          <div class="preview-actions">
            <button class="icon-btn" @click="downloadFile(previewMessage)" aria-label="下载"><Download :size="18" /></button>
            <button class="icon-btn" @click="closePreviewMessage" aria-label="关闭预览"><X :size="20" /></button>
          </div>
        </header>
        <button v-if="previewMessage.type === 'image'" class="image-preview-download" @click.stop="downloadFile(previewMessage)" aria-label="下载图片"><Download :size="20" /></button>
        <div
          class="media-preview-body"
          :class="{ 'image-preview-body': previewMessage.type === 'image' }"
          @touchstart="previewMessage.type === 'image' && onImagePreviewTouchStart($event)"
          @touchmove="previewMessage.type === 'image' && onImagePreviewTouchMove($event)"
          @touchend="endImagePreviewTouch"
          @touchcancel="endImagePreviewTouch"
          @pointerdown="previewMessage.type === 'image' && onImagePreviewPointerDown($event)"
          @pointermove="previewMessage.type === 'image' && onImagePreviewPointerMove($event)"
          @wheel="previewMessage.type === 'image' && onImagePreviewWheel($event)"
          @click.self="previewMessage.type === 'image' && closePreviewMessage()"
        >
          <img v-if="previewMessage.type === 'image'" class="media-preview-image" :style="imagePreviewTransform()" :src="fileUrl(previewMessage)" alt="图片预览" draggable="false" />
          <audio v-else-if="isAudioMessage(previewMessage)" class="media-preview-audio" :src="fileUrl(previewMessage)" controls autoplay preload="metadata"></audio>
          <video v-else-if="isVideoMessage(previewMessage)" class="media-preview-video" :src="fileUrl(previewMessage)" controls autoplay playsinline preload="metadata"></video>
          <iframe v-else-if="isPdfMessage(previewMessage)" class="media-preview-frame" :src="fileUrl(previewMessage)" title="文档预览"></iframe>
        </div>
      </div>
    </section>

    <section v-if="pendingCloseChannel" class="modal-shell">
      <div class="small-modal">
        <header class="modal-head">
          <strong>关闭私聊</strong>
          <button class="icon-btn" @click="pendingCloseChannel = null" aria-label="取消关闭私聊"><X :size="20" /></button>
        </header>
        <div class="confirm-body">
          <p>关闭后这个私聊会从你的频道列表里移除，历史消息会保留。之后重新发起私聊可以再次打开。</p>
          <strong>{{ pendingCloseChannel.name }}</strong>
          <div class="confirm-actions">
            <button class="mini-btn secondary" @click="pendingCloseChannel = null">取消</button>
            <button class="primary-btn" @click="closePendingChannel">关闭私聊</button>
          </div>
        </div>
      </div>
    </section>

    <section v-if="showSettings" class="modal-shell">
      <div class="settings-modal">
        <header class="modal-head">
          <strong>设置</strong>
          <button class="icon-btn" @click="showSettings = false" aria-label="关闭设置"><X :size="20" /></button>
        </header>
        <nav class="tabs">
          <button :class="{ active: settingsTab === 'appearance' }" @click="settingsTab = 'appearance'"><Palette :size="16" />外观</button>
          <button :class="{ active: settingsTab === 'devices' }" @click="settingsTab = 'devices'; loadDevices()"><Monitor :size="16" />设备</button>
          <button :class="{ active: settingsTab === 'notifications' }" @click="settingsTab = 'notifications'; loadNotificationSettings()"><Bell :size="16" />通知</button>
          <button :class="{ active: settingsTab === 'release' }" @click="settingsTab = 'release'"><Info :size="16" />版本</button>
        </nav>
        <div class="admin-body">
          <section v-if="settingsTab === 'appearance'" class="form-grid">
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

          <section v-if="settingsTab === 'devices'" class="form-grid">
            <label>已登录设备</label>
            <div class="device-list">
              <div v-for="device in devices" :key="device.id" class="device-row">
                <component :is="deviceIcon(device.deviceKind)" :size="20" />
                <span>
                  <b>{{ device.deviceName }}</b>
                  <small>{{ deviceLabel(device.deviceKind) }} · {{ new Date(device.lastSeenAt).toLocaleString() }}<template v-if="device.current"> · 当前设备</template></small>
                </span>
                <button class="mini-btn secondary" @click="revokeDevice(device)">登出</button>
              </div>
            </div>
          </section>

          <section v-if="settingsTab === 'notifications'" class="form-grid">
            <label>本设备通知</label>
            <div class="notification-card">
              <div>
                <strong>{{ notificationEnabled ? "已开启" : "未开启" }}</strong>
                <small>权限：{{ notificationPermissionLabel }}</small>
              </div>
              <button v-if="notificationEnabled" class="mini-btn secondary" :disabled="notificationBusy" @click="disableNotifications"><BellOff :size="15" />关闭</button>
              <button v-else class="primary-btn" :disabled="notificationBusy || !notificationSupported" @click="enableNotifications"><Bell :size="16" />开启</button>
            </div>
            <label>频道通知</label>
            <div class="notification-channel-list">
              <article v-for="channel in store.channels" :key="channel.id" class="notification-channel-row">
                <span class="channel-icon"><img :src="channelIconUrl(channel)" alt="" /></span>
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

          <section v-if="settingsTab === 'release'" class="release-panel">
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
    </section>

    <section v-if="showAdmin" class="modal-shell">
      <div class="admin-modal">
        <header class="modal-head">
          <strong>管理面板</strong>
          <button class="icon-btn" @click="showAdmin = false" aria-label="关闭管理"><X :size="20" /></button>
        </header>
        <nav class="tabs">
          <button :class="{ active: adminTab === 'pin' }" @click="adminTab = 'pin'"><Pin :size="16" />置顶</button>
          <button :class="{ active: adminTab === 'users' }" @click="adminTab = 'users'"><Users :size="16" />用户</button>
          <button :class="{ active: adminTab === 'channels' }" @click="adminTab = 'channels'"><Menu :size="16" />频道</button>
          <button :class="{ active: adminTab === 'virtuals' }" @click="adminTab = 'virtuals'"><Bot :size="16" />虚拟角色</button>
          <button :class="{ active: adminTab === 'appearance' }" @click="adminTab = 'appearance'"><Palette :size="16" />外观</button>
          <button :class="{ active: adminTab === 'data' }" @click="adminTab = 'data'"><Download :size="16" />数据</button>
          <button :class="{ active: adminTab === 'release' }" @click="adminTab = 'release'"><Info :size="16" />版本</button>
        </nav>

        <div class="admin-body">
          <section v-if="adminTab === 'pin'" class="form-grid">
            <label>当前频道置顶公告</label>
            <textarea v-model="noticeText" rows="4" placeholder="留空并保存可撤下置顶公告"></textarea>
            <button class="primary-btn" @click="saveNotice">保存置顶</button>
          </section>

          <section v-if="adminTab === 'users'" class="form-grid">
            <label>新增用户</label>
            <input v-model="newUser.username" placeholder="username" />
            <input v-model="newUser.displayName" placeholder="显示名" />
            <input v-model="newUser.password" placeholder="初始密码" type="password" />
            <button class="primary-btn" @click="addUser"><FilePlus :size="16" />添加用户</button>
            <div class="user-admin-list">
              <article v-for="account in accounts" :key="account.id" class="user-admin-row">
                <div class="avatar">
                  <img v-if="avatarUrl(account.avatarPath)" :src="avatarUrl(account.avatarPath)" alt="" />
                  <span v-else>{{ avatarText(account.displayName) }}</span>
                </div>
                <div class="user-admin-main">
                  <strong>@{{ account.username }}</strong>
                  <input v-model="accountEdits[account.id].displayName" placeholder="昵称" />
                  <input v-model="accountEdits[account.id].password" placeholder="重置密码，留空不改" type="password" />
                  <label class="check-row"><input v-model="accountEdits[account.id].isAdmin" type="checkbox" /> 管理员</label>
                </div>
                <div class="user-admin-actions">
                  <label class="mini-btn secondary">
                    <Upload :size="15" />头像
                    <input class="hidden" type="file" accept="image/*" @change="uploadAccountAvatar(account, $event)" />
                  </label>
                  <button class="mini-btn" @click="updateAccount(account)">保存</button>
                  <button class="mini-btn secondary" @click="downloadAdminFile(`/api/admin/accounts/${account.id}/attachments/export`, `liao-${account.username}-attachments.zip`)">导出附件</button>
                  <button class="mini-btn danger-action" @click="deleteAccountAttachments(account)">删附件</button>
                </div>
              </article>
            </div>
          </section>

          <section v-if="adminTab === 'channels'" class="form-grid">
            <label>新增频道</label>
            <input v-model="newChannel.name" placeholder="频道名" />
            <input v-model="newChannel.description" placeholder="描述" />
            <label class="check-row"><input v-model="newChannel.isPrivate" type="checkbox" /> 私密频道</label>
            <button class="primary-btn" @click="addChannel">创建频道</button>
            <label>现有频道</label>
            <div class="channel-admin-list">
              <template v-for="channel in store.channels" :key="channel.id">
                <article v-if="channelEdits[channel.id]" class="channel-admin-row">
                  <div class="channel-icon-admin">
                    <img :src="channelIconUrl(channel)" alt="" />
                    <label class="mini-btn secondary">
                      <Upload :size="14" />图标
                      <input class="hidden" type="file" accept="image/*" @change="uploadChannelIcon(channel, $event)" />
                    </label>
                  </div>
                  <div class="channel-admin-main">
                    <input v-model="channelEdits[channel.id].name" placeholder="频道名" />
                    <input v-model="channelEdits[channel.id].description" placeholder="描述" />
                    <small>{{ channel.isPrivate ? "私密频道" : "公开频道" }} · {{ channel.memberCount }} 人</small>
                  </div>
                  <button class="mini-btn" @click="updateChannel(channel)"><Save :size="15" />保存</button>
                  <button v-if="channel.canManage && !channel.isDefault && !channel.directKey" class="mini-btn danger-action" @click="deleteChannel(channel)"><Trash2 :size="15" />删除</button>
                </article>
              </template>
            </div>
          </section>

          <section v-if="adminTab === 'virtuals'" class="form-grid">
            <label>新增虚拟角色</label>
            <input v-model="newVirtual.username" placeholder="唯一标识，例如 ai_luna" />
            <input v-model="newVirtual.displayName" placeholder="显示名" />
            <button class="primary-btn" @click="addVirtual"><Bot :size="16" />创建角色</button>
            <div class="admin-list">
              <button v-for="character in virtuals" :key="character.id" class="virtual-row" @click="toggleVirtual(character)">
                <span>{{ character.actor.displayName }}</span>
                <small>{{ character.enabled ? "已启用" : "已停用" }}</small>
              </button>
            </div>
          </section>

          <section v-if="adminTab === 'appearance'" class="form-grid">
            <label>聊天室标签页</label>
            <div class="login-brand-grid">
              <input v-model="loginAppearanceEdit.appTitle" maxlength="80" placeholder="浏览器标签页标题" aria-label="浏览器标签页标题" />
            </div>
            <div v-if="store.appearance.appIconPath" class="login-icon-preview">
              <img :src="wallpaperUrl(store.appearance.appIconPath)" alt="" />
            </div>
            <div class="action-grid">
              <label class="primary-btn">
                <Upload :size="16" />上传标签页图标
                <input class="hidden" type="file" accept="image/*" @change="uploadAppIcon" />
              </label>
              <button class="mini-btn secondary" @click="clearAppIcon">恢复默认图标</button>
            </div>
            <label>登录页内容</label>
            <div class="login-brand-grid">
              <input v-model="loginAppearanceEdit.loginTitle" maxlength="80" placeholder="登录页标题" aria-label="登录页标题" />
              <input v-model="loginAppearanceEdit.loginSubtitle" maxlength="160" placeholder="登录页副标题" aria-label="登录页副标题" />
            </div>
            <div class="check-grid">
              <label class="check-row"><input v-model="loginAppearanceEdit.loginShowIcon" type="checkbox" /> 显示登录页图标</label>
              <label class="check-row"><input v-model="loginAppearanceEdit.loginShowSubtitle" type="checkbox" /> 显示登录页副标题</label>
            </div>
            <label>登录区域位置</label>
            <div class="segmented-row">
              <button
                v-for="option in loginPositionOptions"
                :key="option.value"
                class="mini-btn"
                :class="{ secondary: loginAppearanceEdit.loginFormPosition !== option.value }"
                @click="loginAppearanceEdit.loginFormPosition = option.value"
              >
                {{ option.label }}
              </button>
            </div>
            <label class="check-row"><input v-model="loginAppearanceEdit.registrationEnabled" type="checkbox" /> 开放注册</label>
            <button class="primary-btn" @click="saveLoginAppearance"><Save :size="15" />保存标题和登录页</button>
            <label>主题颜色</label>
            <div class="theme-editor-head">
              <input v-model="customThemeEdit.name" maxlength="24" placeholder="主题名称" />
              <button class="mini-btn secondary" @click="resetThemeEditor">用当前主题填充</button>
            </div>
            <div class="color-grid">
              <label v-for="field in colorFields" :key="field.key" class="color-row">
                <span>{{ field.label }}</span>
                <input v-model="customThemeEdit.palette[field.key]" type="color" />
                <code>{{ customThemeEdit.palette[field.key] }}</code>
              </label>
            </div>
            <button class="primary-btn" @click="saveCustomTheme"><Save :size="15" />保存为主题</button>
            <div v-if="store.appearance.customThemes.length" class="theme-admin-list">
              <article v-for="theme in store.appearance.customThemes" :key="theme.id" class="theme-admin-row">
                <span class="theme-admin-swatch" :style="themeSwatchStyle(theme)"></span>
                <b>{{ theme.name }}</b>
                <button class="mini-btn secondary" @click="editTheme(theme)">编辑</button>
                <button class="mini-btn danger-action" @click="deleteCustomTheme(theme)"><Trash2 :size="14" />删除</button>
              </article>
            </div>
            <label>闪动特效</label>
            <div class="flash-effect-editor">
              <label class="flash-interval-row">
                <span>闪动间隔（秒）</span>
                <input v-model.number="flashEffectEdit.intervalSeconds" type="number" min="0.01" max="10" step="0.01" />
              </label>
              <label class="flash-interval-row">
                <span>色彩过渡</span>
                <select v-model="flashEffectEdit.transitionMode">
                  <option value="smooth">渐变过渡</option>
                  <option value="step">硬切换</option>
                </select>
              </label>
              <div class="color-grid">
                <label v-for="(color, index) in flashEffectEdit.colors" :key="index" class="color-row flash-color-row">
                  <span>第 {{ index + 1 }} 色</span>
                  <input v-model="flashEffectEdit.colors[index]" type="color" />
                  <button class="mini-btn secondary" :disabled="flashEffectEdit.colors.length <= 1" @click.prevent="removeFlashColor(index)">删除</button>
                </label>
              </div>
              <div class="action-grid">
                <button class="mini-btn secondary" :disabled="flashEffectEdit.colors.length >= 10" @click="addFlashColor">增加颜色</button>
                <button class="primary-btn" @click="saveFlashEffect"><Save :size="15" />保存闪动</button>
              </div>
            </div>
            <label>登录页图标图片</label>
            <div v-if="store.appearance.loginIconPath" class="login-icon-preview">
              <img :src="wallpaperUrl(store.appearance.loginIconPath)" alt="" />
            </div>
            <div class="action-grid">
              <label class="primary-btn">
                <Upload :size="16" />上传图标
                <input class="hidden" type="file" accept="image/*" @change="uploadLoginIcon" />
              </label>
              <button class="mini-btn secondary" @click="clearLoginIcon">移除图标图片</button>
            </div>
            <label>登录页背景</label>
            <div
              v-if="store.appearance.loginBackgroundPath"
              class="wallpaper-preview"
              :style="{
                backgroundImage: `url(${wallpaperUrl(store.appearance.loginBackgroundPath)})`,
                backgroundSize: wallpaperFitStyle(loginAppearanceEdit.loginBackgroundFit).size,
                backgroundRepeat: wallpaperFitStyle(loginAppearanceEdit.loginBackgroundFit).repeat
              }"
            ></div>
            <select v-model="loginAppearanceEdit.loginBackgroundFit" aria-label="登录页背景显示方式">
              <option v-for="option in wallpaperFitOptions" :key="option.value" :value="option.value">登录背景：{{ option.label }}</option>
            </select>
            <div v-if="backgroundAttachmentOptions.length" class="image-reuse-row">
              <select :value="store.appearance.loginBackgroundPath || ''" aria-label="复用已上传登录背景" @change="reuseLoginBackground">
                <option value="">使用已上传图片...</option>
                <option v-for="image in backgroundAttachmentOptions" :key="`login-bg-${image.id}`" :value="image.fileName">
                  {{ backgroundAttachmentLabel(image) }}
                </option>
              </select>
            </div>
            <div class="action-grid">
              <label class="primary-btn">
                <Upload :size="16" />上传登录背景
                <input class="hidden" type="file" accept="image/*" @change="uploadLoginBackground" />
              </label>
              <button class="mini-btn secondary" @click="clearLoginBackground">移除登录背景</button>
            </div>
            <label>聊天室壁纸</label>
            <div
              v-if="store.appearance.wallpaperPath"
              class="wallpaper-preview"
              :style="{
                backgroundImage: `url(${wallpaperUrl(store.appearance.wallpaperPath)})`,
                backgroundSize: wallpaperFitStyle(loginAppearanceEdit.wallpaperFit).size,
                backgroundRepeat: wallpaperFitStyle(loginAppearanceEdit.wallpaperFit).repeat
              }"
            ></div>
            <select v-model="loginAppearanceEdit.wallpaperFit" aria-label="聊天室壁纸显示方式">
              <option v-for="option in wallpaperFitOptions" :key="option.value" :value="option.value">聊天室壁纸：{{ option.label }}</option>
            </select>
            <div v-if="backgroundAttachmentOptions.length" class="image-reuse-row">
              <select :value="store.appearance.wallpaperPath || ''" aria-label="复用已上传聊天室壁纸" @change="reuseWallpaper">
                <option value="">使用已上传图片...</option>
                <option v-for="image in backgroundAttachmentOptions" :key="`wallpaper-${image.id}`" :value="image.fileName">
                  {{ backgroundAttachmentLabel(image) }}
                </option>
              </select>
            </div>
            <div class="action-grid">
              <label class="primary-btn">
                <Upload :size="16" />上传壁纸
                <input class="hidden" type="file" accept="image/*" @change="uploadWallpaper" />
              </label>
              <button class="mini-btn secondary" @click="clearWallpaper">移除壁纸</button>
            </div>
          </section>

          <section v-if="adminTab === 'data'" class="form-grid">
            <label>聊天数据</label>
            <div class="action-grid">
              <button class="primary-btn" @click="downloadAdminFile('/api/admin/export/chat', 'team-chat-data.json')"><Download :size="16" />导出聊天</button>
              <label class="mini-btn secondary">
                <Upload :size="16" />导入聊天
                <input class="hidden" type="file" accept="application/json,.json" @change="importAdminFile('/api/admin/import/chat', $event)" />
              </label>
            </div>
            <label>用户数据</label>
            <div class="action-grid">
              <button class="primary-btn" @click="downloadAdminFile('/api/admin/export/users', 'liao-users.json')"><Download :size="16" />导出用户</button>
              <label class="mini-btn secondary">
                <Upload :size="16" />导入用户
                <input class="hidden" type="file" accept="application/json,.json" @change="importAdminFile('/api/admin/import/users', $event)" />
              </label>
            </div>
            <label>聊天记录删除</label>
            <div class="admin-inline-card">
              <div>
                <strong>在主聊天界面多选删除</strong>
                <small>回到当前频道后，可以按真实上下文选择多条消息并一次删除。</small>
              </div>
              <button class="primary-btn" @click="startMessageSelectionMode"><CheckCircle2 :size="16" />进入多选</button>
            </div>
            <div class="data-toolbar data-toolbar-compact">
              <select v-model.number="dataChannelFilter" aria-label="筛选频道">
                <option :value="0">全部频道</option>
                <option v-for="channel in store.channels" :key="channel.id" :value="channel.id">{{ channel.name }}</option>
              </select>
              <button class="mini-btn danger-action" :disabled="!dataChannelFilter" @click="clearAdminMessages(dataChannelFilter)"><Trash2 :size="15" />清空当前频道</button>
              <button class="mini-btn danger-action" @click="clearAdminMessages(0)"><Trash2 :size="15" />清空全部记录</button>
            </div>
            <label>附件管理</label>
            <div class="data-toolbar">
              <button class="mini-btn secondary" @click="toggleAllAttachments">{{ allAttachmentsSelected ? "取消全选" : "全选" }}</button>
              <button class="mini-btn secondary" @click="loadAdminAttachments"><RotateCcw :size="15" />刷新</button>
              <button class="mini-btn danger-action" :disabled="!selectedAttachmentCount" @click="deleteAdminAttachments(selectedAttachmentIds)"><Trash2 :size="15" />删除选中 {{ selectedAttachmentCount }}</button>
              <button class="mini-btn danger-action" :disabled="!adminAttachments.length" @click="deleteAllAdminAttachments"><Trash2 :size="15" />删除全部附件</button>
            </div>
            <div class="admin-data-list">
              <article v-for="attachment in adminAttachments" :key="attachment.id" class="admin-data-row attachment-row">
                <label class="check-cell">
                  <input v-model="selectedAttachmentIds" type="checkbox" :value="attachment.id" />
                </label>
                <div class="admin-data-main">
                  <strong>{{ attachmentKindLabel(attachment.kind) }} · {{ attachment.label }}</strong>
                  <span>{{ attachmentUsage(attachment) }}</span>
                  <small>{{ compactBytes(attachment.size) }} · {{ adminDate(attachment.createdAt) }} · {{ attachment.fileName }}</small>
                </div>
                <button class="mini-btn danger-action" @click="deleteAdminAttachments([attachment.id])"><Trash2 :size="15" />删除</button>
              </article>
              <p v-if="!adminAttachments.length" class="empty-note">没有可管理的附件</p>
            </div>
          </section>

          <section v-if="adminTab === 'release'" class="release-panel">
            <div class="release-head">
              <span>当前版本</span>
              <strong>v{{ APP_VERSION }}</strong>
              <small>{{ RELEASE_DATE }} · 开发者：{{ releaseDeveloper }}</small>
            </div>
            <div class="release-update-card">
              <div>
                <b>GitHub 更新</b>
                <small>
                  当前 v{{ updateCheck?.current || APP_VERSION }}
                  <template v-if="updateCheck"> · GitHub v{{ updateCheck.latest }}</template>
                </small>
              </div>
              <div class="release-update-actions">
                <button class="mini-btn secondary" :disabled="updateBusy" @click="checkForUpdates"><RotateCcw :size="15" />检查</button>
                <button class="mini-btn" :disabled="updateBusy || !updateCheck?.updateAvailable" @click="startServerUpdate">更新</button>
              </div>
              <div class="update-progress">
                <span :style="{ width: `${updateProgress}%` }"></span>
              </div>
              <small>{{ updateStateText }} · {{ updateStatus?.detail || "等待检查" }}</small>
              <ol v-if="updateStatus?.log.length" class="update-log">
                <li v-for="line in updateStatus.log.slice(-8)" :key="line">{{ line }}</li>
              </ol>
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
        <footer v-if="adminMsg" class="admin-msg">{{ adminMsg }}</footer>
      </div>
    </section>
  </main>
</template>
