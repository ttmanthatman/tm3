import { z } from "zod";
import { DEMO_BUNDLE_FORMAT_VERSION, type DemoManifestDTO, type DemoSnapshot } from "../../shared/demoMode.js";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const KEY_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,79}$/;
const DATASET_VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/;
const MAX_BUNDLE_BYTES = 512 * 1024 * 1024;

export const DEMO_SAFE_SETTING_KEYS = new Set([
  "appTitle",
  "appIconPath",
  "wallpaperPath",
  "wallpaperFit",
  "wallpaperPanFocusX",
  "wallpaperPanDirection",
  "wallpaperPanSpeed",
  "parallaxKit",
  "parallaxSpeed",
  "parallaxKits",
  "loginIconPath",
  "loginShowIcon",
  "loginTitle",
  "loginSubtitle",
  "loginShowSubtitle",
  "loginBackgroundPath",
  "loginBackgroundFit",
  "loginFormPosition",
  "registrationEnabled",
  "musicPanelFontSize",
  "prayerBubbleMineColor",
  "prayerBubbleOtherColor",
  "flashEffect",
  "customThemes",
  "composerPrompts",
  "composerPromptIntervalSeconds",
  "composerPromptAnimSeconds",
  "composerPromptAppearSeconds",
  "composerPromptDisappearSeconds",
  "composerPromptGapSeconds",
  "aiRelatedVersesEnabled",
  "aiRelatedVersesPromptCommand",
  "aiRelatedVersesCardCooldownSeconds",
  "aiRelatedVersesUserLimitPerMinute",
  "aiRelatedVersesMaxSuccessPerMessage",
  "whyAssistantEnabled",
  "whyAssistantPromptCommand",
  "whyAssistantActivationJudgePrompt",
  "whyAssistantWebSearchEnabled",
  "whyAssistantDisplayName",
  "whyAssistantModel",
  "whyAssistantThinkingEnabled",
  "questionAssistantEnabled",
  "questionAssistantTriggerEnabled",
  "questionAssistantPromptCommand",
  "questionAssistantActivationJudgePrompt",
  "questionAssistantWebSearchEnabled",
  "questionAssistantDisplayName",
  "questionAssistantModel",
  "questionAssistantThinkingEnabled",
  "questionAssistantContextTurnLimit",
  "questionAssistantContextWindowMinutes"
]);

const manifestSchema = z.object({
  formatVersion: z.literal(DEMO_BUNDLE_FORMAT_VERSION),
  datasetVersion: z.string().regex(DATASET_VERSION_PATTERN),
  compatibleApp: z.object({
    min: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/),
    maxExclusive: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/).optional()
  }).strict(),
  bundleUrl: z.string().url().max(2048),
  bundleSha256: z.string().regex(SHA256_PATTERN),
  bundleSize: z.number().int().positive().max(MAX_BUNDLE_BYTES),
  summary: z.object({
    accounts: z.number().int().nonnegative(),
    channels: z.number().int().nonnegative(),
    messages: z.number().int().nonnegative(),
    assets: z.number().int().nonnegative()
  }).strict()
}).strict();

const assetSchema = z.object({
  key: z.string().regex(KEY_PATTERN),
  kind: z.enum(["upload", "avatar", "background", "parallax", "music-score"]),
  fileName: z.string().min(1).max(255),
  archivePath: z.string().min(1).max(512),
  sha256: z.string().regex(SHA256_PATTERN),
  size: z.number().int().nonnegative().max(MAX_BUNDLE_BYTES)
}).strict();

const accountSchema = z.object({
  key: z.string().regex(KEY_PATTERN),
  username: z.string().regex(/^[a-zA-Z0-9_.-]{2,64}$/),
  passwordHash: z.string().min(20).max(255),
  displayName: z.string().min(1).max(80),
  avatarAssetKey: z.string().regex(KEY_PATTERN).optional(),
  canPinMessages: z.boolean().optional(),
  theme: z.string().max(32).optional(),
  biblePreferences: z.unknown().optional()
}).strict();

const virtualCharacterSchema = z.object({
  key: z.string().regex(KEY_PATTERN),
  username: z.string().regex(/^[a-zA-Z0-9_.-]{2,80}$/),
  displayName: z.string().min(1).max(80),
  avatarAssetKey: z.string().regex(KEY_PATTERN).optional(),
  enabled: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  state: z.record(z.string(), z.unknown()).nullable().optional(),
  engineBinding: z.record(z.string(), z.unknown()).nullable().optional()
}).strict();

