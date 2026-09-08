<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  AudioLines,
  AtSign,
  ArrowDown,
  ArrowUp,
  Bell,
  Bookmark,
  BookOpen,
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CloudRain,
  Droplet,
  Download,
  DoorOpen,
  Ellipsis,
  FileText,
  FileUp,
  CheckCircle2,
  CircleOff,
  HeartHandshake,
  Heart,
  Image as ImageIcon,
  LockKeyhole,
  LogOut,
  MessageSquareQuote,
  MessageCircle,
  Mic,
  Monitor,
  Pause,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  Pin,
  Plane,
  Play,
  Plus,
  RotateCcw,
  Save,
  Send,
  Smartphone,
  Settings,
  Square,
  Tablet,
  Trash2,
  ThumbsUp,
  Upload,
  Users,
  Vibrate,
  WandSparkles,
  X,
  Library
} from "lucide-vue-next";
import type {
  AccountDTO,
  BibleFavoriteDTO,
  BibleFavoriteKeyDTO,
  BibleLookupDTO,
  BiblePreferencesDTO,
  BibleReaderPresenceDTO,
  BookReaderPresenceDTO,
  BibleOutputFormat,
  BibleReferenceLabelMode,
  BibleCombinedPassageMode,
  BibleQuotationStyle,
  BibleSessionPayloadDTO,
  ChannelDTO,
  FavoriteMessageDTO,
  MessageReactionsDTO,
  FlashEffectSettingsDTO,
  FriendListenerDTO,
  FriendProgramDTO,
  MessageDTO,
  MessageEffect,
  MessageEffectPayload,
  MusicListenerDTO,
  MusicPlaylistDTO,
  MusicPlaylistSourceKind,
  MusicScoreDTO,
  MusicScorePageDTO,
  MusicTrackDTO,
  PinnedBodyDTO,
  PinnedContentBlockDTO,
  UpdateCheckDTO,
  UpdateStatusDTO,
  VersionDTO,
  ThemeDTO,
  ThemePaletteDTO,
  ActorDTO
} from "@shared/types";
import { api, authHeaders, getToken, joinReception, login, register } from "./api";
import { parseBibleSessionPayload } from "./bibleSessionShare";
import { extractBibleReferenceMatches, extractBibleReferencesFromText } from "./bibleReferences";
import { groupBibleFavoritePassages, type BibleFavoritePassage } from "./bibleFavorites";
import { compactBytes } from "./time";
import { isForwardableMessage } from "./messageForward";
import { useChatStore } from "./store";
import ParallaxBackground from "./components/ParallaxBackground.vue";
import OopsTextPhysicsLayer from "./components/OopsTextPhysicsLayer.vue";
import InlineAudioPlayer from "./components/InlineAudioPlayer.vue";
import OverflowMarquee from "./components/OverflowMarquee.vue";
import ActivityTicker from "./components/ActivityTicker.vue";
import AppMenu from "./components/AppMenu.vue";
import AppMenuItem from "./components/AppMenuItem.vue";
import { useVoiceRecording } from "./features/voice/useVoiceRecording";
import { useUploads } from "./features/uploads/useUploads";
import { messageEffect, useComposer } from "./features/composer/useComposer";
import { useAuth } from "./features/auth/useAuth";
import { useBibleWorkspaceIntegration } from "./features/bible/useBibleWorkspaceIntegration";
import { useMusicLibraryIntegration } from "./features/music/useMusicLibraryIntegration";
import { useRainEffect } from "./features/effects/useRainEffect";
import { useDripEffect } from "./features/effects/useDripEffect";
import { useGooeyDripEffect } from "./features/effects/useGooeyDripEffect";
import { useWaterRippleEffect } from "./features/effects/useWaterRippleEffect";
import { useMessageEffectVisibility } from "./features/effects/useMessageEffectVisibility";
import { activityTickerItems } from "./activityTicker";
import { shouldAdvanceWallpaperPan, shouldRenderMessageEffect, shouldRunFlashEffectTimer, shouldTriggerIncomingRainEffect } from "./animationPolicy";
import {
  calculateVirtualWindow,
  scrollTopForVirtualAnchor,
  virtualItemOffset,
  type VirtualTimelineAnchor
} from "./messageVirtualization";
import { imageDimensionsFromPayload } from "@shared/imageDimensions";
import { cleanParallaxSpeed, parallaxAssetUrl, parallaxKit } from "./parallax";
import {
  advanceWallpaperPan,
  cleanWallpaperPanDirection,
  cleanWallpaperPanSpeed,
  initialWallpaperPanOffset,
  wallpaperPanBounds,
  wallpaperPanLayerPresentation,
  type WallpaperPanBounds,
  type WallpaperPanDirection
} from "@shared/wallpaperPan";
import { MUSIC_PANEL_FONT_SIZE_MAX, MUSIC_PANEL_FONT_SIZE_MIN, cleanMusicPanelFontSize } from "@shared/musicPlayback";
import {
  cleanComposerPromptAppearSeconds,
  cleanComposerPromptDisappearSeconds,
  cleanComposerPromptGapSeconds,
  cleanComposerPromptIntervalSeconds,
  composerPromptCharTiming
} from "@shared/composerPrompts";
import {
  canEditChannel,
  canLeaveChannel,
  canOpenChannelSettings,
  canSubmitChannelDraft
} from "./channelManagement";
import { memberRoleLabel } from "./memberManagement";
import { composerHeightForContent } from "./composerLayout";
import { composerDraftAfterSend, isComposerSendKey, isTouchDevice, useMessageSender } from "./messageSending";
import { wallpaperLabelTone, wallpaperLabelToneFromPixels, type WallpaperLabelTone } from "./wallpaperContrast";
import { favoriteNotificationToTopNotice, likeNotificationToTopNotice } from "./likeNotification";
import {
  NEWEST_POSITION_THRESHOLD,
  NEWEST_READ_POSITION,
  newestPositionForSessionEntry,
  normalizeSavedReadPosition,
  shouldFollowMessageListChange,
  shouldRestoreNewestPosition,
  type SavedReadPosition
} from "./readPosition";
import {
  createChatScrollIntentTracker,
  isChatViewportAtNewest,
  newestChatReadAnchor,
  shouldApplyChatReadAnchor,
  type ChatReadAnchor
} from "./chatScrollStability";
import { formatUnreadCount } from "./unread";
import { flushPendingPersists } from "./messageWindowCache";
import { APP_VERSION, RELEASE_DATE, RELEASE_DEVELOPER, RELEASE_NOTES } from "@shared/release";
import type { ActivityLogCategory } from "@shared/activityLog";
import {
  musicMentionTokenAtCursor,
  shouldKeepMusicScoreForTrack,
  shouldShowMusicScoreTrigger,
  sortMusicTracks
} from "./musicPlayer";
import { useMusicPlayer } from "./features/music/useMusicPlayer";
import { useMusicSleepTimer } from "./features/music/useMusicSleepTimer";
import type { MusicManagerFocus } from "./features/music/useMusicLibrary";
import { useFriendPlayer } from "./features/friend/useFriendPlayer";
import { getSharedExclusiveAudio, stopAllMessageAudioPlayback } from "./features/audio/messageAudioPlayback";
import { useComposerPlaceholder } from "./features/composer/useComposerPlaceholder";
import ChainCreateDialog from "./features/chain/ChainCreateDialog.vue";
import ChainJoinPopover from "./features/chain/ChainJoinPopover.vue";
import { chainParticipantProject, chainPayload, chainRequiresSelection } from "./features/chain/chain";
import { useChain } from "./features/chain/useChain";
import { useSermon } from "./features/sermon/useSermon";

import {
  TIMELINE_SCROLL_IDLE_MS,
  VIRTUAL_TIMELINE_BACKWARD_VIEWPORTS,
  VIRTUAL_TIMELINE_FORWARD_OVERSCAN,
  VIRTUAL_TIMELINE_MIN_BACKWARD_OVERSCAN,
  useVirtualTimeline,
  type TimelineRow
} from "./features/timeline/useVirtualTimeline";
import {
  chainTopicRichTextSegments,
  escapeHtmlText,
  isMarkdownMessage,
  messageBibleReferenceScope,
  messagePayloadRecord,
  musicMentionPayload,
  normalizeMessageUrl,
  previewSiteName,
  replyPreviewText,
  trimUrlPunctuation
} from "./features/messages/messageRendering";
import { useMessageRendering, type MentionToast } from "./features/messages/useMessageRendering";
import { useMusicMentionRendering } from "./features/messages/useMusicMentionRendering";
import { useAdminTools } from "./features/admin/useAdminTools";
import { useAiSettings } from "./features/admin/useAiSettings";
import { useAccountSettings } from "./features/settings/useAccountSettings";
import type { SettingsTab } from "./features/settings/settingsTabs";
import { usePrayer } from "./features/prayer/usePrayer";
import { useChannelManagement } from "./features/channels/useChannelManagement";
import { useMessageActions } from "./features/messages/useMessageActions";
import { useMessageForward } from "./features/messages/useMessageForward";
import { useMediaPreview, type PinnedMediaBlock } from "./features/messages/useMediaPreview";
import { useMessageRecall } from "./features/messages/useMessageRecall";
import { useMessageSelection } from "./features/messages/useMessageSelection";
import { builtInThemes, type WallpaperFit } from "./features/admin/useAppearanceSettings";

const store = useChatStore();
const {
  pending: messageSendPending,
  statusMessage: messageSendStatus,
  send: sendMessage,
  clearStatus: clearMessageSendStatus
} = useMessageSender({ getSocket: () => store.socket });
// Heavy or rarely-opened surfaces load on first use instead of inflating the
// entry chunk (PdfViewer/PdfScoreInline pull in pdfjs-dist; the music manager
// and Bible workspace are the largest feature components).
const PdfViewer = defineAsyncComponent(() => import("./components/PdfViewer.vue"));
const PdfScoreInline = defineAsyncComponent(() => import("./components/PdfScoreInline.vue"));
const BibleWorkspace = defineAsyncComponent(() => import("./components/BibleWorkspace.vue"));
const BookWorkspace = defineAsyncComponent(() => import("./components/BookWorkspace.vue"));
const MusicLyricsHeader = defineAsyncComponent(() => import("./components/MusicLyricsHeader.vue"));
const MusicManager = defineAsyncComponent(() => import("./features/music/MusicManager.vue"));
const MusicMiniPanel = defineAsyncComponent(() => import("./features/music/MusicMiniPanel.vue"));
const FriendPrograms = defineAsyncComponent(() => import("./features/friend/FriendPrograms.vue"));
const AdminPanel = defineAsyncComponent(() => import("./features/admin/AdminPanel.vue"));
const SettingsPanel = defineAsyncComponent(() => import("./features/settings/SettingsPanel.vue"));
const ReceptionManager = defineAsyncComponent(() => import("./features/reception/ReceptionManager.vue"));
// 讲道经文相关界面全部独立分包：观众端覆盖层仅在展示激活时挂载，讲道台负一屏打开时再下载，申请卡仅在消息列表渲染到时下载。
const SermonOverlay = defineAsyncComponent(() => import("./features/sermon/SermonOverlay.vue"));
const SermonWorkspace = defineAsyncComponent(() => import("./features/sermon/SermonWorkspace.vue"));
const SermonEntryDialog = defineAsyncComponent(() => import("./features/sermon/SermonEntryDialog.vue"));
const SermonRequestCard = defineAsyncComponent(() => import("./features/sermon/SermonRequestCard.vue"));
const BibleSessionCard = defineAsyncComponent(() => import("./features/bible/BibleSessionCard.vue"));
const ChatRecordCard = defineAsyncComponent(() => import("./features/chat/ChatRecordCard.vue"));
const ChatRecordView = defineAsyncComponent(() => import("./features/chat/ChatRecordView.vue"));
// 正在讲道的预览通知常驻，体积小且时效敏感，不进异步分包。
import SermonHub from "./features/sermon/SermonHub.vue";
const receptionInviteRouteMatch = window.location.pathname.match(/^\/visit\/([A-Za-z0-9_-]{40,512})\/?$/);
const isReceptionInviteRoute = window.location.pathname === "/visit" || window.location.pathname.startsWith("/visit/");
const receptionInviteToken = receptionInviteRouteMatch?.[1] || "";
const input = ref("");
const composerFocused = ref(false);
const selectedMusicMention = ref<MusicTrackDTO | null>(null);
const composerCaret = ref(0);
const composerSuggestionIndex = ref(0);
const composerSuggestionSuppressed = ref(false);
const replyTo = ref<MessageDTO | null>(null);
const musicMentionToken = computed(() => (selectedMusicMention.value ? null : musicMentionTokenAtCursor(input.value, composerCaret.value)));
const showChannels = ref(false);
const showFavorites = ref(false);
const showBibleFavorites = ref(false);
const favoriteMessages = ref<FavoriteMessageDTO[]>([]);
const favoritesLoading = ref(false);
const showingFavoriteSurface = computed(() => showFavorites.value || showBibleFavorites.value);
const showMembers = ref(false);
const showReceptionManager = ref(false);
const channelsCollapsed = ref(false);
const membersCollapsed = ref(false);
const minMessageFontSize = 14;
const maxMessageFontSize = 40;
const defaultMessageFontSize = 15;
const newestReadPositionKey = NEWEST_READ_POSITION;
const legacyMessageFontSizes: Record<string, number> = {
  small: 14,
  standard: 15,
  large: 17,
  extra: 19
};
const messageFontSize = ref(defaultMessageFontSize);
const showChatToolsMenu = ref(false);
const musicScoreCachedUrls = ref<Record<number, string>>({});
const musicScorePreloadPromises = new Map<number, Promise<string>>();
let musicScoreCacheGeneration = 0;
const musicManagerRef = ref<InstanceType<typeof MusicManager> | null>(null);
const {
  musicTracks,
  musicPlaylists,
  musicSourceKind,
  selectedMusicPlaylistId,
  musicManagerOpen,
  musicManagerInitialFocus,
  musicPlayerExpanded,
  musicListeners,
  bibleReaders,
  bookReaders,
  friendListeners,
  friendListeningProgram,
  sortedMusicTracks,
  favoriteMusicTracks,
  toggleChatToolsMenu,
  handleMusicFavoriteUpdated,
  toggleCurrentMusicFavorite,
  loadMusicPlaylists,
  openMusicManager,
  closeMusicSurface,
  handleMusicUpdated,
  handleMusicPlaylistUpdated,
  handleMusicListeners,
  handleBookReaders,
  handleBibleReaders,
  handleFriendListeners,
  clearPresenceEmitCache,
  publishMusicListening,
  stopPublishingMusicListening,
  publishBibleReading,
  publishBookReading,
  stopPublishingBibleReading,
  stopPublishingBookReading,
  publishFriendListening,
  stopPublishingFriendListening,
  publishPresenceActivities,
  attachMusicSocket,
  stopPresenceHeartbeat
} = useMusicLibraryIntegration({
  showChatToolsMenu,
  musicManagerRef,
  isMusicPlaying: () => musicPlaying.value,
  currentTrack: () => currentMusicTrack.value,
  currentTrackId: () => currentMusicTrackId.value,
  onlyFavorites: () => musicOnlyFavorites.value,
  pause: (immediate) => pauseMusic(immediate),
  replaceCurrentTrack: (track, continuePlaying) => replaceCurrentMusicTrack(track, continuePlaying),
  handlePlaylistDeleted: (playlistId) => handleMusicPlaylistDeleted(playlistId),
  loadMusicTracks,
  onActivitySocketConnect: handleActivitySocketConnect,
  getBibleReadingActivity: () => bibleReadingActivity.value,
  getBookReadingActivity: () => bookReadingActivity.value
});
const {
  username,
  password,
  displayName,
  authMode,
  loginError,
  handleReceptionCreated,
  handleReceptionUpdated,
  handleReceptionDeleted,
  selectReceptionRoom,
  handleReceptionClosed,
  logoutApp
} = useAuth({
  initialAuthMode: isReceptionInviteRoute ? "reception" : "login",
  showReceptionManager,
  musicTracks,
  musicPlaylists,
  persistPlaybackState: () => persistMusicPlaybackState(true)
});
const {
  watchedState: sermonOverlayState,
  latestRequestDecision: sermonRequestDecision,
  joinedPresentationId: sermonJoinedPresentationId,
  refreshPresenterStatus: refreshSermonPresenterStatus
} = useSermon({ getSocket: () => store.socket });
const sermonWorkspaceOpen = ref(false);
const bookWorkspaceOpen = ref(false);
const sermonEntryOpen = ref(false);
// 首次打开后才挂载讲道台 chunk（懒加载），之后保持挂载以保留滑入滑出过渡。
const sermonWorkspaceMounted = ref(false);
const sermonDecisionNotice = ref("");
let sermonDecisionTimer: number | undefined;
const musicScoreOpen = ref(false);
const musicScoreClosing = ref(false);
const musicScoreChatCleared = ref(false);
const musicScoreStageVisible = ref(false);
const musicScoreStageClosing = ref(false);
const currentMusicScoreId = ref<number | null>(null);
const musicLyricsHeaderSuppressed = ref(false);
const MUSIC_SCORE_CHAT_DURATION_MS = 1740;
const MUSIC_SCORE_STAGE_DURATION_MS = 980;
let musicScoreTimer: number | undefined;
let musicLyricsHeaderResumeTimer: number | undefined;
let activityConnectRetryTimer: number | undefined;
const showAdmin = ref(false);
const showSettings = ref(false);
const appStarting = ref(true);
const appStartError = ref("");
const appStartCodeLines = [
  '// src/client/main.ts',
  'import { createApp } from "vue";',
  'import { createPinia } from "pinia";',
  'import App from "./App.vue";',
  'import "./styles.css";',
  '',
  'syncViewportHeight();',
  'window.visualViewport?.addEventListener("resize", syncViewportHeight);',
  'window.visualViewport?.addEventListener("scroll", syncViewportHeight);',
  '',
  'if ("serviceWorker" in navigator) {',
  '  window.addEventListener("load", () => {',
  '    navigator.serviceWorker.register(`/sw.js?v=${APP_VERSION}`, { updateViaCache: "none" }).catch(() => {});',
  '  });',
  '}',
  '',
  'createApp(App).use(createPinia()).mount("#app");',
  '',
  '// src/client/store.ts',
  'async bootstrap() {',
  '  await this.loadAppearance();',
  '  if (!getToken()) return;',
  '  if (await this.refreshCurrentAccount()) this.connectSocket();',
  '}',
  '',
  '// src/client/App.vue',
  'hydratePlayedRainEffectIds();',
  'initializeMusicAudio();',
  'document.addEventListener("visibilitychange", handleDocumentVisibilityChange);',
  'window.addEventListener("deviceorientation", handleDeviceOrientation, { passive: true });',
  'window.addEventListener("resize", handleTimelineViewportResize, { passive: true });',
  'await store.bootstrap();'
] as const;
const isLogRoute = ref(window.location.pathname === "/log");
const fileInput = ref<HTMLInputElement | null>(null);
const photoInput = ref<HTMLInputElement | null>(null);
const keepOriginalImages = ref(false);
const composerInput = ref<HTMLTextAreaElement | null>(null);
const scroller = ref<HTMLElement | null>(null);
const chatPane = ref<HTMLElement | null>(null);
const queuedMessageImagePreloads = new Set<number>();
const messageImagePreloadQueue: MessageDTO[] = [];
// Yield image-cache warming to idle time so it never competes with startup
// or message-loading requests; Safari lacks requestIdleCallback. Declared
// with the other preload state because the immediate messages watch below
// can enqueue before later function bodies are evaluated.
const scheduleImagePreload: (callback: () => void) => void =
  typeof window !== "undefined" && typeof window.requestIdleCallback === "function"
    ? (callback) => window.requestIdleCallback(callback)
    : (callback) => window.setTimeout(callback, 1200);
let timelineResizeObserver: ResizeObserver | null = null;
let timelineScrollFrame: number | undefined;
let timelineMeasurementFrame: number | undefined;
let timelineScrollIdleTimer: number | undefined;
let pendingTimelineAnchor: VirtualTimelineAnchor | null = null;
type OopsPhysicsLayerHandle = {
  start: (messageId: number, bubble: HTMLElement, textRoot: HTMLElement) => Promise<boolean>;
  restore: (messageId: number) => void;
  reset: () => void;
  isActive: (messageId: number) => boolean;
};
const oopsPhysicsLayer = ref<OopsPhysicsLayerHandle | null>(null);
const oopsActiveMessageIds = ref<Set<number>>(new Set());
const parallaxOffset = ref(0);
let lastParallaxScrollTop: number | null = null;
let pendingParallaxDelta = 0;
let parallaxFrame = 0;
const wallpaperPanOffset = ref(0);
const wallpaperPanImageWidth = ref(0);
const wallpaperPanReady = ref(false);
const wallpaperPanImage = ref<HTMLImageElement | null>(null);
const wallpaperLabelToneValue = ref<WallpaperLabelTone>("dark");
let wallpaperLabelSampleGeneration = 0;
const wallpaperPanRetryKey = ref(0);
let wallpaperPanDirection: WallpaperPanDirection = "left";
let wallpaperPanMetrics: WallpaperPanBounds | null = null;
let wallpaperPanNaturalSize: { width: number; height: number } | null = null;
let wallpaperPanResizeObserver: ResizeObserver | null = null;
let wallpaperPanRetryTimer: number | undefined;
let wallpaperPanRetryAttempt = 0;
let wallpaperPanRetrySource = "";
let pendingWallpaperPanDelta = 0;
const pendingReadPositionRestore = ref(false);
// Cold-start anchor guard: keep a cached message window hidden until its saved
// semantic reading anchor has been restored.
const initialChatAnchorPending = ref(store.messages.length > 0);
let readPositionRestoreToken = 0;
let activeReadAnchor: ChatReadAnchor | null = null;
const chatScrollIntentTracker = createChatScrollIntentTracker();
let pendingMessageJumpId: number | null = null;
const settingsTab = ref<SettingsTab>("account");
const settingsLoadError = ref("");
const accountSettings = useAccountSettings();
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
  syncAccountSettings
} = accountSettings;
const flashEffectStep = ref(0);
let flashEffectTimer = 0;
const activityLogFilterOptions: Array<{ value: "all" | ActivityLogCategory; label: string }> = [
  { value: "all", label: "全部" },
  { value: "session", label: "会话" },
  { value: "music", label: "音乐" },
  { value: "usage", label: "使用情况" }
];
const adminTools = useAdminTools({
  showAdmin,
  showSettings,
  showChatToolsMenu,
  saveReadPosition,
  restoreChatSurface,
  checkForUpdates,
  ensureReleaseHistory,
  pinnedNoticeText: () => pinnedBlocks.value.filter((block) => block.type === "text").map((block) => block.text).join("\n"),
  replaceChannelSnapshot,
  authMode,
  activePalette: () => activePalette.value,
  flashEffect: () => flashEffect.value,
  flashEffectStep,
  wallpaperUrl,
  paletteStyle,
  wallpaperFitStyle,
  readableTextColor,
  cleanFlashEffectSettings
});
const {
  adminPage,
  adminMsg,
  adminChannels,
  adminLoginLogs,
  adminLoginLogsBusy,
  adminLoginLogsMsg,
  activityLogFilter,
  devices,
  adminAppearancePages,
  loadAdmin,
  loadAdminLoginLogs,
  setActivityLogFilter,
  loadDevices,
  revokeDevice,
  syncChannelEdits,
  closeAdminPanel,
  deleteChannel,
  adminDate,
  adminDateTime,
  loginLogKindLabel,
  loginLogTone,
  displayedDeviceName,
  activityStateLabel,
  activityDuration,
  musicProgressSummary,
  backgroundAttachmentLabel,
  appearanceSection,
  appearancePreviewOpen,
  appearanceImagePicker,
  loginAppearanceEdit,
  backgroundAttachmentOptions,
  appearanceImagePickerSelection,
  appearanceImagePickerFit,
  appearanceImagePickerFitOptions,
  appearancePreviewFlash,
  closeAppearanceImagePicker,
  uploadAppearanceImageForPicker,
  selectAppearanceImage,
  clearAppearancePickerImage,
  syncLoginAppearanceEdit
} = adminTools;
const {
  isAiSettingsRoute,
  newVirtual,
  virtuals,
  aiSettings,
  aiSettingsEdit,
  aiSettingsBusy,
  aiSettingsMsg,
  aiSettingsTab,
  loadVirtualCharacters,
  loadAiSettings,
  loadMcStatus,
  saveAiSettings,
  saveVirtualCharacter,
  addVirtual,
  uploadVirtualAvatar,
  toggleNewVirtualChannel,
  toggleVirtualChannel,
  virtualEnabled,
  virtualModel,
  virtualThinkingEnabled,
  virtualPersona,
  virtualManualMemory,
  virtualChannelIds,
  setVirtualDisplayName,
  setVirtualEnabled,
  setVirtualManualMemory,
  setVirtualModel,
  setVirtualPersona,
  setVirtualThinkingEnabled
} = useAiSettings({
  showAdmin,
  isLogRoute,
  adminMsg,
  saveReadPosition
});
const notificationMsg = ref("");
const notificationPublicKey = ref("");
const notificationPermission = ref(typeof Notification === "undefined" ? "default" : Notification.permission);
const notificationEnabled = ref(false);
const notificationBusy = ref(false);
const notificationPromptOpen = ref(false);
const notificationPermissionAttempts = ref(0);
const mutedChannelIds = ref<Set<number>>(new Set());
const pinnedExpanded = ref(false);
const showPinnedEditor = ref(false);
const pinnedEditTitle = ref("");
const pinnedEditBlocks = ref<PinnedContentBlockDTO[]>([]);
const pinnedEditMsg = ref("");
const {
  pendingPrayer,
  pendingPrayerUpdate,
  prayerUpdateTextarea,
  prayerUpdateContent,
  prayerUpdateBusy,
  prayerUpdateError,
  prayerUpdatePhotoInput,
  prayerUpdatePhotoPreview,
  prayerComposerPhoto,
  prayerComposerPhotoPreview,
  aiSuggestionErrors,
  prayerPromptStyle,
  requestPrayerPrayed,
  clearPrayerComposerPhoto,
  prayerPayload,
  prayerStatusText,
  prayerActionText,
  prayerLatestTime,
  prayerImageUrl,
  openPrayerImage,
  prayerAiSuggestions,
  prayerAiSuggestionCount,
  prayerAiLimitReached,
  isPrayerAiExpanded,
  isPrayerAiBusy,
  togglePrayerAiSuggestions,
  generatePrayerAiSuggestions,
  markPrayerPrayed,
  updatePrayerStatus,
  canPublishPrayerUpdate,
  prayerUpdateCanPublish,
  clearPrayerUpdatePhoto,
  openPrayerUpdateEditor,
  closePrayerUpdateEditor,
  handlePrayerUpdatePhotoPick,
  uploadPrayerImage,
  publishPrayerUpdate,
  withdrawPrayer
} = usePrayer({
  isMine,
  openAttachmentFromTap: (message, event) => openAttachmentFromTap(message, event),
  scrollBottom,
  positionPromptNearEvent,
  closeCompetingPrompts: () => {
    pendingChain.value = null;
    pendingDownload.value = null;
    pendingRecall.value = null;
    pendingMessageActions.value = null;
    selectedMember.value = null;
  }
});
const expandedBibleReferenceKeys = ref<Set<string>>(new Set());
const bibleLookupCache = ref<Record<string, BibleLookupDTO | null>>({});
const bibleLookupBusyKeys = ref<Set<string>>(new Set());
const {
  bibleOpen,
  bibleTargetChannelId,
  bibleWorkspace,
  bibleReadingActivity,
  bookReadingActivity,
  bibleFavorites,
  bibleFavoritesLoading,
  bibleFavoritesError,
  bibleFavoritePassages,
  bibleTargetChannel,
  bibleCanSend,
  bibleSendUnavailableReason,
  bibleShareChannels,
  loadBibleFavorites,
  updateBibleFavorites,
  openBibleFavorites,
  openBibleWorkspace,
  closeBibleWorkspace,
  openBibleFavoritePassage,
  openFavoriteMessage,
  openBibleSessionFromMessage,
  handleBibleReadingChange,
  handleBookReadingChange,
  sendBiblePassage
} = useBibleWorkspaceIntegration({
  showChannels,
  showMembers,
  showFavorites,
  showBibleFavorites,
  sermonWorkspaceOpen,
  bookWorkspaceOpen,
  saveReadPosition,
  currentChannelId: () => currentChannel.value?.id || null,
  isTapSuppressed: () => Date.now() < suppressNextTapUntil,
  publishBibleReading,
  publishBookReading,
  jumpToMessageInChannel
});
let bibleSwipeStart: { x: number; y: number } | null = null;
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
const chainPromptAnchor = ref<HTMLElement | null>(null);
type TopNotice = {
  id: string;
  kind: "mention" | "like" | "favorite";
  title: string;
  body: string;
  createdAt: string;
  channelId?: number;
  messageId?: number;
  notificationId?: number;
};
const acknowledgedFavoriteNotificationIds = ref<Set<number>>(new Set());
const documentVisible = ref(document.visibilityState === "visible");
let messageEffectObserver: IntersectionObserver | null = null;
const {
  pausedEffectIds,
  observedEffectIds,
  visibleEffectIds,
  messageIdForEffectElement,
  updateEffectVisibility,
  toggleMessageEffect
} = useMessageEffectVisibility({ messageEffect });
const {
  rainCanvas,
  rainActive,
  hydratePlayedRainEffectIds,
  stopRainEffect,
  triggerOneShotMessageEffects
} = useRainEffect({ messageEffect });
const {
  dripLayer,
  ensureDripPhysics,
  stopDripPhysics
} = useDripEffect({
  scroller,
  messages: () => store.messages,
  messageEffect,
  isMessageEffectPaused
});
const {
  waterTilt,
  requestDeviceOrientationPermissionOnce,
  stirWaterMessage,
  settleWaterMessage,
  getDeviceGravity
} = useWaterRippleEffect({
  messages: () => store.messages,
  messageEffect,
  isMessageEffectPaused,
  documentVisible
});
const {
  gooeyDripLayer,
  gooeyBlobs,
  gooeyHighlights,
  ensureGooeyDripPhysics,
  stopGooeyDripPhysics
} = useGooeyDripEffect({
  scroller,
  messages: () => store.messages,
  messageEffect,
  isMessageEffectPaused,
  gravity: getDeviceGravity
});
const composerPanel = ref<"voice" | "more" | null>(null);
const currentChainChannelId = computed(() => store.currentChannelId);
const {
  showCreateDialog: showChainModal,
  createBusy: chainCreateBusy,
  createError: chainCreateError,
  pendingChain,
  joinBusy: chainJoinBusy,
  joinError: chainJoinError,
  openCreateDialog: openChainModal,
  closeCreateDialog: closeChainModal,
  createChain,
  openJoin: openChainJoin,
  closeJoin: closeChainJoin,
  joinPendingChain,
  closeChainSurfaces
} = useChain({
  currentChannelId: currentChainChannelId,
  getReplyToId: () => replyTo.value?.id || null,
  onOpenCreate: () => { composerPanel.value = null; },
  onCreated: () => { composerPanel.value = null; }
});
watch(pendingChain, (message) => {
  if (!message) chainPromptAnchor.value = null;
});

