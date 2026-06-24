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
  AdminLoginLogDTO,
  AdminLoginLogKind,
  AppearanceDTO,
  AiRoleDTO,
  AiSettingsDTO,
  BibleLookupDTO,
  BiblePreferencesDTO,
  BibleOutputFormat,
  BibleReferenceLabelMode,
  BibleCombinedPassageMode,
  BibleQuotationStyle,
  ChainPayload,
  ChannelDTO,
  DeviceSessionDTO,
  FlashEffectSettingsDTO,
  LinkPreviewDTO,
  MessageDTO,
  MessageEffect,
  MessageEffectPayload,
  PinnedBodyDTO,
  PinnedContentBlockDTO,
  PrayerPayload,
  PrayerStatus,
  UpdateCheckDTO,
  UpdateStatusDTO,
  VersionDTO,
  ThemeDTO,
  ThemePaletteDTO,
  WhyAssistantRunDTO,
  WhyTopicCardPayload,
  WhyTopicDTO,
  WhyTopicMemberDTO
} from "@shared/types";
import { api, authHeaders, getToken, login, register } from "./api";
import { extractBibleReferenceMatches, extractBibleReferencesFromText } from "./bibleReferences";
import { compactBytes, formatSeparator, shouldShowSeparator } from "./time";
import { useChatStore } from "./store";
import { APP_VERSION, RELEASE_DATE, RELEASE_DEVELOPER, RELEASE_HISTORY, RELEASE_NOTES } from "@shared/release";

const store = useChatStore();
type UploadStatus = "uploading" | "processing" | "failed";
type PendingUpload = {
  file: File;
  options: { voice?: boolean; durationMs?: number; waveform?: number[]; originalImage?: boolean };
  progress: number;
  status: UploadStatus;
  message?: string;
};
type SavedReadPosition = {
  messageId: number;
  offset: number;
  atBottom: boolean;
  scrollTop: number;
  savedAt: number;
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
const minMessageFontSize = 14;
const maxMessageFontSize = 40;
const defaultMessageFontSize = 15;
const legacyMessageFontSizes: Record<string, number> = {
  small: 14,
  standard: 15,
  large: 17,
  extra: 19
};
const messageFontSize = ref(defaultMessageFontSize);
const showMessageFontMenu = ref(false);
const showAdmin = ref(false);
const showSettings = ref(false);
const isAiSettingsRoute = ref(window.location.pathname === "/ai-settings");
const isLogRoute = ref(window.location.pathname === "/log");
const fileInput = ref<HTMLInputElement | null>(null);
const photoInput = ref<HTMLInputElement | null>(null);
const keepOriginalImages = ref(false);
const composerInput = ref<HTMLTextAreaElement | null>(null);
const scroller = ref<HTMLElement | null>(null);
const pendingReadPositionRestore = ref(false);
let readPositionRestoreToken = 0;
const rainCanvas = ref<HTMLCanvasElement | null>(null);
const dripLayer = ref<HTMLElement | null>(null);
const adminTab = ref<"users" | "channels" | "virtuals" | "pin" | "appearance" | "data" | "release">("pin");
const settingsTab = ref<"appearance" | "bible" | "devices" | "notifications" | "release">("appearance");
const adminMsg = ref("");
const newUser = ref({ username: "", displayName: "", password: "" });
const newChannel = ref({ name: "", description: "", isPrivate: false });
const newVirtual = ref({ username: "", displayName: "" });
const virtuals = ref<any[]>([]);
const accounts = ref<any[]>([]);
const accountEdits = ref<Record<number, { displayName: string; isAdmin: boolean; canPinMessages: boolean; password: string }>>({});
const channelEdits = ref<Record<number, { name: string; description: string }>>({});
type WallpaperFit = AppearanceDTO["wallpaperFit"];
type LoginFormPosition = AppearanceDTO["loginFormPosition"];
type AppearanceSection = "brand" | "login" | "chat" | "themes" | "flash";
type AppearanceImageField = "appIconPath" | "loginIconPath" | "loginBackgroundPath" | "wallpaperPath";
type AppearanceFitField = "loginBackgroundFit" | "wallpaperFit";
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
const appearanceSections: Array<{ id: AppearanceSection; label: string; description: string }> = [
  { id: "brand", label: "品牌与标签页", description: "浏览器标题和站点图标" },
  { id: "login", label: "登录页", description: "登录内容、背景和入口" },
  { id: "chat", label: "聊天室", description: "聊天壁纸和显示方式" },
  { id: "themes", label: "主题颜色", description: "成员可选的自定义主题" },
  { id: "flash", label: "闪动特效", description: "/闪动 消息的颜色节奏" }
];
const appearanceSection = ref<AppearanceSection>("brand");
const appearancePreviewOpen = ref(false);
const appearanceThemeAdvancedOpen = ref(false);
const appearanceImagePicker = ref<{ field: AppearanceImageField; title: string; fitField?: AppearanceFitField; hint: string } | null>(null);
const loginAppearanceEdit = ref({
  appTitle: "Team Chat",
  appIconPath: null as string | null,
  loginTitle: "Team Chat",
  loginSubtitle: "轻快、稳定的团队聊天。",
  loginIconPath: null as string | null,
  loginShowIcon: true,
  loginShowSubtitle: true,
  loginBackgroundPath: null as string | null,
  loginFormPosition: "middle" as LoginFormPosition,
  loginBackgroundFit: "cover" as WallpaperFit,
  wallpaperPath: null as string | null,
  wallpaperFit: "cover" as WallpaperFit,
  registrationEnabled: false
});
const flashEffectEdit = ref<FlashEffectSettingsDTO>({
  colors: ["#fff176", "#ef4444", "#60a5fa", "#6d28d9", "#34d399", "#111827"],
  intervalSeconds: 0.4,
  transitionMode: "smooth"
});
const customThemesDraft = ref<ThemeDTO[]>([]);
const flashEffectStep = ref(0);
let flashEffectTimer = 0;
const adminAttachments = ref<AdminAttachmentDTO[]>([]);
const adminLoginLogs = ref<AdminLoginLogDTO[]>([]);
const adminLoginLogsBusy = ref(false);
const adminLoginLogsMsg = ref("");
const selectedAttachmentIds = ref<string[]>([]);
const dataChannelFilter = ref(0);
const devices = ref<DeviceSessionDTO[]>([]);
const notificationMsg = ref("");
const notificationPublicKey = ref("");
const notificationPermission = ref(typeof Notification === "undefined" ? "default" : Notification.permission);
const notificationEnabled = ref(false);
const notificationBusy = ref(false);
const notificationPromptOpen = ref(false);
const notificationPermissionAttempts = ref(0);
const mutedChannelIds = ref<Set<number>>(new Set());
const aiSettings = ref<AiSettingsDTO | null>(null);
const aiSettingsEdit = ref({
  enabled: true,
  apiKey: "",
  clearApiKey: false,
  promptCommand: "",
  aiRoles: [] as AiRoleDTO[],
  cardCooldownSeconds: 30,
  userLimitPerMinute: 3,
  maxSuccessPerMessage: 7
});
const aiSettingsBusy = ref(false);
const aiSettingsMsg = ref("");
const aiSettingsShowAdvanced = ref(false);
const noticeText = ref("");
const pinnedExpanded = ref(false);
const showPinnedEditor = ref(false);
const pinnedEditTitle = ref("");
const pinnedEditBlocks = ref<PinnedContentBlockDTO[]>([]);
const pinnedEditMsg = ref("");
const showChainModal = ref(false);
const chainTopic = ref("");
const pendingChain = ref<MessageDTO | null>(null);
const pendingDownload = ref<MessageDTO | null>(null);
const pendingRecall = ref<MessageDTO | null>(null);
const pendingPrayer = ref<MessageDTO | null>(null);
const pendingPrayerUpdate = ref<MessageDTO | null>(null);
const prayerUpdateTextarea = ref<HTMLTextAreaElement | null>(null);
const prayerUpdateContent = ref("");
const prayerUpdateBusy = ref(false);
const prayerUpdateError = ref("");
const expandedAiSuggestionMessageIds = ref<Set<number>>(new Set());
const aiSuggestionBusyIds = ref<Set<number>>(new Set());
const aiSuggestionErrors = ref<Record<number, string>>({});
const expandedBibleReferenceKeys = ref<Set<string>>(new Set());
const bibleLookupCache = ref<Record<string, BibleLookupDTO | null>>({});
const bibleLookupBusyKeys = ref<Set<string>>(new Set());
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
const previewMessage = ref<MessageDTO | null>(null);
const previewPinnedImage = ref<{ url: string; fileName: string } | null>(null);
const imagePreviewScale = ref(1);
const imagePreviewOffset = ref({ x: 0, y: 0 });
const chainPromptPosition = ref({ x: 0, y: 0 });
const downloadPromptPosition = ref({ x: 0, y: 0 });
const recallPromptPosition = ref({ x: 0, y: 0 });
const messageActionPromptPosition = ref({ x: 0, y: 0 });
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
const pendingMessageActions = ref<MessageDTO | null>(null);
const textSelectableMessageId = ref<number | null>(null);
const pendingCloseChannel = ref<ChannelDTO | null>(null);
const composerPanel = ref<"voice" | "more" | null>(null);
const workspace = ref<"chat" | "why">("chat");
const whyTopics = ref<WhyTopicDTO[]>([]);
const whyCurrentTopic = ref<WhyTopicDTO | null>(null);
const whyMessages = ref<MessageDTO[]>([]);
const whyMembers = ref<WhyTopicMemberDTO[]>([]);
const whyRuns = ref<WhyAssistantRunDTO[]>([]);
const whyHomeQuestion = ref("");
const whyTopicInput = ref("");
const whyLoading = ref(false);
const whyBusy = ref(false);
const whyError = ref("");
const whySummary = ref({ unreadCount: 0, pendingRequestCount: 0 });
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
type LinkPreviewState = { status: "loading" | "ready" | "error"; preview?: LinkPreviewDTO; error?: string };
const linkPreviewCache = ref<Record<string, LinkPreviewState>>({});
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
const primaryColorFieldKeys = new Set<keyof ThemePaletteDTO>(["accent", "bubbleMine", "bubbleOther", "chatBg", "text"]);
const primaryColorFields = colorFields.filter((field) => primaryColorFieldKeys.has(field.key));
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
const whyCommand = { command: "/为什么", label: "为什么", hint: "把问题放进我的为什么研究", icon: BookOpen };
const whyShortcutCommand = { command: "/?", label: "为什么", hint: "打开我的为什么", icon: BookOpen };
type SlashCommandSuggestion =
  | { kind: "prayer"; command: string; label: string; hint: string; icon: IconComponent }
  | { kind: "why"; command: string; label: string; hint: string; icon: IconComponent }
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
  window.addEventListener("why:updated", handleWhyUpdated as EventListener);
  window.addEventListener("why:messages-refresh", handleWhyMessagesRefresh as EventListener);
  await store.bootstrap();
  if (isAiSettingsRoute.value && store.account?.isAdmin) await loadAiSettings();
  if (isLogRoute.value && store.account?.isAdmin) await loadAdminLoginLogs();
  await loadWhySummary();
  await checkServerVersion();
  versionCheckTimer = window.setInterval(() => void checkServerVersion(), 60_000);
  await switchToLinkedChannel();
  pendingReadPositionRestore.value = true;
  await restoreSavedReadPosition();
});

watch(
  () => [store.currentChannelId, store.prayerOnly] as const,
  async () => {
    stopAllVoicePlayback();
    selectedMember.value = null;
    pendingCloseChannel.value = null;
    pendingChain.value = null;
    pendingDownload.value = null;
    pendingRecall.value = null;
    pendingPrayer.value = null;
    pendingPrayerUpdate.value = null;
    pendingMessageActions.value = null;
    textSelectableMessageId.value = null;
    selectedMessageIds.value = new Set();
    messageSelectionMode.value = false;
    composerPanel.value = null;
    hasUnreadMessages.value = false;
    pendingReadPositionRestore.value = true;
    await nextTick();
    void restoreSavedReadPosition();
  }
);

watch(
  () => [store.currentChannelId, store.prayerOnly, store.loadingInitialMessages, store.messages.map((message) => message.id).join(",")] as const,
  () => {
    if (!pendingReadPositionRestore.value || store.loadingInitialMessages) return;
    void restoreSavedReadPosition();
  }
);

watch(
  () => {
    const pinned = !store.prayerOnly && store.pinned ? store.pinned : null;
    return `${pinned?.id || 0}:${pinned?.version || 0}:${pinned?.dismissed ? "dismissed" : "open"}:${store.prayerOnly ? "prayers" : "chat"}`;
  },
  () => {
    const pinned = !store.prayerOnly && store.pinned ? store.pinned : null;
    pinnedExpanded.value = !!pinned && !pinned.dismissed;
  },
  { immediate: true }
);

watch(
  () => store.messages.length,
  (length, previousLength) => {
    if (pendingReadPositionRestore.value) return;
    const latest = store.messages[store.messages.length - 1];
    const shouldFollow = !store.loadingOlderMessages && (!previousLength || length < previousLength || isNearMessageBottom(220) || (latest ? isMine(latest) : false));
    nextTick(() => {
      if (shouldFollow) scrollBottom(false);
    });
  }
);

watch(
  () => store.messages.map((message) => `${message.id}:${message.type}:${message.content}`).join("|"),
  () => {
    void ensureVisibleLinkPreviews();
  },
  { immediate: true }
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
  () => mentionToasts.value.length + Object.keys(store.typing).length,
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
  (accountId) => {
    mentionToasts.value = [];
    acknowledgedMentionIds.value = loadAcknowledgedMentionIds();
    topNoticeIndex.value = 0;
    messageFontSize.value = loadMessageFontSizePreference(accountId);
    notificationPermissionAttempts.value = loadNotificationPermissionAttempts(accountId);
    if (accountId) void loadNotificationSettings();
  },
  { immediate: true }
);

watch(messageFontSize, (value) => {
  const clamped = clampMessageFontSize(value);
  if (value !== clamped) {
    messageFontSize.value = clamped;
    return;
  }
  const accountId = store.account?.id;
  if (!accountId) return;
  localStorage.setItem(messageFontSizeStorageKey(accountId), String(clamped));
});

watch(
  () => store.account?.isAdmin,
  (isAdminAccount) => {
    if (isAiSettingsRoute.value && isAdminAccount) void loadAiSettings();
    if (isLogRoute.value && isAdminAccount) void loadAdminLoginLogs();
  }
);

watch(
  () => store.channels.map((channel) => `${channel.id}:${channel.name}:${channel.description}:${channel.icon}`).join("|"),
  () => syncChannelEdits()
);

