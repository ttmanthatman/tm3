export type ActorKind = "human" | "virtual" | "system";
export type MessageType = "text" | "image" | "file" | "music_playlist" | "chain" | "prayer" | "why_topic_card" | "system";
export type MessageEffect = "flash" | "shine" | "shake" | "fly" | "drip" | "rain" | "oops" | "sunburst" | "marquee" | "water" | "dripGooey";
export type PrayerStatus = "active" | "closed" | "answered";

export interface ActorDTO {
  id: number;
  kind: ActorKind;
  username: string;
  displayName: string;
  avatarPath?: string | null;
}

export interface ReplyPreviewDTO {
  id: number;
  content: string;
  type: MessageType;
  senderName: string;
}

export interface ChainPayload {
  topic: string;
  participants: Array<{
    actorId: number;
    name: string;
    text: string;
    at: string;
  }>;
}

export interface MessageEffectPayload {
  effect?: MessageEffect;
}

export interface PrayerPayload extends MessageEffectPayload {
  kind: "prayer";
  status: PrayerStatus;
  statusAt?: string;
  statusBy?: string;
  sourcePrayerMessageId?: number | null;
  latestUpdateAt?: string;
  latestUpdateBy?: string;
  prayerCount: number;
  prayerActionCount: number;
  currentUserPrayed: boolean;
  prayedBy: Array<{
    accountId: number;
    displayName: string;
    avatarPath?: string | null;
    latestPrayedAt: string;
    times: number;
  }>;
  aiSuggestions?: AiSuggestionDTO[];
  aiSuggestionSuccessCount?: number;
  aiSuggestionMaxSuccess?: number;
}

export interface MessageDTO {
  id: number;
  channelId: number;
  sender: ActorDTO;
  content: string;
  type: MessageType;
  payload?: unknown;
  fileName?: string | null;
  fileSize?: number | null;
  scores?: MusicScoreDTO[];
  lyrics?: MusicLyricsDTO | null;
  voiceListened?: boolean;
  replyTo?: ReplyPreviewDTO | null;
  chainRootId?: number | null;
  chainVersion?: number | null;
  createdAt: string;
  reactions?: MessageReactionsDTO;
  musicPlaylist?: MusicPlaylistDTO | null;
}

export interface MessageReactionsDTO {
  likeCount: number;
  likedBy: Array<{
    accountId: number;
    displayName: string;
    avatarPath?: string | null;
  }>;
  favoriteCount: number;
  currentUserLiked: boolean;
  currentUserFavorited: boolean;
}

export interface FavoriteMessageDTO {
  id: number;
  savedAt: string;
  channel: { id: number; name: string };
  message: MessageDTO;
}

export interface LikeNotificationDTO {
  id: number;
  channelId: number;
  messageId: number;
  senderName: string;
  likerName: string;
  createdAt: string;
}

export interface LinkPreviewDTO {
  url: string;
  title: string;
  description?: string;
  image?: string;
  siteName?: string;
}

export interface AdminMessageDTO {
  id: number;
  channelId: number;
  channelName: string;
  senderName: string;
  type: MessageType;
  content: string;
  fileName?: string | null;
  fileSize?: number | null;
  createdAt: string;
}

export interface AdminAttachmentDTO {
  id: string;
  kind: "upload" | "avatar" | "background";
  fileName: string;
  label: string;
  size: number;
  url?: string;
  createdAt?: string | null;
  messageId?: number | null;
  channelName?: string | null;
  ownerName?: string | null;
  usage: string[];
  exists: boolean;
}

export interface AdminBackupDTO {
  fileName: string;
  size: number;
  createdAt: string;
  url: string;
}

export interface PinnedDTO {
  id: number;
  kind: "notice" | "message";
  title?: string | null;
  content?: string | null;
  body?: PinnedBodyDTO | null;
  messageId?: number | null;
  message?: MessageDTO | null;
  version: number;
  dismissed?: boolean;
}

export type PinnedContentBlockDTO =
  | {
      id: string;
      type: "text";
      text: string;
    }
  | {
      id: string;
      type: "image" | "file";
      fileName: string;
      filePath: string;
      fileSize?: number | null;
    };