async function switchVisibleChannel(channelId: number, prayerOnly = false) {
  if (prayerOnly) await store.switchPrayerView(channelId);
  else await store.switchChannel(channelId);
}

async function openChannelFromList(channelId: number, prayerOnly = false) {
  if (Date.now() < suppressNextTapUntil) return;
  if (!showingFavoriteSurface.value) saveReadPosition();
  showFavorites.value = false;
  showBibleFavorites.value = false;
  clearPrayerComposerPhoto();
  await switchVisibleChannel(channelId, prayerOnly);
  showChannels.value = false;
}

async function openFavorites() {
  if (!showFavorites.value) saveReadPosition();
  showFavorites.value = true;
  showBibleFavorites.value = false;
  showChannels.value = false;
  favoritesLoading.value = true;
  try {
    const result = await api<{ favorites: FavoriteMessageDTO[] }>("/api/favorites");
    favoriteMessages.value = result.favorites;
  } finally {
    favoritesLoading.value = false;
  }
}

async function removeBibleFavoritePassage(passage: BibleFavoritePassage) {
  if (!window.confirm(`取消收藏“${passage.lookup.normalizedReference}”？`)) return;
  try {
    await updateBibleFavorites(passage.favorites.map((favorite) => ({
      bookCode: favorite.bookCode,
      chapter: favorite.chapter,
      verse: favorite.verse
    })), false);
  } catch {
    // The dedicated surface keeps the error visible and leaves the passage intact.
  }
}

async function removeFavorite(favorite: FavoriteMessageDTO) {
  if (!window.confirm("取消收藏这条消息？")) return;
  await api(`/api/messages/${favorite.message.id}/favorite`, { method: "PUT", body: JSON.stringify({ favorited: false }) });
  favoriteMessages.value = favoriteMessages.value.filter((item) => item.id !== favorite.id);
  store.updateMessageReactions(favorite.message.id, { currentUserFavorited: false, favoriteCount: Math.max(0, (favorite.message.reactions?.favoriteCount || 1) - 1) });
}

const {
  pendingUploads,
  setPendingUpload,
  removePendingUpload,
  replacePendingMessage,
  pendingUploadFor,
  pendingUploadLabel,
  pendingUploadKindLabel,
  pushPendingVoiceMessage,
  isImageFile,
  uploadPickedFile,
  handlePickedFile,
  handleComposerPaste,
  removePendingMessage,
  retryPendingUpload
} = useUploads({
  composerPanel,
  keepOriginalImages,
  isMusicChannel: () => isMusicChannel.value,
  scrollBottom,
  uploadFile
});
const {
  isRecording,
  audioPreviewUrl,
  audioFile,
  audioPreviewWaveform,
  audioPreviewDurationMs,
  previewAudioEl,
  previewPlaying,
  previewProgress,
  voiceSending,
  recordingDuration,
  recordingStatus,
  recordingNotice,
  resetRecording,
  startRecording,
  stopRecording,
  sendVoice,
  formatDuration,
  voiceBarStyle,
  togglePreviewPlayback,
  updatePreviewProgress,
  syncPreviewMetadata,
  endPreviewPlayback,
  handleRecordingVisibilityChange
} = useVoiceRecording({ composerPanel, pushPendingVoiceMessage, uploadFile });
const {
  slashCommandToken,
  matchingSlashCommands,
  mentionToken,
  matchingMentionMembers,
  matchingMusicMentionTracks,
  activeComposerSuggestionKind,
  composerSuggestionCount,
  showComposerSuggestionMenu,
  canSendText,
  socketReadyToSend,
  composerSendStatus,
  composerSendState,
  parseComposerText,
  syncComposerCaret,
  chooseSlashCommand,
  startPrayerComposer,
  chooseMentionSuggestion,
  removeMusicMention,
  sendText,
  toggleMorePanel,
  toggleVoicePanel,
  onInput,
  onKeydown,
  pickReply
} = useComposer({
  input,
  composerFocused,
  selectedMusicMention,
  composerCaret,
  composerSuggestionIndex,
  composerSuggestionSuppressed,
  replyTo,
  musicMentionToken,
  composerInput,
  composerPanel,
  messageSendPending,
  messageSendStatus,
  clearMessageSendStatus,
  sendMessage,
  prayerComposerPhoto,
  uploadPrayerImage,
  clearPrayerComposerPhoto,
  isRecording,
  startRecording,
  stopRecording,
  audioFile,
  sortedMusicTracks: () => sortedMusicTracks.value,
  chooseActiveSuggestion: () => chooseActiveComposerSuggestion()
});
const serverVersion = ref<VersionDTO | null>(null);
const versionUpdateNotice = ref("");
const staleVersionVisible = ref(false);
const staleVersionMessage = ref("");
const updateCheck = ref<UpdateCheckDTO | null>(null);
const updateStatus = ref<UpdateStatusDTO | null>(null);
const updateBusy = ref(false);
const selectedUpdateBranch = ref("");

const {
  timeline,
  measuredTimelineHeights,
  resolvedMessageImageDimensions,
  timelineScrollActive,
  pendingTimelineHeights,
  timelineViewportHeight,
  timelineViewportWidth,
  virtualTimelineItems,
  virtualTimelineActive,
  virtualTimelineWindow,
  timelineTopSpacerHeight,
  timelineBottomSpacerHeight,
  timelineReservedHeight,
  timelineRowKey,
  messageImageDimensions,
  messageImagePresentationStyle,
  estimatedImageTimelineRowHeight,
  syncVirtualTimelineViewport,
  measuredTimelineRowHeight,
  visibleTimelineAnchor,
  pumpMessageImagePreloads
} = useVirtualTimeline({
  scroller,
  versionUpdateNotice,
  estimateRowHeight: estimatedTimelineRowHeight,
  computeWindow: computeVirtualTimelineWindow,
  imagePreloadQueue: messageImagePreloadQueue,
  queuedImagePreloads: queuedMessageImagePreloads,
  fileThumbUrl
});
const {
  mentionToasts,
  acknowledgedMentionIds,
  loadAcknowledgedMentionIds,
  queueMentionToast,
  ensureVisibleLinkPreviews,
  isMentionAlertActive,
  acknowledgeMentionAlert,
  acknowledgeMentionId,
  channelName,
  messagePreviewText,
  linkPreviewFor,
  messageContentHtml,
  markdownMessageHtml,
  textContentHtml,
  messageRichTextSegments,
  prayerRichTextSegments
} = useMessageRendering({ linkifyMessageHtml, isMine, reconcileReadPositionAfterLayout });
const hasUnreadMessages = ref(false);
const awayFromNewest = ref(false);
let versionCheckTimer: number | undefined;
let updateStatusTimer: number | undefined;
let loadingHistoryFromScroll = false;
let loadingNewerFromScroll = false;
const longPressMs = 520;
let blankScoreLongPressTimer: number | undefined;
let blankScoreLongPressStartedAt = { x: 0, y: 0 };
let suppressNextTapUntil = 0;

type VoicePayload = {
  kind?: string;
  durationMs?: number;
  waveform?: number[];
  mimeType?: string;
};

onMounted(async () => {
  hydratePlayedRainEffectIds();
  mountMusicPlayer();
  document.addEventListener("pointerdown", closeTapPromptsFromOutside);
  document.addEventListener("keydown", handleGlobalEscape);
  document.addEventListener("visibilitychange", handleDocumentVisibilityChange);
  window.addEventListener("resize", handleTimelineViewportResize, { passive: true });
  window.visualViewport?.addEventListener("resize", handleTimelineViewportResize, { passive: true });
  window.visualViewport?.addEventListener("scroll", handleTimelineViewportResize, { passive: true });
  window.addEventListener("pagehide", handlePageHideFlush);
  window.addEventListener("reception-closed", handleReceptionClosed);
  const linkedChannelId = Number(new URLSearchParams(window.location.search).get("channelId") || 0);
  try {
    await store.bootstrap();
  } catch (error) {
    initialChatAnchorPending.value = false;
    appStartError.value = error instanceof Error ? error.message : "聊天室加载失败";
    return;
  } finally {
    appStarting.value = false;
  }
  if (store.account) {
    // Music data is not needed for the chat first paint. Restore playback
    // state and load playlists in parallel, then tracks (which merges into
    // playlists and reconciles the restored track) — all detached so chat
    // scrolling and the version check no longer wait for the music chain.
    const musicAccountId = store.account.id;
    void Promise.all([activateMusicAccount(musicAccountId), loadMusicPlaylists()])
      .then(() => loadMusicTracks())
      .catch((error: unknown) => {
        musicError.value = error instanceof Error ? error.message : "音乐加载失败";
      });
    attachMusicSocket();
    void navigator.storage?.persist?.().catch(() => false);
  }
  if (isAiSettingsRoute.value && store.account?.isAdmin) {
    await loadAiSettings();
    await loadVirtualCharacters().catch(() => { virtuals.value = []; });
    void loadMcStatus();
  }
  if (isLogRoute.value && store.account?.isAdmin) await loadAdminLoginLogs();
  await checkServerVersion();
  versionCheckTimer = window.setInterval(() => void checkServerVersion(), 60_000);
  // Channel data loads in the background after bootstrap's identity phase;
  // only deep links need to wait for the channel list before navigating.
  if (linkedChannelId) await store.whenChannelsReady();
  await switchToLinkedChannel();
  pendingReadPositionRestore.value = true;
  await restoreSavedReadPosition();
  await nextTick();
  observeWallpaperPanViewport();
  await resetWallpaperPan();
  syncVirtualTimelineViewport();
  refreshTimelineMeasurements();
  refreshMessageEffectObserver();
  syncFlashEffectTimer();
});

function reloadApplication() {
  window.location.reload();
}

function handleGlobalEscape(event: KeyboardEvent) {
  if (previewPinnedImage.value?.score && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
    if (previewMessage.value?.type !== "file") {
      event.preventDefault();
      shiftMusicScorePreview(event.key === "ArrowLeft" ? -1 : 1);
      return;
    }
  }
  if (event.key !== "Escape") return;
  if (showChatToolsMenu.value) {
    showChatToolsMenu.value = false;
    return;
  }
  if (bibleOpen.value) {
    bibleOpen.value = false;
    return;
  }
  if (sermonWorkspaceOpen.value) {
    sermonWorkspaceOpen.value = false;
    return;
  }
  if (previewMessage.value) {
    closePreviewMessage();
    return;
  }
  if (musicScoreOpen.value) {
    closeMusicScore();
    return;
  }
  if (appearanceImagePicker.value) {
    closeAppearanceImagePicker();
    return;
  }
  if (pendingChain.value) {
    closeChainJoin();
    return;
  }
  if (showChainModal.value) {
    closeChainModal();
    return;
  }
  if (showSettings.value) {
    void closeSettingsPanel();
    return;
  }
  if (showAdmin.value) void closeAdminPanel();
}

watch(
  () => [store.currentChannelId, store.prayerOnly] as const,
  async () => {
    readPositionRestoreToken += 1;
    activeReadAnchor = null;
    pendingTimelineAnchor = null;
    chatScrollIntentTracker.reset();
    stopAllMessageAudioPlayback();
    selectedMember.value = null;
    memberPaneChannelOverride.value = null;
    managedMembers.value = [];
    memberRemoveMode.value = false;
    memberManageMsg.value = "";
    pendingCloseChannel.value = null;
    pendingLeaveChannel.value = null;
    closeChainSurfaces();
    pendingDownload.value = null;
    pendingRecall.value = null;
    pendingPrayer.value = null;
    pendingPrayerUpdate.value = null;
    pendingMessageActions.value = null;
    textSelectableMessageId.value = null;
    resetForwardState();
    chatRecordViewMessage.value = null;
    oopsPhysicsLayer.value?.reset();
    oopsActiveMessageIds.value = new Set();
    selectedMessageIds.value = new Set();
    messageSelectionMode.value = false;
    composerPanel.value = null;
    selectedMusicMention.value = null;
    lastParallaxScrollTop = null;
    pendingParallaxDelta = 0;
    pendingWallpaperPanDelta = 0;
    if (parallaxFrame) window.cancelAnimationFrame(parallaxFrame);
    parallaxFrame = 0;
    hasUnreadMessages.value = false;
    if (pendingMessageJumpId !== null) {
      pendingReadPositionRestore.value = false;
      return;
    }
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
    const latest = store.messages[store.messages.length - 1];
    const shouldFollow = shouldFollowMessageListChange({
      restoring: pendingReadPositionRestore.value,
      loadingOlder: store.loadingOlderMessages,
      previousLength,
      length,
      nearBottom: isNearMessageBottom(220),
      latestIsMine: latest ? isMine(latest) : false
    });
    nextTick(() => {
      if (shouldFollow) scrollBottom(false);
    });
  }
);

watch(
  () => store.messages.map((message) => `${message.id}:${message.type}:${message.content}`).join("|"),
  () => {
    void ensureVisibleLinkPreviews();
    preloadMessageImages(store.messages);
  },
  { immediate: true }
);

watch(
  () => store.lastIncomingMessage?.id,
  () => {
    if (store.lastIncomingMessage) {
      const incoming = store.lastIncomingMessage;
      queueMentionToast(incoming);
      if (shouldTriggerIncomingRainEffect({
        effect: messageEffect(incoming),
        messageChannelId: incoming.channelId,
        currentChannelId: store.currentChannelId,
        prayerOnly: store.prayerOnly,
        messageType: incoming.type,
        activeView: !showingFavoriteSurface.value && !bibleOpen.value && !sermonWorkspaceOpen.value && !showAdmin.value && !showSettings.value && !musicScoreStageVisible.value,
        messageVisible: isNearMessageBottom(220),
        documentVisible: documentVisible.value
      })) triggerOneShotMessageEffects(incoming);
      if (incoming.channelId === store.currentChannelId && !isMine(incoming) && !isNearMessageBottom(220)) {
        hasUnreadMessages.value = true;
      }
    }
  }
);

watch(
  () => [store.messages.map((message) => `${message.id}:${messageEffect(message) || "none"}`).join("|"), [...pausedEffectIds.value].join(","), showingFavoriteSurface.value, bibleOpen.value || sermonWorkspaceOpen.value || bookWorkspaceOpen.value] as const,
  () => {
    if (bibleOpen.value || sermonWorkspaceOpen.value || bookWorkspaceOpen.value) {
      messageEffectObserver?.disconnect();
      stopRainEffect();
      stopDripPhysics(true);
      stopGooeyDripPhysics(true);
      syncFlashEffectTimer();
      return;
    }
    nextTick(() => {
      refreshMessageEffectObserver();
      ensureDripPhysics();
      ensureGooeyDripPhysics();
      syncFlashEffectTimer();
    });
  },
  { flush: "post", immediate: true }
);

watch(
  () => store.account?.id,
  (accountId) => {
    queuedMessageImagePreloads.clear();
    messageImagePreloadQueue.splice(0);
    mentionToasts.value = [];
    acknowledgedMentionIds.value = loadAcknowledgedMentionIds();
    acknowledgedFavoriteNotificationIds.value = loadAcknowledgedFavoriteNotificationIds();
    messageFontSize.value = loadMessageFontSizePreference(accountId);
    notificationPermissionAttempts.value = loadNotificationPermissionAttempts(accountId);
    if (accountId) {
      initializeVersionUpdateNotice(accountId);
      void loadNotificationSettings();
      void loadBibleFavorites();
    } else {
      versionUpdateNotice.value = "";
      bibleFavorites.value = [];
      bibleFavoritesError.value = "";
      showBibleFavorites.value = false;
      clearMusicScoreCache();
      musicTracks.value = [];
      resetMusicScoreState();
      closeMusicSurface();
    }
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

// 音乐小窗字号由管理员在「聊天室外观」里统一设置，默认 20px
const musicPanelFontSize = computed(() => cleanMusicPanelFontSize(store.appearance.musicPanelFontSize));

watch(
  () => store.account?.isAdmin,
  (isAdminAccount) => {
    if (isAiSettingsRoute.value && isAdminAccount) {
      void loadAiSettings();
      loadVirtualCharacters().catch(() => undefined);
      void loadMcStatus();
    }
    if (isLogRoute.value && isAdminAccount) void loadAdminLoginLogs();
  }
);

watch(
  () => store.channels.map((channel) => `${channel.id}:${channel.name}:${channel.description}:${channel.icon}`).join("|"),
  () => syncChannelEdits()
);

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", closeTapPromptsFromOutside);
  document.removeEventListener("keydown", handleGlobalEscape);
  document.removeEventListener("visibilitychange", handleDocumentVisibilityChange);
  window.removeEventListener("pagehide", handlePageHideFlush);
  window.removeEventListener("reception-closed", handleReceptionClosed);
  window.removeEventListener("resize", handleTimelineViewportResize);
  window.visualViewport?.removeEventListener("resize", handleTimelineViewportResize);
  window.visualViewport?.removeEventListener("scroll", handleTimelineViewportResize);
  timelineResizeObserver?.disconnect();
  timelineResizeObserver = null;
  wallpaperPanResizeObserver?.disconnect();
  wallpaperPanResizeObserver = null;
  if (wallpaperPanRetryTimer !== undefined) window.clearTimeout(wallpaperPanRetryTimer);
  wallpaperPanRetryTimer = undefined;
  if (timelineScrollFrame !== undefined) window.cancelAnimationFrame(timelineScrollFrame);
  timelineScrollFrame = undefined;
  if (timelineMeasurementFrame !== undefined) window.cancelAnimationFrame(timelineMeasurementFrame);
  timelineMeasurementFrame = undefined;
  if (timelineScrollIdleTimer !== undefined) window.clearTimeout(timelineScrollIdleTimer);
  timelineScrollIdleTimer = undefined;
  pendingTimelineHeights.clear();
  messageEffectObserver?.disconnect();
  messageEffectObserver = null;
  if (sermonDecisionTimer !== undefined) window.clearTimeout(sermonDecisionTimer);
  if (versionCheckTimer) window.clearInterval(versionCheckTimer);
  if (updateStatusTimer) window.clearInterval(updateStatusTimer);
  if (flashEffectTimer) window.clearInterval(flashEffectTimer);
  stopComposerPlaceholder();
  if (musicScoreTimer) window.clearTimeout(musicScoreTimer);
  clearMusicLyricsHeaderResumeTimer();
  clearMessageLongPress();
  clearBlankScoreLongPress();
  clearFavoriteLongPress();
  clearChannelLongPress();
  oopsPhysicsLayer.value?.reset();
  stopAllMessageAudioPlayback();
  resetRecording();
  stopPublishingMusicListening();
  stopPublishingBibleReading();
  stopPublishingFriendListening();
  store.socket?.off("music:updated", handleMusicUpdated);
  store.socket?.off("music:playlist-updated", handleMusicPlaylistUpdated);
  store.socket?.off("music:favorite-updated", handleMusicFavoriteUpdated);
  store.socket?.off("music:listeners", handleMusicListeners);
  store.socket?.off("bible:readers", handleBibleReaders);
  store.socket?.off("connect", handleActivitySocketConnect);
  stopPresenceHeartbeat();
  if (activityConnectRetryTimer) window.clearTimeout(activityConnectRetryTimer);
  clearMusicScoreCache();
  disposeMusicPlayer();
  friendPlayer.controls.dispose();
});

const currentChannel = computed(() => store.currentChannel);
const isMusicChannel = computed(() => currentChannel.value?.kind === "music");
const exclusiveAudio = getSharedExclusiveAudio();
const musicPlayer = useMusicPlayer({
  tracks: musicTracks,
  libraryTracks: sortedMusicTracks,
  favoriteTracks: favoriteMusicTracks,
  playlists: musicPlaylists,
  selectedSourceKind: musicSourceKind,
  selectedPlaylistId: selectedMusicPlaylistId,
  scoreOpen: musicScoreOpen,
  onCurrentTrackChanged: reconcileOpenMusicScore,
  onListeningChanged: publishMusicListening,
  onPlaybackStart: () => exclusiveAudio.activate("music"),
  onHeatChanged: (trackId, heat) => {
    musicTracks.value = musicTracks.value.map((track) => track.id === trackId ? { ...track, heat } : track);
  }
});
const {
  currentTrackId: currentMusicTrackId,
  currentTrack: currentMusicTrack,
  playableTracks: playableMusicTracks,
  onlyFavorites: musicOnlyFavorites,
  playing: musicPlaying,
  error: musicError
} = musicPlayer.state;
const {
  mount: mountMusicPlayer,
  dispose: disposeMusicPlayer,
  handleAccountChange: handleMusicAccountChange,
  activateAccount: activateMusicAccount,
  persistPlaybackState: persistMusicPlaybackState,
  play: playCurrentMusic,
  pause: pauseMusic,
  stop: stopMusic,
  togglePlayback: toggleMusicPlayback,
  selectTrack: selectMusicTrackCore,
  replaceCurrentTrack: replaceCurrentMusicTrack,
  reconcileTracks: reconcileMusicTracks,
  handlePlaylistDeleted: handleMusicPlaylistDeleted,
  currentPlaybackTimeMs: currentMusicPlaybackTimeMs
} = musicPlayer.controls;

const {
  musicMentionTitle,
  musicMentionTextHtml,
  isMentionedMusicPlaying,
  toggleMentionedMusic,
  musicMentionBackground,
  isMusicMentionBackgroundExpanded,
  toggleMusicMentionBackground
} = useMusicMentionRendering({
  linkifyMessageHtml,
  musicTracks,
  currentMusicTrackId,
  musicPlaying,
  pauseMusic,
  selectMusicTrack: selectMusicTrackCore,
  musicSourceKind,
  selectedMusicPlaylistId,
  musicPlayerExpanded,
  musicManagerOpen
});
const musicSleepTimer = useMusicSleepTimer({ currentTrackId: currentMusicTrackId, onStop: () => pauseMusic(true) });
const friendPlayer = useFriendPlayer({
  onUserPlay: () => exclusiveAudio.activate("friend"),
  onUserPause: () => exclusiveAudio.deactivate("friend"),
  onEnded: () => exclusiveAudio.deactivate("friend", { resumeSuspended: true }),
  onListeningChanged: (program) => {
    friendListeningProgram.value = program;
    publishFriendListening();
  }
});
const { playing: friendPlaying } = friendPlayer.state;
exclusiveAudio.register({ id: "music", resumable: true, suspend: () => pauseMusic(), resume: () => void playCurrentMusic({ fadeIn: true }) });
exclusiveAudio.register({ id: "friend", resumable: true, suspend: () => friendPlayer.controls.duck(), resume: () => void friendPlayer.controls.resumeWithFade() });
const friendProgramsOpen = ref(false);
function toggleFriendPrograms() {
  friendProgramsOpen.value = !friendProgramsOpen.value;
  if (friendProgramsOpen.value) {
    musicPlayerExpanded.value = false;
    showChatToolsMenu.value = false;
    void friendPlayer.controls.playRandom();
  }
}
const activityStatusItems = computed(() => activityTickerItems(
  bibleReaders.value,
  bookReaders.value,
  musicListeners.value,
  friendListeners.value,
  Object.values(store.typing)
));
const activityTickerText = computed(() => activityStatusItems.value.join("　✦　"));
const currentMusicScores = computed(() => currentMusicTrack.value?.scores || []);
const currentMusicScore = computed(
  () => currentMusicScores.value.find((score) => score.id === currentMusicScoreId.value) || currentMusicScores.value[0] || null
);
const currentMusicScorePages = computed(() => currentMusicScore.value?.pages || []);
const currentMusicLyricCues = computed(() => currentMusicTrack.value?.lyrics?.cues || []);
const musicLyricsHeaderVisible = computed(
  () =>
    musicPlaying.value &&
    currentMusicLyricCues.value.length > 0 &&
    !musicLyricsHeaderSuppressed.value &&
    // 歌谱舞台全屏展示时让位于舞台，避免悬浮歌词头盖住舞台页签；关闭舞台后自动恢复
    !musicScoreStageVisible.value
);
const previewScoreTrack = computed(() => {
  const trackId = previewPinnedImage.value?.trackId;
  if (!trackId) return null;
  return musicTracks.value.find((track) => track.id === trackId) || store.messages.find((message) => message.id === trackId) || null;
});
const previewScoreEntry = computed(() => {
  const scores = previewScoreTrack.value?.scores || [];
  if (!scores.length) return null;
  return scores.find((score) => score.pages.some((page) => page.id === previewPinnedImage.value?.pageId)) || scores[0];
});
const previewScorePages = computed(() => previewScoreEntry.value?.pages || []);
const previewScorePageIndex = computed(() => previewScorePages.value.findIndex((page) => page.id === previewPinnedImage.value?.pageId));
const musicScoreTriggerVisible = computed(() =>
  shouldShowMusicScoreTrigger({
    playing: musicPlaying.value,
    scoreOpen: musicScoreOpen.value,
    pageCount: currentMusicScorePages.value.length
  })
);

watch(currentMusicTrackId, () => {
  currentMusicScoreId.value = null;
});

watch(
  () => store.account?.id,
  (accountId) => {
    handleMusicAccountChange(accountId);
    friendPlayer.controls.pause();
    friendPlayer.controls.resetHistory();
  },
  { immediate: true }
);
const canManageMusic = computed(() => !!store.account && (store.account.isAdmin || store.account.canPinMessages));

function clearMusicLyricsHeaderResumeTimer() {
  if (musicLyricsHeaderResumeTimer !== undefined) window.clearTimeout(musicLyricsHeaderResumeTimer);
  musicLyricsHeaderResumeTimer = undefined;
}

function scheduleMusicLyricsHeaderResume() {
  clearMusicLyricsHeaderResumeTimer();
  if (!musicPlaying.value || !currentMusicLyricCues.value.length || document.visibilityState !== "visible") return;
  musicLyricsHeaderResumeTimer = window.setTimeout(() => {
    musicLyricsHeaderResumeTimer = undefined;
    if (musicPlaying.value && currentMusicLyricCues.value.length) musicLyricsHeaderSuppressed.value = false;
  }, 5000);
}

function hideMusicLyricsHeader() {
  musicLyricsHeaderSuppressed.value = true;
  scheduleMusicLyricsHeaderResume();
}

function handleChatHeaderInteraction() {
  if (musicLyricsHeaderSuppressed.value) scheduleMusicLyricsHeaderResume();
}

