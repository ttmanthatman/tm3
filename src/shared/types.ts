export type ActorKind = "human" | "virtual" | "system";
export type MessageType = "text" | "image" | "file" | "chain" | "prayer" | "why_topic_card" | "system";
export type MessageEffect = "flash" | "shine" | "shake" | "fly" | "sunburst" | "marquee" | "water" | "drip" | "rain";
export type PrayerStatus = "active" | "closed" | "answered";
export type WhyTopicStatus = "active" | "completed" | "deleted";
export type WhyTopicMemberRole = "owner" | "member" | "requested";
export type WhyMessageTrack = "study" | "discussion";

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
  voiceListened?: boolean;
  replyTo?: ReplyPreviewDTO | null;
  chainRootId?: number | null;
  chainVersion?: number | null;
  createdAt: string;
}

export interface WhyTopicCardPayload {
  kind: "why_topic_card";
  topicId: number;
  title: string;
  status: WhyTopicStatus;
  ownerName: string;
  requestStatus?: "none" | "requested" | "member" | "owner";
  sourceMessageId?: number | null;
}

export interface WhyTopicDTO {
  id: number;
  ownerAccountId: number;
  ownerName: string;
  channelId: number;
  sourceChannelId?: number | null;
  sourceChannelName?: string | null;
  sourceMessageId?: number | null;
  cardMessageId?: number | null;
  title: string;
  summary: string;
  originalQuestion?: string;
  completionNote?: string | null;
  status: WhyTopicStatus;
  memberRole: WhyTopicMemberRole;
  participantCount: number;
  pendingRequestCount: number;
  unreadCount: number;
  lastMessagePreview?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WhyTopicMemberDTO {
  accountId: number;
  displayName: string;
  avatarPath?: string | null;
  role: WhyTopicMemberRole;
  createdAt: string;
}

export interface WhyAssistantRunDTO {
  id: number;
  topicId: number;
  status: "pending" | "running" | "success" | "failed";
  errorText?: string | null;
  createdAt: string;
  updatedAt: string;
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
  isPrivate: boolean;
  isDefault: boolean;
  directKey?: string | null;
  canManage?: boolean;
  canPin?: boolean;
  memberCount: number;
  pinned?: PinnedDTO | null;
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

export type AdminLoginLogKind = "auth_login" | "auth_logout" | "session_replaced" | "session_revoked" | "presence_join" | "presence_leave";

export interface AdminLoginLogDTO {
  id: number;
  kind: AdminLoginLogKind;
  accountId: number;
  username: string;
  displayName: string;
  deviceKind?: DeviceSessionDTO["deviceKind"] | null;
  deviceName?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  sessionId?: string | null;
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
  promptCommand: string;
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

export interface AppearanceDTO {
  appTitle: string;
  appIconPath?: string | null;
  wallpaperPath?: string | null;
  wallpaperFit: "cover" | "contain" | "stretch" | "repeat";
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

export type EngineActionType =
  | "skip"
  | "typing_start"
  | "typing_stop"
  | "send_message"
  | "remember_user"
  | "schedule_topic";