export interface PinnedBodyDTO {
  blocks: PinnedContentBlockDTO[];
}

export interface ChannelDTO {
  id: number;
  name: string;
  description: string;
  icon: string;
  kind: "standard" | "direct" | "why" | "aiLounge" | "music";
  isPrivate: boolean;
  isDefault: boolean;
  directKey?: string | null;
  canManage?: boolean;
  canWrite?: boolean;
  canPin?: boolean;
  hasPrayerItems?: boolean;
  memberCount: number;
  lastMessageId: number | null;
  pinned?: PinnedDTO | null;
}

export interface MusicTrackDTO {
  id: number;
  canManage: boolean;
  title: string;
  fileName: string;
  fileSize: number;
  createdAt: string;
  heat: number;
  manualOrder: number;
  favorited?: boolean;
  scores: MusicScoreDTO[];
  lyrics: MusicLyricsDTO | null;
  background: string | null;
  lyricsText: string | null;
}

export type MusicPlaylistSourceKind = "library" | "favorites" | "playlist";
export type MusicPlaybackModeDTO = "playlist" | "single" | "shuffle";

export interface MusicPlaylistDTO {
  id: number;
  name: string;
  ownerAccountId: number;
  ownerName: string;
  isOwner: boolean;
  trackCount: number;
  tracks: MusicTrackDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface MusicPlaybackStateDTO {
  sourceKind: MusicPlaylistSourceKind;
  playlistId: number | null;
  trackId: number | null;
  progressMs: number;
  playbackMode: MusicPlaybackModeDTO;
  updatedAt: string;
}

export interface MusicListenerDTO {
  accountId: number;
  displayName: string;
  trackId: number;
  trackTitle: string;
}

export interface BibleReaderPresenceDTO {
  accountId: number;
  displayName: string;
  bookName: string | null;
}

export interface MusicLyricCueDTO {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
  segments?: MusicLyricSegmentDTO[];
}

export interface MusicLyricSegmentDTO {
  startMs: number;
  endMs: number;
  text: string;
}

export interface MusicLyricsDTO {
  id: number;
  fileName: string;
  cues: MusicLyricCueDTO[];
}

export interface MusicMentionPayload {
  musicTrackId: number;
  musicTrackTitle: string;
}

export interface MusicScoreDTO {
  id: number;
  title: string;
  kind: "image" | "pdf";
  pages: MusicScorePageDTO[];
}

export interface MusicLyricsResourceDTO {
  id: number;
  fileName: string;
  cueCount: number;
  createdAt: string;
  uploadedByAccountId: number | null;
  uploadedByName: string | null;
}

export interface MusicScoreResourceDTO {
  id: number;
  title: string;
  kind: "image" | "pdf";
  pageCount: number;
  previewPageId: number | null;
  createdAt: string;
  uploadedByAccountId: number | null;
  uploadedByName: string | null;
}

export interface MusicResourcePoolDTO {
  lyrics: MusicLyricsResourceDTO[];
  scores: MusicScoreResourceDTO[];
}

export interface MusicScorePageDTO {
  id: number;
  scoreId: number;
  pageIndex: number;
  fileName: string;
  fileSize: number;
  width: number;
  height: number;
}

export interface AdminChannelDTO extends ChannelDTO {
  messageCount: number;
  createdAt: string;
  lastMessageAt?: string | null;
}

export interface AccountDTO {
  id: number;
  username: string;
  displayName: string;
  avatarPath?: string | null;
  isAdmin: boolean;
  canPinMessages: boolean;
  actorId: number;
  theme: string;
  biblePreferences: BiblePreferencesDTO;
}

export interface AuthResponse {
  token: string;
  account: AccountDTO;
}

export interface DeviceSessionDTO {
  id: string;
  deviceKind: "desktop" | "mobile" | "tablet";
  deviceName: string;
  ipAddress?: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

export type AdminLoginLogKind =
  | "auth_login"
  | "auth_logout"
  | "session_replaced"
  | "session_revoked"
  | "presence_join"
  | "presence_leave"
  | "music_progress"
  | "channel_view"
  | "message_sent";

export interface AdminLoginLogDTO {
  id: string;
  kind: AdminLoginLogKind;
  category: "session" | "music" | "usage";
  accountId: number;
  username: string;
  displayName: string;
  deviceKind?: DeviceSessionDTO["deviceKind"] | null;
  deviceName?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  sessionId?: string | null;
  channelId?: number | null;
  channelName?: string | null;
  trackId?: number | null;
  trackTitle?: string | null;
  playbackId?: string | null;
  appVersion?: string | null;
  latestVersion?: string | null;
  isLatestVersion?: boolean | null;
  state?: string | null;
  progressMs?: number | null;
  listenedMs?: number | null;
  durationMs?: number | null;
  createdAt: string;
}

export interface VersionDTO {
  version: string;
  date: string;
  developer: string;
  notes: readonly string[];
  update?: {
    repoUrl: string;
    branch: string;
    restartMode?: string;
    pm2App?: string;
  };
}

export interface UpdateStatusDTO {
  state: "idle" | "running" | "complete" | "failed" | "unknown" | string;
  progress: number;
  detail: string;
  updatedAt?: string;
  log: string[];
}

export interface UpdateCheckDTO {
  current: string;
  latest: string;
  updateAvailable: boolean;
  repo: string;
  branch: string;
  branches: string[];
  url: string;
  restartMode?: string;
  status: UpdateStatusDTO;
}

export interface ThemePaletteDTO {
  accent: string;
  accentDark: string;
  buttonText: string;
  bg: string;
  chatBg: string;
  panel: string;
  line: string;
  text: string;
  muted: string;
  bubbleOther: string;
  bubbleOtherText: string;
  bubbleMine: string;
  bubbleMineText: string;
}

export interface ThemeDTO {
  id: string;
  name: string;
  palette: ThemePaletteDTO;
}

export type AiSuggestionKind = "prayer_related_verses";
export type AiSuggestionStatus = "success" | "failed";

export interface AiSuggestionDTO {
  id: number;
  kind: AiSuggestionKind;
  status: AiSuggestionStatus;
  references: string[];
  responseText: string;
  createdByName?: string | null;
  createdAt: string;
  model?: string | null;
}

export interface BibleVerseLineDTO {
  book: string;
  chapter: number;
  verse: number;
  endVerse: number;
  reference: string;
  text: string;
}

export interface BibleLookupDTO {
  reference: string;
  normalizedReference: string;
  translation: string;
  sourceId: string;
  verses: BibleVerseLineDTO[];
}

export interface BibleChapterVerseFragmentDTO {
  verse: BibleVerseLineDTO;
  text: string;
  start: number;
  end: number;
  showVerseNumber: boolean;
}

export type BibleChapterBlockDTO =
  | { type: "heading"; level: 1 | 2; text: string }
  | { type: "parallel"; text: string }
  | { type: "description"; text: string }
  | { type: "speaker"; text: string }
  | { type: "spacing" }
  | { type: "paragraph"; style: "prose" | "poetry"; fragments: BibleChapterVerseFragmentDTO[] };

export interface BibleChapterDTO {
  bookCode: string;
  bookName: string;
  chapter: number;
  translation: string;
  sourceId: string;
  verses: BibleVerseLineDTO[];
  blocks: BibleChapterBlockDTO[];
}

export interface BibleFavoriteKeyDTO {
  bookCode: string;
  chapter: number;
  verse: number;
}

export interface BibleFavoriteDTO extends BibleFavoriteKeyDTO {
  id: number;
  color: string;
  savedAt: string;
  verseLine: BibleVerseLineDTO;
}

export interface BibleBookCatalogDTO {
  code: string;
  name: string;
  chapterCount: number;
}

export interface BibleCatalogDTO {
  translation: string;
  sourceId: string;
  oldTestament: BibleBookCatalogDTO[];
  newTestament: BibleBookCatalogDTO[];
}

export type BibleTextSearchMode = "phrase" | "allTerms";

export interface BibleTextMatchRangeDTO {
  start: number;
  end: number;
}

export interface BibleTextSearchItemDTO {
  verse: BibleVerseLineDTO;
  matches: BibleTextMatchRangeDTO[];
}

export interface BibleTextSearchDTO {
  query: string;
  mode: BibleTextSearchMode;
  terms: string[];
  total: number;
  offset: number;
  limit: number;
  items: BibleTextSearchItemDTO[];
}

export interface BibleRelatedSearchDTO {
  query: string;
  results: BibleLookupDTO[];
}

export type BibleOutputFormat = "referenceVerseLines" | "continuousText" | "referenceHeader" | "numberedVerses";
export type BibleReferenceLabelMode = "normalizedFull" | "preserveInput" | "omit";
export type BibleCombinedPassageMode = "compactEllipsis" | "groupedLines";
export type BibleQuotationStyle = "fullWidth" | "halfWidth" | "square";

export interface BiblePreferencesDTO {
  outputFormat: BibleOutputFormat;
  referenceLabelMode: BibleReferenceLabelMode;
  combinedPassageMode: BibleCombinedPassageMode;
  quotationStyle: BibleQuotationStyle;
}

export interface AiRoleDTO {
  username: string;
  displayName: string;
  avatarPath?: string | null;
  enabled: boolean;
  model?: string;
  thinkingEnabled?: boolean;
  promptCommand: string;
  shortTermMemory?: string;
  midTermMemory?: string;
  longTermMemory?: string;
  channelIds?: number[];
  webSearchEnabled?: boolean;
  questionTriggerEnabled?: boolean;
  activationJudgePrompt?: string;
  contextTurnLimit?: number;
  contextWindowMinutes?: number;
}

export interface AiSettingsDTO {
  enabled: boolean;
  apiKeyConfigured: boolean;
  baseUrl: string;
  model: string;
  promptCommand: string;
  cardCooldownSeconds: number;
  userLimitPerMinute: number;
  maxSuccessPerMessage: number;
  whyAssistantEnabled?: boolean;
  whyAssistantWebSearchEnabled?: boolean;
  whyAssistantPromptCommand?: string;
  aiRoles?: AiRoleDTO[];
}

export interface FlashEffectSettingsDTO {
  colors: string[];
  intervalSeconds: number;
  transitionMode: "smooth" | "step";
}

export interface ParallaxLayerDTO {
  id: string;
  name: string;
  file: string;
  speed: number;
  yOffset: number;
  heightScale: number;
}

export interface ParallaxKitDTO {
  id: string;
  name: string;
  description: string;
  credit: string;
  builtIn?: boolean;
  layers: ParallaxLayerDTO[];
}

export interface AppearanceDTO {
  appTitle: string;
  appIconPath?: string | null;
  wallpaperPath?: string | null;
  wallpaperFit: "cover" | "contain" | "stretch" | "repeat" | "pan";
  wallpaperPanFocusX: number;
  wallpaperPanDirection: "left" | "right";
  wallpaperPanSpeed: number;
  parallaxKit: string;
  parallaxSpeed: number;
  parallaxKits: ParallaxKitDTO[];
  loginIconPath?: string | null;
  loginShowIcon: boolean;
  loginTitle: string;
  loginSubtitle: string;
  loginShowSubtitle: boolean;
  loginBackgroundPath?: string | null;
  loginBackgroundFit: "cover" | "contain" | "stretch" | "repeat";
  loginFormPosition: "top" | "middle" | "bottom";
  registrationEnabled: boolean;
  flashEffect: FlashEffectSettingsDTO;
  customThemes: ThemeDTO[];
}

export interface FriendProgramDTO {
  id: string;
  seriesId: string;
  seriesTitle: string;
  title: string;
  date: string;
  notes?: string;
  audioUrl: string;
  imageUrl?: string;
}

export interface FriendSeriesDTO {
  id: string;
  alias: string;
  title: string;
  description?: string;
  imageUrl?: string;
}

export interface FriendCategoryDTO {
  id: string;
  title: string;
  series: FriendSeriesDTO[];
}

export interface FriendListenerDTO {
  accountId: number;
  displayName: string;
  programId: string;
  programTitle: string;
}

export interface FriendPlaybackDTO {
  programId: string;
  seriesTitle: string;
  title: string;
  audioUrl: string;
  imageUrl?: string;
  progressMs: number;
  durationMs: number;
  playedAt: string;
}

export type EngineActionType =
  | "skip"
  | "typing_start"
  | "typing_stop"
  | "send_message"
  | "remember_user"
  | "schedule_topic";