watch(
  () => [currentMusicTrack.value?.id, currentMusicTrack.value?.lyrics?.fileName, musicPlaying.value] as const,
  ([trackId, lyricsFile, playing], [previousTrackId, previousLyricsFile]) => {
    if (!playing || !lyricsFile) {
      clearMusicLyricsHeaderResumeTimer();
      musicLyricsHeaderSuppressed.value = false;
      return;
    }
    if (trackId !== previousTrackId || lyricsFile !== previousLyricsFile) musicLyricsHeaderSuppressed.value = false;
  }
);
const loadedMentionToasts = computed<MentionToast[]>(() =>
  store.messages
    .filter(isMentionAlertActive)
    .map((message) => ({
      id: message.id,
      channelId: message.channelId,
      channelName: channelName(message.channelId),
      senderName: message.sender.displayName,
      text: messagePreviewText(message),
      createdAt: message.createdAt
    }))
);
const mentionNoticeItems = computed<TopNotice[]>(() => {
  const byMessageId = new Map<number, MentionToast>();
  for (const toast of [...mentionToasts.value, ...loadedMentionToasts.value]) {
    if (!acknowledgedMentionIds.value.has(toast.id)) byMessageId.set(toast.id, toast);
  }
  return [...byMessageId.values()]
    .sort((a, b) => b.id - a.id)
    .map((toast) => ({
      id: `mention-${toast.id}`,
      kind: "mention",
      title: `${toast.senderName} @了你`,
      body: `${toast.channelName} · ${toast.text}`,
      createdAt: toast.createdAt,
      channelId: toast.channelId,
      messageId: toast.id
    }));
});
const likeNoticeItems = computed<TopNotice[]>(() =>
  store.likeNotifications.map((notification) => ({
    ...likeNotificationToTopNotice(notification, store.channels.find((channel) => channel.id === notification.channelId)?.name),
    createdAt: notification.createdAt
  }))
);
const favoriteNoticeItems = computed<TopNotice[]>(() =>
  store.favoriteNotifications
    .filter((notification) => !acknowledgedFavoriteNotificationIds.value.has(notification.id))
    .map((notification) => ({
      ...favoriteNotificationToTopNotice(notification, store.channels.find((channel) => channel.id === notification.channelId)?.name),
      createdAt: notification.createdAt
    }))
);
const messageNoticeItems = computed<TopNotice[]>(() =>
  [...mentionNoticeItems.value, ...likeNoticeItems.value, ...favoriteNoticeItems.value]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
);
const activeMessageNotice = computed(() => messageNoticeItems.value[0] || null);
const messageNoticeCount = computed(() => messageNoticeItems.value.length);
const chatSubtitleText = computed(() => {
  if (showFavorites.value) return "集中查看所有收藏，长按消息可跳转到聊天上下文";
  if (showBibleFavorites.value) return "经文正文只展开一次，避免出处与正文重复嵌套";
  if (store.prayerOnly) return "只显示本频道代祷卡片";
  return "";
});
const isAdmin = computed(() => !!store.account?.isAdmin);
const canPinCurrentChannel = computed(() => !store.prayerOnly && !!currentChannel.value?.canPin);
const visiblePinned = computed(() => (!store.prayerOnly && store.pinned ? store.pinned : null));
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
const wallpaperPanActive = computed(() => hasWallpaper.value && store.appearance.wallpaperFit === "pan");
const wallpaperBackground = computed(() => wallpaperFitStyle(store.appearance.wallpaperFit));
const loginBackground = computed(() => wallpaperFitStyle(store.appearance.loginBackgroundFit));
const wallpaperPanImageSource = computed(() => {
  const source = wallpaperUrl(store.appearance.wallpaperPath);
  if (!source || !wallpaperPanRetryKey.value) return source;
  return `${source}${source.includes("?") ? "&" : "?"}pan-retry=${wallpaperPanRetryKey.value}`;
});
const wallpaperPanLayerStyle = computed(() => wallpaperPanReady.value
  ? wallpaperPanLayerPresentation(wallpaperPanImageWidth.value, wallpaperPanOffset.value)
  : { width: "100%", transform: "translate3d(0, 0, 0)" });
const wallpaperLabelText = computed(() => wallpaperLabelToneValue.value === "light" ? "#f8fafc" : "#18212b");
const wallpaperLabelShadow = computed(() => wallpaperLabelToneValue.value === "light"
  ? "0 1px 2px rgba(0, 0, 0, 0.92), 0 0 5px rgba(0, 0, 0, 0.58)"
  : "0 1px 2px rgba(255, 255, 255, 0.96), 0 0 5px rgba(255, 255, 255, 0.68)");