const standaloneActorSchema = z.object({
  key: z.string().regex(KEY_PATTERN),
  kind: z.enum(["virtual", "system"]),
  username: z.string().regex(/^[a-zA-Z0-9_.-]{2,80}$/),
  displayName: z.string().min(1).max(80),
  avatarAssetKey: z.string().regex(KEY_PATTERN).optional(),
  status: z.string().max(32).optional()
}).strict();

const channelSchema = z.object({
  key: z.string().regex(KEY_PATTERN),
  kind: z.enum(["standard", "direct", "why", "aiLounge", "music"]).optional(),
  name: z.string().min(1).max(80),
  description: z.string().max(255).optional(),
  icon: z.string().max(16).optional(),
  listColor: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional(),
  isPrivate: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  directKey: z.string().max(120).nullable().optional()
}).strict();

const membershipSchema = z.object({
  channelKey: z.string().regex(KEY_PATTERN),
  accountKey: z.string().regex(KEY_PATTERN),
  role: z.enum(["owner", "admin", "member", "viewer"]).optional()
}).strict();

const messageSchema = z.object({
  key: z.string().regex(KEY_PATTERN),
  channelKey: z.string().regex(KEY_PATTERN),
  senderKey: z.string().regex(KEY_PATTERN),
  content: z.string().nullable().optional(),
  type: z.enum(["text", "image", "file", "music_playlist", "chain", "prayer", "sermon_request", "why_topic_card", "system"]).optional(),
  payload: z.unknown().optional(),
  assetKey: z.string().regex(KEY_PATTERN).optional(),
  fileName: z.string().max(255).nullable().optional(),
  fileSize: z.number().int().nonnegative().nullable().optional(),
  replyToKey: z.string().regex(KEY_PATTERN).nullable().optional(),
  chainRootKey: z.string().regex(KEY_PATTERN).nullable().optional(),
  chainVersion: z.number().int().positive().nullable().optional(),
  musicOrder: z.number().int().nonnegative().nullable().optional(),
  createdAt: z.string().datetime().optional()
}).strict();

const pinnedSchema = z.object({
  key: z.string().regex(KEY_PATTERN),
  channelKey: z.string().regex(KEY_PATTERN),
  title: z.string().max(160).nullable().optional(),
  content: z.string().nullable().optional(),
  body: z.unknown().optional(),
  messageKey: z.string().regex(KEY_PATTERN).nullable().optional(),
  version: z.number().int().positive().optional(),
  active: z.boolean().optional()
}).strict();

const accountMessageRelationSchema = z.object({
  accountKey: z.string().regex(KEY_PATTERN),
  messageKey: z.string().regex(KEY_PATTERN),
  createdAt: z.string().datetime().optional()
}).strict();

const prayerActionSchema = accountMessageRelationSchema.extend({ prayedAt: z.string().datetime().optional() }).strict();

const aiSuggestionSchema = z.object({
  messageKey: z.string().regex(KEY_PATTERN),
  kind: z.string().max(64).optional(),
  status: z.string().max(24).optional(),
  promptCommand: z.string().max(4000).optional(),
  contextText: z.string().max(5000).optional(),
  responseText: z.string().max(4000).nullable().optional(),
  references: z.unknown().optional(),
  model: z.string().max(120).nullable().optional(),
  baseUrl: z.string().max(255).nullable().optional(),
  createdByAccountKey: z.string().regex(KEY_PATTERN).nullable().optional(),
  createdAt: z.string().datetime().optional()
}).strict();

const musicScoreSchema = z.object({
  key: z.string().regex(KEY_PATTERN),
  trackMessageKey: z.string().regex(KEY_PATTERN),
  title: z.string().min(1).max(255),
  uploadedByAccountKey: z.string().regex(KEY_PATTERN).nullable().optional(),
  pages: z.array(z.object({
    assetKey: z.string().regex(KEY_PATTERN),
    pageIndex: z.number().int().nonnegative(),
    width: z.number().int().nonnegative(),
    height: z.number().int().nonnegative()
  }).strict()).max(200)
}).strict();