watch(adminTab, (tab) => {
  if (tab === "appearance" && showAdmin.value) void loadAdminAttachments();
  if (tab === "data" && showAdmin.value) loadAdminData();
  if (tab === "release" && showAdmin.value) void checkForUpdates();
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", closeTapPromptsFromOutside);
  window.removeEventListener("deviceorientation", handleDeviceOrientation);
  window.removeEventListener("why:updated", handleWhyUpdated as EventListener);
  window.removeEventListener("why:messages-refresh", handleWhyMessagesRefresh as EventListener);
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
const canPinCurrentChannel = computed(() => !store.prayerOnly && !!currentChannel.value?.canPin);
const visiblePinned = computed(() => (!store.prayerOnly && store.pinned ? store.pinned : null));
const themeOptions = computed<ThemeDTO[]>(() => [...builtInThemes, ...(store.appearance.customThemes || [])]);
const appearanceThemeOptions = computed<ThemeDTO[]>(() => [...builtInThemes, ...customThemesDraft.value]);
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
  "--message-content-font-size": `${messageFontSize.value}px`,
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
  () => store.appearance,
  () => {
    syncLoginAppearanceEdit();
    applyAppChrome();
  },
  { deep: true, immediate: true }
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
const pinnedBlocks = computed(() => visiblePinned.value?.body?.blocks || (visiblePinned.value?.content ? [{ id: "legacy", type: "text" as const, text: visiblePinned.value.content }] : []));
const pinnedText = computed(() => {
  const pinned = visiblePinned.value;
  if (!pinned) return "";
  return pinned.title || pinnedBlocks.value.find((block) => block.type === "text")?.text || "置顶消息";
});
const pinnedSummary = computed(() => {
  const blocks = pinnedBlocks.value;
  const media = blocks.filter((block) => block.type === "image" || block.type === "file");
  const labels = [];
  const imageCount = media.filter((block) => block.type === "image").length;
  const fileCount = media.filter((block) => block.type === "file").length;
  if (imageCount) labels.push(`${imageCount} 张图片`);
  if (fileCount) labels.push(`${fileCount} 个文件`);
  const text = blocks.filter((block) => block.type === "text").map((block) => block.text).join(" ").replace(/\s+/g, " ").trim();
  return labels.length ? labels.join(" · ") : text.slice(0, 42) || "点击查看";
});
const releaseHistory = computed(() => RELEASE_HISTORY.filter((release) => release.version !== APP_VERSION));
const releaseDeveloper = computed(() => serverVersion.value?.developer || RELEASE_DEVELOPER);
const selectedAttachmentCount = computed(() => selectedAttachmentIds.value.length);
const allAttachmentsSelected = computed(() => adminAttachments.value.length > 0 && selectedAttachmentIds.value.length === adminAttachments.value.length);
const backgroundAttachmentOptions = computed(() => adminAttachments.value.filter((item) => item.kind === "background" && item.url));
const selectedCompressibleAttachmentIds = computed(() => selectedAttachmentIds.value.filter((id) => isImageAttachmentId(id)));
const selectedCompressibleAttachmentCount = computed(() => selectedCompressibleAttachmentIds.value.length);
const activeAppearanceSection = computed(() => appearanceSections.find((section) => section.id === appearanceSection.value) || appearanceSections[0]);
const appearanceDraftIcon = computed(() => loginAppearanceEdit.value.appIconPath ? wallpaperUrl(loginAppearanceEdit.value.appIconPath) : "/images/icon-192.svg");
const appearanceDraftLoginIcon = computed(() => loginAppearanceEdit.value.loginIconPath ? wallpaperUrl(loginAppearanceEdit.value.loginIconPath) : "/images/icon-192.svg");
const appearanceDraftLoginBackground = computed(() => loginAppearanceEdit.value.loginBackgroundPath);
const appearanceDraftWallpaper = computed(() => loginAppearanceEdit.value.wallpaperPath);
const appearanceImagePickerSelection = computed(() => {
  const picker = appearanceImagePicker.value;
  return picker ? loginAppearanceEdit.value[picker.field] : null;
});
const appearanceImagePickerFit = computed(() => {
  const picker = appearanceImagePicker.value;
  return picker?.fitField ? loginAppearanceEdit.value[picker.fitField] : null;
});
const appearancePreviewLoginStyle = computed(() => {
  const fit = wallpaperFitStyle(loginAppearanceEdit.value.loginBackgroundFit);
  return {
    backgroundImage: appearanceDraftLoginBackground.value ? `url(${wallpaperUrl(appearanceDraftLoginBackground.value)})` : "none",
    backgroundSize: fit.size,
    backgroundRepeat: fit.repeat
  };
});
const appearancePreviewChatStyle = computed(() => {
  const fit = wallpaperFitStyle(loginAppearanceEdit.value.wallpaperFit);
  return {
    backgroundImage: appearanceDraftWallpaper.value ? `url(${wallpaperUrl(appearanceDraftWallpaper.value)})` : "none",
    backgroundSize: fit.size,
    backgroundRepeat: fit.repeat
  };
});
const appearancePreviewFlash = computed(() => cleanFlashEffectSettings(flashEffectEdit.value));
const appearancePreviewFlashColor = computed(() => {
  const colors = appearancePreviewFlash.value.colors;
  return colors[flashEffectStep.value % colors.length] || colors[0] || "#fff176";
});
const appearancePreviewFlashStyle = computed(() => {
  const interval = `${appearancePreviewFlash.value.intervalSeconds}s`;
  return {
    background: appearancePreviewFlashColor.value,
    color: readableTextColor(appearancePreviewFlashColor.value),
    transition: appearancePreviewFlash.value.transitionMode === "smooth" ? `background ${interval} linear, color ${interval} linear` : "none"
  };
});
const appearanceThemePreviewStyle = computed(() => paletteStyle(customThemeEdit.value.palette));
const customThemeDraftIds = computed(() => new Set(customThemesDraft.value.map((theme) => theme.id)));
const appearanceAdvancedColorFields = computed(() => colorFields.filter((field) => !primaryColorFieldKeys.has(field.key)));
const appearanceSavePayload = computed(() => ({
  appTitle: loginAppearanceEdit.value.appTitle,
  appIconPath: loginAppearanceEdit.value.appIconPath,
  loginTitle: loginAppearanceEdit.value.loginTitle,
  loginSubtitle: loginAppearanceEdit.value.loginSubtitle,
  loginIconPath: loginAppearanceEdit.value.loginIconPath,
  loginShowIcon: loginAppearanceEdit.value.loginShowIcon,
  loginShowSubtitle: loginAppearanceEdit.value.loginShowSubtitle,
  loginBackgroundPath: loginAppearanceEdit.value.loginBackgroundPath,
  loginFormPosition: loginAppearanceEdit.value.loginFormPosition,
  loginBackgroundFit: loginAppearanceEdit.value.loginBackgroundFit,
  wallpaperPath: loginAppearanceEdit.value.wallpaperPath,
  wallpaperFit: loginAppearanceEdit.value.wallpaperFit,
  registrationEnabled: loginAppearanceEdit.value.registrationEnabled,
  flashEffect: cleanFlashEffectSettings(flashEffectEdit.value),
  customThemes: customThemesDraft.value.map((theme) => ({ ...theme, palette: { ...theme.palette } }))
}));
const currentAppearancePayload = computed(() => ({
  appTitle: store.appearance.appTitle || "Team Chat",
  appIconPath: store.appearance.appIconPath || null,
  loginTitle: store.appearance.loginTitle || "Team Chat",
  loginSubtitle: store.appearance.loginSubtitle || "",
  loginIconPath: store.appearance.loginIconPath || null,
  loginShowIcon: store.appearance.loginShowIcon !== false,
  loginShowSubtitle: store.appearance.loginShowSubtitle !== false,
  loginBackgroundPath: store.appearance.loginBackgroundPath || null,
  loginFormPosition: store.appearance.loginFormPosition || "middle",
  loginBackgroundFit: store.appearance.loginBackgroundFit || "cover",
  wallpaperPath: store.appearance.wallpaperPath || null,
  wallpaperFit: store.appearance.wallpaperFit || "cover",
  registrationEnabled: !!store.appearance.registrationEnabled,
  flashEffect: cleanFlashEffectSettings(store.appearance.flashEffect),
  customThemes: (store.appearance.customThemes || []).map((theme) => ({ ...theme, palette: { ...theme.palette } }))
}));
const appearanceHasDraftChanges = computed(() => JSON.stringify(appearanceSavePayload.value) !== JSON.stringify(currentAppearancePayload.value));
watch(
  () => `${appearancePreviewFlash.value.colors.join(",")}:${appearancePreviewFlash.value.intervalSeconds}:${appearancePreviewFlash.value.transitionMode}`,
  () => restartFlashEffectTimer(),
  { immediate: true }
);
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
const notificationAttentionVisible = computed(() => {
  if (!store.account) return false;
  if (!("Notification" in window || "serviceWorker" in navigator)) return false;
  return !notificationEnabled.value;
});
const notificationNudgeLevel = computed<"bell" | "muted" | "sleep">(() => {
  if (notificationPermissionAttempts.value >= 2) return "sleep";
  if (notificationPermission.value === "denied" || notificationPermissionAttempts.value === 1) return "muted";
  return "bell";
});
const notificationNudgeIcon = computed(() => {
  if (notificationNudgeLevel.value === "sleep") return "😴";
  if (notificationNudgeLevel.value === "muted") return "🔕";
  return "🔔";
});
const notificationPromptHint = computed(() => {
  if (!notificationSupported.value) return "当前浏览器不支持网页推送；iPhone/iPad 通常需要先把聊天室添加到主屏幕。";
  if (notificationPermission.value === "denied") return "你之前拒绝了通知，需要在浏览器或系统设置里把本网站通知改为允许。";
  if (notificationEnabled.value) return "本设备已经准备好接收 @ 和重要公告。";
  if (notificationPermissionAttempts.value >= 2) return "它已经困了，但你还是可以点“开启通知”把它叫醒。";
  if (notificationPermissionAttempts.value > 0) return "它先变成静音铃铛，但还在等你点“开启通知”。";
  return "开启后，即使没有停留在聊天室页面，也能收到 @ 和重要公告提醒。";
});
const slashCommandToken = computed(() => slashCommandTokenAtCursor(input.value, composerCaret.value));
const matchingSlashCommands = computed<SlashCommandSuggestion[]>(() => {
  const token = slashCommandToken.value;
  if (!token) return [];
  if (token.kind === "prayer-effect") {
    return effectCommands.filter((item) => item.command.startsWith(token.query)).map((item) => ({ ...item, kind: "effect" as const }));
  }
  return [
    { ...whyCommand, kind: "why" as const },
    { ...whyShortcutCommand, kind: "why" as const },
    { ...prayerCommand, kind: "prayer" as const },
    ...effectCommands.map((item) => ({ ...item, kind: "effect" as const }))
  ].filter((item) => item.command.startsWith(token.query));
});
const mentionToken = computed(() => mentionTokenAtCursor(input.value, composerCaret.value));
const matchingMentionMembers = computed(() => {
  const token = mentionToken.value;
  if (!token) return [];
  const query = token.query.trim().toLowerCase();
  return store.members.filter((member) => {
    if (!member.displayName.trim()) return false;
    if (!query) return true;
    return member.displayName.toLowerCase().includes(query) || (member.username || "").toLowerCase().includes(query);
  });
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
const canSendText = computed(() => {
  const whyTrigger = parseWhyComposerTrigger(input.value);
  if (whyTrigger.kind === "shortcut") return true;
  if (whyTrigger.kind === "create") return !!whyTrigger.question;
  return !!parseComposerText(input.value).content;
});
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
const messageActionPromptStyle = computed(() => ({
  left: `${messageActionPromptPosition.value.x}px`,
  top: `${messageActionPromptPosition.value.y}px`
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
const updateRestartModeLabel = computed(() => {
  const mode = updateCheck.value?.restartMode || serverVersion.value?.update?.restartMode || "";
  if (mode === "pm2") return "PM2 自动重启";
  if (mode === "command") return "自定义命令重启";
  if (mode === "none") return "更新后需手动重启";
  return mode ? `重启方式：${mode}` : "自动重启";
});
const updateStartDisabled = computed(() => updateBusy.value || updateStatus.value?.state === "running" || !updateCheck.value?.updateAvailable);
let nextPendingMessageId = -1;

function pendingUploadFor(message: MessageDTO) {
  return pendingUploads.value[message.id];
}

function pendingUploadLabel(upload: PendingUpload) {
  if (upload.status === "failed") return upload.message || "发送失败";
  if (upload.status === "processing") return upload.message || "正在发布";
  return `上传中 ${upload.progress}%`;
}

function pendingUploadKindLabel(file: File) {
  if (isImageFile(file)) return "图片";
  if (file.type.startsWith("audio/")) return "音频";
  if (file.type.startsWith("video/")) return "视频";
  return "文件";
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

function pushPendingFileMessage(file: File, options: { originalImage?: boolean } = {}) {
  if (!store.currentChannelId || !store.account) return 0;
  const id = nextPendingMessageId;
  nextPendingMessageId -= 1;
  const type = isImageFile(file) ? "image" : "file";
  pendingUploads.value = {
    ...pendingUploads.value,
    [id]: {
      file,
      options,
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
    type,
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

function prayerUpdateMarkdownFromHtml(value: string) {
  const root = document.createElement("div");
  root.innerHTML = value || "";
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const element = node as HTMLElement;
    if (element.tagName === "BR") return "\n";
    const body = Array.from(element.childNodes).map(walk).join("");
    if (element.tagName === "S" || element.tagName === "DEL") return body ? `~~${body}~~` : "";
    return body;
  };
  return Array.from(root.childNodes).map(walk).join("").replace(/\n{3,}/g, "\n\n").trim();
}

function trimUrlPunctuation(value: string) {
  let url = value;
  let suffix = "";
  while (/[，。！？、,.!?:;；：）)\]}》】”’"'`]+$/.test(url)) {
    suffix = `${url.slice(-1)}${suffix}`;
    url = url.slice(0, -1);
  }
  return { url, suffix };
}

function normalizeMessageUrl(value: string) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function extractMessageUrls(html: string) {
  const root = document.createElement("div");
  root.innerHTML = html || "";
  const urls: string[] = [];
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const url = normalizeMessageUrl(anchor.href);
    if (url) urls.push(url);
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const text = walker.currentNode.textContent || "";
    for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
      const { url } = trimUrlPunctuation(match[0]);
      const normalized = normalizeMessageUrl(url);
      if (normalized) urls.push(normalized);
    }
  }
  return [...new Set(urls)];
}

function linkifyMessageHtml(html: string) {
  const root = document.createElement("div");
  root.innerHTML = html || "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.parentElement?.closest("a") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    }
  });
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
  for (const node of textNodes) {
    const text = node.textContent || "";
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
      const raw = match[0];
      const start = match.index ?? 0;
      const { url, suffix } = trimUrlPunctuation(raw);
      const normalized = normalizeMessageUrl(url);
      if (!normalized) continue;
      if (start > cursor) fragment.append(document.createTextNode(text.slice(cursor, start)));
      const anchor = document.createElement("a");
      anchor.href = normalized;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.textContent = url;
      fragment.append(anchor);
      if (suffix) fragment.append(document.createTextNode(suffix));
      cursor = start + raw.length;
    }
    if (!fragment.childNodes.length) continue;
    if (cursor < text.length) fragment.append(document.createTextNode(text.slice(cursor)));
    node.replaceWith(fragment);
  }
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
  }
  return root.innerHTML;
}

function messageContentHtml(message: MessageDTO) {
  return linkifyMessageHtml(message.content);
}

type BibleRichTextSegment =
  | { kind: "html"; key: string; html: string }
  | { kind: "reference"; key: string; reference: string; className?: string };

function textContentHtml(text: string) {
  const root = document.createElement("div");
  root.textContent = text || "";
  return linkifyMessageHtml(root.innerHTML.replace(/\n/g, "<br />"));
}

function escapeHtmlText(text: string) {
  const element = document.createElement("span");
  element.textContent = text;
  return element.innerHTML.replace(/\n/g, "<br />");
}

function wrapInlineHtml(html: string, tags: string[]) {
  return tags.reduceRight((value, tag) => `<${tag}>${value}</${tag}>`, html);
}

function splitBibleTextNode(text: string, keyPrefix: string, inlineTags: string[] = []) {
  const segments: BibleRichTextSegment[] = [];
  const referenceClass = inlineTags.some((tag) => tag === "s" || tag === "del") ? "text-struck" : undefined;
  let cursor = 0;
  for (const match of extractBibleReferenceMatches(text)) {
    if (match.start > cursor) segments.push({ kind: "html", key: `${keyPrefix}-t-${cursor}`, html: wrapInlineHtml(escapeHtmlText(text.slice(cursor, match.start)), inlineTags) });
    segments.push({ kind: "reference", key: `${keyPrefix}-r-${match.start}`, reference: match.reference, className: referenceClass });
    cursor = match.end;
  }
  if (cursor < text.length) segments.push({ kind: "html", key: `${keyPrefix}-t-${cursor}`, html: wrapInlineHtml(escapeHtmlText(text.slice(cursor)), inlineTags) });
  return segments;
}

function bibleRichTextSegmentsFromHtml(html: string, keyPrefix: string): BibleRichTextSegment[] {
  const root = document.createElement("div");
  root.innerHTML = linkifyMessageHtml(html || "");
  const segments: BibleRichTextSegment[] = [];
  let index = 0;
  const walk = (node: Node, inlineTags: string[] = []) => {
    if (node.nodeType === Node.TEXT_NODE) {
      segments.push(...splitBibleTextNode(node.textContent || "", `${keyPrefix}-${index++}`, inlineTags));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as HTMLElement;
    if (element.tagName === "A") {
      segments.push({ kind: "html", key: `${keyPrefix}-a-${index++}`, html: element.outerHTML });
      return;
    }
    if (element.tagName === "BR") {
      segments.push({ kind: "html", key: `${keyPrefix}-br-${index++}`, html: "<br />" });
      return;
    }
    const tag = element.tagName.toLowerCase();
    const nextTags = ["b", "strong", "i", "em", "u", "s", "del"].includes(tag) ? [...inlineTags, tag] : inlineTags;
    for (const child of Array.from(element.childNodes)) walk(child, nextTags);
  };
  for (const child of Array.from(root.childNodes)) walk(child);
  return segments;
}

function bibleRichTextSegmentsFromText(text: string, keyPrefix: string) {
  return splitBibleTextNode(text || "", keyPrefix);
}

function messageRichTextSegments(message: MessageDTO) {
  return bibleRichTextSegmentsFromHtml(message.content, `message-${message.id}`);
}

function prayerRichTextSegments(message: MessageDTO) {
  return bibleRichTextSegmentsFromHtml(message.content, `prayer-${message.id}`);
}

function chainTopicRichTextSegments(message: MessageDTO) {
  return bibleRichTextSegmentsFromText(chainPayload(message).topic || "", `chain-${message.id}`);
}

function bibleReferencesFromHtml(html: string) {
  return extractBibleReferencesFromText(plainTextFromHtml(html));
}

function messageBibleReferences(message: MessageDTO) {
  return message.type === "text" ? bibleReferencesFromHtml(message.content) : [];
}

function chainBibleReferences(message: MessageDTO) {
  return message.type === "chain" ? extractBibleReferencesFromText(chainPayload(message).topic || "") : [];
}

function messageBibleReferenceScope(message: MessageDTO, area: "content" | "chain") {
  return `${area}:${message.id}`;
}

function messagePreviewUrl(message: MessageDTO) {
  if (message.type !== "text" && message.type !== "prayer") return "";
  return extractMessageUrls(message.content)[0] || "";
}

function linkPreviewFor(message: MessageDTO) {
  const url = messagePreviewUrl(message);
  const state = url ? linkPreviewCache.value[url] : undefined;
  return state?.status === "ready" ? state.preview || null : null;
}

function hostFromUrl(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function previewSiteName(preview?: LinkPreviewDTO | null) {
  return preview ? preview.siteName || hostFromUrl(preview.url) : "";
}

async function ensureVisibleLinkPreviews() {
  const urls = [...new Set(store.messages.map(messagePreviewUrl).filter(Boolean))].slice(-40);
  for (const url of urls) void ensureLinkPreview(url);
}

async function ensureLinkPreview(url: string) {
  if (!store.account || linkPreviewCache.value[url]) return;
  linkPreviewCache.value = { ...linkPreviewCache.value, [url]: { status: "loading" } };
  try {
    const preview = await api<LinkPreviewDTO>(`/api/link-preview?url=${encodeURIComponent(url)}`);
    if (!preview.title && !preview.image && !preview.description) throw new Error("empty preview");
    linkPreviewCache.value = { ...linkPreviewCache.value, [url]: { status: "ready", preview } };
  } catch (error) {
    linkPreviewCache.value = { ...linkPreviewCache.value, [url]: { status: "error", error: error instanceof Error ? error.message : "preview failed" } };
  }
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

function readPositionStorageKey(channelId = store.currentChannelId, prayerOnly = store.prayerOnly) {
  if (!store.account || !channelId) return "";
  return `team-chat-read-position-${store.account.id}-${channelId}-${prayerOnly ? "prayers" : "chat"}`;
}

function visibleMessageElements() {
  const root = scroller.value;
  if (!root) return [];
  const rootRect = root.getBoundingClientRect();
  return Array.from(root.querySelectorAll<HTMLElement>("[data-message-id]")).filter((el) => {
    const rect = el.getBoundingClientRect();
    return rect.bottom >= rootRect.top && rect.top <= rootRect.bottom;
  });
}

function saveReadPosition() {
  if (pendingReadPositionRestore.value) return;
  const root = scroller.value;
  const key = readPositionStorageKey();
  if (!root || !key || !store.messages.length) return;
  const firstVisible = visibleMessageElements()[0];
  const messageId = Number(firstVisible?.dataset.messageId || 0);
  const rootTop = root.getBoundingClientRect().top;
  const position: SavedReadPosition = {
    messageId,
    offset: firstVisible ? firstVisible.getBoundingClientRect().top - rootTop : 0,
    atBottom: isNearMessageBottom(80),
    scrollTop: root.scrollTop,
    savedAt: Date.now()
  };
  localStorage.setItem(key, JSON.stringify(position));
}

function loadSavedReadPosition(): SavedReadPosition | null {
  const key = readPositionStorageKey();
  if (!key) return null;
  try {
    const raw = JSON.parse(localStorage.getItem(key) || "null") as Partial<SavedReadPosition> | null;
    if (!raw || typeof raw !== "object") return null;
    return {
      messageId: Number(raw.messageId || 0),
      offset: Number(raw.offset || 0),
      atBottom: !!raw.atBottom,
      scrollTop: Number(raw.scrollTop || 0),
      savedAt: Number(raw.savedAt || 0)
    };
  } catch {
    return null;
  }
}

async function restoreSavedReadPosition() {
  const token = ++readPositionRestoreToken;
  await nextTick();
  if (token !== readPositionRestoreToken || store.loadingInitialMessages) return;
  const root = scroller.value;
  if (!root) return;
  const position = loadSavedReadPosition();
  if (!position) {
    scrollBottom(false);
    pendingReadPositionRestore.value = false;
    return;
  }
  if (position.atBottom && !store.hasNewerMessages) {
    scrollBottom(false);
    pendingReadPositionRestore.value = false;
    return;
  }
  if (position.messageId) {
    await loadUntilMessageVisible(position.messageId);
    await nextTick();
    const currentRoot = scroller.value;
    const target = currentRoot?.querySelector<HTMLElement>(`[data-message-id="${position.messageId}"]`);
    if (target && currentRoot) {
      const rootTop = currentRoot.getBoundingClientRect().top;
      currentRoot.scrollTop += target.getBoundingClientRect().top - rootTop - position.offset;
      hasUnreadMessages.value = false;
      pendingReadPositionRestore.value = false;
      return;
    }
  }
  root.scrollTop = position.scrollTop;
  hasUnreadMessages.value = false;
  pendingReadPositionRestore.value = false;
}

async function jumpToMessageInChannel(channelId: number, messageId: number) {
  if (store.currentChannelId !== channelId) {
    saveReadPosition();
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
    if (isLogRoute.value) {
      if (account.isAdmin) await loadAdminLoginLogs();
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
  const whyTopicId = Number(params.get("whyTopicId") || 0);
  if (whyTopicId) {
    await openWhyTopic(whyTopicId);
    params.delete("whyTopicId");
    const nextQuery = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash}`);
    return;
  }
  const channelId = Number(params.get("channelId") || 0);
  if (!channelId || !store.channels.some((channel) => channel.id === channelId)) return;
  workspace.value = "chat";
  saveReadPosition();
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
  isLogRoute.value = false;
  window.history.pushState({}, "", "/");
}

async function openLoginLogPage() {
  if (!store.account?.isAdmin) return;
  showAdmin.value = false;
  isAiSettingsRoute.value = false;
  isLogRoute.value = true;
  window.history.pushState({}, "", "/log");
  await loadAdminLoginLogs();
}

function syncAiSettingsEdit(settings: AiSettingsDTO) {
  aiSettings.value = settings;
  aiSettingsEdit.value = {
    enabled: settings.enabled,
    apiKey: "",
    clearApiKey: false,
    promptCommand: settings.promptCommand,
    aiRoles: (settings.aiRoles || []).map((role) => ({ ...role })),
    cardCooldownSeconds: settings.cardCooldownSeconds,
    userLimitPerMinute: settings.userLimitPerMinute,
    maxSuccessPerMessage: settings.maxSuccessPerMessage
  };
}

function aiRoleHint(role: AiRoleDTO) {
  if (role.username === "ai_slmm") return "普通聊天里检测到问句后自动触发，并把原消息交给这个角色回复。";
  if (role.username === "why_assistant") return "为什么话题里的严格引导助手。";
  return "AI 角色";
}

async function uploadAiRoleAvatar(role: AiRoleDTO, event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  (event.target as HTMLInputElement).value = "";
  if (!file) return;
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`/api/admin/ai-roles/${encodeURIComponent(role.username)}/avatar`, { method: "POST", headers: authHeaders(), body: form });
  if (!response.ok) {
    const result = await response.json().catch(() => ({ message: "头像上传失败" }));
    alert(result.message || "头像上传失败");
    return;
  }
  const result = (await response.json()) as { role: AiRoleDTO };
  const index = aiSettingsEdit.value.aiRoles.findIndex((item) => item.username === role.username);
  if (index >= 0) aiSettingsEdit.value.aiRoles[index] = { ...aiSettingsEdit.value.aiRoles[index], avatarPath: result.role.avatarPath };
  aiSettingsMsg.value = "AI 角色头像已更新";
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

async function loadAdminLoginLogs() {
  if (!store.account?.isAdmin) return;
  adminLoginLogsBusy.value = true;
  adminLoginLogsMsg.value = "";
  try {
    const result = await api<{ logs: AdminLoginLogDTO[] }>("/api/admin/login-logs?limit=200");
    adminLoginLogs.value = result.logs;
  } catch (error) {
    adminLoginLogsMsg.value = error instanceof Error ? error.message : "登录记录加载失败";
  } finally {
    adminLoginLogsBusy.value = false;
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
      aiRoles: aiSettingsEdit.value.aiRoles.map((role) => ({
        username: role.username,
        displayName: role.displayName,
        enabled: role.enabled,
        promptCommand: role.promptCommand,
        webSearchEnabled: role.webSearchEnabled,
        questionTriggerEnabled: role.questionTriggerEnabled
      })),
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

function notificationPermissionAttemptKey(accountId?: number) {
  return `team-chat-notification-attempts-${accountId || "guest"}`;
}

function loadNotificationPermissionAttempts(accountId?: number) {
  return Number(localStorage.getItem(notificationPermissionAttemptKey(accountId)) || 0);
}

function recordNotificationPermissionAttempt() {
  const accountId = store.account?.id;
  const next = Math.min(2, notificationPermissionAttempts.value + 1);
  notificationPermissionAttempts.value = next;
  localStorage.setItem(notificationPermissionAttemptKey(accountId), String(next));
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

async function openNotificationPrompt() {
  notificationPromptOpen.value = true;
  await loadNotificationSettings();
}

async function enableNotifications() {
  notificationMsg.value = "";
  if (!notificationSupported.value) {
    notificationMsg.value = "当前浏览器不支持通知";
    return;
  }
  if (Notification.permission === "denied") {
    notificationPermission.value = "denied";
    notificationMsg.value = "浏览器已经拒绝通知，请在地址栏或系统设置里重新允许。";
    return;
  }
  notificationBusy.value = true;
  try {
    if (!notificationPublicKey.value) await loadNotificationSettings();
    if (!notificationPublicKey.value) throw new Error("服务器推送未就绪");
    const permission = await Notification.requestPermission();
    notificationPermission.value = permission;
    if (permission !== "granted") {
      recordNotificationPermissionAttempt();
      notificationMsg.value = permission === "denied" ? "浏览器未允许通知，小铃铛有点委屈。" : "这次先不打扰你，小铃铛还会在这里。";
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
    notificationPermissionAttempts.value = 0;
    localStorage.setItem(notificationPermissionAttemptKey(store.account?.id), "0");
    notificationMsg.value = "已开启本设备通知";
  } catch (error) {
    notificationMsg.value = error instanceof Error ? error.message : "开启通知失败";
  } finally {
    notificationBusy.value = false;
  }
}

async function sendTestNotification() {
  notificationMsg.value = "";
  if (!notificationEnabled.value) {
    notificationMsg.value = "请先开启本设备通知，再发送测试。";
    return;
  }
  notificationBusy.value = true;
  try {
    const subscription = await currentPushSubscription();
    if (!subscription) throw new Error("当前设备还没有通知订阅");
    await api("/api/notifications/test", { method: "POST", body: JSON.stringify({ endpoint: subscription.endpoint }) });
    notificationMsg.value = "测试通知已发送，请看系统通知。";
  } catch (error) {
    notificationMsg.value = error instanceof Error ? error.message : "测试通知发送失败";
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

function parseWhyComposerTrigger(value: string): { kind: "none" } | { kind: "shortcut" } | { kind: "create"; question: string } {
  const trimmed = value.trim();
  if (trimmed === "/?" || trimmed === "/？") return { kind: "shortcut" };
  if (trimmed === "/为什么") return { kind: "create", question: "" };
  if (trimmed.startsWith("/为什么 ") || trimmed.startsWith("/为什么\n")) return { kind: "create", question: trimmed.slice("/为什么".length).trim() };
  if (trimmed.startsWith("?") || trimmed.startsWith("？")) return { kind: "create", question: trimmed.slice(1).trim() };
  return { kind: "none" };
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
  const whyTrigger = parseWhyComposerTrigger(input.value);
  if (whyTrigger.kind === "shortcut") {
    input.value = "";
    await openWhyHome();
    return;
  }
  if (whyTrigger.kind === "create") {
    if (!whyTrigger.question || !store.currentChannelId) return;
    const originalInput = input.value;
    input.value = "";
    try {
      await createWhyTopic(whyTrigger.question, store.currentChannelId);
    } catch (error) {
      input.value = originalInput;
      alert(error instanceof Error ? error.message : "创建为什么研究失败");
    }
    return;
  }
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

async function loadWhySummary() {
  if (!store.account) return;
  whySummary.value = await api<{ unreadCount: number; pendingRequestCount: number }>("/api/why/summary").catch(() => ({ unreadCount: 0, pendingRequestCount: 0 }));
}

async function handleWhyUpdated(event: Event) {
  const topicId = Number((event as CustomEvent<{ topicId?: number }>).detail?.topicId || 0);
  await loadWhySummary();
  if (workspace.value === "why") await loadWhyTopics().catch(() => undefined);
  if (whyCurrentTopic.value && topicId === whyCurrentTopic.value.id) await openWhyTopic(topicId);
}

async function handleWhyMessagesRefresh(event: Event) {
  const channelId = Number((event as CustomEvent<{ channelId?: number }>).detail?.channelId || 0);
  if (whyCurrentTopic.value?.channelId && whyCurrentTopic.value.channelId === channelId) await openWhyTopic(whyCurrentTopic.value.id);
}

async function loadWhyTopics() {
  if (!store.account) return;
  const result = await api<{ topics: WhyTopicDTO[] }>("/api/why/topics");
  whyTopics.value = result.topics;
  await loadWhySummary();
}

async function openWhyHome() {
  workspace.value = "why";
  composerPanel.value = null;
  whyCurrentTopic.value = null;
  whyMessages.value = [];
  whyMembers.value = [];
  whyRuns.value = [];
  whyError.value = "";
  whyLoading.value = true;
  try {
    await loadWhyTopics();
  } catch (error) {
    whyError.value = error instanceof Error ? error.message : "为什么列表加载失败";
  } finally {
    whyLoading.value = false;
  }
}

function returnToChatWorkspace() {
  showChannels.value = false;
  workspace.value = "chat";
}

async function openWhyTopic(topicId: number) {
  workspace.value = "why";
  whyLoading.value = true;
  whyError.value = "";
  try {
    const result = await api<{ topic: WhyTopicDTO; members: WhyTopicMemberDTO[]; messages: MessageDTO[]; runs: WhyAssistantRunDTO[] }>(`/api/why/topics/${topicId}`);
    whyCurrentTopic.value = result.topic;
    whyMembers.value = result.members;
    whyMessages.value = result.messages;
    whyRuns.value = result.runs;
    store.socket?.emit("channel:join", { channelId: result.topic.channelId });
    await loadWhyTopics();
  } catch (error) {
    whyError.value = error instanceof Error ? error.message : "为什么研究加载失败";
  } finally {
    whyLoading.value = false;
  }
}

async function openWhyTopicFromCard(message: MessageDTO) {
  const payload = whyCardPayload(message);
  if (!payload.topicId || payload.status === "deleted") {
    alert("问题已删除");
    return;
  }
  if (payload.requestStatus === "owner" || payload.requestStatus === "member") {
    await openWhyTopic(payload.topicId);
    return;
  }
  if (payload.requestStatus === "requested") return;
  try {
    await api(`/api/why/topics/${payload.topicId}/request`, { method: "POST", body: JSON.stringify({}) });
    await store.loadMessages();
  } catch (error) {
    alert(error instanceof Error ? error.message : "操作失败");
  }
}

async function createWhyTopic(question: string, sourceChannelId?: number, sourceMessageId?: number) {
  whyBusy.value = true;
  try {
    const result = await api<{ topic: WhyTopicDTO }>("/api/why/topics", {
      method: "POST",
      body: JSON.stringify({ question, sourceChannelId: sourceChannelId || null, sourceMessageId: sourceMessageId || null })
    });
    await loadWhyTopics();
    if (result.topic) await openWhyTopic(result.topic.id);
  } finally {
    whyBusy.value = false;
  }
}

async function submitWhyHomeQuestion() {
  const question = whyHomeQuestion.value.trim();
  if (!question) return;
  whyHomeQuestion.value = "";
  try {
    await createWhyTopic(question);
  } catch (error) {
    whyHomeQuestion.value = question;
    whyError.value = error instanceof Error ? error.message : "创建为什么研究失败";
  }
}

async function sendWhyTopicMessage() {
  if (!whyCurrentTopic.value) return;
  const content = whyTopicInput.value.trim();
  if (!content) return;
  whyTopicInput.value = "";
  whyBusy.value = true;
  try {
    const result = await api<{ message: MessageDTO }>(`/api/why/topics/${whyCurrentTopic.value.id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content })
    });
    if (result.message && !whyMessages.value.some((message) => message.id === result.message.id)) whyMessages.value.push(result.message);
    await openWhyTopic(whyCurrentTopic.value.id);
  } catch (error) {
    whyTopicInput.value = content;
    whyError.value = error instanceof Error ? error.message : "发送失败";
  } finally {
    whyBusy.value = false;
  }
}

function whyCardPayload(message: MessageDTO): WhyTopicCardPayload {
  const raw = message.payload && typeof message.payload === "object" ? (message.payload as Partial<WhyTopicCardPayload>) : {};
  return {
    kind: "why_topic_card",
    topicId: Number(raw.topicId || 0),
    title: String(raw.title || message.content || "一个新问题"),
    status: raw.status === "completed" || raw.status === "deleted" ? raw.status : "active",
    ownerName: String(raw.ownerName || message.sender.displayName),
    requestStatus: raw.requestStatus || "none",
    sourceMessageId: raw.sourceMessageId || null
  };
}

async function requestWhyTopicFromCard(message: MessageDTO) {
  await openWhyTopicFromCard(message);
}

async function approveWhyRequest(accountId: number, approve: boolean) {
  if (!whyCurrentTopic.value) return;
  await api(`/api/why/topics/${whyCurrentTopic.value.id}/requests/${accountId}`, {
    method: "POST",
    body: JSON.stringify({ action: approve ? "approve" : "reject" })
  });
  await openWhyTopic(whyCurrentTopic.value.id);
}

async function retryWhyAssistant() {
  if (!whyCurrentTopic.value) return;
  await api(`/api/why/topics/${whyCurrentTopic.value.id}/retry-assistant`, { method: "POST", body: JSON.stringify({}) });
  await openWhyTopic(whyCurrentTopic.value.id);
}

async function completeWhyTopic() {
  if (!whyCurrentTopic.value) return;
  await api(`/api/why/topics/${whyCurrentTopic.value.id}/complete`, { method: "POST", body: JSON.stringify({}) });
  await openWhyTopic(whyCurrentTopic.value.id);
}

async function deleteWhyTopic() {
  if (!whyCurrentTopic.value || !confirm(`删除为什么研究“${whyCurrentTopic.value.title}”？`)) return;
  await api(`/api/why/topics/${whyCurrentTopic.value.id}`, { method: "DELETE" });
  await openWhyHome();
  await store.loadMessages().catch(() => undefined);
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
  saveReadPosition();
  await store.switchChannel(result.channel.id);
  await nextTick();
  await restoreSavedReadPosition();
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

function beginMessageLongPress(message: MessageDTO, event: PointerEvent) {
  if (messageEffect(message) === "water") requestDeviceOrientationPermissionOnce();
  if (message.type === "system" || event.button !== 0) return;
  const target = event.target;
  if (target instanceof Element && target.closest(".reply-preview, .chain-card button, .voice-card button, .prayer-actions, .message-bible, .message-select-btn, a, audio, video, iframe")) return;
  longPressStartedAt = { x: event.clientX, y: event.clientY };
  clearMessageLongPress();
  longPressTimer = window.setTimeout(() => {
    openMessageActionMenu(message, event);
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

function openMessageActionMenu(message: MessageDTO, event: PointerEvent) {
  clearMessageLongPress();
  messageActionPromptPosition.value = positionPromptNearEvent(event, { width: 172, height: 146 });
  pendingMessageActions.value = message;
  pendingChain.value = null;
  pendingDownload.value = null;
  pendingRecall.value = null;
  pendingPrayer.value = null;
  selectedMember.value = null;
}

function closeMessageActionMenu() {
  pendingMessageActions.value = null;
}

function quoteActionMessage() {
  const message = pendingMessageActions.value;
  if (!message) return;
  pickReply(message);
  closeMessageActionMenu();
}

function recallActionMessage(event?: MouseEvent) {
  const message = pendingMessageActions.value;
  if (!message || !canRecallMessage(message)) return;
  closeMessageActionMenu();
  openRecallPrompt(message, event);
}

async function selectActionMessageText() {
  const message = pendingMessageActions.value;
  if (!message) return;
  textSelectableMessageId.value = message.id;
  closeMessageActionMenu();
  await nextTick();
  const row = scroller.value?.querySelector<HTMLElement>(`.message-row[data-message-id="${message.id}"]`);
  const selectionTarget =
    row?.querySelector<HTMLElement>(".message-text, .prayer-text, .chain-card h3, .why-card p, .media-file-card span, .file-card span") ||
    row?.querySelector<HTMLElement>(".bubble");
  if (!selectionTarget) return;
  const range = document.createRange();
  range.selectNodeContents(selectionTarget);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function handleBubbleClick(message: MessageDTO, event: MouseEvent) {
  if (Date.now() < suppressNextTapUntil) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (messageSelectionMode.value && (isAdmin.value || canPinCurrentChannel.value) && message.id > 0) {
    toggleMessageSelected(message);
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  acknowledgeMentionAlert(message);
  if (toggleMessageEffect(message)) {
    event.preventDefault();
    event.stopPropagation();
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
  if (canPreviewMessage(message)) {
    openPreviewMessage(message);
    return;
  }
  requestDownload(message, event);
}

function openPreviewMessage(message: MessageDTO) {
  previewMessage.value = message;
  previewPinnedImage.value = null;
  pendingDownload.value = null;
  resetImagePreviewTransform();
}

type PinnedMediaBlock = { type: "image" | "file"; fileName: string; filePath: string; fileSize?: number | null };

function openPinnedImage(block: PinnedMediaBlock) {
  previewPinnedImage.value = { url: pinnedFileUrl(block), fileName: block.fileName };
  previewMessage.value = {
    id: -1,
    channelId: store.currentChannelId,
    sender: { id: 0, kind: "system", username: "pinned", displayName: "置顶" },
    content: "",
    type: "image",
    fileName: block.fileName,
    fileSize: block.fileSize,
    createdAt: new Date().toISOString()
  };
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
  previewPinnedImage.value = null;
  resetImagePreviewTransform();
}

function previewImageSrc() {
  return previewPinnedImage.value?.url || (previewMessage.value ? fileUrl(previewMessage.value) : "");
}

function downloadPreviewImage() {
  if (!previewPinnedImage.value) {
    if (previewMessage.value) downloadFile(previewMessage.value);
    return;
  }
  const anchor = document.createElement("a");
  anchor.href = previewPinnedImage.value.url;
  anchor.download = previewPinnedImage.value.fileName || "image";
  anchor.click();
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
  pendingMessageActions.value = null;
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
  pendingMessageActions.value = null;
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
  pendingMessageActions.value = null;
  selectedMember.value = null;
}

function positionPromptNearEvent(event: MouseEvent | PointerEvent | undefined, size: { width: number; height: number }) {
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
  if (showMessageFontMenu.value && !target.closest("[data-message-font-menu]")) {
    showMessageFontMenu.value = false;
  }
  if (pendingChain.value && !target.closest("[data-chain-popover]") && !target.closest("[data-chain-bubble]")) {
    pendingChain.value = null;
  }
  if (pendingDownload.value && !target.closest("[data-download-popover]") && !target.closest("[data-file-card]")) {
    pendingDownload.value = null;
  }
  if (pendingRecall.value && !target.closest("[data-recall-popover]") && !target.closest(".bubble")) {
    pendingRecall.value = null;
  }
  if (pendingMessageActions.value && !target.closest("[data-message-actions-popover]") && !target.closest(".bubble")) {
    pendingMessageActions.value = null;
  }
  if (pendingPrayer.value && !target.closest("[data-prayer-popover]") && !target.closest(".prayer-actions")) {
    pendingPrayer.value = null;
  }
  if (selectedMember.value && !target.closest("[data-member-popover]") && !target.closest(".member-row")) {
    selectedMember.value = null;
  }
}

function clampMessageFontSize(value: number) {
  if (!Number.isFinite(value)) return defaultMessageFontSize;
  return Math.min(maxMessageFontSize, Math.max(minMessageFontSize, Math.round(value)));
}

function toggleMessageFontMenu() {
  showMessageFontMenu.value = !showMessageFontMenu.value;
}

function adjustMessageFontSize(delta: number) {
  messageFontSize.value = clampMessageFontSize(messageFontSize.value + delta);
}

function messageFontSizeStorageKey(accountId: number) {
  return `team-chat-message-font-size:${accountId}`;
}

function loadMessageFontSizePreference(accountId?: number | null) {
  if (!accountId) return defaultMessageFontSize;
  const saved = localStorage.getItem(messageFontSizeStorageKey(accountId));
  if (!saved) return defaultMessageFontSize;
  if (saved in legacyMessageFontSizes) return legacyMessageFontSizes[saved];
  return clampMessageFontSize(Number(saved));
}

function toggleMessageSelectionMode() {
  messageSelectionMode.value = !messageSelectionMode.value;
  selectedMessageIds.value = new Set();
  pendingChain.value = null;
  pendingDownload.value = null;
  pendingRecall.value = null;
  pendingMessageActions.value = null;
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

async function pinSelectedMessages() {
  const ids = [...selectedMessageIds.value];
  if (!ids.length || !store.currentChannelId || !canPinCurrentChannel.value) return;
  const result = await api<{ pinned: NonNullable<typeof store.pinned> }>(`/api/channels/${store.currentChannelId}/pinned`, {
    method: "POST",
    body: JSON.stringify({ messageIds: ids, active: true })
  });
  store.pinned = result.pinned;
  const ch = store.channels.find((channel) => channel.id === store.currentChannelId);
  if (ch) ch.pinned = result.pinned;
  pinnedExpanded.value = true;
  selectedMessageIds.value = new Set();
  messageSelectionMode.value = false;
}

async function collapsePinned() {
  const pinned = visiblePinned.value;
  if (!pinned || !pinnedExpanded.value || !store.currentChannelId) return;
  pinnedExpanded.value = false;
  pinned.dismissed = true;
  await api(`/api/channels/${store.currentChannelId}/pinned/dismiss`, {
    method: "POST",
    body: JSON.stringify({ pinnedId: pinned.id, version: pinned.version })
  }).catch(() => undefined);
}

function togglePinned() {
  if (pinnedExpanded.value) void collapsePinned();
  else pinnedExpanded.value = true;
}

function clonePinnedBlock(block: PinnedContentBlockDTO): PinnedContentBlockDTO {
  return block.type === "text" ? { id: block.id, type: "text", text: block.text } : { id: block.id, type: block.type, fileName: block.fileName, filePath: block.filePath, fileSize: block.fileSize };
}

function openPinnedEditor() {
  const pinned = visiblePinned.value;
  if (!pinned || !canPinCurrentChannel.value) return;
  pinnedEditTitle.value = pinned.title || "";
  pinnedEditBlocks.value = pinnedBlocks.value.map(clonePinnedBlock);
  pinnedEditMsg.value = "";
  showPinnedEditor.value = true;
}

function addPinnedTextBlock() {
  pinnedEditBlocks.value = [...pinnedEditBlocks.value, { id: `new-${Date.now()}`, type: "text", text: "" }];
}

function removePinnedBlock(index: number) {
  pinnedEditBlocks.value = pinnedEditBlocks.value.filter((_block, idx) => idx !== index);
}

function cleanPinnedEditBody(): PinnedBodyDTO {
  return {
    blocks: pinnedEditBlocks.value
      .map((block) => (block.type === "text" ? { ...block, text: block.text.trim() } : block))
      .filter((block) => (block.type === "text" ? !!block.text : !!block.filePath))
  };
}

async function savePinnedEditor() {
  if (!store.currentChannelId || !canPinCurrentChannel.value) return;
  const body = cleanPinnedEditBody();
  if (!body.blocks.length) {
    pinnedEditMsg.value = "置顶内容不能为空";
    return;
  }
  const result = await api<{ pinned: NonNullable<typeof store.pinned> }>(`/api/channels/${store.currentChannelId}/pinned`, {
    method: "POST",
    body: JSON.stringify({ title: pinnedEditTitle.value, body, active: true })
  });
  store.pinned = result.pinned;
  const ch = store.channels.find((channel) => channel.id === store.currentChannelId);
  if (ch) ch.pinned = result.pinned;
  pinnedExpanded.value = true;
  showPinnedEditor.value = false;
}

async function clearPinned() {
  if (!store.currentChannelId || !canPinCurrentChannel.value) return;
  if (!confirm("撤下当前置顶消息？")) return;
  const result = await api<{ pinned: null }>(`/api/channels/${store.currentChannelId}/pinned`, {
    method: "POST",
    body: JSON.stringify({ active: false })
  });
  store.pinned = result.pinned;
  const ch = store.channels.find((channel) => channel.id === store.currentChannelId);
  if (ch) ch.pinned = null;
  showPinnedEditor.value = false;
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

function isImageFile(file: File) {
  return file.type.startsWith("image/") || /\.(jpe?g|png|gif|webp|heic|heif|tiff?)$/i.test(file.name);
}

function shouldKeepOriginalImage(file: File) {
  return keepOriginalImages.value && isImageFile(file);
}

function uploadPickedFile(file: File) {
  const options = { originalImage: shouldKeepOriginalImage(file) };
  const pendingMessageId = pushPendingFileMessage(file, options);
  void uploadFile(file, { ...options, pendingMessageId });
}

function handlePickedFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) uploadPickedFile(file);
  input.value = "";
}

function extensionFromImageMime(type: string) {
  if (type === "image/jpeg") return "jpg";
  if (type === "image/png") return "png";
  if (type === "image/gif") return "gif";
  if (type === "image/webp") return "webp";
  if (type === "image/heic") return "heic";
  if (type === "image/heif") return "heif";
  if (type === "image/tiff") return "tiff";
  return "png";
}

function namedClipboardImage(file: File, index: number) {
  if (/\.(jpe?g|png|gif|webp|heic|heif|tiff?)$/i.test(file.name)) return file;
  const extension = extensionFromImageMime(file.type);
  return new File([file], `粘贴图片-${Date.now()}-${index + 1}.${extension}`, { type: file.type || "image/png", lastModified: file.lastModified || Date.now() });
}

function clipboardImageFiles(event: ClipboardEvent) {
  const data = event.clipboardData;
  if (!data) return [];
  const files: File[] = [];
  for (const item of Array.from(data.items || [])) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  if (!files.length) {
    for (const file of Array.from(data.files || [])) {
      if (isImageFile(file)) files.push(file);
    }
  }
  return files;
}

function handleComposerPaste(event: ClipboardEvent) {
  const files = clipboardImageFiles(event);
  if (!files.length) return;
  event.preventDefault();
  files.forEach((file, index) => uploadPickedFile(namedClipboardImage(file, index)));
}

async function uploadFile(file: File, options: { voice?: boolean; durationMs?: number; waveform?: number[]; pendingMessageId?: number; originalImage?: boolean } = {}) {
  if (!store.currentChannelId) return false;
  const form = new FormData();
  form.append("channelId", String(store.currentChannelId));
  if (options.originalImage && isImageFile(file)) form.append("originalImage", "1");
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
  saveReadPosition();
  if (isNearMessageBottom(120)) hasUnreadMessages.value = false;
  if (el.scrollTop < 180 && !loadingHistoryFromScroll && (store.hasOlderMessages || store.prefetchedOlderMessages.length)) {
    loadingHistoryFromScroll = true;
    const beforeHeight = el.scrollHeight;
    const beforeTop = el.scrollTop;
    const loaded = await store.loadOlderMessages();
    await nextTick();
    if (loaded && scroller.value === el) {
      el.scrollTop = el.scrollHeight - beforeHeight + beforeTop;
      saveReadPosition();
    }
    loadingHistoryFromScroll = false;
  }
  if (isNearMessageBottom(180) && store.hasNewerMessages && !loadingNewerFromScroll) {
    loadingNewerFromScroll = true;
    const loaded = await store.loadNewerMessages();
    await nextTick();
    if (loaded) {
      scrollBottom(false);
      saveReadPosition();
    }
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
    flashEffectStep.value = (flashEffectStep.value + 1) % appearancePreviewFlash.value.colors.length;
  }, Math.max(10, Math.round(appearancePreviewFlash.value.intervalSeconds * 1000)));
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

function pinnedFileUrl(block: PinnedMediaBlock) {
  return `/api/channels/${store.currentChannelId}/pinned/files/${encodeURIComponent(block.filePath)}?token=${encodeURIComponent(getToken())}`;
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

function bibleReferenceKey(scope: string | number, reference: string) {
  return `${scope}:${reference}`;
}

function biblePreferences(): BiblePreferencesDTO {
  return (
    store.account?.biblePreferences || {
      outputFormat: "continuousText",
      referenceLabelMode: "normalizedFull",
      combinedPassageMode: "compactEllipsis",
      quotationStyle: "fullWidth"
    }
  );
}

function cleanOriginalBibleReference(reference: string) {
  return reference
    .replace(/\n|\t/g, " ")
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function applyBibleQuotationStyle(text: string) {
  const style = biblePreferences().quotationStyle;
  if (style === "halfWidth") return text.replace(/「|“/g, '"').replace(/」|”/g, '"');
  if (style === "square") return text.replace(/“/g, "「").replace(/”/g, "」");
  return text.replace(/「/g, "“").replace(/」/g, "”");
}

function bibleVerseText(verse: BibleLookupDTO["verses"][number]) {
  return applyBibleQuotationStyle(verse.text);
}

function bibleReferenceLabel(lookup: BibleLookupDTO, originalReference: string, normalizedLabel = lookup.normalizedReference) {
  const mode = biblePreferences().referenceLabelMode;
  if (mode === "omit") return "";
  if (mode === "preserveInput") return cleanOriginalBibleReference(originalReference);
  return normalizedLabel;
}

function compactVerseLabel(verse: BibleLookupDTO["verses"][number]) {
  return verse.verse === verse.endVerse ? String(verse.verse) : `${verse.verse}-${verse.endVerse}`;
}

function bibleVerseGroups(lookup: BibleLookupDTO) {
  const groups: Array<{ label: string; verses: BibleLookupDTO["verses"] }> = [];
  for (const verse of lookup.verses) {
    const last = groups[groups.length - 1];
    const contiguous = last?.verses.length ? last.verses[last.verses.length - 1].book === verse.book && last.verses[last.verses.length - 1].chapter === verse.chapter && last.verses[last.verses.length - 1].endVerse + 1 === verse.verse : false;
    if (last && contiguous) {
      last.verses.push(verse);
      const first = last.verses[0];
      last.label = `${first.book} ${first.chapter}:${first.verse}-${verse.endVerse}`;
    } else {
      groups.push({ label: verse.reference, verses: [verse] });
    }
  }
  return groups;
}

function formatBibleLookup(lookup: BibleLookupDTO | null | undefined, originalReference: string) {
  if (!lookup?.verses.length) return "";
  const preferences = biblePreferences();
  if (preferences.outputFormat === "referenceVerseLines") {
    return lookup.verses.map((verse) => `${verse.reference} ${bibleVerseText(verse)}`).join("\n");
  }
  if (preferences.outputFormat === "referenceHeader") {
    return `${lookup.normalizedReference}\n${lookup.verses.map((verse) => bibleVerseText(verse)).join("\n")}`;
  }
  if (preferences.outputFormat === "numberedVerses") {
    const label = bibleReferenceLabel(lookup, originalReference);
    const body = lookup.verses.map((verse) => `${compactVerseLabel(verse)} ${bibleVerseText(verse)}`).join("\n");
    return label ? `${label}\n${body}` : body;
  }
  const groups = bibleVerseGroups(lookup);
  if (preferences.combinedPassageMode === "groupedLines" && groups.length > 1) {
    return groups
      .map((group) => {
        const label = bibleReferenceLabel(lookup, originalReference, group.label);
        const body = group.verses.map((verse) => bibleVerseText(verse)).join("");
        return label ? `${label} ${body}` : body;
      })
      .join("\n");
  }
  const label = bibleReferenceLabel(lookup, originalReference);
  const body = groups.map((group) => group.verses.map((verse) => bibleVerseText(verse)).join("")).join("……");
  return label ? `${label} ${body}` : body;
}

function isBibleReferenceExpanded(scope: string | number, reference: string) {
  return expandedBibleReferenceKeys.value.has(bibleReferenceKey(scope, reference));
}

function isBibleReferenceBusy(scope: string | number, reference: string) {
  return bibleLookupBusyKeys.value.has(bibleReferenceKey(scope, reference));
}

function bibleReferenceLookup(scope: string | number, reference: string) {
  const key = bibleReferenceKey(scope, reference);
  return Object.prototype.hasOwnProperty.call(bibleLookupCache.value, key) ? bibleLookupCache.value[key] : undefined;
}

function setBibleReferenceBusy(key: string, busy: boolean) {
  const next = new Set(bibleLookupBusyKeys.value);
  if (busy) next.add(key);
  else next.delete(key);
  bibleLookupBusyKeys.value = next;
}

async function toggleBibleReference(scope: string | number, reference: string) {
  const key = bibleReferenceKey(scope, reference);
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

function canPublishPrayerUpdate(message: MessageDTO) {
  return message.type === "prayer" && (isMine(message) || !!store.account?.isAdmin);
}

function prayerUpdateMarkupToHtml(text: string) {
  let html = "";
  let cursor = 0;
  for (const match of text.matchAll(/~~([\s\S]+?)~~/g)) {
    const start = match.index ?? 0;
    if (start > cursor) html += escapeHtmlText(text.slice(cursor, start));
    html += `<s>${escapeHtmlText(match[1])}</s>`;
    cursor = start + match[0].length;
  }
  if (cursor < text.length) html += escapeHtmlText(text.slice(cursor));
  return html;
}

function buildPrayerUpdateHtml() {
  return prayerUpdateMarkupToHtml(prayerUpdateContent.value.trim());
}

const prayerUpdateCanPublish = computed(() => {
  return !!prayerUpdateContent.value.replace(/~~/g, "").trim();
});

function openPrayerUpdateEditor(message: MessageDTO) {
  pendingPrayerUpdate.value = message;
  prayerUpdateContent.value = prayerUpdateMarkdownFromHtml(message.content);
  prayerUpdateError.value = "";
  prayerUpdateBusy.value = false;
}

function closePrayerUpdateEditor() {
  if (prayerUpdateBusy.value) return;
  pendingPrayerUpdate.value = null;
  prayerUpdateContent.value = "";
  prayerUpdateError.value = "";
}

async function strikeSelectedPrayerUpdateText() {
  const textarea = prayerUpdateTextarea.value;
  if (!textarea || prayerUpdateBusy.value) return;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const value = prayerUpdateContent.value;
  const selected = value.slice(start, end);
  if (!selected) {
    prayerUpdateError.value = "请先在代祷内容里选中要划去的文字";
    await nextTick();
    textarea.focus();
    return;
  }
  prayerUpdateError.value = "";
  const replacement = selected.startsWith("~~") && selected.endsWith("~~") ? selected.slice(2, -2) : `~~${selected}~~`;
  prayerUpdateContent.value = `${value.slice(0, start)}${replacement}${value.slice(end)}`;
  await nextTick();
  textarea.focus();
  textarea.setSelectionRange(start, start + replacement.length);
}

async function publishPrayerUpdate() {
  const message = pendingPrayerUpdate.value;
  const content = buildPrayerUpdateHtml();
  if (!message || !prayerUpdateCanPublish.value || prayerUpdateBusy.value) return;
  prayerUpdateBusy.value = true;
  prayerUpdateError.value = "";
  try {
    const result = await api<{ success: boolean; message: MessageDTO }>(`/api/messages/${message.id}/prayer-update`, {
      method: "POST",
      body: JSON.stringify({ content })
    });
    if (result.message) store.appendLocalMessage(result.message);
    pendingPrayerUpdate.value = null;
    prayerUpdateContent.value = "";
    await nextTick();
    scrollBottom(true);
  } catch (error) {
    prayerUpdateError.value = error instanceof Error ? error.message : "更新最新动态失败";
  } finally {
    prayerUpdateBusy.value = false;
  }
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
  pendingMessageActions.value = null;
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
  syncChannelEdits();
  showAdmin.value = true;
  if (!isAdmin.value) return;
  const [a, v] = await Promise.all([api<{ accounts: any[] }>("/api/admin/accounts"), api<{ characters: any[] }>("/api/virtual-characters")]);
  accounts.value = a.accounts;
  syncAccountEdits();
  syncChannelEdits();
  virtuals.value = v.characters;
  noticeText.value = pinnedBlocks.value.filter((block) => block.type === "text").map((block) => block.text).join("\n");
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

function adminDateTime(value?: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function loginLogKindLabel(kind: AdminLoginLogKind) {
  const labels: Record<AdminLoginLogKind, string> = {
    auth_login: "登录",
    auth_logout: "退出登录",
    session_replaced: "旧设备被新登录替换",
    session_revoked: "设备被撤销",
    presence_join: "进入聊天",
    presence_leave: "离开聊天"
  };
  return labels[kind] || kind;
}

function loginLogTone(kind: AdminLoginLogKind) {
  if (kind === "auth_login" || kind === "presence_join") return "enter";
  if (kind === "auth_logout" || kind === "presence_leave") return "leave";
  return "system";
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

function isImageAttachmentId(id: string) {
  const fileName = id.split(":").slice(1).join(":");
  return /\.(jpe?g|png|gif|webp|heic|heif|tiff?)$/i.test(fileName);
}

function isImageAttachment(item: AdminAttachmentDTO) {
  return isImageAttachmentId(item.id) || /\.(jpe?g|png|gif|webp|heic|heif|tiff?)$/i.test(item.fileName);
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

async function compressAdminAttachments(ids: string[]) {
  const targets = ids.filter(isImageAttachmentId);
  if (!targets.length) return;
  const result = await api<{ compressed: number; skipped: number; savedBytes: number; attachments: AdminAttachmentDTO[] }>("/api/admin/attachments/compress", {
    method: "POST",
    body: JSON.stringify({ ids: targets })
  });
  adminMsg.value = `已压缩 ${result.compressed} 张图片，跳过 ${result.skipped} 张，节省 ${compactBytes(result.savedBytes)}`;
  adminAttachments.value = result.attachments;
  const available = new Set(result.attachments.map((item) => item.id));
  selectedAttachmentIds.value = selectedAttachmentIds.value.filter((id) => available.has(id));
  await store.loadChannels(store.currentChannelId);
}

function syncAccountEdits() {
  accountEdits.value = Object.fromEntries(
    accounts.value.map((account) => [
      account.id,
      {
        displayName: account.displayName,
        isAdmin: !!account.isAdmin,
        canPinMessages: !!account.canPinMessages,
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
      canPinMessages: edit.canPinMessages,
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

function setAppearanceDraftImage(field: AppearanceImageField, fileName: string | null, message: string) {
  loginAppearanceEdit.value[field] = fileName;
  adminMsg.value = message;
}

function openAppearanceImagePicker(field: AppearanceImageField, title: string, hint: string, fitField?: AppearanceFitField) {
  appearanceImagePicker.value = { field, title, hint, fitField };
  void loadAdminAttachments().catch(() => undefined);
}

function closeAppearanceImagePicker() {
  appearanceImagePicker.value = null;
}

async function uploadAppearanceImage(event: Event, url: string, field: AppearanceImageField, failureMessage: string, successMessage: string) {
  const file = (event.target as HTMLInputElement).files?.[0];
  (event.target as HTMLInputElement).value = "";
  if (!file) return;
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(url, { method: "POST", headers: authHeaders(), body: form });
  if (!response.ok) {
    const result = await response.json().catch(() => ({ message: failureMessage }));
    alert(result.message || failureMessage);
    return;
  }
  const result = (await response.json()) as { fileName: string; url?: string };
  setAppearanceDraftImage(field, result.fileName, successMessage);
  await loadAdminAttachments().catch(() => undefined);
}

async function uploadAppearanceImageForPicker(event: Event) {
  const picker = appearanceImagePicker.value;
  if (!picker) return;
  const uploadConfig: Record<AppearanceImageField, { url: string; failure: string; success: string }> = {
    appIconPath: { url: "/api/admin/appearance/app-icon", failure: "标签页图标上传失败", success: "标签页图标已上传并选入草稿，保存后生效" },
    loginIconPath: { url: "/api/admin/appearance/login-icon", failure: "登录页图标上传失败", success: "登录页图标已上传并选入草稿，保存后生效" },
    loginBackgroundPath: { url: "/api/admin/appearance/login-background", failure: "登录页背景上传失败", success: "登录页背景已上传并选入草稿，保存后生效" },
    wallpaperPath: { url: "/api/admin/appearance/wallpaper", failure: "壁纸上传失败", success: "壁纸已上传并选入草稿，保存后生效" }
  };
  const config = uploadConfig[picker.field];
  await uploadAppearanceImage(event, config.url, picker.field, config.failure, config.success);
}

function selectAppearanceImage(fileName: string) {
  const picker = appearanceImagePicker.value;
  if (!picker) return;
  const image = backgroundAttachmentOptions.value.find((item) => item.fileName === fileName);
  if (!image) return;
  setAppearanceDraftImage(picker.field, image.fileName, "已选择图片草稿，保存后生效");
}

function clearAppearancePickerImage() {
  const picker = appearanceImagePicker.value;
  if (!picker) return;
  const labels: Record<AppearanceImageField, string> = {
    appIconPath: "标签页图标已在草稿中恢复默认，保存后生效",
    loginIconPath: "登录页图标已从草稿移除，保存后生效",
    loginBackgroundPath: "登录页背景已从草稿移除，保存后生效",
    wallpaperPath: "聊天室壁纸已从草稿移除，保存后生效"
  };
  setAppearanceDraftImage(picker.field, null, labels[picker.field]);
}

function abandonAppearanceDraft() {
  syncLoginAppearanceEdit();
  resetThemeEditor();
  appearanceImagePicker.value = null;
}

function switchAdminTab(tab: typeof adminTab.value) {
  if (tab !== "appearance" && adminTab.value === "appearance") {
    abandonAppearanceDraft();
    appearancePreviewOpen.value = false;
  }
  adminTab.value = tab;
  if (tab === "appearance") void loadAdminAttachments();
}

function closeAdminPanel() {
  if (adminTab.value === "appearance") abandonAppearanceDraft();
  showAdmin.value = false;
  appearancePreviewOpen.value = false;
}

function syncLoginAppearanceEdit() {
  loginAppearanceEdit.value = {
    appTitle: store.appearance.appTitle || "Team Chat",
    appIconPath: store.appearance.appIconPath || null,
    loginTitle: store.appearance.loginTitle || "Team Chat",
    loginSubtitle: store.appearance.loginSubtitle || "",
    loginIconPath: store.appearance.loginIconPath || null,
    loginShowIcon: store.appearance.loginShowIcon !== false,
    loginShowSubtitle: store.appearance.loginShowSubtitle !== false,
    loginBackgroundPath: store.appearance.loginBackgroundPath || null,
    loginFormPosition: store.appearance.loginFormPosition || "middle",
    loginBackgroundFit: store.appearance.loginBackgroundFit || "cover",
    wallpaperPath: store.appearance.wallpaperPath || null,
    wallpaperFit: store.appearance.wallpaperFit || "cover",
    registrationEnabled: !!store.appearance.registrationEnabled
  };
  flashEffectEdit.value = {
    colors: [...flashEffect.value.colors],
    intervalSeconds: flashEffect.value.intervalSeconds,
    transitionMode: flashEffect.value.transitionMode
  };
  customThemesDraft.value = (store.appearance.customThemes || []).map((theme) => ({ ...theme, palette: { ...theme.palette } }));
  if (customThemeEdit.value.id && !customThemesDraft.value.some((theme) => theme.id === customThemeEdit.value.id)) resetThemeEditor();
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

async function saveLoginAppearance() {
  const result = await api<{ appearance: AppearanceDTO }>("/api/admin/appearance", {
    method: "POST",
    body: JSON.stringify(appearanceSavePayload.value)
  });
  store.appearance = result.appearance;
  await loadAdminAttachments().catch(() => undefined);
  adminMsg.value = "外观设置已保存并生效";
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
  const isBuiltIn = builtInThemes.some((item) => item.id === theme.id);
  customThemeEdit.value = {
    id: isBuiltIn ? "" : theme.id,
    name: isBuiltIn ? `${theme.name}副本` : theme.name,
    palette: { ...theme.palette }
  };
  adminMsg.value = isBuiltIn ? "已用内置主题填充草稿，可另存为自定义主题" : "正在编辑自定义主题草稿";
}

function resetThemeEditor() {
  customThemeEdit.value = { id: "", name: "我的主题", palette: { ...activePalette.value } };
}

function saveCustomTheme() {
  const id = customThemeEdit.value.id || themeSlug(customThemeEdit.value.name);
  const theme: ThemeDTO = {
    id,
    name: customThemeEdit.value.name.trim() || "自定义主题",
    palette: { ...customThemeEdit.value.palette }
  };
  const existing = customThemesDraft.value;
  customThemesDraft.value = existing.some((item) => item.id === id) ? existing.map((item) => (item.id === id ? theme : item)) : [...existing, theme];
  customThemeEdit.value = { ...theme, palette: { ...theme.palette } };
  adminMsg.value = "主题已更新到草稿，保存外观后生效";
}

function deleteCustomTheme(theme: ThemeDTO) {
  if (!confirm(`删除主题“${theme.name}”的草稿？保存外观后，使用该主题的成员会回到默认主题。`)) return;
  customThemesDraft.value = customThemesDraft.value.filter((item) => item.id !== theme.id);
  if (customThemeEdit.value.id === theme.id) resetThemeEditor();
  adminMsg.value = "主题已从草稿移除，保存外观后生效";
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
        <section class="ai-settings-subsection ai-role-settings">
          <strong>AI 角色</strong>
          <article v-for="role in aiSettingsEdit.aiRoles" :key="role.username" class="ai-role-card">
            <label class="avatar ai-role-avatar upload-avatar-trigger" :aria-label="`上传 ${role.displayName} 的头像`" title="点击上传头像">
              <img v-if="avatarUrl(role.avatarPath)" :src="avatarUrl(role.avatarPath)" alt="" />
              <span v-else>{{ avatarText(role.displayName || role.username) }}</span>
              <input class="hidden" type="file" accept="image/*" @change="uploadAiRoleAvatar(role, $event)" />
            </label>
            <div class="ai-role-body">
              <div class="ai-role-title">
                <label>
                  显示名
                  <input v-model="role.displayName" />
                </label>
                <small>@{{ role.username }}</small>
              </div>
              <small>{{ aiRoleHint(role) }}</small>
              <label class="check-row"><input v-model="role.enabled" type="checkbox" /> 启用这个 AI 角色</label>
              <label v-if="role.username === 'ai_slmm'" class="check-row"><input v-model="role.questionTriggerEnabled" type="checkbox" /> 检测到问句时自动触发</label>
              <label class="check-row"><input v-model="role.webSearchEnabled" type="checkbox" /> 默认允许联网查询</label>
              <label>提示词</label>
              <textarea v-model="role.promptCommand" rows="8"></textarea>
            </div>
          </article>
        </section>
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

  <main v-else-if="isLogRoute && store.account?.isAdmin" class="ai-settings-page login-log-page" :style="appearanceStyle">
    <section class="ai-settings-panel login-log-panel">
      <header class="ai-settings-head">
        <div>
          <strong>登录记录</strong>
          <small>成员登录、退出、进入和离开聊天</small>
        </div>
        <div class="login-log-actions">
          <button class="mini-btn secondary" :disabled="adminLoginLogsBusy" @click="loadAdminLoginLogs">{{ adminLoginLogsBusy ? "刷新中" : "刷新" }}</button>
          <button class="mini-btn secondary" @click="returnToChat">回到聊天</button>
        </div>
      </header>
      <section class="login-log-body">
        <p v-if="adminLoginLogsMsg" class="settings-note">{{ adminLoginLogsMsg }}</p>
        <p v-if="adminLoginLogsBusy && !adminLoginLogs.length" class="settings-note">正在加载登录记录...</p>
        <p v-else-if="!adminLoginLogs.length" class="settings-note">还没有登录记录。</p>
        <div v-else class="login-log-list">
          <article v-for="log in adminLoginLogs" :key="log.id" class="login-log-row">
            <div class="login-log-badge" :class="loginLogTone(log.kind)">{{ loginLogKindLabel(log.kind) }}</div>
            <div class="login-log-main">
              <div class="login-log-title">
                <strong>{{ log.displayName }}</strong>
                <small>@{{ log.username }}</small>
                <time>{{ adminDateTime(log.createdAt) }}</time>
              </div>
              <div class="login-log-meta">
                <span v-if="log.deviceName">{{ log.deviceName }}</span>
                <span v-if="log.deviceKind">{{ deviceLabel(log.deviceKind) }}</span>
                <span v-if="log.ipAddress">IP {{ log.ipAddress }}</span>
                <span v-if="log.sessionId">会话 {{ log.sessionId.slice(0, 8) }}</span>
              </div>
              <small v-if="log.userAgent" class="login-log-agent">{{ log.userAgent }}</small>
            </div>
          </article>
        </div>
      </section>
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

  <main v-else-if="isLogRoute" class="ai-settings-page" :style="appearanceStyle">
    <section class="ai-settings-panel ai-denied-panel">
      <Monitor :size="30" />
      <strong>无权查看登录记录</strong>
      <p>只有管理员可以查看成员登录、退出和离开聊天的记录。</p>
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
          :class="{ active: workspace === 'chat' && channel.id === store.currentChannelId && !store.prayerOnly }"
          @click="saveReadPosition(); workspace = 'chat'; store.switchChannel(channel.id); showChannels = false"
        >
          <span class="channel-icon"><img :src="channelIconUrl(channel)" alt="" /></span>
          <span>
            <b>{{ channel.name }}</b>
            <small>{{ channel.isPrivate ? "私密频道" : "公开频道" }}</small>
          </span>
        </button>
        <button
          class="channel-row channel-subrow"
          :class="{ active: workspace === 'chat' && channel.id === store.currentChannelId && store.prayerOnly }"
          @click="saveReadPosition(); workspace = 'chat'; store.switchPrayerView(channel.id); showChannels = false"
        >
          <span class="channel-icon prayer-icon"><HeartHandshake :size="20" /></span>
          <span>
            <b>代祷事项</b>
            <small>{{ channel.name }}</small>
          </span>
        </button>
      </template>
      <button class="channel-row why-entry" :class="{ active: workspace === 'why' }" @click="openWhyHome(); showChannels = false">
        <span class="channel-icon why-icon"><BookOpen :size="20" /></span>
        <span>
          <b>为什么</b>
          <small>
            <template v-if="whySummary.pendingRequestCount">{{ whySummary.pendingRequestCount }} 个请求待处理</template>
            <template v-else-if="whySummary.unreadCount">{{ whySummary.unreadCount }} 条未读</template>
            <template v-else>我的研究问题</template>
          </small>
        </span>
      </button>
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

    <section v-if="workspace === 'chat'" class="chat-pane">
      <canvas v-if="rainActive" ref="rainCanvas" class="rain-canvas" aria-hidden="true"></canvas>
      <div ref="dripLayer" class="drip-layer" aria-hidden="true"></div>
      <header class="chat-head">
        <button class="icon-btn mobile-only" @click="showChannels = true" aria-label="频道"><ChevronLeft :size="22" /></button>
        <button v-if="channelsCollapsed" class="icon-btn desktop-only" @click="channelsCollapsed = false" aria-label="展开频道"><PanelLeftOpen :size="20" /></button>
        <div class="chat-title">
          <div class="chat-title-line">
            <button
              v-if="notificationAttentionVisible"
              class="notification-nudge"
              :class="`level-${notificationNudgeLevel}`"
              type="button"
              aria-label="通知体检"
              @click="openNotificationPrompt"
            >
              <span aria-hidden="true">{{ notificationNudgeIcon }}</span>
            </button>
            <strong>{{ store.prayerOnly ? `${currentChannel?.name || "聊天室"} · 代祷事项` : currentChannel?.name || "聊天室" }}</strong>
          </div>
          <small>{{ store.prayerOnly ? "只显示本频道代祷卡片" : `${store.members.length} 人/角色` }}</small>
        </div>
        <div class="message-font-control" data-message-font-menu>
          <button
            v-if="!showMessageFontMenu"
            class="icon-btn message-font-trigger"
            type="button"
            :aria-label="`消息字体大小，当前 ${messageFontSize} 号`"
            aria-expanded="false"
            @click.stop="toggleMessageFontMenu"
          >
            <span class="message-font-glyph" aria-hidden="true">字</span>
          </button>
          <div v-else class="message-font-stepper" role="group" :aria-label="`消息字体大小，当前 ${messageFontSize} 号`" @click.stop>
            <button class="message-font-step-btn" type="button" :disabled="messageFontSize <= minMessageFontSize" @click="adjustMessageFontSize(-1)">小</button>
            <button class="message-font-step-btn" type="button" :disabled="messageFontSize >= maxMessageFontSize" @click="adjustMessageFontSize(1)">大</button>
          </div>
        </div>
        <button class="icon-btn" @click="membersCollapsed = false; showMembers = !showMembers" aria-label="成员">
          <PanelRightOpen v-if="membersCollapsed" :size="20" />
          <Users v-else :size="20" />
        </button>
        <button v-if="currentChannel?.directKey" class="icon-btn" @click="requestCloseChannel" aria-label="关闭私聊"><X :size="20" /></button>
        <button v-if="canDeleteCurrentChannel" class="icon-btn danger" @click="currentChannel && deleteChannel(currentChannel)" aria-label="删除频道"><Trash2 :size="19" /></button>
        <button v-if="isAdmin || canPinCurrentChannel" class="icon-btn" :class="{ active: messageSelectionMode }" @click="toggleMessageSelectionMode" aria-label="多选聊天记录"><CheckCircle2 :size="20" /></button>
        <button v-if="isAdmin" class="icon-btn" @click="loadAdmin" aria-label="管理"><Settings :size="20" /></button>
      </header>

      <section v-if="messageSelectionMode" class="message-selection-bar">
        <span>已选择 {{ selectedMessageCount }} 条</span>
        <button class="mini-btn secondary" @click="toggleVisibleMessageSelection">{{ visibleMessagesSelected ? "取消全选" : "全选当前" }}</button>
        <button v-if="canPinCurrentChannel" class="mini-btn" :disabled="!selectedMessageCount" @click="pinSelectedMessages"><Pin :size="15" />设为置顶</button>
        <button v-if="isAdmin" class="mini-btn danger-action" :disabled="!selectedMessageCount" @click="deleteSelectedMessages"><Trash2 :size="15" />删除</button>
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

      <section v-if="visiblePinned" class="pin-card" :class="{ expanded: pinnedExpanded }">
        <div class="pin-card-head">
          <button type="button" class="pin-card-open-button" @click="togglePinned" :aria-label="pinnedExpanded ? '收起置顶' : '展开置顶'" :aria-expanded="pinnedExpanded">
            <span class="pin-toggle" aria-hidden="true"><Pin :size="16" /></span>
            <span class="pin-card-copy">
              <strong>{{ pinnedText }}</strong>
              <small>{{ pinnedSummary }}</small>
            </span>
            <ChevronUp v-if="pinnedExpanded" :size="17" />
            <ChevronDown v-else :size="17" />
          </button>
          <button v-if="canPinCurrentChannel" class="mini-btn secondary" @click.stop="openPinnedEditor">编辑</button>
        </div>
      </section>

      <section v-if="visiblePinned && pinnedExpanded" class="modal-shell pinned-view-shell" role="dialog" aria-modal="true" aria-label="置顶消息">
        <div class="pinned-view-modal">
          <header class="pinned-view-head">
            <span class="pinned-view-icon"><Pin :size="17" /></span>
            <span>
              <strong>{{ pinnedText }}</strong>
              <small>{{ pinnedSummary }}</small>
            </span>
          </header>
          <div class="pin-card-body pinned-view-body">
            <template v-for="block in pinnedBlocks" :key="block.id">
              <p v-if="block.type === 'text'" v-html="textContentHtml(block.text)"></p>
              <button v-else-if="block.type === 'image'" class="image-preview-button pinned-image-button" @click.stop="openPinnedImage(block)">
                <img class="chat-image pinned-image" :src="pinnedFileUrl(block)" loading="lazy" decoding="async" alt="置顶图片" />
              </button>
              <a v-else class="file-card pinned-file-card" :href="pinnedFileUrl(block)" target="_blank" rel="noopener noreferrer" @click.stop>
                <FileUp :size="24" />
                <span>
                  <strong>{{ block.fileName }}</strong>
                  <small>{{ block.fileSize ? compactBytes(block.fileSize) : "文件" }}</small>
                </span>
              </a>
            </template>
          </div>
          <footer class="pinned-view-actions">
            <button class="primary-btn pinned-ack-btn" @click="collapsePinned"><CheckCircle2 :size="17" />朕知道了</button>
          </footer>
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
                :class="[{ 'media-bubble': row.message.type === 'image' || row.message.type === 'file', 'prayer-bubble': row.message.type === 'prayer', 'text-selectable': textSelectableMessageId === row.message.id }, messageEffectClass(row.message)]"
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
                    <h3 class="bible-rich-text">
                      <template v-for="segment in chainTopicRichTextSegments(row.message)" :key="segment.key">
                        <span v-if="segment.kind === 'html'" v-html="segment.html"></span>
                        <span v-else class="inline-bible-reference" :class="segment.className" @click.stop>
                          <button class="inline-bible-btn" type="button" @click.stop="toggleBibleReference(messageBibleReferenceScope(row.message, 'chain'), segment.reference)">
                            <BookOpen :size="13" />{{ segment.reference }}
                          </button>
                          <span v-if="isBibleReferenceExpanded(messageBibleReferenceScope(row.message, 'chain'), segment.reference)" class="inline-bible-popover">
                            <span v-if="isBibleReferenceBusy(messageBibleReferenceScope(row.message, 'chain'), segment.reference)" class="inline-bible-empty">正在查找经文...</span>
                            <template v-else-if="bibleReferenceLookup(messageBibleReferenceScope(row.message, 'chain'), segment.reference)?.verses.length">
                              <small>{{ bibleReferenceLookup(messageBibleReferenceScope(row.message, 'chain'), segment.reference)?.translation }}</small>
                              <span class="inline-bible-body">{{ formatBibleLookup(bibleReferenceLookup(messageBibleReferenceScope(row.message, 'chain'), segment.reference), segment.reference) }}</span>
                            </template>
                            <span v-else class="inline-bible-empty">暂时找不到这处经文</span>
                          </span>
                        </span>
                      </template>
                    </h3>
                    <ol>
                      <li v-for="(p, idx) in chainPayload(row.message).participants" :key="idx">
                        <span>{{ idx + 1 }}. {{ p.name }}</span>
                        <small v-if="p.text">{{ p.text }}</small>
                      </li>
                    </ol>
                    <button class="mini-btn" @click.stop="confirmJoinChain(row.message, $event)">参与接龙</button>
                  </div>
                </template>
                <template v-else-if="row.message.type === 'why_topic_card'">
                  <div class="why-card" :class="{ deleted: whyCardPayload(row.message).status === 'deleted' }" @click.stop="openWhyTopicFromCard(row.message)">
                    <div class="why-card-head">
                      <span><BookOpen :size="17" /></span>
                      <strong>{{ whyCardPayload(row.message).ownerName }} 开始了一个为什么研究</strong>
                    </div>
                    <p>{{ whyCardPayload(row.message).status === "deleted" ? "这个为什么研究已删除" : whyCardPayload(row.message).title }}</p>
                    <small>已进入深度引导模式</small>
                    <button v-if="whyCardPayload(row.message).status !== 'deleted'" class="mini-btn" @click.stop="requestWhyTopicFromCard(row.message)">
                      <template v-if="whyCardPayload(row.message).requestStatus === 'owner' || whyCardPayload(row.message).requestStatus === 'member'">查看研究</template>
                      <template v-else-if="whyCardPayload(row.message).requestStatus === 'requested'">已请求加入</template>
                      <template v-else>请求加入</template>
                    </button>
                  </div>
                </template>
                <template v-else-if="row.message.type === 'prayer'">
                  <div class="prayer-card" :class="`status-${prayerPayload(row.message).status}`">
                    <div class="prayer-card-head">
                      <span><HeartHandshake :size="17" /></span>
                      <strong>代祷事项</strong>
                      <em>{{ prayerStatusText(prayerPayload(row.message).status) }}</em>
                    </div>
                    <div class="prayer-text bible-rich-text">
                      <template v-for="segment in prayerRichTextSegments(row.message)" :key="segment.key">
                        <span v-if="segment.kind === 'html'" v-html="segment.html"></span>
                        <span v-else class="inline-bible-reference" :class="segment.className" @click.stop>
                          <button class="inline-bible-btn" type="button" @click.stop="toggleBibleReference(messageBibleReferenceScope(row.message, 'content'), segment.reference)">
                            <BookOpen :size="13" />{{ segment.reference }}
                          </button>
                          <span v-if="isBibleReferenceExpanded(messageBibleReferenceScope(row.message, 'content'), segment.reference)" class="inline-bible-popover">
                            <span v-if="isBibleReferenceBusy(messageBibleReferenceScope(row.message, 'content'), segment.reference)" class="inline-bible-empty">正在查找经文...</span>
                            <template v-else-if="bibleReferenceLookup(messageBibleReferenceScope(row.message, 'content'), segment.reference)?.verses.length">
                              <small>{{ bibleReferenceLookup(messageBibleReferenceScope(row.message, 'content'), segment.reference)?.translation }}</small>
                              <span class="inline-bible-body">{{ formatBibleLookup(bibleReferenceLookup(messageBibleReferenceScope(row.message, 'content'), segment.reference), segment.reference) }}</span>
                            </template>
                            <span v-else class="inline-bible-empty">暂时找不到这处经文</span>
                          </span>
                        </span>
                      </template>
                    </div>
                    <a v-if="linkPreviewFor(row.message)" class="link-preview-card" :href="linkPreviewFor(row.message)?.url" target="_blank" rel="noopener noreferrer" @click.stop>
                      <span class="link-preview-copy">
                        <small>{{ previewSiteName(linkPreviewFor(row.message)) }}</small>
                        <strong>{{ linkPreviewFor(row.message)?.title }}</strong>
                        <em v-if="linkPreviewFor(row.message)?.description">{{ linkPreviewFor(row.message)?.description }}</em>
                      </span>
                      <img v-if="linkPreviewFor(row.message)?.image" :src="linkPreviewFor(row.message)?.image" alt="" loading="lazy" />
                    </a>
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
                      <button v-if="canPublishPrayerUpdate(row.message)" class="mini-btn secondary" @click.stop="openPrayerUpdateEditor(row.message)"><Bell :size="15" />更新最新动态</button>
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
                                <small>{{ bibleReferenceLookup(suggestion.id, reference)?.translation }}</small>
                                <p class="formatted-bible-text">{{ formatBibleLookup(bibleReferenceLookup(suggestion.id, reference), reference) }}</p>
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
                <template v-else-if="pendingUploadFor(row.message)">
                  <div class="upload-card" :class="{ failed: pendingUploadFor(row.message)?.status === 'failed' }" @click.stop>
                    <span class="upload-card-icon">
                      <Upload v-if="pendingUploadFor(row.message)?.status !== 'failed'" :size="19" />
                      <X v-else :size="19" />
                    </span>
                    <div class="upload-card-body">
                      <strong>{{ row.message.fileName || pendingUploadKindLabel(pendingUploadFor(row.message)!.file) }}</strong>
                      <div class="voice-upload-bar">
                        <span :style="{ width: `${pendingUploadFor(row.message)?.progress || 0}%` }"></span>
                      </div>
                      <small>{{ pendingUploadKindLabel(pendingUploadFor(row.message)!.file) }} · {{ pendingUploadLabel(pendingUploadFor(row.message)!) }}</small>
                    </div>
                    <div class="voice-upload-actions">
                      <button v-if="pendingUploadFor(row.message)?.status === 'failed'" class="mini-icon-btn" @click="retryPendingUpload(row.message.id)" aria-label="重试上传">
                        <RotateCcw :size="15" />
                      </button>
                      <button class="mini-icon-btn" @click="removePendingMessage(row.message.id)" aria-label="移除上传状态"><Trash2 :size="15" /></button>
                    </div>
                  </div>
                </template>
                <template v-else-if="row.message.type === 'image'">
                  <button class="image-preview-button" @click.stop="openAttachmentFromTap(row.message, $event)">
                    <img class="chat-image" :src="fileUrl(row.message)" alt="图片" />
                  </button>
                </template>
                <template v-else-if="isVoiceMessage(row.message)">
                  <div class="voice-card" :class="{ playing: playingVoiceId === row.message.id, unread: hasUnlistenedVoice(row.message) }" @click.stop>
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
                <template v-else>
                  <div class="message-text bible-rich-text">
                    <template v-for="segment in messageRichTextSegments(row.message)" :key="segment.key">
                      <span v-if="segment.kind === 'html'" v-html="segment.html"></span>
                      <span v-else class="inline-bible-reference" :class="segment.className" @click.stop>
                        <button class="inline-bible-btn" type="button" @click.stop="toggleBibleReference(messageBibleReferenceScope(row.message, 'content'), segment.reference)">
                          <BookOpen :size="13" />{{ segment.reference }}
                        </button>
                        <span v-if="isBibleReferenceExpanded(messageBibleReferenceScope(row.message, 'content'), segment.reference)" class="inline-bible-popover">
                          <span v-if="isBibleReferenceBusy(messageBibleReferenceScope(row.message, 'content'), segment.reference)" class="inline-bible-empty">正在查找经文...</span>
                          <template v-else-if="bibleReferenceLookup(messageBibleReferenceScope(row.message, 'content'), segment.reference)?.verses.length">
                            <small>{{ bibleReferenceLookup(messageBibleReferenceScope(row.message, 'content'), segment.reference)?.translation }}</small>
                            <span class="inline-bible-body">{{ formatBibleLookup(bibleReferenceLookup(messageBibleReferenceScope(row.message, 'content'), segment.reference), segment.reference) }}</span>
                          </template>
                          <span v-else class="inline-bible-empty">暂时找不到这处经文</span>
                        </span>
                      </span>
                    </template>
                  </div>
                  <a v-if="linkPreviewFor(row.message)" class="link-preview-card" :href="linkPreviewFor(row.message)?.url" target="_blank" rel="noopener noreferrer" @click.stop>
                    <span class="link-preview-copy">
                      <small>{{ previewSiteName(linkPreviewFor(row.message)) }}</small>
                      <strong>{{ linkPreviewFor(row.message)?.title }}</strong>
                      <em v-if="linkPreviewFor(row.message)?.description">{{ linkPreviewFor(row.message)?.description }}</em>
                    </span>
                    <img v-if="linkPreviewFor(row.message)?.image" :src="linkPreviewFor(row.message)?.image" alt="" loading="lazy" />
                  </a>
                </template>
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
              @paste="handleComposerPaste"
            ></textarea>
            <button class="send-btn" :disabled="!canSendText" @click="sendText" aria-label="发送"><Send :size="19" /></button>
            <button class="icon-btn" :class="{ active: composerPanel === 'more' }" @click="toggleMorePanel" aria-label="更多功能"><Plus :size="22" /></button>
            <input ref="fileInput" class="hidden" type="file" @change="handlePickedFile" />
            <input ref="photoInput" class="hidden" type="file" accept="image/*" @change="handlePickedFile" />
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
          <label class="original-image-toggle">
            <input v-model="keepOriginalImages" type="checkbox" />
            <span>
              <strong>原图</strong>
              <small>默认压缩图片，勾选后保留原文件。</small>
            </span>
          </label>
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
          <button class="tool-tile" @click="openWhyHome">
            <span><BookOpen :size="25" /></span>
            <small>研究</small>
          </button>
        </div>
      </footer>
    </section>

    <section v-else class="chat-pane why-pane">
      <header class="chat-head">
        <button class="icon-btn mobile-only" @click="returnToChatWorkspace" aria-label="回到之前频道"><ChevronLeft :size="22" /></button>
        <button v-if="channelsCollapsed" class="icon-btn desktop-only" @click="channelsCollapsed = false" aria-label="展开频道"><PanelLeftOpen :size="20" /></button>
        <div class="chat-title">
          <strong>{{ whyCurrentTopic ? whyCurrentTopic.title : "为什么" }}</strong>
          <small>{{ whyCurrentTopic ? `${whyMembers.filter((member) => member.role !== 'requested').length} 人参与` : "我的研究问题" }}</small>
        </div>
        <button v-if="whyCurrentTopic" class="icon-btn" @click="openWhyHome" aria-label="返回为什么首页"><ChevronLeft :size="20" /></button>
        <button class="icon-btn" @click="returnToChatWorkspace" aria-label="回到聊天"><MessageCircle :size="20" /></button>
      </header>

      <div v-if="!whyCurrentTopic" class="why-home">
        <form class="why-question-box" @submit.prevent="submitWhyHomeQuestion">
          <BookOpen :size="24" />
          <textarea v-model="whyHomeQuestion" rows="3" placeholder="把你的为什么写下来"></textarea>
          <button class="primary-btn" type="submit" :disabled="whyBusy || !whyHomeQuestion.trim()">开始研究</button>
        </form>
        <p v-if="whyError" class="form-error">{{ whyError }}</p>
        <div v-if="whyLoading" class="empty-state">正在加载为什么...</div>
        <div v-else-if="!whyTopics.length" class="empty-state">还没有研究话题。先写下一个真实的问题。</div>
        <div v-else class="why-topic-list">
          <button v-for="topic in whyTopics" :key="topic.id" class="why-topic-row" :class="{ deleted: topic.status === 'deleted' }" @click="topic.status !== 'deleted' && topic.memberRole !== 'requested' ? openWhyTopic(topic.id) : undefined">
            <span class="why-topic-main">
              <b>{{ topic.title }}</b>
              <small>{{ topic.summary || topic.lastMessagePreview || "还没有摘要" }}</small>
              <em>{{ topic.sourceChannelName ? `来自 ${topic.sourceChannelName}` : "我的为什么" }} · {{ topic.status === "completed" ? "已完成" : topic.status === "deleted" ? "已删除" : "进行中" }}</em>
            </span>
            <span class="why-topic-meta">
              <strong v-if="topic.pendingRequestCount">{{ topic.pendingRequestCount }} 请求</strong>
              <strong v-if="topic.unreadCount">{{ topic.unreadCount }} 未读</strong>
              <small>{{ topic.participantCount }} 人</small>
            </span>
          </button>
        </div>
      </div>

      <div v-else class="why-topic-detail">
        <div class="why-topic-meta-bar">
          <span>{{ whyCurrentTopic.status === "completed" ? "已完成" : "深度引导模式" }}</span>
          <span v-if="whyCurrentTopic.sourceChannelName">来自 {{ whyCurrentTopic.sourceChannelName }}</span>
          <button v-if="whyCurrentTopic.memberRole === 'owner' && whyCurrentTopic.status !== 'completed'" class="mini-btn secondary" @click="completeWhyTopic">标记完成</button>
          <button v-if="whyCurrentTopic.memberRole === 'owner' || store.account?.isAdmin" class="mini-btn danger-action" @click="deleteWhyTopic">删除</button>
        </div>
        <section v-if="whyCurrentTopic.originalQuestion" class="why-original-question">
          <strong>原问题</strong>
          <p>{{ whyCurrentTopic.originalQuestion.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '') }}</p>
        </section>
        <section v-if="whyCurrentTopic.completionNote" class="why-completion-note">
          <strong>整理草稿</strong>
          <pre>{{ whyCurrentTopic.completionNote }}</pre>
        </section>
        <div v-if="whyRuns.some((run) => run.status === 'pending' || run.status === 'running')" class="why-run-state">
          为什么助手正在查资料并整理问题...
        </div>
        <div v-if="whyRuns.some((run) => run.status === 'failed')" class="why-run-state failed">
          为什么助手暂时没有回应。
          <button class="mini-btn" @click="retryWhyAssistant">重试助手</button>
        </div>
        <div class="why-message-list">
          <article v-for="message in whyMessages" :key="message.id" class="why-message" :class="{ mine: isMine(message), assistant: message.sender.username === 'why_assistant', discussion: !isMine(message) && message.sender.username !== 'why_assistant' }">
            <div class="why-message-head">
              <strong>{{ message.sender.displayName }}</strong>
              <small>{{ message.sender.username === 'why_assistant' ? '严格引导' : isMine(message) ? '研究主线' : '弟兄姐妹回应' }}</small>
            </div>
            <div class="why-message-body" v-html="message.content"></div>
          </article>
        </div>
        <form class="why-topic-composer" @submit.prevent="sendWhyTopicMessage">
          <textarea v-model="whyTopicInput" rows="2" :placeholder="whyCurrentTopic.memberRole === 'owner' ? '回应为什么助手，继续研究' : '你的回应会给提问者参考，不会直接发给 AI'"></textarea>
          <button class="send-btn" type="submit" :disabled="whyBusy || !whyTopicInput.trim()"><Send :size="18" /></button>
        </form>
      </div>
    </section>

    <aside class="member-pane" :class="{ open: showMembers, collapsed: membersCollapsed }">
      <header class="pane-head">
        <strong>{{ workspace === "why" ? "参与者" : "成员" }}</strong>
        <button class="icon-btn desktop-only" @click="membersCollapsed = true; showMembers = false" aria-label="收起成员"><PanelRightClose :size="20" /></button>
        <button class="icon-btn tablet-down" @click="showMembers = false" aria-label="关闭成员"><X :size="20" /></button>
      </header>
      <div v-if="workspace === 'chat'" class="member-list">
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
      <div v-else class="member-list why-member-list">
        <p v-if="!whyCurrentTopic" class="settings-note">打开一个为什么话题后，可以在这里查看参与者和请求。</p>
        <template v-else>
          <article v-for="member in whyMembers" :key="member.accountId" class="why-member-row" :class="{ requested: member.role === 'requested' }">
            <div class="avatar">
              <img v-if="avatarUrl(member.avatarPath)" :src="avatarUrl(member.avatarPath)" alt="" />
              <span v-else>{{ avatarText(member.displayName) }}</span>
            </div>
            <div>
              <b>{{ member.displayName }}</b>
              <small>{{ member.role === "owner" ? "提问者" : member.role === "requested" ? "请求加入" : "参与者" }}</small>
            </div>
            <div v-if="whyCurrentTopic.memberRole === 'owner' && member.role === 'requested'" class="why-request-actions">
              <button class="mini-btn" @click="approveWhyRequest(member.accountId, true)">同意</button>
              <button class="mini-btn secondary" @click="approveWhyRequest(member.accountId, false)">拒绝</button>
            </div>
          </article>
        </template>
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

    <section v-if="pendingPrayerUpdate" class="modal-shell" @click.self="closePrayerUpdateEditor">
      <form class="small-modal prayer-update-modal" @submit.prevent="publishPrayerUpdate">
        <header class="modal-head">
          <strong>更新代祷最新动态</strong>
          <button class="icon-btn" type="button" @click="closePrayerUpdateEditor" aria-label="关闭最新动态编辑"><X :size="20" /></button>
        </header>
        <div class="form-grid modal-form">
          <p class="modal-help">可直接修改代祷内容；若某部分已经无需代祷或已蒙应允，选中文字后点“划去选中文字”。发布后会更新原卡片，并作为最新消息推送给全员。</p>
          <label>代祷内容</label>
          <div class="prayer-update-toolbar">
            <button class="mini-btn secondary" type="button" :disabled="prayerUpdateBusy" @click="strikeSelectedPrayerUpdateText">划去选中文字</button>
            <small>也可手动输入 ~~文字~~</small>
          </div>
          <textarea ref="prayerUpdateTextarea" v-model="prayerUpdateContent" rows="9" placeholder="修改最新动态或补充代祷内容"></textarea>
          <p v-if="prayerUpdateError" class="form-error">{{ prayerUpdateError }}</p>
          <div class="confirm-actions">
            <button class="mini-btn secondary" type="button" :disabled="prayerUpdateBusy" @click="closePrayerUpdateEditor">取消</button>
            <button class="primary-btn" type="submit" :disabled="prayerUpdateBusy || !prayerUpdateCanPublish">
              {{ prayerUpdateBusy ? "正在更新..." : "更新并推送" }}
            </button>
          </div>
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

    <section v-if="pendingMessageActions" class="tap-popover message-actions-popover" :style="messageActionPromptStyle" data-message-actions-popover>
      <div class="tap-popover-card">
        <div class="message-actions-list">
          <button type="button" @click="quoteActionMessage"><MessageSquareQuote :size="15" />引用</button>
          <button v-if="canRecallMessage(pendingMessageActions)" type="button" class="danger" @click="recallActionMessage($event)"><Trash2 :size="15" />撤回</button>
          <button type="button" @click="selectActionMessageText"><CheckCircle2 :size="15" />选择文字</button>
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
        <button v-if="previewMessage.type === 'image'" class="image-preview-download" @click.stop="downloadPreviewImage" aria-label="下载图片"><Download :size="20" /></button>
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
          <img v-if="previewMessage.type === 'image'" class="media-preview-image" :style="imagePreviewTransform()" :src="previewImageSrc()" alt="图片预览" draggable="false" />
          <audio v-else-if="isAudioMessage(previewMessage)" class="media-preview-audio" :src="fileUrl(previewMessage)" controls autoplay preload="metadata"></audio>
          <video v-else-if="isVideoMessage(previewMessage)" class="media-preview-video" :src="fileUrl(previewMessage)" controls autoplay playsinline preload="metadata"></video>
          <iframe v-else-if="isPdfMessage(previewMessage)" class="media-preview-frame" :src="fileUrl(previewMessage)" title="文档预览"></iframe>
        </div>
      </div>
    </section>

    <section v-if="showPinnedEditor" class="modal-shell">
      <div class="settings-modal pinned-editor-modal">
        <header class="modal-head">
          <strong>编辑置顶消息</strong>
          <button class="icon-btn" @click="showPinnedEditor = false" aria-label="关闭置顶编辑"><X :size="20" /></button>
        </header>
        <div class="form-grid">
          <label>标题（可选）</label>
          <input v-model="pinnedEditTitle" placeholder="置顶消息" />
          <label>正文</label>
          <div class="pinned-editor-blocks">
            <article v-for="(block, index) in pinnedEditBlocks" :key="block.id" class="pinned-editor-block">
              <template v-if="block.type === 'text'">
                <textarea v-model="block.text" rows="5" placeholder="置顶正文"></textarea>
              </template>
              <template v-else>
                <img v-if="block.type === 'image'" :src="pinnedFileUrl(block)" alt="" />
                <div v-else class="file-card pinned-file-card">
                  <FileUp :size="24" />
                  <span>
                    <strong>{{ block.fileName }}</strong>
                    <small>{{ block.fileSize ? compactBytes(block.fileSize) : "文件" }}</small>
                  </span>
                </div>
              </template>
              <button class="mini-btn danger-action" @click="removePinnedBlock(index)"><Trash2 :size="15" />删除此块</button>
            </article>
          </div>
          <button class="mini-btn secondary" @click="addPinnedTextBlock">添加文字</button>
          <p v-if="pinnedEditMsg" class="admin-msg">{{ pinnedEditMsg }}</p>
          <div class="confirm-actions">
            <button class="mini-btn danger-action" @click="clearPinned">撤下置顶</button>
            <button class="mini-btn secondary" @click="showPinnedEditor = false">取消</button>
            <button class="primary-btn" @click="savePinnedEditor"><Save :size="16" />保存</button>
          </div>
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

    <section v-if="notificationPromptOpen" class="modal-shell" @click.self="notificationPromptOpen = false">
      <div class="small-modal notification-check-modal">
        <header class="modal-head">
          <strong>通知体检</strong>
          <button class="icon-btn" @click="notificationPromptOpen = false" aria-label="关闭通知体检"><X :size="18" /></button>
        </header>
        <div class="notification-check-body">
          <span class="notification-check-bell" :class="`level-${notificationNudgeLevel}`" aria-hidden="true">{{ notificationNudgeIcon }}</span>
          <div>
            <strong>{{ notificationEnabled ? "通知已经开启" : "还没有开启通知" }}</strong>
            <small>权限：{{ notificationPermissionLabel }}</small>
          </div>
          <p>{{ notificationPromptHint }}</p>
          <div class="notification-check-actions">
            <button v-if="notificationEnabled" class="primary-btn" :disabled="notificationBusy" @click="sendTestNotification"><Bell :size="16" />发送测试通知</button>
            <button v-else class="primary-btn" :disabled="notificationBusy || !notificationSupported || notificationPermission === 'denied'" @click="enableNotifications"><Bell :size="16" />开启通知</button>
            <button class="mini-btn secondary" :disabled="notificationBusy" @click="openSettings('notifications'); notificationPromptOpen = false">更多设置</button>
          </div>
          <p v-if="notificationMsg" class="settings-note">{{ notificationMsg }}</p>
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
          <button :class="{ active: settingsTab === 'bible' }" @click="settingsTab = 'bible'"><BookOpen :size="16" />经文</button>
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

          <section v-if="settingsTab === 'bible'" class="form-grid">
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
              <div v-if="notificationEnabled" class="notification-card-actions">
                <button class="mini-btn" :disabled="notificationBusy" @click="sendTestNotification"><Bell :size="15" />测试</button>
                <button class="mini-btn secondary" :disabled="notificationBusy" @click="disableNotifications"><BellOff :size="15" />关闭</button>
              </div>
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
          <div class="modal-head-actions">
            <button class="mini-btn secondary" @click="openLoginLogPage"><Monitor :size="15" />登录记录</button>
            <button class="icon-btn" @click="closeAdminPanel" aria-label="关闭管理"><X :size="20" /></button>
          </div>
        </header>
        <nav class="tabs">
          <button :class="{ active: adminTab === 'pin' }" @click="switchAdminTab('pin')"><Pin :size="16" />置顶</button>
          <button :class="{ active: adminTab === 'users' }" @click="switchAdminTab('users')"><Users :size="16" />用户</button>
          <button :class="{ active: adminTab === 'channels' }" @click="switchAdminTab('channels')"><Menu :size="16" />频道</button>
          <button :class="{ active: adminTab === 'virtuals' }" @click="switchAdminTab('virtuals')"><Bot :size="16" />虚拟角色</button>
          <button :class="{ active: adminTab === 'appearance' }" @click="switchAdminTab('appearance')"><Palette :size="16" />外观</button>
          <button :class="{ active: adminTab === 'data' }" @click="switchAdminTab('data')"><Download :size="16" />数据</button>
          <button :class="{ active: adminTab === 'release' }" @click="switchAdminTab('release')"><Info :size="16" />版本</button>
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
                <label class="avatar upload-avatar-trigger" :aria-label="`上传 ${account.displayName} 的头像`" title="点击上传头像">
                  <img v-if="avatarUrl(account.avatarPath)" :src="avatarUrl(account.avatarPath)" alt="" />
                  <span v-else>{{ avatarText(account.displayName) }}</span>
                  <input class="hidden" type="file" accept="image/*" @change="uploadAccountAvatar(account, $event)" />
                </label>
                <div class="user-admin-main">
                  <strong>@{{ account.username }}</strong>
                  <div class="user-admin-edit-grid">
                    <div class="user-admin-fields">
                      <input v-model="accountEdits[account.id].displayName" placeholder="昵称" />
                      <input v-model="accountEdits[account.id].password" placeholder="重置密码，留空不改" type="password" />
                    </div>
                    <div class="user-admin-flags">
                      <label class="check-row"><input v-model="accountEdits[account.id].isAdmin" type="checkbox" /> 管理员</label>
                      <label class="check-row"><input v-model="accountEdits[account.id].canPinMessages" type="checkbox" /> 户部尚书（默认频道置顶）</label>
                    </div>
                  </div>
                </div>
                <div class="user-admin-actions">
                  <button class="mini-btn" @click="updateAccount(account)">保存</button>
                </div>
              </article>
            </div>
          </section>

          <section v-if="adminTab === 'channels'" class="form-grid">
            <label>新增频道</label>
            <input v-model="newChannel.name" placeholder="频道名" />
            <input v-model="newChannel.description" placeholder="描述" />
            <label class="check-row check-row-inline"><input v-model="newChannel.isPrivate" type="checkbox" /> <span>私密频道</span></label>
            <button class="primary-btn" @click="addChannel">创建频道</button>
            <label>现有频道</label>
            <div class="channel-admin-list">
              <template v-for="channel in store.channels" :key="channel.id">
                <article v-if="channelEdits[channel.id]" class="channel-admin-row">
                  <label class="channel-icon-admin upload-icon-trigger" :aria-label="`上传 ${channel.name} 的频道图标`" title="点击上传图标">
                    <img :src="channelIconUrl(channel)" alt="" />
                    <input class="hidden" type="file" accept="image/*" @change="uploadChannelIcon(channel, $event)" />
                  </label>
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

          <section v-if="adminTab === 'appearance'" class="appearance-admin-layout">
            <div class="appearance-save-bar">
              <div>
                <b>外观草稿</b>
                <small>{{ appearanceHasDraftChanges ? "有未保存更改，保存后才会对聊天室生效。" : "所有外观设置都已保存。" }}</small>
              </div>
              <div class="appearance-save-actions">
                <button class="mini-btn secondary appearance-mobile-preview-btn" @click="appearancePreviewOpen = true">预览</button>
                <button class="primary-btn" :class="{ attention: appearanceHasDraftChanges }" @click="saveLoginAppearance"><Save :size="15" />保存外观</button>
              </div>
            </div>

            <nav class="appearance-section-nav">
              <button
                v-for="section in appearanceSections"
                :key="section.id"
                :class="{ active: appearanceSection === section.id }"
                @click="appearanceSection = section.id"
              >
                <b>{{ section.label }}</b>
                <small>{{ section.description }}</small>
              </button>
            </nav>

            <div class="appearance-editor-panel form-grid">
              <template v-if="appearanceSection === 'brand'">
                <label class="inline-field-row">
                  <span>浏览器标签页</span>
                  <input v-model="loginAppearanceEdit.appTitle" maxlength="80" placeholder="浏览器标签页标题" aria-label="浏览器标签页标题" />
                </label>
                <div class="appearance-image-control">
                  <button class="appearance-image-preview-button login-icon-preview" @click="openAppearanceImagePicker('appIconPath', '选择标签页图标', '适合方形或接近方形的小图。')" aria-label="选择标签页图标">
                    <img :src="appearanceDraftIcon" alt="" />
                  </button>
                  <div>
                    <strong>标签页图标</strong>
                    <small>点击图标选择图片；用于浏览器标签、收藏夹和应用入口。</small>
                  </div>
                </div>
              </template>

              <template v-else-if="appearanceSection === 'login'">
                <label>登录页内容</label>
                <div class="login-brand-grid">
                  <input v-model="loginAppearanceEdit.loginTitle" maxlength="80" placeholder="登录页标题" aria-label="登录页标题" />
                  <input v-model="loginAppearanceEdit.loginSubtitle" maxlength="160" placeholder="登录页副标题" aria-label="登录页副标题" />
                </div>
                <div class="check-grid login-visibility-options">
                  <label class="check-row"><input v-model="loginAppearanceEdit.loginShowIcon" type="checkbox" /> 显示登录页图标</label>
                  <label class="check-row"><input v-model="loginAppearanceEdit.loginShowSubtitle" type="checkbox" /> 显示登录页副标题</label>
                </div>

                <label>登录区域位置</label>
                <div class="segmented-row login-position-options">
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

                <label>登录页图标与背景</label>
                <div class="appearance-image-stack">
                  <div class="appearance-image-control">
                    <button class="appearance-image-preview-button login-icon-preview" @click="openAppearanceImagePicker('loginIconPath', '选择登录页图标', '登录卡片中的品牌图标，建议方形图片。')" aria-label="选择登录页图标">
                      <img :src="appearanceDraftLoginIcon" alt="" />
                    </button>
                    <div>
                      <strong>登录页图标</strong>
                      <small>{{ loginAppearanceEdit.loginIconPath || "使用默认图标，点击图标更换" }}</small>
                    </div>
                  </div>
                  <div class="appearance-image-control">
                    <button class="appearance-image-preview-button login-background-preview" :style="appearancePreviewLoginStyle" @click="openAppearanceImagePicker('loginBackgroundPath', '选择登录页背景', '适合横向或竖向大图，可在这里设置显示方式。', 'loginBackgroundFit')" aria-label="选择登录页背景"></button>
                    <div>
                      <strong>登录页背景</strong>
                      <small>{{ loginAppearanceEdit.loginBackgroundPath || "未设置背景图，点击预览更换" }}</small>
                    </div>
                    <select v-model="loginAppearanceEdit.loginBackgroundFit" aria-label="登录页背景显示方式">
                      <option v-for="option in wallpaperFitOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                    </select>
                  </div>
                </div>

                <label>登录入口</label>
                <label class="check-row"><input v-model="loginAppearanceEdit.registrationEnabled" type="checkbox" /> 开放注册</label>
              </template>

              <template v-else-if="appearanceSection === 'chat'">
                <label>聊天室壁纸</label>
                <div class="appearance-image-control">
                  <button class="appearance-image-preview-button login-background-preview chat" :style="appearancePreviewChatStyle" @click="openAppearanceImagePicker('wallpaperPath', '选择聊天室壁纸', '聊天消息后方的背景图，可选择填满、完整显示、拉伸或平铺。', 'wallpaperFit')" aria-label="选择聊天室壁纸"></button>
                  <div>
                    <strong>聊天区背景图</strong>
                    <small>{{ loginAppearanceEdit.wallpaperPath || "未设置壁纸，点击预览更换" }}</small>
                  </div>
                  <select v-model="loginAppearanceEdit.wallpaperFit" aria-label="聊天室壁纸显示方式">
                    <option v-for="option in wallpaperFitOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                  </select>
                </div>
              </template>

              <template v-else-if="appearanceSection === 'themes'">
                <label>主题编辑</label>
                <div class="theme-editor-head">
                  <input v-model="customThemeEdit.name" maxlength="24" placeholder="主题名称" />
                  <button class="mini-btn secondary" @click="resetThemeEditor">用当前主题填充</button>
                </div>
                <div class="color-grid">
                  <label v-for="field in primaryColorFields" :key="field.key" class="color-row">
                    <span>{{ field.label }}</span>
                    <input v-model="customThemeEdit.palette[field.key]" type="color" />
                    <code>{{ customThemeEdit.palette[field.key] }}</code>
                  </label>
                </div>
                <button class="mini-btn secondary" @click="appearanceThemeAdvancedOpen = !appearanceThemeAdvancedOpen">{{ appearanceThemeAdvancedOpen ? "收起更多颜色" : "更多颜色" }}</button>
                <div v-if="appearanceThemeAdvancedOpen" class="color-grid">
                  <label v-for="field in appearanceAdvancedColorFields" :key="field.key" class="color-row">
                    <span>{{ field.label }}</span>
                    <input v-model="customThemeEdit.palette[field.key]" type="color" />
                    <code>{{ customThemeEdit.palette[field.key] }}</code>
                  </label>
                </div>
                <button class="primary-btn" @click="saveCustomTheme"><Save :size="15" />加入 / 更新主题草稿</button>

                <label>可选主题</label>
                <div class="theme-admin-list">
                  <article v-for="theme in appearanceThemeOptions" :key="theme.id" class="theme-admin-row">
                    <span class="theme-admin-swatch" :style="themeSwatchStyle(theme)"></span>
                    <b>{{ theme.name }}</b>
                    <small>{{ customThemeDraftIds.has(theme.id) ? "自定义" : "内置" }}</small>
                    <button class="mini-btn secondary" @click="editTheme(theme)">编辑</button>
                    <button v-if="customThemeDraftIds.has(theme.id)" class="mini-btn danger-action" @click="deleteCustomTheme(theme)"><Trash2 :size="14" />删除</button>
                  </article>
                </div>
              </template>

              <template v-else>
                <label>闪动节奏</label>
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
                  </div>
                </div>
              </template>
            </div>

            <aside class="appearance-preview-panel" :class="{ open: appearancePreviewOpen }">
              <header>
                <div>
                  <b>{{ activeAppearanceSection.label }}预览</b>
                  <small>预览跟随当前草稿变化。</small>
                </div>
                <button class="icon-btn appearance-preview-close" @click="appearancePreviewOpen = false" aria-label="关闭预览"><X :size="18" /></button>
                <span>{{ appearanceHasDraftChanges ? "未保存" : "已保存" }}</span>
              </header>
              <div class="appearance-preview-grid" :class="`preview-${appearanceSection}`">
                <template v-if="appearanceSection === 'brand'">
                  <div class="appearance-preview-block wide">
                    <strong>浏览器标签</strong>
                    <div class="appearance-device desktop">
                      <div class="preview-browser-bar large"><img :src="appearanceDraftIcon" alt="" /><span>{{ loginAppearanceEdit.appTitle || "Team Chat" }}</span></div>
                      <div class="appearance-brand-preview">
                        <img :src="appearanceDraftIcon" alt="" />
                        <b>{{ loginAppearanceEdit.appTitle || "Team Chat" }}</b>
                        <small>浏览器标签页、收藏夹和安装后的应用入口会使用这组品牌信息。</small>
                      </div>
                    </div>
                  </div>
                </template>

                <template v-else-if="appearanceSection === 'login'">
                  <div class="appearance-preview-block">
                    <strong>桌面登录页</strong>
                    <div class="appearance-device desktop">
                      <div class="preview-browser-bar"><img :src="appearanceDraftIcon" alt="" /><span>{{ loginAppearanceEdit.appTitle || "Team Chat" }}</span></div>
                      <div class="appearance-login-preview" :class="`login-position-${loginAppearanceEdit.loginFormPosition}`" :style="appearancePreviewLoginStyle">
                        <div class="appearance-login-card">
                          <img v-if="loginAppearanceEdit.loginShowIcon" :src="appearanceDraftLoginIcon" alt="" />
                          <b>{{ loginAppearanceEdit.loginTitle || "Team Chat" }}</b>
                          <small v-if="loginAppearanceEdit.loginShowSubtitle">{{ loginAppearanceEdit.loginSubtitle || "轻快、稳定的团队聊天。" }}</small>
                          <span>{{ loginAppearanceEdit.registrationEnabled ? "登录 / 注册" : "登录" }}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div class="appearance-preview-block">
                    <strong>移动登录页</strong>
                    <div class="appearance-device mobile">
                      <div class="preview-browser-bar"><img :src="appearanceDraftIcon" alt="" /><span>{{ loginAppearanceEdit.appTitle || "Team Chat" }}</span></div>
                      <div class="appearance-login-preview" :class="`login-position-${loginAppearanceEdit.loginFormPosition}`" :style="appearancePreviewLoginStyle">
                        <div class="appearance-login-card">
                          <img v-if="loginAppearanceEdit.loginShowIcon" :src="appearanceDraftLoginIcon" alt="" />
                          <b>{{ loginAppearanceEdit.loginTitle || "Team Chat" }}</b>
                          <small v-if="loginAppearanceEdit.loginShowSubtitle">{{ loginAppearanceEdit.loginSubtitle || "轻快、稳定的团队聊天。" }}</small>
                          <span>{{ loginAppearanceEdit.registrationEnabled ? "登录 / 注册" : "登录" }}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </template>

                <template v-else-if="appearanceSection === 'chat'">
                  <div class="appearance-preview-block">
                    <strong>桌面聊天室</strong>
                    <div class="appearance-device desktop">
                      <div class="appearance-chat-preview" :style="appearancePreviewChatStyle">
                        <div class="appearance-chat-sidebar"><b>频道</b><span>主聊天室</span><span>代祷事项</span></div>
                        <div class="appearance-chat-main">
                          <div class="appearance-chat-top">主聊天室</div>
                          <p class="preview-message other">这是别人发来的消息。</p>
                          <p class="preview-message mine">这是自己的消息。</p>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div class="appearance-preview-block">
                    <strong>移动聊天室</strong>
                    <div class="appearance-device mobile">
                      <div class="appearance-chat-preview mobile-chat" :style="appearancePreviewChatStyle">
                        <div class="appearance-chat-main">
                          <div class="appearance-chat-top">主聊天室</div>
                          <p class="preview-message other">移动端消息</p>
                          <p class="preview-message mine">自己的回复</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </template>

                <template v-else-if="appearanceSection === 'themes'">
                  <div class="appearance-preview-block wide">
                    <strong>主题效果</strong>
                    <div class="appearance-device desktop">
                      <div class="appearance-chat-preview theme-preview" :style="appearanceThemePreviewStyle">
                        <div class="appearance-chat-sidebar"><b>频道</b><span>主聊天室</span><span>同工沟通</span></div>
                        <div class="appearance-chat-main">
                          <div class="appearance-chat-top">主聊天室</div>
                          <p class="preview-message other">对方消息颜色</p>
                          <p class="preview-message mine">我的消息颜色</p>
                          <button class="primary-btn">按钮预览</button>
                        </div>
                      </div>
                    </div>
                  </div>
                </template>

                <template v-else>
                  <div class="appearance-preview-block wide">
                    <strong>闪动消息</strong>
                    <div class="appearance-device desktop">
                      <div class="appearance-chat-preview flash-preview">
                        <div class="appearance-chat-main">
                          <div class="appearance-chat-top">主聊天室</div>
                          <p class="preview-message mine flash" :style="appearancePreviewFlashStyle">/闪动 预览消息</p>
                          <small>颜色和过渡会按草稿实时变化。</small>
                        </div>
                      </div>
                    </div>
                  </div>
                </template>
              </div>
            </aside>
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
            <div class="data-toolbar attachment-toolbar">
              <button class="mini-btn secondary" @click="toggleAllAttachments">{{ allAttachmentsSelected ? "取消全选" : "全选" }}</button>
              <button class="mini-btn secondary" @click="loadAdminAttachments"><RotateCcw :size="15" />刷新</button>
              <button class="mini-btn danger-action" :disabled="!adminAttachments.length" @click="deleteAllAdminAttachments"><Trash2 :size="15" />删除全部附件</button>
            </div>
            <div class="admin-data-list attachment-grid">
              <article v-for="attachment in adminAttachments" :key="attachment.id" class="admin-data-row attachment-row">
                <label class="check-cell">
                  <input v-model="selectedAttachmentIds" type="checkbox" :value="attachment.id" />
                </label>
                <div class="attachment-preview" :class="{ empty: !attachment.url || !isImageAttachment(attachment) }">
                  <img v-if="attachment.url && isImageAttachment(attachment)" :src="attachment.url" alt="" />
                  <FileUp v-else :size="24" />
                </div>
                <div class="admin-data-main">
                  <strong>{{ attachmentKindLabel(attachment.kind) }} · {{ attachment.label }}</strong>
                  <span>{{ attachmentUsage(attachment) }}</span>
                  <small>{{ compactBytes(attachment.size) }} · {{ adminDate(attachment.createdAt) }} · {{ attachment.fileName }}</small>
                </div>
              </article>
              <p v-if="!adminAttachments.length" class="empty-note">没有可管理的附件</p>
            </div>
            <div class="attachment-bulk-actions">
              <span>已选 {{ selectedAttachmentCount }} 个附件</span>
              <button class="mini-btn secondary" :disabled="!selectedCompressibleAttachmentCount" @click="compressAdminAttachments(selectedCompressibleAttachmentIds)">
                <WandSparkles :size="15" />压缩 {{ selectedCompressibleAttachmentCount }}
              </button>
              <button class="mini-btn danger-action" :disabled="!selectedAttachmentCount" @click="deleteAdminAttachments(selectedAttachmentIds)"><Trash2 :size="15" />删除 {{ selectedAttachmentCount }}</button>
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
                <small v-if="updateCheck || serverVersion?.update">
                  {{ updateCheck?.repo || serverVersion?.update?.repoUrl || "GitHub 仓库" }} · {{ updateCheck?.branch || serverVersion?.update?.branch || "main" }} · {{ updateRestartModeLabel }}
                </small>
              </div>
              <div class="release-update-actions">
                <button class="mini-btn secondary" :disabled="updateBusy" @click="checkForUpdates"><RotateCcw :size="15" />检查</button>
                <button class="mini-btn" :disabled="updateStartDisabled" @click="startServerUpdate">更新</button>
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

    <section v-if="appearanceImagePicker" class="modal-shell appearance-picker-shell" @click.self="closeAppearanceImagePicker">
      <div class="small-modal appearance-picker-modal">
        <header class="modal-head">
          <strong>{{ appearanceImagePicker.title }}</strong>
          <button class="icon-btn" @click="closeAppearanceImagePicker" aria-label="关闭图片选择"><X :size="20" /></button>
        </header>
        <div class="appearance-picker-body">
          <p class="settings-note">{{ appearanceImagePicker.hint }}</p>
          <div class="appearance-picker-actions">
            <label class="primary-btn">
              <Upload :size="16" />上传新图片
              <input class="hidden" type="file" accept="image/*" @change="uploadAppearanceImageForPicker" />
            </label>
            <button class="mini-btn secondary" :disabled="!appearanceImagePickerSelection" @click="clearAppearancePickerImage">移除当前</button>
            <select v-if="appearanceImagePicker.fitField" v-model="loginAppearanceEdit[appearanceImagePicker.fitField]" aria-label="图片显示方式">
              <option v-for="option in wallpaperFitOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </div>
          <div v-if="appearanceImagePickerSelection" class="appearance-picker-current">
            <img :src="wallpaperUrl(appearanceImagePickerSelection)" alt="" />
            <div>
              <b>当前草稿</b>
              <small>{{ appearanceImagePickerSelection }}<template v-if="appearanceImagePickerFit"> · {{ wallpaperFitOptions.find((option) => option.value === appearanceImagePickerFit)?.label }}</template></small>
            </div>
          </div>
          <div v-if="backgroundAttachmentOptions.length" class="appearance-image-grid picker-grid">
            <button
              v-for="image in backgroundAttachmentOptions"
              :key="image.id"
              class="appearance-image-card"
              :class="{ active: image.fileName === appearanceImagePickerSelection }"
              @click="selectAppearanceImage(image.fileName)"
            >
              <img :src="image.url" alt="" />
              <span>
                <b>{{ image.label }}</b>
                <small>{{ backgroundAttachmentLabel(image) }}</small>
              </span>
            </button>
          </div>
          <p v-else class="empty-note">还没有可选图片。上传后会自动选中为当前草稿。</p>
        </div>
      </div>
    </section>
  </main>
</template>
