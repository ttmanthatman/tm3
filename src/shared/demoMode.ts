export const DEMO_BUNDLE_FORMAT_VERSION = 1 as const;

export type DemoAssetKind = "upload" | "avatar" | "background" | "parallax" | "music-score";

export interface DemoManifestDTO {
  formatVersion: typeof DEMO_BUNDLE_FORMAT_VERSION;
  datasetVersion: string;
  compatibleApp: {
    min: string;
    maxExclusive?: string;
  };
  bundleUrl: string;
  bundleSha256: string;
  bundleSize: number;
  summary: {
    accounts: number;
    channels: number;
    messages: number;
    assets: number;
  };
}

export interface DemoModeStatusDTO {
  available: true;
  active: boolean;
  busy: boolean;
  datasetVersion: string | null;
  installedAt: string | null;
  lastResetAt: string | null;
  source: string;
  manifest?: DemoManifestDTO;
}

export interface DemoAssetRecord {
  key: string;
  kind: DemoAssetKind;
  fileName: string;
  archivePath: string;
  sha256: string;
  size: number;
}

export interface DemoAccountRecord {
  key: string;
  username: string;
  passwordHash: string;
  displayName: string;
  avatarAssetKey?: string;
  canPinMessages?: boolean;
  theme?: string;
  biblePreferences?: unknown;
}

export interface DemoVirtualCharacterRecord {
  key: string;
  username: string;
  displayName: string;
  avatarAssetKey?: string;
  enabled?: boolean;
  config?: Record<string, unknown>;
  state?: Record<string, unknown> | null;
  engineBinding?: Record<string, unknown> | null;
}

export interface DemoStandaloneActorRecord {
  key: string;
  kind: "virtual" | "system";
  username: string;
  displayName: string;
  avatarAssetKey?: string;
  status?: string;
}

export interface DemoChannelRecord {
  key: string;
  kind?: "standard" | "direct" | "why" | "aiLounge" | "music";
  name: string;
  description?: string;
  icon?: string;
  listColor?: string | null;
  isPrivate?: boolean;
  isDefault?: boolean;
  directKey?: string | null;
}

export interface DemoMembershipRecord {
  channelKey: string;
  accountKey: string;
  role?: "owner" | "admin" | "member" | "viewer";
}

export interface DemoMessageRecord {
  key: string;
  channelKey: string;
  senderKey: string;
  content?: string | null;
  type?: "text" | "image" | "file" | "music_playlist" | "chain" | "prayer" | "sermon_request" | "why_topic_card" | "bible_session" | "system";
  payload?: unknown;
  assetKey?: string;
  fileName?: string | null;
  fileSize?: number | null;
  replyToKey?: string | null;
  chainRootKey?: string | null;
  chainVersion?: number | null;
  musicOrder?: number | null;
  createdAt?: string;
}

export interface DemoPinnedRecord {
  key: string;
  channelKey: string;
  title?: string | null;
  content?: string | null;
  body?: unknown;
  messageKey?: string | null;
  version?: number;
  active?: boolean;
}

export interface DemoAccountMessageRelation {
  accountKey: string;
  messageKey: string;
  createdAt?: string;
}

export interface DemoPrayerActionRecord extends DemoAccountMessageRelation {
  prayedAt?: string;
}

export interface DemoAiSuggestionRecord {
  messageKey: string;
  kind?: string;
  status?: string;
  promptCommand?: string;
  contextText?: string;
  responseText?: string | null;
  references?: unknown;
  model?: string | null;
  baseUrl?: string | null;
  createdByAccountKey?: string | null;
  createdAt?: string;
}

export interface DemoMusicScoreRecord {
  key: string;
  trackMessageKey: string;
  title: string;
  uploadedByAccountKey?: string | null;
  pages: Array<{
    assetKey: string;
    pageIndex: number;
    width: number;
    height: number;
  }>;
}

export interface DemoMusicLyricsRecord {
  trackMessageKey: string;
  fileName: string;
  content: string;
  uploadedByAccountKey?: string | null;
}

export interface DemoSnapshot {
  formatVersion: typeof DEMO_BUNDLE_FORMAT_VERSION;
  datasetVersion: string;
  generatedAt: string;
  assets: DemoAssetRecord[];
  accounts: DemoAccountRecord[];
  actors?: DemoStandaloneActorRecord[];
  virtualCharacters?: DemoVirtualCharacterRecord[];
  channels: DemoChannelRecord[];
  memberships: DemoMembershipRecord[];
  messages: DemoMessageRecord[];
  pinnedItems?: DemoPinnedRecord[];
  messageLikes?: DemoAccountMessageRelation[];
  messageFavorites?: DemoAccountMessageRelation[];
  voiceListens?: DemoAccountMessageRelation[];
  prayerActions?: DemoPrayerActionRecord[];
  messageAiSuggestions?: DemoAiSuggestionRecord[];
  musicScores?: DemoMusicScoreRecord[];
  musicLyrics?: DemoMusicLyricsRecord[];
  settings: Record<string, string>;
}