const musicLyricsSchema = z.object({
  trackMessageKey: z.string().regex(KEY_PATTERN),
  fileName: z.string().min(1).max(255),
  content: z.string().max(2_000_000),
  uploadedByAccountKey: z.string().regex(KEY_PATTERN).nullable().optional()
}).strict();

const snapshotSchema = z.object({
  formatVersion: z.literal(DEMO_BUNDLE_FORMAT_VERSION),
  datasetVersion: z.string().regex(DATASET_VERSION_PATTERN),
  generatedAt: z.string().datetime(),
  assets: z.array(assetSchema).max(10_000),
  accounts: z.array(accountSchema).min(1).max(200),
  actors: z.array(standaloneActorSchema).max(100).optional(),
  virtualCharacters: z.array(virtualCharacterSchema).max(100).optional(),
  channels: z.array(channelSchema).min(1).max(200),
  memberships: z.array(membershipSchema).max(20_000),
  messages: z.array(messageSchema).max(100_000),
  pinnedItems: z.array(pinnedSchema).max(2_000).optional(),
  messageLikes: z.array(accountMessageRelationSchema).max(100_000).optional(),
  messageFavorites: z.array(accountMessageRelationSchema).max(100_000).optional(),
  voiceListens: z.array(accountMessageRelationSchema).max(100_000).optional(),
  prayerActions: z.array(prayerActionSchema).max(100_000).optional(),
  messageAiSuggestions: z.array(aiSuggestionSchema).max(20_000).optional(),
  musicScores: z.array(musicScoreSchema).max(2_000).optional(),
  musicLyrics: z.array(musicLyricsSchema).max(2_000).optional(),
  settings: z.record(z.string(), z.string())
}).strict();

function versionParts(value: string) {
  return value.split(".").slice(0, 3).map((part) => Number(part.replace(/\D.*/, "")) || 0);
}

export function compareDemoVersions(left: string, right: string) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

export function assertDemoManifest(value: unknown, appVersion: string): DemoManifestDTO {
  const manifest = manifestSchema.parse(value);
  if (compareDemoVersions(appVersion, manifest.compatibleApp.min) < 0) {
    throw new Error(`演示数据要求应用版本至少为 ${manifest.compatibleApp.min}`);
  }
  if (manifest.compatibleApp.maxExclusive && compareDemoVersions(appVersion, manifest.compatibleApp.maxExclusive) >= 0) {
    throw new Error(`演示数据不兼容当前应用版本 ${appVersion}`);
  }
  assertGithubDownloadUrl(manifest.bundleUrl);
  return manifest;
}

export function assertDemoSnapshot(value: unknown, datasetVersion: string): DemoSnapshot {
  const snapshot = snapshotSchema.parse(value);
  if (snapshot.datasetVersion !== datasetVersion) throw new Error("演示包版本与清单不一致");
  for (const key of Object.keys(snapshot.settings)) {
    if (!DEMO_SAFE_SETTING_KEYS.has(key)) throw new Error(`演示包包含不允许覆盖的设置：${key}`);
  }
  assertUniqueKeys("素材", snapshot.assets.map((item) => item.key));
  assertUniqueKeys("账号", snapshot.accounts.map((item) => item.key));
  assertUniqueKeys("独立角色", (snapshot.actors || []).map((item) => item.key));
  assertUniqueKeys("频道", snapshot.channels.map((item) => item.key));
  assertUniqueKeys("消息", snapshot.messages.map((item) => item.key));
  assertUniqueKeys("虚拟角色", (snapshot.virtualCharacters || []).map((item) => item.key));
  return snapshot;
}

function assertUniqueKeys(label: string, keys: string[]) {
  if (new Set(keys).size !== keys.length) throw new Error(`${label}逻辑标识重复`);
}

export function assertGithubDownloadUrl(value: string) {
  const url = new URL(value);
  const allowedHosts = new Set(["github.com", "raw.githubusercontent.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"]);
  if (url.protocol !== "https:" || !allowedHosts.has(url.hostname.toLowerCase())) {
    throw new Error("演示数据只允许从已批准的 GitHub HTTPS 地址下载");
  }
  return url;
}

export function safeArchiveEntry(value: string) {
  const normalized = value.replace(/\\/g, "/");
  return !!normalized && !normalized.startsWith("/") && !normalized.split("/").includes("..") && !normalized.includes("\0");
}