const appearanceStyle = computed(() => ({
  ...themeStyle.value,
  "--message-content-font-size": `${messageFontSize.value}px`,
  "--prayer-bubble-mine": store.appearance.prayerBubbleMineColor || "#f0fbf1",
  "--prayer-bubble-other": store.appearance.prayerBubbleOtherColor || "#fffaf0",
  "--message-flash-bg": activeFlashColor.value,
  "--message-flash-text": readableTextColor(activeFlashColor.value),
  "--message-flash-interval": `${flashEffect.value.intervalSeconds}s`,
  "--water-tilt-x": `${waterTilt.value.x.toFixed(2)}px`,
  "--water-tilt-y": `${waterTilt.value.y.toFixed(2)}px`,
  "--water-tilt-rotate": `${(waterTilt.value.x * 0.26).toFixed(2)}deg`,
  "--wallpaper-image": hasWallpaper.value && !wallpaperPanActive.value ? `url("${wallpaperUrl(store.appearance.wallpaperPath)}")` : "none",
  "--wallpaper-size": wallpaperBackground.value.size,
  "--wallpaper-repeat": wallpaperBackground.value.repeat,
  "--wallpaper-label-text": wallpaperLabelText.value,
  "--wallpaper-label-shadow": wallpaperLabelShadow.value,
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

watch(
  () => [store.appearance.wallpaperPath, activePalette.value.chatBg] as const,
  () => updateWallpaperLabelTone(),
  { immediate: true }
);

watch(input, () => void nextTick(syncComposerHeight), { immediate: true });

watch(
  () => [
    store.appearance.wallpaperPath,
    store.appearance.wallpaperFit,
    store.appearance.wallpaperPanFocusX,
    store.appearance.wallpaperPanDirection
  ] as const,
  () => void nextTick(resetWallpaperPan),
  { immediate: true }
);

// 表单登录后聊天面板才首次挂载（onMounted 时面板不存在），必须在面板元素出现时
// 重新挂接尺寸观察器并重算平移边界，否则窗口/侧栏尺寸变化后壁纸覆盖不住聊天区。
watch(
  chatPane,
  async (pane, previous) => {
    if (!pane || pane === previous) return;
    observeWallpaperPanViewport();
    await resetWallpaperPan();
  },
  { flush: "post" }
);

const loginShellClass = computed(() => `login-position-${store.appearance.loginFormPosition || "middle"}`);
const {
  selectedMember,
  memberPaneChannelOverride,
  managedMembers,
  memberRemoveMode,
  memberPickerOpen,
  memberPickerChannel,
  memberPickerCandidates,
  memberPickerSelectedIds,
  memberPickerBusy,
  memberManageMsg,
  ownerTransferOpen,
  ownerTransferChannel,
  ownerTransferSuccessorId,
  ownerTransferBusy,
  ownerTransferMsg,
  showChannelEditor,
  channelEditorMode,
  channelEditorChannel,
  channelEditorDraft,
  channelEditorBusy,
  channelEditorMsg,
  channelNameSuggestions,
  channelNameSuggestionBusy,
  pendingCloseChannel,
  pendingLeaveChannel,
  channelLeaveBusy,
  channelLeaveMsg,
  memberPromptPosition,
  memberPromptStyle,
  canDeleteCurrentChannel,
  activeMemberPaneChannel,
  activeMemberPaneMembers,
  canManageActiveMembers,
  ownerTransferCandidates,
  memberPaneTitle,
  memberPaneSubtitle,
  memberPickerTitle,
  channelEditorTitle,
  channelEditorSubtitle,
  isTwoPersonDirectEditor,
  isGroupDirectEditor,
  mentionMember,
  openMemberActions,
  openSenderActions,
  mentionSelectedMember,
  startPrivateChat,
  resetChannelEditorDraft,
  openCreateChannelEditor,
  openEditChannelEditor,
  closeChannelEditor,
  requestDirectChatNameSuggestions,
  openChannelEditorMembers,
  saveChannelEditor,
  uploadChannelEditorIcon,
  toggleCurrentMemberPane,
  refreshMembersForChannel,
  openAdminChannelMembers,
  canRemoveMemberFromActive,
  openMemberPicker,
  closeMemberPicker,
  memberPickerCandidateKey,
  toggleMemberPickerAccount,
  addSelectedMembers,
  removeMemberFromActive,
  openOwnerTransfer,
  closeOwnerTransfer,
  transferOwnedChannelAndLeave,
  requestLeaveChannel,
  leavePendingChannel,
  requestCloseChannel,
  closePendingChannel
} = useChannelManagement({
  input,
  composerInput,
  showMembers,
  showChannels,
  membersCollapsed,
  showChatToolsMenu,
  showAdmin,
  adminMsg,
  pendingChain,
  isAdmin,
  currentChannel,
  positionPromptNearEvent,
  replaceChannelSnapshot,
  saveReadPosition,
  switchVisibleChannel,
  restoreSavedReadPosition,
  restoreChatSurface,
  scrollBottom
});
const {
  pendingMessageActions,
  messageActionPromptPosition,
  messageActionPromptStyle,
  textSelectableMessageId,
  handleBubblePointerMove,
  handleBubblePointerLeave,
  beginMessageLongPress,
  moveMessageLongPress,
  clearMessageLongPress,
  beginFavoriteLongPress,
  moveFavoriteLongPress,
  clearFavoriteLongPress,
  beginChannelLongPress,
  moveChannelLongPress,
  clearChannelLongPress,
  openChannelContextMenu,
  openMessageActionMenu,
  defaultMessageReactions,
  toggleMessageLike,
  toggleMessageFavorite,
  likeActionMessage,
  favoriteActionMessage,
  likedByTitle,
  dismissLikeNotification,
  closeMessageActionMenu,
  quoteActionMessage,
  selectActionMessageText
} = useMessageActions({
  scroller,
  showFavorites,
  oopsActiveMessageIds,
  messageEffect,
  requestDeviceOrientationPermissionOnce,
  stirWaterMessage,
  settleWaterMessage,
  positionPromptNearEvent,
  suppressNextTap: () => { suppressNextTapUntil = Date.now() + 650; },
  openFavoriteMessage,
  openFavorites,
  openEditChannelEditor,
  pickReply,
  closeCompetingPrompts: () => {
    pendingChain.value = null;
    pendingDownload.value = null;
    pendingRecall.value = null;
    pendingPrayer.value = null;
    selectedMember.value = null;
  }
});
const {
  messageSelectionMode,
  selectedMessageIds,
  selectableMessages,
  selectedMessageCount,
  visibleMessagesSelected,
  toggleMessageSelectionMode,
  startMessageSelectionMode,
  toggleMessageSelected,
  toggleVisibleMessageSelection,
  deleteSelectedMessages,
  pinSelectedMessages
} = useMessageSelection({
  showChatToolsMenu,
  showAdmin,
  adminMsg,
  pinnedExpanded,
  canPinCurrentChannel,
  restoreChatSurface,
  closeCompetingPrompts: () => {
    pendingChain.value = null;
    pendingDownload.value = null;
    pendingRecall.value = null;
    pendingMessageActions.value = null;
    pendingPrayer.value = null;
  }
});
const {
  pendingRecall,
  recallPromptPosition,
  recallPromptStyle,
  recallRemainingMs,
  canRecallMessage,
  recallRemainingText,
  openRecallPrompt,
  recallPendingMessage,
  recallActionMessage
} = useMessageRecall({
  pendingMessageActions,
  isMine,
  positionPromptNearEvent,
  closeChainJoin,
  closeMessageActionMenu,
  closeCompetingPrompts: () => {
    pendingDownload.value = null;
    pendingMessageActions.value = null;
    pendingPrayer.value = null;
    selectedMember.value = null;
  }
});
const {
  previewMessage,
  previewPinnedImage,
  imagePreviewScale,
  imagePreviewOffset,
  downloadPromptPosition,
  downloadPromptStyle,
  pendingDownload,
  openAttachmentFromTap,
  openPreviewMessage,
  openPinnedImage,
  resetImagePreviewTransform,
  closePreviewMessage,
  previewImageSrc,
  downloadPreviewImage,
  clampImageScale,
  imagePreviewTransform,
  touchDistance,
  onImagePreviewTouchStart,
  onImagePreviewTouchMove,
  endImagePreviewTouch,
  onImagePreviewPointerDown,
  onImagePreviewPointerMove,
  onImagePreviewWheel,
  requestDownload,
  fileDownloadUrl,
  downloadFile,
  fileExtension,
  isPdfMessage,
  isVideoMessage,
  canPreviewMessage,
  isDocumentMessage,
  documentIconSrc,
  documentKindLabel
} = useMediaPreview({
  isTapSuppressed: () => Date.now() < suppressNextTapUntil,
  messageSelectionMode,
  toggleMessageSelected,
  fileUrl,
  pinnedFileUrl,
  positionPromptNearEvent,
  closeCompetingPrompts: () => {
    pendingChain.value = null;
    pendingRecall.value = null;
    pendingMessageActions.value = null;
    pendingPrayer.value = null;
    selectedMember.value = null;
  }
});
const {
  forwardActionSheetOpen,
  forwardPickerOpen,
  forwardSourceMessages,
  forwardMode,
  forwardConfirming,
  forwardChannelIds,
  forwardBusy,
  forwardError,
  forwardSuccess,
  chatRecordViewMessage,
  forwardTargetChannels,
  forwardSelectedChannels,
  forwardMergedPreviewPayload,
  forwardMergedPreviewLines,
  resetForwardState,
  closeForwardDialog,
  toggleForwardChannel,
  openSingleForward,
  startSelectionFromAction,
  openForwardActionSheet,
  chooseForwardMode,
  submitMessageForward,
  openChatRecord
} = useMessageForward({
  pendingMessageActions,
  pendingChain,
  messageSelectionMode,
  selectedMessageIds,
  currentChannel,
  toggleMessageSelected,
  closeMessageActionMenu,
  submitForward: (payload) => api<{ success: boolean; forwarded: number; skipped: number }>("/api/messages/forward", { method: "POST", body: JSON.stringify(payload) })
});
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
const pinnedTickerBody = computed(() =>
  pinnedBlocks.value
    .filter((block) => block.type === "text")
    .map((block) => block.text.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("　")
);
const releaseHistory = ref<Array<{ version: string; date: string; notes: readonly string[] }>>([]);
let releaseHistoryLoading = false;
// Historical notes come from the server on demand so the entry chunk does
// not carry the full release log.
async function ensureReleaseHistory() {
  if (releaseHistory.value.length || releaseHistoryLoading) return;
  releaseHistoryLoading = true;
  try {
    const result = await api<{ history: Array<{ version: string; date: string; notes: readonly string[] }> }>("/api/version/history");
    releaseHistory.value = result.history.filter((release) => release.version !== APP_VERSION);
  } catch {
    // The panels still show the current version's notes without history.
  } finally {
    releaseHistoryLoading = false;
  }
}
const releaseDeveloper = computed(() => serverVersion.value?.developer || RELEASE_DEVELOPER);
const activeParallaxKit = computed(() => parallaxKit(store.appearance.parallaxKits || [], store.appearance.parallaxKit));
watch(
  () => [
    `${appearancePreviewFlash.value.colors.join(",")}:${appearancePreviewFlash.value.intervalSeconds}:${appearancePreviewFlash.value.transitionMode}`,
    `${flashEffect.value.colors.join(",")}:${flashEffect.value.intervalSeconds}:${flashEffect.value.transitionMode}`
  ] as const,
  () => syncFlashEffectTimer(true),
  { immediate: true }
);
watch(
  () => [showAdmin.value, adminPage.value, appearanceSection.value, appearancePreviewOpen.value] as const,
  () => syncFlashEffectTimer()
);
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
const notificationNudgeCharacters = ["请", "打", "开", "通", "知"] as const;
const notificationPromptHint = computed(() => {
  if (!notificationSupported.value) return "当前浏览器不支持网页推送；iPhone/iPad 通常需要先把聊天室添加到主屏幕。";
  if (notificationPermission.value === "denied") return "你之前拒绝了通知，需要在浏览器或系统设置里把本网站通知改为允许。";
  if (notificationEnabled.value) return "本设备已经准备好接收 @ 和重要公告。";
  if (notificationPermissionAttempts.value >= 2) return "它已经困了，但你还是可以点“开启通知”把它叫醒。";
  if (notificationPermissionAttempts.value > 0) return "它先变成静音铃铛，但还在等你点“开启通知”。";
  return "开启后，即使没有停留在聊天室页面，也能收到 @ 和重要公告提醒。";
});
const canSubmitText = computed(() => canSendText.value && socketReadyToSend.value && !messageSendPending.value);
const loginBrand = computed(() => ({
  iconPath: store.appearance.loginIconPath || "/images/icon-192.svg",
  showIcon: store.appearance.loginShowIcon !== false,
  title: store.appearance.loginTitle || "Team Chat",
  subtitle: store.appearance.loginSubtitle,
  showSubtitle: store.appearance.loginShowSubtitle !== false
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

const adminReleaseBindings = {
  serverVersion,
  updateCheck,
  updateStatus,
  updateBusy,
  selectedUpdateBranch,
  updateProgress,
  updateStateText,
  updateRestartModeLabel,
  updateStartDisabled,
  checkForUpdates,
  startServerUpdate,
  releaseHistory,
  releaseDeveloper
};
const adminPanelActions = {
  startMessageSelectionMode,
  openAdminChannelMembers,
  channelIconUrl,
  wallpaperUrl,
  themeSwatchStyle
};
const settingsPanelBindings = {
  settingsTab,
  settingsLoadError,
  selectSettingsTab,
  closeSettingsPanel,
  uploadOwnAvatar,
  saveOwnProfile,
  changeOwnPassword,
  deleteOwnAccount,
  themeOptions,
  activeTheme,
  chooseTheme,
  themeSwatchStyle,
  bibleSettingsMsg,
  bibleOutputFormatOptions,
  bibleReferenceLabelOptions,
  bibleCombinedPassageOptions,
  bibleQuotationStyleOptions,
  biblePreferences,
  saveBiblePreference,
  devices,
  displayedDeviceName,
  revokeDevice,
  deviceIcon,
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
  channelIconUrl,
  avatarUrl,
  avatarText,
  serverVersion,
  compareVersions,
  reloadToLatestVersion,
  releaseHistory,
  releaseDeveloper
};

function estimatedTimelineRowHeight(row: TimelineRow) {
  if (row.kind === "time" || row.kind === "version") return 52;
  if (row.message.type === "image") return estimatedImageTimelineRowHeight(row.message, timelineViewportWidth.value);
  if (row.message.type === "prayer") return 280;
  if (row.message.type === "sermon_request") return 200;
  if (row.message.type === "bible_session") return 200;
  if (row.message.type === "chat_record") return 200;
  if (row.message.type === "chain") return 190;
  if (isAudioMessage(row.message)) return 112;
  if (row.message.type === "file") return 126;
  if (row.message.type === "system") return 64;
  const visualLines = Math.max(1, Math.ceil(Array.from(row.message.content || "").length / 24));
  return 68 + Math.min(160, visualLines * 20);
}

function handleMessageImageLoad(message: MessageDTO, event: Event) {
  const image = event.currentTarget;
  if (!(image instanceof HTMLImageElement) || !image.naturalWidth || !image.naturalHeight) return;
  const current = messageImageDimensions(message);
  if (current?.width === image.naturalWidth && current.height === image.naturalHeight) return;
  resolvedMessageImageDimensions.value = {
    ...resolvedMessageImageDimensions.value,
    [message.id]: { width: image.naturalWidth, height: image.naturalHeight }
  };
}

// 转发的附件引用原文件；原文件被删除后图片加载失败，占位显示“转发附件已被删除”。
const brokenAttachmentIds = ref<Set<number>>(new Set());

function markAttachmentBroken(message: MessageDTO) {
  const next = new Set(brokenAttachmentIds.value);
  next.add(message.id);
  brokenAttachmentIds.value = next;
}

function preloadMessageImages(messages: MessageDTO[]) {
  if (bibleOpen.value) return;
  // Only warm the newest few images; older history loads on demand through
  // the service worker cache when scrolled into view.
  const images = messages.filter((message) => message.type === "image" && message.id > 0).slice(-30);
  for (const message of images) {
    if (queuedMessageImagePreloads.has(message.id)) continue;
    queuedMessageImagePreloads.add(message.id);
    messageImagePreloadQueue.push(message);
  }
  if (messageImagePreloadQueue.length) scheduleImagePreload(() => pumpMessageImagePreloads());
}

function computeVirtualTimelineWindow(scrollTop: number) {
  return calculateVirtualWindow({
    items: virtualTimelineItems.value,
    measuredHeights: measuredTimelineHeights.value,
    scrollTop,
    viewportHeight: timelineViewportHeight.value,
    overscanBefore: Math.max(VIRTUAL_TIMELINE_MIN_BACKWARD_OVERSCAN, timelineViewportHeight.value * VIRTUAL_TIMELINE_BACKWARD_VIEWPORTS),
    overscanAfter: VIRTUAL_TIMELINE_FORWARD_OVERSCAN
  });
}

const renderedTimelineRows = computed(() => timeline.value
  .slice(virtualTimelineWindow.value.start, virtualTimelineWindow.value.end)
  .map((row, offset) => ({
    row,
    timelineIndex: virtualTimelineWindow.value.start + offset,
    key: timelineRowKey(row)
  })));

function scheduleVirtualTimelineViewport(root = scroller.value) {
  if (!root || timelineScrollFrame !== undefined) return;
  timelineScrollFrame = window.requestAnimationFrame(() => {
    timelineScrollFrame = undefined;
    syncVirtualTimelineViewport(root);
    if (timelineScrollActive.value) {
      void nextTick(() => {
        if (timelineScrollActive.value && scroller.value === root) pendingTimelineAnchor = visibleTimelineAnchor(root);
      });
    }
  });
}

function handleTimelineViewportResize() {
  syncVirtualTimelineViewport();
  reconcileReadPositionAfterLayout();
}

async function flushPendingTimelineMeasurements() {
  if (timelineScrollActive.value) return;
  if (!pendingTimelineHeights.size) {
    pendingTimelineAnchor = null;
    return;
  }
  const root = scroller.value;
  const current = measuredTimelineHeights.value;
  const next = { ...current };
  let changed = false;
  const anchor = root ? pendingTimelineAnchor || visibleTimelineAnchor(root) : null;
  pendingTimelineAnchor = null;
  for (const [key, height] of pendingTimelineHeights) {
    const item = virtualTimelineItems.value.find((candidate) => candidate.key === key);
    if (!item) continue;
    const previousHeight = current[key] || item.estimatedHeight;
    if (Math.abs(previousHeight - height) < 0.5) continue;
    next[key] = height;
    changed = true;
  }
  pendingTimelineHeights.clear();
  if (!changed) return;
  const anchoredScrollTop = root && anchor?.key && activeReadAnchor?.kind !== "newest" && !pendingReadPositionRestore.value
    ? scrollTopForVirtualAnchor(virtualTimelineItems.value, next, anchor)
    : null;
  measuredTimelineHeights.value = next;
  await nextTick();
  if (root && anchoredScrollTop !== null && activeReadAnchor?.kind !== "newest" && !pendingReadPositionRestore.value && !timelineScrollActive.value) {
    root.scrollTop = anchoredScrollTop;
  }
  syncVirtualTimelineViewport(root);
  reconcileReadPositionAfterLayout();
}

function scheduleTimelineMeasurementFlush() {
  if (timelineScrollActive.value || timelineMeasurementFrame !== undefined) return;
  timelineMeasurementFrame = window.requestAnimationFrame(() => {
    timelineMeasurementFrame = undefined;
    void flushPendingTimelineMeasurements();
  });
}

function handleTimelineResize(entries: ResizeObserverEntry[]) {
  for (const entry of entries) {
    const element = entry.target;
    if (!(element instanceof HTMLElement)) continue;
    const key = element.dataset.timelineKey;
    if (key) pendingTimelineHeights.set(key, measuredTimelineRowHeight(element));
  }
  scheduleTimelineMeasurementFlush();
}

function refreshTimelineMeasurements() {
  timelineResizeObserver?.disconnect();
  if (typeof ResizeObserver === "undefined") return;
  if (!timelineResizeObserver) timelineResizeObserver = new ResizeObserver(handleTimelineResize);
  for (const row of scroller.value?.querySelectorAll<HTMLElement>("[data-timeline-key]") || []) {
    timelineResizeObserver.observe(row, { box: "border-box" });
  }
}

watch(
  () => virtualTimelineItems.value.map((item) => item.key).join("|"),
  () => {
    const activeKeys = new Set(virtualTimelineItems.value.map((item) => item.key));
    measuredTimelineHeights.value = Object.fromEntries(Object.entries(measuredTimelineHeights.value).filter(([key]) => activeKeys.has(key)));
    nextTick(() => {
      syncVirtualTimelineViewport();
      refreshTimelineMeasurements();
    });
  },
  { flush: "post" }
);

watch(
  () => renderedTimelineRows.value.map((entry) => entry.key).join("|"),
  () => {
    nextTick(() => {
      refreshTimelineMeasurements();
      refreshMessageEffectObserver();
      ensureDripPhysics();
      ensureGooeyDripPhysics();
    });
  },
  { flush: "post", immediate: true }
);

function linkifyMessageHtml(html: string) {
  const root = document.createElement("div");
  root.innerHTML = html || "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.parentElement?.closest("a, code, pre") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
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
  const anchors = [...root.querySelectorAll<HTMLAnchorElement>("a[href]")];
  if (anchors.length === 1 && (root.textContent || "").trim() === (anchors[0].textContent || "").trim()) {
    anchors[0].classList.add("collapsible-message-url");
    anchors[0].setAttribute("aria-expanded", "false");
  }
  return root.innerHTML;
}

function stopMentionedMusic(message: MessageDTO) {
  const payload = musicMentionPayload(message);
  if (!payload || currentMusicTrackId.value !== payload.musicTrackId) return;
  stopMusic();
}

function unreadCountFor(channelId: number) {
  return store.unreadCounts[channelId] ?? 0;
}

const otherChannelUnreadCount = computed(() => store.channels.reduce((total, channel) => {
  if (channel.id === store.currentChannelId || channel.kind === "music") return total;
  return total + unreadCountFor(channel.id);
}, 0));

function favoriteNotificationAcknowledgementKey() {
  return store.account ? `team-chat-favorite-notification-acknowledged-${store.account.id}` : "";
}

function loadAcknowledgedFavoriteNotificationIds() {
  const key = favoriteNotificationAcknowledgementKey();
  if (!key) return new Set<number>();
  try {
    const ids = JSON.parse(localStorage.getItem(key) || "[]");
    return new Set(Array.isArray(ids) ? ids.map(Number).filter(Number.isFinite) : []);
  } catch {
    return new Set<number>();
  }
}

function acknowledgeFavoriteNotificationId(notificationId: number) {
  if (acknowledgedFavoriteNotificationIds.value.has(notificationId)) return;
  acknowledgedFavoriteNotificationIds.value = new Set([...acknowledgedFavoriteNotificationIds.value, notificationId]);
  const key = favoriteNotificationAcknowledgementKey();
  if (key) localStorage.setItem(key, JSON.stringify([...acknowledgedFavoriteNotificationIds.value].slice(-500)));
  store.favoriteNotifications = store.favoriteNotifications.filter((item) => item.id !== notificationId);
}

const { text: composerPromptText, phase: composerPromptPhase, chars: composerPromptChars, charStyle: composerPromptCharStyle, stop: stopComposerPlaceholder } = useComposerPlaceholder({
  getPrompts: () => store.appearance.composerPrompts || [],
  getHoldSeconds: () => cleanComposerPromptIntervalSeconds(store.appearance.composerPromptIntervalSeconds),
  getAppearSeconds: () => cleanComposerPromptAppearSeconds(store.appearance.composerPromptAppearSeconds),
  getDisappearSeconds: () => cleanComposerPromptDisappearSeconds(store.appearance.composerPromptDisappearSeconds),
  getGapSeconds: () => cleanComposerPromptGapSeconds(store.appearance.composerPromptGapSeconds)
});

function isNearMessageBottom(distance = 96) {
  const el = scroller.value;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < distance;
}

function messageBottomDistance(root = scroller.value) {
  if (!root) return 0;
  return Math.max(0, root.scrollHeight - root.scrollTop - root.clientHeight);
}

function currentNewestViewportState(root = scroller.value) {
  return {
    distanceFromBottom: messageBottomDistance(root),
    hasNewerMessages: store.hasNewerMessages
  };
}

function syncNewestIndicators(root = scroller.value) {
  if (!root) return;
  awayFromNewest.value = !isChatViewportAtNewest(currentNewestViewportState(root), 120);
  if (!awayFromNewest.value) hasUnreadMessages.value = false;
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

let lastSavedReadPositionSignature = "";
let readPositionSaveTimer: number | undefined;

function saveReadPosition() {
  if (pendingReadPositionRestore.value) return null;
  const root = scroller.value;
  const key = readPositionStorageKey();
  if (!root || !key || !store.messages.length) return null;
  const firstVisible = visibleMessageElements()[0];
  const messageId = Number(firstVisible?.dataset.messageId || 0);
  const rootTop = root.getBoundingClientRect().top;
  const position: SavedReadPosition = isChatViewportAtNewest(currentNewestViewportState(root))
    ? newestPositionForSessionEntry()
    : {
      messageId,
      offset: firstVisible ? firstVisible.getBoundingClientRect().top - rootTop : 0,
      atBottom: false,
      scrollTop: root.scrollTop,
      savedAt: Date.now()
    };
  const signature = [key, position.messageId, position.atBottom, Math.round(position.offset), Math.round(position.scrollTop)].join("|");
  if (signature !== lastSavedReadPositionSignature) {
    localStorage.setItem(key, JSON.stringify(position));
    lastSavedReadPositionSignature = signature;
  }
  return position;
}

function scheduleSaveReadPosition() {
  if (readPositionSaveTimer !== undefined) window.clearTimeout(readPositionSaveTimer);
  readPositionSaveTimer = window.setTimeout(() => {
    readPositionSaveTimer = undefined;
    saveReadPosition();
  }, 400);
}

function loadSavedReadPosition(): SavedReadPosition | null {
  const key = readPositionStorageKey();
  if (!key) return null;
  try {
    return normalizeSavedReadPosition(JSON.parse(localStorage.getItem(key) || "null"));
  } catch {
    return null;
  }
}

function handlePageHideFlush() {
  saveReadPosition();
  flushPendingPersists();
}

function finishReadPositionRestore(token: number) {
  if (token !== readPositionRestoreToken) return;
  pendingReadPositionRestore.value = false;
  initialChatAnchorPending.value = false;
}

async function restoreSavedReadPosition() {
  const token = ++readPositionRestoreToken;
  pendingTimelineAnchor = null;
  await nextTick();
  if (token !== readPositionRestoreToken || store.loadingInitialMessages) return;
  const root = scroller.value;
  if (!root) {
    finishReadPositionRestore(token);
    return;
  }
  const position = loadSavedReadPosition();
  if (!position) {
    scrollBottom(false);
    finishReadPositionRestore(token);
    return;
  }
  if (String(position.messageId) === newestReadPositionKey) {
    await scrollToNewest(false);
    finishReadPositionRestore(token);
    return;
  }
  if (shouldRestoreNewestPosition({
    atBottom: position.atBottom,
    hasNewerMessages: store.hasNewerMessages,
    distanceFromBottom: Number.POSITIVE_INFINITY
  })) {
    scrollBottom(false);
    finishReadPositionRestore(token);
    return;
  }
  if (typeof position.messageId === "number" && position.messageId) {
    await loadUntilMessageVisible(position.messageId, token);
    if (token !== readPositionRestoreToken) return;
    await nextTick();
    const currentRoot = scroller.value;
    const target = currentRoot?.querySelector<HTMLElement>(`[data-message-id="${position.messageId}"]`);
    if (target && currentRoot) {
      const rootTop = currentRoot.getBoundingClientRect().top;
      currentRoot.scrollTop += target.getBoundingClientRect().top - rootTop - position.offset;
      if (shouldRestoreNewestPosition({
        atBottom: false,
        hasNewerMessages: store.hasNewerMessages,
        distanceFromBottom: messageBottomDistance(currentRoot)
      })) {
        scrollBottom(false);
      } else {
        activeReadAnchor = { kind: "message", messageId: position.messageId, offset: position.offset, expiresAt: Date.now() + 2500, token };
      }
      hasUnreadMessages.value = false;
      finishReadPositionRestore(token);
      return;
    }
  }
  root.scrollTop = position.scrollTop;
  hasUnreadMessages.value = false;
  finishReadPositionRestore(token);
}

function reconcileReadPositionAfterLayout() {
  const anchor = activeReadAnchor;
  if (!anchor) {
    syncNewestIndicators();
    return;
  }
  if (!shouldApplyChatReadAnchor(anchor, activeReadAnchor, readPositionRestoreToken)) {
    if (activeReadAnchor === anchor) activeReadAnchor = null;
    syncNewestIndicators();
    return;
  }
  requestAnimationFrame(() => {
    const root = scroller.value;
    if (!root || !shouldApplyChatReadAnchor(anchor, activeReadAnchor, readPositionRestoreToken)) {
      syncNewestIndicators(root);
      return;
    }
    if (anchor.kind === "newest") {
      root.scrollTop = root.scrollHeight + 1000;
      syncVirtualTimelineViewport(root);
      hasUnreadMessages.value = false;
      awayFromNewest.value = false;
      return;
    }
    const target = root.querySelector<HTMLElement>(`[data-message-id="${anchor.messageId}"]`);
    if (!target) {
      syncNewestIndicators(root);
      return;
    }
    const delta = target.getBoundingClientRect().top - root.getBoundingClientRect().top - anchor.offset;
    if (Math.abs(delta) > 0.5) root.scrollTop += delta;
    syncVirtualTimelineViewport(root);
    syncNewestIndicators(root);
  });
}

function stopFollowingNewest() {
  activeReadAnchor = null;
  clearBlankScoreLongPress();
}

function handleTimelineScrollIntent() {
  if (scroller.value) pendingTimelineAnchor = visibleTimelineAnchor(scroller.value);
  chatScrollIntentTracker.begin(currentNewestViewportState());
  stopFollowingNewest();
  markTimelineScrolling();
}

function handleMessagesPointerDown(event: PointerEvent) {
  if (event.target === scroller.value) {
    chatScrollIntentTracker.begin(currentNewestViewportState());
    stopFollowingNewest();
  }
  beginBlankScoreLongPress(event);
}

async function restoreChatSurface() {
  await nextTick();
  pendingReadPositionRestore.value = true;
  await restoreSavedReadPosition();
  reconcileReadPositionAfterLayout();
}

async function jumpToMessageInChannel(channelId: number, messageId: number) {
  pendingMessageJumpId = messageId;
  readPositionRestoreToken += 1;
  activeReadAnchor = null;
  chatScrollIntentTracker.reset();
  pendingReadPositionRestore.value = false;
  try {
    if (store.currentChannelId !== channelId) {
      saveReadPosition();
      await switchVisibleChannel(channelId);
    }
    showFavorites.value = false;
    showBibleFavorites.value = false;
    showChannels.value = false;
    await nextTick();
    await jumpToReply(messageId);
  } finally {
    pendingMessageJumpId = null;
    pendingReadPositionRestore.value = false;
  }
}

async function openTopNotice(notice: TopNotice) {
  if (!notice.channelId || !notice.messageId) return;
  await jumpToMessageInChannel(notice.channelId, notice.messageId);
  if (notice.kind === "mention") acknowledgeMentionId(notice.messageId);
  if (notice.kind === "like" && notice.notificationId) await dismissLikeNotification(notice.notificationId);
  if (notice.kind === "favorite" && notice.notificationId) acknowledgeFavoriteNotificationId(notice.notificationId);
}

async function doLogin() {
  loginError.value = "";
  try {
    const account = authMode.value === "reception"
      ? await joinReception(username.value.trim(), displayName.value.trim(), receptionInviteToken || undefined)
      : authMode.value === "register"
        ? await register(username.value.trim(), displayName.value.trim(), password.value)
        : await login(username.value.trim(), password.value);
    if (isReceptionInviteRoute) window.history.replaceState({}, "", "/");
    await store.afterLogin(account);
    await activateMusicAccount(account.id);
    await loadMusicPlaylists();
    await loadMusicTracks();
    attachMusicSocket();
    if (isAiSettingsRoute.value) {
      if (account.isAdmin) {
        await loadAiSettings();
        await loadVirtualCharacters().catch(() => { virtuals.value = []; });
        void loadMcStatus();
      }
      return;
    }
    if (isLogRoute.value) {
      if (account.isAdmin) await loadAdminLoginLogs();
      return;
    }
    await switchToLinkedChannel();
    pendingReadPositionRestore.value = true;
    await restoreSavedReadPosition();
  } catch (error) {
    loginError.value = error instanceof Error ? error.message : authMode.value === "reception" ? "无法进入会客厅" : authMode.value === "register" ? "注册失败" : "登录失败";
  }
}

async function switchToLinkedChannel() {
  const params = new URLSearchParams(window.location.search);
  const channelId = Number(params.get("channelId") || 0);
  if (!channelId || !store.channels.some((channel) => channel.id === channelId)) return;
  saveReadPosition();
  await switchVisibleChannel(channelId);
  params.delete("channelId");
  const nextQuery = params.toString();
  window.history.replaceState({}, "", `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash}`);
}

async function openSettings(tab: SettingsTab = "account") {
  saveReadPosition();
  showSettings.value = true;
  await selectSettingsTab(tab);
}

function versionNoticeStorageKey(accountId: number) {
  return `team-chat-last-noticed-version:${accountId}`;
}

function initializeVersionUpdateNotice(accountId: number) {
  const key = versionNoticeStorageKey(accountId);
  const previousVersion = localStorage.getItem(key);
  versionUpdateNotice.value = previousVersion !== APP_VERSION
    ? `聊天室刚刚更新到版本 ${APP_VERSION}`
    : "";
}

async function openVersionUpdateNotice() {
  if (store.account?.id) localStorage.setItem(versionNoticeStorageKey(store.account.id), APP_VERSION);
  versionUpdateNotice.value = "";
  await openSettings("release");
}

async function selectSettingsTab(tab: typeof settingsTab.value) {
  settingsTab.value = tab;
  settingsLoadError.value = "";
  try {
    if (tab === "account") syncAccountSettings();
    if (tab === "devices") await loadDevices();
    if (tab === "notifications") await loadNotificationSettings();
    if (tab === "release") await Promise.all([checkServerVersion(), ensureReleaseHistory()]);
  } catch (error) {
    settingsLoadError.value = error instanceof Error ? error.message : "设置加载失败";
  }
}

async function uploadOwnAvatar(event: Event) {
  const inputElement = event.target as HTMLInputElement;
  const file = inputElement.files?.[0];
  if (!file) return;
  accountAvatarBusy.value = true;
  accountProfileMsg.value = "";
  try {
    const form = new FormData();
    form.append("file", file);
    const result = await api<{ success: true; account: AccountDTO }>("/api/me/avatar", { method: "POST", body: form });
    store.account = result.account;
    accountProfileMsg.value = "头像已更新";
  } catch (error) {
    accountProfileMsg.value = error instanceof Error ? error.message : "头像更新失败";
  } finally {
    accountAvatarBusy.value = false;
    inputElement.value = "";
  }
}

async function saveOwnProfile() {
  const nextDisplayName = accountDisplayName.value.trim();
  if (!nextDisplayName) {
    accountProfileMsg.value = "请输入昵称";
    return;
  }
  accountProfileBusy.value = true;
  accountProfileMsg.value = "";
  try {
    const result = await api<{ success: true; account: AccountDTO }>("/api/me/profile", {
      method: "PATCH",
      body: JSON.stringify({ displayName: nextDisplayName })
    });
    store.account = result.account;
    accountDisplayName.value = result.account.displayName;
    accountProfileMsg.value = "昵称已保存";
  } catch (error) {
    accountProfileMsg.value = error instanceof Error ? error.message : "昵称保存失败";
  } finally {
    accountProfileBusy.value = false;
  }
}

async function changeOwnPassword() {
  if (accountNewPassword.value.length < 10) {
    accountPasswordMsg.value = "新密码至少需要 10 位";
    return;
  }
  if (accountNewPassword.value !== accountConfirmPassword.value) {
    accountPasswordMsg.value = "两次输入的新密码不一致";
    return;
  }
  accountPasswordBusy.value = true;
  accountPasswordMsg.value = "";
  try {
    await api<{ success: true }>("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ oldPassword: accountCurrentPassword.value, newPassword: accountNewPassword.value })
    });
    accountCurrentPassword.value = "";
    accountNewPassword.value = "";
    accountConfirmPassword.value = "";
    accountPasswordMsg.value = "密码已修改，其他设备已退出登录";
  } catch (error) {
    accountPasswordMsg.value = error instanceof Error ? error.message : "密码修改失败";
  } finally {
    accountPasswordBusy.value = false;
  }
}

async function deleteOwnAccount() {
  if (!accountDeletePassword.value) {
    accountDeleteMsg.value = "请输入当前密码";
    return;
  }
  if (!window.confirm("确定永久删除账号吗？账号数据无法恢复，历史消息会显示为“已注销用户”。")) return;
  accountDeleteBusy.value = true;
  accountDeleteMsg.value = "";
  try {
    await api<{ success: true }>("/api/me/account", {
      method: "DELETE",
      body: JSON.stringify({ password: accountDeletePassword.value })
    });
    showSettings.value = false;
    await logoutApp(false);
  } catch (error) {
    accountDeleteMsg.value = error instanceof Error ? error.message : "账号删除失败";
  } finally {
    accountDeleteBusy.value = false;
  }
}

async function closeSettingsPanel() {
  showSettings.value = false;
  await restoreChatSurface();
}

async function returnToChat() {
  isAiSettingsRoute.value = false;
  isLogRoute.value = false;
  window.history.pushState({}, "", "/");
  await restoreChatSurface();
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
  if (subscription && notificationPermission.value === "granted" && result.pushReady) {
    await api("/api/push-subscriptions", { method: "POST", body: JSON.stringify(subscription.toJSON()) }).catch(() => null);
  }
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
    await Promise.all(keys.filter((key) => key.startsWith("team-chat-app-")).map((key) => caches.delete(key)));
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
    const params = selectedUpdateBranch.value ? `?branch=${encodeURIComponent(selectedUpdateBranch.value)}` : "";
    const result = await api<UpdateCheckDTO>(`/api/admin/update/check${params}`);
    updateCheck.value = result;
    selectedUpdateBranch.value = result.branch;
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
    await api("/api/admin/update/start", { method: "POST", body: JSON.stringify({ branch: selectedUpdateBranch.value || updateCheck.value?.branch }) });
  } catch {
    // Restart may interrupt the request; the status poll will pick up progress when the server returns.
  } finally {
    await loadUpdateStatus();
    startUpdatePolling();
    updateBusy.value = false;
  }
}

function syncComposerHeight() {
  const textarea = composerInput.value;
  if (!textarea) return;
  textarea.style.height = "auto";
  const height = composerHeightForContent(textarea.scrollHeight);
  textarea.style.height = `${height}px`;
  textarea.style.overflowY = textarea.scrollHeight > height ? "auto" : "hidden";
}

function chooseMusicMentionSuggestion(track: MusicTrackDTO) {
  const token = musicMentionToken.value;
  const start = token?.start ?? input.value.length;
  const end = token?.end ?? input.value.length;
  const mention = `@@${track.title} `;
  input.value = `${input.value.slice(0, start)}${mention}${input.value.slice(end)}`;
  selectedMusicMention.value = track;
  composerPanel.value = null;
  composerSuggestionSuppressed.value = true;
  nextTick(() => {
    composerInput.value?.focus();
    const cursor = Math.min(start + mention.length, input.value.length);
    composerInput.value?.setSelectionRange(cursor, cursor);
    syncComposerCaret();
  });
}

function chooseActiveComposerSuggestion() {
  const index = Math.min(composerSuggestionIndex.value, Math.max(0, composerSuggestionCount.value - 1));
  if (activeComposerSuggestionKind.value === "music") {
    const track = matchingMusicMentionTracks.value[index];
    if (track) chooseMusicMentionSuggestion(track);
    return;
  }
  if (activeComposerSuggestionKind.value === "mention") {
    const member = matchingMentionMembers.value[index];
    if (member) chooseMentionSuggestion(member);
    return;
  }
  const command = matchingSlashCommands.value[index];
  if (command) chooseSlashCommand(command);
}

function openBookWorkspace() {
  showChannels.value = false;
  showMembers.value = false;
  bibleOpen.value = false;
  sermonWorkspaceOpen.value = false;
  bookWorkspaceOpen.value = true;
}

function closeBookWorkspace() {
  bookWorkspaceOpen.value = false;
}

// 圣经负一屏与讲道台负一屏共用同一套“打开时暂停聊天区动效、关闭时恢复”的生命周期。
watch(() => bibleOpen.value || sermonWorkspaceOpen.value || bookWorkspaceOpen.value, async (open) => {
  if (open) {
    if (parallaxFrame) window.cancelAnimationFrame(parallaxFrame);
    parallaxFrame = 0;
    pendingParallaxDelta = 0;
    pendingWallpaperPanDelta = 0;
    wallpaperPanResizeObserver?.disconnect();
    messageEffectObserver?.disconnect();
    stopRainEffect();
    stopDripPhysics(true);
    stopGooeyDripPhysics(true);
    syncFlashEffectTimer();
    return;
  }
  await nextTick();
  observeWallpaperPanViewport();
  await resetWallpaperPan();
  await restoreChatSurface();
  refreshTimelineMeasurements();
  refreshMessageEffectObserver();
  preloadMessageImages(store.messages);
  syncFlashEffectTimer();
});

function handleBibleSwipeStart(event: TouchEvent) {
  if (bibleOpen.value || sermonWorkspaceOpen.value || showAdmin.value || showSettings.value || previewMessage.value) return;
  const touch = event.touches[0];
  const target = event.target as HTMLElement | null;
  if (!touch || touch.clientX <= 20 || target?.closest("button, input, textarea, select, a, video, audio, [contenteditable='true'], [role='button'], [data-no-bible-swipe]")) {
    bibleSwipeStart = null;
    return;
  }
  bibleSwipeStart = { x: touch.clientX, y: touch.clientY };
}

function handleBibleSwipeEnd(event: TouchEvent) {
  const touch = event.changedTouches[0];
  if (!touch || !bibleSwipeStart) return;
  const deltaX = touch.clientX - bibleSwipeStart.x;
  const deltaY = touch.clientY - bibleSwipeStart.y;
  bibleSwipeStart = null;
  if (deltaX >= 64 && Math.abs(deltaX) > Math.abs(deltaY) * 1.4) openBibleWorkspace();
}

function replaceChannelSnapshot(channel?: ChannelDTO | null, options: { addToStore?: boolean; addToAdmin?: boolean } = {}) {
  if (!channel) return;
  const storeIndex = store.channels.findIndex((row) => row.id === channel.id);
  if (storeIndex >= 0) store.channels[storeIndex] = channel;
  else if (options.addToStore) store.channels = [...store.channels, channel];
  const adminIndex = adminChannels.value.findIndex((row) => row.id === channel.id);
  if (adminIndex >= 0) adminChannels.value[adminIndex] = { ...adminChannels.value[adminIndex], ...channel };
  else if (options.addToAdmin && adminChannels.value.length) {
    adminChannels.value = [...adminChannels.value, { ...channel, messageCount: 0, createdAt: new Date().toISOString(), lastMessageAt: null }];
  }
  if (memberPaneChannelOverride.value?.id === channel.id) memberPaneChannelOverride.value = channel;
  syncChannelEdits();
}

function closeComposerMorePanel() {
  if (composerPanel.value === "more") composerPanel.value = null;
}

function openSermonWorkspace() {
  sermonEntryOpen.value = true;
  composerPanel.value = null;
}

function openOwnSermonWorkspace() {
  sermonEntryOpen.value = false;
  sermonWorkspaceMounted.value = true;
  showChannels.value = false;
  showMembers.value = false;
  bibleOpen.value = false;
  sermonWorkspaceOpen.value = true;
  composerPanel.value = null;
}

watch(sermonRequestDecision, (event) => {
  if (!event) return;
  sermonDecisionNotice.value = event.approve
    ? `你的讲道权限申请已批准${event.until ? `，有效期至 ${adminDateTime(event.until)}` : "（长期有效）"}`
    : "你的讲道权限申请未通过";
  if (event.approve) void refreshSermonPresenterStatus().catch(() => undefined);
  if (sermonDecisionTimer !== undefined) window.clearTimeout(sermonDecisionTimer);
  sermonDecisionTimer = window.setTimeout(() => {
    sermonDecisionNotice.value = "";
    sermonDecisionTimer = undefined;
  }, 8000);
});

function isMessageEffectPaused(message: MessageDTO) {
  return !shouldRenderMessageEffect({
    manuallyPaused: pausedEffectIds.value.has(message.id),
    visibilityKnown: observedEffectIds.value.has(message.id),
    visible: visibleEffectIds.value.has(message.id),
    documentVisible: documentVisible.value
  });
}

function handleMessageEffectIntersections(entries: IntersectionObserverEntry[]) {
  const observed = new Set(observedEffectIds.value);
  const visible = new Set(visibleEffectIds.value);
  for (const entry of entries) {
    const id = messageIdForEffectElement(entry.target);
    if (id === null) continue;
    observed.add(id);
    if (entry.isIntersecting && entry.intersectionRatio > 0) visible.add(id);
    else visible.delete(id);
  }
  updateEffectVisibility(observed, visible);
  ensureDripPhysics();
  ensureGooeyDripPhysics();
  syncFlashEffectTimer();
}

function refreshMessageEffectObserver() {
  messageEffectObserver?.disconnect();
  messageEffectObserver = null;
  const root = scroller.value;
  if (!root || typeof IntersectionObserver === "undefined") {
    updateEffectVisibility(new Set(), new Set());
    return;
  }

  const observed = new Set<number>();
  const visible = new Set<number>();
  const rootRect = root.getBoundingClientRect();
  messageEffectObserver = new IntersectionObserver(handleMessageEffectIntersections, {
    root: scroller.value,
    rootMargin: "0px",
    threshold: 0.01
  });
  for (const bubble of root.querySelectorAll<HTMLElement>("[data-message-effect]")) {
    const observationTarget = bubble.closest<HTMLElement>(".message-row[data-message-id]");
    if (!observationTarget) continue;
    const id = messageIdForEffectElement(bubble);
    if (id === null) continue;
    observed.add(id);
    const rect = observationTarget.getBoundingClientRect();
    if (rect.bottom >= rootRect.top && rect.top <= rootRect.bottom) visible.add(id);
    messageEffectObserver.observe(observationTarget);
  }
  updateEffectVisibility(observed, visible);
}

function handleDocumentVisibilityChange() {
  documentVisible.value = document.visibilityState === "visible";
  if (!documentVisible.value) {
    saveReadPosition();
    clearMusicLyricsHeaderResumeTimer();
    handleRecordingVisibilityChange(false);
    stopRainEffect();
    stopDripPhysics(true);
    stopGooeyDripPhysics(true);
    oopsPhysicsLayer.value?.reset();
  } else {
    handleRecordingVisibilityChange(true);
    if (musicLyricsHeaderSuppressed.value) scheduleMusicLyricsHeaderResume();
    nextTick(() => {
      refreshMessageEffectObserver();
      ensureDripPhysics();
      ensureGooeyDripPhysics();
    });
  }
  syncFlashEffectTimer();
}

function messageEffectClass(message: MessageDTO) {
  const effect = messageEffect(message);
  if (!effect || isMessageEffectPaused(message)) return {};
  return {
    "message-effect-flash": effect === "flash",
    "message-effect-shine": effect === "shine",
    "message-effect-shake": effect === "shake",
    "message-effect-fly": effect === "fly",
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

function beginBlankScoreLongPress(event: PointerEvent) {
  clearBlankScoreLongPress();
  if (event.button !== 0 || !musicScoreTriggerVisible.value || musicScoreOpen.value) return;
  const target = event.target;
  if (
    target instanceof Element &&
    target.closest(".bubble, .avatar, .sender-line, .time-separator, button, a, input, textarea, img, audio, video, iframe")
  ) return;
  blankScoreLongPressStartedAt = { x: event.clientX, y: event.clientY };
  blankScoreLongPressTimer = window.setTimeout(() => {
    blankScoreLongPressTimer = undefined;
    navigator.vibrate?.(12);
    openMusicScore();
  }, longPressMs);
}

function moveBlankScoreLongPress(event: PointerEvent) {
  if (!blankScoreLongPressTimer) return;
  const distance = Math.hypot(event.clientX - blankScoreLongPressStartedAt.x, event.clientY - blankScoreLongPressStartedAt.y);
  if (distance > 10) clearBlankScoreLongPress();
}

function clearBlankScoreLongPress() {
  if (blankScoreLongPressTimer) window.clearTimeout(blankScoreLongPressTimer);
  blankScoreLongPressTimer = undefined;
}

function isManageableMusicMessage(message: MessageDTO) {
  return isMusicChannel.value &&
    message.type === "file" &&
    /\.(mp3|m4a)$/i.test(message.fileName || "") &&
    (canManageMusic.value || musicTracks.value.some((track) => track.id === message.id && track.canManage));
}

function openMusicTrackInManager() {
  const message = pendingMessageActions.value;
  if (!message || !isManageableMusicMessage(message)) return;
  closeMessageActionMenu();
  openMusicManager({ kind: "track", id: message.id });
}

function musicScoreRequestUrl(page: MusicScorePageDTO) {
  if (!page.scoreId) return "";
  return `/api/music/scores/${page.scoreId}/pages/${page.id}`;
}

function musicScorePageUrl(page: MusicScorePageDTO) {
  const cachedUrl = musicScoreCachedUrls.value[page.id];
  if (cachedUrl) return cachedUrl;
  const requestUrl = musicScoreRequestUrl(page);
  return requestUrl ? `${requestUrl}?token=${encodeURIComponent(getToken())}` : "";
}

function clearMusicScoreCache() {
  musicScoreCacheGeneration += 1;
  for (const url of Object.values(musicScoreCachedUrls.value)) URL.revokeObjectURL(url);
  musicScoreCachedUrls.value = {};
  musicScorePreloadPromises.clear();
}

async function preloadMusicScorePage(page: MusicScorePageDTO) {
  const cachedUrl = musicScoreCachedUrls.value[page.id];
  if (cachedUrl) return cachedUrl;
  const pending = musicScorePreloadPromises.get(page.id);
  if (pending) return pending;
  const generation = musicScoreCacheGeneration;
  const request = (async () => {
    const response = await fetch(musicScoreRequestUrl(page), { headers: authHeaders() });
    if (!response.ok) throw new Error(`歌谱预加载失败：HTTP ${response.status}`);
    const blob = await response.blob();
    if (!blob.size) throw new Error("歌谱预加载失败：文件为空");
    const objectUrl = URL.createObjectURL(blob);
    if (generation !== musicScoreCacheGeneration) {
      URL.revokeObjectURL(objectUrl);
      return "";
    }
    musicScoreCachedUrls.value = { ...musicScoreCachedUrls.value, [page.id]: objectUrl };
    return objectUrl;
  })()
    .catch(() => "")
    .finally(() => musicScorePreloadPromises.delete(page.id));
  musicScorePreloadPromises.set(page.id, request);
  return request;
}

async function preloadMusicScorePages(tracks: ReadonlyArray<{ scores?: MusicScoreDTO[] }>) {
  const pages = tracks.flatMap((track) => (track.scores || []).flatMap((score) => score.pages)).filter((page) => !isPdfScorePage(page));
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < pages.length) {
      const page = pages[nextIndex];
      nextIndex += 1;
      await preloadMusicScorePage(page);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, pages.length) }, worker));
}

function musicScorePreviewPage(message: MessageDTO) {
  return message.scores?.[0]?.pages[0] || musicTracks.value.find((track) => track.id === message.id)?.scores[0]?.pages[0] || null;
}

function isPdfScorePage(page: MusicScorePageDTO) {
  return page.fileName.toLowerCase().endsWith(".pdf");
}

async function openMusicScorePreview(page: MusicScorePageDTO, trackId = currentMusicTrack.value?.id) {
  if (!trackId) return;
  const isPdf = isPdfScorePage(page);
  const url = isPdf ? musicScorePageUrl(page) : (await preloadMusicScorePage(page)) || musicScorePageUrl(page);
  if (!url) return;
  previewPinnedImage.value = { url, fileName: page.fileName, score: true, trackId, pageId: page.id };
  previewMessage.value = {
    id: -page.id,
    channelId: store.currentChannelId,
    sender: { id: 0, kind: "system", username: "score", displayName: "歌谱" },
    content: "",
    type: isPdf ? "file" : "image",
    fileName: page.fileName,
    fileSize: page.fileSize,
    createdAt: new Date().toISOString()
  };
  pendingDownload.value = null;
  resetImagePreviewTransform();
}

function shiftMusicScorePreview(delta: number) {
  const index = previewScorePageIndex.value;
  const trackId = previewPinnedImage.value?.trackId;
  const pages = previewScorePages.value;
  if (!trackId || index < 0 || !pages.length) return;
  const nextIndex = (index + delta + pages.length) % pages.length;
  openMusicScorePreview(pages[nextIndex], trackId);
}

function openMusicScore() {
  if (!currentMusicScorePages.value.length) return;
  clearMusicScoreTimer();
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  musicScoreClosing.value = false;
  musicScoreStageClosing.value = false;
  musicScoreStageVisible.value = reduceMotion;
  musicScoreOpen.value = true;
  prepareMusicScoreExitSequence();
  musicScoreChatCleared.value = true;
  showChatToolsMenu.value = false;
  closeMusicSurface();
  if (!reduceMotion) {
    setMusicScoreTimer(MUSIC_SCORE_CHAT_DURATION_MS, () => {
      if (musicScoreOpen.value && !musicScoreClosing.value) musicScoreStageVisible.value = true;
    });
  }
}

function prepareMusicScoreExitSequence() {
  const root = scroller.value;
  if (!root) return;
  const viewport = root.getBoundingClientRect();
  const rows = Array.from(root.querySelectorAll<HTMLElement>(".score-exit-left, .score-exit-right"));
  rows.forEach((row) => row.style.setProperty("--score-delay", "0ms"));
  rows
    .filter((row) => {
      const rect = row.getBoundingClientRect();
      return rect.bottom >= viewport.top && rect.top <= viewport.bottom;
    })
    .sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top)
    .forEach((row, index) => row.style.setProperty("--score-delay", `${Math.min(index, 12) * 45}ms`));
}

function closeMusicScore(immediate = false) {
  if (!musicScoreOpen.value) return;
  if (musicScoreClosing.value && !immediate) return;
  clearMusicScoreTimer();
  if (immediate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    resetMusicScoreState();
    return;
  }
  musicScoreClosing.value = true;
  if (!musicScoreStageVisible.value) {
    musicScoreChatCleared.value = false;
    setMusicScoreTimer(MUSIC_SCORE_CHAT_DURATION_MS, resetMusicScoreState);
    return;
  }
  musicScoreStageClosing.value = true;
  setMusicScoreTimer(MUSIC_SCORE_STAGE_DURATION_MS, () => {
    musicScoreStageVisible.value = false;
    musicScoreStageClosing.value = false;
    musicScoreChatCleared.value = false;
    setMusicScoreTimer(MUSIC_SCORE_CHAT_DURATION_MS, resetMusicScoreState);
  });
}

function clearMusicScoreTimer() {
  if (!musicScoreTimer) return;
  window.clearTimeout(musicScoreTimer);
  musicScoreTimer = undefined;
}

function setMusicScoreTimer(delay: number, callback: () => void) {
  clearMusicScoreTimer();
  musicScoreTimer = window.setTimeout(() => {
    musicScoreTimer = undefined;
    callback();
  }, delay);
}

function resetMusicScoreState() {
  clearMusicScoreTimer();
  musicScoreOpen.value = false;
  musicScoreClosing.value = false;
  musicScoreChatCleared.value = false;
  musicScoreStageVisible.value = false;
  musicScoreStageClosing.value = false;
}

function toggleMusicScore() {
  if (musicScoreOpen.value) closeMusicScore();
  else openMusicScore();
}

function reconcileOpenMusicScore() {
  if (musicScoreOpen.value && !shouldKeepMusicScoreForTrack(currentMusicScorePages.value.length)) closeMusicScore();
}

function expandLongMessageUrl(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target : null;
  const link = target?.closest<HTMLAnchorElement>("a.collapsible-message-url");
  if (!link || link.classList.contains("expanded")) return false;
  const isOverflowing = link.scrollHeight > link.clientHeight + 1;
  if (!isOverflowing) return false;
  event.preventDefault();
  event.stopPropagation();
  link.classList.add("expanded");
  link.setAttribute("aria-expanded", "true");
  return true;
}

function handleBubbleClick(message: MessageDTO, event: MouseEvent) {
  if (Date.now() < suppressNextTapUntil) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (messageSelectionMode.value && message.id > 0) {
    toggleMessageSelected(message);
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (expandLongMessageUrl(event)) return;
  acknowledgeMentionAlert(message);
  if (messageEffect(message) === "oops") {
    const target = event.target instanceof Element ? event.target : null;
    const bubble = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    if (oopsActiveMessageIds.value.has(message.id)) {
      oopsPhysicsLayer.value?.restore(message.id);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const textRoot = target?.closest<HTMLElement>(".message-text");
    const interactiveTarget = target?.closest("a, button, .inline-bible-reference, .markdown-render");
    if (bubble && textRoot && bubble.contains(textRoot) && !interactiveTarget && message.type === "text" && !isMarkdownMessage(message)) {
      void oopsPhysicsLayer.value?.start(message.id, bubble, textRoot);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
  }
  if (toggleMessageEffect(message)) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (message.type !== "chain") return;
  event.stopPropagation();
  confirmJoinChain(message, event);
}

function handleOopsActiveChange(change: { messageId: number; active: boolean }) {
  const next = new Set(oopsActiveMessageIds.value);
  if (change.active) next.add(change.messageId);
  else next.delete(change.messageId);
  oopsActiveMessageIds.value = next;
}

async function jumpToReply(id: number) {
  const root = scroller.value;
  let el = root?.querySelector<HTMLElement>(`[data-message-id="${id}"]`) || null;
  if (!el && id > 0) {
    await loadUntilMessageVisible(id);
    await nextTick();
    el = root?.querySelector<HTMLElement>(`[data-message-id="${id}"]`) || null;
  }
  if (el && root) {
    const contextOffset = Math.min(120, Math.max(56, root.clientHeight * 0.16));
    const targetTop = root.scrollTop + el.getBoundingClientRect().top - root.getBoundingClientRect().top - contextOffset;
    root.scrollTo({ top: Math.max(0, targetTop), behavior: "auto" });
    activeReadAnchor = {
      kind: "message",
      messageId: id,
      offset: contextOffset,
      expiresAt: Date.now() + 8_000,
      token: readPositionRestoreToken
    };
    reconcileReadPositionAfterLayout();
  } else {
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  el?.classList.add("flash");
  setTimeout(() => el?.classList.remove("flash"), 900);
}

async function ensureLoadedMessageRendered(id: number) {
  const root = scroller.value;
  if (!root || !store.messages.some((message) => message.id === id)) return false;
  if (root.querySelector(`[data-message-id="${id}"]`)) return true;
  if (!virtualTimelineActive.value) {
    await nextTick();
    return !!root.querySelector(`[data-message-id="${id}"]`);
  }
  const offset = virtualItemOffset(virtualTimelineItems.value, measuredTimelineHeights.value, `message:${id}`);
  if (offset === null) return false;
  const contextOffset = Math.min(120, Math.max(56, root.clientHeight * 0.16));
  root.scrollTop = Math.max(0, offset - contextOffset);
  syncVirtualTimelineViewport(root);
  await nextTick();
  refreshTimelineMeasurements();
  return !!root.querySelector(`[data-message-id="${id}"]`);
}

async function loadUntilMessageVisible(id: number, token = 0) {
  for (let attempts = 0; attempts < 30; attempts += 1) {
    if (token && token !== readPositionRestoreToken) return false;
    if (store.messages.some((message) => message.id === id)) return ensureLoadedMessageRendered(id);
    const positiveMessages = store.messages.filter((message) => message.id > 0);
    const oldest = positiveMessages[0]?.id || 0;
    const newest = positiveMessages[positiveMessages.length - 1]?.id || 0;
    if (oldest && id < oldest && (store.hasOlderMessages || store.prefetchedOlderMessages.length)) {
      const loaded = await store.loadOlderMessages();
      if (token && token !== readPositionRestoreToken) return false;
      await nextTick();
      if (!loaded) return false;
      continue;
    }
    if (newest && id > newest && store.hasNewerMessages) {
      const loaded = await store.loadNewerMessages();
      if (token && token !== readPositionRestoreToken) return false;
      await nextTick();
      if (!loaded) return false;
      continue;
    }
    return false;
  }
  return false;
}

function confirmJoinChain(message: MessageDTO, event?: MouseEvent) {
  chainPromptAnchor.value = event?.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  openChainJoin(message);
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
  if (musicPlayerExpanded.value && !target.closest("[data-music-player]")) {
    closeMusicSurface();
  }
  if (showChatToolsMenu.value && !target.closest("[data-chat-tools-menu]")) {
    showChatToolsMenu.value = false;
  }
  if (pendingChain.value && !target.closest("[data-chain-popover]") && !target.closest("[data-chain-bubble]")) {
    closeChainJoin();
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

function selectMusicTrack(track: MusicTrackDTO) {
  selectMusicTrackCore(track);
}

function openMusicPlayer() {
  musicPlayerExpanded.value = !musicPlayerExpanded.value;
  if (musicPlayerExpanded.value) {
    showChatToolsMenu.value = false;
    if (!musicPlaying.value) void playCurrentMusic();
  }
}

async function loadMusicTracks() {
  if (!store.account) return;
  try {
    const result = await api<{ tracks: MusicTrackDTO[] }>("/api/music/tracks");
    musicTracks.value = result.tracks;
    const byId = new Map(result.tracks.map((track) => [track.id, track]));
    musicPlaylists.value = musicPlaylists.value.map((playlist) => ({
      ...playlist,
      tracks: playlist.tracks.flatMap((track) => {
        const current = byId.get(track.id);
        return current ? [current] : [];
      }),
      trackCount: playlist.tracks.filter((track) => byId.has(track.id)).length
    }));
    // Warming every score page of the whole library costs dozens of MB on
    // startup; warm only the restored track's pages. The score viewer and
    // inline previews load pages on demand.
    const restoredTrackId = currentMusicTrack.value?.id;
    void preloadMusicScorePages(restoredTrackId ? result.tracks.filter((track) => track.id === restoredTrackId) : []);
    reconcileMusicTracks();
  } catch (error) {
    musicError.value = error instanceof Error ? error.message : "歌单加载失败";
  }
}

function openMusicManagerFromMiniPanel() {
  if (musicSourceKind.value === "playlist" && selectedMusicPlaylistId.value) {
    openMusicManager({ kind: "playlist", id: selectedMusicPlaylistId.value });
    return;
  }
  openMusicManager();
}

function sharedMusicPlaylistDescription(message: MessageDTO) {
  const description = messagePayloadRecord(message).description;
  return typeof description === "string" ? description.trim() : "";
}

async function openSharedMusicPlaylist(message: MessageDTO) {
  const playlist = message.musicPlaylist;
  if (!playlist) {
    alert("这个歌单已被删除");
    return;
  }
  if (!musicPlaylists.value.some((item) => item.id === playlist.id)) {
    const fresh = await api<{ playlist: MusicPlaylistDTO }>(`/api/music/playlists/${playlist.id}`).catch(() => null);
    musicPlaylists.value = [...musicPlaylists.value, fresh?.playlist || playlist];
  }
  openMusicManager({ kind: "playlist", id: playlist.id });
}

function openSharedMusicPlaylistFromTap(message: MessageDTO) {
  if (Date.now() < suppressNextTapUntil) return;
  void openSharedMusicPlaylist(message);
}

function handleActivitySocketConnect() {
  clearPresenceEmitCache();
  publishPresenceActivities();
  if (activityConnectRetryTimer) window.clearTimeout(activityConnectRetryTimer);
  activityConnectRetryTimer = window.setTimeout(() => {
    activityConnectRetryTimer = undefined;
    publishPresenceActivities();
  }, 700);
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

function openPinnedFromTicker() {
  if (!visiblePinned.value) return;
  pinnedExpanded.value = true;
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

function movePinnedBlock(index: number, direction: -1 | 1) {
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= pinnedEditBlocks.value.length) return;
  const blocks = [...pinnedEditBlocks.value];
  [blocks[index], blocks[targetIndex]] = [blocks[targetIndex], blocks[index]];
  pinnedEditBlocks.value = blocks;
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

async function uploadFile(file: File, options: { voice?: boolean; durationMs?: number; waveform?: number[]; pendingMessageId?: number; originalImage?: boolean } = {}) {
  if (!store.currentChannelId) return { success: false, duplicate: false, skipped: false };
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
    const result = await new Promise<{ success: boolean; duplicate?: boolean; skipped?: boolean; message?: MessageDTO; error?: string }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/files/upload");
      const headers = authHeaders();
      for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, String(value));
      xhr.upload.onprogress = (event) => {
        if (!options.pendingMessageId || !event.lengthComputable) return;
        setPendingUpload(options.pendingMessageId, { progress: Math.max(1, Math.round((event.loaded / event.total) * 92)), status: "uploading" });
      };
      xhr.onload = () => {
        let payload: { success?: boolean; duplicate?: boolean; skipped?: boolean; message?: MessageDTO; error?: string; messageText?: string } = {};
        try {
          payload = JSON.parse(xhr.responseText || "{}") as typeof payload;
        } catch {
          payload = { error: xhr.responseText || "上传失败" };
        }
        if (xhr.status >= 200 && xhr.status < 300 && payload.success && payload.message) {
          resolve({ success: true, duplicate: !!payload.duplicate, skipped: !!payload.skipped, message: payload.message });
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
      return { success: false, duplicate: false, skipped: false };
    }
    if (options.pendingMessageId) {
      if (result.skipped) {
        store.removeMessage(options.pendingMessageId);
      } else {
        setPendingUpload(options.pendingMessageId, { progress: 100, status: "processing", message: "正在发布" });
        replacePendingMessage(options.pendingMessageId, result.message);
      }
      removePendingUpload(options.pendingMessageId);
    }
    if (result.duplicate && !result.skipped && !isMusicChannel.value) alert("文件内容已经存在，已引用原文件并发送消息");
    composerPanel.value = null;
    return { success: true, duplicate: !!result.duplicate, skipped: !!result.skipped };
  } catch (error) {
    const message = error instanceof Error ? error.message : "上传失败";
    if (options.pendingMessageId) setPendingUpload(options.pendingMessageId, { status: "failed", message });
    else alert(message);
    return { success: false, duplicate: false, skipped: false };
  }
}

async function handlePickedFiles(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files || []);
  input.value = "";
  if (store.prayerOnly) {
    const image = files.find((file) => isImageFile(file));
    if (image) {
      clearPrayerComposerPhoto();
      prayerComposerPhoto.value = image;
      prayerComposerPhotoPreview.value = URL.createObjectURL(image);
      return;
    }
  }
  let skipped = 0;
  for (const file of files) {
    const result = await uploadPickedFile(file);
    if (result.skipped) skipped += 1;
  }
  if (skipped) alert(`已按文件内容跳过 ${skipped} 首重复歌曲`);
}

function isAudioMessage(message: MessageDTO) {
  return message.type === "file" && !isVideoMessage(message) && /\.(webm|mp3|m4a|wav|ogg|aac)$/i.test(message.fileName || "");
}

function voicePayload(message: MessageDTO): VoicePayload {
  const payload = message.payload as VoicePayload | undefined;
  return payload?.kind === "voice" ? payload : {};
}

function audioPayload(message: MessageDTO): VoicePayload {
  const payload = message.payload as VoicePayload | undefined;
  return payload?.kind === "voice" || payload?.kind === "audio" ? payload : {};
}

function isVoiceMessage(message: MessageDTO) {
  return isAudioMessage(message) && voicePayload(message).kind === "voice";
}

function hasUnlistenedVoice(message: MessageDTO) {
  return isVoiceMessage(message) && message.sender.id !== store.account?.actorId && !message.voiceListened;
}

function voiceDurationMs(message: MessageDTO) {
  return audioPayload(message).durationMs || 0;
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

function scrollBottom(smooth = true) {
  const el = scroller.value;
  if (!el) return;
  pendingTimelineAnchor = null;
  activeReadAnchor = newestChatReadAnchor(readPositionRestoreToken);
  chatScrollIntentTracker.reset();
  el.scrollTo({ top: el.scrollHeight + 1000, behavior: smooth ? "smooth" : "auto" });
  if (!smooth) syncVirtualTimelineViewport(el);
  hasUnreadMessages.value = false;
  awayFromNewest.value = false;
}

function observeWallpaperPanViewport() {
  wallpaperPanResizeObserver?.disconnect();
  wallpaperPanResizeObserver = null;
  const pane = chatPane.value;
  if (!pane || typeof ResizeObserver === "undefined") return;
  wallpaperPanResizeObserver = new ResizeObserver(() => resizeWallpaperPan());
  wallpaperPanResizeObserver.observe(pane);
}

function resizeWallpaperPan() {
  const pane = chatPane.value;
  const natural = wallpaperPanNaturalSize;
  if (!pane || !natural || !wallpaperPanActive.value) return;
  const previous = wallpaperPanMetrics;
  const next = wallpaperPanBounds(pane.clientWidth, pane.clientHeight, natural.width, natural.height);
  wallpaperPanMetrics = next;
  wallpaperPanImageWidth.value = next.imageWidth;
  wallpaperPanReady.value = pane.clientWidth > 0 && pane.clientHeight > 0 && next.imageWidth > 0;
  if (!previous || previous.maxOffset - previous.minOffset <= 0.001) {
    wallpaperPanOffset.value = initialWallpaperPanOffset(next, store.appearance.wallpaperPanFocusX);
    return;
  }
  const progress = (wallpaperPanOffset.value - previous.minOffset) / (previous.maxOffset - previous.minOffset);
  wallpaperPanOffset.value = next.minOffset + Math.max(0, Math.min(1, progress)) * (next.maxOffset - next.minOffset);
}

function syncWallpaperPanImage(image: HTMLImageElement) {
  if (!wallpaperPanActive.value || image.naturalWidth <= 0 || image.naturalHeight <= 0) return;
  wallpaperPanNaturalSize = { width: image.naturalWidth, height: image.naturalHeight };
  resizeWallpaperPan();
}

function handleWallpaperPanImageLoad(event: Event) {
  const image = event.currentTarget as HTMLImageElement;
  if (image !== wallpaperPanImage.value) return;
  if (wallpaperPanRetryTimer !== undefined) window.clearTimeout(wallpaperPanRetryTimer);
  wallpaperPanRetryTimer = undefined;
  wallpaperPanRetryAttempt = 0;
  syncWallpaperPanImage(image);
  syncWallpaperLabelToneFromImage(image);
}

function syncWallpaperLabelToneFromImage(image: HTMLImageElement) {
  if (image.naturalWidth <= 0 || image.naturalHeight <= 0) return;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    wallpaperLabelToneValue.value = wallpaperLabelToneFromPixels(context.getImageData(0, 0, canvas.width, canvas.height).data);
  } catch {
    wallpaperLabelToneValue.value = wallpaperLabelTone(activePalette.value.chatBg);
  }
}

function updateWallpaperLabelTone() {
  const generation = ++wallpaperLabelSampleGeneration;
  wallpaperLabelToneValue.value = wallpaperLabelTone(activePalette.value.chatBg);
  const source = wallpaperUrl(store.appearance.wallpaperPath);
  if (!source) return;
  const mountedPanImage = wallpaperPanImage.value;
  if (mountedPanImage?.complete && mountedPanImage.naturalWidth > 0) {
    syncWallpaperLabelToneFromImage(mountedPanImage);
    return;
  }
  const sampler = document.createElement("img");
  sampler.onload = () => {
    if (generation === wallpaperLabelSampleGeneration) syncWallpaperLabelToneFromImage(sampler);
  };
  sampler.src = source;
}

function handleWallpaperPanImageError(event: Event) {
  const image = event.currentTarget as HTMLImageElement;
  if (image !== wallpaperPanImage.value || !wallpaperPanActive.value) return;
  wallpaperPanReady.value = false;
  wallpaperPanMetrics = null;
  wallpaperPanNaturalSize = null;
  wallpaperPanImageWidth.value = 0;
  if (wallpaperPanRetryTimer !== undefined || wallpaperPanRetryAttempt >= 3) return;
  const source = wallpaperUrl(store.appearance.wallpaperPath);
  const attempt = ++wallpaperPanRetryAttempt;
  wallpaperPanRetryTimer = window.setTimeout(() => {
    wallpaperPanRetryTimer = undefined;
    if (!wallpaperPanActive.value || source !== wallpaperPanRetrySource) return;
    wallpaperPanRetryKey.value = attempt;
  }, attempt * 250);
}

async function resetWallpaperPan() {
  const source = wallpaperUrl(store.appearance.wallpaperPath);
  if (source !== wallpaperPanRetrySource) {
    if (wallpaperPanRetryTimer !== undefined) window.clearTimeout(wallpaperPanRetryTimer);
    wallpaperPanRetryTimer = undefined;
    wallpaperPanRetryAttempt = 0;
    wallpaperPanRetrySource = source;
    wallpaperPanRetryKey.value = 0;
  }
  wallpaperPanReady.value = false;
  pendingWallpaperPanDelta = 0;
  wallpaperPanDirection = cleanWallpaperPanDirection(store.appearance.wallpaperPanDirection);
  wallpaperPanMetrics = null;
  wallpaperPanNaturalSize = null;
  wallpaperPanOffset.value = 0;
  wallpaperPanImageWidth.value = 0;
  if (!source || !wallpaperPanActive.value) return;
  await nextTick();
  const image = wallpaperPanImage.value;
  if (image?.complete && image.naturalWidth > 0) syncWallpaperPanImage(image);
}

function updateParallaxFromScroll(el: HTMLElement) {
  const currentTop = el.scrollTop;
  if (lastParallaxScrollTop === null) {
    lastParallaxScrollTop = currentTop;
    return;
  }
  const delta = currentTop - lastParallaxScrollTop;
  lastParallaxScrollTop = currentTop;
  if (pendingReadPositionRestore.value || loadingHistoryFromScroll || loadingNewerFromScroll || activeReadAnchor) return;
  const clampedDelta = Math.max(-180, Math.min(180, delta));
  const parallaxActive = !!activeParallaxKit.value;
  const panActive = wallpaperPanActive.value && !!wallpaperPanMetrics && shouldAdvanceWallpaperPan({
    musicPlaying: musicPlaying.value,
    bibleOpen: bibleOpen.value,
    documentVisible: documentVisible.value
  });
  if (!parallaxActive && !panActive) return;
  if (parallaxActive) pendingParallaxDelta += clampedDelta;
  if (panActive) pendingWallpaperPanDelta += Math.abs(clampedDelta);
  if (parallaxFrame) return;
  parallaxFrame = requestAnimationFrame(() => {
    if (activeParallaxKit.value) {
      const speed = cleanParallaxSpeed(store.appearance.parallaxSpeed);
      parallaxOffset.value += pendingParallaxDelta * 0.28 * speed;
    }
    if (panActive && wallpaperPanMetrics) {
      const moved = advanceWallpaperPan(
        wallpaperPanOffset.value,
        wallpaperPanDirection,
        pendingWallpaperPanDelta * cleanWallpaperPanSpeed(store.appearance.wallpaperPanSpeed),
        wallpaperPanMetrics
      );
      wallpaperPanOffset.value = moved.offset;
      wallpaperPanDirection = moved.direction;
    }
    pendingParallaxDelta = 0;
    pendingWallpaperPanDelta = 0;
    parallaxFrame = 0;
  });
}

function focusComposer() {
  requestAnimationFrame(() => scrollBottom(false));
}

async function loadTimelineEdgesAfterScroll() {
  const el = scroller.value;
  if (!el) return;
  if (el.scrollTop < 180 && !loadingHistoryFromScroll && (store.hasOlderMessages || store.prefetchedOlderMessages.length)) {
    loadingHistoryFromScroll = true;
    const edgeAnchor = visibleTimelineAnchor(el);
    const loaded = await store.loadOlderMessages();
    await nextTick();
    if (loaded && scroller.value === el) {
      const anchoredScrollTop = edgeAnchor
        ? scrollTopForVirtualAnchor(virtualTimelineItems.value, measuredTimelineHeights.value, edgeAnchor)
        : null;
      if (anchoredScrollTop !== null) el.scrollTop = anchoredScrollTop;
      syncVirtualTimelineViewport(el);
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

function markTimelineScrolling() {
  timelineScrollActive.value = true;
  if (timelineMeasurementFrame !== undefined) window.cancelAnimationFrame(timelineMeasurementFrame);
  timelineMeasurementFrame = undefined;
  if (timelineScrollIdleTimer !== undefined) window.clearTimeout(timelineScrollIdleTimer);
  timelineScrollIdleTimer = window.setTimeout(async () => {
    timelineScrollIdleTimer = undefined;
    timelineScrollActive.value = false;
    if (chatScrollIntentTracker.shouldFollowNewestAfterIdle()) {
      activeReadAnchor = newestChatReadAnchor(readPositionRestoreToken);
      pendingTimelineAnchor = null;
      hasUnreadMessages.value = false;
      awayFromNewest.value = false;
    }
    await flushPendingTimelineMeasurements();
    reconcileReadPositionAfterLayout();
    await loadTimelineEdgesAfterScroll();
  }, TIMELINE_SCROLL_IDLE_MS);
}

function handleMessagesScroll() {
  const el = scroller.value;
  if (!el) return;
  markTimelineScrolling();
  scheduleVirtualTimelineViewport(el);
  clearBlankScoreLongPress();
  updateParallaxFromScroll(el);
  scheduleSaveReadPosition();
  chatScrollIntentTracker.noteScroll(currentNewestViewportState(el));
  syncNewestIndicators(el);
}

async function retryMessageLoad() {
  if (store.loadingInitialMessages || store.loadingOlderMessages || store.loadingNewerMessages) return;
  if (!store.messages.length) {
    await store.loadMessages().catch(() => undefined);
    await nextTick();
    scrollBottom(false);
    return;
  }
  await loadTimelineEdgesAfterScroll();
}

async function scrollToNewest(smooth = true) {
  while (store.hasNewerMessages) {
    const loaded = await store.loadNewerMessages();
    if (!loaded) break;
  }
  await nextTick();
  scrollBottom(smooth);
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

function stopFlashEffectTimer(resetStep = false) {
  if (flashEffectTimer) window.clearInterval(flashEffectTimer);
  flashEffectTimer = 0;
  if (resetStep) flashEffectStep.value = 0;
}

function flashPreviewVisible() {
  return showAdmin.value && adminAppearancePages.has(adminPage.value) && appearanceSection.value === "flash";
}

function syncFlashEffectTimer(forceRestart = false) {
  if (forceRestart) stopFlashEffectTimer(true);
  const previewVisible = flashPreviewVisible();
  const visibleFlashMessage = !bibleOpen.value && store.messages.some((message) => messageEffect(message) === "flash" && !isMessageEffectPaused(message));
  if (!shouldRunFlashEffectTimer({ visibleFlashMessage, previewVisible, documentVisible: documentVisible.value })) {
    stopFlashEffectTimer(true);
    return;
  }
  if (flashEffectTimer) return;
  const config = previewVisible ? appearancePreviewFlash.value : flashEffect.value;
  flashEffectTimer = window.setInterval(() => {
    flashEffectStep.value = (flashEffectStep.value + 1) % config.colors.length;
  }, Math.max(10, Math.round(config.intervalSeconds * 1000)));
}

function wallpaperFitStyle(fit?: WallpaperFit | null) {
  if (fit === "pan") return { size: "auto 100%", repeat: "no-repeat" };
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

// Bubble rendering and preload warming use the small variant; the server
// falls back to the original for uploads that predate thumbnails.
function fileThumbUrl(message: MessageDTO) {
  return `${fileUrl(message)}&thumb=1`;
}

function pinnedFileUrl(block: PinnedMediaBlock) {
  return `/api/channels/${store.currentChannelId}/pinned/files/${encodeURIComponent(block.filePath)}?token=${encodeURIComponent(getToken())}`;
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

function formatBibleFavoriteBody(lookup: BibleLookupDTO) {
  const preferences = biblePreferences();
  if (preferences.outputFormat === "referenceVerseLines" || preferences.outputFormat === "numberedVerses") {
    return lookup.verses.map((verse) => `${compactVerseLabel(verse)} ${bibleVerseText(verse)}`).join("\n");
  }
  if (preferences.outputFormat === "referenceHeader") {
    return lookup.verses.map((verse) => bibleVerseText(verse)).join("\n");
  }
  return bibleVerseGroups(lookup)
    .map((group) => group.verses.map((verse) => bibleVerseText(verse)).join(""))
    .join(preferences.combinedPassageMode === "groupedLines" ? "\n" : "……");
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

async function openBibleReferenceInWorkspace(scope: string | number, reference: string) {
  const lookup = bibleReferenceLookup(scope, reference);
  if (!lookup?.verses.length) return;
  openBibleWorkspace();
  await nextTick();
  await bibleWorkspace.value?.openLookupContext(lookup);
}

function isMine(message: MessageDTO) {
  return message.sender.id === store.account?.actorId || (!!message.sender.username && message.sender.username === store.account?.username);
}

function channelIconUrl(channel?: Pick<ChannelDTO, "icon"> | null) {
  return channel?.icon ? wallpaperUrl(channel.icon) : "/images/icon-192.png";
}
</script>

<template>
  <main v-if="appStarting" class="app-start-shell" :style="appearanceStyle" aria-live="polite">
    <div class="app-start-code" aria-hidden="true">
      <div class="app-start-code-track">
        <pre v-for="copy in 4" :key="copy"><code><span v-for="(line, index) in appStartCodeLines" :key="`${copy}-${index}`">{{ line || " " }}</span></code></pre>
      </div>
    </div>
    <section class="app-start-card" role="status">
      <header class="app-start-heading">
        <span class="app-start-spinner" aria-hidden="true"></span>
        <div>
          <strong>正在打开聊天室</strong>
          <small>正在载入外观、账号和最近消息…</small>
        </div>
        <span class="app-start-version">v{{ APP_VERSION }}</span>
      </header>
      <div class="app-start-release">
        <span>本次更新</span>
        <ul>
          <li v-for="note in RELEASE_NOTES" :key="note">{{ note }}</li>
        </ul>
      </div>
    </section>
  </main>
  <main v-else-if="appStartError" class="app-start-shell" :style="appearanceStyle">
    <section class="app-start-card error" role="alert">
      <CircleOff :size="34" />
      <strong>聊天室没有加载完成</strong>
      <small>{{ appStartError }}</small>
      <button class="primary-btn" @click="reloadApplication"><RotateCcw :size="16" />重新加载</button>
    </section>
  </main>
  <main v-else-if="isAiSettingsRoute && store.account?.isAdmin" class="ai-settings-page ai-settings-full-page" :style="appearanceStyle">
    <section class="ai-settings-panel ai-settings-workspace">
      <header class="ai-settings-head">
        <div>
          <strong>AI 设置</strong>
          <small>LLM 接入 · 虚拟角色 · 相关经文</small>
        </div>
        <button class="mini-btn secondary" @click="returnToChat">回到聊天</button>
      </header>

      <div class="ai-settings-overview" aria-label="AI 设置摘要">
        <div>
          <span>API Key</span>
          <strong>{{ aiSettings?.apiKeyConfigured ? "已配置" : "未配置" }}</strong>
        </div>
        <div>
          <span>虚拟角色</span>
          <strong>{{ virtuals.length }} 个</strong>
        </div>
        <div>
          <span>经文建议</span>
          <strong>{{ aiSettingsEdit.enabled ? "已启用" : "已关闭" }}</strong>
        </div>
      </div>

      <div class="ai-settings-shell">
        <nav class="ai-settings-tabs" aria-label="AI 设置分类">
          <button type="button" :class="{ active: aiSettingsTab === 'llm' }" @click="aiSettingsTab = 'llm'">
            <Settings :size="17" />
            <span>LLM 接入<small>密钥与模型默认值</small></span>
          </button>
          <button type="button" :class="{ active: aiSettingsTab === 'virtuals' }" @click="aiSettingsTab = 'virtuals'; loadVirtualCharacters().catch(() => undefined)">
            <Bot :size="17" />
            <span>虚拟角色<small>人设、记忆和频道</small></span>
          </button>
          <button type="button" :class="{ active: aiSettingsTab === 'verses' }" @click="aiSettingsTab = 'verses'">
            <BookOpen :size="17" />
            <span>相关经文<small>提示词与频率限制</small></span>
          </button>
        </nav>

        <form class="form-grid ai-settings-form" @submit.prevent="saveAiSettings">
          <template v-if="aiSettingsTab === 'llm'">
            <section class="ai-settings-subsection ai-settings-card">
              <div class="ai-section-title">
                <strong>DeepSeek 接入</strong>
                <small>密钥状态与默认接入参数</small>
              </div>
              <label>DeepSeek API Key</label>
              <input v-model="aiSettingsEdit.apiKey" type="password" autocomplete="off" :placeholder="aiSettings?.apiKeyConfigured ? '已设置，留空不改' : '请输入 DeepSeek API Key'" />
              <label v-if="aiSettings?.apiKeyConfigured" class="check-row"><input v-model="aiSettingsEdit.clearApiKey" type="checkbox" /> 清除已保存的 API Key</label>
              <div class="ai-defaults">
                <span>Base URL：{{ aiSettings?.baseUrl || 'https://api.deepseek.com' }}</span>
                <span>Model：{{ aiSettings?.model || 'deepseek-v4-flash' }}</span>
              </div>
            </section>
          </template>

          <template v-else-if="aiSettingsTab === 'virtuals'">
            <section class="ai-settings-subsection ai-settings-card virtual-create-section">
              <div class="ai-section-title">
                <strong>新增虚拟角色</strong>
                <small>角色身份、模型和初始记忆</small>
              </div>
              <div class="virtual-create-grid">
                <label>ID<input v-model="newVirtual.username" placeholder="ai_luna" autocomplete="off" /></label>
                <label>昵称<input v-model="newVirtual.displayName" placeholder="小月" autocomplete="off" /></label>
                <label>模型<input v-model="newVirtual.model" :placeholder="aiSettings?.model || '跟随系统默认模型'" autocomplete="off" /></label>
                <label class="check-row"><input v-model="newVirtual.thinkingEnabled" type="checkbox" /> 开启思考</label>
                <label>人设<textarea v-model="newVirtual.persona" rows="3" placeholder="这个角色是谁、语气、边界和应该怎样参与聊天"></textarea></label>
                <label>短期记忆<textarea v-model="newVirtual.shortTermMemory" rows="3" placeholder="当前状态、最近要记住的事"></textarea></label>
                <label>中期记忆<textarea v-model="newVirtual.midTermMemory" rows="3" placeholder="一段时间内稳定的背景"></textarea></label>
                <label>长期记忆<textarea v-model="newVirtual.longTermMemory" rows="3" placeholder="长期身份、关系和重要判断"></textarea></label>
                <div class="virtual-create-channels">
                  <span>所在频道</span>
                  <div class="channel-chip-grid">
                    <button
                      v-for="channel in store.channels"
                      :key="channel.id"
                      class="channel-chip"
                      :class="{ active: newVirtual.channelIds.includes(channel.id) }"
                      type="button"
                      @click="toggleNewVirtualChannel(channel.id)"
                    >
                      {{ channel.name }}
                    </button>
                  </div>
                </div>
              </div>
              <div class="ai-settings-inline-actions">
                <label class="check-row"><input v-model="newVirtual.enabled" type="checkbox" /> 创建后启用</label>
                <button class="primary-btn" type="button" :disabled="!newVirtual.username.trim() || !newVirtual.displayName.trim()" @click="addVirtual"><Bot :size="16" />创建角色</button>
              </div>
            </section>

            <section class="ai-settings-subsection ai-role-settings ai-settings-card">
              <div class="ai-section-title">
                <strong>虚拟角色矩阵</strong>
                <small>角色档案、频道范围和启用状态</small>
              </div>
              <div class="virtual-role-table-wrap">
                <table class="virtual-role-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>头像</th>
                      <th>昵称</th>
                      <th>所接入模型</th>
                      <th>思考</th>
                      <th>人设</th>
                      <th>短期记忆</th>
                      <th>中期记忆</th>
                      <th>长期记忆</th>
                      <th>所在频道</th>
                      <th>启用</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="character in virtuals" :key="character.id">
                      <td class="virtual-id-cell">@{{ character.actor.username }}</td>
                      <td>
                        <label class="avatar virtual-table-avatar" :class="{ online: virtualEnabled(character) }">
                          <img v-if="avatarUrl(character.actor?.avatarPath)" :src="avatarUrl(character.actor.avatarPath)" alt="" />
                          <span v-else>{{ avatarText(character.actor?.displayName || character.actor?.username) }}</span>
                          <input type="file" accept="image/*" @change="uploadVirtualAvatar(character, $event)" />
                        </label>
                      </td>
                      <td><input class="virtual-nickname-input" :value="character.actor.displayName" @input="setVirtualDisplayName(character, ($event.target as HTMLInputElement).value)" /></td>
                      <td><input class="virtual-model-input" :value="virtualModel(character)" :placeholder="aiSettings?.model || '跟随默认'" @input="setVirtualModel(character, ($event.target as HTMLInputElement).value)" /></td>
                      <td><input :checked="virtualThinkingEnabled(character)" type="checkbox" @change="setVirtualThinkingEnabled(character, ($event.target as HTMLInputElement).checked)" /></td>
                      <td><textarea class="virtual-text-cell" :value="virtualPersona(character)" rows="4" @input="setVirtualPersona(character, ($event.target as HTMLTextAreaElement).value)"></textarea></td>
                      <td><textarea class="virtual-text-cell" :value="virtualManualMemory(character).shortTerm" rows="4" @input="setVirtualManualMemory(character, 'shortTerm', ($event.target as HTMLTextAreaElement).value)"></textarea></td>
                      <td><textarea class="virtual-text-cell" :value="virtualManualMemory(character).midTerm" rows="4" @input="setVirtualManualMemory(character, 'midTerm', ($event.target as HTMLTextAreaElement).value)"></textarea></td>
                      <td><textarea class="virtual-text-cell" :value="virtualManualMemory(character).longTerm" rows="4" @input="setVirtualManualMemory(character, 'longTerm', ($event.target as HTMLTextAreaElement).value)"></textarea></td>
                      <td>
                        <div class="channel-chip-grid virtual-channel-grid">
                          <button
                            v-for="channel in store.channels"
                            :key="channel.id"
                            class="channel-chip"
                            :class="{ active: virtualChannelIds(character).includes(channel.id) }"
                            type="button"
                            @click="toggleVirtualChannel(character, channel.id)"
                          >
                            {{ channel.name }}
                          </button>
                        </div>
                      </td>
                      <td><input :checked="virtualEnabled(character)" type="checkbox" @change="setVirtualEnabled(character, ($event.target as HTMLInputElement).checked)" /></td>
                      <td><button class="mini-btn icon-btn" type="button" @click="saveVirtualCharacter(character)"><Save :size="15" /></button></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          </template>

          <template v-else>
            <section class="ai-settings-subsection ai-settings-card">
              <div class="ai-section-title">
                <strong>相关经文生成</strong>
                <small>代祷卡片提示词与生成限制</small>
              </div>
              <label class="check-row"><input v-model="aiSettingsEdit.enabled" type="checkbox" /> 启用代祷经文建议</label>
              <label>提示词命令</label>
              <textarea v-model="aiSettingsEdit.promptCommand" rows="9"></textarea>
              <label>同一代祷卡片冷却秒数</label>
              <input v-model.number="aiSettingsEdit.cardCooldownSeconds" type="number" min="0" max="3600" step="1" />
              <label>同一用户每分钟最多生成</label>
              <input v-model.number="aiSettingsEdit.userLimitPerMinute" type="number" min="1" max="60" step="1" />
              <label>每张代祷卡片最多成功生成</label>
              <input v-model.number="aiSettingsEdit.maxSuccessPerMessage" type="number" min="1" max="20" step="1" />
            </section>
          </template>

          <div class="ai-settings-savebar">
            <p v-if="aiSettingsMsg" class="settings-note">{{ aiSettingsMsg }}</p>
            <button class="primary-btn" type="submit" :disabled="aiSettingsBusy">{{ aiSettingsBusy ? "保存中" : "保存 AI 设置" }}</button>
          </div>
        </form>
      </div>
    </section>
  </main>

  <main v-else-if="isLogRoute && store.account?.isAdmin" class="ai-settings-page login-log-page" :style="appearanceStyle">
    <section class="ai-settings-panel login-log-panel">
      <header class="ai-settings-head">
        <div>
          <strong>活动日志</strong>
          <small>会话、版本、在线时长、音乐进度与主要功能使用情况</small>
        </div>
        <div class="login-log-actions">
          <button class="mini-btn secondary" :disabled="adminLoginLogsBusy" @click="loadAdminLoginLogs">{{ adminLoginLogsBusy ? "刷新中" : "刷新" }}</button>
          <button class="mini-btn secondary" @click="returnToChat">回到聊天</button>
        </div>
      </header>
      <section class="login-log-body">
        <nav class="activity-log-filters" aria-label="日志分类">
          <button v-for="option in activityLogFilterOptions" :key="option.value" type="button" :class="{ active: activityLogFilter === option.value }" @click="setActivityLogFilter(option.value)">{{ option.label }}</button>
        </nav>
        <p v-if="adminLoginLogsMsg" class="settings-note">{{ adminLoginLogsMsg }}</p>
        <p v-if="adminLoginLogsBusy && !adminLoginLogs.length" class="settings-note">正在加载活动日志...</p>
        <p v-else-if="!adminLoginLogs.length" class="settings-note">这个分类还没有日志。</p>
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
                <span v-if="log.deviceName">{{ displayedDeviceName(log) }}</span>
                <span v-if="log.deviceKind">{{ deviceLabel(log.deviceKind) }}</span>
                <span v-if="log.channelName">频道：{{ log.channelName }}</span>
                <span v-if="log.trackTitle">歌曲：{{ log.trackTitle }}</span>
                <span v-if="log.state">{{ activityStateLabel(log.state) }}</span>
                <span v-if="log.ipAddress">IP {{ log.ipAddress }}</span>
                <span v-if="log.sessionId">会话 {{ log.sessionId.slice(0, 8) }}</span>
              </div>
              <small v-if="log.kind === 'music_progress'" class="activity-log-detail">{{ musicProgressSummary(log) }}</small>
              <small v-if="log.kind === 'presence_leave' && log.durationMs != null" class="activity-log-detail">本次在线 {{ activityDuration(log.durationMs) }}</small>
              <small v-if="log.appVersion" class="activity-log-detail">
                客户端 v{{ log.appVersion }}<template v-if="log.latestVersion"> · 当时服务器 v{{ log.latestVersion }} · {{ log.isLatestVersion ? "已是最新版" : "不是最新版" }}</template>
              </small>
              <small v-if="log.playbackId" class="activity-log-detail">播放会话 {{ log.playbackId.slice(0, 8) }}</small>
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
      <h1>{{ isReceptionInviteRoute ? "临时会客厅" : loginBrand.title }}</h1>
      <p v-if="isReceptionInviteRoute">这是一条临时邀请。请输入你的称呼进入。</p>
      <p v-else-if="loginBrand.showSubtitle && loginBrand.subtitle">{{ loginBrand.subtitle }}</p>
      <form @submit.prevent="doLogin">
        <input v-if="!isReceptionInviteRoute" v-model="username" :autocomplete="authMode === 'reception' ? 'one-time-code' : 'username'" :placeholder="authMode === 'reception' ? '来访口令' : '用户名'" />
        <input v-if="authMode === 'register' || authMode === 'reception'" v-model="displayName" autocomplete="name" :placeholder="authMode === 'reception' ? '你的称呼' : '显示名'" />
        <input v-if="authMode !== 'reception'" v-model="password" :autocomplete="authMode === 'register' ? 'new-password' : 'current-password'" :minlength="authMode === 'register' ? 10 : 1" maxlength="128" placeholder="密码" type="password" />
        <button class="primary-btn" type="submit">{{ authMode === "reception" ? "进入会客厅" : authMode === "register" ? "注册并登录" : "登录" }}</button>
      </form>
      <p v-if="isReceptionInviteRoute" class="reception-invite-note">邀请会随房间到期或回收而失效；此页面不会显示正式成员登录入口。</p>
      <button v-if="!isReceptionInviteRoute" class="text-btn login-mode-btn" @click="authMode = authMode === 'reception' ? 'login' : 'reception'; loginError = ''">
        {{ authMode === "reception" ? "正式成员登录" : "持来访口令进入" }}
      </button>
      <button v-if="!isReceptionInviteRoute && store.appearance.registrationEnabled && authMode !== 'reception'" class="text-btn login-mode-btn" @click="authMode = authMode === 'register' ? 'login' : 'register'; loginError = ''">
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
      <strong>无权查看活动日志</strong>
      <p>只有管理员可以查看会话、音乐进度和功能使用记录。</p>
      <button class="primary-btn" @click="returnToChat">回到聊天</button>
    </section>
  </main>

  <main v-else class="app-shell" :class="{ 'channels-collapsed': channelsCollapsed, 'members-collapsed': membersCollapsed, 'bible-open': bibleOpen, 'sermon-open': sermonWorkspaceOpen, 'music-low-power': musicPlaying && wallpaperPanActive }" :style="appearanceStyle">
    <section v-if="staleVersionVisible" class="version-refresh-banner">
      <span>{{ staleVersionMessage }}</span>
      <button class="mini-btn secondary" @click="reloadToLatestVersion">立即刷新</button>
    </section>

    <BibleWorkspace
      ref="bibleWorkspace"
      :open="bibleOpen"
      :account-id="store.account?.id || 0"
      :channel-name="bibleTargetChannel?.name || '聊天室'"
      :can-send="bibleCanSend"
      :send-unavailable-reason="bibleSendUnavailableReason"
      :send-passage="sendBiblePassage"
      :favorites="bibleFavorites"
      :favorites-busy="bibleFavoritesLoading"
      :update-favorites="updateBibleFavorites"
      :server-workspace="store.account?.biblePreferences?.workspace || null"
      :share-channels="bibleShareChannels"
      :active-channel-id="bibleTargetChannelId"
      @close="closeBibleWorkspace"
      @reading-change="handleBibleReadingChange"
    />

    <BookWorkspace v-if="bookWorkspaceOpen" @close="closeBookWorkspace" @reading-change="handleBookReadingChange" />

    <SermonWorkspace
      v-if="sermonWorkspaceMounted"
      :open="sermonWorkspaceOpen"
      @close="sermonWorkspaceOpen = false"
    />
    <SermonEntryDialog
      v-if="sermonEntryOpen"
      :open="true"
      @close="sermonEntryOpen = false"
      @own="openOwnSermonWorkspace"
    />

    <aside v-if="!bibleOpen && !sermonWorkspaceOpen && !bookWorkspaceOpen" class="channel-pane" :class="{ open: showChannels, collapsed: channelsCollapsed }">
      <header class="pane-head">
        <strong>聊天室</strong>
        <button v-if="!store.account?.isGuest" class="icon-btn" @click="showReceptionManager = true" aria-label="会客厅" title="会客厅"><DoorOpen :size="20" /></button>
        <button v-if="!store.account?.isGuest" class="icon-btn" @click="openCreateChannelEditor" aria-label="创建频道" title="创建频道"><Plus :size="20" /></button>
        <button class="icon-btn desktop-only" @click="channelsCollapsed = true" aria-label="收起频道"><PanelLeftClose :size="20" /></button>
        <button class="icon-btn mobile-only" @click="showChannels = false" aria-label="关闭频道"><X :size="20" /></button>
      </header>
      <div class="channel-list">
      <template v-for="channel in store.channels" :key="channel.id">
        <div
          class="channel-row-wrap"
          :class="{ active: channel.id === store.currentChannelId && !store.prayerOnly, 'has-action': canOpenChannelSettings(channel), 'has-list-color': !!channel.listColor }"
          :style="channel.listColor ? { '--channel-list-color': channel.listColor } : undefined"
        >
          <button
            class="channel-row"
            :class="{ active: channel.id === store.currentChannelId && !store.prayerOnly }"
            @click="openChannelFromList(channel.id)"
            @contextmenu="openChannelContextMenu(channel, $event)"
            @pointerdown="beginChannelLongPress(channel, $event)"
            @pointermove="moveChannelLongPress"
            @pointerup="clearChannelLongPress"
            @pointerleave="clearChannelLongPress"
            @pointercancel="clearChannelLongPress"
          >
            <span class="channel-icon">
              <span v-if="channel.kind === 'music'" class="channel-icon-glyph" aria-hidden="true">歌</span>
              <img v-else :src="channelIconUrl(channel)" alt="" />
              <i v-if="channel.isPrivate" class="private-channel-badge" aria-label="私密频道" title="私密频道">
                <LockKeyhole :size="11" :stroke-width="2.6" />
              </i>
              <span v-if="channel.kind !== 'music' && unreadCountFor(channel.id) > 0" class="channel-unread-badge">{{ formatUnreadCount(unreadCountFor(channel.id)) }}</span>
            </span>
            <span class="channel-row-label">
              <b>{{ channel.name }}</b>
            </span>
          </button>
          <button
            v-if="canOpenChannelSettings(channel)"
            class="channel-row-action"
            @click.stop="openEditChannelEditor(channel)"
            @pointerdown.stop
            aria-label="频道设置"
            title="频道设置"
          >
            <Settings :size="17" />
          </button>
        </div>
        <button
          v-if="channel.hasPrayerItems"
          class="channel-row channel-subrow"
          :class="{ active: channel.id === store.currentChannelId && store.prayerOnly }"
          @click="openChannelFromList(channel.id, true)"
        >
          <span class="channel-icon prayer-icon"><HeartHandshake :size="20" /></span>
          <span>
            <b>代祷事项</b>
            <small>{{ channel.name }}</small>
          </span>
        </button>
      </template>
      </div>
      <button class="channel-row favorites-entry" :class="{ active: showFavorites }" type="button" @click="openFavorites">
        <span class="channel-icon favorites-icon"><Heart :size="20" /></span>
        <span class="channel-row-label"><b>收藏夹</b></span>
      </button>
      <button class="channel-row favorites-entry bible-favorites-entry" :class="{ active: showBibleFavorites }" type="button" @click="openBibleFavorites">
        <span class="channel-icon bible-favorites-icon"><Bookmark :size="20" /></span>
        <span class="channel-row-label"><b>经文收藏</b><small>{{ bibleFavorites.length }} 节</small></span>
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
        <button class="icon-btn" @click="logoutApp()" aria-label="退出"><LogOut :size="18" /></button>
      </footer>
    </aside>

    <section v-if="!bibleOpen && !sermonWorkspaceOpen && !bookWorkspaceOpen" ref="chatPane" class="chat-pane" @touchstart.passive="handleBibleSwipeStart" @touchend.passive="handleBibleSwipeEnd">
      <img
        v-if="wallpaperPanActive"
        ref="wallpaperPanImage"
        class="wallpaper-pan-background"
        :class="{ ready: wallpaperPanReady, 'playback-paused': musicPlaying }"
        :src="wallpaperPanImageSource"
        :style="wallpaperPanLayerStyle"
        @load="handleWallpaperPanImageLoad"
        @error="handleWallpaperPanImageError"
        alt=""
        aria-hidden="true"
        draggable="false"
      />
      <ParallaxBackground :kit="activeParallaxKit" :offset="parallaxOffset" />
      <OopsTextPhysicsLayer ref="oopsPhysicsLayer" @active-change="handleOopsActiveChange" />
      <canvas v-if="rainActive" ref="rainCanvas" class="rain-canvas" aria-hidden="true"></canvas>
      <canvas ref="dripLayer" class="drip-layer" aria-hidden="true"></canvas>
      <svg ref="gooeyDripLayer" class="drip-gooey-layer" aria-hidden="true" focusable="false">
        <defs>
          <filter id="gooey-drip-filter" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 17 -7"
              result="goo"
            />
            <feBlend in="SourceGraphic" in2="goo" />
          </filter>
          <radialGradient id="gooey-drip-fill" cx="35%" cy="28%" r="76%">
            <stop offset="0%" stop-color="#ffffff" stop-opacity="0.62" />
            <stop offset="36%" stop-color="#f8fbff" stop-opacity="0.2" />
            <stop offset="72%" stop-color="#dbeafe" stop-opacity="0.18" />
            <stop offset="100%" stop-color="#082f49" stop-opacity="0.2" />
          </radialGradient>
        </defs>
        <g class="gooey-drip-goo" filter="url(#gooey-drip-filter)">
          <ellipse
            v-for="blob in gooeyBlobs"
            :key="blob.id"
            class="gooey-drip-blob"
            :cx="blob.x"
            :cy="blob.y"
            :rx="blob.rx"
            :ry="blob.ry"
            :opacity="blob.alpha"
            :transform="`rotate(${blob.rotate} ${blob.x} ${blob.y})`"
          />
        </g>
        <g class="gooey-drip-shine">
          <ellipse
            v-for="highlight in gooeyHighlights"
            :key="highlight.id"
            class="gooey-drip-highlight"
            :cx="highlight.x"
            :cy="highlight.y"
            :rx="highlight.rx"
            :ry="highlight.ry"
            :opacity="highlight.alpha"
            :transform="`rotate(${highlight.rotate} ${highlight.x} ${highlight.y})`"
          />
        </g>
      </svg>
      <div v-if="store.connectionState !== 'connected'" class="connection-banner" role="status">
        <span></span>{{ store.connectionState === "connecting" ? "正在连接聊天室…" : "连接已中断，恢复后会继续接收新消息" }}
      </div>
      <header class="chat-head" @pointerdown="handleChatHeaderInteraction">
        <button
          class="icon-btn mobile-only channel-mobile-trigger"
          @click="showChannels = true"
          :aria-label="otherChannelUnreadCount > 0 ? `频道，其他频道有 ${otherChannelUnreadCount} 条未读消息` : '频道'"
        >
          <span v-if="otherChannelUnreadCount > 0" class="channel-mobile-unread">{{ formatUnreadCount(otherChannelUnreadCount) }}</span>
          <ChevronLeft v-else :size="22" />
        </button>
        <button v-if="channelsCollapsed" class="icon-btn desktop-only" @click="channelsCollapsed = false" aria-label="展开频道"><PanelLeftOpen :size="20" /></button>
        <div class="chat-title">
          <div class="chat-title-line">
            <button
              v-if="notificationAttentionVisible"
              class="notification-nudge"
              type="button"
              aria-label="请打开通知"
              @click="openNotificationPrompt"
            >
              <span class="notification-nudge-characters" aria-hidden="true">
                <span
                  v-for="(character, index) in notificationNudgeCharacters"
                  :key="character"
                  class="notification-nudge-character"
                  :style="{ '--notification-char-index': index }"
                >{{ character }}</span>
              </span>
            </button>
            <strong data-testid="active-channel-name">{{ showBibleFavorites ? "经文收藏" : showFavorites ? "收藏夹" : store.prayerOnly ? `${currentChannel?.name || "聊天室"} · 代祷事项` : currentChannel?.name || "聊天室" }}</strong>
          </div>
          <OverflowMarquee v-if="chatSubtitleText" :text="chatSubtitleText" />
        </div>
        <button v-if="!showingFavoriteSurface" class="icon-btn bible-header-trigger" type="button" @click="openBibleWorkspace" aria-label="打开圣经" title="圣经"><BookOpen :size="20" /></button>
        <button v-if="!showingFavoriteSurface" class="icon-btn book-header-trigger" type="button" @click="openBookWorkspace" aria-label="打开图书室" title="图书室"><Library :size="20" /></button>
        <SermonHub v-if="!showingFavoriteSurface" />
        <div v-if="!showingFavoriteSurface" class="music-player-control" data-music-player>
          <button class="icon-btn music-player-trigger" type="button" :class="{ spinning: musicPlaying }" @click.stop="openMusicPlayer()" aria-label="打开音乐播放器">
            <span class="music-player-glyph" aria-hidden="true">歌</span>
          </button>
          <MusicMiniPanel
            v-if="musicPlayerExpanded"
            :player="musicPlayer"
            :favorite-tracks="favoriteMusicTracks"
            :playlists="musicPlaylists"
            :sleep-timer="musicSleepTimer"
            :font-size="musicPanelFontSize"
            @close="musicPlayerExpanded = false"
            @toggle-favorite="toggleCurrentMusicFavorite"
            @open-manager="openMusicManagerFromMiniPanel"
          />
        </div>
        <div v-if="!showingFavoriteSurface" class="friend-player-control">
          <button class="icon-btn friend-player-trigger" type="button" :class="{ active: friendProgramsOpen, spinning: friendPlaying }" @click.stop="toggleFriendPrograms" aria-label="打开良友节目">
            <span class="music-player-glyph friend-player-glyph" aria-hidden="true">友</span>
          </button>
        </div>
        <button
          v-if="!showingFavoriteSurface && musicScoreTriggerVisible"
          class="icon-btn message-font-trigger music-score-trigger"
          :class="{ active: musicScoreOpen, 'page-turning': musicPlaying }"
          type="button"
          aria-label="打开或关闭歌谱"
          :aria-expanded="musicScoreOpen"
          @click.stop="toggleMusicScore"
        >
          <span class="message-font-glyph music-score-page-glyph" aria-hidden="true">谱</span>
        </button>
        <button v-if="!showingFavoriteSurface && currentChannel?.directKey" class="icon-btn" @click="requestCloseChannel" aria-label="关闭私聊"><X :size="20" /></button>
        <button v-if="!showingFavoriteSurface && canDeleteCurrentChannel" class="icon-btn danger" @click="currentChannel && deleteChannel(currentChannel)" aria-label="删除频道"><Trash2 :size="19" /></button>
        <div v-if="!showingFavoriteSurface" class="chat-tools-control" data-chat-tools-menu>
          <button
            class="icon-btn chat-tools-trigger"
            type="button"
            :class="{ active: showChatToolsMenu }"
            aria-label="更多管理功能"
            :aria-expanded="showChatToolsMenu"
            @click.stop="toggleChatToolsMenu"
          ><Ellipsis :size="22" /></button>
          <AppMenu v-if="showChatToolsMenu" class="chat-tools-menu" label="聊天管理功能" @click.stop>
            <div class="chat-tools-font-row" role="group" :aria-label="`消息字体大小，当前 ${messageFontSize} 号`">
              <span class="chat-tools-font-label">字号调节</span>
              <button type="button" :disabled="messageFontSize <= minMessageFontSize" aria-label="减小消息字体" @click="adjustMessageFontSize(-1)">小</button>
              <output :aria-label="`当前消息字号 ${messageFontSize} 像素`" aria-live="polite">{{ messageFontSize }}</output>
              <button type="button" :disabled="messageFontSize >= maxMessageFontSize" aria-label="增大消息字体" @click="adjustMessageFontSize(1)">大</button>
            </div>
            <AppMenuItem @click="toggleCurrentMemberPane"><Users :size="17" /><span>成员列表</span></AppMenuItem>
            <AppMenuItem :active="messageSelectionMode" @click="toggleMessageSelectionMode"><CheckCircle2 :size="17" /><span>{{ messageSelectionMode ? "退出消息多选" : "消息多选" }}</span></AppMenuItem>
            <AppMenuItem v-if="isAdmin" @click="loadAdmin"><Settings :size="17" /><span>系统设置</span></AppMenuItem>
          </AppMenu>
        </div>
      </header>

      <section
        v-if="!showingFavoriteSurface && (visiblePinned || activityTickerText)"
        class="chat-notice-stack"
        :class="{ 'has-pinned': !!visiblePinned, 'has-activity': !!activityTickerText }"
        :role="visiblePinned ? 'button' : undefined"
        :tabindex="visiblePinned ? 0 : undefined"
        :aria-label="visiblePinned ? '查看置顶消息' : '聊天室实时动态'"
        @click="openPinnedFromTicker"
        @keydown.enter="openPinnedFromTicker"
        @keydown.space.prevent="openPinnedFromTicker"
      >
        <span v-if="visiblePinned" class="pinned-ticker-row">
          <span class="pinned-ticker-icon" aria-hidden="true"><Pin :size="14" /></span>
          <span class="pinned-ticker-viewport">
            <span class="pinned-ticker-track">
              <strong>{{ pinnedText }}</strong>
              <span v-if="pinnedTickerBody">{{ pinnedTickerBody }}</span>
            </span>
          </span>
          <button
            v-if="canPinCurrentChannel"
            type="button"
            class="pinned-ticker-action pinned-ticker-edit"
            aria-label="编辑置顶消息"
            @click.stop="openPinnedEditor"
            @keydown.enter.stop
            @keydown.space.stop
          >编辑</button>
          <span v-else class="pinned-ticker-action">查看</span>
        </span>
        <span v-if="activityTickerText" class="chat-activity-ticker" aria-label="聊天室实时动态" aria-live="polite">
          <ActivityTicker :items="activityStatusItems" />
        </span>
      </section>

      <Transition name="music-lyrics-panel">
        <MusicLyricsHeader
          v-if="musicLyricsHeaderVisible"
          :cues="currentMusicLyricCues"
          :playing="musicPlaying"
          :get-current-time-ms="currentMusicPlaybackTimeMs"
          @hide="hideMusicLyricsHeader"
        />
      </Transition>

      <section
        v-if="!showingFavoriteSurface && activeMessageNotice"
        class="message-notice-bar"
        :class="[`message-notice-${activeMessageNotice.kind}`, { 'below-music-lyrics': musicLyricsHeaderVisible }]"
        aria-live="polite"
      >
        <button
          type="button"
          :aria-label="`${activeMessageNotice.title}，${activeMessageNotice.body}，点击查看`"
          @click="openTopNotice(activeMessageNotice)"
        >
          <span class="message-notice-icon" aria-hidden="true">
            <AtSign v-if="activeMessageNotice.kind === 'mention'" :size="15" />
            <ThumbsUp v-else-if="activeMessageNotice.kind === 'like'" :size="15" />
            <Heart v-else :size="15" />
          </span>
          <span class="message-notice-copy">
            <strong>{{ activeMessageNotice.title }}</strong>
            <small>{{ activeMessageNotice.body }}</small>
          </span>
          <span v-if="messageNoticeCount > 1" class="message-notice-count">{{ messageNoticeCount }} 条</span>
          <ChevronRight :size="16" aria-hidden="true" />
        </button>
      </section>

      <section v-if="!showingFavoriteSurface && messageSelectionMode" class="message-selection-bar">
        <span>已选择 {{ selectedMessageCount }} 条</span>
        <button class="mini-btn secondary" @click="toggleVisibleMessageSelection">{{ visibleMessagesSelected ? "取消全选" : "全选当前" }}</button>
        <button class="mini-btn" :disabled="!selectedMessageCount" @click="openForwardActionSheet"><Send :size="15" />转发</button>
        <button v-if="canPinCurrentChannel" class="mini-btn" :disabled="!selectedMessageCount" @click="pinSelectedMessages"><Pin :size="15" />设为置顶</button>
        <button v-if="isAdmin" class="mini-btn danger-action" :disabled="!selectedMessageCount" @click="deleteSelectedMessages"><Trash2 :size="15" />删除</button>
        <button class="mini-btn secondary" @click="toggleMessageSelectionMode">完成</button>
      </section>

      <section v-if="!showingFavoriteSurface && visiblePinned && pinnedExpanded" class="modal-shell pinned-view-shell" role="dialog" aria-modal="true" aria-label="置顶消息" @click.self="pinnedExpanded = false">
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

      <div v-if="showFavorites" class="messages-viewport favorites-viewport">
        <div class="favorites-main-scroll">
          <div class="favorites-main-head">
            <span class="favorites-main-icon"><Heart :size="22" /></span>
            <div>
              <strong>我的收藏</strong>
            </div>
          </div>
          <p v-if="favoritesLoading" class="favorites-empty">正在加载收藏…</p>
          <p v-else-if="!favoriteMessages.length" class="favorites-empty">还没有收藏。长按聊天消息，再点击爱心即可收藏。</p>
          <div v-else class="favorites-main-list">
            <article
              v-for="favorite in favoriteMessages"
              :key="favorite.id"
              class="favorite-message-card"
              :class="{ 'favorite-image-card': favorite.message.type === 'image' }"
              @pointerdown="beginFavoriteLongPress(favorite, $event)"
              @pointermove="moveFavoriteLongPress"
              @pointerup="clearFavoriteLongPress"
              @pointerleave="clearFavoriteLongPress"
              @pointercancel="clearFavoriteLongPress"
              @contextmenu.prevent
            >
              <header class="favorite-message-head">
                <div class="avatar" :class="{ bot: favorite.message.sender.kind === 'virtual' }">
                  <img v-if="avatarUrl(favorite.message.sender.avatarPath)" :src="avatarUrl(favorite.message.sender.avatarPath)" alt="" decoding="async" />
                  <span v-else>{{ avatarText(favorite.message.sender.displayName) }}</span>
                </div>
                <div>
                  <strong>{{ favorite.message.sender.displayName }}</strong>
                  <small>{{ favorite.channel.name }} · 收藏于 {{ adminDate(favorite.savedAt) }}</small>
                </div>
                <button class="favorite-remove" type="button" @click="removeFavorite(favorite)" aria-label="取消收藏"><X :size="16" /></button>
              </header>
              <div class="favorite-message-content">
                <img v-if="favorite.message.type === 'image'" class="favorite-message-image" :src="fileUrl(favorite.message)" loading="lazy" alt="收藏的图片" />
                <div v-else-if="isVoiceMessage(favorite.message)" class="favorite-message-file"><Mic :size="19" /><span>语音消息 · {{ formatDuration(voiceDurationMs(favorite.message)) }}</span></div>
                <div v-else-if="favorite.message.type === 'file'" class="favorite-message-file"><FileUp :size="19" /><span>{{ favorite.message.fileName || "附件" }}</span><small>{{ compactBytes(favorite.message.fileSize) }}</small></div>
                <button v-else-if="favorite.message.type === 'music_playlist'" class="music-playlist-message-card" type="button" @click="openSharedMusicPlaylistFromTap(favorite.message)">
                  <span class="music-playlist-message-icon"><AudioLines :size="25" /></span>
                  <span v-if="favorite.message.musicPlaylist" class="music-playlist-message-copy"><strong>{{ favorite.message.musicPlaylist.name }}</strong><em>{{ favorite.message.musicPlaylist.trackCount }} 首</em></span>
                  <span v-else class="music-playlist-message-copy"><small>共享歌单</small><strong>歌单已删除</strong></span>
                  <ChevronRight :size="18" />
                </button>
                <div v-else-if="isMarkdownMessage(favorite.message)" class="message-text markdown-render" v-html="markdownMessageHtml(favorite.message)"></div>
                <div v-else class="message-text" v-html="messageContentHtml(favorite.message)"></div>
              </div>
              <footer class="favorite-message-actions">
                <span>长按卡片跳转</span>
                <button class="mini-btn secondary" type="button" @click="openFavoriteMessage(favorite)"><MessageSquareQuote :size="15" />查看上下文</button>
              </footer>
            </article>
          </div>
        </div>
      </div>

      <div v-else-if="showBibleFavorites" class="messages-viewport favorites-viewport bible-favorites-viewport">
        <div class="favorites-main-scroll">
          <div class="favorites-main-head bible-favorites-main-head">
            <span class="favorites-main-icon bible-favorites-main-icon"><Bookmark :size="22" /></span>
            <div>
              <strong>经文收藏</strong>
              <small>出处作为标题，正文自动展开一次</small>
            </div>
          </div>
          <p v-if="bibleFavoritesLoading && !bibleFavoritePassages.length" class="favorites-empty">正在加载经文收藏…</p>
          <p v-else-if="bibleFavoritesError" class="favorites-empty bible-favorites-error">{{ bibleFavoritesError }}<button class="mini-btn secondary" type="button" @click="loadBibleFavorites">重试</button></p>
          <p v-else-if="!bibleFavoritePassages.length" class="favorites-empty">还没有收藏经文。打开圣经，点选经文后点击“收藏”。</p>
          <div v-else class="favorites-main-list bible-favorite-passage-list">
            <article v-for="passage in bibleFavoritePassages" :key="passage.key" class="favorite-message-card bible-favorite-passage-card">
              <header class="bible-favorite-passage-head">
                <button type="button" @click="openBibleFavoritePassage(passage)">
                  <Bookmark :size="17" />
                  <strong>{{ passage.lookup.normalizedReference }}</strong>
                </button>
                <button class="favorite-remove" type="button" :disabled="bibleFavoritesLoading" @click="removeBibleFavoritePassage(passage)" aria-label="取消收藏这段经文"><X :size="16" /></button>
              </header>
              <div class="bible-favorite-expanded" aria-label="已自动展开的经文正文">
                <small>{{ passage.lookup.translation }}</small>
                <p class="formatted-bible-text">{{ formatBibleFavoriteBody(passage.lookup) }}</p>
              </div>
              <footer class="favorite-message-actions">
                <span>收藏于 {{ adminDate(passage.savedAt) }}</span>
                <button class="mini-btn secondary" type="button" @click="openBibleFavoritePassage(passage)"><BookOpen :size="15" />在圣经中阅读</button>
              </footer>
            </article>
          </div>
        </div>
      </div>

      <div
        v-else
        class="messages-viewport"
        :class="{
          'music-score-open': musicScoreOpen,
          'music-score-closing': musicScoreClosing,
          'music-score-chat-cleared': musicScoreChatCleared
        }"
      >
        <MusicManager
          v-if="isMusicChannel"
          embedded
          :tracks="musicTracks"
          :playlists="musicPlaylists"
          :current-track-id="currentMusicTrackId"
          :playing="musicPlaying"
          :can-manage-music="canManageMusic"
          :active-channel-id="currentChannel?.id ?? null"
          @play-track="selectMusicTrack"
          @toggle-current="toggleMusicPlayback"
          @toggle-favorite="toggleCurrentMusicFavorite"
          @refresh-tracks="loadMusicTracks"
          @refresh-playlists="loadMusicPlaylists"
        />
        <section v-if="musicScoreStageVisible" class="music-score-stage" :class="{ closing: musicScoreStageClosing }" aria-label="当前歌曲歌谱">
          <button class="music-score-close" type="button" @click="closeMusicScore()" aria-label="关闭歌谱"><X :size="21" /></button>
          <div v-if="currentMusicScores.length > 1" class="music-score-tabs" role="tablist" aria-label="选择歌谱">
            <button
              v-for="score in currentMusicScores"
              :key="score.id"
              type="button"
              role="tab"
              class="music-score-tab"
              :class="{ active: score.id === currentMusicScore?.id }"
              :aria-selected="score.id === currentMusicScore?.id"
              @click="currentMusicScoreId = score.id"
            >{{ score.title }}</button>
          </div>
          <div class="music-score-pages">
            <button
              v-for="(page, pageIndex) in currentMusicScorePages"
              :key="page.id"
              class="music-score-page"
              type="button"
              :style="{ '--score-page-index': Math.min(pageIndex, 8) }"
              @click="openMusicScorePreview(page)"
              :aria-label="isPdfScorePage(page) ? `打开 PDF 歌谱 ${page.fileName}` : `放大第 ${pageIndex + 1} 页歌谱`"
            >
              <PdfScoreInline v-if="isPdfScorePage(page)" :src="musicScorePageUrl(page)" />
              <img v-else :src="musicScorePageUrl(page)" :alt="`${currentMusicTrack?.title || '当前歌曲'}歌谱第 ${pageIndex + 1} 页`" draggable="false" />
            </button>
          </div>
        </section>
        <div
          v-if="!isMusicChannel"
          ref="scroller"
          class="messages-scroll"
          :class="{ 'timeline-scrolling': timelineScrollActive, 'messages-scroll--anchoring': initialChatAnchorPending || pendingReadPositionRestore }"
          @scroll.passive="handleMessagesScroll"
          @load.capture="reconcileReadPositionAfterLayout"
          @wheel.passive="handleTimelineScrollIntent"
          @touchmove.passive="handleTimelineScrollIntent"
          @click.capture="closeComposerMorePanel"
          @pointerdown.passive="handleMessagesPointerDown"
          @pointermove.passive="moveBlankScoreLongPress"
          @pointerup="clearBlankScoreLongPress"
          @pointercancel="clearBlankScoreLongPress"
          @pointerleave="clearBlankScoreLongPress"
        >
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
        <div
          v-if="timelineTopSpacerHeight > 0"
          class="message-virtual-spacer message-virtual-spacer-top"
          :style="{ height: `${timelineTopSpacerHeight}px` }"
          aria-hidden="true"
        ></div>
        <template v-for="{ row, timelineIndex, key: timelineKey } in renderedTimelineRows" :key="timelineKey">
          <div class="message-timeline-slot" :style="{ height: `${timelineReservedHeight(timelineKey)}px` }">
          <div
            v-if="row.kind === 'time'"
            class="time-separator"
            :class="timelineIndex % 2 === 0 ? 'score-exit-left' : 'score-exit-right'"
            :data-timeline-key="timelineKey"
          >{{ row.label }}</div>
          <button
            v-else-if="row.kind === 'version'"
            type="button"
            class="time-separator version-update-separator"
            :class="timelineIndex % 2 === 0 ? 'score-exit-left' : 'score-exit-right'"
            :data-timeline-key="timelineKey"
            @click="openVersionUpdateNotice"
          >{{ row.label }}</button>
          <article
            v-else
            class="message-row"
            :class="{
              mine: isMine(row.message),
              virtual: row.message.sender.kind === 'virtual',
              system: row.message.type === 'system',
              'mention-alert': isMentionAlertActive(row.message),
              selecting: messageSelectionMode,
              selected: selectedMessageIds.has(row.message.id),
              'score-exit-left': row.message.type === 'system' ? timelineIndex % 2 === 0 : !isMine(row.message),
              'score-exit-right': row.message.type === 'system' ? timelineIndex % 2 !== 0 : isMine(row.message)
            }"
            :data-message-id="row.message.id"
            :data-timeline-key="timelineKey"
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
            <div
              class="avatar presence-avatar avatar-clickable"
              :class="{ bot: row.message.sender.kind === 'virtual' }"
              role="button"
              :aria-label="`${row.message.sender.displayName} 的操作`"
              @click.stop="openSenderActions(row.message.sender, $event)"
            >
              <img v-if="avatarUrl(row.message.sender.avatarPath)" :src="avatarUrl(row.message.sender.avatarPath)" alt="" decoding="async" />
              <span v-else>{{ avatarText(row.message.sender.displayName) }}</span>
              <i v-if="isActorOnline(row.message.sender.id)" class="online-dot" aria-label="在线"></i>
            </div>
            <div class="bubble-wrap">
              <div class="sender-line">
                <span>{{ row.message.sender.displayName }}</span>
                <em v-if="row.message.sender.kind === 'virtual'">诶哎</em>
              </div>
              <div
                class="message-bubble-cluster"
                :class="{
                  'audio-score-cluster': isAudioMessage(row.message) && !!musicScorePreviewPage(row.message),
                  'music-playlist-cluster': row.message.type === 'music_playlist'
                }"
              >
              <div
                class="bubble"
                :class="[{ 'media-bubble': row.message.type === 'image' || row.message.type === 'file', 'link-preview-bubble': !!linkPreviewFor(row.message), 'prayer-bubble': row.message.type === 'prayer', 'chain-bubble': row.message.type === 'chain', 'music-playlist-bubble': row.message.type === 'music_playlist', 'text-selectable': textSelectableMessageId === row.message.id }, messageEffectClass(row.message)]"
                :style="messageEffectStyle(row.message)"
                :data-message-effect="messageEffect(row.message) || null"
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
                              <span class="inline-bible-passage"><span class="inline-bible-body">{{ formatBibleLookup(bibleReferenceLookup(messageBibleReferenceScope(row.message, 'chain'), segment.reference), segment.reference) }}</span><button class="inline-bible-reader-link" type="button" title="在圣经中阅读" aria-label="在圣经中阅读并高亮这处经文" @click.stop="openBibleReferenceInWorkspace(messageBibleReferenceScope(row.message, 'chain'), segment.reference)"><BookOpen :size="15" /></button></span>
                            </template>
                            <span v-else class="inline-bible-empty">暂时找不到这处经文</span>
                          </span>
                        </span>
                      </template>
                    </h3>
                    <small v-if="chainRequiresSelection(row.message)" class="chain-option-summary">
                      参与时需选择：{{ chainPayload(row.message).participation?.options.map((option) => option.label).join('、') }}、其他
                    </small>
                    <ol>
                      <li v-for="(p, idx) in chainPayload(row.message).participants" :key="idx">
                        <span>{{ idx + 1 }}. {{ p.name }}</span>
                        <small v-if="chainParticipantProject(p)">{{ chainParticipantProject(p) }}</small>
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
                    <div v-if="isMarkdownMessage(row.message)" class="prayer-text markdown-render" v-html="markdownMessageHtml(row.message)"></div>
                    <div v-else class="prayer-text bible-rich-text">
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
                              <span class="inline-bible-passage"><span class="inline-bible-body">{{ formatBibleLookup(bibleReferenceLookup(messageBibleReferenceScope(row.message, 'content'), segment.reference), segment.reference) }}</span><button class="inline-bible-reader-link" type="button" title="在圣经中阅读" aria-label="在圣经中阅读并高亮这处经文" @click.stop="openBibleReferenceInWorkspace(messageBibleReferenceScope(row.message, 'content'), segment.reference)"><BookOpen :size="15" /></button></span>
                            </template>
                            <span v-else class="inline-bible-empty">暂时找不到这处经文</span>
                          </span>
                        </span>
                      </template>
                    </div>
                    <button v-if="prayerPayload(row.message).imageMessageId" class="image-preview-button prayer-image" type="button" @click.stop="openPrayerImage(row.message, prayerPayload(row.message).imageMessageId!, $event)">
                      <img class="chat-image" :src="prayerImageUrl(prayerPayload(row.message).imageMessageId!)" alt="代祷附带照片" loading="lazy" />
                    </button>
                    <div v-if="prayerPayload(row.message).updates?.length" class="prayer-updates">
                      <div v-for="(update, idx) in prayerPayload(row.message).updates" :key="idx" class="prayer-update-entry">
                        <small>{{ adminDate(update.at) }}<template v-if="update.by"> · {{ update.by }}</template></small>
                        <div class="prayer-text bible-rich-text" v-html="update.content"></div>
                        <button v-if="update.imageMessageId" class="image-preview-button prayer-image" type="button" @click.stop="openPrayerImage(row.message, update.imageMessageId, $event)">
                          <img class="chat-image" :src="prayerImageUrl(update.imageMessageId)" alt="历史动态附带照片" loading="lazy" />
                        </button>
                      </div>
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
                        <img v-if="avatarUrl(person.avatarPath)" :src="avatarUrl(person.avatarPath)" alt="" decoding="async" />
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
                                <div class="inline-bible-passage"><p class="formatted-bible-text">{{ formatBibleLookup(bibleReferenceLookup(suggestion.id, reference), reference) }}</p><button class="inline-bible-reader-link" type="button" title="在圣经中阅读" aria-label="在圣经中阅读并高亮这处经文" @click.stop="openBibleReferenceInWorkspace(suggestion.id, reference)"><BookOpen :size="15" /></button></div>
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
                <template v-else-if="row.message.type === 'sermon_request'">
                  <SermonRequestCard :message="row.message" />
                </template>
                <template v-else-if="row.message.type === 'bible_session'">
                  <BibleSessionCard :message="row.message" @open="openBibleSessionFromMessage" />
                </template>
                <template v-else-if="row.message.type === 'chat_record'">
                  <ChatRecordCard :message="row.message" @open="openChatRecord" />
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
                <template v-else-if="row.message.type === 'music_playlist'">
                  <p v-if="sharedMusicPlaylistDescription(row.message)" class="music-playlist-message-text">{{ sharedMusicPlaylistDescription(row.message) }}</p>
                  <button
                    class="music-playlist-message-card"
                    type="button"
                    @pointerdown.stop="beginMessageLongPress(row.message, $event)"
                    @pointermove.stop="moveMessageLongPress"
                    @pointerup.stop="clearMessageLongPress"
                    @pointercancel.stop="clearMessageLongPress"
                    @pointerleave.stop="clearMessageLongPress"
                    @click.stop="openSharedMusicPlaylistFromTap(row.message)"
                  >
                    <span class="music-playlist-message-icon"><AudioLines :size="25" /></span>
                    <span v-if="row.message.musicPlaylist" class="music-playlist-message-copy">
                      <strong>{{ row.message.musicPlaylist.name }}</strong>
                      <em>{{ row.message.musicPlaylist.trackCount }} 首<template v-if="row.message.musicPlaylist.tracks.length"> · {{ row.message.musicPlaylist.tracks.slice(0, 3).map((track) => track.title).join('、') }}</template></em>
                    </span>
                    <span v-else class="music-playlist-message-copy"><small>共享歌单</small><strong>歌单已删除</strong><em>创建者已移除这个歌单</em></span>
                    <ChevronRight :size="18" />
                  </button>
                </template>
                <template v-else-if="row.message.type === 'image'">
                  <p v-if="brokenAttachmentIds.has(row.message.id)" class="attachment-broken">转发附件已被删除</p>
                  <button
                    v-else
                    class="image-preview-button"
                    :class="{ 'image-preview-sized': !!messageImageDimensions(row.message) }"
                    :style="messageImagePresentationStyle(row.message)"
                    aria-label="查看图片"
                    @click.stop="openAttachmentFromTap(row.message, $event)"
                  >
                    <img
                      class="chat-image"
                      :src="fileThumbUrl(row.message)"
                      :width="messageImageDimensions(row.message)?.width"
                      :height="messageImageDimensions(row.message)?.height"
                      loading="lazy"
                      decoding="async"
                      fetchpriority="low"
                      @load="handleMessageImageLoad(row.message, $event)"
                      @error="markAttachmentBroken(row.message)"
                      alt=""
                    />
                  </button>
                </template>
                <InlineAudioPlayer
                  v-else-if="isAudioMessage(row.message)"
                  :message="row.message"
                  :src="fileUrl(row.message)"
                  :unread="hasUnlistenedVoice(row.message)"
                  @play="markVoiceListened(row.message)"
                  @download="requestDownload(row.message, $event)"
                />
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
                  <template v-if="musicMentionPayload(row.message)">
                    <div class="message-text music-mention-text" v-html="musicMentionTextHtml(row.message)"></div>
                    <div
                      class="music-mention-capsule"
                      :class="{ playing: isMentionedMusicPlaying(row.message) }"
                      role="group"
                      :aria-label="`${musicMentionTitle(row.message)}播放控制`"
                      @click.stop
                      @pointerdown.stop
                    >
                      <button
                        v-if="!isMentionedMusicPlaying(row.message)"
                        type="button"
                        class="music-mention-capsule-action music-mention-capsule-play"
                        @click="toggleMentionedMusic(row.message)"
                        aria-label="播放歌曲"
                      >
                        <Play :size="16" fill="currentColor" />
                        <span>播放</span>
                      </button>
                      <template v-else>
                        <button type="button" class="music-mention-capsule-action music-mention-capsule-stop" @click="stopMentionedMusic(row.message)" aria-label="停止歌曲">
                          <Square :size="13" fill="currentColor" />
                          <span>停止</span>
                        </button>
                        <i class="music-mention-capsule-divider" aria-hidden="true"></i>
                        <button type="button" class="music-mention-capsule-action music-mention-capsule-pause" @click="toggleMentionedMusic(row.message)" aria-label="暂停歌曲">
                          <Pause :size="15" fill="currentColor" />
                          <span>暂停</span>
                        </button>
                      </template>
                    </div>
                    <button
                      v-if="musicMentionBackground(row.message)"
                      type="button"
                      class="music-mention-background-toggle"
                      :class="{ expanded: isMusicMentionBackgroundExpanded(row.message) }"
                      :aria-expanded="isMusicMentionBackgroundExpanded(row.message)"
                      aria-label="展开或收起写作背景"
                      @click.stop="toggleMusicMentionBackground(row.message)"
                      @pointerdown.stop
                    >
                      <BookOpen :size="13" />
                      <span>写作背景</span>
                      <ChevronDown :size="13" class="music-mention-background-chevron" />
                    </button>
                    <div
                      v-if="isMusicMentionBackgroundExpanded(row.message) && musicMentionBackground(row.message)"
                      class="music-mention-background"
                    >{{ musicMentionBackground(row.message) }}</div>
                  </template>
                  <template v-else>
                    <div v-if="isMarkdownMessage(row.message)" class="message-text markdown-render" v-html="markdownMessageHtml(row.message)"></div>
                    <div v-else class="message-text bible-rich-text">
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
                              <span class="inline-bible-passage"><span class="inline-bible-body">{{ formatBibleLookup(bibleReferenceLookup(messageBibleReferenceScope(row.message, 'content'), segment.reference), segment.reference) }}</span><button class="inline-bible-reader-link" type="button" title="在圣经中阅读" aria-label="在圣经中阅读并高亮这处经文" @click.stop="openBibleReferenceInWorkspace(messageBibleReferenceScope(row.message, 'content'), segment.reference)"><BookOpen :size="15" /></button></span>
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
                </template>
              </div>
              <button
                v-if="musicScorePreviewPage(row.message)"
                type="button"
                class="music-score-inline-preview"
                aria-label="查看这首歌的歌谱"
                @click.stop="openMusicScorePreview(musicScorePreviewPage(row.message)!, row.message.id)"
              >
                <img :src="musicScorePageUrl(musicScorePreviewPage(row.message)!)" alt="" loading="lazy" />
                <span aria-hidden="true">谱</span>
              </button>
              </div>
              <div v-if="row.message.reactions && (row.message.reactions.likeCount || row.message.reactions.favoriteCount)" class="message-reaction-details">
                <button
                  v-if="row.message.reactions.likeCount"
                  type="button"
                  class="reaction-detail reaction-like"
                  :class="{ active: row.message.reactions.currentUserLiked }"
                  :title="likedByTitle(row.message)"
                  @click="toggleMessageLike(row.message)"
                >
                  <ThumbsUp :size="13" />
                  <span>{{ row.message.reactions.likedBy.map((person) => person.displayName).join('、') || row.message.reactions.likeCount }}</span>
                </button>
                <button
                  v-if="row.message.reactions.favoriteCount"
                  type="button"
                  class="reaction-detail reaction-favorite"
                  :class="{ active: row.message.reactions.currentUserFavorited }"
                  @click="toggleMessageFavorite(row.message)"
                >
                  <Heart :size="13" :fill="row.message.reactions.currentUserFavorited ? 'currentColor' : 'none'" />
                  {{ row.message.reactions.currentUserFavorited ? `已收藏 · ${row.message.reactions.favoriteCount}` : `${row.message.reactions.favoriteCount} 人收藏` }}
                </button>
              </div>
            </div>
          </article>
          </div>
        </template>
        <div
          v-if="timelineBottomSpacerHeight > 0"
          class="message-virtual-spacer message-virtual-spacer-bottom"
          :style="{ height: `${timelineBottomSpacerHeight}px` }"
          aria-hidden="true"
        ></div>
        </div>
      </div>

      <button v-if="!showingFavoriteSurface && !isMusicChannel && (awayFromNewest || hasUnreadMessages || store.hasNewerMessages)" type="button" class="new-message-jump" aria-label="跳到最新消息" @click="scrollToNewest()">
        <ArrowDown :size="18" />
      </button>

      <footer v-if="!showingFavoriteSurface && !isMusicChannel" class="composer">
        <div v-if="replyTo" class="reply-bar">
          <button class="icon-btn" @click="replyTo = null" aria-label="取消引用"><X :size="16" /></button>
          <span>引用 {{ replyTo.sender.displayName }}：{{ replyPreviewText(replyTo) || replyTo.type }}</span>
        </div>
        <div v-if="selectedMusicMention" class="music-mention-chip">
          <AudioLines :size="17" />
          <span><small>已提及歌曲</small><strong>{{ selectedMusicMention.title }}</strong></span>
          <button class="icon-btn" type="button" @click="removeMusicMention" aria-label="取消提及歌曲"><X :size="16" /></button>
        </div>
        <div v-if="prayerComposerPhotoPreview" class="music-mention-chip prayer-photo-chip">
          <img :src="prayerComposerPhotoPreview" alt="代祷附带照片预览" />
          <span><small>已附照片</small><strong>随代祷一起发送</strong></span>
          <button class="icon-btn" type="button" @click="clearPrayerComposerPhoto" aria-label="移除附带照片"><X :size="16" /></button>
        </div>
        <div class="composer-input-shell">
          <div class="composer-main" :class="{ raised: composerPanel }">
            <button class="icon-btn composer-edge-btn" :class="{ active: composerPanel === 'voice' }" @click="toggleVoicePanel" aria-label="语音消息"><Mic :size="22" /></button>
            <div class="composer-glow-shell" :class="{ on: composerFocused }">
              <textarea
                ref="composerInput"
                v-model="input"
                rows="1"
                :class="{ 'composer-glow': composerFocused }"
                :placeholder="composerPromptText ? '' : (store.prayerOnly ? '输入代祷事项' : '')"
                @focus="composerFocused = true; focusComposer(); syncComposerCaret()"
                @blur="composerFocused = false"
                @input="onInput"
                @click="syncComposerCaret"
                @keyup="syncComposerCaret"
                @keydown="onKeydown"
                @paste="handleComposerPaste"
              ></textarea>
            </div>
            <span
              v-if="!input.trim() && composerPromptText"
              class="composer-prompt-overlay"
              :class="`phase-${composerPromptPhase}`"
              aria-hidden="true"
            ><span
                v-for="(char, index) in composerPromptChars"
                :key="index"
                class="composer-prompt-char"
                :style="composerPromptCharStyle(index)"
              >{{ char }}</span></span>
            <button
              v-if="canSendText"
              class="send-btn composer-edge-btn composer-send-btn"
              :disabled="!canSubmitText"
              :aria-label="messageSendPending ? '正在发送' : '发送'"
              :title="composerSendStatus || '发送'"
              @click="sendText"
            ><Send :size="19" /></button>
            <button v-else class="icon-btn composer-edge-btn" :class="{ active: composerPanel === 'more' }" @click="toggleMorePanel" aria-label="更多功能"><Plus :size="22" /></button>
            <input ref="fileInput" class="hidden" type="file" @change="handlePickedFile" />
            <input ref="photoInput" class="hidden" type="file" accept="image/*" multiple @change="handlePickedFiles" />
          </div>
          <small
            v-if="composerSendStatus"
            class="composer-send-status"
            :data-send-state="composerSendState"
            role="status"
            aria-live="polite"
          >{{ composerSendStatus }}</small>
          <div v-if="showComposerSuggestionMenu" class="composer-suggestion-menu">
            <template v-if="activeComposerSuggestionKind === 'music'">
              <button
                v-for="(track, index) in matchingMusicMentionTracks"
                :key="track.id"
                type="button"
                class="composer-suggestion music-suggestion"
                :class="{ active: index === composerSuggestionIndex }"
                @click="chooseMusicMentionSuggestion(track)"
              >
                <AudioLines :size="18" />
                <span>{{ track.title }}</span>
                <small>热度 {{ track.heat }}</small>
              </button>
            </template>
            <template v-else-if="activeComposerSuggestionKind === 'mention'">
              <button
                v-for="(member, index) in matchingMentionMembers"
                :key="member.id"
                type="button"
                class="composer-suggestion"
                :class="{ active: index === composerSuggestionIndex }"
                @click="chooseMentionSuggestion(member)"
              >
                <div class="avatar presence-avatar" :class="{ bot: member.kind === 'virtual' }">
                  <img v-if="avatarUrl(member.avatarPath)" :src="avatarUrl(member.avatarPath)" alt="" decoding="async" />
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
          <p v-if="recordingNotice" class="voice-recording-notice" role="alert">{{ recordingNotice }}</p>
          <div v-if="!audioPreviewUrl" class="record-strip" :class="{ recording: isRecording }">
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
          <div class="tool-tile-wrap photo-tool-wrap">
            <button class="tool-tile" @click="photoInput?.click()">
              <span><ImageIcon :size="25" /></span>
              <small>照片</small>
            </button>
            <label class="original-image-corner" :class="{ active: keepOriginalImages }" title="保留原图">
              <input v-model="keepOriginalImages" type="checkbox" />
              <span class="original-image-check"><CheckCircle2 v-if="keepOriginalImages" :size="13" /></span>
              <small>原图</small>
            </label>
          </div>
          <button class="tool-tile" @click="openChainModal">
            <span><Plus :size="25" /></span>
            <small>接龙</small>
          </button>
          <button class="tool-tile" @click="startPrayerComposer">
            <span><HeartHandshake :size="25" /></span>
            <small>代祷</small>
          </button>
          <button class="tool-tile" @click="openSermonWorkspace">
            <span><Monitor :size="25" /></span>
            <small>讲道台</small>
          </button>
        </div>
      </footer>
    </section>

    <aside v-if="!bibleOpen && !sermonWorkspaceOpen && !bookWorkspaceOpen" class="member-pane" :class="{ open: showMembers, collapsed: membersCollapsed }">
      <header class="pane-head member-pane-head">
        <div class="member-pane-title">
          <strong>{{ memberPaneTitle }}</strong>
          <small v-if="memberPaneSubtitle">{{ memberPaneSubtitle }}</small>
        </div>
        <button
          v-if="canManageActiveMembers"
          class="icon-btn"
          :class="{ active: memberRemoveMode }"
          @click="memberRemoveMode = !memberRemoveMode"
          aria-label="移除成员"
        >
          <Trash2 :size="18" />
        </button>
        <button v-if="canManageActiveMembers" class="icon-btn" @click="openMemberPicker()" aria-label="添加成员"><Plus :size="20" /></button>
        <button class="icon-btn desktop-only" @click="membersCollapsed = true; showMembers = false" aria-label="收起成员"><PanelRightClose :size="20" /></button>
        <button class="icon-btn tablet-down" @click="showMembers = false" aria-label="关闭成员"><X :size="20" /></button>
      </header>
      <div v-if="memberManageMsg" class="member-manage-msg">{{ memberManageMsg }}</div>
      <div class="member-list member-grid">
        <button v-if="canManageActiveMembers" class="member-tile member-tool-tile" @click="openMemberPicker()">
          <span class="member-tool-avatar"><Plus :size="22" /></span>
          <small>添加</small>
        </button>
        <button v-if="canManageActiveMembers" class="member-tile member-tool-tile" :class="{ active: memberRemoveMode }" @click="memberRemoveMode = !memberRemoveMode">
          <span class="member-tool-avatar danger"><Trash2 :size="20" /></span>
          <small>{{ memberRemoveMode ? "完成" : "移除" }}</small>
        </button>
        <button
          v-for="member in activeMemberPaneMembers"
          :key="`${member.kind}-${member.accountId || member.id || member.username}`"
          class="member-tile member-row"
          :class="{ removable: memberRemoveMode && canRemoveMemberFromActive(member), locked: memberRemoveMode && !canRemoveMemberFromActive(member) }"
          @click="memberRemoveMode ? removeMemberFromActive(member) : openMemberActions(member, $event)"
        >
          <div class="avatar presence-avatar" :class="{ bot: member.kind === 'virtual' }">
            <img v-if="avatarUrl(member.avatarPath)" :src="avatarUrl(member.avatarPath)" alt="" decoding="async" />
            <span v-else>{{ avatarText(member.displayName) }}</span>
            <i v-if="isAccountOnline(member.accountId)" class="online-dot" aria-label="在线"></i>
            <i v-if="memberRemoveMode && canRemoveMemberFromActive(member)" class="member-remove-badge" aria-hidden="true"><X :size="12" /></i>
          </div>
          <span>{{ member.displayName }}</span>
          <small v-if="memberRoleLabel(member)">{{ memberRoleLabel(member) }}</small>
          <Bot v-if="member.kind === 'virtual'" :size="15" />
        </button>
      </div>
    </aside>

    <div v-if="showChannels || showMembers" class="scrim" @click="showChannels = false; showMembers = false"></div>

    <FriendPrograms v-if="friendProgramsOpen" :player="friendPlayer" @close="friendProgramsOpen = false" />

    <ReceptionManager
      v-if="showReceptionManager"
      :open="showReceptionManager"
      :channels="store.channels"
      @close="showReceptionManager = false"
      @created="handleReceptionCreated"
      @updated="handleReceptionUpdated"
      @deleted="handleReceptionDeleted"
      @select="selectReceptionRoom"
    />

    <ChainCreateDialog
      :open="showChainModal"
      :busy="chainCreateBusy"
      :error="chainCreateError"
      @close="closeChainModal"
      @submit="createChain"
    />

    <section v-if="pendingPrayerUpdate" class="modal-shell" @mousedown.self="closePrayerUpdateEditor">
      <form class="small-modal prayer-update-modal" @submit.prevent="publishPrayerUpdate">
        <header class="modal-head">
          <strong>更新代祷最新动态</strong>
          <button class="icon-btn" type="button" @click="closePrayerUpdateEditor" aria-label="关闭最新动态编辑"><X :size="20" /></button>
        </header>
        <div class="form-grid modal-form">
          <textarea ref="prayerUpdateTextarea" v-model="prayerUpdateContent" rows="9" placeholder="写下最新动态…"></textarea>
          <div class="prayer-update-attach">
            <button class="mini-btn secondary" type="button" :disabled="prayerUpdateBusy" @click="prayerUpdatePhotoInput?.click()"><ImageIcon :size="15" />附上照片</button>
            <span v-if="prayerUpdatePhotoPreview" class="prayer-update-photo-chip">
              <img :src="prayerUpdatePhotoPreview" alt="已选照片预览" />
              <button class="icon-btn" type="button" :disabled="prayerUpdateBusy" aria-label="移除照片" @click="clearPrayerUpdatePhoto"><X :size="14" /></button>
            </span>
          </div>
          <input ref="prayerUpdatePhotoInput" class="hidden" type="file" accept="image/*" @change="handlePrayerUpdatePhotoPick" />
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

    <ChainJoinPopover
      v-if="pendingChain"
      :message="pendingChain"
      :anchor-element="chainPromptAnchor"
      :busy="chainJoinBusy"
      :error="chainJoinError"
      @close="closeChainJoin"
      @join="joinPendingChain"
    />

    <section v-if="pendingDownload" class="tap-popover download-popover" :style="downloadPromptStyle" data-download-popover>
      <div class="tap-popover-card">
        <div class="compact-confirm">
          <span>确定下载？</span>
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
        <div class="message-quick-reactions">
          <button type="button" :class="{ active: pendingMessageActions.reactions?.currentUserLiked }" @click="likeActionMessage" aria-label="点赞">
            <ThumbsUp :size="22" :fill="pendingMessageActions.reactions?.currentUserLiked ? 'currentColor' : 'none'" />
            <span>{{ pendingMessageActions.reactions?.currentUserLiked ? "已赞" : "点赞" }}</span>
          </button>
          <button type="button" class="favorite" :class="{ active: pendingMessageActions.reactions?.currentUserFavorited }" @click="favoriteActionMessage" aria-label="收藏">
            <Heart :size="23" :fill="pendingMessageActions.reactions?.currentUserFavorited ? 'currentColor' : 'none'" />
            <span>{{ pendingMessageActions.reactions?.currentUserFavorited ? "已收藏" : "收藏" }}</span>
          </button>
        </div>
        <div class="message-actions-list">
          <button type="button" @click="quoteActionMessage"><MessageSquareQuote :size="15" />引用</button>
          <button v-if="isForwardableMessage(pendingMessageActions)" type="button" @click="openSingleForward"><Send :size="15" />转发</button>
          <button type="button" @click="startSelectionFromAction"><CheckCircle2 :size="15" />多选</button>
          <button v-if="isManageableMusicMessage(pendingMessageActions)" type="button" @click="openMusicTrackInManager"><AudioLines :size="15" />在音乐管理中打开</button>
          <button v-if="canRecallMessage(pendingMessageActions) && !isManageableMusicMessage(pendingMessageActions)" type="button" class="danger" @click="recallActionMessage($event)"><Trash2 :size="15" />撤回</button>
          <button type="button" @click="selectActionMessageText"><CheckCircle2 :size="15" />选择文字</button>
        </div>
      </div>
    </section>

    <section v-if="forwardPickerOpen" class="modal-shell" @click.self="closeForwardDialog">
      <div class="small-modal forward-message-modal">
        <div v-if="forwardSuccess" class="forward-success">
          <CheckCircle2 :size="56" class="forward-success-icon" />
          <strong>已转发</strong>
        </div>
        <template v-else>
        <header class="modal-head">
          <div>
            <strong>{{ forwardConfirming ? "发送给" : "转发消息" }}</strong>
            <small>{{ forwardMode === "merged" ? `合并转发 ${forwardSourceMessages.length} 条消息` : `逐条转发 ${forwardSourceMessages.length} 条消息` }}</small>
          </div>
          <button class="icon-btn" type="button" :disabled="forwardBusy" @click="closeForwardDialog" aria-label="关闭转发"><X :size="20" /></button>
        </header>
        <div v-if="!forwardConfirming" class="forward-channel-body">
          <div v-if="forwardTargetChannels.length" class="forward-channel-list">
            <button
              v-for="channel in forwardTargetChannels"
              :key="channel.id"
              type="button"
              class="forward-channel-row"
              :class="{ selected: forwardChannelIds.includes(channel.id) }"
              @click="toggleForwardChannel(channel.id)"
            >
              <span class="channel-icon">{{ channel.icon }}</span>
              <span><strong>{{ channel.name }}</strong><small>{{ channel.description || (channel.kind === "direct" ? "私聊" : "群聊") }}</small></span>
              <CheckCircle2 v-if="forwardChannelIds.includes(channel.id)" :size="19" />
            </button>
          </div>
          <div v-else class="member-picker-empty">没有可转发的聊天</div>
          <p v-if="forwardError" class="form-error">{{ forwardError }}</p>
        </div>
        <div v-else class="forward-channel-body forward-confirm-body">
          <p class="forward-confirm-targets">发送给：{{ forwardSelectedChannels.map((channel) => channel.name).join("、") }}</p>
          <div v-if="forwardMode === 'merged'" class="chat-record-card forward-confirm-preview">
            <strong class="chat-record-title">{{ forwardMergedPreviewPayload.title }}</strong>
            <span v-for="(line, index) in forwardMergedPreviewLines" :key="index" class="chat-record-line">{{ line }}</span>
            <span class="chat-record-footer">聊天记录</span>
          </div>
          <p v-else class="forward-confirm-summary">逐条发送 {{ forwardSourceMessages.length }} 条消息</p>
          <p v-if="forwardError" class="form-error">{{ forwardError }}</p>
        </div>
        <div class="confirm-actions member-picker-actions">
          <template v-if="!forwardConfirming">
            <button class="mini-btn secondary" type="button" :disabled="forwardBusy" @click="closeForwardDialog">取消</button>
            <button class="primary-btn" type="button" :disabled="!forwardChannelIds.length" @click="forwardConfirming = true">
              确定<template v-if="forwardChannelIds.length">（{{ forwardChannelIds.length }}）</template>
            </button>
          </template>
          <template v-else>
            <button class="mini-btn secondary" type="button" :disabled="forwardBusy" @click="forwardConfirming = false">取消</button>
            <button class="primary-btn" type="button" :disabled="forwardBusy" @click="submitMessageForward">
              {{ forwardBusy ? "发送中..." : "发送" }}
            </button>
          </template>
        </div>
        </template>
      </div>
    </section>

    <section v-if="forwardActionSheetOpen" class="modal-shell forward-sheet-shell" @click.self="forwardActionSheetOpen = false">
      <div class="forward-action-sheet" role="dialog" aria-label="选择转发方式">
        <button type="button" @click="chooseForwardMode('separate')">逐条转发</button>
        <button type="button" @click="chooseForwardMode('merged')">合并转发</button>
        <button type="button" class="forward-action-cancel" @click="forwardActionSheetOpen = false">取消</button>
      </div>
    </section>

    <ChatRecordView v-if="chatRecordViewMessage" :message="chatRecordViewMessage" @close="chatRecordViewMessage = null" />

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
            <button
              class="mini-btn secondary"
              :disabled="selectedMember.kind === 'virtual' ? selectedMember.username !== 'why_assistant' : (!selectedMember.accountId || selectedMember.accountId === store.account.id)"
              @click="startPrivateChat(selectedMember)"
            >
              <MessageCircle :size="15" />私聊
            </button>
          </div>
        </div>
      </div>
    </section>

    <section v-if="showChannelEditor" class="modal-shell" @click.self="closeChannelEditor">
      <form class="small-modal channel-editor-modal" @submit.prevent="saveChannelEditor">
        <header class="modal-head">
          <div>
            <strong>{{ channelEditorTitle }}</strong>
            <small>{{ channelEditorSubtitle }}</small>
          </div>
          <button class="icon-btn" type="button" :disabled="channelEditorBusy" @click="closeChannelEditor" aria-label="关闭频道设置"><X :size="20" /></button>
        </header>
        <div class="form-grid modal-form channel-editor-form">
          <div v-if="isTwoPersonDirectEditor && canEditChannel(channelEditorChannel)" class="direct-chat-follow-note">
            <span class="direct-chat-follow-icon"><LockKeyhole :size="18" /></span>
            <span>
              <strong>显示对方的资料</strong>
              <small>双人私聊的名称和图标会自动跟随对方的昵称与头像。</small>
            </span>
          </div>
          <template v-if="channelEditorMode === 'edit' && channelEditorChannel && !isTwoPersonDirectEditor && canEditChannel(channelEditorChannel)">
            <label>频道图标</label>
            <label class="channel-editor-icon-picker upload-icon-trigger" :aria-label="`上传 ${channelEditorChannel.name} 的频道图标`" title="点击上传图标">
              <span v-if="channelEditorChannel?.kind === 'music'" class="channel-icon-glyph" aria-hidden="true">歌</span>
              <img v-else :src="channelIconUrl(channelEditorChannel)" alt="" />
              <span><Upload :size="15" />更换图标</span>
              <input class="hidden" type="file" accept="image/*" :disabled="channelEditorBusy" @change="uploadChannelEditorIcon" />
            </label>
          </template>
          <template v-if="!isTwoPersonDirectEditor && (channelEditorMode === 'create' || canEditChannel(channelEditorChannel))">
            <label class="channel-name-label">
              <span>频道名称</span>
              <button
                v-if="isGroupDirectEditor"
                class="text-action"
                type="button"
                :disabled="channelNameSuggestionBusy"
                @click="requestDirectChatNameSuggestions"
              >
                <WandSparkles :size="14" />{{ channelNameSuggestionBusy ? "正在想..." : "换一个" }}
              </button>
            </label>
            <input v-model="channelEditorDraft.name" maxlength="80" autocomplete="off" placeholder="频道名" />
            <div v-if="isGroupDirectEditor && channelNameSuggestions.length" class="direct-name-suggestions" aria-label="私聊名称备选">
              <button
                v-for="suggestion in channelNameSuggestions"
                :key="suggestion"
                class="direct-name-option"
                :class="{ selected: channelEditorDraft.name === suggestion }"
                type="button"
                @click="channelEditorDraft.name = suggestion"
              >
                {{ suggestion }}
              </button>
            </div>
            <label>频道描述</label>
            <textarea v-model="channelEditorDraft.description" maxlength="255" rows="3" placeholder="描述"></textarea>
          </template>
          <label v-if="channelEditorMode === 'create'" class="check-row check-row-inline">
            <input v-model="channelEditorDraft.isPrivate" type="checkbox" />
            <span>私密频道</span>
          </label>
          <label v-if="channelEditorMode === 'create' || canEditChannel(channelEditorChannel)" class="check-row check-row-inline">
            <input v-model="channelEditorDraft.useListColor" type="checkbox" />
            <span>自定义频道列表底色</span>
          </label>
          <label v-if="channelEditorDraft.useListColor && (channelEditorMode === 'create' || canEditChannel(channelEditorChannel))" class="channel-list-color-field">
            <span>列表底色</span>
            <input v-model="channelEditorDraft.listColor" type="color" aria-label="频道列表底色" />
            <code>{{ channelEditorDraft.listColor }}</code>
          </label>
          <p v-if="channelEditorMsg" class="form-error">{{ channelEditorMsg }}</p>
          <div
            v-if="channelEditorMode === 'edit' && channelEditorChannel && !canEditChannel(channelEditorChannel)"
            class="direct-chat-follow-note"
          >
            <span class="direct-chat-follow-icon"><LockKeyhole :size="18" /></span>
            <span>
              <strong>{{ channelEditorChannel.name }}</strong>
              <small>{{ channelEditorChannel.description || "私密频道" }}</small>
            </span>
          </div>
          <div class="confirm-actions channel-editor-actions">
            <button
              v-if="channelEditorMode === 'edit' && canEditChannel(channelEditorChannel)"
              class="mini-btn secondary"
              type="button"
              :disabled="channelEditorBusy"
              @click="openChannelEditorMembers"
            >
              <Users :size="15" />成员
            </button>
            <button
              v-if="channelEditorMode === 'edit' && canLeaveChannel(channelEditorChannel)"
              class="mini-btn danger-action"
              type="button"
              :disabled="channelEditorBusy || channelLeaveBusy"
              @click="requestLeaveChannel()"
            >
              <LogOut :size="15" />退出频道
            </button>
            <button class="mini-btn secondary" type="button" :disabled="channelEditorBusy" @click="closeChannelEditor">
              {{ channelEditorMode === "edit" && !canEditChannel(channelEditorChannel) ? "关闭" : "取消" }}
            </button>
            <button
              v-if="channelEditorMode === 'create' || canEditChannel(channelEditorChannel)"
              class="primary-btn"
              type="submit"
              :disabled="!canSubmitChannelDraft(channelEditorDraft, channelEditorBusy)"
            >
              {{ channelEditorBusy ? "保存中..." : channelEditorMode === "create" ? "创建" : "保存" }}
            </button>
          </div>
        </div>
      </form>
    </section>

    <section v-if="memberPickerOpen" class="modal-shell" @click.self="closeMemberPicker">
      <form class="small-modal member-picker-modal" @submit.prevent="addSelectedMembers">
        <header class="modal-head">
          <strong>{{ memberPickerTitle }}</strong>
          <button class="icon-btn" type="button" @click="closeMemberPicker" aria-label="关闭添加成员"><X :size="20" /></button>
        </header>
        <div class="member-picker-body">
          <div v-if="memberPickerBusy" class="member-picker-empty">加载中...</div>
          <div v-else-if="memberPickerCandidates.length" class="member-picker-list">
            <button
              v-for="candidate in memberPickerCandidates"
              :key="memberPickerCandidateKey(candidate)"
              type="button"
              class="member-picker-row"
              :class="{ selected: memberPickerSelectedIds.includes(memberPickerCandidateKey(candidate)) }"
              @click="toggleMemberPickerAccount(candidate)"
            >
              <div class="avatar presence-avatar" :class="{ bot: candidate.kind === 'virtual' }">
                <img v-if="avatarUrl(candidate.avatarPath)" :src="avatarUrl(candidate.avatarPath)" alt="" decoding="async" />
                <span v-else>{{ avatarText(candidate.displayName) }}</span>
                <i v-if="candidate.accountId && isAccountOnline(candidate.accountId)" class="online-dot" aria-label="在线"></i>
              </div>
              <span>
                <strong>{{ candidate.displayName }}</strong>
                <small>{{ candidate.kind === "virtual" ? "AI 角色" : `@${candidate.username}` }}</small>
              </span>
              <CheckCircle2 v-if="memberPickerSelectedIds.includes(memberPickerCandidateKey(candidate))" :size="18" />
            </button>
          </div>
          <div v-else class="member-picker-empty">没有可添加的人</div>
        </div>
        <div class="confirm-actions member-picker-actions">
          <button class="mini-btn secondary" type="button" :disabled="memberPickerBusy" @click="closeMemberPicker">取消</button>
          <button class="primary-btn" type="submit" :disabled="memberPickerBusy || !memberPickerSelectedIds.length">
            {{ memberPickerBusy ? "添加中..." : `添加 ${memberPickerSelectedIds.length || ""}` }}
          </button>
        </div>
      </form>
    </section>

    <section v-if="ownerTransferOpen" class="modal-shell" @click.self="closeOwnerTransfer">
      <form class="small-modal member-picker-modal" @submit.prevent="transferOwnedChannelAndLeave">
        <header class="modal-head">
          <div>
            <strong>移交负责人并退出</strong>
            <small>{{ ownerTransferChannel?.name }}</small>
          </div>
          <button class="icon-btn" type="button" :disabled="ownerTransferBusy" @click="closeOwnerTransfer" aria-label="关闭负责人移交"><X :size="20" /></button>
        </header>
        <p class="owner-transfer-note">选择一位现有成员作为新的频道负责人。确认后，你会立即退出这个频道。</p>
        <div class="member-picker-body">
          <div v-if="ownerTransferCandidates.length" class="member-picker-list">
            <button
              v-for="candidate in ownerTransferCandidates"
              :key="candidate.accountId"
              type="button"
              class="member-picker-row"
              :class="{ selected: ownerTransferSuccessorId === candidate.accountId }"
              :disabled="ownerTransferBusy"
              @click="ownerTransferSuccessorId = candidate.accountId || null"
            >
              <div class="avatar presence-avatar">
                <img v-if="avatarUrl(candidate.avatarPath)" :src="avatarUrl(candidate.avatarPath)" alt="" decoding="async" />
                <span v-else>{{ avatarText(candidate.displayName) }}</span>
                <i v-if="candidate.accountId && isAccountOnline(candidate.accountId)" class="online-dot" aria-label="在线"></i>
              </div>
              <span>
                <strong>{{ candidate.displayName }}</strong>
                <small>@{{ candidate.username }}</small>
              </span>
              <CheckCircle2 v-if="ownerTransferSuccessorId === candidate.accountId" :size="18" />
            </button>
          </div>
          <div v-else class="member-picker-empty">还没有可接任的成员，请先添加成员。</div>
        </div>
        <p v-if="ownerTransferMsg" class="form-error owner-transfer-error">{{ ownerTransferMsg }}</p>
        <div class="confirm-actions member-picker-actions">
          <button class="mini-btn secondary" type="button" :disabled="ownerTransferBusy" @click="closeOwnerTransfer">取消</button>
          <button class="primary-btn owner-transfer-submit" type="submit" :disabled="ownerTransferBusy || !ownerTransferSuccessorId">
            {{ ownerTransferBusy ? "正在移交..." : "指定并退出" }}
          </button>
        </div>
      </form>
    </section>

    <MusicManager
      v-if="musicManagerOpen"
      ref="musicManagerRef"
      :tracks="musicTracks"
      :playlists="musicPlaylists"
      :current-track-id="currentMusicTrackId"
      :playing="musicPlaying"
      :can-manage-music="canManageMusic"
      :active-channel-id="currentChannel?.id ?? null"
      :initial-focus="musicManagerInitialFocus"
      @close="musicManagerOpen = false"
      @play-track="selectMusicTrack"
      @toggle-current="toggleMusicPlayback"
      @toggle-favorite="toggleCurrentMusicFavorite"
      @refresh-tracks="loadMusicTracks"
      @refresh-playlists="loadMusicPlaylists"
    />

    <SermonOverlay v-if="sermonJoinedPresentationId !== null && sermonOverlayState?.active" />
    <div v-if="sermonDecisionNotice" class="sermon-decision-toast" role="status">{{ sermonDecisionNotice }}</div>

    <section v-if="previewMessage" class="modal-shell media-preview-shell" :class="{ image: previewMessage.type === 'image', score: previewPinnedImage?.score }" @click.self="closePreviewMessage">
      <div class="media-preview-modal" :class="{ 'image-preview-modal': previewMessage.type === 'image', 'score-preview-modal': previewPinnedImage?.score }">
        <header v-if="previewMessage.type !== 'image'" class="modal-head">
          <strong>{{ previewMessage.fileName || "图片预览" }}</strong>
        </header>
        <button class="preview-control preview-close" @click="closePreviewMessage" aria-label="关闭预览"><X :size="22" /></button>
        <button class="preview-control preview-download" @click.stop="previewMessage.type === 'image' ? downloadPreviewImage() : downloadFile(previewMessage)" aria-label="下载"><Download :size="20" /></button>
        <div v-if="previewPinnedImage?.score && (previewScorePages.length > 1 || (previewScoreTrack?.scores?.length || 0) > 1)" class="score-preview-pager">
          <template v-if="previewScorePages.length > 1">
            <button type="button" @click.stop="shiftMusicScorePreview(-1)" aria-label="上一页歌谱"><ChevronLeft :size="23" /></button>
            <span>{{ previewScorePageIndex + 1 }} / {{ previewScorePages.length }}</span>
            <button type="button" @click.stop="shiftMusicScorePreview(1)" aria-label="下一页歌谱"><ChevronRight :size="23" /></button>
          </template>
          <span v-if="(previewScoreTrack?.scores?.length || 0) > 1" class="score-preview-score-name">{{ previewScoreEntry?.title }}</span>
        </div>
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
          <video v-else-if="isVideoMessage(previewMessage)" class="media-preview-video" :src="fileUrl(previewMessage)" controls autoplay playsinline preload="metadata"></video>
          <PdfViewer
            v-else-if="isPdfMessage(previewMessage)"
            :src="previewPinnedImage?.score ? previewPinnedImage.url : fileUrl(previewMessage)"
            :file-name="previewMessage.fileName || undefined"
            @close="closePreviewMessage"
          />
        </div>
      </div>
    </section>

    <section v-if="showPinnedEditor" class="modal-shell" role="dialog" aria-modal="true" aria-label="编辑置顶消息" @click.self="showPinnedEditor = false">
      <div class="small-modal pinned-editor-modal">
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
              <div class="pinned-editor-block-actions">
                <button class="mini-btn secondary" :disabled="index === 0" @click="movePinnedBlock(index, -1)"><ArrowUp :size="15" />上移</button>
                <button class="mini-btn secondary" :disabled="index === pinnedEditBlocks.length - 1" @click="movePinnedBlock(index, 1)"><ArrowDown :size="15" />下移</button>
                <button class="mini-btn danger-action" @click="removePinnedBlock(index)"><Trash2 :size="15" />删除此块</button>
              </div>
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

    <section v-if="pendingLeaveChannel" class="modal-shell" @click.self="!channelLeaveBusy && (pendingLeaveChannel = null)">
      <div class="small-modal">
        <header class="modal-head">
          <strong>退出频道</strong>
          <button class="icon-btn" :disabled="channelLeaveBusy" @click="pendingLeaveChannel = null" aria-label="取消退出频道"><X :size="20" /></button>
        </header>
        <div class="confirm-body">
          <p>退出后，这个频道会从你的列表中移除，你也不会再收到它的新消息或通知。</p>
          <strong>{{ pendingLeaveChannel.name }}</strong>
          <p v-if="channelLeaveMsg" class="form-error">{{ channelLeaveMsg }}</p>
          <div class="confirm-actions">
            <button class="mini-btn secondary" :disabled="channelLeaveBusy" @click="pendingLeaveChannel = null">取消</button>
            <button class="primary-btn" :disabled="channelLeaveBusy" @click="leavePendingChannel">
              {{ channelLeaveBusy ? "正在退出..." : "确认退出" }}
            </button>
          </div>
        </div>
      </div>
    </section>

    <section v-if="pendingCloseChannel" class="modal-shell" @click.self="pendingCloseChannel = null">
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

    <SettingsPanel v-if="showSettings" :account="accountSettings" :settings="settingsPanelBindings" />

    <AdminPanel v-if="showAdmin" :tools="adminTools" :release="adminReleaseBindings" :actions="adminPanelActions" />

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
              <option v-for="option in appearanceImagePickerFitOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </div>
          <div v-if="appearanceImagePickerSelection" class="appearance-picker-current">
            <img :src="wallpaperUrl(appearanceImagePickerSelection)" alt="" />
            <div>
              <b>当前草稿</b>
              <small>{{ appearanceImagePickerSelection }}<template v-if="appearanceImagePickerFit"> · {{ appearanceImagePickerFitOptions.find((option) => option.value === appearanceImagePickerFit)?.label }}</template></small>
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
              <img :src="wallpaperUrl(image.fileName)" alt="" />
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
