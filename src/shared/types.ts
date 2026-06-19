export type ActorKind = "human" | "virtual" | "system";
export type MessageType = "text" | "image" | "file" | "chain" | "prayer" | "system";
export type MessageEffect = "flash" | "shine" | "shake" | "fly" | "sunburst" | "marquee" | "water" | "drip" | "rain";
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
  content?: string | null;
  messageId?: number | null;
  message?: MessageDTO | null;
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
  memberCount: number;
  pinned?: PinnedDTO | null;
}

export interface AccountDTO {
  id: number;
  username: string;
  displayName: string;
  avatarPath?: string | null;
  isAdmin: boolean;
  actorId: number;
  theme: string;
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

export interface VersionDTO {
  version: string;
  date: string;
  developer: string;
  notes: readonly string[];
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

export interface AiSettingsDTO {
  enabled: boolean;
  apiKeyConfigured: boolean;
  baseUrl: string;
  model: string;
  promptCommand: string;
  cardCooldownSeconds: number;
  userLimitPerMinute: number;
  maxSuccessPerMessage: number;
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
