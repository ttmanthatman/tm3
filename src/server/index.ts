import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import bcrypt from "bcryptjs";
import cors from "@fastify/cors";
import compress from "@fastify/compress";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";
import { Prisma, PrismaClient, type Actor, type Account, type AccountSession, type ChannelKind, type DeviceKind, type Message, type MessageAiSuggestion, type MessageType, type MusicLyrics, type MusicScore, type MusicScorePage, type PinnedItem, type PrayerAction } from "@prisma/client";
import sanitizeHtml from "sanitize-html";
import sharp from "sharp";
import { Server as SocketIOServer, type Socket } from "socket.io";
import webPush from "web-push";
import { z } from "zod";
import { createMulticharManager } from "./multichar/index.js";
import { createAiClient } from "./multichar/ai.js";
import { registerMulticharRoutes } from "./multichar/routes.js";
import type { MulticharDeps } from "./multichar/types.js";
import { registerAdminAccountRoutes } from "./routes/adminAccounts.js";
import { registerFriendRoutes } from "./routes/friend.js";
import { registerMusicRoutes } from "./routes/music.js";
import { registerMusicResourceRoutes } from "./routes/musicResources.js";
import { registerUnreadCountsRoutes } from "./routes/unreadCounts.js";
import { deleteAccount as deleteAccountService } from "./services/accountDeletion.js";
import { createFriendFeedService, nextFriendFeedRefreshAt } from "./friendFeed.js";
import { createMusicService } from "./services/musicService.js";
import type {
  AdminAttachmentDTO,
  AdminBackupDTO,
  AdminLoginLogKind,
  AdminMessageDTO,
  AiRoleDTO,
  AiSettingsDTO,
  AiSuggestionDTO,
  BibleCatalogDTO,
  BibleChapterDTO,
  BibleFavoriteDTO,
  BibleFavoriteKeyDTO,
  BibleLookupDTO,
  BiblePreferencesDTO,
  BibleReaderPresenceDTO,
  BibleRelatedSearchDTO,
  BibleTextSearchDTO,
  ChainPayload,
  FlashEffectSettingsDTO,
  FriendListenerDTO,
  MessageDTO,
  MessageEffect,
  MusicListenerDTO,
  PinnedBodyDTO,
  PinnedContentBlockDTO,
  PrayerStatus,
  ThemeDTO,
  ThemePaletteDTO
} from "../shared/types.js";
import { APP_VERSION, RELEASE_DATE, RELEASE_DEVELOPER, RELEASE_HISTORY, RELEASE_NOTES } from "../shared/release.js";
import { DEFAULT_BIBLE_FAVORITE_COLOR, normalizeBibleFavoriteColor } from "../shared/bibleFavoriteColors.js";
import { cleanParallaxKits, cleanParallaxSpeed } from "../shared/parallax.js";
import { cleanSupportedMessageEffect } from "../shared/messageEffects.js";
import { bibleCatalog, lookupBibleChapter, lookupBibleReference, searchBibleText } from "./bible/lookup.js";
import { fetchLinkPreview } from "./linkPreview.js";
import { channelNeedsExplicitMembership, virtualCharacterConfigForChannel, virtualCharacterVisibleInChannel } from "./channelMembership.js";
import { fileResponsePolicy } from "./filePolicy.js";
import { CONTENT_SECURITY_POLICY } from "./securityHeaders.js";
import { envFlagEnabled } from "./featureFlags.js";
import { pushOriginFromHeaders } from "./pushOrigin.js";
import { githubPackageManifestUrl } from "./updateManifest.js";
import { availableDefaultUpdateBranch, isSafeUpdateBranch, normalizeUpdateBranches, selectUpdateBranch } from "./updateBranches.js";
import { MUSIC_EXTENSIONS, canManageMusicRole, isMusicFileName, isStoredMusicFile, musicTrackTitle } from "./music.js";
import { analyzeAudioWaveform, mergeAudioWaveformPayload } from "./audioWaveform.js";
import { parseLyrics } from "./srt.js";
import { activityLogCategory, friendlyDeviceName } from "../shared/activityLog.js";
import { deduplicateStoredUpload, sha256File } from "./uploadDeduplication.js";
import { imageDimensionsFromPayload, mergeImageDimensionsPayload, orientedImageDimensions, type ImageDimensions } from "../shared/imageDimensions.js";
import { recalledMessageData } from "./messageRecall.js";
import { prependPrayerUpdateHistory } from "./prayerUpdates.js";
import { fallbackDirectChatNames, isAutomaticDirectChatName, parseDirectChatNameSuggestions } from "./directChatNames.js";
import {
  WALLPAPER_PAN_SPEED_MAX,
  WALLPAPER_PAN_SPEED_MIN,
  cleanWallpaperPanDirection,
  cleanWallpaperPanFocusX,
  cleanWallpaperPanSpeed
} from "../shared/wallpaperPan.js";
import {
  MUSIC_PANEL_FONT_SIZE_MAX,
  MUSIC_PANEL_FONT_SIZE_MIN,
  cleanMusicPanelFontSize
} from "../shared/musicPlayback.js";
import {
  COMPOSER_PROMPT_ANIM_MAX,
  COMPOSER_PROMPT_ANIM_MIN,
  COMPOSER_PROMPT_GAP_MAX,
  COMPOSER_PROMPT_GAP_MIN,
  DEFAULT_COMPOSER_PROMPTS,
  cleanComposerPromptAppearSeconds,
  cleanComposerPromptDisappearSeconds,
  cleanComposerPromptGapSeconds,
  cleanComposerPromptIntervalSeconds,
  cleanComposerPrompts
} from "../shared/composerPrompts.js";

export type BuildAppOptions = {
  runStartupTasks?: boolean;
};

const ROOT = process.cwd();
const DIST_CLIENT = path.join(ROOT, "dist/client");
const STORAGE_ROOT = process.env.STORAGE_ROOT || path.join(ROOT, "storage");
const UPLOAD_DIR = path.join(STORAGE_ROOT, "uploads");
const MUSIC_SCORE_DIR = path.join(STORAGE_ROOT, "music-scores");
const AVATAR_DIR = path.join(STORAGE_ROOT, "avatars");
const BG_DIR = path.join(STORAGE_ROOT, "backgrounds");
const PARALLAX_DIR = path.join(STORAGE_ROOT, "parallax");
const BACKUP_DIR = path.join(STORAGE_ROOT, "backups");
const JWT_SECRET = process.env.JWT_SECRET || "dev-change-me-before-production";
const IS_PRODUCTION = process.env.NODE_ENV === "production";
if (IS_PRODUCTION && (JWT_SECRET === "dev-change-me-before-production" || JWT_SECRET.length < 32)) {
  throw new Error("JWT_SECRET must be set to at least 32 characters in production");
}
const ENGINE_API_TOKEN = process.env.ENGINE_API_TOKEN || "";
const PUSH_NOTIFICATIONS_ENABLED = envFlagEnabled(process.env.PUSH_NOTIFICATIONS_ENABLED);
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || process.env.WEB_PUSH_SUBJECT || "mailto:admin@example.com";
const RELEASE_DISPLAY_DEVELOPER = process.env.APP_RELEASE_DEVELOPER || process.env.RELEASE_DEVELOPER || RELEASE_DEVELOPER;
const UPDATE_REPO_URL = process.env.UPDATE_REPO_URL || process.env.REPO_URL || "https://github.com/ttmanthatman/tm3.git";
const DEFAULT_UPDATE_BRANCH = process.env.UPDATE_BRANCH || process.env.BRANCH || "main";
const UPDATE_PM2_APP = process.env.UPDATE_PM2_APP || process.env.APP_NAME || "team-chat";
const UPDATE_RESTART_MODE = process.env.UPDATE_RESTART_MODE || (process.env.UPDATE_RESTART_COMMAND ? "command" : "pm2");
const UPDATE_RESTART_COMMAND = process.env.UPDATE_RESTART_COMMAND || "";
const UPDATE_STATUS_PATH = path.join(STORAGE_ROOT, "update-status.json");
const UPDATE_LOG_PATH = path.join(STORAGE_ROOT, "update.log");
const UPDATE_BRANCH_CONFIG_PATH = process.env.UPDATE_BRANCH_CONFIG_PATH || path.join(STORAGE_ROOT, "update-branch.json");
const UPDATE_RUNNING_TIMEOUT_MS = Number(process.env.UPDATE_RUNNING_TIMEOUT_MS || 30 * 60 * 1000);
const UPDATE_LOG_TAIL_BYTES = Math.max(64 * 1024, Number(process.env.UPDATE_LOG_TAIL_BYTES || 256 * 1024) || 256 * 1024);
const AI_SETTINGS_SECRET = process.env.AI_SETTINGS_SECRET || JWT_SECRET;
const CONFIGURED_CORS_ORIGINS = (process.env.CORS_ORIGINS || process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const SESSION_TTL_DAYS = 30;
const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
const JWT_EXPIRES_IN = `${SESSION_TTL_DAYS}d`;
const THEMES = new Set(["wechat", "jade", "paper", "night"]);
const WALLPAPER_FITS = new Set(["cover", "contain", "stretch", "repeat", "pan"]);
const LOGIN_BACKGROUND_FITS = new Set(["cover", "contain", "stretch", "repeat"]);
const LOGIN_FORM_POSITIONS = new Set(["top", "middle", "bottom"]);
const BIBLE_OUTPUT_FORMATS = new Set(["referenceVerseLines", "continuousText", "referenceHeader", "numberedVerses"]);
const BIBLE_REFERENCE_LABEL_MODES = new Set(["normalizedFull", "preserveInput", "omit"]);
const BIBLE_COMBINED_PASSAGE_MODES = new Set(["compactEllipsis", "groupedLines"]);
const BIBLE_QUOTATION_STYLES = new Set(["fullWidth", "halfWidth", "square"]);
const DEFAULT_BIBLE_PREFERENCES: BiblePreferencesDTO = {
  outputFormat: "continuousText",
  referenceLabelMode: "normalizedFull",
  combinedPassageMode: "compactEllipsis",
  quotationStyle: "fullWidth"
};
const DEFAULT_APP_TITLE = "Team Chat";
const DEFAULT_LOGIN_TITLE = "Team Chat";
const DEFAULT_LOGIN_SUBTITLE = "轻快、稳定的团队聊天。";
const DEFAULT_FLASH_EFFECT: FlashEffectSettingsDTO = {
  colors: ["#fff176", "#ef4444", "#60a5fa", "#6d28d9", "#34d399", "#111827"],
  intervalSeconds: 0.4,
  transitionMode: "smooth"
};
const PARALLAX_KIT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PARALLAX_SPEED_MIN = 0.25;
const PARALLAX_SPEED_MAX = 3;
const DEFAULT_THEME_PALETTE: ThemePaletteDTO = {
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
const AI_RELATED_VERSES_KIND = "prayer_related_verses";
const BIBLE_TOPIC_SEARCH_PROMPT = [
  "你根据用户输入的主题推荐圣经经文出处。",
  "只输出 8 个真实存在的经文出处，每行一个。",
  "可以输出单节或连续几节，但不要输出整章。",
  "不要输出经文正文、解释、标题、序号或其他文字。",
  "如果不确定出处是否存在，不要输出。"
].join("\n");
const PUBLIC_CHANNEL_KINDS: ChannelKind[] = ["standard", "direct"];

// Channel visibility shared by the channel list and the unread-counts route:
// music channels are open; standard/direct channels are public or member-only.
function channelListWhere(accountId: number): Prisma.ChannelWhereInput {
  return {
    OR: [
      { kind: "music" },
      { kind: { in: PUBLIC_CHANNEL_KINDS }, OR: [{ isPrivate: false }, { members: { some: { accountId } } }] }
    ]
  };
}
const MUSIC_CHANNEL_NAME = "音乐频道";
const MUSIC_CHANNEL_ICON = "歌";
const DEFAULT_AI_PROMPT_COMMAND = [
  "你只根据用户代祷信息，推荐 3 个可能相关的圣经经文出处。",
  "只输出经文出处，每行一个。",
  "不要输出完整经文。",
  "不要解释。",
  "不要祷告文。",
  "不要评价代祷发起人。",
  "不要替代牧养辅导。",
  "如果不确定出处是否存在，不要输出。",
  "尽量避开已推荐过的出处。"
].join("\n");
const DEFAULT_AI_SETTINGS: AiSettingsDTO = {
  enabled: true,
  apiKeyConfigured: false,
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  promptCommand: DEFAULT_AI_PROMPT_COMMAND,
  cardCooldownSeconds: 30,
  userLimitPerMinute: 3,
  maxSuccessPerMessage: 7
};
const WHY_ASSISTANT_USERNAME = "why_assistant";
const WHY_ASSISTANT_NAME = "为什么助手";
const QUESTION_ASSISTANT_USERNAME = "ai_slmm";
const QUESTION_ASSISTANT_NAME = "ai_slmm";
const DEFAULT_QUESTION_ASSISTANT_CONTEXT_TURNS = 10;
const DEFAULT_QUESTION_ASSISTANT_CONTEXT_WINDOW_MINUTES = 10;
const DEFAULT_WHY_ASSISTANT_PROMPT = [
  "你是“为什么助手”，是严格的查经和思考引导师，不是答案机。",
  "默认用中文短答。你要用问题引导用户观察、查证、祷告和找真实弟兄姐妹交通。",
  "不要直接给解经结论、神学定论或人生答案；事实型问题可以直接回答并给查证路径。",
  "查经/知识/思辨类问题要像老师批改作业一样严格：指出敷衍，要求用户回到文本、列观察、区分事实和解释。",
  "情绪、关系、创伤、婚恋、家庭痛苦类问题要收起严格语气，鼓励用户找真实可信的弟兄姐妹、带领者同行祷告。",
  "自伤或危险信号优先安全支持，不继续查经或神学分析。",
  "如果提供背景资料，优先英文资料，并标明出处；无法核验的资料要标为待查证。",
  "每次最多输出：一句对当前进度的判断、2-3 个下一步问题、必要时 1-2 条带出处的背景资料。"
].join("\n");
const DEFAULT_QUESTION_ASSISTANT_PROMPT = [
  "你是聊天室里的 AI 助手 ai_slmm。",
  "当有人在普通聊天里发出问题时，你会收到这条消息。",
  "默认用中文回复，语气自然、简短、像群聊里认真帮忙的人。",
  "优先直接回应用户问的内容；如果信息不足，先问一个必要的澄清问题。",
  "不要编造事实；不确定时要说明不确定，并给出可查证路径。",
  "不要重复用户原话，不要自称大型语言模型。"
].join("\n");
const DEFAULT_QUESTION_ASSISTANT_JUDGE_PROMPT = [
  "你是 ai_slmm 的弱激活判断体，只判断当前用户发言是否应该交给 ai_slmm 回复。",
  "如果当前发言延续上一次强激活问题、继续追问、补充信息、纠正 ai_slmm、或明显是在和 ai_slmm 对话，输出 yes。",
  "如果当前发言已经换话题、明显是在和其他人说话、只是群聊闲谈、通知、寒暄、表态或不需要 ai_slmm 参与，输出 no。",
  "只输出 yes 或 no，不要解释。"
].join("\n");
const AI_ROLE_USERNAMES = new Set([WHY_ASSISTANT_USERNAME, QUESTION_ASSISTANT_USERNAME]);
const bibleTopicSearchWindows = new Map<number, number[]>();
const IMAGE_WEBP_QUALITY = 82;
const IMAGE_WEBP_EFFORT = 5;
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif", ".tif", ".tiff"]);

const allowedOrigins = new Set(CONFIGURED_CORS_ORIGINS.map((origin) => normalizeOrigin(origin)).filter(Boolean));

function normalizeOrigin(origin: string) {
  try {
    return new URL(origin).origin;
  } catch {
    return "";
  }
}

function isAllowedOrigin(origin?: string) {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  const { hostname } = new URL(normalized);
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]") return true;
  return allowedOrigins.has(normalized);
}

function fastifyCorsOrigin(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) {
  callback(null, isAllowedOrigin(origin));
}

function socketCorsOrigin(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) {
  callback(null, isAllowedOrigin(origin));
}

const prisma = new PrismaClient();

function redactRequestUrl(rawUrl?: string) {
  if (!rawUrl || !rawUrl.includes("token=")) return rawUrl || "";
  try {
    const url = new URL(rawUrl, "http://local");
    if (url.searchParams.has("token")) url.searchParams.set("token", "[redacted]");
    return `${url.pathname}${url.search}`;
  } catch {
    return rawUrl.replace(/([?&]token=)[^&]+/g, "$1[redacted]");
  }
}

function compareVersions(a: string, b: string) {
  const left = a.split(".").map((part) => Number(part.replace(/\D.*/, "")) || 0);
  const right = b.split(".").map((part) => Number(part.replace(/\D.*/, "")) || 0);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff) return diff;
  }
  return 0;
}

function parseGitHubRepo(url: string) {
  const trimmed = url.trim().replace(/\.git$/, "");
  const ssh = trimmed.match(/github\.com[:/]([^/]+)\/([^/]+)$/);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };
  try {
    const parsed = new URL(trimmed);
    if (!/github\.com$/i.test(parsed.hostname)) return null;
    const [owner, repo] = parsed.pathname.replace(/^\/+/, "").split("/");
    return owner && repo ? { owner, repo } : null;
  } catch {
    return null;
  }
}

function configuredUpdateBranch() {
  try {
    const value = JSON.parse(fs.readFileSync(UPDATE_BRANCH_CONFIG_PATH, "utf8")) as { branch?: unknown };
    return typeof value.branch === "string" && isSafeUpdateBranch(value.branch) ? value.branch : DEFAULT_UPDATE_BRANCH;
  } catch {
    return DEFAULT_UPDATE_BRANCH;
  }
}

async function githubBranches() {
  const repo = parseGitHubRepo(UPDATE_REPO_URL);
  if (!repo) throw new Error("只支持 GitHub 仓库更新地址");
  const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/branches?per_page=100`, {
    cache: "no-store",
    headers: { accept: "application/vnd.github+json", "user-agent": "team-chat-updater" }
  });
  if (!response.ok) throw new Error(`无法读取 GitHub 分支：HTTP ${response.status}`);
  const payload = await response.json() as unknown;
  if (!Array.isArray(payload)) throw new Error("GitHub 分支列表无效");
  const branches = normalizeUpdateBranches(payload.map((item) => typeof item === "object" && item ? (item as { name?: unknown }).name : undefined));
  if (!branches.length) throw new Error("GitHub 没有可用更新分支");
  return { repo, branches };
}

async function latestGitHubPackage(branch: string) {
  const repo = parseGitHubRepo(UPDATE_REPO_URL);
  if (!repo) throw new Error("只支持 GitHub 仓库更新地址");
  const url = githubPackageManifestUrl(repo.owner, repo.repo, branch);
  const response = await fetch(url, {
    cache: "no-store",
    headers: { accept: "application/vnd.github+json", "user-agent": "team-chat-updater" }
  });
  if (!response.ok) throw new Error(`无法读取 GitHub 版本：HTTP ${response.status}`);
  const manifest = (await response.json()) as { content?: string; encoding?: string };
  if (!manifest.content || manifest.encoding !== "base64") throw new Error("GitHub package.json 内容无效");
  const pkg = JSON.parse(Buffer.from(manifest.content, "base64").toString("utf8")) as { version?: string };
  if (!pkg.version || !/^\d+\.\d+\.\d+/.test(pkg.version)) throw new Error("GitHub package.json 缺少有效版本号");
  return {
    owner: repo.owner,
    repo: repo.repo,
    branch,
    version: String(pkg.version || ""),
    url: `https://github.com/${repo.owner}/${repo.repo}`
  };
}

function expireStaleUpdateStatus(status: { state: string; progress: number; detail: string; updatedAt?: string }) {
  if (status.state !== "running" || !status.updatedAt || !Number.isFinite(UPDATE_RUNNING_TIMEOUT_MS) || UPDATE_RUNNING_TIMEOUT_MS <= 0) {
    return status;
  }
  const updatedAt = Date.parse(status.updatedAt);
  if (!Number.isFinite(updatedAt) || Date.now() - updatedAt <= UPDATE_RUNNING_TIMEOUT_MS) return status;
  return {
    ...status,
    state: "failed",
    progress: 100,
    detail: "更新进程长时间没有进展，请检查日志后重试"
  };
}

function readUpdateStatus() {
  let status: { state: string; progress: number; detail: string; updatedAt?: string } = { state: "idle", progress: 0, detail: "尚未开始更新" };
  if (fs.existsSync(UPDATE_STATUS_PATH)) {
    try {
      status = { ...status, ...JSON.parse(fs.readFileSync(UPDATE_STATUS_PATH, "utf8")) };
    } catch {
      status = { state: "unknown", progress: 0, detail: "更新状态文件无法读取" };
    }
  }
  const log = readLogTail(UPDATE_LOG_PATH, UPDATE_LOG_TAIL_BYTES);
  return { ...expireStaleUpdateStatus(status), log };
}

function writeUpdateStatus(state: string, progress: number, detail: string) {
  fs.mkdirSync(STORAGE_ROOT, { recursive: true });
  const payload = {
    state,
    progress: Math.min(100, Math.max(0, Number(progress) || 0)),
    detail: detail.slice(0, 500),
    updatedAt: new Date().toISOString()
  };
  const tempPath = `${UPDATE_STATUS_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`);
  fs.renameSync(tempPath, UPDATE_STATUS_PATH);
}

function readLogTail(filePath: string, maxBytes: number) {
  if (!fs.existsSync(filePath)) return [];
  const stat = fs.statSync(filePath);
  const start = Math.max(0, stat.size - maxBytes);
  const length = stat.size - start;
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, start);
    const text = `${start > 0 ? "...日志过长，仅显示最后部分\n" : ""}${buffer.toString("utf8")}`;
    return text.split(/\r?\n/).filter(Boolean).slice(-120);
  } finally {
    fs.closeSync(fd);
  }
}

const PERIODIC_REQUEST_LOG_PATTERNS: Array<{ method: string; pattern: RegExp }> = [
  { method: "POST", pattern: /^\/api\/music\/tracks\/\d+\/progress$/ },
  { method: "PUT", pattern: /^\/api\/music\/playback-state$/ },
  { method: "PUT", pattern: /^\/api\/friend\/playback\/\d+$/ }
];

const app = Fastify({
  logger: {
    serializers: {
      req(request) {
        return {
          method: request.method,
          url: redactRequestUrl(request.url),
          host: request.headers.host,
          remoteAddress: request.socket.remoteAddress,
          remotePort: request.socket.remotePort
        };
      }
    }
  },
  disableRequestLogging: (request) => {
    const path = request.url.split("?", 1)[0];
    return PERIODIC_REQUEST_LOG_PATTERNS.some((entry) => entry.method === request.method && entry.pattern.test(path));
  },
  bodyLimit: 8 * 1024 * 1024,
  trustProxy: process.env.TRUST_PROXY === "true" ? true : ["127.0.0.1", "::1"]
});

app.setErrorHandler((error, request, reply) => {
  if (error instanceof z.ZodError) {
    return reply.code(400).send({ success: false, message: "invalid request", issues: error.issues });
  }
  const fastifyError = error as Error & { statusCode?: number };
  request.log.error(fastifyError);
  const statusCode = fastifyError.statusCode && fastifyError.statusCode >= 400 ? fastifyError.statusCode : 500;
  return reply.code(statusCode).send({ success: false, message: statusCode === 500 ? "internal server error" : fastifyError.message });
});

app.addHook("onRequest", async (_request, reply) => {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("Referrer-Policy", "same-origin");
  reply.header("X-Frame-Options", "SAMEORIGIN");
  reply.header("Permissions-Policy", "camera=(), geolocation=(), payment=(), usb=()");
  reply.header(
    "Content-Security-Policy",
    CONTENT_SECURITY_POLICY
  );
});

await app.register(cors, { origin: fastifyCorsOrigin as any, credentials: true });
await app.register(rateLimit, { max: 240, timeWindow: "1 minute" });
await app.register(multipart, { limits: { fileSize: 80 * 1024 * 1024, files: 1 } });
// JSON APIs and text assets cross a high-latency link; only compressible
// content types are transformed, so media streams and binaries pass through.
await app.register(compress, { global: true, threshold: 1024 });

if (fs.existsSync(DIST_CLIENT)) {
  await app.register(fastifyStatic, {
    root: DIST_CLIENT,
    wildcard: false,
    cacheControl: false,
    setHeaders(res, filePath) {
      // Vite emits content-hashed filenames under assets/, which are safe to
      // cache forever; everything else (index.html, sw.js, icons) revalidates.
      const immutable = filePath.includes(`${path.sep}assets${path.sep}`);
      res.setHeader("Cache-Control", immutable ? "public, max-age=31536000, immutable" : "public, max-age=0");
    }
  });
}

const io = new SocketIOServer(app.server, {
  cors: { origin: socketCorsOrigin, credentials: true },
  maxHttpBufferSize: 1e6
});

type AuthContext = {
  accountId: number;
  actorId: number;
  username: string;
  isAdmin: boolean;
  canPinMessages: boolean;
  sessionId: string;
};

type AuthedRequest = FastifyRequest & { auth: AuthContext };
type AccountWithActor = Account & { actor: Actor | null };
type VoicePayload = {
  kind: "voice";
  durationMs?: number;
  waveform?: number[];
  mimeType?: string;
};
type LoginLogSession = Pick<AccountSession, "id" | "deviceKind" | "deviceName" | "ipAddress" | "userAgent">;
type ActivityLogInput = {
  kind: AdminLoginLogKind;
  accountId: number;
  sessionId?: string | null;
  channelId?: number | null;
  trackId?: number | null;
  playbackId?: string | null;
  deviceKind?: string | null;
  deviceName?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  appVersion?: string | null;
  latestVersion?: string | null;
  isLatestVersion?: boolean | null;
  state?: string | null;
  progressMs?: number | null;
  listenedMs?: number | null;
  durationMs?: number | null;
  createdAt?: Date;
};

const online = new Map<string, { actorId: number; accountId: number; username: string; displayName: string; avatarPath?: string | null }>();
const accountSocketIds = new Map<number, Set<string>>();
const accountPresenceStartedAt = new Map<number, Date>();
const musicListeners = new Map<string, MusicListenerDTO & { updatedAt: number }>();
const bibleReaders = new Map<string, BibleReaderPresenceDTO & { updatedAt: number }>();
const friendListeners = new Map<string, FriendListenerDTO & { updatedAt: number }>();
let vapidPublicKey = "";
let pushReady = false;

const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(512),
  keys: z.object({
    p256dh: z.string().min(1).max(255),
    auth: z.string().min(1).max(255)
  })
});

function detectDeviceKind(userAgent: string): DeviceKind {
  const ua = userAgent.toLowerCase();
  if (/ipad|tablet|playbook|silk/.test(ua)) return "tablet";
  if (/android/.test(ua) && !/mobile/.test(ua)) return "tablet";
  if (/iphone|ipod|mobile|android/.test(ua)) return "mobile";
  return "desktop";
}

function deviceNameFromRequest(request: FastifyRequest, override?: string) {
  const ua = String(request.headers["user-agent"] || "");
  return friendlyDeviceName(override, ua);
}

function clientIp(request: FastifyRequest) {
  const forwarded = request.headers["x-forwarded-for"];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return String(first || request.ip || "").split(",")[0].trim().slice(0, 64) || null;
}

function signToken(account: AccountWithActor, session: Pick<AccountSession, "id">) {
  if (!account.actor) throw new Error("account actor missing");
  return jwt.sign(
    {
      accountId: account.id,
      actorId: account.actor.id,
      username: account.username,
      isAdmin: account.role === "admin",
      canPinMessages: account.canPinMessages,
      sessionId: session.id
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

async function verifyJwtToken(token?: string): Promise<AuthContext> {
  if (!token) throw new Error("missing token");
  const decoded = jwt.verify(token, JWT_SECRET) as AuthContext & { loginAt?: string };
  if (!decoded.sessionId) throw new Error("missing session");
  const cacheKey = `${decoded.accountId}:${decoded.sessionId}`;
  const cached = authSessionCache.get(cacheKey);
  let account: AccountWithActor | null;
  let session: AccountSession | null;
  if (cached && cached.expiresAt > Date.now()) {
    account = cached.account;
    session = cached.session;
  } else {
    [account, session] = await Promise.all([
      prisma.account.findUnique({ where: { id: decoded.accountId }, include: { actor: true } }),
      prisma.accountSession.findUnique({ where: { id: decoded.sessionId } })
    ]);
    if (account && session) {
      authSessionCache.set(cacheKey, { account, session, expiresAt: Date.now() + AUTH_SESSION_CACHE_TTL_MS });
      if (authSessionCache.size > AUTH_SESSION_CACHE_LIMIT) {
        const oldest = authSessionCache.keys().next().value;
        if (oldest !== undefined) authSessionCache.delete(oldest);
      }
    }
  }
  if (!account || !account.actor) throw new Error("account not found");
  if (!session || session.accountId !== account.id || session.revokedAt || session.expiresAt <= new Date()) throw new Error("session expired");
  const touchBefore = new Date(Date.now() - 5 * 60 * 1000);
  await prisma.accountSession.updateMany({ where: { id: session.id, lastSeenAt: { lt: touchBefore } }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  return {
    accountId: account.id,
    actorId: account.actor.id,
    username: account.username,
    isAdmin: account.role === "admin",
    canPinMessages: account.canPinMessages,
    sessionId: session.id
  };
}

async function authenticateRequest(request: FastifyRequest, reply: FastifyReply, allowQueryToken = false) {
  const header = request.headers.authorization;
  const queryToken = allowQueryToken ? (request.query as { token?: string } | undefined)?.token : undefined;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : queryToken;
  try {
    (request as AuthedRequest).auth = await verifyJwtToken(token);
  } catch {
    reply.code(401).send({ success: false, message: "认证失败" });
  }
}

async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  await authenticateRequest(request, reply, false);
}

async function requireMediaAuth(request: FastifyRequest, reply: FastifyReply) {
  await authenticateRequest(request, reply, true);
}

async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  await requireAuth(request, reply);
  if (reply.sent) return;
  if (!(request as AuthedRequest).auth.isAdmin) {
    reply.code(403).send({ success: false, message: "需要管理员权限" });
  }
}

function cleanText(input: unknown) {
  const raw = String(input || "").trim().slice(0, 10000);
  return sanitizeHtml(raw, {
    allowedTags: ["br", "b", "strong", "i", "em", "u", "s", "del", "a"],
    allowedAttributes: { a: ["href", "target", "rel"] },
    allowedSchemes: ["http", "https", "mailto"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer", target: "_blank" })
    }
  });
}

function cleanMessagePayload(input: unknown): { effect?: MessageEffect; contentFormat?: "markdown" } | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const effect = cleanSupportedMessageEffect((input as { effect?: unknown }).effect);
  const contentFormat = (input as { contentFormat?: unknown; markdown?: unknown }).contentFormat;
  const payload = {
    ...(effect ? { effect } : {}),
    ...(contentFormat === "markdown" || (input as { markdown?: unknown }).markdown === true ? { contentFormat: "markdown" as const } : {})
  };
  return Object.keys(payload).length ? payload : undefined;
}

async function cleanTextMessagePayload(input: unknown) {
  const payload = cleanMessagePayload(input);
  if (!input || typeof input !== "object" || Array.isArray(input)) return payload;
  const requestedTrackId = Number((input as { musicTrackId?: unknown }).musicTrackId);
  if (!Number.isInteger(requestedTrackId) || requestedTrackId <= 0) return payload;
  const track = await prisma.message.findFirst({
    where: { id: requestedTrackId, channel: { kind: "music" }, type: "file", filePath: { not: null }, fileName: { not: null } },
    select: { id: true, fileName: true }
  });
  if (!track?.fileName || !isMusicFileName(track.fileName)) throw new Error("提及的歌曲不存在或已被删除");
  return {
    ...payload,
    musicTrackId: track.id,
    musicTrackTitle: musicTrackTitle(track.fileName)
  };
}

function cleanMessageEffect(input: unknown): { effect: MessageEffect } | undefined {
  const payload = cleanMessagePayload(input);
  return payload?.effect ? { effect: payload.effect } : undefined;
}

function cleanPrayerStatus(input: unknown): PrayerStatus {
  return input === "closed" || input === "answered" ? input : "active";
}

function cleanPrayerPayload(input: unknown) {
  const messagePayload = cleanMessagePayload(input);
  const status = input && typeof input === "object" && !Array.isArray(input) ? cleanPrayerStatus((input as { status?: unknown }).status) : "active";
  const imageMessageId = Number(
    input && typeof input === "object" && !Array.isArray(input) ? (input as { imageMessageId?: unknown }).imageMessageId || 0 : 0
  );
  return {
    kind: "prayer",
    status,
    ...(status === "active" ? {} : { statusAt: new Date().toISOString() }),
    ...(messagePayload?.effect ? { effect: messagePayload.effect } : {}),
    ...(messagePayload?.contentFormat ? { contentFormat: messagePayload.contentFormat } : {}),
    ...(Number.isInteger(imageMessageId) && imageMessageId > 0 ? { imageMessageId } : {})
  };
}

async function isValidPrayerImageMessage(imageMessageId: number, channelId: number) {
  if (!Number.isInteger(imageMessageId) || imageMessageId <= 0) return false;
  const image = await prisma.message.findFirst({ where: { id: imageMessageId, channelId, type: "image" }, select: { id: true } });
  return !!image;
}

function prayerPayloadRaw(input: unknown) {
  return input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}

function sourcePrayerMessageId(input: unknown, fallback: number) {
  const sourceId = Number(prayerPayloadRaw(input).sourcePrayerMessageId || 0);
  return Number.isFinite(sourceId) && sourceId > 0 ? sourceId : fallback;
}

async function canonicalPrayerMessage(message: Message) {
  const sourceId = sourcePrayerMessageId(message.payload, message.id);
  if (sourceId === message.id) return message;
  const source = await prisma.message.findFirst({ where: { id: sourceId, channelId: message.channelId, type: "prayer" } });
  return source || message;
}

function isPrayerUpdateMessage(message: Pick<Message, "id" | "payload">) {
  return sourcePrayerMessageId(message.payload, message.id) !== message.id;
}

let aiSettingsCache: { value: AiSettingsDTO; encryptedApiKey: string; loadedAt: number } | null = null;

function clampInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function aiEncryptionKey() {
  return crypto.createHash("sha256").update(AI_SETTINGS_SECRET).digest();
}

function encryptAiApiKey(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", aiEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(":");
}

function decryptAiApiKey(value: string) {
  if (!value) return "";
  try {
    const [version, iv, tag, encrypted] = value.split(":");
    if (version !== "v1" || !iv || !tag || !encrypted) return "";
    const decipher = crypto.createDecipheriv("aes-256-gcm", aiEncryptionKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

async function loadAiSettings(force = false) {
  if (!force && aiSettingsCache && Date.now() - aiSettingsCache.loadedAt < 5000) return aiSettingsCache;
  const rows = await prisma.setting.findMany({
    where: {
      key: {
        in: [
          "aiDeepSeekApiKeyEncrypted",
          "aiRelatedVersesEnabled",
          "aiRelatedVersesPromptCommand",
          "aiRelatedVersesCardCooldownSeconds",
          "aiRelatedVersesUserLimitPerMinute",
          "aiRelatedVersesMaxSuccessPerMessage"
        ]
      }
    }
  });
  const settings = new Map(rows.map((row) => [row.key, row.value]));
  const encryptedApiKey = settings.get("aiDeepSeekApiKeyEncrypted") || "";
  const value: AiSettingsDTO = {
    ...DEFAULT_AI_SETTINGS,
    enabled: settings.get("aiRelatedVersesEnabled") !== "false",
    apiKeyConfigured: !!decryptAiApiKey(encryptedApiKey),
    promptCommand: (settings.get("aiRelatedVersesPromptCommand") || DEFAULT_AI_PROMPT_COMMAND).trim() || DEFAULT_AI_PROMPT_COMMAND,
    cardCooldownSeconds: clampInteger(settings.get("aiRelatedVersesCardCooldownSeconds"), DEFAULT_AI_SETTINGS.cardCooldownSeconds, 0, 3600),
    userLimitPerMinute: clampInteger(settings.get("aiRelatedVersesUserLimitPerMinute"), DEFAULT_AI_SETTINGS.userLimitPerMinute, 1, 60),
    maxSuccessPerMessage: clampInteger(settings.get("aiRelatedVersesMaxSuccessPerMessage"), DEFAULT_AI_SETTINGS.maxSuccessPerMessage, 1, 20)
  };
  aiSettingsCache = { value, encryptedApiKey, loadedAt: Date.now() };
  return aiSettingsCache;
}

async function directChatMemberNames(channelId: number) {
  const members = await prisma.channelMember.findMany({
    where: { channelId },
    select: { account: { select: { displayName: true } } },
    orderBy: { createdAt: "asc" }
  });
  return members.map((member) => member.account.displayName);
}

async function generateDirectChatNameSuggestions(memberNames: string[]) {
  const fallback = fallbackDirectChatNames(memberNames);
  const aiSettings = await loadAiSettings();
  const apiKey = decryptAiApiKey(aiSettings.encryptedApiKey);
  if (!apiKey) return fallback;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${aiSettings.value.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: aiSettings.value.model,
        messages: [
          {
            role: "system",
            content: "你是聊天群命名助手。请只返回一个 JSON 字符串数组，严格包含 7 个简短、友好、有趣且彼此不同的中文名称；每个名称 2 至 12 个汉字，不要解释。"
          },
          {
            role: "user",
            content: `请根据这些成员昵称起名：${JSON.stringify(memberNames)}`
          }
        ],
        thinking: { type: "disabled" },
        temperature: 1.1,
        max_tokens: 300,
        stream: false
      }),
      signal: controller.signal
    });
    const payload = (await response.json().catch(() => ({}))) as any;
    if (!response.ok) throw new Error(String(payload?.error?.message || payload?.message || `AI HTTP ${response.status}`));
    return parseDirectChatNameSuggestions(String(payload?.choices?.[0]?.message?.content || ""), memberNames);
  } catch {
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
}

async function ensureDirectGroupDefaultName(channelId: number) {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { kind: true, directKey: true, name: true, _count: { select: { members: true } } }
  });
  if (
    channel?.kind !== "direct" ||
    !channel.directKey ||
    channel.directKey.startsWith("virtual:") ||
    channel._count.members <= 2 ||
    !isAutomaticDirectChatName(channel.name)
  ) {
    return;
  }
  const memberNames = await directChatMemberNames(channelId);
  const [name] = await generateDirectChatNameSuggestions(memberNames);
  if (name) await prisma.channel.update({ where: { id: channelId }, data: { name } });
}

function resetAiSettingsCache() {
  aiSettingsCache = null;
}

function plainTextFromHtml(input?: string | null, maxLength = 2000) {
  return String(input || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLength);
}

// 剥离常见 Markdown 语法标记，用于频道预览、推送通知等纯文本场景，
// 让 AI 助手回复里的 **、#、`、列表符号等不再原样显示。
function stripMarkdownSyntax(input?: string | null) {
  return String(input || "")
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/^```[^\n]*\n?/gm, "").replace(/```$/g, ""))
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/^\s*(\d+)[.、)]\s+/gm, "$1. ")
    .replace(/^>\s?/gm, "")
    .replace(/^\s*[-*_]{3,}\s*$/gm, "—")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1$2")
    .replace(/(^|[^_])_([^_]+)_/g, "$1$2")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanAiError(error: unknown) {
  if (error instanceof Error) return error.message.slice(0, 1000);
  return String(error || "AI request failed").slice(0, 1000);
}

function parseAiVerseReferences(input: string, limit = 3) {
  const seen = new Set<string>();
  const references: string[] = [];
  for (const rawLine of input.split(/\n|;|；/g)) {
    const cleaned = rawLine
      .replace(/^\s*(?:[-*•]\s*|\d+[.、]\s*)/, "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[。.!！]+$/g, "");
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    references.push(cleaned);
    if (references.length >= limit) break;
  }
  return references;
}

function bibleTopicSearchAllowed(accountId: number, limit: number) {
  const cutoff = Date.now() - 60_000;
  const recent = (bibleTopicSearchWindows.get(accountId) || []).filter((timestamp) => timestamp >= cutoff);
  if (recent.length >= limit) {
    bibleTopicSearchWindows.set(accountId, recent);
    return false;
  }
  recent.push(Date.now());
  bibleTopicSearchWindows.set(accountId, recent);
  return true;
}

function serializeAiSuggestion(row: {
  id: number;
  kind: string;
  status: string;
  references: unknown;
  responseText?: string | null;
  createdAt: Date;
  model?: string | null;
  createdBy?: { displayName: string } | null;
}): AiSuggestionDTO {
  const references = Array.isArray(row.references) ? row.references.map(String).filter(Boolean).slice(0, 3) : parseAiVerseReferences(row.responseText || "");
  return {
    id: row.id,
    kind: "prayer_related_verses",
    status: row.status === "failed" ? "failed" : "success",
    references,
    responseText: row.responseText || references.join("\n"),
    createdByName: row.createdBy?.displayName || null,
    createdAt: row.createdAt.toISOString(),
    model: row.model
  };
}

function aiConfigurationMessage(auth: Pick<AuthContext, "isAdmin">) {
  return auth.isAdmin ? "AI 经文建议尚未配置，请前往 /ai-settings 填写 API Key。" : "暂时还不能生成经文建议，请稍后再试。";
}

function applyFileResponseHeaders(reply: FastifyReply, name: string, forceDownload: boolean) {
  const policy = fileResponsePolicy(name, forceDownload);
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("Cross-Origin-Resource-Policy", "same-origin");
  reply.header("Content-Type", policy.contentType);
  reply.header("Content-Disposition", `${policy.disposition}; filename*=UTF-8''${encodeURIComponent(path.basename(name))}`);
  if (policy.sandbox) reply.header("Content-Security-Policy", "sandbox; default-src 'none'");
  return policy;
}

function applyFileValidation(request: FastifyRequest, reply: FastifyReply, stat: fs.Stats) {
  const etag = `W/\"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}\"`;
  reply.header("ETag", etag);
  reply.header("Last-Modified", stat.mtime.toUTCString());
  // Served files are content-addressed (UUID filenames, one upload per name),
  // so long-lived immutable caching is safe and avoids a revalidation round
  // trip per avatar/image on every page view.
  reply.header("Cache-Control", "private, max-age=31536000, immutable");
  const noneMatch = String(request.headers["if-none-match"] || "");
  const modifiedSince = Date.parse(String(request.headers["if-modified-since"] || ""));
  return noneMatch === etag || (!noneMatch && Number.isFinite(modifiedSince) && stat.mtimeMs <= modifiedSince + 999);
}

function applyJsonValidation(request: FastifyRequest, reply: FastifyReply, etag: string) {
  reply.header("ETag", etag);
  reply.header("Cache-Control", "private, no-cache");
  return String(request.headers["if-none-match"] || "") === etag;
}

function isImageFileName(name?: string | null) {
  return IMAGE_EXTENSIONS.has(path.extname(name || "").toLowerCase());
}

function wantsOriginalImage(fields: Record<string, { value?: string }>) {
  const value = String(fields.originalImage?.value || fields.original?.value || "").toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function compressedImageFileName(shortName = false) {
  return `${shortName ? crypto.randomBytes(5).toString("hex") : crypto.randomUUID()}.webp`;
}

function shortStorageFileName(ext: string) {
  const tokenLength = Math.max(4, 16 - ext.length);
  return `${crypto.randomBytes(Math.ceil(tokenLength / 2)).toString("hex").slice(0, tokenLength)}${ext}`;
}

function displayWebpFileName(name: string) {
  const base = path.basename(name, path.extname(name)).trim() || "image";
  return `${base}.webp`;
}

async function compressImageFile(inputPath: string, outputDir: string, options: { shortName?: boolean; maxDimension?: number } = {}) {
  const originalStat = fs.statSync(inputPath);
  const outputName = compressedImageFileName(options.shortName);
  const outputPath = path.join(outputDir, outputName);
  try {
    let pipeline = sharp(inputPath, { animated: true, failOn: "error", limitInputPixels: 40_000_000 }).rotate();
    if (options.maxDimension) {
      pipeline = pipeline.resize({ width: options.maxDimension, height: options.maxDimension, fit: "inside", withoutEnlargement: true });
    }
    await pipeline
      .webp({ quality: IMAGE_WEBP_QUALITY, effort: IMAGE_WEBP_EFFORT, smartSubsample: true })
      .toFile(outputPath);
    const outputStat = fs.statSync(outputPath);
    if (outputStat.size >= originalStat.size) {
      fs.unlinkSync(outputPath);
      return null;
    }
    return {
      fileName: outputName,
      filePath: outputPath,
      size: outputStat.size,
      originalSize: originalStat.size,
      savedBytes: originalStat.size - outputStat.size
    };
  } catch (error) {
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    app.log.warn({ error, inputPath }, "image compression failed");
    return null;
  }
}

async function validateStoredImage(filePath: string) {
  try {
    const metadata = await sharp(filePath, { failOn: "error", limitInputPixels: 40_000_000 }).metadata();
    return !!metadata.format && !!metadata.width && !!metadata.height && metadata.width <= 20_000 && metadata.height <= 20_000;
  } catch {
    return false;
  }
}

const IMAGE_THUMB_MAX_DIMENSION = 480;

// Chat bubbles render at ~260px but used to transfer the full-size image;
// keep a small webp variant next to the stored file for bubble rendering and
// preload warming. Served through /api/files/:id?thumb=1 with a server-side
// fallback to the original when no thumbnail exists (older uploads).
export async function writeImageThumbnail(storedPath: string) {
  const thumbPath = `${storedPath}.thumb.webp`;
  if (fs.existsSync(thumbPath)) return;
  try {
    const source = sharp(storedPath, { animated: true, failOn: "error", limitInputPixels: 40_000_000 });
    const metadata = await source.metadata();
    if (!metadata.width || !metadata.height || Math.max(metadata.width, metadata.height) <= IMAGE_THUMB_MAX_DIMENSION) return;
    await sharp(storedPath, { animated: true, failOn: "error", limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: IMAGE_THUMB_MAX_DIMENSION, height: IMAGE_THUMB_MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 78, effort: IMAGE_WEBP_EFFORT, smartSubsample: true })
      .toFile(thumbPath);
  } catch (error) {
    if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
    app.log.warn({ error, storedPath }, "image thumbnail failed");
  }
}

// Older uploads predate thumbnails; generate missing variants once in the
// background after boot. Already-covered files skip on an existsSync check.
async function backfillImageThumbnails() {
  for (const name of fs.readdirSync(UPLOAD_DIR)) {
    if (name.endsWith(".thumb.webp") || !isImageFileName(name)) continue;
    await writeImageThumbnail(path.join(UPLOAD_DIR, name));
  }
}

async function storedImageDimensions(filePath: string): Promise<ImageDimensions | undefined> {
  try {
    const metadata = await sharp(filePath, { failOn: "error", limitInputPixels: 40_000_000 }).metadata();
    if (!metadata.width || !metadata.height || metadata.width > 20_000 || metadata.height > 20_000) return undefined;
    return orientedImageDimensions(metadata.width, metadata.height, metadata.orientation);
  } catch {
    return undefined;
  }
}

function isAudioFileName(name?: string | null) {
  return /\.(webm|mp3|m4a|wav|ogg|aac|mp4)$/i.test(name || "");
}

const musicService = createMusicService({ prisma, canAccessChannel });

function cleanChannelIcon(input: unknown) {
  const icon = path.basename(String(input || "").trim()).slice(0, 16);
  if (icon === MUSIC_CHANNEL_ICON) return icon;
  return /\.(jpe?g|png|gif|webp)$/i.test(icon) ? icon : "";
}

function cleanHexColor(input: unknown, fallback: string) {
  const value = String(input || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : fallback;
}

function cleanThemeId(input: unknown) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 32)
    .replace(/^-|-$/g, "");
}

function cleanThemePalette(input: unknown): ThemePaletteDTO {
  const palette = (input && typeof input === "object" ? input : {}) as Partial<Record<keyof ThemePaletteDTO, unknown>>;
  return {
    accent: cleanHexColor(palette.accent, DEFAULT_THEME_PALETTE.accent),
    accentDark: cleanHexColor(palette.accentDark, DEFAULT_THEME_PALETTE.accentDark),
    buttonText: cleanHexColor(palette.buttonText, DEFAULT_THEME_PALETTE.buttonText),
    bg: cleanHexColor(palette.bg, DEFAULT_THEME_PALETTE.bg),
    chatBg: cleanHexColor(palette.chatBg, DEFAULT_THEME_PALETTE.chatBg),
    panel: cleanHexColor(palette.panel, DEFAULT_THEME_PALETTE.panel),
    line: cleanHexColor(palette.line, DEFAULT_THEME_PALETTE.line),
    text: cleanHexColor(palette.text, DEFAULT_THEME_PALETTE.text),
    muted: cleanHexColor(palette.muted, DEFAULT_THEME_PALETTE.muted),
    bubbleOther: cleanHexColor(palette.bubbleOther, DEFAULT_THEME_PALETTE.bubbleOther),
    bubbleOtherText: cleanHexColor(palette.bubbleOtherText, DEFAULT_THEME_PALETTE.bubbleOtherText),
    bubbleMine: cleanHexColor(palette.bubbleMine, DEFAULT_THEME_PALETTE.bubbleMine),
    bubbleMineText: cleanHexColor(palette.bubbleMineText, DEFAULT_THEME_PALETTE.bubbleMineText)
  };
}

function cleanFlashEffect(input: unknown): FlashEffectSettingsDTO {
  const raw = (input && typeof input === "object" ? input : {}) as Partial<FlashEffectSettingsDTO>;
  const colors = (Array.isArray(raw.colors) ? raw.colors : DEFAULT_FLASH_EFFECT.colors)
    .map((color) => cleanHexColor(color, ""))
    .filter(Boolean)
    .slice(0, 10);
  const seconds = Number(raw.intervalSeconds);
  const intervalSeconds = Math.round(Math.min(10, Math.max(0.01, Number.isFinite(seconds) ? seconds : DEFAULT_FLASH_EFFECT.intervalSeconds)) * 100) / 100;
  const transitionMode = raw.transitionMode === "step" ? "step" : "smooth";
  return {
    colors: colors.length ? colors : [...DEFAULT_FLASH_EFFECT.colors],
    intervalSeconds,
    transitionMode
  };
}

function cleanCustomThemes(input: unknown): ThemeDTO[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  return input
    .map((theme, index) => {
      const row = (theme && typeof theme === "object" ? theme : {}) as Partial<ThemeDTO>;
      const id = cleanThemeId(row.id) || `custom-${index + 1}`;
      const name = String(row.name || "").trim().slice(0, 24) || "自定义主题";
      return { id, name, palette: cleanThemePalette(row.palette) };
    })
    .filter((theme) => {
      if (THEMES.has(theme.id) || seen.has(theme.id)) return false;
      seen.add(theme.id);
      return true;
    })
    .slice(0, 24);
}

function directChannelKey(accountA: number, accountB: number) {
  return [accountA, accountB].sort((a, b) => a - b).join(":");
}

function virtualDirectChannelKey(accountId: number, username: string) {
  return `virtual:${accountId}:${username}`;
}

function isVoiceMessage(message: Pick<Message, "type" | "fileName" | "payload">) {
  const payload = message.payload as Partial<VoicePayload> | null;
  return message.type === "file" && payload?.kind === "voice" && isAudioFileName(message.fileName);
}

function normalizedWaveform(input: unknown) {
  if (!Array.isArray(input)) return undefined;
  const bars = input
    .slice(0, 64)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .map((value) => Math.min(1, Math.max(0.08, value)));
  return bars.length ? bars : undefined;
}

function parseVoiceUploadPayload(fields: Record<string, { value?: string }>, mimeType: string): VoicePayload | undefined {
  if (fields.voice?.value !== "1") return undefined;
  const durationMs = Math.max(0, Math.min(Number(fields.durationMs?.value || 0), 30 * 60 * 1000)) || undefined;
  const waveform = parseJsonField<number[]>(fields.waveform?.value, []);
  return {
    kind: "voice",
    durationMs,
    waveform: normalizedWaveform(waveform),
    mimeType
  };
}

async function transcodeVoiceToM4a(inputPath: string, outputPath: string) {
  await new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", ["-y", "-i", inputPath, "-vn", "-c:a", "aac", "-profile:a", "aac_low", "-ac", "1", "-ar", "16000", "-b:a", "18k", "-cutoff", "7000", "-movflags", "+faststart", outputPath], {
      stdio: ["ignore", "ignore", "pipe"]
    });
    let errorText = "";
    ffmpeg.stderr.on("data", (chunk) => {
      errorText += String(chunk).slice(0, 2000);
    });
    ffmpeg.on("error", reject);
    ffmpeg.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(errorText || `ffmpeg exited ${code}`));
    });
  });
}

function authDto(account: AccountWithActor) {
  if (!account.actor) throw new Error("account actor missing");
  return {
    id: account.id,
    username: account.username,
    displayName: account.displayName,
    avatarPath: account.avatarPath,
    isAdmin: account.role === "admin",
    canPinMessages: account.canPinMessages,
    actorId: account.actor.id,
    theme: account.theme || "wechat",
    biblePreferences: cleanBiblePreferences(account.biblePreferences)
  };
}

async function updateAccountAvatarFromUpload(accountId: number, request: FastifyRequest, reply: FastifyReply) {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) return reply.code(404).send({ success: false, message: "用户不存在" });
  const file = await request.file();
  if (!file) return reply.code(400).send({ success: false, message: "缺少头像图片" });
  const ext = path.extname(file.filename).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext) || !file.mimetype.startsWith("image/")) {
    return reply.code(400).send({ success: false, message: "只支持图片头像" });
  }
  const safeName = `${crypto.randomUUID()}${ext}`;
  const outPath = path.join(AVATAR_DIR, safeName);
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createWriteStream(outPath);
    file.file.pipe(stream);
    file.file.on("error", reject);
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
  if (!(await validateStoredImage(outPath))) {
    safeUnlink("avatar", safeName);
    return reply.code(400).send({ success: false, message: "头像内容无效或尺寸过大" });
  }
  let avatarPath = safeName;
  const compressed = await compressImageFile(outPath, AVATAR_DIR, { maxDimension: 256 });
  if (compressed) {
    fs.unlinkSync(outPath);
    avatarPath = compressed.fileName;
  }
  const updated = await prisma.account.update({
    where: { id: accountId },
    data: { avatarPath, actor: { update: { avatarPath } } },
    include: { actor: true }
  });
  refreshAccountConnections(updated);
  return { success: true, account: authDto(updated) };
}

function cleanBiblePreferences(value: unknown): BiblePreferencesDTO {
  const row = value && typeof value === "object" ? (value as Partial<BiblePreferencesDTO>) : {};
  return {
    outputFormat: BIBLE_OUTPUT_FORMATS.has(String(row.outputFormat)) ? (row.outputFormat as BiblePreferencesDTO["outputFormat"]) : DEFAULT_BIBLE_PREFERENCES.outputFormat,
    referenceLabelMode: BIBLE_REFERENCE_LABEL_MODES.has(String(row.referenceLabelMode)) ? (row.referenceLabelMode as BiblePreferencesDTO["referenceLabelMode"]) : DEFAULT_BIBLE_PREFERENCES.referenceLabelMode,
    combinedPassageMode: BIBLE_COMBINED_PASSAGE_MODES.has(String(row.combinedPassageMode)) ? (row.combinedPassageMode as BiblePreferencesDTO["combinedPassageMode"]) : DEFAULT_BIBLE_PREFERENCES.combinedPassageMode,
    quotationStyle: BIBLE_QUOTATION_STYLES.has(String(row.quotationStyle)) ? (row.quotationStyle as BiblePreferencesDTO["quotationStyle"]) : DEFAULT_BIBLE_PREFERENCES.quotationStyle
  };
}

function biblePreferencesJson(value: unknown): Prisma.InputJsonObject {
  const preferences = cleanBiblePreferences(value);
  return {
    outputFormat: preferences.outputFormat,
    referenceLabelMode: preferences.referenceLabelMode,
    combinedPassageMode: preferences.combinedPassageMode,
    quotationStyle: preferences.quotationStyle
  };
}

async function canAccessChannel(accountId: number, channelId: number) {
  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel) return false;
  if (channel.kind === "aiLounge") return false;
  if (channel.kind === "music") return true;
  if (!channelNeedsExplicitMembership(channel)) return true;
  const member = await prisma.channelMember.findUnique({ where: { channelId_accountId: { channelId, accountId } } });
  return !!member;
}

async function canWriteChannel(accountId: number, channelId: number) {
  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel) return false;
  if (channel.kind === "aiLounge") return false;
  if (channel.kind === "music") return true;
  if (!channelNeedsExplicitMembership(channel)) return true;
  const member = await prisma.channelMember.findUnique({ where: { channelId_accountId: { channelId, accountId } } });
  return !!member && member.role !== "viewer";
}

async function canManageChannel(accountId: number, channelId: number) {
  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { directKey: true, kind: true } });
  if (!channel) return false;
  if (channel?.kind === "aiLounge") return false;
  if (channel.kind === "music") return musicService.canManageAccount(accountId);
  const account = await prisma.account.findUnique({ where: { id: accountId }, select: { role: true } });
  if (account?.role === "admin") return true;
  if (channel?.kind === "why") {
    const member = await prisma.channelMember.findUnique({ where: { channelId_accountId: { channelId, accountId } } });
    return member?.role === "owner" || member?.role === "admin";
  }
  if (channel?.directKey) {
    const member = await prisma.channelMember.findUnique({ where: { channelId_accountId: { channelId, accountId } } });
    return member?.role === "owner" || member?.role === "admin";
  }
  const member = await prisma.channelMember.findUnique({ where: { channelId_accountId: { channelId, accountId } } });
  return member?.role === "owner" || member?.role === "admin";
}

async function isMusicChannel(channelId: number) {
  return !!(await prisma.channel.findFirst({ where: { id: channelId, kind: "music" }, select: { id: true } }));
}

async function canPinChannel(auth: Pick<AuthContext, "accountId" | "isAdmin" | "canPinMessages">, channelId: number) {
  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { isDefault: true, directKey: true, kind: true } });
  if (!channel || channel.directKey || channel.kind !== "standard") return false;
  if (auth.isAdmin) return true;
  return !!auth.canPinMessages && channel.isDefault && (await canAccessChannel(auth.accountId, channelId));
}

// Optional prefetched context for list serialization. Endpoints that render a
// page of messages build this once so per-type relations (voice listens,
// prayer actions/AI suggestions, shared playlists) cost a constant number of
// queries instead of scaling with the page size. Single-message callers
// (socket emits, mutations) omit it and keep the per-message lookups.
type MessageSerializeBatch = {
  voiceListenedMessageIds?: Set<number>;
  prayer?: {
    aiSettings: Awaited<ReturnType<typeof loadAiSettings>>;
    sourceMessages: Map<number, Message | null>;
    actionsByMessageId: Map<number, Array<PrayerAction & { account: Pick<Account, "displayName" | "avatarPath"> }>>;
    aiSuggestionsByMessageId: Map<number, Array<MessageAiSuggestion & { createdBy: Pick<Account, "displayName"> | null }>>;
    aiSuggestionCountsByMessageId: Map<number, number>;
  };
  playlists?: Map<number, Awaited<ReturnType<typeof musicService.playlistDto>>>;
};

async function serializeMessage(message: Message & { sender: Actor; replyTo?: (Message & { sender: Actor }) | null }, viewerAccountId?: number, batch?: MessageSerializeBatch): Promise<MessageDTO> {
  let voiceListened: boolean | undefined;
  if (isVoiceMessage(message)) {
    voiceListened = message.sender.accountId === viewerAccountId;
    if (!voiceListened && viewerAccountId) {
      const attachedListens = (message as typeof message & { voiceListens?: Array<{ id: number }> }).voiceListens;
      if (batch?.voiceListenedMessageIds) {
        voiceListened = batch.voiceListenedMessageIds.has(message.id);
      } else if (attachedListens) {
        voiceListened = attachedListens.length > 0;
      } else {
        const listened = await prisma.voiceListen.findUnique({ where: { messageId_accountId: { messageId: message.id, accountId: viewerAccountId } } });
        voiceListened = !!listened;
      }
    }
  }
  let payload: unknown = message.payload || undefined;
  const loadedReactions = message as typeof message & {
    likes?: Array<{ accountId: number; account: Pick<Account, "displayName" | "avatarPath"> }>;
    favorites?: Array<{ accountId: number }>;
  };
  const [likes, favorites] = await Promise.all([
    loadedReactions.likes
      ? Promise.resolve(loadedReactions.likes)
      : prisma.messageLike.findMany({
          where: { messageId: message.id },
          include: { account: { select: { displayName: true, avatarPath: true } } },
          orderBy: { createdAt: "asc" }
        }),
    loadedReactions.favorites
      ? Promise.resolve(loadedReactions.favorites)
      : prisma.messageFavorite.findMany({ where: { messageId: message.id }, select: { accountId: true } })
  ]);
  const loadedAudioRelations = message as typeof message & {
    musicScores?: Array<MusicScore & { pages: MusicScorePage[] }>;
    musicLyrics?: MusicLyrics | null;
  };
  const isAudio = message.type === "file" && isAudioFileName(message.fileName);
  const [musicScores, musicLyrics] = isAudio
    ? await Promise.all([
        loadedAudioRelations.musicScores ||
          prisma.musicScore.findMany({
            where: { trackId: message.id },
            orderBy: { id: "asc" },
            include: { pages: { orderBy: { pageIndex: "asc" } } }
          }),
        loadedAudioRelations.musicLyrics !== undefined
          ? Promise.resolve(loadedAudioRelations.musicLyrics)
          : prisma.musicLyrics.findUnique({ where: { trackId: message.id } })
      ])
    : [[], null];
  if (message.type === "prayer") {
    const aiSettings = batch?.prayer ? batch.prayer.aiSettings : await loadAiSettings();
    const raw = prayerPayloadRaw(message.payload);
    const sourceId = sourcePrayerMessageId(message.payload, message.id);
    const sourceMessage =
      sourceId !== message.id
        ? batch?.prayer
          ? (batch.prayer.sourceMessages.get(sourceId) ?? null)
          : await prisma.message.findFirst({ where: { id: sourceId, channelId: message.channelId, type: "prayer" } })
        : null;
    const actionMessageId = sourceMessage?.id || message.id;
    const sourceRaw = prayerPayloadRaw(sourceMessage?.payload);
    const displayRaw = sourceMessage ? { ...raw, ...sourceRaw, sourcePrayerMessageId: sourceMessage.id, latestUpdateAt: raw.latestUpdateAt, latestUpdateBy: raw.latestUpdateBy } : raw;
    const [actions, aiSuggestionRows, aiSuggestionSuccessCount] = batch?.prayer
      ? [
          batch.prayer.actionsByMessageId.get(actionMessageId) ?? [],
          batch.prayer.aiSuggestionsByMessageId.get(actionMessageId) ?? [],
          batch.prayer.aiSuggestionCountsByMessageId.get(actionMessageId) ?? 0
        ]
      : await Promise.all([
          prisma.prayerAction.findMany({
            where: { messageId: actionMessageId },
            include: { account: { select: { displayName: true, avatarPath: true } } },
            orderBy: { prayedAt: "desc" }
          }),
          prisma.messageAiSuggestion.findMany({
            where: { messageId: actionMessageId, kind: AI_RELATED_VERSES_KIND, status: "success" },
            include: { createdBy: { select: { displayName: true } } },
            orderBy: { createdAt: "desc" },
            take: 3
          }),
          prisma.messageAiSuggestion.count({ where: { messageId: actionMessageId, kind: AI_RELATED_VERSES_KIND, status: "success" } })
        ]);
    const byAccount = new Map<number, { accountId: number; displayName: string; avatarPath?: string | null; latestPrayedAt: string; times: number }>();
    for (const action of actions) {
      const current = byAccount.get(action.accountId);
      if (current) {
        current.times += 1;
      } else {
        byAccount.set(action.accountId, {
          accountId: action.accountId,
          displayName: action.account.displayName,
          avatarPath: action.account.avatarPath,
          latestPrayedAt: action.prayedAt.toISOString(),
          times: 1
        });
      }
    }
    payload = {
      ...displayRaw,
      kind: "prayer",
      status: cleanPrayerStatus(displayRaw.status),
      prayerCount: byAccount.size,
      prayerActionCount: actions.length,
      currentUserPrayed: viewerAccountId ? byAccount.has(viewerAccountId) : false,
      prayedBy: [...byAccount.values()],
      aiSuggestions: aiSuggestionRows.map(serializeAiSuggestion),
      aiSuggestionSuccessCount,
      aiSuggestionMaxSuccess: aiSettings.value.maxSuccessPerMessage
    };
  }
  const playlistId = message.type === "music_playlist" && payload && typeof payload === "object"
    ? Number((payload as { playlistId?: unknown }).playlistId || 0)
    : 0;
  const sharedMusicPlaylist = playlistId
    ? batch?.playlists
      ? (batch.playlists.get(playlistId) ?? null)
      : await musicService.playlistDto(playlistId, viewerAccountId || 0)
    : undefined;
  return {
    id: message.id,
    channelId: message.channelId,
    sender: {
      id: message.sender.id,
      kind: message.sender.kind,
      username: message.sender.username,
      displayName: message.sender.displayName,
      avatarPath: message.sender.avatarPath
    },
    content: message.content || "",
    type: message.type,
    payload,
    fileName: message.fileName,
    fileSize: message.fileSize,
    scores: musicScores.map((score) => {
      const kind = score.pages[0]?.fileName?.toLowerCase().endsWith(".pdf") ? "pdf" : "image";
      return {
        id: score.id,
        title: score.title,
        kind,
        pages: score.pages.map((page) => ({
          id: page.id,
          scoreId: score.id,
          pageIndex: page.pageIndex,
          fileName: page.fileName,
          fileSize: page.fileSize,
          width: page.width,
          height: page.height
        }))
      };
    }),
    lyrics: musicLyrics ? { id: musicLyrics.id, fileName: musicLyrics.fileName, cues: parseLyrics(musicLyrics.content, musicLyrics.fileName) } : null,
    voiceListened,
    replyTo: message.replyTo
      ? {
          id: message.replyTo.id,
          content: plainTextPreview(message.replyTo.content || message.replyTo.fileName || "", 140),
          type: message.replyTo.type,
          senderName: message.replyTo.sender.displayName
        }
      : null,
    chainRootId: message.chainRootId,
    chainVersion: message.chainVersion,
    createdAt: message.createdAt.toISOString(),
    reactions: {
      likeCount: likes.length,
      likedBy: likes.map((like) => ({
        accountId: like.accountId,
        displayName: like.account.displayName,
        avatarPath: like.account.avatarPath
      })),
      favoriteCount: favorites.length,
      currentUserLiked: !!viewerAccountId && likes.some((like) => like.accountId === viewerAccountId),
      currentUserFavorited: !!viewerAccountId && favorites.some((favorite) => favorite.accountId === viewerAccountId)
    },
    ...(message.type === "music_playlist" ? { musicPlaylist: sharedMusicPlaylist || null } : {})
  };
}

async function hydrateMessage(id: number, viewerAccountId?: number) {
  const message = await prisma.message.findUnique({
    where: { id },
    include: {
      sender: true,
      replyTo: { include: { sender: true } },
      // Preloaded relations are picked up by serializeMessage's preloaded
      // branches, keeping single-message hydration to one round of queries.
      likes: { include: { account: { select: { displayName: true, avatarPath: true } } }, orderBy: { createdAt: "asc" } },
      favorites: { select: { accountId: true } },
      musicScores: { orderBy: { id: "asc" }, include: { pages: { orderBy: { pageIndex: "asc" } } } },
      musicLyrics: true,
      ...(viewerAccountId ? { voiceListens: { where: { accountId: viewerAccountId }, select: { id: true } } } : {})
    }
  });
  return message ? serializeMessage(message, viewerAccountId) : null;
}

const audioWaveformJobs = new Set<number>();

async function enrichAudioMessageWaveform(messageId: number, expectedFilePath: string) {
  if (audioWaveformJobs.has(messageId)) return;
  audioWaveformJobs.add(messageId);
  try {
    const storedPath = path.join(UPLOAD_DIR, path.basename(expectedFilePath));
    if (!fs.existsSync(storedPath)) return;
    const waveform = await analyzeAudioWaveform(storedPath);
    const current = await prisma.message.findUnique({ where: { id: messageId }, select: { channelId: true, filePath: true, payload: true } });
    if (!current || current.filePath !== expectedFilePath) return;
    const payload = mergeAudioWaveformPayload(current.payload, waveform);
    await prisma.message.update({ where: { id: messageId }, data: { payload: payload as Prisma.InputJsonObject } });
    const dto = await hydrateMessage(messageId);
    if (dto) io.to(`ch:${current.channelId}`).emit("message:updated", dto);
  } catch (error) {
    app.log.warn({ error, messageId }, "audio waveform analysis failed; keeping placeholder waveform");
  } finally {
    audioWaveformJobs.delete(messageId);
  }
}

async function backfillAudioMessageWaveforms() {
  const messages = await prisma.message.findMany({
    where: { type: "file", filePath: { not: null } },
    select: { id: true, fileName: true, filePath: true, payload: true },
    orderBy: { id: "asc" }
  });
  for (const message of messages) {
    if (!message.filePath || !isAudioFileName(message.fileName)) continue;
    const payload = message.payload && typeof message.payload === "object" && !Array.isArray(message.payload) ? (message.payload as Record<string, unknown>) : {};
    if (payload.kind === "voice" || normalizedWaveform(payload.waveform)?.length) continue;
    await enrichAudioMessageWaveform(message.id, message.filePath);
  }
}

async function backfillImageMessageDimensions() {
  const messages = await prisma.message.findMany({
    where: { type: "image", filePath: { not: null } },
    select: { id: true, filePath: true, payload: true },
    orderBy: { id: "asc" }
  });
  for (const message of messages) {
    if (!message.filePath) continue;
    const payload = message.payload && typeof message.payload === "object" && !Array.isArray(message.payload)
      ? message.payload as Record<string, unknown>
      : {};
    if (payload.imageDimensionsVersion === 2) continue;
    const dimensions = await storedImageDimensions(path.join(UPLOAD_DIR, path.basename(message.filePath)));
    if (!dimensions) continue;
    await prisma.message.update({
      where: { id: message.id },
      data: {
        payload: {
          ...mergeImageDimensionsPayload(message.payload, dimensions),
          imageDimensionsVersion: 2
        } as Prisma.InputJsonObject
      }
    });
  }
}

function plainTextPreview(input?: string | null, maxLength = 80) {
  const text = stripMarkdownSyntax(plainTextFromHtml(input, 4000));
  return text.slice(0, maxLength);
}

async function ensureAiRoleCharacter(username: string, fallbackName: string, displayName?: string) {
  if (!AI_ROLE_USERNAMES.has(username)) throw new Error("unknown AI role");
  const name = (displayName || fallbackName).trim() || fallbackName;
  const actor = await prisma.actor.upsert({
    where: { username },
    update: { displayName: name, kind: "virtual", status: "active" },
    create: { kind: "virtual", username, displayName: name }
  });
  const existingCharacter = await prisma.virtualCharacter.findUnique({ where: { actorId: actor.id }, select: { id: true } });
  if (!existingCharacter) {
    await prisma.virtualCharacter.create({
      data: {
        actorId: actor.id,
        enabled: true,
        config: defaultVirtualCharacterConfig(name),
        engineBinding: {}
      }
    });
  }
  return actor;
}

async function ensureWhyAssistantCharacter(displayName?: string) {
  return ensureAiRoleCharacter(WHY_ASSISTANT_USERNAME, WHY_ASSISTANT_NAME, displayName);
}

function normalizeRoleModel(value?: unknown) {
  return String(value || "").trim().slice(0, 120);
}

function normalizeRoleMemory(value?: unknown) {
  return String(value || "").trim().slice(0, 8000);
}

function roleConfigObject(rawConfig: unknown) {
  return rawConfig && typeof rawConfig === "object" && !Array.isArray(rawConfig) ? (rawConfig as Record<string, any>) : {};
}

function roleConfigDetails(rawConfig: unknown) {
  const config = roleConfigObject(rawConfig);
  const profile = roleConfigObject(config.profile);
  const manualMemory = roleConfigObject(config.manualMemory);
  const generation = roleConfigObject(config.generation);
  const multichar = roleConfigObject(config.multichar);
  const modelHints = roleConfigObject(multichar.modelHints);
  return {
    persona: String(profile.persona || ""),
    activationJudgePrompt: String(config.activationJudgePrompt || ""),
    channelIds: Array.isArray(config.channels) ? config.channels.map(Number).filter(Number.isFinite) : [],
    model: normalizeRoleModel(generation.model || modelHints.mainModel),
    thinkingEnabled: Boolean(generation.thinkingEnabled),
    shortTermMemory: String(manualMemory.shortTerm || ""),
    midTermMemory: String(manualMemory.midTerm || ""),
    longTermMemory: String(manualMemory.longTerm || "")
  };
}

function buildAiRoleCharacterConfig(input: {
  displayName: string;
  persona: string;
  channelIds?: number[];
  existingConfig?: unknown;
  activationJudgePrompt?: string;
  model?: string;
  thinkingEnabled?: boolean;
  shortTermMemory?: string;
  midTermMemory?: string;
  longTermMemory?: string;
}) {
  const base = roleConfigObject(input.existingConfig);
  const profile = roleConfigObject(base.profile);
  const multichar = roleConfigObject(base.multichar);
  const bio = roleConfigObject(multichar.bio);
  const basics = roleConfigObject(bio.basics);
  const modelHints = roleConfigObject(multichar.modelHints);
  const model = normalizeRoleModel(input.model);
  const nextModelHints = { ...modelHints };
  if (model) nextModelHints.mainModel = model;
  else delete nextModelHints.mainModel;
  return {
    ...base,
    profile: {
      ...profile,
      name: input.displayName,
      persona: input.persona,
      speakingStyle: String(profile.speakingStyle || "像微信群里的真人，简短自然")
    },
    activationJudgePrompt: input.activationJudgePrompt ?? String(base.activationJudgePrompt || ""),
    channels: [...new Set((input.channelIds || []).map(Number).filter(Number.isFinite))],
    manualMemory: {
      ...roleConfigObject(base.manualMemory),
      shortTerm: normalizeRoleMemory(input.shortTermMemory),
      midTerm: normalizeRoleMemory(input.midTermMemory),
      longTerm: normalizeRoleMemory(input.longTermMemory)
    },
    generation: {
      ...roleConfigObject(base.generation),
      model,
      thinkingEnabled: Boolean(input.thinkingEnabled)
    },
    multichar: {
      ...multichar,
      bio: {
        ...bio,
        basics: {
          ...basics,
          name: input.displayName,
          identity: input.persona || String(basics.identity || "")
        }
      },
      emotionBaseline: String(multichar.emotionBaseline || "平静中性"),
      modelHints: nextModelHints
    }
  };
}

async function syncAiRoleVirtualCharacterConfig(username: string, fallbackName: string, input: {
  displayName: string;
  persona: string;
  enabled?: boolean;
  activationJudgePrompt?: string;
  channelIds?: number[];
  model?: string;
  thinkingEnabled?: boolean;
  shortTermMemory?: string;
  midTermMemory?: string;
  longTermMemory?: string;
}) {
  const actor = await ensureAiRoleCharacter(username, fallbackName, input.displayName);
  const character = await prisma.virtualCharacter.findUnique({ where: { actorId: actor.id } });
  if (!character) return actor;
  await prisma.virtualCharacter.update({
    where: { id: character.id },
    data: {
      enabled: input.enabled,
      config: buildAiRoleCharacterConfig({
        displayName: input.displayName,
        persona: input.persona,
        channelIds: input.channelIds,
        existingConfig: character.config,
        activationJudgePrompt: input.activationJudgePrompt,
        model: input.model,
        thinkingEnabled: input.thinkingEnabled,
        shortTermMemory: input.shortTermMemory,
        midTermMemory: input.midTermMemory,
        longTermMemory: input.longTermMemory
      }) as object
    }
  });
  return (await prisma.actor.findUnique({ where: { id: actor.id } })) || actor;
}

async function loadWhyAssistantSettings() {
  const aiSettings = await loadAiSettings();
  const rows = await prisma.setting.findMany({
    where: { key: { in: ["whyAssistantEnabled", "whyAssistantPromptCommand", "whyAssistantWebSearchEnabled", "whyAssistantDisplayName", "whyAssistantModel", "whyAssistantThinkingEnabled"] } }
  });
  const settings = new Map(rows.map((row) => [row.key, row.value]));
  return {
    value: {
      ...aiSettings.value,
      enabled: settings.get("whyAssistantEnabled") !== "false",
      displayName: settings.get("whyAssistantDisplayName") || WHY_ASSISTANT_NAME,
      promptCommand: settings.get("whyAssistantPromptCommand") || DEFAULT_WHY_ASSISTANT_PROMPT,
      webSearchEnabled: settings.get("whyAssistantWebSearchEnabled") !== "false",
      model: normalizeRoleModel(settings.get("whyAssistantModel")) || aiSettings.value.model,
      thinkingEnabled: settings.get("whyAssistantThinkingEnabled") === "true"
    },
    encryptedApiKey: aiSettings.encryptedApiKey
  };
}

async function callWhyAssistant(settings: AiSettingsDTO & { webSearchEnabled?: boolean; thinkingEnabled?: boolean }, apiKey: string, contextText: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(`${settings.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [
          { role: "system", content: settings.promptCommand },
          {
            role: "user",
            content: [
              settings.webSearchEnabled ? "联网查询默认开启；如当前模型或接口没有联网工具，请明确标注资料来自模型知识、需要查证。" : "联网查询已关闭。",
              contextText
            ].join("\n\n")
          }
        ],
        thinking: { type: settings.thinkingEnabled ? "enabled" : "disabled" },
        stream: false
      }),
      signal: controller.signal
    });
    const payload = (await response.json().catch(() => ({}))) as any;
    if (!response.ok) throw new Error(String(payload?.error?.message || payload?.message || `AI HTTP ${response.status}`));
    const responseText = String(payload?.choices?.[0]?.message?.content || "").trim();
    if (!responseText) throw new Error("AI returned empty content");
    return responseText.slice(0, 5000);
  } finally {
    clearTimeout(timeout);
  }
}

async function buildWhyDirectAssistantContext(message: Message & { sender: Actor; channel: { name: string } }, assistant: Actor) {
  const rows = await prisma.message.findMany({
    where: {
      channelId: message.channelId,
      id: { lte: message.id },
      OR: [{ senderActorId: message.senderActorId }, { senderActorId: assistant.id }]
    },
    include: { sender: true },
    orderBy: { id: "desc" },
    take: 24
  });
  const historyLines = rows
    .reverse()
    .map((row) => `${row.senderActorId === assistant.id ? "为什么助手" : "用户"}：${plainTextFromHtml(row.content, 1200)}`)
    .filter(Boolean);
  return [
    `私聊频道：${message.channel.name}`,
    `发言人：${message.sender.displayName}`,
    "",
    "最近对话：",
    ...(historyLines.length ? historyLines : ["无"]),
    "",
    "请按为什么助手规则回应。"
  ].join("\n").slice(0, 12000);
}

async function maybeTriggerWhyDirectAssistant(messageId: number) {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: { sender: true, channel: { select: { name: true, directKey: true } } }
  });
  if (!message || message.type !== "text" || message.sender.kind !== "human") return;
  if (message.channel.directKey !== virtualDirectChannelKey(message.sender.accountId || 0, WHY_ASSISTANT_USERNAME)) return;
  const settings = await loadWhyAssistantSettings();
  const apiKey = decryptAiApiKey(settings.encryptedApiKey);
  if (!settings.value.enabled || !apiKey) return;
  const assistant = await ensureWhyAssistantCharacter(settings.value.displayName);
  const contextText = await buildWhyDirectAssistantContext(message, assistant);
  const responseText = await callWhyAssistant(settings.value, apiKey, contextText);
  await createMessageFromActor({
    channelId: message.channelId,
    actorId: assistant.id,
    content: responseText,
    type: "text",
    replyToId: message.id,
    payload: { contentFormat: "markdown", aiRole: WHY_ASSISTANT_USERNAME, triggerMessageId: message.id },
    skipEngineEvent: true,
    skipQuestionAssistant: true
  });
}

async function loadQuestionAssistantSettings() {
  const aiSettings = await loadAiSettings();
  const rows = await prisma.setting.findMany({
    where: {
      key: {
        in: [
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
        ]
      }
    }
  });
  const settings = new Map(rows.map((row) => [row.key, row.value]));
  return {
    value: {
      ...aiSettings.value,
      enabled: settings.get("questionAssistantEnabled") !== "false",
      questionTriggerEnabled: settings.get("questionAssistantTriggerEnabled") !== "false",
      displayName: settings.get("questionAssistantDisplayName") || QUESTION_ASSISTANT_NAME,
      promptCommand: settings.get("questionAssistantPromptCommand") || DEFAULT_QUESTION_ASSISTANT_PROMPT,
      activationJudgePrompt: settings.get("questionAssistantActivationJudgePrompt") || DEFAULT_QUESTION_ASSISTANT_JUDGE_PROMPT,
      webSearchEnabled: settings.get("questionAssistantWebSearchEnabled") !== "false",
      model: normalizeRoleModel(settings.get("questionAssistantModel")) || aiSettings.value.model,
      thinkingEnabled: settings.get("questionAssistantThinkingEnabled") === "true",
      contextTurnLimit: clampInteger(settings.get("questionAssistantContextTurnLimit"), DEFAULT_QUESTION_ASSISTANT_CONTEXT_TURNS, 1, 50),
      contextWindowMinutes: clampInteger(settings.get("questionAssistantContextWindowMinutes"), DEFAULT_QUESTION_ASSISTANT_CONTEXT_WINDOW_MINUTES, 1, 1440)
    },
    encryptedApiKey: aiSettings.encryptedApiKey
  };
}

type QuestionAssistantActivationMode = "strong" | "direct" | "weak";

function questionAssistantDirectActivation(content?: string | null, displayName?: string | null): "strong" | "direct" | null {
  const text = plainTextFromHtml(content, 4000);
  if (!text) return null;
  if (/@\s*ai_slmm\b/i.test(text)) return "direct";
  const name = String(displayName || "").trim();
  if (name && name !== QUESTION_ASSISTANT_USERNAME) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`@\\s*${escapedName}`).test(text) || text.includes(name)) return "direct";
  }
  if (/[?？]/.test(text)) return "strong";
  const sentences = text
    .split(/[。.!！?？；;\n\r]+/)
    .map((sentence) => sentence.replace(/[，,、：:\s"'“”‘’（）()[\]{}]+$/g, "").trim())
    .filter(Boolean);
  return sentences.some((sentence) => /(吗|嘛|为啥|为什么)$/.test(sentence)) ? "strong" : null;
}

function messagePayloadRecord(message: Pick<Message, "payload">) {
  return message.payload && typeof message.payload === "object" && !Array.isArray(message.payload) ? (message.payload as Record<string, unknown>) : {};
}

async function buildQuestionAssistantContext(
  message: Message & { sender: Actor; channel: { name: string } },
  assistant: Actor,
  settings: AiSettingsDTO & { displayName?: string; contextTurnLimit?: number; contextWindowMinutes?: number },
  activationMode: QuestionAssistantActivationMode,
  activationAnchor?: Message | null
) {
  const contextTurnLimit = clampInteger(settings.contextTurnLimit, DEFAULT_QUESTION_ASSISTANT_CONTEXT_TURNS, 1, 50);
  const contextWindowMinutes = clampInteger(settings.contextWindowMinutes, DEFAULT_QUESTION_ASSISTANT_CONTEXT_WINDOW_MINUTES, 1, 1440);
  const cutoff = new Date(message.createdAt.getTime() - contextWindowMinutes * 60 * 1000);
  const rows = (
    await prisma.message.findMany({
      where: {
        channelId: message.channelId,
        createdAt: { gte: cutoff, lte: message.createdAt },
        OR: [{ senderActorId: message.senderActorId }, { senderActorId: assistant.id }]
      },
      include: { sender: true },
      orderBy: { id: "desc" },
      take: 500
    })
  ).reverse();
  type Round = { user: Message & { sender: Actor }; assistant?: Message & { sender: Actor } };
  const rounds: Round[] = [];
  const roundByTriggerId = new Map<number, Round>();
  const userRowsById = new Map<number, Message & { sender: Actor }>();
  for (const row of rows) {
    if (row.senderActorId === message.senderActorId) {
      userRowsById.set(row.id, row);
      if (row.id === message.id) {
        const round = { user: row };
        rounds.push(round);
        roundByTriggerId.set(row.id, round);
      }
    }
  }
  for (const row of rows) {
    if (row.senderActorId !== assistant.id) continue;
    const payload = messagePayloadRecord(row);
    if (payload.aiRole !== QUESTION_ASSISTANT_USERNAME) continue;
    const triggerMessageId = Number(payload.triggerMessageId || 0);
    let round = roundByTriggerId.get(triggerMessageId);
    const user = userRowsById.get(triggerMessageId);
    if (!round && user) {
      round = { user };
      rounds.push(round);
      roundByTriggerId.set(triggerMessageId, round);
    }
    if (round) round.assistant = row;
  }
  rounds.sort((left, right) => left.user.id - right.user.id);
  const scopedRounds = rounds.slice(-contextTurnLimit);
  const historyLines = scopedRounds.flatMap((round, index) => {
    const prefix = `第 ${index + 1} 轮`;
    return [
      `${prefix} 用户：${plainTextFromHtml(round.user.content, 1200)}`,
      round.assistant ? `${prefix} ${assistant.displayName}：${plainTextFromHtml(round.assistant.content, 1200)}` : ""
    ].filter(Boolean);
  });
  const lines = [
    `频道：${message.channel.name}`,
    `发言人：${message.sender.displayName}`,
    `激活方式：${activationMode === "strong" ? "强激活" : activationMode === "direct" ? "用户点名" : "弱激活"}`,
    activationAnchor ? `最近强激活问题：${plainTextFromHtml(activationAnchor.content, 1600)}` : "",
    `上下文范围：同一频道、同一发言人、同一虚拟角色；最近 ${contextTurnLimit} 轮，且只包含 ${contextWindowMinutes} 分钟内的对话。`,
    `消息：${plainTextFromHtml(message.content, 4000)}`,
    "",
    "最近对话上下文：",
    ...(historyLines.length ? historyLines : ["无"]),
    "",
    "请作为 ai_slmm 在同一频道回复这条消息。"
  ];
  return lines.filter(Boolean).join("\n").slice(0, 12000);
}

async function callQuestionAssistant(settings: AiSettingsDTO & { webSearchEnabled?: boolean; thinkingEnabled?: boolean }, apiKey: string, contextText: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(`${settings.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [
          { role: "system", content: settings.promptCommand },
          {
            role: "user",
            content: [
              settings.webSearchEnabled ? "联网查询默认开启；如当前模型或接口没有联网工具，请明确标注资料来自模型知识、需要查证。" : "联网查询已关闭。",
              contextText
            ].join("\n\n")
          }
        ],
        thinking: { type: settings.thinkingEnabled ? "enabled" : "disabled" },
        stream: false
      }),
      signal: controller.signal
    });
    const payload = (await response.json().catch(() => ({}))) as any;
    if (!response.ok) throw new Error(String(payload?.error?.message || payload?.message || `AI HTTP ${response.status}`));
    const responseText = String(payload?.choices?.[0]?.message?.content || "").trim();
    if (!responseText) throw new Error("AI returned empty content");
    return responseText.slice(0, 5000);
  } finally {
    clearTimeout(timeout);
  }
}

async function findQuestionAssistantActivationAnchor(
  message: Message & { sender: Actor; channel: { name: string } },
  settings: AiSettingsDTO & { displayName?: string; questionTriggerEnabled?: boolean; contextWindowMinutes?: number }
) {
  const contextWindowMinutes = clampInteger(settings.contextWindowMinutes, DEFAULT_QUESTION_ASSISTANT_CONTEXT_WINDOW_MINUTES, 1, 1440);
  const cutoff = new Date(message.createdAt.getTime() - contextWindowMinutes * 60 * 1000);
  const rows = await prisma.message.findMany({
    where: {
      channelId: message.channelId,
      senderActorId: message.senderActorId,
      type: "text",
      id: { lt: message.id },
      createdAt: { gte: cutoff }
    },
    orderBy: { id: "desc" },
    take: 100
  });
  return rows.find((row) => {
    const activation = questionAssistantDirectActivation(row.content, settings.displayName);
    if (activation === "strong" && !settings.questionTriggerEnabled) return false;
    return activation === "strong" || activation === "direct";
  });
}

function buildQuestionAssistantJudgeContext(
  message: Message & { sender: Actor; channel: { name: string } },
  anchor: Message,
  assistant: Actor,
  settings: AiSettingsDTO & { displayName?: string; contextTurnLimit?: number; contextWindowMinutes?: number }
) {
  const contextWindowMinutes = clampInteger(settings.contextWindowMinutes, DEFAULT_QUESTION_ASSISTANT_CONTEXT_WINDOW_MINUTES, 1, 1440);
  const lines = [
    `频道：${message.channel.name}`,
    `发言人：${message.sender.displayName}`,
    `虚拟助手：${assistant.displayName} (@${assistant.username})`,
    `弱激活有效分钟数：${contextWindowMinutes}`,
    `最近强激活问题：${plainTextFromHtml(anchor.content, 2000)}`,
    `当前用户发言：${plainTextFromHtml(message.content, 2000)}`,
    "",
    "请判断当前用户发言是否仍在延续最近强激活问题，是否应该交给虚拟助手回复。"
  ];
  return lines.join("\n").slice(0, 8000);
}

async function callQuestionAssistantActivationJudge(
  settings: AiSettingsDTO & { activationJudgePrompt?: string },
  apiKey: string,
  contextText: string
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${settings.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [
          { role: "system", content: settings.activationJudgePrompt || DEFAULT_QUESTION_ASSISTANT_JUDGE_PROMPT },
          { role: "user", content: contextText }
        ],
        thinking: { type: "disabled" },
        stream: false
      }),
      signal: controller.signal
    });
    const payload = (await response.json().catch(() => ({}))) as any;
    if (!response.ok) throw new Error(String(payload?.error?.message || payload?.message || `AI HTTP ${response.status}`));
    const responseText = String(payload?.choices?.[0]?.message?.content || "").trim().toLowerCase();
    return /^(yes|y|true|需要|是|回复|交给)\b/.test(responseText);
  } finally {
    clearTimeout(timeout);
  }
}

async function maybeTriggerQuestionAssistant(messageId: number) {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: { sender: true, channel: { select: { id: true, name: true, isPrivate: true, directKey: true } } }
  });
  if (!message || message.type !== "text" || message.sender.kind !== "human") return;
  if (message.channel.directKey === virtualDirectChannelKey(message.sender.accountId || 0, WHY_ASSISTANT_USERNAME)) return;
  const settings = await loadQuestionAssistantSettings();
  const directActivation = questionAssistantDirectActivation(message.content, settings.value.displayName);
  const apiKey = decryptAiApiKey(settings.encryptedApiKey);
  if (!settings.value.enabled || !apiKey) return;
  let activationMode: QuestionAssistantActivationMode | null = directActivation;
  let activationAnchor: Message | null | undefined = directActivation ? message : null;
  if (activationMode === "strong" && !settings.value.questionTriggerEnabled) return;
  const assistant = await ensureAiRoleCharacter(QUESTION_ASSISTANT_USERNAME, QUESTION_ASSISTANT_NAME, settings.value.displayName);
  const assistantCharacter = await prisma.virtualCharacter.findUnique({ where: { actorId: assistant.id }, select: { config: true } });
  if (!virtualCharacterVisibleInChannel(message.channel, { username: QUESTION_ASSISTANT_USERNAME, config: assistantCharacter?.config })) return;
  if (!activationMode) {
    activationAnchor = await findQuestionAssistantActivationAnchor(message, settings.value);
    if (!activationAnchor) return;
    const judgeContext = buildQuestionAssistantJudgeContext(message, activationAnchor, assistant, settings.value);
    const shouldReply = await callQuestionAssistantActivationJudge(settings.value, apiKey, judgeContext);
    if (!shouldReply) return;
    activationMode = "weak";
  }
  const contextText = await buildQuestionAssistantContext(message, assistant, settings.value, activationMode, activationAnchor);
  const responseText = await callQuestionAssistant(settings.value, apiKey, contextText);
  await createMessageFromActor({
    channelId: message.channelId,
    actorId: assistant.id,
    content: responseText,
    type: "text",
    replyToId: message.id,
    payload: {
      contentFormat: "markdown",
      aiRole: QUESTION_ASSISTANT_USERNAME,
      aiActivationMode: activationMode,
      triggerMessageId: message.id,
      activationAnchorMessageId: activationAnchor?.id || message.id
    },
    skipEngineEvent: true,
    skipQuestionAssistant: true
  });
}

function decodeBasicHtmlEntities(input: string) {
  return input
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function pinnedPlainTextFromHtml(input?: string | null) {
  return decodeBasicHtmlEntities(
    String(input || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p\s*>/gi, "\n")
      .replace(/<[^>]*>/g, "")
  )
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanPinnedText(input: unknown) {
  return String(input || "").replace(/\r\n/g, "\n").trim().slice(0, 20000);
}

function cleanPinnedTitle(input: unknown) {
  return String(input || "").trim().slice(0, 160);
}

function pinnedBlockId() {
  return crypto.randomBytes(6).toString("hex");
}

function appendPinnedTextBlock(blocks: PinnedContentBlockDTO[], text: string) {
  const cleaned = cleanPinnedText(text);
  if (!cleaned) return;
  const previous = blocks[blocks.length - 1];
  if (previous?.type === "text") {
    previous.text = [previous.text, cleaned].filter(Boolean).join("\n");
  } else {
    blocks.push({ id: pinnedBlockId(), type: "text", text: cleaned });
  }
}

function serializePinnedBody(input: unknown, fallbackContent?: string | null): PinnedBodyDTO {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? (input as { blocks?: unknown }) : null;
  const blocks: PinnedContentBlockDTO[] = [];
  if (Array.isArray(raw?.blocks)) {
    for (const block of raw.blocks) {
      const row = block && typeof block === "object" ? (block as Record<string, unknown>) : {};
      const id = String(row.id || pinnedBlockId()).slice(0, 40);
      if (row.type === "text") {
        const text = cleanPinnedText(row.text);
        if (text) blocks.push({ id, type: "text", text });
      } else if (row.type === "image" || row.type === "file") {
        const filePath = path.basename(String(row.filePath || ""));
        if (!filePath) continue;
        blocks.push({
          id,
          type: row.type,
          fileName: String(row.fileName || filePath).slice(0, 255),
          filePath,
          fileSize: Number.isFinite(Number(row.fileSize)) ? Number(row.fileSize) : null
        });
      }
    }
  }
  if (!blocks.length) appendPinnedTextBlock(blocks, pinnedPlainTextFromHtml(fallbackContent));
  return { blocks };
}

function pinnedBodyPreview(body: PinnedBodyDTO, title?: string | null) {
  const text = body.blocks
    .map((block) => (block.type === "text" ? block.text : block.type === "image" ? "[图片]" : block.fileName || "[文件]"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return stripPushText(title || text || "新的置顶消息");
}

function pinnedBodyUploadFilePaths(body: PinnedBodyDTO) {
  return new Set(body.blocks.flatMap((block) => (block.type === "image" || block.type === "file" ? [path.basename(block.filePath)] : [])));
}

function pinnedBlocksFromMessage(message: Message): PinnedContentBlockDTO[] {
  const blocks: PinnedContentBlockDTO[] = [];
  if (message.type === "system") return blocks;
  if (message.type === "chain") {
    const payload = message.payload && typeof message.payload === "object" && !Array.isArray(message.payload) ? (message.payload as Partial<ChainPayload>) : {};
    const participants = Array.isArray(payload.participants) ? payload.participants : [];
    appendPinnedTextBlock(
      blocks,
      [`接龙：${payload.topic || pinnedPlainTextFromHtml(message.content) || "接龙"}`, ...participants.map((item, index) => `${index + 1}. ${item.name}${item.text ? `：${item.text}` : ""}`)].join("\n")
    );
    return blocks;
  }
  if (message.type === "prayer") {
    const payload = message.payload && typeof message.payload === "object" && !Array.isArray(message.payload) ? (message.payload as { status?: unknown }) : {};
    const status = payload.status === "closed" ? "无需再代祷" : payload.status === "answered" ? "已蒙应允" : "代祷中";
    appendPinnedTextBlock(blocks, `代祷事项（${status}）：${pinnedPlainTextFromHtml(message.content) || "代祷事项"}`);
    return blocks;
  }
  const text = pinnedPlainTextFromHtml(message.content);
  if (text) appendPinnedTextBlock(blocks, text);
  if ((message.type === "image" || message.type === "file") && message.filePath) {
    blocks.push({
      id: pinnedBlockId(),
      type: message.type === "image" ? "image" : "file",
      fileName: message.fileName || path.basename(message.filePath),
      filePath: path.basename(message.filePath),
      fileSize: message.fileSize || null
    });
  }
  return blocks;
}

async function pinnedBodyFromMessages(channelId: number, messageIds: number[]) {
  const messages = await prisma.message.findMany({
    where: { id: { in: messageIds }, channelId, type: { not: "system" } },
    orderBy: { id: "asc" }
  });
  const blocks: PinnedContentBlockDTO[] = [];
  for (const message of messages) {
    for (const block of pinnedBlocksFromMessage(message)) {
      if (block.type === "text") appendPinnedTextBlock(blocks, block.text);
      else blocks.push(block);
    }
  }
  return serializePinnedBody({ blocks });
}

async function serializePinnedItem(pin: PinnedItem, viewer?: Pick<AuthContext, "accountId">) {
  const body = serializePinnedBody(pin.body, pin.content);
  const dismissed = viewer
    ? !!(await prisma.pinnedSeen.findUnique({
        where: { accountId_pinnedItemId_pinnedVersion: { accountId: viewer.accountId, pinnedItemId: pin.id, pinnedVersion: pin.version } },
        select: { id: true }
      }))
    : false;
  return {
    id: pin.id,
    kind: pin.kind,
    title: pin.title,
    content: pin.content,
    body,
    messageId: pin.messageId,
    message: pin.messageId ? await hydrateMessage(pin.messageId, viewer?.accountId) : null,
    version: pin.version,
    dismissed
  };
}

async function emitMessage(messageId: number) {
  const dto = await hydrateMessage(messageId);
  if (dto) io.to(`ch:${dto.channelId}`).emit("message:new", dto);
  return dto;
}

function stripPushText(input?: string | null) {
  return String(input || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function messagePushBody(message: Message & { sender: Actor }) {
  if (message.type === "chain") return `${message.sender.displayName} 发起了接龙：${stripPushText(message.content) || "接龙"}`;
  if (message.type === "prayer") return `${message.sender.displayName} 发起代祷：${stripPushText(message.content) || "代祷事项"}`;
  if (message.type === "image") return `${message.sender.displayName} 发来一张图片`;
  if (isVoiceMessage(message)) return `${message.sender.displayName} 发来一条语音`;
  if (message.type === "file") return `${message.sender.displayName} 发来文件：${message.fileName || "文件"}`;
  return `${message.sender.displayName}：${stripPushText(message.content) || "新消息"}`;
}

async function ensureWebPush() {
  if (!PUSH_NOTIFICATIONS_ENABLED) {
    app.log.warn("web push disabled by PUSH_NOTIFICATIONS_ENABLED");
    vapidPublicKey = "";
    pushReady = false;
    return;
  }
  const envPublicKey = process.env.VAPID_PUBLIC_KEY || process.env.WEB_PUSH_PUBLIC_KEY || "";
  const envPrivateKey = process.env.VAPID_PRIVATE_KEY || process.env.WEB_PUSH_PRIVATE_KEY || "";
  let publicKey = envPublicKey;
  let privateKey = envPrivateKey;
  if (!publicKey || !privateKey) {
    const rows = await prisma.setting.findMany({ where: { key: { in: ["webPushVapidPublicKey", "webPushVapidPrivateKey"] } } });
    const settings = new Map(rows.map((row) => [row.key, row.value]));
    publicKey = settings.get("webPushVapidPublicKey") || "";
    privateKey = settings.get("webPushVapidPrivateKey") || "";
    if (!publicKey || !privateKey) {
      const generated = webPush.generateVAPIDKeys();
      publicKey = generated.publicKey;
      privateKey = generated.privateKey;
      await Promise.all([setSetting("webPushVapidPublicKey", publicKey), setSetting("webPushVapidPrivateKey", privateKey)]);
    }
  }
  if (!publicKey || !privateKey) {
    app.log.warn("web push disabled: missing VAPID keys");
    return;
  }
  webPush.setVapidDetails(VAPID_SUBJECT, publicKey, privateKey);
  vapidPublicKey = publicKey;
  pushReady = true;
}

async function notificationRecipientIds(channelId: number, senderAccountId?: number | null, force = false) {
  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { id: true, name: true, isPrivate: true, directKey: true, kind: true } });
  if (!channel) return [];
  const where = channelNeedsExplicitMembership(channel) ? { memberships: { some: { channelId } } } : {};
  const accounts = await prisma.account.findMany({ where, select: { id: true } });
  let ids = accounts.map((account) => account.id).filter((id) => id !== senderAccountId);
  if (!force && ids.length) {
    const muted = await prisma.channelNotificationPreference.findMany({
      where: { channelId, accountId: { in: ids }, muted: true },
      select: { accountId: true }
    });
    const mutedIds = new Set(muted.map((row) => row.accountId));
    ids = ids.filter((id) => !mutedIds.has(id));
  }
  return ids;
}

async function sendPushToAccounts(accountIds: number[], payload: { title: string; body: string; url: string; tag: string; channelId: number }, origin: string) {
  if (!pushReady || !accountIds.length || !origin) return;
  const subscriptions = await prisma.pushSubscription.findMany({ where: { accountId: { in: accountIds }, origin } });
  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webPush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.keysP256dh, auth: subscription.keysAuth }
          },
          JSON.stringify(payload)
        );
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await prisma.pushSubscription.deleteMany({ where: { endpoint: subscription.endpoint } });
        } else {
          app.log.warn({ error }, "web push notification failed");
        }
      }
    })
  );
}

async function sendMessagePush(messageId: number, origin: string) {
  const message = await prisma.message.findUnique({ where: { id: messageId }, include: { sender: true, channel: true } });
  if (!message) return;
  if (message.type === "why_topic_card" || message.channel.kind === "why") return;
  const accountIds = await notificationRecipientIds(message.channelId, message.sender.accountId, false);
  await sendPushToAccounts(accountIds, {
    title: message.channel.name,
    body: messagePushBody(message),
    url: `/?channelId=${message.channelId}`,
    tag: `channel-${message.channelId}`,
    channelId: message.channelId
  }, origin);
}

async function sendLikePush(accountId: number, channelId: number, messageId: number, likerName: string, origin: string) {
  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { name: true } });
  if (!channel) return;
  await sendPushToAccounts([accountId], {
    title: "消息被点赞",
    body: `${likerName}点赞了你在「${channel.name}」中的消息`,
    url: `/?channelId=${channelId}`,
    tag: `message-like-${messageId}`,
    channelId
  }, origin);
}

async function sendAdminBroadcastPush(channelId: number, content: string, origin: string) {
  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { name: true } });
  if (!channel) return;
  const accountIds = await notificationRecipientIds(channelId, null, true);
  await sendPushToAccounts(accountIds, {
    title: `管理员广播 · ${channel.name}`,
    body: stripPushText(content) || "新的管理员广播",
    url: `/?channelId=${channelId}`,
    tag: `admin-broadcast-${channelId}`,
    channelId
  }, origin);
}

async function sendPinnedPush(channelId: number, pinned: { title?: string | null; body: PinnedBodyDTO }, origin: string) {
  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { name: true } });
  if (!channel) return;
  const accountIds = await notificationRecipientIds(channelId, null, true);
  await sendPushToAccounts(accountIds, {
    title: `新置顶 · ${channel.name}`,
    body: pinnedBodyPreview(pinned.body, pinned.title),
    url: `/?channelId=${channelId}`,
    tag: `pinned-${channelId}`,
    channelId
  }, origin);
}

async function sendPrayerUpdatePush(messageId: number, origin: string) {
  const message = await prisma.message.findUnique({ where: { id: messageId }, include: { sender: true, channel: true } });
  if (!message || message.type !== "prayer") return;
  const accountIds = await notificationRecipientIds(message.channelId, null, true);
  await sendPushToAccounts(accountIds, {
    title: `代祷最新动态 · ${message.channel.name}`,
    body: `${message.sender.displayName} 更新代祷：${stripPushText(message.content) || "代祷事项"}`,
    url: `/?channelId=${message.channelId}`,
    tag: `prayer-update-${message.channelId}-${sourcePrayerMessageId(message.payload, message.id)}`,
    channelId: message.channelId
  }, origin);
}

async function createEngineEvent(kind: "message_created" | "idle_tick" | "manual_test" | "active_topic_due", payload: unknown, channelId?: number, messageId?: number, characterId?: number) {
  const event = await prisma.engineEvent.create({
    data: {
      kind,
      channelId,
      messageId,
      characterId,
      payload: payload as object
    }
  });
  io.emit("engine:event", { id: event.id, kind: event.kind, channelId, messageId, characterId });
}

async function broadcastPresence() {
  const unique = [...new Map([...online.values()].map((u) => [u.accountId, u])).values()];
  io.emit("presence:updated", unique);
}

function musicListenersSnapshot() {
  return [...musicListeners.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .filter((listener, index, all) => all.findIndex((candidate) => candidate.accountId === listener.accountId) === index)
    .map(({ updatedAt: _updatedAt, ...listener }) => listener);
}

function broadcastMusicListeners() {
  io.emit("music:listeners", musicListenersSnapshot());
}

function bibleReadersSnapshot() {
  return [...bibleReaders.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .filter((reader, index, all) => all.findIndex((candidate) => candidate.accountId === reader.accountId) === index)
    .map(({ updatedAt: _updatedAt, ...reader }) => reader);
}

function broadcastBibleReaders() {
  io.emit("bible:readers", bibleReadersSnapshot());
}

function friendListenersSnapshot() {
  return [...friendListeners.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .filter((listener, index, all) => all.findIndex((candidate) => candidate.accountId === listener.accountId) === index)
    .map(({ updatedAt: _updatedAt, ...listener }) => listener);
}

function broadcastFriendListeners() {
  io.emit("friend:listeners", friendListenersSnapshot());
}

let musicListenerCleanupTimer: NodeJS.Timeout | undefined;
let bibleReaderCleanupTimer: NodeJS.Timeout | undefined;
let friendListenerCleanupTimer: NodeJS.Timeout | undefined;
let friendFeedRefreshTimer: NodeJS.Timeout | undefined;

function startCleanupTimers() {
  musicListenerCleanupTimer = setInterval(() => {
    const staleBefore = Date.now() - 45_000;
    let changed = false;
    for (const [socketId, listener] of musicListeners) {
      if (listener.updatedAt >= staleBefore) continue;
      musicListeners.delete(socketId);
      changed = true;
    }
    if (changed) broadcastMusicListeners();
  }, 15_000);
  musicListenerCleanupTimer.unref();

  bibleReaderCleanupTimer = setInterval(() => {
    const staleBefore = Date.now() - 45_000;
    let changed = false;
    for (const [socketId, reader] of bibleReaders) {
      if (reader.updatedAt >= staleBefore) continue;
      bibleReaders.delete(socketId);
      changed = true;
    }
    if (changed) broadcastBibleReaders();
  }, 15_000);
  bibleReaderCleanupTimer.unref();

  friendListenerCleanupTimer = setInterval(() => {
    const staleBefore = Date.now() - 45_000;
    let changed = false;
    for (const [socketId, listener] of friendListeners) {
      if (listener.updatedAt >= staleBefore) continue;
      friendListeners.delete(socketId);
      changed = true;
    }
    if (changed) broadcastFriendListeners();
  }, 15_000);
  friendListenerCleanupTimer.unref();

  scheduleFriendFeedRefresh();
}

/** 节目单定时刷新：本地 7:00 / 19:00 各刷一次，失败留待下一次 */
function scheduleFriendFeedRefresh() {
  const delay = Math.max(1_000, nextFriendFeedRefreshAt(Date.now()) - Date.now());
  friendFeedRefreshTimer = setTimeout(() => {
    void friendFeedService.refreshAll().catch((error) => app.log.warn({ error }, "friend feed refresh failed"));
    scheduleFriendFeedRefresh();
  }, delay);
  friendFeedRefreshTimer.unref();
}

function disconnectSessions(sessionIds: string[]) {
  const targets = new Set(sessionIds);
  if (!targets.size) return;
  invalidateAuthSessionCacheBySessionIds([...targets]);
  for (const socket of io.sockets.sockets.values()) {
    const auth = socket.data.auth as AuthContext | undefined;
    if (auth?.sessionId && targets.has(auth.sessionId)) socket.disconnect(true);
  }
}

const AUTH_SESSION_CACHE_TTL_MS = 30_000;
const AUTH_SESSION_CACHE_LIMIT = 1000;

// Positive identity/session lookups cached briefly per session; negative
// results always re-check. Every session-revoking path funnels through
// disconnectSessions (or createAuthSession below), which drops the cache.
const authSessionCache = new Map<string, { account: AccountWithActor; session: AccountSession; expiresAt: number }>();

function invalidateAuthSessionCacheBySessionIds(sessionIds: string[]) {
  if (!sessionIds.length) return;
  const targets = new Set(sessionIds);
  for (const [key] of authSessionCache) {
    if (targets.has(key.slice(key.indexOf(":") + 1))) authSessionCache.delete(key);
  }
}

async function refreshSocketAuth(socket: Socket) {
  const token = typeof socket.data.token === "string" ? socket.data.token : "";
  try {
    const auth = await verifyJwtToken(token);
    socket.data.auth = auth;
    return auth;
  } catch {
    socket.disconnect(true);
    return null;
  }
}

function refreshAccountConnections(account: AccountWithActor) {
  io.to(`acct:${account.id}`).emit("account:updated", authDto(account));
  for (const socketId of accountSocketIds.get(account.id) || []) {
    io.sockets.sockets.get(socketId)?.disconnect(true);
  }
}

function sessionExpiresAt(now = new Date()) {
  return new Date(now.getTime() + SESSION_TTL_MS);
}

async function ensureLoginLogTable() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS account_login_logs (
      id INT NOT NULL AUTO_INCREMENT,
      kind VARCHAR(32) NOT NULL,
      account_id INT NOT NULL,
      session_id VARCHAR(64) NULL,
      device_kind VARCHAR(16) NULL,
      device_name VARCHAR(120) NULL,
      ip_address VARCHAR(64) NULL,
      user_agent TEXT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      INDEX account_login_logs_created_at_idx (created_at),
      INDEX account_login_logs_account_id_idx (account_id)
    )
  `;
}

async function ensureActivityLogTable() {
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS account_activity_logs (
      id INT NOT NULL AUTO_INCREMENT,
      kind VARCHAR(48) NOT NULL,
      account_id INT NOT NULL,
      session_id VARCHAR(64) NULL,
      channel_id INT NULL,
      track_id INT NULL,
      playback_id CHAR(36) NULL,
      device_kind VARCHAR(16) NULL,
      device_name VARCHAR(120) NULL,
      ip_address VARCHAR(64) NULL,
      user_agent TEXT NULL,
      app_version VARCHAR(32) NULL,
      latest_version VARCHAR(32) NULL,
      is_latest_version BOOLEAN NULL,
      event_state VARCHAR(32) NULL,
      progress_ms INT NULL,
      listened_ms INT NULL,
      duration_ms INT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      INDEX account_activity_logs_created_at_idx (created_at),
      INDEX account_activity_logs_account_created_idx (account_id, created_at),
      INDEX account_activity_logs_kind_created_idx (kind, created_at),
      INDEX account_activity_logs_track_created_idx (track_id, created_at),
      INDEX account_activity_logs_playback_created_idx (playback_id, created_at)
    )
  `;
}

async function writeActivityLog(input: ActivityLogInput) {
  const createdAt = input.createdAt || new Date();
  await prisma
    .$executeRaw`
      INSERT INTO account_activity_logs (
        kind, account_id, session_id, channel_id, track_id, playback_id, device_kind, device_name, ip_address, user_agent,
        app_version, latest_version, is_latest_version, event_state, progress_ms, listened_ms, duration_ms, created_at
      ) VALUES (
        ${input.kind}, ${input.accountId}, ${input.sessionId || null}, ${input.channelId || null}, ${input.trackId || null}, ${input.playbackId || null},
        ${input.deviceKind || null}, ${input.deviceName || null}, ${input.ipAddress || null}, ${input.userAgent || null},
        ${input.appVersion || null}, ${input.latestVersion || null}, ${input.isLatestVersion ?? null}, ${input.state || null},
        ${input.progressMs ?? null}, ${input.listenedMs ?? null}, ${input.durationMs ?? null}, ${createdAt}
      )
    `
    .catch((error) => app.log.warn({ error, kind: input.kind, accountId: input.accountId }, "Failed to write activity log"));
}

async function writeLoginLog(
  kind: AdminLoginLogKind,
  accountId: number,
  session?: LoginLogSession | null,
  createdAt = new Date(),
  options: Pick<ActivityLogInput, "appVersion" | "durationMs"> = {}
) {
  const appVersion = options.appVersion || null;
  await writeActivityLog({
    kind,
    accountId,
    sessionId: session?.id || null,
    deviceKind: session?.deviceKind || null,
    deviceName: session?.deviceName || null,
    ipAddress: session?.ipAddress || null,
    userAgent: session?.userAgent || null,
    appVersion,
    latestVersion: kind === "auth_login" ? APP_VERSION : null,
    isLatestVersion: kind === "auth_login" && appVersion ? appVersion === APP_VERSION : null,
    durationMs: options.durationMs,
    createdAt
  });
}

async function createAuthSession(accountId: number, request: FastifyRequest, deviceNameOverride?: string, appVersion?: string) {
  const now = new Date();
  const deviceKind = detectDeviceKind(String(request.headers["user-agent"] || ""));
  const deviceName = deviceNameFromRequest(request, deviceNameOverride);
  const replacedSessions = await prisma.accountSession.findMany({
    where: { accountId, deviceKind, revokedAt: null },
    select: { id: true, deviceKind: true, deviceName: true, ipAddress: true, userAgent: true }
  });
  const session = await prisma.$transaction(async (tx) => {
    await tx.accountSession.updateMany({
      where: { id: { in: replacedSessions.map((row) => row.id) } },
      data: { revokedAt: now }
    });
    await tx.account.update({ where: { id: accountId }, data: { lastLoginAt: now } });
    return tx.accountSession.create({
      data: {
        id: crypto.randomUUID(),
        accountId,
        deviceKind,
        deviceName,
        userAgent: String(request.headers["user-agent"] || "").slice(0, 1000),
        ipAddress: clientIp(request),
        lastSeenAt: now,
        expiresAt: sessionExpiresAt(now)
      }
    });
  });
  disconnectSessions(replacedSessions.map((row) => row.id));
  await Promise.all([
    writeLoginLog("auth_login", accountId, session, now, { appVersion }),
    ...replacedSessions.map((row) => writeLoginLog("session_replaced", accountId, row, now))
  ]);
  return session;
}

function joinAccountChannel(accountId: number, channelId: number) {
  for (const socketId of accountSocketIds.get(accountId) || []) {
    io.sockets.sockets.get(socketId)?.join(`ch:${channelId}`);
  }
}

function leaveAccountChannel(accountId: number, channelId: number) {
  for (const socketId of accountSocketIds.get(accountId) || []) {
    io.sockets.sockets.get(socketId)?.leave(`ch:${channelId}`);
  }
}

async function emitChannelMembersChanged(channelId: number, action: string, affectedAccountIds: number[] = []) {
  const dto = await channelDto(channelId);
  const memberRows = await prisma.channelMember.findMany({ where: { channelId }, select: { accountId: true } });
  const recipients = new Set([...memberRows.map((row) => row.accountId), ...affectedAccountIds]);
  io.to(`ch:${channelId}`).emit("channel:updated", { action, channel: dto });
  for (const accountId of recipients) io.to(`acct:${accountId}`).emit("channel:updated", { action, channel: dto });
  return dto;
}

async function ensureBootstrap() {
  await Promise.all([ensureLoginLogTable(), ensureActivityLogTable()]);
  const defaultChannel = await prisma.channel.findFirst({ where: { isDefault: true } });
  if (!defaultChannel) {
    await prisma.channel.create({ data: { name: "综合频道", description: "默认公开频道", isDefault: true } });
  }
  const musicChannel = await prisma.channel.findFirst({ where: { kind: "music" } });
  const musicChannelData = { name: MUSIC_CHANNEL_NAME, description: "所有成员均可上传音乐；管理员和户部尚书可管理全部内容", icon: MUSIC_CHANNEL_ICON, isPrivate: false, isDefault: false, directKey: null };
  if (musicChannel) await prisma.channel.update({ where: { id: musicChannel.id }, data: musicChannelData });
  else await prisma.channel.create({ data: { kind: "music", ...musicChannelData } });
  const aiLoungeChannel = await prisma.channel.findFirst({ where: { kind: "aiLounge" } });
  if (aiLoungeChannel && !aiLoungeChannel.isPrivate) {
    await prisma.channel.update({ where: { id: aiLoungeChannel.id }, data: { isPrivate: true } });
  }
  const accountCount = await prisma.account.count();
  if (accountCount === 0) {
    if (IS_PRODUCTION && (!process.env.DEFAULT_ADMIN_PASSWORD || process.env.DEFAULT_ADMIN_PASSWORD.length < 12)) {
      throw new Error("DEFAULT_ADMIN_PASSWORD must be set to at least 12 characters for first production startup");
    }
    const password = process.env.DEFAULT_ADMIN_PASSWORD || "ChangeMe123!";
    const passwordHash = await bcrypt.hash(password, 12);
    await prisma.account.create({
      data: {
        username: "admin",
        passwordHash,
        displayName: "管理员",
        role: "admin",
        actor: { create: { kind: "human", username: "admin", displayName: "管理员" } }
      }
    });
    app.log.warn("Created default admin account. Change DEFAULT_ADMIN_PASSWORD before public use.");
  }
}

async function channelDto(channelId: number, viewer?: Pick<AuthContext, "accountId" | "isAdmin" | "canPinMessages">, lastMessageIds?: Map<number, number>) {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    include: {
      _count: { select: { members: true } },
      members: {
        select: {
          account: { select: { id: true, displayName: true, avatarPath: true } }
        }
      },
      pinned: { where: { active: true }, orderBy: { updatedAt: "desc" }, take: 1 }
    }
  });
  if (!channel) return null;
  const directPeer =
    viewer &&
    channel.kind === "direct" &&
    channel.directKey &&
    !channel.directKey.startsWith("virtual:") &&
    channel._count.members === 2
      ? channel.members.find((member) => member.account.id !== viewer.accountId)?.account
      : null;
  const pin = channel.pinned[0];
  const [pinned, prayerCount] = await Promise.all([
    pin ? serializePinnedItem(pin, viewer) : Promise.resolve(null),
    prisma.message.count({ where: { channelId, type: "prayer" } })
  ]);
  return {
    id: channel.id,
    name: directPeer?.displayName || channel.name,
    description: channel.description,
    icon: directPeer?.avatarPath
      ? directPeer.avatarPath.startsWith("/")
        ? directPeer.avatarPath
        : `/avatars/${directPeer.avatarPath}`
      : cleanChannelIcon(channel.icon),
    kind: channel.kind,
    isPrivate: channel.isPrivate,
    isDefault: channel.isDefault,
    directKey: channel.directKey,
    canManage: viewer ? await canManageChannel(viewer.accountId, channelId) : undefined,
    canWrite: viewer ? await canWriteChannel(viewer.accountId, channelId) : undefined,
    canPin: viewer ? await canPinChannel(viewer, channelId) : undefined,
    hasPrayerItems: prayerCount > 0,
    memberCount: channel._count.members,
    lastMessageId: lastMessageIds?.get(channelId) ?? null,
    pinned
  };
}

function parseJsonField<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

async function createMessageFromActor(input: {
  channelId: number;
  actorId: number;
  content?: string;
  type?: MessageType;
  payload?: unknown;
  replyToId?: number | null;
  chainRootId?: number | null;
  chainVersion?: number | null;
  fileName?: string | null;
  filePath?: string | null;
  fileSize?: number | null;
  skipPush?: boolean;
  pushOrigin?: string;
  skipEngineEvent?: boolean;
  skipQuestionAssistant?: boolean;
}) {
  const message = await prisma.message.create({
    data: {
      channelId: input.channelId,
      senderActorId: input.actorId,
      content: input.content || "",
      type: input.type || "text",
      payload: input.payload as object | undefined,
      replyToId: input.replyToId || null,
      chainRootId: input.chainRootId || null,
      chainVersion: input.chainVersion || null,
      fileName: input.fileName || null,
      filePath: input.filePath || null,
      fileSize: input.fileSize || null
    }
  });
  await emitMessage(message.id);
  if (!input.skipPush) void sendMessagePush(message.id, input.pushOrigin || "").catch((error) => app.log.warn({ error }, "message push failed"));
  if (!input.skipEngineEvent && (input.type === "text" || input.type === "chain" || input.type === "prayer")) {
    await createEngineEvent("message_created", { messageId: message.id }, input.channelId, message.id);
  }
  if (!input.skipQuestionAssistant && (input.type || "text") === "text") {
    void maybeTriggerWhyDirectAssistant(message.id).catch((error) => app.log.warn({ error, messageId: message.id }, "why direct assistant failed"));
    void maybeTriggerQuestionAssistant(message.id).catch((error) => app.log.warn({ error, messageId: message.id }, "question assistant failed"));
  }
  return message;
}

app.get("/api/health", async () => ({ ok: true, name: "team-chat", time: new Date().toISOString() }));

app.get("/api/version", async () => ({
  version: APP_VERSION,
  date: RELEASE_DATE,
  developer: RELEASE_DISPLAY_DEVELOPER,
  notes: RELEASE_NOTES,
  update: {
    repoUrl: UPDATE_REPO_URL,
    branch: configuredUpdateBranch(),
    restartMode: UPDATE_RESTART_MODE,
    pm2App: UPDATE_PM2_APP
  }
}));

// Past-version notes are only needed when someone opens the release modal,
// keeping the full history out of the client entry chunk.
app.get("/api/version/history", async () => ({ history: RELEASE_HISTORY }));

app.get("/api/admin/update/check", { preHandler: requireAdmin }, async (request) => {
  const { repo, branches } = await githubBranches();
  const fallbackBranch = availableDefaultUpdateBranch(branches, configuredUpdateBranch(), DEFAULT_UPDATE_BRANCH);
  const branch = selectUpdateBranch((request.query as { branch?: unknown }).branch, branches, fallbackBranch);
  const latest = await latestGitHubPackage(branch);
  return {
    current: APP_VERSION,
    latest: latest.version,
    updateAvailable: latest.branch !== configuredUpdateBranch() || compareVersions(latest.version, APP_VERSION) > 0,
    repo: `${repo.owner}/${repo.repo}`,
    branch: latest.branch,
    branches,
    url: latest.url,
    restartMode: UPDATE_RESTART_MODE,
    status: readUpdateStatus()
  };
});

app.get("/api/admin/update/status", { preHandler: requireAdmin }, async () => readUpdateStatus());

app.post("/api/admin/update/start", { preHandler: requireAdmin }, async (request, reply) => {
  const status = readUpdateStatus();
  if (status.state === "running") return reply.code(409).send({ success: false, message: "更新已经在进行中", status });
  const { branches } = await githubBranches();
  const fallbackBranch = availableDefaultUpdateBranch(branches, configuredUpdateBranch(), DEFAULT_UPDATE_BRANCH);
  const branch = selectUpdateBranch((request.body as { branch?: unknown } | undefined)?.branch, branches, fallbackBranch);
  const scriptPath = path.join(ROOT, "scripts", "self-update.sh");
  if (!fs.existsSync(scriptPath)) return reply.code(500).send({ success: false, message: "缺少更新脚本" });
  fs.writeFileSync(UPDATE_LOG_PATH, "");
  writeUpdateStatus("running", 1, `准备更新 ${branch}`);
  const child = spawn("bash", [scriptPath], {
    cwd: ROOT,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      APP_DIR: ROOT,
      UPDATE_REPO_URL,
      UPDATE_BRANCH: branch,
      UPDATE_PM2_APP,
      UPDATE_RESTART_MODE,
      UPDATE_RESTART_COMMAND,
      UPDATE_STATUS_PATH,
      UPDATE_LOG_PATH,
      UPDATE_BRANCH_CONFIG_PATH
    }
  });
  child.on("error", (error) => {
    const detail = `启动更新脚本失败：${error.message}`;
    fs.appendFileSync(UPDATE_LOG_PATH, `[${new Date().toISOString()}] ${detail}\n`);
    writeUpdateStatus("failed", 100, detail);
  });
  child.unref();
  return { success: true, status: readUpdateStatus() };
});

app.get("/avatars/:file", async (request, reply) => {
  const file = path.basename((request.params as { file: string }).file);
  const filePath = path.join(AVATAR_DIR, file);
  if (!fs.existsSync(filePath)) return reply.code(404).send("Not found");
  const stat = fs.statSync(filePath);
  applyFileResponseHeaders(reply, file, false);
  if (applyFileValidation(request, reply, stat)) return reply.code(304).send();
  reply.header("Cache-Control", "public, no-cache");
  reply.header("Content-Length", String(stat.size));
  return reply.send(fs.createReadStream(filePath));
});

app.get("/backgrounds/:file", async (request, reply) => {
  const file = path.basename((request.params as { file: string }).file);
  const filePath = path.join(BG_DIR, file);
  if (!fs.existsSync(filePath)) return reply.code(404).send("Not found");
  const stat = fs.statSync(filePath);
  applyFileResponseHeaders(reply, file, false);
  if (applyFileValidation(request, reply, stat)) return reply.code(304).send();
  reply.header("Cache-Control", "public, no-cache");
  reply.header("Content-Length", String(stat.size));
  return reply.send(fs.createReadStream(filePath));
});

app.post("/api/auth/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
  const body = z.object({ username: z.string().min(1).max(40), password: z.string().min(1).max(128), deviceName: z.string().max(120).optional(), appVersion: z.string().max(32).optional() }).safeParse(request.body);
  if (!body.success) return reply.code(400).send({ success: false, message: "参数错误" });
  const account = await prisma.account.findUnique({ where: { username: body.data.username }, include: { actor: true } });
  if (!account || !(await bcrypt.compare(body.data.password, account.passwordHash))) {
    return reply.code(401).send({ success: false, message: "用户名或密码错误" });
  }
  const session = await createAuthSession(account.id, request, body.data.deviceName, body.data.appVersion);
  const updated = await prisma.account.findUniqueOrThrow({ where: { id: account.id }, include: { actor: true } });
  return { success: true, token: signToken(updated, session), account: authDto(updated) };
});

app.post("/api/auth/register", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
  const enabled = await settingBool("registrationEnabled", false);
  if (!enabled) return reply.code(403).send({ success: false, message: "暂未开放注册" });
  const body = z
    .object({
      username: z.string().regex(/^[a-zA-Z0-9_.-]{2,40}$/),
      displayName: z.string().min(1).max(80),
      password: z.string().min(10).max(128),
      deviceName: z.string().max(120).optional(),
      appVersion: z.string().max(32).optional()
    })
    .safeParse(request.body);
  if (!body.success) return reply.code(400).send({ success: false, message: "用户名需 2-40 位，密码需 10-128 位" });
  const existing = await prisma.account.findUnique({ where: { username: body.data.username }, select: { id: true } });
  if (existing) return reply.code(409).send({ success: false, message: "用户名已存在" });
  const account = await prisma.account.create({
    data: {
      username: body.data.username,
      passwordHash: await bcrypt.hash(body.data.password, 12),
      displayName: body.data.displayName,
      role: "user",
      actor: { create: { kind: "human", username: body.data.username, displayName: body.data.displayName } }
    },
    include: { actor: true }
  });
  const publicChannels = await prisma.channel.findMany({ where: { isPrivate: false }, select: { id: true } });
  if (publicChannels.length) {
    await prisma.channelMember.createMany({
      data: publicChannels.map((channel) => ({ accountId: account.id, channelId: channel.id, role: "member" })),
      skipDuplicates: true
    });
  }
  const session = await createAuthSession(account.id, request, body.data.deviceName, body.data.appVersion);
  return { success: true, token: signToken(account, session), account: authDto(account) };
});

app.get("/api/auth/me", { preHandler: requireAuth }, async (request) => {
  const auth = (request as AuthedRequest).auth;
  const [account, session] = await Promise.all([
    prisma.account.findUniqueOrThrow({ where: { id: auth.accountId }, include: { actor: true } }),
    prisma.accountSession.update({ where: { id: auth.sessionId }, data: { expiresAt: sessionExpiresAt(), lastSeenAt: new Date() }, select: { id: true } })
  ]);
  return { account: authDto(account), token: signToken(account, session) };
});

app.patch("/api/me/profile", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const body = z.object({ displayName: z.string().trim().min(1).max(80) }).safeParse(request.body);
  if (!body.success) return reply.code(400).send({ success: false, message: "昵称需为 1-80 个字符" });
  const updated = await prisma.account.update({
    where: { id: auth.accountId },
    data: {
      displayName: body.data.displayName,
      actor: { update: { displayName: body.data.displayName } }
    },
    include: { actor: true }
  });
  refreshAccountConnections(updated);
  return { success: true, account: authDto(updated) };
});

app.post("/api/me/avatar", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  return updateAccountAvatarFromUpload(auth.accountId, request, reply);
});

app.post("/api/auth/change-password", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const body = z.object({ oldPassword: z.string().max(128), newPassword: z.string().min(10).max(128) }).safeParse(request.body);
  if (!body.success) return reply.code(400).send({ success: false, message: "新密码需 10-128 位" });
  const account = await prisma.account.findUniqueOrThrow({ where: { id: auth.accountId } });
  if (!(await bcrypt.compare(body.data.oldPassword, account.passwordHash))) return reply.code(400).send({ success: false, message: "原密码错误" });
  await prisma.account.update({ where: { id: auth.accountId }, data: { passwordHash: await bcrypt.hash(body.data.newPassword, 12) } });
  const sessionsToRevoke = await prisma.accountSession.findMany({
    where: { accountId: auth.accountId, id: { not: auth.sessionId }, revokedAt: null },
    select: { id: true, deviceKind: true, deviceName: true, ipAddress: true, userAgent: true }
  });
  const revokedAt = new Date();
  await prisma.accountSession.updateMany({ where: { id: { in: sessionsToRevoke.map((session) => session.id) } }, data: { revokedAt } });
  await Promise.all(sessionsToRevoke.map((session) => writeLoginLog("session_revoked", auth.accountId, session, revokedAt)));
  disconnectSessions(sessionsToRevoke.map((session) => session.id));
  return { success: true };
});

app.delete("/api/me/account", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const body = z.object({ password: z.string().min(1).max(128) }).safeParse(request.body);
  if (!body.success) return reply.code(400).send({ success: false, message: "请输入当前密码" });
  const account = await prisma.account.findUnique({ where: { id: auth.accountId }, include: { actor: true } });
  if (!account) return reply.code(404).send({ success: false, message: "账号不存在" });
  if (!(await bcrypt.compare(body.data.password, account.passwordHash))) {
    return reply.code(400).send({ success: false, message: "当前密码错误" });
  }
  if (account.role === "admin") {
    const otherAdmins = await prisma.account.count({ where: { role: "admin", id: { not: account.id } } });
    if (!otherAdmins) return reply.code(400).send({ success: false, message: "至少需要保留一个管理员" });
  }
  const sessions = await prisma.accountSession.findMany({ where: { accountId: account.id }, select: { id: true } });
  await prisma.$transaction(async (tx) => {
    if (account.actor) {
      await tx.actor.update({
        where: { id: account.actor.id },
        data: {
          accountId: null,
          username: `deleted-${account.id}-${crypto.randomUUID()}`,
          displayName: "已注销用户",
          avatarPath: null,
          status: "deleted"
        }
      });
    }
    await tx.account.delete({ where: { id: account.id } });
  });
  disconnectSessions(sessions.map((session) => session.id));
  return { success: true };
});

app.post("/api/auth/logout", { preHandler: requireAuth }, async (request) => {
  const auth = (request as AuthedRequest).auth;
  const session = await prisma.accountSession.findFirst({
    where: { id: auth.sessionId, accountId: auth.accountId },
    select: { id: true, deviceKind: true, deviceName: true, ipAddress: true, userAgent: true }
  });
  const now = new Date();
  await prisma.accountSession.updateMany({ where: { id: auth.sessionId, accountId: auth.accountId }, data: { revokedAt: now } });
  await writeLoginLog("auth_logout", auth.accountId, session, now);
  disconnectSessions([auth.sessionId]);
  return { success: true };
});

app.get("/api/me/sessions", { preHandler: requireAuth }, async (request) => {
  const auth = (request as AuthedRequest).auth;
  const sessions = await prisma.accountSession.findMany({
    where: { accountId: auth.accountId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: [{ deviceKind: "asc" }, { lastSeenAt: "desc" }]
  });
  return {
    sessions: sessions.map((session) => ({
      id: session.id,
      deviceKind: session.deviceKind,
      deviceName: session.deviceName,
      ipAddress: session.ipAddress,
      createdAt: session.createdAt.toISOString(),
      lastSeenAt: session.lastSeenAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      current: session.id === auth.sessionId
    }))
  };
});

app.delete("/api/me/sessions/:id", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const sessionId = (request.params as { id: string }).id;
  const session = await prisma.accountSession.findFirst({
    where: { id: sessionId, accountId: auth.accountId, revokedAt: null },
    select: { id: true, deviceKind: true, deviceName: true, ipAddress: true, userAgent: true }
  });
  const now = new Date();
  const result = await prisma.accountSession.updateMany({
    where: { id: sessionId, accountId: auth.accountId, revokedAt: null },
    data: { revokedAt: now }
  });
  if (!result.count) return reply.code(404).send({ success: false, message: "设备不存在" });
  await writeLoginLog("session_revoked", auth.accountId, session, now);
  disconnectSessions([sessionId]);
  return { success: true, current: sessionId === auth.sessionId };
});

async function adminActivityLogs(request: FastifyRequest, reply: FastifyReply) {
  const parsed = z
    .object({
      limit: z.coerce.number().int().min(1).max(500).default(300),
      category: z.enum(["all", "session", "music", "usage"]).default("all")
    })
    .safeParse(request.query);
  if (!parsed.success) return reply.code(400).send({ success: false, message: "日志参数无效" });
  const sourceLimit = Math.min(1000, parsed.data.limit * 3);
  const activityRows = await prisma.$queryRaw<
    Array<{
      id: number;
      kind: AdminLoginLogKind;
      accountId: number;
      username: string | null;
      displayName: string | null;
      deviceKind: DeviceKind | null;
      deviceName: string | null;
      ipAddress: string | null;
      userAgent: string | null;
      sessionId: string | null;
      channelId: number | null;
      channelName: string | null;
      trackId: number | null;
      trackFileName: string | null;
      playbackId: string | null;
      appVersion: string | null;
      latestVersion: string | null;
      isLatestVersion: boolean | number | null;
      state: string | null;
      progressMs: number | null;
      listenedMs: number | null;
      durationMs: number | null;
      createdAt: Date;
    }>
  >`
    SELECT
      log.id,
      log.kind,
      log.account_id AS accountId,
      account.username AS username,
      account.display_name AS displayName,
      log.device_kind AS deviceKind,
      log.device_name AS deviceName,
      log.ip_address AS ipAddress,
      log.user_agent AS userAgent,
      log.session_id AS sessionId,
      log.channel_id AS channelId,
      channel.name AS channelName,
      log.track_id AS trackId,
      track.file_name AS trackFileName,
      log.playback_id AS playbackId,
      log.app_version AS appVersion,
      log.latest_version AS latestVersion,
      log.is_latest_version AS isLatestVersion,
      log.event_state AS state,
      log.progress_ms AS progressMs,
      log.listened_ms AS listenedMs,
      log.duration_ms AS durationMs,
      log.created_at AS createdAt
    FROM account_activity_logs log
    LEFT JOIN accounts account ON account.id = log.account_id
    LEFT JOIN channels channel ON channel.id = log.channel_id
    LEFT JOIN messages track ON track.id = log.track_id
    ORDER BY log.created_at DESC, log.id DESC
    LIMIT ${sourceLimit}
  `;
  const legacyRows = await prisma.$queryRaw<
    Array<{
      id: number;
      kind: AdminLoginLogKind;
      accountId: number;
      username: string | null;
      displayName: string | null;
      deviceKind: DeviceKind | null;
      deviceName: string | null;
      ipAddress: string | null;
      userAgent: string | null;
      sessionId: string | null;
      createdAt: Date;
    }>
  >`
    SELECT
      log.id,
      log.kind,
      log.account_id AS accountId,
      account.username AS username,
      account.display_name AS displayName,
      log.device_kind AS deviceKind,
      log.device_name AS deviceName,
      log.ip_address AS ipAddress,
      log.user_agent AS userAgent,
      log.session_id AS sessionId,
      log.created_at AS createdAt
    FROM account_login_logs log
    LEFT JOIN accounts account ON account.id = log.account_id
    ORDER BY log.created_at DESC, log.id DESC
    LIMIT ${sourceLimit}
  `;
  const activityLogs = activityRows.map((row) => ({
    id: `activity-${row.id}`,
    kind: row.kind,
    category: activityLogCategory(row.kind),
    accountId: row.accountId,
    username: row.username || `user-${row.accountId}`,
    displayName: row.displayName || row.username || `用户 ${row.accountId}`,
    deviceKind: row.deviceKind,
    deviceName: row.deviceName || row.userAgent ? friendlyDeviceName(row.deviceName, row.userAgent || "") : null,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    sessionId: row.sessionId,
    channelId: row.channelId,
    channelName: row.channelName,
    trackId: row.trackId,
    trackTitle: row.trackFileName ? musicTrackTitle(row.trackFileName) : null,
    playbackId: row.playbackId,
    appVersion: row.appVersion,
    latestVersion: row.latestVersion,
    isLatestVersion: row.isLatestVersion === null ? null : !!row.isLatestVersion,
    state: row.state,
    progressMs: row.progressMs,
    listenedMs: row.listenedMs,
    durationMs: row.durationMs,
    createdAt: row.createdAt.toISOString()
  }));
  const legacyLogs = legacyRows.map((row) => ({
    id: `legacy-${row.id}`,
    kind: row.kind,
    category: "session" as const,
    accountId: row.accountId,
    username: row.username || `user-${row.accountId}`,
    displayName: row.displayName || row.username || `用户 ${row.accountId}`,
    deviceKind: row.deviceKind,
    deviceName: row.deviceName || row.userAgent ? friendlyDeviceName(row.deviceName, row.userAgent || "") : null,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    sessionId: row.sessionId,
    createdAt: row.createdAt.toISOString()
  }));
  const logs = [...activityLogs, ...legacyLogs]
    .filter((row) => parsed.data.category === "all" || row.category === parsed.data.category)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, parsed.data.limit);
  return { logs };
}

app.get("/api/admin/activity-logs", { preHandler: requireAdmin }, adminActivityLogs);
app.get("/api/admin/login-logs", { preHandler: requireAdmin }, adminActivityLogs);

app.get("/api/notifications/settings", { preHandler: requireAuth }, async (request) => {
  const auth = (request as AuthedRequest).auth;
  const origin = pushOriginFromHeaders(request.headers);
  const preferences = await prisma.channelNotificationPreference.findMany({
    where: { accountId: auth.accountId, muted: true },
    select: { channelId: true }
  });
  const subscriptions = PUSH_NOTIFICATIONS_ENABLED && origin ? await prisma.pushSubscription.count({ where: { accountId: auth.accountId, origin } }) : 0;
  return {
    enabled: PUSH_NOTIFICATIONS_ENABLED,
    publicKey: vapidPublicKey,
    pushReady,
    subscriptions,
    mutedChannelIds: preferences.map((item) => item.channelId)
  };
});

app.post("/api/push-subscriptions", { preHandler: requireAuth }, async (request, reply) => {
  if (!PUSH_NOTIFICATIONS_ENABLED) return reply.code(503).send({ success: false, message: "当前环境已关闭消息推送" });
  const auth = (request as AuthedRequest).auth;
  const origin = pushOriginFromHeaders(request.headers);
  if (!origin) return reply.code(400).send({ success: false, message: "无法识别当前站点来源" });
  const body = pushSubscriptionSchema.parse(request.body);
  await prisma.pushSubscription.upsert({
    where: { endpoint: body.endpoint },
    update: {
      accountId: auth.accountId,
      origin,
      keysP256dh: body.keys.p256dh,
      keysAuth: body.keys.auth
    },
    create: {
      accountId: auth.accountId,
      endpoint: body.endpoint,
      origin,
      keysP256dh: body.keys.p256dh,
      keysAuth: body.keys.auth
    }
  });
  return { success: true };
});

app.delete("/api/push-subscriptions", { preHandler: requireAuth }, async (request) => {
  const auth = (request as AuthedRequest).auth;
  const origin = pushOriginFromHeaders(request.headers);
  const body = z.object({ endpoint: z.string().url().max(512).optional() }).parse(request.body || {});
  const where = body.endpoint ? { accountId: auth.accountId, endpoint: body.endpoint, origin } : { accountId: auth.accountId, origin };
  await prisma.pushSubscription.deleteMany({ where });
  return { success: true };
});

app.post("/api/notifications/test", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  if (!pushReady) return reply.code(400).send({ success: false, message: "服务器推送未就绪" });
  const origin = pushOriginFromHeaders(request.headers);
  if (!origin) return reply.code(400).send({ success: false, message: "无法识别当前站点来源" });
  const body = z.object({ endpoint: z.string().url().max(512).optional() }).parse(request.body || {});
  const subscriptions = await prisma.pushSubscription.findMany({
    where: body.endpoint ? { accountId: auth.accountId, endpoint: body.endpoint, origin } : { accountId: auth.accountId, origin }
  });
  if (!subscriptions.length) return reply.code(404).send({ success: false, message: "当前设备还没有通知订阅" });
  await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        await webPush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.keysP256dh, auth: subscription.keysAuth }
          },
          JSON.stringify({
            title: "Team Chat 测试通知",
            body: "通知已经可以用啦。以后 @ 和重要公告会从这里提醒你。",
            url: "/",
            tag: `notification-test-${auth.accountId}`,
            channelId: 0
          })
        );
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await prisma.pushSubscription.deleteMany({ where: { endpoint: subscription.endpoint } });
        } else {
          app.log.warn({ error }, "test push notification failed");
          throw error;
        }
      }
    })
  );
  return { success: true, sent: subscriptions.length };
});

app.patch("/api/notifications/channels/:id", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const channelId = Number((request.params as { id: string }).id);
  if (!channelId || !(await canAccessChannel(auth.accountId, channelId))) return reply.code(403).send({ success: false, message: "无权访问此频道" });
  const body = z.object({ muted: z.boolean() }).parse(request.body);
  if (body.muted) {
    await prisma.channelNotificationPreference.upsert({
      where: { channelId_accountId: { channelId, accountId: auth.accountId } },
      update: { muted: true },
      create: { channelId, accountId: auth.accountId, muted: true }
    });
  } else {
    await prisma.channelNotificationPreference.deleteMany({ where: { channelId, accountId: auth.accountId } });
  }
  return { success: true, channelId, muted: body.muted };
});

app.patch("/api/me/preferences", { preHandler: requireAuth }, async (request) => {
  const auth = (request as AuthedRequest).auth;
  const body = z
    .object({
      theme: z.string().optional(),
      biblePreferences: z
        .object({
          outputFormat: z.string().optional(),
          referenceLabelMode: z.string().optional(),
          combinedPassageMode: z.string().optional(),
          quotationStyle: z.string().optional()
        })
        .optional()
    })
    .parse(request.body);
  const data: Prisma.AccountUpdateInput = {};
  if (body.theme !== undefined) {
    const requestedTheme = cleanThemeId(body.theme);
    data.theme = requestedTheme && (await themeExists(requestedTheme)) ? requestedTheme : "wechat";
  }
  if (body.biblePreferences !== undefined) {
    const current = await prisma.account.findUnique({ where: { id: auth.accountId }, select: { biblePreferences: true } });
    data.biblePreferences = biblePreferencesJson({ ...(current?.biblePreferences as Record<string, unknown> | null | undefined), ...body.biblePreferences });
  }
  const account = Object.keys(data).length
    ? await prisma.account.update({ where: { id: auth.accountId }, data, include: { actor: true } })
    : await prisma.account.findUniqueOrThrow({ where: { id: auth.accountId }, include: { actor: true } });
  return { success: true, account: authDto(account) };
});

app.get("/api/why/topics", { preHandler: requireAuth }, async (request) => {
  void request;
  return { topics: [] };
});

app.get("/api/why/summary", { preHandler: requireAuth }, async (request) => {
  void request;
  const unreadCount = 0;
  const pendingRequestCount = 0;
  return { unreadCount, pendingRequestCount };
});

app.post("/api/why/topics", { preHandler: requireAuth }, async (request, reply) => {
  void request;
  return reply.code(410).send({ success: false, message: "为什么频道已移除，请和为什么助手私聊继续研究话题" });
});

app.get("/api/why/topics/:id", { preHandler: requireAuth }, async (request, reply) => {
  void request;
  return reply.code(410).send({ success: false, message: "为什么频道已移除，请和为什么助手私聊继续研究话题" });
});

app.post("/api/why/topics/:id/messages", { preHandler: requireAuth }, async (request, reply) => {
  void request;
  return reply.code(410).send({ success: false, message: "为什么频道已移除，请和为什么助手私聊继续研究话题" });
});

app.post("/api/why/topics/:id/request", { preHandler: requireAuth }, async (request, reply) => {
  void request;
  return reply.code(410).send({ success: false, message: "为什么频道已移除，请和为什么助手私聊继续研究话题" });
});

app.post("/api/why/topics/:id/requests/:accountId", { preHandler: requireAuth }, async (request, reply) => {
  void request;
  return reply.code(410).send({ success: false, message: "为什么频道已移除，请和为什么助手私聊继续研究话题" });
});

app.patch("/api/why/topics/:id", { preHandler: requireAuth }, async (request, reply) => {
  void request;
  return reply.code(410).send({ success: false, message: "为什么频道已移除，请和为什么助手私聊继续研究话题" });
});

app.post("/api/why/topics/:id/complete", { preHandler: requireAuth }, async (request, reply) => {
  void request;
  return reply.code(410).send({ success: false, message: "为什么频道已移除，请和为什么助手私聊继续研究话题" });
});

app.post("/api/why/topics/:id/retry-assistant", { preHandler: requireAuth }, async (request, reply) => {
  void request;
  return reply.code(410).send({ success: false, message: "为什么频道已移除，请和为什么助手私聊继续研究话题" });
});

app.delete("/api/why/topics/:id", { preHandler: requireAuth }, async (request, reply) => {
  void request;
  return reply.code(410).send({ success: false, message: "为什么频道已移除，请和为什么助手私聊继续研究话题" });
});


app.get("/api/channels", { preHandler: requireAuth }, async (request) => {
  const auth = (request as AuthedRequest).auth;
  const channels = await prisma.channel.findMany({
    where: channelListWhere(auth.accountId),
    orderBy: [{ isDefault: "desc" }, { id: "asc" }],
    include: {
      _count: { select: { members: true } },
      members: {
        select: {
          account: { select: { id: true, displayName: true, avatarPath: true } }
        }
      },
      pinned: { where: { active: true }, orderBy: { updatedAt: "desc" }, take: 1 }
    }
  });
  const channelIds = channels.map((ch) => ch.id);
  const [lastMessageRows, prayerRows, viewerMemberships] = await Promise.all([
    prisma.message.groupBy({ by: ["channelId"], where: { channelId: { in: channelIds } }, _max: { id: true } }),
    prisma.message.groupBy({ by: ["channelId"], where: { channelId: { in: channelIds }, type: "prayer" }, _count: { _all: true } }),
    prisma.channelMember.findMany({ where: { accountId: auth.accountId, channelId: { in: channelIds } }, select: { channelId: true, role: true } })
  ]);
  const lastMessageIds = new Map(lastMessageRows.map((row) => [row.channelId, row._max.id ?? 0]));
  const prayerCounts = new Map(prayerRows.map((row) => [row.channelId, row._count._all]));
  const membershipRoles = new Map(viewerMemberships.map((member) => [member.channelId, member.role]));
  // Pinned items are rare (at most one active pin per channel), so per-pin
  // hydration stays on the shared serializer without reviving the per-channel
  // query fan-out this endpoint used to have.
  const pinnedEntries = await Promise.all(
    channels.map(async (channel) => [channel.id, channel.pinned[0] ? await serializePinnedItem(channel.pinned[0], auth) : null] as const)
  );
  const pinnedByChannel = new Map(pinnedEntries);
  const viewerCanManageMusic = canManageMusicRole({ isAdmin: auth.isAdmin, canPinMessages: auth.canPinMessages });
  return {
    channels: channels.map((channel) => {
      const memberRole = membershipRoles.get(channel.id) ?? null;
      const directPeer =
        channel.kind === "direct" && channel.directKey && !channel.directKey.startsWith("virtual:") && channel._count.members === 2
          ? channel.members.find((member) => member.account.id !== auth.accountId)?.account
          : null;
      const canAccess = channel.kind === "music" || !channelNeedsExplicitMembership(channel) || !!memberRole;
      const canManage =
        channel.kind === "aiLounge"
          ? false
          : channel.kind === "music"
            ? viewerCanManageMusic
            : auth.isAdmin || memberRole === "owner" || memberRole === "admin";
      const canWrite =
        channel.kind === "aiLounge"
          ? false
          : channel.kind === "music" || !channelNeedsExplicitMembership(channel) || (!!memberRole && memberRole !== "viewer");
      const canPin =
        channel.directKey || channel.kind !== "standard"
          ? false
          : auth.isAdmin || (!!auth.canPinMessages && channel.isDefault && canAccess);
      return {
        id: channel.id,
        name: directPeer?.displayName || channel.name,
        description: channel.description,
        icon: directPeer?.avatarPath
          ? directPeer.avatarPath.startsWith("/")
            ? directPeer.avatarPath
            : `/avatars/${directPeer.avatarPath}`
          : cleanChannelIcon(channel.icon),
        kind: channel.kind,
        isPrivate: channel.isPrivate,
        isDefault: channel.isDefault,
        directKey: channel.directKey,
        canManage,
        canWrite,
        canPin,
        hasPrayerItems: (prayerCounts.get(channel.id) ?? 0) > 0,
        memberCount: channel._count.members,
        lastMessageId: lastMessageIds.get(channel.id) ?? null,
        pinned: pinnedByChannel.get(channel.id) ?? null
      };
    })
  };
});

app.get("/api/admin/channels", { preHandler: requireAdmin }, async (request) => {
  const query = z
    .object({
      directPage: z.coerce.number().int().min(1).default(1),
      directPageSize: z.coerce.number().int().min(10).max(100).default(30),
      q: z.string().trim().max(80).default("")
    })
    .parse(request.query);
  const directWhere = {
    kind: "direct" as const,
    ...(query.q ? { name: { contains: query.q } } : {})
  };
  const includeAdminCounts = {
    _count: { select: { members: true, messages: true } },
    messages: { orderBy: { createdAt: "desc" as const }, take: 1, select: { createdAt: true } }
  };
  const [channels, directConversations, directTotal] = await Promise.all([
    prisma.channel.findMany({
      where: { kind: { in: [...PUBLIC_CHANNEL_KINDS, "music"] }, directKey: null },
      orderBy: [{ isDefault: "desc" }, { id: "asc" }],
      include: includeAdminCounts
    }),
    prisma.channel.findMany({
      where: directWhere,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip: (query.directPage - 1) * query.directPageSize,
      take: query.directPageSize,
      include: includeAdminCounts
    }),
    prisma.channel.count({ where: directWhere })
  ]);
  const serialize = (channel: (typeof channels)[number]) => ({
    id: channel.id,
    name: channel.name,
    description: channel.description,
    icon: cleanChannelIcon(channel.icon),
    kind: channel.kind,
    isPrivate: channel.isPrivate,
    isDefault: channel.isDefault,
    directKey: channel.directKey,
    canManage: true,
    canPin: true,
    memberCount: channel._count.members,
    messageCount: channel._count.messages,
    createdAt: channel.createdAt.toISOString(),
    lastMessageAt: channel.messages[0]?.createdAt.toISOString() || null,
    pinned: null
  });
  return {
    channels: channels.map(serialize),
    directConversations: directConversations.map(serialize),
    directTotal,
    directPage: query.directPage,
    directPageSize: query.directPageSize
  };
});

app.post("/api/channels", { preHandler: requireAuth }, async (request) => {
  const auth = (request as AuthedRequest).auth;
  const body = z.object({ name: z.string().min(1).max(80), description: z.string().max(255).optional(), icon: z.string().max(16).optional(), isPrivate: z.boolean().optional() }).parse(request.body);
  const channel = await prisma.channel.create({
    data: {
      name: body.name,
      description: body.description || "",
      icon: cleanChannelIcon(body.icon),
      isPrivate: !!body.isPrivate,
      members: { create: { accountId: auth.accountId, role: "owner" } }
    }
  });
  let audienceAccountIds = [auth.accountId];
  if (!body.isPrivate) {
    const accounts = await prisma.account.findMany({ select: { id: true } });
    audienceAccountIds = accounts.map((a) => a.id);
    await prisma.channelMember.createMany({
      data: accounts.map((a) => ({ accountId: a.id, channelId: channel.id, role: a.id === auth.accountId ? "owner" : "member" })),
      skipDuplicates: true
    });
  }
  for (const accountId of audienceAccountIds) joinAccountChannel(accountId, channel.id);
  const dto = await channelDto(channel.id, auth);
  const event = { action: "created", channel: dto };
  if (body.isPrivate) {
    for (const accountId of audienceAccountIds) io.to(`acct:${accountId}`).emit("channel:updated", event);
  } else {
    io.emit("channel:updated", event);
  }
  return { success: true, channel: dto };
});

app.patch("/api/channels/:id", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const channelId = Number((request.params as { id: string }).id);
  const protectedChannel = await prisma.channel.findUnique({ where: { id: channelId }, select: { kind: true } });
  if (protectedChannel?.kind === "music") return reply.code(400).send({ success: false, message: "音乐频道为系统频道，不能修改" });
  if (!(await canManageChannel(auth.accountId, channelId))) return reply.code(403).send({ success: false, message: "无权管理此频道" });
  const body = z
    .object({
      name: z.string().min(1).max(80).optional(),
      description: z.string().max(255).optional(),
      icon: z.string().max(16).optional()
    })
    .parse(request.body);
  await prisma.channel.update({
    where: { id: channelId },
    data: {
      name: body.name,
      description: body.description,
      icon: body.icon === undefined ? undefined : cleanChannelIcon(body.icon)
    }
  });
  const dto = await channelDto(channelId, auth);
  io.emit("channel:updated", { action: "updated", channel: dto });
  return { success: true, channel: dto };
});

app.post(
  "/api/channels/:id/name-suggestions",
  { preHandler: requireAuth, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
  async (request, reply) => {
    const auth = (request as AuthedRequest).auth;
    const channelId = Number((request.params as { id: string }).id);
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { kind: true, directKey: true, _count: { select: { members: true } } }
    });
    if (!channel) return reply.code(404).send({ success: false, message: "私聊不存在" });
    if (channel.kind !== "direct" || !channel.directKey || channel.directKey.startsWith("virtual:") || channel._count.members <= 2) {
      return reply.code(400).send({ success: false, message: "只有多人私聊可以更换名称" });
    }
    if (!(await canManageChannel(auth.accountId, channelId))) return reply.code(403).send({ success: false, message: "无权管理此私聊" });
    const memberNames = await directChatMemberNames(channelId);
    return { suggestions: await generateDirectChatNameSuggestions(memberNames) };
  }
);

app.post("/api/channels/:id/icon", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const channelId = Number((request.params as { id: string }).id);
  const protectedChannel = await prisma.channel.findUnique({ where: { id: channelId }, select: { kind: true } });
  if (protectedChannel?.kind === "music") return reply.code(400).send({ success: false, message: "音乐频道为系统频道，不能修改" });
  if (!(await canManageChannel(auth.accountId, channelId))) return reply.code(403).send({ success: false, message: "无权管理此频道" });
  const safeName = await saveImageUpload(request, reply, "缺少频道图标", true);
  if (!safeName) return reply;
  await prisma.channel.update({ where: { id: channelId }, data: { icon: safeName } });
  const dto = await channelDto(channelId, auth);
  io.emit("channel:updated", { action: "updated", channel: dto });
  return { success: true, channel: dto };
});

async function deleteChannelWithAttachments(channelId: number) {
  const messages = await prisma.message.findMany({ where: { channelId }, select: { id: true, filePath: true } });
  const messageIds = messages.map((message) => message.id);
  if (messageIds.length) {
    await prisma.message.updateMany({ where: { replyToId: { in: messageIds } }, data: { replyToId: null } });
  }
  await prisma.channel.delete({ where: { id: channelId } });

  for (const attachment of messages) {
    if (!attachment.filePath) continue;
    if (!(await uploadIsStillReferenced(attachment.filePath))) safeUnlink("upload", attachment.filePath);
  }
  io.emit("channel:updated", { action: "deleted", channelId });
}

app.delete("/api/channels/:id", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const channelId = Number((request.params as { id: string }).id);
  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { id: true, name: true, isDefault: true, directKey: true, kind: true } });
  if (!channel) return reply.code(404).send({ success: false, message: "频道不存在" });
  if (channel.isDefault) return reply.code(400).send({ success: false, message: "默认频道不能删除" });
  if (channel.kind === "music") return reply.code(400).send({ success: false, message: "音乐频道为系统频道，不能删除" });
  if (channel.directKey) return reply.code(400).send({ success: false, message: "私聊请使用关闭私聊" });
  if (!(await canManageChannel(auth.accountId, channelId))) return reply.code(403).send({ success: false, message: "无权删除此频道" });

  await deleteChannelWithAttachments(channelId);
  return { success: true };
});

app.delete("/api/admin/direct-conversations/:id", { preHandler: requireAdmin }, async (request, reply) => {
  const channelId = Number((request.params as { id: string }).id);
  if (!Number.isInteger(channelId) || channelId <= 0) return reply.code(400).send({ success: false, message: "无效的私聊记录" });
  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { id: true, directKey: true, kind: true } });
  if (!channel) return reply.code(404).send({ success: false, message: "私聊记录不存在" });
  if (!channel.directKey || channel.kind !== "direct") return reply.code(400).send({ success: false, message: "该记录不是私聊历史" });

  await deleteChannelWithAttachments(channelId);
  return { success: true };
});

app.post("/api/direct-channels", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const body = z.object({ accountId: z.number().int().positive() }).parse(request.body);
  if (body.accountId === auth.accountId) return reply.code(400).send({ success: false, message: "不能和自己发起私聊" });
  const [me, peer] = await Promise.all([
    prisma.account.findUnique({ where: { id: auth.accountId }, include: { actor: true } }),
    prisma.account.findUnique({ where: { id: body.accountId }, include: { actor: true } })
  ]);
  if (!me?.actor || !peer?.actor) return reply.code(404).send({ success: false, message: "用户不存在" });
  const key = directChannelKey(auth.accountId, body.accountId);
  const channel = await prisma.channel.upsert({
    where: { directKey: key },
    update: {},
    create: {
      kind: "direct",
      name: `私聊：${me.displayName}、${peer.displayName}`,
      description: "一对一私聊",
      icon: "",
      isPrivate: true,
      directKey: key,
      members: {
        create: [
          { accountId: auth.accountId, role: "owner" },
          { accountId: body.accountId, role: "member" }
        ]
      }
    }
  });
  await prisma.channelMember.createMany({
    data: [
      { accountId: auth.accountId, channelId: channel.id, role: "owner" },
      { accountId: body.accountId, channelId: channel.id, role: "member" }
    ],
    skipDuplicates: true
  });
  joinAccountChannel(auth.accountId, channel.id);
  joinAccountChannel(body.accountId, channel.id);
  const dto = await channelDto(channel.id, auth);
  io.to(`acct:${auth.accountId}`).to(`acct:${body.accountId}`).emit("channel:updated", { action: "direct", channel: dto });
  return { success: true, channel: dto };
});

app.post("/api/direct-virtual-channels", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const body = z.object({ username: z.string().min(1).max(80) }).parse(request.body);
  if (body.username !== WHY_ASSISTANT_USERNAME) return reply.code(400).send({ success: false, message: "暂时只能和为什么助手私聊" });
  const [me, assistant] = await Promise.all([
    prisma.account.findUnique({ where: { id: auth.accountId }, include: { actor: true } }),
    ensureWhyAssistantCharacter()
  ]);
  if (!me?.actor || !assistant) return reply.code(404).send({ success: false, message: "助手不存在" });
  const key = virtualDirectChannelKey(auth.accountId, body.username);
  const channel = await prisma.channel.upsert({
    where: { directKey: key },
    update: { name: `私聊：${me.displayName}、${assistant.displayName}`, isPrivate: true },
    create: {
      kind: "direct",
      name: `私聊：${me.displayName}、${assistant.displayName}`,
      description: "一对一私聊",
      icon: "",
      isPrivate: true,
      directKey: key,
      members: { create: [{ accountId: auth.accountId, role: "owner" }] }
    }
  });
  await prisma.channelMember.createMany({
    data: [{ accountId: auth.accountId, channelId: channel.id, role: "owner" }],
    skipDuplicates: true
  });
  joinAccountChannel(auth.accountId, channel.id);
  const dto = await channelDto(channel.id, auth);
  io.to(`acct:${auth.accountId}`).emit("channel:updated", { action: "direct", channel: dto });
  return { success: true, channel: dto };
});

app.delete("/api/channels/:id/membership", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const channelId = Number((request.params as { id: string }).id);
  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { id: true, directKey: true, isDefault: true } });
  if (!channel) return reply.code(404).send({ success: false, message: "频道不存在" });
  if (!channel.directKey) return reply.code(400).send({ success: false, message: "只有私聊频道可以关闭" });
  await prisma.channelMember.deleteMany({ where: { channelId, accountId: auth.accountId } });
  leaveAccountChannel(auth.accountId, channelId);
  io.to(`acct:${auth.accountId}`).emit("channel:updated", { action: "closed", channelId });
  return { success: true };
});

app.get("/api/channels/:id/members", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const channelId = Number((request.params as { id: string }).id);
  if (!(await canAccessChannel(auth.accountId, channelId)) && !(await canManageChannel(auth.accountId, channelId))) return reply.code(403).send({ success: false, message: "无权访问此频道" });
  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { id: true, directKey: true, isPrivate: true, kind: true } });
  if (!channel) return reply.code(404).send({ success: false, message: "频道不存在" });
  const accounts = await prisma.account.findMany({
    where: channel?.kind === "music"
      ? { OR: [{ role: "admin" }, { canPinMessages: true }] }
      : channel && channelNeedsExplicitMembership(channel)
        ? { memberships: { some: { channelId } } }
        : {},
    include: { actor: true, memberships: { where: { channelId } } },
    orderBy: { displayName: "asc" }
  });
  const virtuals = (await prisma.virtualCharacter.findMany({ where: { enabled: true }, include: { actor: true }, orderBy: { id: "asc" } }))
    .filter((character) => virtualCharacterVisibleInChannel(channel, { username: character.actor.username, config: character.config }));
  return {
    members: [
      ...accounts.map((a) => ({
        id: a.actor?.id,
        accountId: a.id,
        kind: "human",
        username: a.username,
        displayName: a.displayName,
        avatarPath: a.avatarPath,
        role: a.role === "admin" ? "admin" : a.memberships[0]?.role || "member",
        membershipRole: a.memberships[0]?.role || null,
        isSiteAdmin: a.role === "admin"
      })),
      ...virtuals.map((v) => ({
        id: v.actor.id,
        characterId:
          AI_ROLE_USERNAMES.has(v.actor.username) && !(channel.directKey?.startsWith("virtual:") && channel.directKey.endsWith(`:${v.actor.username}`))
            ? v.id
            : undefined,
        kind: "virtual",
        username: v.actor.username,
        displayName: v.actor.displayName,
        avatarPath: v.actor.avatarPath,
        role: "virtual"
      }))
    ]
  };
});

app.get("/api/channels/:id/member-candidates", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const channelId = Number((request.params as { id: string }).id);
  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { id: true, kind: true, isPrivate: true, directKey: true } });
  if (!channel) return reply.code(404).send({ success: false, message: "频道不存在" });
  if (channel.kind === "aiLounge" || channel.kind === "music") return reply.code(400).send({ success: false, message: "此频道不支持成员管理" });
  if (!(await canManageChannel(auth.accountId, channelId))) return reply.code(403).send({ success: false, message: "无权管理此频道" });
  if (!channel.isPrivate) return { accounts: [], virtuals: [] };
  const [accounts, virtualCharacters] = await Promise.all([
    prisma.account.findMany({
      where: { memberships: { none: { channelId } } },
      include: { actor: true },
      orderBy: { displayName: "asc" }
    }),
    prisma.virtualCharacter.findMany({ where: { enabled: true }, include: { actor: true }, orderBy: { id: "asc" } })
  ]);
  const virtuals = virtualCharacters
    .filter((character) => AI_ROLE_USERNAMES.has(character.actor.username))
    .filter((character) => !virtualCharacterVisibleInChannel(channel, { username: character.actor.username, config: character.config }))
    .map((character) => ({
      id: character.actor.id,
      characterId: character.id,
      kind: "virtual" as const,
      username: character.actor.username,
      displayName: character.actor.displayName,
      avatarPath: character.actor.avatarPath
    }));
  return { accounts: accounts.map((account) => authDto(account)), virtuals };
});

app.post("/api/channels/:id/members", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const channelId = Number((request.params as { id: string }).id);
  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { kind: true, isPrivate: true } });
  if (!channel) return reply.code(404).send({ success: false, message: "频道不存在" });
  if (channel.kind === "aiLounge" || channel.kind === "music") return reply.code(400).send({ success: false, message: "此频道不支持成员管理" });
  if (!(await canManageChannel(auth.accountId, channelId))) return reply.code(403).send({ success: false, message: "无权管理此频道" });
  if (!channel.isPrivate) return reply.code(400).send({ success: false, message: "公开频道不支持单独添加成员" });
  const body = z
    .object({
      accountId: z.number().int().positive().optional(),
      accountIds: z.array(z.number().int().positive()).max(100).optional(),
      virtualCharacterIds: z.array(z.number().int().positive()).max(20).optional()
    })
    .parse(request.body);
  const requestedIds = [...new Set([...(body.accountIds || []), ...(body.accountId ? [body.accountId] : [])])];
  const requestedVirtualIds = [...new Set(body.virtualCharacterIds || [])];
  if (!requestedIds.length && !requestedVirtualIds.length) return reply.code(400).send({ success: false, message: "请选择要添加的人" });
  const [accounts, virtualCharacters] = await Promise.all([
    prisma.account.findMany({ where: { id: { in: requestedIds } }, select: { id: true } }),
    prisma.virtualCharacter.findMany({ where: { id: { in: requestedVirtualIds }, enabled: true }, include: { actor: true } })
  ]);
  if (accounts.length !== requestedIds.length) return reply.code(404).send({ success: false, message: "用户不存在" });
  if (virtualCharacters.length !== requestedVirtualIds.length || virtualCharacters.some((character) => !AI_ROLE_USERNAMES.has(character.actor.username))) {
    return reply.code(404).send({ success: false, message: "AI 角色不存在" });
  }
  await prisma.channelMember.createMany({
    data: accounts.map((account) => ({ channelId, accountId: account.id, role: "member" as const })),
    skipDuplicates: true
  });
  await Promise.all(
    virtualCharacters.map((character) =>
      prisma.virtualCharacter.update({
        where: { id: character.id },
        data: { config: virtualCharacterConfigForChannel(character.config, channelId, true) as Prisma.InputJsonObject }
      })
    )
  );
  for (const account of accounts) joinAccountChannel(account.id, channelId);
  await ensureDirectGroupDefaultName(channelId);
  await emitChannelMembersChanged(channelId, "members-added", accounts.map((account) => account.id));
  const dto = await channelDto(channelId, auth);
  return { success: true, channel: dto, added: accounts.length + virtualCharacters.length };
});

app.delete("/api/channels/:id/virtual-members/:characterId", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const channelId = Number((request.params as { id: string }).id);
  const characterId = Number((request.params as { characterId: string }).characterId);
  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { kind: true, isPrivate: true } });
  if (!channel) return reply.code(404).send({ success: false, message: "频道不存在" });
  if (!channel.isPrivate || channel.kind === "aiLounge" || channel.kind === "music") return reply.code(400).send({ success: false, message: "此频道不支持角色管理" });
  if (!(await canManageChannel(auth.accountId, channelId))) return reply.code(403).send({ success: false, message: "无权管理此频道" });
  const character = await prisma.virtualCharacter.findUnique({ where: { id: characterId }, include: { actor: true } });
  if (!character || !AI_ROLE_USERNAMES.has(character.actor.username)) return reply.code(404).send({ success: false, message: "AI 角色不存在" });
  await prisma.virtualCharacter.update({
    where: { id: character.id },
    data: { config: virtualCharacterConfigForChannel(character.config, channelId, false) as Prisma.InputJsonObject }
  });
  await emitChannelMembersChanged(channelId, "members-removed");
  const dto = await channelDto(channelId, auth);
  return { success: true, channel: dto, removed: characterId };
});

app.delete("/api/channels/:id/members/:accountId", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const channelId = Number((request.params as { id: string }).id);
  const accountId = Number((request.params as { accountId: string }).accountId);
  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { kind: true, isPrivate: true } });
  if (!channel) return reply.code(404).send({ success: false, message: "频道不存在" });
  if (channel.kind === "aiLounge" || channel.kind === "music") return reply.code(400).send({ success: false, message: "此频道不支持成员管理" });
  if (!(await canManageChannel(auth.accountId, channelId))) return reply.code(403).send({ success: false, message: "无权管理此频道" });
  if (!channel.isPrivate) return reply.code(400).send({ success: false, message: "公开频道不支持单独移除成员" });
  const member = await prisma.channelMember.findUnique({ where: { channelId_accountId: { channelId, accountId } } });
  if (!member) return reply.code(404).send({ success: false, message: "此用户不在频道中" });
  if (member.role === "owner") return reply.code(400).send({ success: false, message: "不能移除频道创建者" });
  await prisma.channelMember.delete({ where: { channelId_accountId: { channelId, accountId } } });
  leaveAccountChannel(accountId, channelId);
  await emitChannelMembersChanged(channelId, "members-removed", [accountId]);
  const dto = await channelDto(channelId, auth);
  return { success: true, channel: dto, removed: accountId };
});

async function buildMessageSerializeBatch(rows: Array<Message & { sender: Actor }>, channelId: number, viewerAccountId: number): Promise<MessageSerializeBatch> {
  const batch: MessageSerializeBatch = {};
  const voiceIds = rows.filter((message) => isVoiceMessage(message) && message.sender.accountId !== viewerAccountId).map((message) => message.id);
  const audioRows = rows.filter((message) => message.type === "file" && isAudioFileName(message.fileName));
  const audioIds = audioRows.map((message) => message.id);
  const prayerRows = rows.filter((message) => message.type === "prayer");
  const playlistIds = [
    ...new Set(
      rows
        .map((message) =>
          message.type === "music_playlist" && message.payload && typeof message.payload === "object"
            ? Number((message.payload as { playlistId?: unknown }).playlistId || 0)
            : 0
        )
        .filter((id) => id > 0)
    )
  ];

  const [listenedRows, scoreRows, lyricRows] = await Promise.all([
    voiceIds.length
      ? prisma.voiceListen.findMany({ where: { accountId: viewerAccountId, messageId: { in: voiceIds } }, select: { messageId: true } })
      : Promise.resolve([]),
    audioIds.length
      ? prisma.musicScore.findMany({ where: { trackId: { in: audioIds } }, orderBy: { id: "asc" }, include: { pages: { orderBy: { pageIndex: "asc" } } } })
      : Promise.resolve([]),
    audioIds.length ? prisma.musicLyrics.findMany({ where: { trackId: { in: audioIds } } }) : Promise.resolve([])
  ]);
  batch.voiceListenedMessageIds = new Set(listenedRows.map((row) => row.messageId));

  // Attach audio relations so serializeMessage's preloaded-relation branches
  // pick them up instead of querying per message.
  const scoresByTrackId = new Map<number, Array<(typeof scoreRows)[number]>>();
  for (const score of scoreRows) {
    if (score.trackId === null) continue;
    const list = scoresByTrackId.get(score.trackId) || [];
    list.push(score);
    scoresByTrackId.set(score.trackId, list);
  }
  const lyricsByTrackId = new Map(lyricRows.map((row) => [row.trackId, row]));
  for (const message of audioRows) {
    const loaded = message as typeof message & {
      musicScores?: Array<MusicScore & { pages: MusicScorePage[] }>;
      musicLyrics?: MusicLyrics | null;
    };
    loaded.musicScores = scoresByTrackId.get(message.id) ?? [];
    loaded.musicLyrics = lyricsByTrackId.get(message.id) ?? null;
  }

  if (prayerRows.length) {
    const aiSettings = await loadAiSettings();
    const sourceIds = [
      ...new Set(
        prayerRows
          .map((message) => ({ sourceId: sourcePrayerMessageId(message.payload, message.id), messageId: message.id }))
          .filter((entry) => entry.sourceId !== entry.messageId)
          .map((entry) => entry.sourceId)
      )
    ];
    const sourceRows = sourceIds.length ? await prisma.message.findMany({ where: { id: { in: sourceIds }, channelId, type: "prayer" } }) : [];
    const sourceMessages = new Map<number, Message | null>();
    for (const sourceId of sourceIds) sourceMessages.set(sourceId, sourceRows.find((row) => row.id === sourceId) ?? null);
    const actionMessageIds = [
      ...new Set(
        prayerRows.map((message) => {
          const sourceId = sourcePrayerMessageId(message.payload, message.id);
          return (sourceId !== message.id ? sourceMessages.get(sourceId)?.id : undefined) || message.id;
        })
      )
    ];
    const [actionRows, suggestionRows] = await Promise.all([
      prisma.prayerAction.findMany({
        where: { messageId: { in: actionMessageIds } },
        include: { account: { select: { displayName: true, avatarPath: true } } },
        orderBy: { prayedAt: "desc" }
      }),
      prisma.messageAiSuggestion.findMany({
        where: { messageId: { in: actionMessageIds }, kind: AI_RELATED_VERSES_KIND, status: "success" },
        include: { createdBy: { select: { displayName: true } } },
        orderBy: { createdAt: "desc" }
      })
    ]);
    const actionsByMessageId = new Map<number, typeof actionRows>();
    for (const action of actionRows) {
      const list = actionsByMessageId.get(action.messageId) || [];
      list.push(action);
      actionsByMessageId.set(action.messageId, list);
    }
    const suggestionsByMessageId = new Map<number, typeof suggestionRows>();
    for (const suggestion of suggestionRows) {
      const list = suggestionsByMessageId.get(suggestion.messageId) || [];
      list.push(suggestion);
      suggestionsByMessageId.set(suggestion.messageId, list);
    }
    const aiSuggestionsByMessageId = new Map<number, typeof suggestionRows>();
    const aiSuggestionCountsByMessageId = new Map<number, number>();
    for (const [messageId, list] of suggestionsByMessageId) {
      aiSuggestionsByMessageId.set(messageId, list.slice(0, 3));
      aiSuggestionCountsByMessageId.set(messageId, list.length);
    }
    batch.prayer = { aiSettings, sourceMessages, actionsByMessageId, aiSuggestionsByMessageId, aiSuggestionCountsByMessageId };
  }

  if (playlistIds.length) {
    batch.playlists = new Map(await Promise.all(playlistIds.map(async (id) => [id, await musicService.playlistDto(id, viewerAccountId)] as const)));
  }
  return batch;
}

app.get("/api/messages", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const query = request.query as { channelId?: string; before?: string; after?: string; limit?: string; prayers?: string };
  const channelId = Number(query.channelId || 0);
  if (!channelId || !(await canAccessChannel(auth.accountId, channelId))) return reply.code(403).send({ success: false, message: "无权访问此频道" });
  const limit = Math.min(Math.max(Number(query.limit || 50), 1), 200);
  const before = Number(query.before || 0);
  const after = Number(query.after || 0);
  const where = {
    channelId,
    ...(query.prayers === "1" ? { type: "prayer" as const } : {}),
    ...(after > 0 ? { id: { gt: after } } : before > 0 ? { id: { lt: before } } : {})
  };
  const rows = await prisma.message.findMany({
    where,
    include: {
      sender: true,
      replyTo: { include: { sender: true } },
      likes: { include: { account: { select: { displayName: true, avatarPath: true } } }, orderBy: { createdAt: "asc" } },
      favorites: { select: { accountId: true } }
    },
    orderBy: { id: after > 0 ? "asc" : "desc" },
    take: limit
  });
  const filteredRows = query.prayers === "1" ? rows.filter((message) => !isPrayerUpdateMessage(message)) : rows;
  const orderedRows = after > 0 ? filteredRows : filteredRows.reverse();
  const batch = await buildMessageSerializeBatch(orderedRows, channelId, auth.accountId);
  const messages = await Promise.all(orderedRows.map((message) => serializeMessage(message, auth.accountId, batch)));
  return { messages };
});

async function broadcastMessageReactions(messageId: number, accountId?: number) {
  const dto = await hydrateMessage(messageId, accountId);
  if (!dto?.reactions) return null;
  const publicReaction = {
    likeCount: dto.reactions.likeCount,
    likedBy: dto.reactions.likedBy,
    favoriteCount: dto.reactions.favoriteCount
  };
  io.to(`ch:${dto.channelId}`).emit("message:reaction", { messageId, channelId: dto.channelId, reactions: publicReaction });
  if (accountId) io.to(`acct:${accountId}`).emit("message:reaction", { messageId, channelId: dto.channelId, reactions: dto.reactions });
  return dto.reactions;
}

app.put("/api/messages/:messageId/like", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const pushOrigin = pushOriginFromHeaders(request.headers);
  const messageId = Number((request.params as { messageId: string }).messageId);
  const body = z.object({ liked: z.boolean() }).parse(request.body);
  const message = await prisma.message.findUnique({ where: { id: messageId }, include: { sender: true } });
  if (!message || !(await canAccessChannel(auth.accountId, message.channelId))) return reply.code(404).send({ success: false, message: "消息不存在" });
  const key = { messageId_accountId: { messageId, accountId: auth.accountId } };
  const existing = await prisma.messageLike.findUnique({ where: key });
  let notification = null;
  if (body.liked) {
    const like = await prisma.messageLike.upsert({
      where: key,
      create: { messageId, accountId: auth.accountId },
      update: { dismissedAt: null }
    });
    if (!existing && message.sender.accountId && message.sender.accountId !== auth.accountId) {
      const liker = await prisma.account.findUnique({ where: { id: auth.accountId }, select: { displayName: true } });
      notification = {
        id: like.id,
        channelId: message.channelId,
        messageId,
        senderName: message.sender.displayName,
        likerName: liker?.displayName || auth.username,
        createdAt: like.createdAt.toISOString()
      };
      io.to(`acct:${message.sender.accountId}`).emit("message:liked", notification);
      await sendLikePush(message.sender.accountId, message.channelId, messageId, notification.likerName, pushOrigin);
    }
  } else if (existing) {
    await prisma.messageLike.delete({ where: key });
  }
  const reactions = await broadcastMessageReactions(messageId, auth.accountId);
  return { success: true, reactions, notification };
});

app.put("/api/messages/:messageId/favorite", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const messageId = Number((request.params as { messageId: string }).messageId);
  const body = z.object({ favorited: z.boolean() }).parse(request.body);
  const message = await prisma.message.findUnique({ where: { id: messageId }, select: { channelId: true } });
  if (!message || !(await canAccessChannel(auth.accountId, message.channelId))) return reply.code(404).send({ success: false, message: "消息不存在" });
  const key = { messageId_accountId: { messageId, accountId: auth.accountId } };
  if (body.favorited) {
    await prisma.messageFavorite.upsert({ where: key, create: { messageId, accountId: auth.accountId }, update: {} });
  } else {
    await prisma.messageFavorite.deleteMany({ where: { messageId, accountId: auth.accountId } });
  }
  const reactions = await broadcastMessageReactions(messageId, auth.accountId);
  return { success: true, reactions };
});

app.post("/api/messages/:messageId/forward", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const pushOrigin = pushOriginFromHeaders(request.headers);
  const messageId = Number((request.params as { messageId: string }).messageId);
  const body = z.object({ channelIds: z.array(z.number().int().positive()).min(1).max(50) }).parse(request.body);
  const source = await prisma.message.findUnique({
    where: { id: messageId },
    include: { musicScores: { orderBy: { id: "asc" }, include: { pages: { orderBy: { pageIndex: "asc" } } } }, musicLyrics: true }
  });
  if (!source || !(await canAccessChannel(auth.accountId, source.channelId))) {
    return reply.code(404).send({ success: false, message: "音频消息不存在" });
  }
  if (source.type !== "file" || !source.filePath || !/\.(webm|mp3|m4a|wav|ogg|aac)$/i.test(source.fileName || "")) {
    return reply.code(400).send({ success: false, message: "只能转发音频消息" });
  }
  const channelIds = [...new Set(body.channelIds)].filter((channelId) => channelId !== source.channelId);
  if (!channelIds.length) return reply.code(400).send({ success: false, message: "请选择其他群" });
  const targetChannels = await prisma.channel.findMany({
    where: { id: { in: channelIds }, kind: "standard", directKey: null },
    select: { id: true }
  });
  if (targetChannels.length !== channelIds.length) return reply.code(400).send({ success: false, message: "目标群不存在或不支持转发" });
  for (const channelId of channelIds) {
    if (!(await canWriteChannel(auth.accountId, channelId))) return reply.code(403).send({ success: false, message: "无权在所选群发言" });
  }
  const sourcePath = path.join(UPLOAD_DIR, path.basename(source.filePath));
  if (!fs.existsSync(sourcePath)) return reply.code(404).send({ success: false, message: "音频文件不存在" });
  const missingScorePage = source.musicScores
    .flatMap((score) => score.pages)
    .find((page) => !fs.existsSync(path.join(MUSIC_SCORE_DIR, path.basename(page.filePath))));
  if (missingScorePage) return reply.code(404).send({ success: false, message: `曲谱文件不存在：${missingScorePage.fileName}` });
  const extension = path.extname(source.filePath).toLowerCase() || path.extname(source.fileName || "").toLowerCase() || ".bin";
  const copies = channelIds.map((channelId) => ({
    channelId,
    filePath: `${crypto.randomUUID()}${extension}`,
    scores: source.musicScores.map((score) => ({
      title: score.title,
      uploadedByAccountId: score.uploadedByAccountId,
      pages: score.pages.map((page) => ({
        pageIndex: page.pageIndex,
        fileName: page.fileName,
        filePath: `${crypto.randomUUID()}${path.extname(page.filePath).toLowerCase() || ".webp"}`,
        fileSize: page.fileSize,
        width: page.width,
        height: page.height,
        sourcePath: path.join(MUSIC_SCORE_DIR, path.basename(page.filePath))
      }))
    }))
  }));
  try {
    for (const copy of copies) {
      await fs.promises.copyFile(sourcePath, path.join(UPLOAD_DIR, copy.filePath));
      for (const score of copy.scores) {
        for (const page of score.pages) await fs.promises.copyFile(page.sourcePath, path.join(MUSIC_SCORE_DIR, page.filePath));
      }
    }
    const created = await prisma.$transaction(
      copies.map((copy) =>
        prisma.message.create({
          data: {
            channelId: copy.channelId,
            senderActorId: auth.actorId,
            content: source.content || "",
            type: "file",
            ...(source.payload === null ? {} : { payload: source.payload as Prisma.InputJsonValue }),
            fileName: source.fileName,
            filePath: copy.filePath,
            fileSize: source.fileSize,
            musicScores: {
              create: copy.scores.map(({ pages, ...score }) => ({
                ...score,
                pages: { create: pages.map(({ sourcePath: _sourcePath, ...page }) => page) }
              }))
            },
            ...(source.musicLyrics
              ? {
                  musicLyrics: {
                    create: {
                      fileName: source.musicLyrics.fileName,
                      content: source.musicLyrics.content,
                      uploadedByAccountId: source.musicLyrics.uploadedByAccountId
                    }
                  }
                }
              : {})
          },
          include: { musicScores: { orderBy: { id: "asc" }, include: { pages: { orderBy: { pageIndex: "asc" } } } }, musicLyrics: true }
        })
      )
    );
    for (const message of created) {
      await emitMessage(message.id).catch((error) => request.log.warn({ error, messageId: message.id }, "forwarded message emit failed"));
      void sendMessagePush(message.id, pushOrigin).catch((error) => request.log.warn({ error, messageId: message.id }, "forwarded message push failed"));
    }
    return { success: true, forwarded: created.length };
  } catch (error) {
    for (const copy of copies) {
      const copiedPath = path.join(UPLOAD_DIR, copy.filePath);
      if (fs.existsSync(copiedPath)) fs.unlinkSync(copiedPath);
      for (const score of copy.scores) {
        for (const page of score.pages) {
          const copiedScorePath = path.join(MUSIC_SCORE_DIR, page.filePath);
          if (fs.existsSync(copiedScorePath)) fs.unlinkSync(copiedScorePath);
        }
      }
    }
    request.log.error({ error, sourceMessageId: source.id }, "audio forward failed");
    return reply.code(500).send({ success: false, message: "转发失败，请稍后重试" });
  }
});

app.get("/api/favorites", { preHandler: requireAuth }, async (request) => {
  const auth = (request as AuthedRequest).auth;
  const rows = await prisma.messageFavorite.findMany({
    where: { accountId: auth.accountId },
    include: {
      message: {
        include: {
          sender: true,
          channel: { select: { id: true, name: true } },
          replyTo: { include: { sender: true } },
          likes: { include: { account: { select: { displayName: true, avatarPath: true } } }, orderBy: { createdAt: "asc" } },
          favorites: { select: { accountId: true } }
        }
      }
    },
    orderBy: { createdAt: "desc" },
    take: 200
  });
  const visible = [];
  for (const favorite of rows) {
    if (!(await canAccessChannel(auth.accountId, favorite.message.channelId))) continue;
    visible.push({
      id: favorite.id,
      savedAt: favorite.createdAt.toISOString(),
      channel: favorite.message.channel,
      message: await serializeMessage(favorite.message, auth.accountId)
    });
  }
  return { favorites: visible };
});

app.get("/api/like-notifications", { preHandler: requireAuth }, async (request) => {
  const auth = (request as AuthedRequest).auth;
  const rows = await prisma.messageLike.findMany({
    where: {
      dismissedAt: null,
      accountId: { not: auth.accountId },
      message: { sender: { accountId: auth.accountId } }
    },
    include: { account: { select: { displayName: true } }, message: { include: { sender: true } } },
    orderBy: { createdAt: "desc" },
    take: 20
  });
  return {
    notifications: rows.map((like) => ({
      id: like.id,
      channelId: like.message.channelId,
      messageId: like.messageId,
      senderName: like.message.sender.displayName,
      likerName: like.account.displayName,
      createdAt: like.createdAt.toISOString()
    }))
  };
});

app.patch("/api/like-notifications/:id/dismiss", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const id = Number((request.params as { id: string }).id);
  const like = await prisma.messageLike.findUnique({ where: { id }, include: { message: { include: { sender: true } } } });
  if (!like || like.message.sender.accountId !== auth.accountId) return reply.code(404).send({ success: false, message: "提醒不存在" });
  await prisma.messageLike.update({ where: { id }, data: { dismissedAt: new Date() } });
  return { success: true };
});

// Process-level cache for link previews: without it every client refetches
// the same outbound URL on each cold start. Successes live 30 minutes,
// failures get a short negative TTL; the map is capped with oldest-first
// eviction (insertion order).
const LINK_PREVIEW_CACHE_TTL_MS = 30 * 60 * 1000;
const LINK_PREVIEW_ERROR_TTL_MS = 60 * 1000;
const LINK_PREVIEW_CACHE_LIMIT = 500;
const linkPreviewServerCache = new Map<string, { expiresAt: number; payload?: unknown; error?: string }>();

function rememberLinkPreview(url: string, entry: { expiresAt: number; payload?: unknown; error?: string }) {
  linkPreviewServerCache.delete(url);
  linkPreviewServerCache.set(url, entry);
  while (linkPreviewServerCache.size > LINK_PREVIEW_CACHE_LIMIT) {
    const oldest = linkPreviewServerCache.keys().next().value;
    if (oldest === undefined) break;
    linkPreviewServerCache.delete(oldest);
  }
}

app.get("/api/link-preview", { preHandler: requireAuth }, async (request, reply) => {
  const query = request.query as { url?: string };
  const url = String(query.url || "");
  const cached = linkPreviewServerCache.get(url);
  if (cached && cached.expiresAt > Date.now()) {
    if (cached.error) return reply.code(400).send({ success: false, message: cached.error });
    return cached.payload;
  }
  try {
    const payload = await fetchLinkPreview(url);
    rememberLinkPreview(url, { expiresAt: Date.now() + LINK_PREVIEW_CACHE_TTL_MS, payload });
    return payload;
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法生成网页预览";
    rememberLinkPreview(url, { expiresAt: Date.now() + LINK_PREVIEW_ERROR_TTL_MS, error: message });
    return reply.code(400).send({ success: false, message });
  }
});

app.post("/api/messages", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const pushOrigin = pushOriginFromHeaders(request.headers);
  const body = z
    .object({
      channelId: z.number(),
      content: z.string().optional(),
      replyToId: z.number().nullable().optional(),
      type: z.enum(["text", "chain", "prayer"]).default("text"),
      payload: z.unknown().optional(),
      chainTopic: z.string().optional(),
      chainText: z.string().optional(),
      chainRootId: z.number().optional()
    })
    .parse(request.body);
  if (!(await canWriteChannel(auth.accountId, body.channelId))) return reply.code(403).send({ success: false, message: "无权在此频道发言" });
  if (await isMusicChannel(body.channelId)) return reply.code(400).send({ success: false, message: "音乐频道只能上传 MP3 和 M4A 文件" });
  const actor = await prisma.actor.findUniqueOrThrow({ where: { id: auth.actorId } });
  if (body.type === "chain") {
    let payload: ChainPayload;
    let rootId = body.chainRootId || null;
    let version = 1;
    if (body.chainRootId) {
      const root = await prisma.message.findFirst({ where: { id: body.chainRootId, channelId: body.channelId, type: "chain" }, orderBy: { id: "desc" } });
      if (!root) return reply.code(404).send({ success: false, message: "接龙不存在" });
      rootId = root.chainRootId || root.id;
      const latest = await prisma.message.findFirst({
        where: { channelId: body.channelId, type: "chain", OR: [{ id: rootId }, { chainRootId: rootId }] },
        orderBy: { id: "desc" }
      });
      payload = (latest?.payload as unknown as ChainPayload) || { topic: "接龙", participants: [] };
      version = (latest?.chainVersion || 1) + 1;
    } else {
      payload = { topic: body.chainTopic || "接龙", participants: [] };
    }
    payload.participants = Array.isArray(payload.participants) ? payload.participants : [];
    if (payload.participants.some((p) => p.actorId === actor.id)) {
      return reply.code(409).send({ success: false, message: "你已经参与过这个接龙" });
    }
    payload.participants.push({ actorId: actor.id, name: actor.displayName, text: body.chainText || "", at: new Date().toISOString() });
    const created = await createMessageFromActor({
      channelId: body.channelId,
      actorId: actor.id,
      content: payload.topic,
      type: "chain",
      payload,
      replyToId: body.replyToId || null,
      chainRootId: rootId,
      chainVersion: version,
      pushOrigin
    });
    if (!rootId) await prisma.message.update({ where: { id: created.id }, data: { chainRootId: created.id } });
    return { success: true, message: await hydrateMessage(created.id) };
  }
  const content = cleanText(body.content);
  if (!content.replace(/<[^>]*>/g, "").trim() && !/<br\s*\/?>/i.test(content)) return reply.code(400).send({ success: false, message: "消息不能为空" });
  if (body.type === "prayer") {
    const payload = cleanPrayerPayload(body.payload);
    if (payload.imageMessageId && !(await isValidPrayerImageMessage(payload.imageMessageId, body.channelId))) {
      return reply.code(400).send({ success: false, message: "附带照片无效" });
    }
    const message = await createMessageFromActor({
      channelId: body.channelId,
      actorId: auth.actorId,
      content,
      type: "prayer",
      payload,
      replyToId: body.replyToId || null,
      pushOrigin
    });
    return { success: true, message: await hydrateMessage(message.id, auth.accountId) };
  }
  const message = await createMessageFromActor({
    channelId: body.channelId,
    actorId: auth.actorId,
    content,
    type: "text",
    payload: await cleanTextMessagePayload(body.payload),
    replyToId: body.replyToId || null,
    pushOrigin
  });
  return { success: true, message: await hydrateMessage(message.id) };
});

app.post("/api/files/upload", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const pushOrigin = pushOriginFromHeaders(request.headers);
  const file = await request.file();
  if (!file) return reply.code(400).send({ success: false, message: "缺少文件" });
  const fields = file.fields as Record<string, { value?: string }>;
  const channelId = Number(fields.channelId?.value || 0);
  if (!channelId || !(await canWriteChannel(auth.accountId, channelId))) return reply.code(403).send({ success: false, message: "无权上传" });
  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { kind: true } });
  const rawExt = path.extname(file.filename).toLowerCase();
  const ext = rawExt || ".bin";
  const voicePayload = parseVoiceUploadPayload(fields, file.mimetype);
  if (channel?.kind === "music" && (voicePayload || !MUSIC_EXTENSIONS.has(ext))) {
    file.file.resume();
    return reply.code(400).send({ success: false, message: "音乐频道只支持上传 MP3 和 M4A 文件" });
  }
  const safeName = `${crypto.randomUUID()}${ext}`;
  const outPath = path.join(UPLOAD_DIR, safeName);
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createWriteStream(outPath);
    file.file.pipe(stream);
    file.file.on("error", reject);
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
  const uploadContentHash = await sha256File(outPath);
  let storedFileName = safeName;
  let displayFileName = file.filename;
  let stat = fs.statSync(outPath);
  if (channel?.kind === "music" && !isStoredMusicFile(outPath, ext)) {
    safeUnlink("upload", safeName);
    return reply.code(400).send({ success: false, message: "音频文件内容无效，仅支持 MP3 和 M4A" });
  }
  const isImageUpload = file.mimetype.startsWith("image/") && isImageFileName(file.filename);
  if (isImageUpload && !(await validateStoredImage(outPath))) {
    safeUnlink("upload", safeName);
    return reply.code(400).send({ success: false, message: "图片内容无效或尺寸过大" });
  }
  if (isImageUpload && !wantsOriginalImage(fields)) {
    const compressed = await compressImageFile(outPath, UPLOAD_DIR);
    if (compressed) {
      fs.unlinkSync(outPath);
      storedFileName = compressed.fileName;
      displayFileName = displayWebpFileName(file.filename);
      stat = fs.statSync(compressed.filePath);
    }
  }
  if (voicePayload && isAudioFileName(file.filename)) {
    const transcodedName = `${crypto.randomUUID()}.m4a`;
    const transcodedPath = path.join(UPLOAD_DIR, transcodedName);
    try {
      await transcodeVoiceToM4a(outPath, transcodedPath);
      fs.unlinkSync(outPath);
      storedFileName = transcodedName;
      displayFileName = `${path.basename(file.filename, ext)}.m4a`;
      stat = fs.statSync(transcodedPath);
      voicePayload.mimeType = "audio/mp4";
    } catch (error) {
      if (fs.existsSync(transcodedPath)) fs.unlinkSync(transcodedPath);
      request.log.warn({ error }, "voice transcode failed; storing original audio");
    }
  }
  const preferredMusicFiles = channel?.kind === "music"
    ? (await prisma.message.findMany({
        where: { channel: { kind: "music" }, type: "file", filePath: { not: null } },
        select: { filePath: true }
      })).flatMap((message) => (message.filePath ? [message.filePath] : []))
    : [];
  const deduplicated = await deduplicateStoredUpload({
    directory: UPLOAD_DIR,
    candidatePath: path.join(UPLOAD_DIR, storedFileName),
    contentHash: uploadContentHash,
    preferredFileNames: preferredMusicFiles
  });
  storedFileName = deduplicated.storedFileName;
  stat = fs.statSync(path.join(UPLOAD_DIR, storedFileName));
  const imageDimensions = isImageUpload ? await storedImageDimensions(path.join(UPLOAD_DIR, storedFileName)) : undefined;
  if (isImageUpload) await writeImageThumbnail(path.join(UPLOAD_DIR, storedFileName));
  if (channel?.kind === "music" && deduplicated.duplicate) {
    const existingTrack = await prisma.message.findFirst({
      where: { channel: { kind: "music" }, type: "file", filePath: storedFileName },
      orderBy: { id: "asc" },
      select: { id: true }
    });
    if (existingTrack) {
      return { success: true, duplicate: true, skipped: true, message: await hydrateMessage(existingTrack.id) };
    }
  }
  const type: MessageType = isImageUpload ? "image" : "file";
  const message = await createMessageFromActor({
    channelId,
    actorId: auth.actorId,
    content: "",
    type,
    payload: imageDimensions ? { ...mergeImageDimensionsPayload(voicePayload, imageDimensions), imageDimensionsVersion: 2 } : voicePayload,
    fileName: displayFileName,
    filePath: storedFileName,
    fileSize: stat.size,
    pushOrigin
  });
  if (!voicePayload && isAudioFileName(displayFileName)) void enrichAudioMessageWaveform(message.id, storedFileName);
  if (channel?.kind === "music") io.emit("music:updated", { action: "created", trackId: message.id });
  return { success: true, duplicate: deduplicated.duplicate, skipped: false, message: await hydrateMessage(message.id) };
});

app.post("/api/messages/:messageId/voice-listened", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const messageId = Number((request.params as { messageId: string }).messageId);
  const message = await prisma.message.findUnique({ where: { id: messageId }, include: { sender: true } });
  if (!message || !isVoiceMessage(message)) return reply.code(404).send({ success: false, message: "语音不存在" });
  if (!(await canAccessChannel(auth.accountId, message.channelId))) return reply.code(403).send({ success: false, message: "无权访问语音" });
  if (message.sender.accountId !== auth.accountId) {
    await prisma.voiceListen.upsert({
      where: { messageId_accountId: { messageId, accountId: auth.accountId } },
      update: { listenedAt: new Date() },
      create: { messageId, accountId: auth.accountId }
    });
  }
  io.to(`acct:${auth.accountId}`).emit("voice:listened", { messageId });
  return { success: true };
});

app.post("/api/messages/:messageId/prayed", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const messageId = Number((request.params as { messageId: string }).messageId);
  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message || message.type !== "prayer") return reply.code(404).send({ success: false, message: "代祷事项不存在" });
  if (!(await canAccessChannel(auth.accountId, message.channelId))) return reply.code(403).send({ success: false, message: "无权访问此代祷" });
  const target = await canonicalPrayerMessage(message);
  const raw = prayerPayloadRaw(target.payload);
  if (cleanPrayerStatus(raw.status) !== "active") return reply.code(409).send({ success: false, message: "此代祷已结束" });
  await prisma.prayerAction.create({ data: { messageId: target.id, accountId: auth.accountId } });
  const dto = await hydrateMessage(messageId, auth.accountId);
  if (dto) io.to(`ch:${message.channelId}`).emit("message:updated", dto);
  return { success: true, message: dto };
});

app.patch("/api/messages/:messageId/prayer-status", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const messageId = Number((request.params as { messageId: string }).messageId);
  const body = z.object({ status: z.enum(["closed", "answered"]) }).parse(request.body);
  const message = await prisma.message.findUnique({ where: { id: messageId }, include: { sender: true } });
  if (!message || message.type !== "prayer") return reply.code(404).send({ success: false, message: "代祷事项不存在" });
  const target = await canonicalPrayerMessage(message);
  const sender = target.id === message.id ? message.sender : await prisma.actor.findUnique({ where: { id: target.senderActorId } });
  if (sender?.accountId !== auth.accountId && !auth.isAdmin) return reply.code(403).send({ success: false, message: "只有发起者可以更新此代祷" });
  const raw = prayerPayloadRaw(target.payload);
  const payload = {
    ...raw,
    kind: "prayer",
    status: body.status,
    statusAt: new Date().toISOString(),
    statusBy: auth.username
  };
  await prisma.message.update({ where: { id: target.id }, data: { payload: payload as Prisma.InputJsonObject } });
  const dto = await hydrateMessage(messageId, auth.accountId);
  if (dto) io.to(`ch:${message.channelId}`).emit("message:updated", dto);
  return { success: true, message: dto };
});

app.post("/api/messages/:messageId/prayer-update", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const pushOrigin = pushOriginFromHeaders(request.headers);
  const messageId = Number((request.params as { messageId: string }).messageId);
  const body = z.object({ content: z.string().max(10000).optional(), imageMessageId: z.number().nullable().optional() }).parse(request.body || {});
  const message = await prisma.message.findUnique({ where: { id: messageId }, include: { sender: true } });
  if (!message || message.type !== "prayer") return reply.code(404).send({ success: false, message: "代祷事项不存在" });
  if (!(await canAccessChannel(auth.accountId, message.channelId))) return reply.code(403).send({ success: false, message: "无权访问此代祷" });
  const source = await canonicalPrayerMessage(message);
  const sourceSender = source.id === message.id ? message.sender : await prisma.actor.findUnique({ where: { id: source.senderActorId } });
  if (sourceSender?.accountId !== auth.accountId && !auth.isAdmin) return reply.code(403).send({ success: false, message: "只有发起者可以更新此代祷" });
  const content = cleanText(body.content ?? source.content ?? "");
  if (!content.replace(/<[^>]*>/g, "").trim() && !/<br\s*\/?>/i.test(content)) return reply.code(400).send({ success: false, message: "代祷内容不能为空" });
  const raw = prayerPayloadRaw(source.payload);
  const newImageMessageId = body.imageMessageId ? Number(body.imageMessageId) : 0;
  if (newImageMessageId && !(await isValidPrayerImageMessage(newImageMessageId, source.channelId))) {
    return reply.code(400).send({ success: false, message: "附带照片无效" });
  }
  const previousImageMessageId = Number(raw.imageMessageId || 0);
  const updates = prependPrayerUpdateHistory(
    raw,
    source.content ?? "",
    typeof raw.latestUpdateAt === "string" ? raw.latestUpdateAt : source.createdAt.toISOString(),
    typeof raw.latestUpdateBy === "string" ? raw.latestUpdateBy : sourceSender?.username,
    Number.isInteger(previousImageMessageId) && previousImageMessageId > 0 ? previousImageMessageId : undefined
  );
  const sourcePayload = {
    ...raw,
    kind: "prayer",
    latestUpdateAt: new Date().toISOString(),
    latestUpdateBy: auth.username,
    imageMessageId: newImageMessageId > 0 ? newImageMessageId : null,
    updates
  };
  await prisma.message.update({
    where: { id: source.id },
    data: {
      content,
      payload: sourcePayload as Prisma.InputJsonObject
    }
  });
  const sourceDto = await hydrateMessage(source.id);
  if (sourceDto) io.to(`ch:${source.channelId}`).emit("message:updated", sourceDto);
  const actor = await prisma.actor.findUniqueOrThrow({ where: { id: auth.actorId } });
  const updateMessage = await createMessageFromActor({
    channelId: source.channelId,
    actorId: actor.id,
    content,
    type: "prayer",
    payload: {
      ...sourcePayload,
      kind: "prayer",
      sourcePrayerMessageId: source.id,
    },
    skipPush: true,
    skipEngineEvent: true
  });
  void sendPrayerUpdatePush(updateMessage.id, pushOrigin).catch((error) => app.log.warn({ error }, "prayer update push failed"));
  return { success: true, message: await hydrateMessage(updateMessage.id, auth.accountId) };
});

app.delete("/api/messages/:messageId/prayer", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const messageId = Number((request.params as { messageId: string }).messageId);
  const message = await prisma.message.findUnique({ where: { id: messageId }, include: { sender: true } });
  if (!message || message.type !== "prayer") return reply.code(404).send({ success: false, message: "代祷事项不存在" });
  if (message.sender.accountId !== auth.accountId && !auth.isAdmin) return reply.code(403).send({ success: false, message: "只有发起者可以撤回此代祷" });
  const deleted = await deleteMessages([{ id: message.id, channelId: message.channelId, filePath: message.filePath }]);
  return { success: true, deleted };
});

app.post("/api/messages/:messageId/recall", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const messageId = Number((request.params as { messageId: string }).messageId);
  const message = await prisma.message.findUnique({ where: { id: messageId }, include: { sender: true } });
  if (!message || message.type === "system") return reply.code(404).send({ success: false, message: "消息不存在" });
  if (await isMusicChannel(message.channelId)) return reply.code(400).send({ success: false, message: "请使用音乐频道的删除歌曲功能" });
  if (!(await canAccessChannel(auth.accountId, message.channelId))) return reply.code(403).send({ success: false, message: "无权访问此消息" });
  if (message.sender.accountId !== auth.accountId) return reply.code(403).send({ success: false, message: "只能撤回自己发送的消息" });
  if (Date.now() - message.createdAt.getTime() > 2 * 60 * 1000) return reply.code(409).send({ success: false, message: "只能撤回 2 分钟内的消息" });
  await prisma.$transaction([
    prisma.pinnedItem.updateMany({ where: { messageId }, data: { active: false, messageId: null } }),
    prisma.message.updateMany({ where: { replyToId: messageId }, data: { replyToId: null } }),
    prisma.voiceListen.deleteMany({ where: { messageId } }),
    prisma.musicPlaylistShare.deleteMany({ where: { messageId } }),
    prisma.prayerAction.deleteMany({ where: { messageId } }),
    prisma.messageAiSuggestion.deleteMany({ where: { messageId } }),
    prisma.message.update({
      where: { id: messageId },
      data: recalledMessageData(message.sender.displayName)
    })
  ]);
  if (message.filePath) safeUnlink("upload", message.filePath);
  const recalled = await hydrateMessage(messageId, auth.accountId);
  if (recalled) io.to(`ch:${message.channelId}`).emit("message:updated", recalled);
  return { success: true };
});

const musicProgressTracker = registerMusicRoutes(app, {
  prisma,
  io,
  musicService,
  requireAuth,
  requireMediaAuth,
  uploadDir: UPLOAD_DIR,
  musicScoreDir: MUSIC_SCORE_DIR,
  appVersion: APP_VERSION,
  imageWebpEffort: IMAGE_WEBP_EFFORT,
  canAccessChannel,
  canWriteChannel,
  serializeMessage,
  hydrateMessage,
  emitMessage,
  sendMessagePush,
  deleteMessages,
  writeActivityLog,
  applyFileResponseHeaders,
  applyFileValidation,
  isAudioFileName,
  displayWebpFileName,
  safeUnlinkMusicScore
});
const friendFeedService = createFriendFeedService({ cacheDir: path.join(STORAGE_ROOT, "friend-cache") });

registerFriendRoutes(app, {
  requireAuth,
  requireMediaAuth,
  feedService: friendFeedService,
  prisma
});

registerUnreadCountsRoutes(app, {
  requireAuth,
  prisma,
  channelListWhere
});
app.get("/api/files/:messageId", { preHandler: requireMediaAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const messageId = Number((request.params as { messageId: string }).messageId);
  const query = request.query as { download?: string; thumb?: string };
  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message?.filePath) return reply.code(404).send({ success: false, message: "文件不存在" });
  if (!(await canAccessChannel(auth.accountId, message.channelId))) return reply.code(403).send({ success: false, message: "无权访问文件" });
  let filePath = path.join(UPLOAD_DIR, path.basename(message.filePath));
  // Bubble rendering asks for the thumbnail variant; fall back to the
  // original for older uploads that predate thumbnail generation.
  const servingThumb = query.thumb === "1" && fs.existsSync(`${filePath}.thumb.webp`);
  if (servingThumb) filePath = `${filePath}.thumb.webp`;
  if (!fs.existsSync(filePath)) return reply.code(404).send({ success: false, message: "文件不存在" });
  const stat = fs.statSync(filePath);
  const range = request.headers.range;
  const fileName = message.fileName || message.filePath;
  reply.header("Accept-Ranges", "bytes");
  applyFileResponseHeaders(reply, servingThumb ? displayWebpFileName(fileName) : fileName, query.download === "1");
  if (applyFileValidation(request, reply, stat)) return reply.code(304).send();
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
      if (Number.isFinite(start) && Number.isFinite(end) && start <= end && start < stat.size) {
        reply.code(206);
        reply.header("Content-Range", `bytes ${start}-${end}/${stat.size}`);
        reply.header("Content-Length", String(end - start + 1));
        return reply.send(fs.createReadStream(filePath, { start, end }));
      }
    }
    reply.code(416);
    reply.header("Content-Range", `bytes */${stat.size}`);
    return reply.send();
  }
  reply.header("Content-Length", String(stat.size));
  return reply.send(fs.createReadStream(filePath));
});

async function appearanceDto() {
  const rows = await prisma.setting.findMany({
    where: {
      key: {
        in: [
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
          "composerPromptGapSeconds"
        ]
      }
    }
  });
  const settings = new Map(rows.map((row) => [row.key, row.value]));
  const wallpaperFit = settings.get("wallpaperFit") || "cover";
  const loginBackgroundFit = settings.get("loginBackgroundFit") || "cover";
  const loginFormPosition = settings.get("loginFormPosition") || "middle";
  const parallaxKit = settings.get("parallaxKit") || "none";
  const parallaxSpeed = cleanParallaxSpeed(settings.get("parallaxSpeed"));
  const parallaxKits = cleanParallaxKits(parseJsonField(settings.get("parallaxKits"), undefined));
  return {
    appTitle: settings.get("appTitle") || DEFAULT_APP_TITLE,
    appIconPath: settings.get("appIconPath") || null,
    wallpaperPath: settings.get("wallpaperPath") || null,
    wallpaperFit: WALLPAPER_FITS.has(wallpaperFit) ? wallpaperFit : "cover",
    wallpaperPanFocusX: cleanWallpaperPanFocusX(settings.get("wallpaperPanFocusX")),
    wallpaperPanDirection: cleanWallpaperPanDirection(settings.get("wallpaperPanDirection")),
    wallpaperPanSpeed: cleanWallpaperPanSpeed(settings.get("wallpaperPanSpeed")),
    parallaxKit: parallaxKit === "none" || parallaxKits.some((kit) => kit.id === parallaxKit) ? parallaxKit : "none",
    parallaxSpeed,
    parallaxKits,
    loginIconPath: settings.get("loginIconPath") || null,
    loginShowIcon: settings.get("loginShowIcon") !== "false",
    loginTitle: settings.get("loginTitle") || DEFAULT_LOGIN_TITLE,
    loginSubtitle: settings.has("loginSubtitle") ? settings.get("loginSubtitle") || "" : DEFAULT_LOGIN_SUBTITLE,
    loginShowSubtitle: settings.get("loginShowSubtitle") !== "false",
    loginBackgroundPath: settings.get("loginBackgroundPath") || null,
    loginBackgroundFit: LOGIN_BACKGROUND_FITS.has(loginBackgroundFit) ? loginBackgroundFit : "cover",
    loginFormPosition: LOGIN_FORM_POSITIONS.has(loginFormPosition) ? loginFormPosition : "middle",
    registrationEnabled: settings.get("registrationEnabled") === "true",
    musicPanelFontSize: cleanMusicPanelFontSize(settings.get("musicPanelFontSize")),
    prayerBubbleMineColor: cleanHexColor(settings.get("prayerBubbleMineColor"), "#f0fbf1"),
    prayerBubbleOtherColor: cleanHexColor(settings.get("prayerBubbleOtherColor"), "#fffaf0"),
    flashEffect: cleanFlashEffect(parseJsonField(settings.get("flashEffect"), DEFAULT_FLASH_EFFECT)),
    customThemes: cleanCustomThemes(parseJsonField(settings.get("customThemes"), [])),
    composerPrompts: settings.has("composerPrompts")
      ? cleanComposerPrompts(parseJsonField(settings.get("composerPrompts"), []))
      : [...DEFAULT_COMPOSER_PROMPTS],
    composerPromptIntervalSeconds: cleanComposerPromptIntervalSeconds(settings.get("composerPromptIntervalSeconds")),
    composerPromptAppearSeconds: cleanComposerPromptAppearSeconds(
      settings.get("composerPromptAppearSeconds") ?? settings.get("composerPromptAnimSeconds")
    ),
    composerPromptDisappearSeconds: cleanComposerPromptDisappearSeconds(settings.get("composerPromptDisappearSeconds")),
    composerPromptGapSeconds: cleanComposerPromptGapSeconds(settings.get("composerPromptGapSeconds"))
  };
}

async function setSetting(key: string, value: string) {
  await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

async function settingBool(key: string, fallback = false) {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (!row) return fallback;
  return row.value === "true";
}

async function customThemesSetting() {
  const row = await prisma.setting.findUnique({ where: { key: "customThemes" } });
  return cleanCustomThemes(parseJsonField(row?.value, []));
}

async function aiSettingsDto() {
  const base = (await loadAiSettings(true)).value;
  const rows = await prisma.setting.findMany({
    where: {
      key: {
        in: [
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
        ]
      }
    }
  });
  const settings = new Map(rows.map((row) => [row.key, row.value]));
  const whyActor = await ensureWhyAssistantCharacter(settings.get("whyAssistantDisplayName") || WHY_ASSISTANT_NAME);
  const questionActor = await ensureAiRoleCharacter(QUESTION_ASSISTANT_USERNAME, QUESTION_ASSISTANT_NAME, settings.get("questionAssistantDisplayName") || QUESTION_ASSISTANT_NAME);
  const [whyCharacter, questionCharacter] = await Promise.all([
    prisma.virtualCharacter.findUnique({ where: { actorId: whyActor.id } }),
    prisma.virtualCharacter.findUnique({ where: { actorId: questionActor.id } })
  ]);
  const whyConfig = roleConfigDetails(whyCharacter?.config);
  const questionConfig = roleConfigDetails(questionCharacter?.config);
  const aiRoles: AiRoleDTO[] = [
    {
      username: WHY_ASSISTANT_USERNAME,
      displayName: whyActor.displayName,
      avatarPath: whyActor.avatarPath,
      enabled: settings.get("whyAssistantEnabled") !== "false",
      model: normalizeRoleModel(settings.get("whyAssistantModel")) || whyConfig.model,
      thinkingEnabled: settings.get("whyAssistantThinkingEnabled") === "true",
      promptCommand: settings.get("whyAssistantPromptCommand") || DEFAULT_WHY_ASSISTANT_PROMPT,
      shortTermMemory: whyConfig.shortTermMemory,
      midTermMemory: whyConfig.midTermMemory,
      longTermMemory: whyConfig.longTermMemory,
      channelIds: whyConfig.channelIds,
      activationJudgePrompt: settings.get("whyAssistantActivationJudgePrompt") || whyConfig.activationJudgePrompt,
      webSearchEnabled: settings.get("whyAssistantWebSearchEnabled") !== "false"
    },
    {
      username: QUESTION_ASSISTANT_USERNAME,
      displayName: questionActor.displayName,
      avatarPath: questionActor.avatarPath,
      enabled: settings.get("questionAssistantEnabled") !== "false",
      model: normalizeRoleModel(settings.get("questionAssistantModel")) || questionConfig.model,
      thinkingEnabled: settings.get("questionAssistantThinkingEnabled") === "true",
      promptCommand: settings.get("questionAssistantPromptCommand") || DEFAULT_QUESTION_ASSISTANT_PROMPT,
      shortTermMemory: questionConfig.shortTermMemory,
      midTermMemory: questionConfig.midTermMemory,
      longTermMemory: questionConfig.longTermMemory,
      channelIds: questionConfig.channelIds,
      activationJudgePrompt: settings.get("questionAssistantActivationJudgePrompt") || questionConfig.activationJudgePrompt || DEFAULT_QUESTION_ASSISTANT_JUDGE_PROMPT,
      webSearchEnabled: settings.get("questionAssistantWebSearchEnabled") !== "false",
      questionTriggerEnabled: settings.get("questionAssistantTriggerEnabled") !== "false",
      contextTurnLimit: clampInteger(settings.get("questionAssistantContextTurnLimit"), DEFAULT_QUESTION_ASSISTANT_CONTEXT_TURNS, 1, 50),
      contextWindowMinutes: clampInteger(settings.get("questionAssistantContextWindowMinutes"), DEFAULT_QUESTION_ASSISTANT_CONTEXT_WINDOW_MINUTES, 1, 1440)
    }
  ];
  return {
    ...base,
    whyAssistantEnabled: settings.get("whyAssistantEnabled") !== "false",
    whyAssistantWebSearchEnabled: settings.get("whyAssistantWebSearchEnabled") !== "false",
    whyAssistantPromptCommand: settings.get("whyAssistantPromptCommand") || DEFAULT_WHY_ASSISTANT_PROMPT,
    aiRoles
  };
}

function buildRelatedVersesContext(message: Message & { sender: Actor }, previousReferences: string[]) {
  const lines = [
    "上下文内容：",
    `代祷发起人：${message.sender.displayName}`,
    `代祷信息：${plainTextFromHtml(message.content, 2000) || "代祷事项"}`,
    "",
    previousReferences.length ? `已推荐过的出处：${previousReferences.join("；")}` : "已推荐过的出处：无",
    "",
    "请输出 3 行，每行只有一个经文出处。"
  ];
  return lines.join("\n").slice(0, 5000);
}

async function callDeepSeekBibleReferences(settings: AiSettingsDTO, apiKey: string, systemPrompt: string, contextText: string, limit: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${settings.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: contextText }
        ],
        thinking: { type: "disabled" },
        stream: false
      }),
      signal: controller.signal
    });
    const payload = (await response.json().catch(() => ({}))) as any;
    if (!response.ok) {
      const message = payload?.error?.message || payload?.message || `DeepSeek HTTP ${response.status}`;
      throw new Error(String(message));
    }
    const responseText = String(payload?.choices?.[0]?.message?.content || "").trim();
    if (!responseText) throw new Error("DeepSeek returned empty content");
    const references = parseAiVerseReferences(responseText, limit);
    if (!references.length) throw new Error("DeepSeek did not return verse references");
    return { responseText, references };
  } finally {
    clearTimeout(timeout);
  }
}

function callDeepSeekRelatedVerses(settings: AiSettingsDTO, apiKey: string, contextText: string) {
  return callDeepSeekBibleReferences(settings, apiKey, settings.promptCommand, contextText, 3);
}

app.get("/api/admin/ai-settings", { preHandler: requireAdmin }, async () => {
  return aiSettingsDto();
});

app.post("/api/admin/ai-settings", { preHandler: requireAdmin }, async (request) => {
  const body = z
    .object({
      enabled: z.boolean().optional(),
      apiKey: z.string().max(400).optional(),
      clearApiKey: z.boolean().optional(),
      promptCommand: z.string().max(4000).optional(),
      cardCooldownSeconds: z.number().min(0).max(3600).optional(),
      userLimitPerMinute: z.number().min(1).max(60).optional(),
      maxSuccessPerMessage: z.number().min(1).max(20).optional(),
      whyAssistantEnabled: z.boolean().optional(),
      whyAssistantWebSearchEnabled: z.boolean().optional(),
      whyAssistantPromptCommand: z.string().max(6000).optional(),
      aiRoles: z
        .array(
          z.object({
            username: z.string().max(80),
            displayName: z.string().min(1).max(80).optional(),
            enabled: z.boolean().optional(),
            model: z.string().max(120).optional(),
            thinkingEnabled: z.boolean().optional(),
            promptCommand: z.string().max(6000).optional(),
            shortTermMemory: z.string().max(8000).optional(),
            midTermMemory: z.string().max(8000).optional(),
            longTermMemory: z.string().max(8000).optional(),
            channelIds: z.array(z.number()).optional(),
            activationJudgePrompt: z.string().max(6000).optional(),
            webSearchEnabled: z.boolean().optional(),
            questionTriggerEnabled: z.boolean().optional(),
            contextTurnLimit: z.number().min(1).max(50).optional(),
            contextWindowMinutes: z.number().min(1).max(1440).optional()
          })
        )
        .optional()
    })
    .parse(request.body);
  if (Object.prototype.hasOwnProperty.call(body, "enabled")) await setSetting("aiRelatedVersesEnabled", body.enabled ? "true" : "false");
  if (body.clearApiKey) await setSetting("aiDeepSeekApiKeyEncrypted", "");
  if (body.apiKey?.trim()) await setSetting("aiDeepSeekApiKeyEncrypted", encryptAiApiKey(body.apiKey.trim()));
  if (Object.prototype.hasOwnProperty.call(body, "promptCommand")) await setSetting("aiRelatedVersesPromptCommand", (body.promptCommand || "").trim() || DEFAULT_AI_PROMPT_COMMAND);
  if (Object.prototype.hasOwnProperty.call(body, "cardCooldownSeconds")) await setSetting("aiRelatedVersesCardCooldownSeconds", String(clampInteger(body.cardCooldownSeconds, DEFAULT_AI_SETTINGS.cardCooldownSeconds, 0, 3600)));
  if (Object.prototype.hasOwnProperty.call(body, "userLimitPerMinute")) await setSetting("aiRelatedVersesUserLimitPerMinute", String(clampInteger(body.userLimitPerMinute, DEFAULT_AI_SETTINGS.userLimitPerMinute, 1, 60)));
  if (Object.prototype.hasOwnProperty.call(body, "maxSuccessPerMessage")) await setSetting("aiRelatedVersesMaxSuccessPerMessage", String(clampInteger(body.maxSuccessPerMessage, DEFAULT_AI_SETTINGS.maxSuccessPerMessage, 1, 20)));
  if (Object.prototype.hasOwnProperty.call(body, "whyAssistantEnabled")) await setSetting("whyAssistantEnabled", body.whyAssistantEnabled ? "true" : "false");
  if (Object.prototype.hasOwnProperty.call(body, "whyAssistantWebSearchEnabled")) await setSetting("whyAssistantWebSearchEnabled", body.whyAssistantWebSearchEnabled ? "true" : "false");
  if (Object.prototype.hasOwnProperty.call(body, "whyAssistantPromptCommand")) await setSetting("whyAssistantPromptCommand", (body.whyAssistantPromptCommand || "").trim() || DEFAULT_WHY_ASSISTANT_PROMPT);
  for (const role of body.aiRoles || []) {
    if (role.username === WHY_ASSISTANT_USERNAME) {
      const displayName = (role.displayName || "").trim() || WHY_ASSISTANT_NAME;
      await setSetting("whyAssistantDisplayName", displayName);
      if (Object.prototype.hasOwnProperty.call(role, "enabled")) await setSetting("whyAssistantEnabled", role.enabled ? "true" : "false");
      if (Object.prototype.hasOwnProperty.call(role, "webSearchEnabled")) await setSetting("whyAssistantWebSearchEnabled", role.webSearchEnabled ? "true" : "false");
      if (Object.prototype.hasOwnProperty.call(role, "model")) await setSetting("whyAssistantModel", normalizeRoleModel(role.model));
      if (Object.prototype.hasOwnProperty.call(role, "thinkingEnabled")) await setSetting("whyAssistantThinkingEnabled", role.thinkingEnabled ? "true" : "false");
      if (Object.prototype.hasOwnProperty.call(role, "promptCommand")) await setSetting("whyAssistantPromptCommand", (role.promptCommand || "").trim() || DEFAULT_WHY_ASSISTANT_PROMPT);
      if (Object.prototype.hasOwnProperty.call(role, "activationJudgePrompt")) await setSetting("whyAssistantActivationJudgePrompt", (role.activationJudgePrompt || "").trim());
      await syncAiRoleVirtualCharacterConfig(WHY_ASSISTANT_USERNAME, WHY_ASSISTANT_NAME, {
        displayName,
        persona: (role.promptCommand || "").trim() || DEFAULT_WHY_ASSISTANT_PROMPT,
        enabled: role.enabled,
        activationJudgePrompt: (role.activationJudgePrompt || "").trim(),
        channelIds: role.channelIds,
        model: role.model,
        thinkingEnabled: role.thinkingEnabled,
        shortTermMemory: role.shortTermMemory,
        midTermMemory: role.midTermMemory,
        longTermMemory: role.longTermMemory
      });
    }
    if (role.username === QUESTION_ASSISTANT_USERNAME) {
      const displayName = (role.displayName || "").trim() || QUESTION_ASSISTANT_NAME;
      await setSetting("questionAssistantDisplayName", displayName);
      if (Object.prototype.hasOwnProperty.call(role, "enabled")) await setSetting("questionAssistantEnabled", role.enabled ? "true" : "false");
      if (Object.prototype.hasOwnProperty.call(role, "questionTriggerEnabled")) await setSetting("questionAssistantTriggerEnabled", role.questionTriggerEnabled ? "true" : "false");
      if (Object.prototype.hasOwnProperty.call(role, "webSearchEnabled")) await setSetting("questionAssistantWebSearchEnabled", role.webSearchEnabled ? "true" : "false");
      if (Object.prototype.hasOwnProperty.call(role, "model")) await setSetting("questionAssistantModel", normalizeRoleModel(role.model));
      if (Object.prototype.hasOwnProperty.call(role, "thinkingEnabled")) await setSetting("questionAssistantThinkingEnabled", role.thinkingEnabled ? "true" : "false");
      if (Object.prototype.hasOwnProperty.call(role, "promptCommand")) await setSetting("questionAssistantPromptCommand", (role.promptCommand || "").trim() || DEFAULT_QUESTION_ASSISTANT_PROMPT);
      if (Object.prototype.hasOwnProperty.call(role, "activationJudgePrompt")) {
        await setSetting("questionAssistantActivationJudgePrompt", (role.activationJudgePrompt || "").trim() || DEFAULT_QUESTION_ASSISTANT_JUDGE_PROMPT);
      }
      if (Object.prototype.hasOwnProperty.call(role, "contextTurnLimit")) {
        await setSetting("questionAssistantContextTurnLimit", String(clampInteger(role.contextTurnLimit, DEFAULT_QUESTION_ASSISTANT_CONTEXT_TURNS, 1, 50)));
      }
      if (Object.prototype.hasOwnProperty.call(role, "contextWindowMinutes")) {
        await setSetting("questionAssistantContextWindowMinutes", String(clampInteger(role.contextWindowMinutes, DEFAULT_QUESTION_ASSISTANT_CONTEXT_WINDOW_MINUTES, 1, 1440)));
      }
      await syncAiRoleVirtualCharacterConfig(QUESTION_ASSISTANT_USERNAME, QUESTION_ASSISTANT_NAME, {
        displayName,
        persona: (role.promptCommand || "").trim() || DEFAULT_QUESTION_ASSISTANT_PROMPT,
        enabled: role.enabled,
        activationJudgePrompt: (role.activationJudgePrompt || "").trim() || DEFAULT_QUESTION_ASSISTANT_JUDGE_PROMPT,
        channelIds: role.channelIds,
        model: role.model,
        thinkingEnabled: role.thinkingEnabled,
        shortTermMemory: role.shortTermMemory,
        midTermMemory: role.midTermMemory,
        longTermMemory: role.longTermMemory
      });
    }
  }
  resetAiSettingsCache();
  return aiSettingsDto();
});

app.post("/api/admin/ai-roles/:username/avatar", { preHandler: requireAdmin }, async (request, reply) => {
  const username = (request.params as { username: string }).username;
  if (!AI_ROLE_USERNAMES.has(username)) return reply.code(404).send({ success: false, message: "AI 角色不存在" });
  const fallbackName = username === WHY_ASSISTANT_USERNAME ? WHY_ASSISTANT_NAME : QUESTION_ASSISTANT_NAME;
  const displayNameKey = username === WHY_ASSISTANT_USERNAME ? "whyAssistantDisplayName" : "questionAssistantDisplayName";
  const displayName = (await prisma.setting.findUnique({ where: { key: displayNameKey } }))?.value || fallbackName;
  const actor = await ensureAiRoleCharacter(username, fallbackName, displayName);
  const file = await request.file();
  if (!file) return reply.code(400).send({ success: false, message: "缺少头像图片" });
  const ext = path.extname(file.filename).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext) || !file.mimetype.startsWith("image/")) return reply.code(400).send({ success: false, message: "只支持图片头像" });
  const safeName = `${crypto.randomUUID()}${ext}`;
  const outPath = path.join(AVATAR_DIR, safeName);
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createWriteStream(outPath);
    file.file.pipe(stream);
    file.file.on("error", reject);
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
  if (!(await validateStoredImage(outPath))) {
    safeUnlink("avatar", safeName);
    return reply.code(400).send({ success: false, message: "头像内容无效或尺寸过大" });
  }
  let avatarPath = safeName;
  const compressed = await compressImageFile(outPath, AVATAR_DIR, { maxDimension: 256 });
  if (compressed) {
    fs.unlinkSync(outPath);
    avatarPath = compressed.fileName;
  }
  const updated = await prisma.actor.update({ where: { id: actor.id }, data: { avatarPath } });
  const settings = await aiSettingsDto();
  const role = settings.aiRoles?.find((item) => item.username === username);
  return { success: true, role: role || { username, displayName: updated.displayName, avatarPath: updated.avatarPath, enabled: true, promptCommand: "" } };
});

app.post("/api/messages/:messageId/ai-suggestions/related-verses", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const messageId = Number((request.params as { messageId: string }).messageId);
  const message = await prisma.message.findUnique({ where: { id: messageId }, include: { sender: true } });
  if (!message || message.type !== "prayer") return reply.code(404).send({ success: false, message: "代祷事项不存在" });
  if (!(await canAccessChannel(auth.accountId, message.channelId))) return reply.code(403).send({ success: false, message: "无权访问此代祷" });
  const target = await canonicalPrayerMessage(message);
  const targetMessageId = target.id;
  const targetWithSender =
    targetMessageId === message.id ? message : await prisma.message.findUniqueOrThrow({ where: { id: targetMessageId }, include: { sender: true } });

  const aiSettings = await loadAiSettings();
  const settings = aiSettings.value;
  const apiKey = decryptAiApiKey(aiSettings.encryptedApiKey);
  if (!settings.enabled || !apiKey) return reply.code(409).send({ success: false, message: aiConfigurationMessage(auth) });

  const successCount = await prisma.messageAiSuggestion.count({ where: { messageId: targetMessageId, kind: AI_RELATED_VERSES_KIND, status: "success" } });
  if (successCount >= settings.maxSuccessPerMessage) {
    return reply.code(409).send({ success: false, message: "这张代祷卡片的经文建议已达到上限" });
  }

  const now = new Date();
  const latestForMessage = await prisma.messageAiSuggestion.findFirst({
    where: { messageId: targetMessageId, kind: AI_RELATED_VERSES_KIND, status: "success" },
    orderBy: { createdAt: "desc" }
  });
  const nextAllowedAt = latestForMessage ? latestForMessage.createdAt.getTime() + settings.cardCooldownSeconds * 1000 : 0;
  if (settings.cardCooldownSeconds > 0 && nextAllowedAt > now.getTime()) {
    const seconds = Math.max(1, Math.ceil((nextAllowedAt - now.getTime()) / 1000));
    return reply.code(429).send({ success: false, message: `请 ${seconds} 秒后再换一组经文建议` });
  }

  const userWindowStart = new Date(now.getTime() - 60_000);
  const userRequests = await prisma.messageAiSuggestion.count({
    where: { createdByAccountId: auth.accountId, kind: AI_RELATED_VERSES_KIND, createdAt: { gte: userWindowStart } }
  });
  if (userRequests >= settings.userLimitPerMinute) {
    return reply.code(429).send({ success: false, message: "生成太频繁了，请稍后再试" });
  }

  const previousRows = await prisma.messageAiSuggestion.findMany({
    where: { messageId: targetMessageId, kind: AI_RELATED_VERSES_KIND, status: "success" },
    select: { references: true },
    orderBy: { createdAt: "desc" }
  });
  const previousReferences = previousRows.flatMap((row) => (Array.isArray(row.references) ? row.references.map(String).filter(Boolean) : []));
  const contextText = buildRelatedVersesContext(targetWithSender, previousReferences);
  try {
    const result = await callDeepSeekRelatedVerses(settings, apiKey, contextText);
    await prisma.messageAiSuggestion.create({
      data: {
        messageId: targetMessageId,
        kind: AI_RELATED_VERSES_KIND,
        status: "success",
        promptCommand: settings.promptCommand,
        contextText,
        responseText: result.responseText,
        references: result.references as Prisma.InputJsonArray,
        model: settings.model,
        baseUrl: settings.baseUrl,
        createdByAccountId: auth.accountId
      }
    });
    const dto = await hydrateMessage(messageId, auth.accountId);
    if (dto) io.to(`ch:${message.channelId}`).emit("message:updated", dto);
    return { success: true, message: dto };
  } catch (error) {
    await prisma.messageAiSuggestion.create({
      data: {
        messageId: targetMessageId,
        kind: AI_RELATED_VERSES_KIND,
        status: "failed",
        promptCommand: settings.promptCommand,
        contextText,
        errorText: cleanAiError(error),
        model: settings.model,
        baseUrl: settings.baseUrl,
        createdByAccountId: auth.accountId
      }
    });
    request.log.warn({ error }, "AI related verses generation failed");
    return reply.code(502).send({ success: false, message: auth.isAdmin ? `AI 生成失败：${cleanAiError(error)}` : "生成失败，可以稍后重试。" });
  }
});

app.get("/api/bible/lookup", { preHandler: requireAuth }, async (request, reply) => {
  if (applyJsonValidation(request, reply, `W/\"bible-${APP_VERSION}\"`)) return reply.code(304).send();
  const query = z.object({ reference: z.string().min(1).max(120) }).parse(request.query);
  try {
    const result: BibleLookupDTO = lookupBibleReference(query.reference);
    return { success: true, result };
  } catch {
    return { success: false, message: "暂时找不到这处经文" };
  }
});

app.get("/api/bible/chapter", { preHandler: requireAuth }, async (request, reply) => {
  if (applyJsonValidation(request, reply, `W/\"bible-${APP_VERSION}\"`)) return reply.code(304).send();
  const query = z.object({
    book: z.string().trim().min(3).max(3),
    chapter: z.coerce.number().int().positive()
  }).parse(request.query);
  try {
    const result: BibleChapterDTO = lookupBibleChapter(query.book, query.chapter);
    return { success: true, result };
  } catch {
    return { success: false, message: "暂时找不到这一章经文" };
  }
});

app.get("/api/bible/catalog", { preHandler: requireAuth }, async (request, reply) => {
  if (applyJsonValidation(request, reply, `W/\"bible-${APP_VERSION}\"`)) return reply.code(304).send();
  const result: BibleCatalogDTO = bibleCatalog();
  return { success: true, result };
});

const bibleFavoriteKeySchema = z.object({
  bookCode: z.string().trim().length(3).transform((value) => value.toUpperCase()),
  chapter: z.coerce.number().int().positive(),
  verse: z.coerce.number().int().positive()
});

function resolveBibleFavorite(key: BibleFavoriteKeyDTO) {
  const chapter = lookupBibleChapter(key.bookCode, key.chapter);
  const verseLine = chapter.verses.find((verse) => verse.verse === key.verse);
  if (!verseLine) throw new Error("invalid verse");
  return { bookCode: chapter.bookCode, chapter: chapter.chapter, verse: verseLine.verse, verseLine };
}

async function listBibleFavorites(accountId: number): Promise<BibleFavoriteDTO[]> {
  const rows = await prisma.bibleFavorite.findMany({
    where: { accountId },
    orderBy: { createdAt: "desc" },
    take: 1000
  });
  return rows.flatMap((row) => {
    try {
      const resolved = resolveBibleFavorite(row);
      return [{
        id: row.id,
        bookCode: resolved.bookCode,
        chapter: resolved.chapter,
        verse: resolved.verse,
        color: normalizeBibleFavoriteColor(row.color),
        savedAt: row.createdAt.toISOString(),
        verseLine: resolved.verseLine
      }];
    } catch {
      return [];
    }
  });
}

app.get("/api/bible/favorites", { preHandler: requireAuth }, async (request) => {
  const auth = (request as AuthedRequest).auth;
  return { success: true, favorites: await listBibleFavorites(auth.accountId) };
});

app.post("/api/bible/favorites", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const body = z.object({
    verses: z.array(bibleFavoriteKeySchema).min(1).max(500),
    color: z.string().optional()
  }).parse(request.body);
  const color = normalizeBibleFavoriteColor(body.color || DEFAULT_BIBLE_FAVORITE_COLOR);
  let verses: ReturnType<typeof resolveBibleFavorite>[];
  try {
    verses = body.verses.map(resolveBibleFavorite);
  } catch {
    return reply.code(400).send({ success: false, message: "收藏中包含无效经文" });
  }
  const verseWhere = verses.map((verse) => ({
    bookCode: verse.bookCode,
    chapter: verse.chapter,
    verse: verse.verse
  }));
  await prisma.$transaction([
    prisma.bibleFavorite.createMany({
      data: verses.map((verse) => ({
        accountId: auth.accountId,
        bookCode: verse.bookCode,
        chapter: verse.chapter,
        verse: verse.verse,
        color
      })),
      skipDuplicates: true
    }),
    prisma.bibleFavorite.updateMany({
      where: { accountId: auth.accountId, OR: verseWhere },
      data: { color }
    })
  ]);
  return { success: true, favorites: await listBibleFavorites(auth.accountId) };
});

app.delete("/api/bible/favorites", { preHandler: requireAuth }, async (request) => {
  const auth = (request as AuthedRequest).auth;
  const body = z.object({ verses: z.array(bibleFavoriteKeySchema).min(1).max(500) }).parse(request.body);
  await prisma.bibleFavorite.deleteMany({
    where: {
      accountId: auth.accountId,
      OR: body.verses.map((verse) => ({
        bookCode: verse.bookCode,
        chapter: verse.chapter,
        verse: verse.verse
      }))
    }
  });
  return { success: true, favorites: await listBibleFavorites(auth.accountId) };
});

app.get("/api/bible/search/export", { preHandler: requireAuth }, async (request) => {
  const query = z.object({ query: z.string().min(1).max(200) }).parse(request.query);
  const result = searchBibleText(query.query, 0, 40000, 40000);
  return { success: true, result };
});

app.get("/api/bible/search", { preHandler: requireAuth }, async (request, reply) => {
  if (applyJsonValidation(request, reply, `W/\"bible-${APP_VERSION}\"`)) return reply.code(304).send();
  const query = z
    .object({
      query: z.string().min(1).max(200),
      offset: z.coerce.number().int().min(0).default(0),
      limit: z.coerce.number().int().min(1).max(50).default(50)
    })
    .parse(request.query);
  const result: BibleTextSearchDTO = searchBibleText(query.query, query.offset, query.limit);
  return { success: true, result };
});

app.post("/api/bible/related", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const body = z.object({
    query: z.string().trim().min(2).max(200),
    excludeReferences: z.array(z.string().trim().min(1).max(120)).max(60).default([])
  }).parse(request.body);
  const aiSettings = await loadAiSettings();
  const settings = aiSettings.value;
  const apiKey = decryptAiApiKey(aiSettings.encryptedApiKey);
  if (!settings.enabled || !apiKey) return reply.code(409).send({ success: false, message: aiConfigurationMessage(auth) });
  if (!bibleTopicSearchAllowed(auth.accountId, settings.userLimitPerMinute)) {
    return reply.code(429).send({ success: false, message: "主题检索太频繁了，请稍后再试。" });
  }
  try {
    const exclusionInstruction = body.excludeReferences.length
      ? `请追加不同的经文，不要重复这些已有出处：${body.excludeReferences.join("、")}。`
      : "";
    const generated = await callDeepSeekBibleReferences(
      settings,
      apiKey,
      BIBLE_TOPIC_SEARCH_PROMPT,
      `用户想查找关于“${body.query}”的经文。${exclusionInstruction}`,
      10
    );
    const seen = new Set<string>();
    const results: BibleLookupDTO[] = [];
    for (const reference of generated.references) {
      try {
        const lookup = lookupBibleReference(reference);
        if (!lookup.verses.length || seen.has(lookup.normalizedReference)) continue;
        seen.add(lookup.normalizedReference);
        results.push(lookup);
        if (results.length >= 6) break;
      } catch {
        // AI references must resolve against the bundled Bible before being returned.
      }
    }
    if (!results.length) throw new Error("AI did not return locally valid Bible references");
    const result: BibleRelatedSearchDTO = { query: body.query, results };
    return { success: true, result };
  } catch (error) {
    request.log.warn({ error }, "Bible topic search failed");
    return reply.code(502).send({ success: false, message: auth.isAdmin ? `主题检索失败：${cleanAiError(error)}` : "主题检索暂时不可用，请稍后重试。" });
  }
});

async function themeExists(theme: string) {
  if (THEMES.has(theme)) return true;
  const customThemes = await customThemesSetting();
  return customThemes.some((item) => item.id === theme);
}

async function saveImageUpload(request: FastifyRequest, reply: FastifyReply, missingMessage: string, shortName = false) {
  const file = await request.file();
  if (!file) {
    reply.code(400).send({ success: false, message: missingMessage });
    return "";
  }
  const ext = path.extname(file.filename).toLowerCase();
  const allowed = IMAGE_EXTENSIONS;
  if (!allowed.has(ext) || !file.mimetype.startsWith("image/")) {
    reply.code(400).send({ success: false, message: "只支持图片文件" });
    return "";
  }
  const safeExt = ext === ".jpeg" ? ".jpg" : ext;
  const safeName = shortName ? shortStorageFileName(safeExt) : `${crypto.randomUUID()}${safeExt}`;
  const outPath = path.join(BG_DIR, safeName);
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createWriteStream(outPath);
    file.file.pipe(stream);
    file.file.on("error", reject);
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
  if (!(await validateStoredImage(outPath))) {
    safeUnlink("background", safeName);
    reply.code(400).send({ success: false, message: "图片内容无效或尺寸过大" });
    return "";
  }
  const compressed = await compressImageFile(outPath, BG_DIR, { shortName, maxDimension: 2560 });
  if (compressed) {
    fs.unlinkSync(outPath);
    return compressed.fileName;
  }
  return safeName;
}

async function saveParallaxLayerUpload(request: FastifyRequest, reply: FastifyReply, kitId: string) {
  const file = await request.file();
  if (!file) {
    reply.code(400).send({ success: false, message: "缺少卷轴图层图片" });
    return null;
  }
  const ext = path.extname(file.filename).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext) || !file.mimetype.startsWith("image/")) {
    reply.code(400).send({ success: false, message: "只支持图片文件" });
    return null;
  }
  const kitDir = path.join(PARALLAX_DIR, kitId);
  fs.mkdirSync(kitDir, { recursive: true });
  const token = crypto.randomUUID();
  const tempPath = path.join(kitDir, `.${token}${ext}`);
  const fileName = `${token}.png`;
  const outputPath = path.join(kitDir, fileName);
  try {
    await new Promise<void>((resolve, reject) => {
      const stream = fs.createWriteStream(tempPath);
      file.file.pipe(stream);
      file.file.on("error", reject);
      stream.on("finish", resolve);
      stream.on("error", reject);
    });
    if (!(await validateStoredImage(tempPath))) {
      reply.code(400).send({ success: false, message: "图片内容无效或尺寸过大" });
      return null;
    }
    const metadata = await sharp(tempPath, { failOn: "error", limitInputPixels: 40_000_000 }).metadata();
    await sharp(tempPath, { failOn: "error", limitInputPixels: 40_000_000 }).png({ compressionLevel: 9 }).toFile(outputPath);
    return {
      fileName,
      originalName: path.basename(file.filename, ext).trim().slice(0, 40) || "新图层",
      width: metadata.width || 0,
      height: metadata.height || 0
    };
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
}

app.get("/api/settings/appearance", async () => {
  return appearanceDto();
});

app.get<{ Params: { kit: string; file: string } }>("/api/parallax/:kit/:file", async (request, reply) => {
  const { kit, file } = request.params;
  if (!PARALLAX_KIT_ID_PATTERN.test(kit) || path.basename(file) !== file || path.extname(file).toLowerCase() !== ".png") {
    return reply.code(404).send({ success: false, message: "parallax asset not found" });
  }
  const filePath = path.join(PARALLAX_DIR, kit, file);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return reply.code(404).send({ success: false, message: "parallax asset not found" });
  }
  const stat = fs.statSync(filePath);
  reply.type("image/png");
  if (applyFileValidation(request, reply, stat)) return reply.code(304).send();
  reply.header("Cache-Control", "public, no-cache");
  reply.header("Content-Length", String(stat.size));
  return reply.send(fs.createReadStream(filePath));
});

app.post<{ Params: { kit: string } }>("/api/admin/parallax/:kit/layers", { preHandler: requireAdmin }, async (request, reply) => {
  const kitId = request.params.kit.trim().toLowerCase();
  if (!PARALLAX_KIT_ID_PATTERN.test(kitId)) return reply.code(400).send({ success: false, message: "卷轴套件编号无效" });
  const uploaded = await saveParallaxLayerUpload(request, reply, kitId);
  if (!uploaded) return reply;
  return {
    success: true,
    layer: {
      id: `layer-${crypto.randomBytes(6).toString("hex")}`,
      name: uploaded.originalName,
      file: uploaded.fileName,
      speed: 1,
      yOffset: 0,
      heightScale: 1
    },
    size: { width: uploaded.width, height: uploaded.height }
  };
});

app.post("/api/admin/appearance", { preHandler: requireAdmin }, async (request) => {
  const body = z
    .object({
      wallpaperPath: z.string().nullable().optional(),
      appTitle: z.string().max(80).nullable().optional(),
      appIconPath: z.string().nullable().optional(),
      wallpaperFit: z.enum(["cover", "contain", "stretch", "repeat", "pan"]).optional(),
      wallpaperPanFocusX: z.number().min(0).max(1).optional(),
      wallpaperPanDirection: z.enum(["left", "right"]).optional(),
      wallpaperPanSpeed: z.number().min(WALLPAPER_PAN_SPEED_MIN).max(WALLPAPER_PAN_SPEED_MAX).optional(),
      parallaxKit: z.string().regex(/^(none|[a-z0-9][a-z0-9-]{0,63})$/).optional(),
      parallaxSpeed: z.number().min(PARALLAX_SPEED_MIN).max(PARALLAX_SPEED_MAX).optional(),
      parallaxKits: z.array(z.unknown()).max(12).optional(),
      loginIconPath: z.string().nullable().optional(),
      loginShowIcon: z.boolean().optional(),
      loginTitle: z.string().max(80).nullable().optional(),
      loginSubtitle: z.string().max(160).nullable().optional(),
      loginShowSubtitle: z.boolean().optional(),
      loginBackgroundPath: z.string().nullable().optional(),
      loginBackgroundFit: z.enum(["cover", "contain", "stretch", "repeat"]).optional(),
      loginFormPosition: z.enum(["top", "middle", "bottom"]).optional(),
      registrationEnabled: z.boolean().optional(),
      musicPanelFontSize: z.number().min(MUSIC_PANEL_FONT_SIZE_MIN).max(MUSIC_PANEL_FONT_SIZE_MAX).optional(),
      prayerBubbleMineColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      prayerBubbleOtherColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      flashEffect: z.unknown().optional(),
      customThemes: z.array(z.unknown()).optional(),
      composerPrompts: z.array(z.string().max(80)).max(50).optional(),
      composerPromptIntervalSeconds: z.number().min(1).max(30).optional(),
      composerPromptAppearSeconds: z.number().min(COMPOSER_PROMPT_ANIM_MIN).max(COMPOSER_PROMPT_ANIM_MAX).optional(),
      composerPromptDisappearSeconds: z.number().min(COMPOSER_PROMPT_ANIM_MIN).max(COMPOSER_PROMPT_ANIM_MAX).optional(),
      composerPromptGapSeconds: z.number().min(COMPOSER_PROMPT_GAP_MIN).max(COMPOSER_PROMPT_GAP_MAX).optional()
    })
    .parse(request.body);
  if (Object.prototype.hasOwnProperty.call(body, "appTitle")) await setSetting("appTitle", (body.appTitle || "").trim() || DEFAULT_APP_TITLE);
  if (Object.prototype.hasOwnProperty.call(body, "appIconPath")) await setSetting("appIconPath", body.appIconPath || "");
  if (Object.prototype.hasOwnProperty.call(body, "wallpaperPath")) await setSetting("wallpaperPath", body.wallpaperPath || "");
  if (Object.prototype.hasOwnProperty.call(body, "wallpaperFit")) await setSetting("wallpaperFit", body.wallpaperFit || "cover");
  if (Object.prototype.hasOwnProperty.call(body, "wallpaperPanFocusX")) await setSetting("wallpaperPanFocusX", String(cleanWallpaperPanFocusX(body.wallpaperPanFocusX)));
  if (Object.prototype.hasOwnProperty.call(body, "wallpaperPanDirection")) await setSetting("wallpaperPanDirection", cleanWallpaperPanDirection(body.wallpaperPanDirection));
  if (Object.prototype.hasOwnProperty.call(body, "wallpaperPanSpeed")) await setSetting("wallpaperPanSpeed", String(cleanWallpaperPanSpeed(body.wallpaperPanSpeed)));
  if (Object.prototype.hasOwnProperty.call(body, "parallaxKit")) await setSetting("parallaxKit", body.parallaxKit || "none");
  if (Object.prototype.hasOwnProperty.call(body, "parallaxSpeed")) await setSetting("parallaxSpeed", String(body.parallaxSpeed || 1));
  if (Object.prototype.hasOwnProperty.call(body, "parallaxKits")) await setSetting("parallaxKits", JSON.stringify(cleanParallaxKits(body.parallaxKits)));
  if (Object.prototype.hasOwnProperty.call(body, "loginIconPath")) await setSetting("loginIconPath", body.loginIconPath || "");
  if (Object.prototype.hasOwnProperty.call(body, "loginShowIcon")) await setSetting("loginShowIcon", body.loginShowIcon ? "true" : "false");
  if (Object.prototype.hasOwnProperty.call(body, "loginTitle")) await setSetting("loginTitle", (body.loginTitle || "").trim() || DEFAULT_LOGIN_TITLE);
  if (Object.prototype.hasOwnProperty.call(body, "loginSubtitle")) await setSetting("loginSubtitle", (body.loginSubtitle || "").trim());
  if (Object.prototype.hasOwnProperty.call(body, "loginShowSubtitle")) await setSetting("loginShowSubtitle", body.loginShowSubtitle ? "true" : "false");
  if (Object.prototype.hasOwnProperty.call(body, "loginBackgroundPath")) await setSetting("loginBackgroundPath", body.loginBackgroundPath || "");
  if (Object.prototype.hasOwnProperty.call(body, "loginBackgroundFit")) await setSetting("loginBackgroundFit", body.loginBackgroundFit || "cover");
  if (Object.prototype.hasOwnProperty.call(body, "loginFormPosition")) await setSetting("loginFormPosition", body.loginFormPosition || "middle");
  if (Object.prototype.hasOwnProperty.call(body, "registrationEnabled")) await setSetting("registrationEnabled", body.registrationEnabled ? "true" : "false");
  if (Object.prototype.hasOwnProperty.call(body, "musicPanelFontSize")) await setSetting("musicPanelFontSize", String(cleanMusicPanelFontSize(body.musicPanelFontSize)));
  if (Object.prototype.hasOwnProperty.call(body, "prayerBubbleMineColor")) await setSetting("prayerBubbleMineColor", cleanHexColor(body.prayerBubbleMineColor, "#f0fbf1"));
  if (Object.prototype.hasOwnProperty.call(body, "prayerBubbleOtherColor")) await setSetting("prayerBubbleOtherColor", cleanHexColor(body.prayerBubbleOtherColor, "#fffaf0"));
  if (Object.prototype.hasOwnProperty.call(body, "flashEffect")) await setSetting("flashEffect", JSON.stringify(cleanFlashEffect(body.flashEffect)));
  if (Object.prototype.hasOwnProperty.call(body, "customThemes")) await setSetting("customThemes", JSON.stringify(cleanCustomThemes(body.customThemes)));
  if (Object.prototype.hasOwnProperty.call(body, "composerPrompts")) await setSetting("composerPrompts", JSON.stringify(cleanComposerPrompts(body.composerPrompts)));
  if (Object.prototype.hasOwnProperty.call(body, "composerPromptIntervalSeconds")) await setSetting("composerPromptIntervalSeconds", String(cleanComposerPromptIntervalSeconds(body.composerPromptIntervalSeconds)));
  if (Object.prototype.hasOwnProperty.call(body, "composerPromptAppearSeconds")) await setSetting("composerPromptAppearSeconds", String(cleanComposerPromptAppearSeconds(body.composerPromptAppearSeconds)));
  if (Object.prototype.hasOwnProperty.call(body, "composerPromptDisappearSeconds")) await setSetting("composerPromptDisappearSeconds", String(cleanComposerPromptDisappearSeconds(body.composerPromptDisappearSeconds)));
  if (Object.prototype.hasOwnProperty.call(body, "composerPromptGapSeconds")) await setSetting("composerPromptGapSeconds", String(cleanComposerPromptGapSeconds(body.composerPromptGapSeconds)));
  const appearance = await appearanceDto();
  io.emit("appearance:updated", appearance);
  return { success: true, appearance };
});

app.post("/api/admin/appearance/wallpaper", { preHandler: requireAdmin }, async (request, reply) => {
  const safeName = await saveImageUpload(request, reply, "缺少图片");
  if (!safeName) return reply;
  return { success: true, fileName: safeName, url: `/backgrounds/${encodeURIComponent(safeName)}` };
});

app.post("/api/admin/appearance/login-background", { preHandler: requireAdmin }, async (request, reply) => {
  const safeName = await saveImageUpload(request, reply, "缺少登录页背景");
  if (!safeName) return reply;
  return { success: true, fileName: safeName, url: `/backgrounds/${encodeURIComponent(safeName)}` };
});

app.post("/api/admin/appearance/login-icon", { preHandler: requireAdmin }, async (request, reply) => {
  const safeName = await saveImageUpload(request, reply, "缺少登录页图标");
  if (!safeName) return reply;
  return { success: true, fileName: safeName, url: `/backgrounds/${encodeURIComponent(safeName)}` };
});

app.post("/api/admin/appearance/app-icon", { preHandler: requireAdmin }, async (request, reply) => {
  const safeName = await saveImageUpload(request, reply, "缺少标签页图标", true);
  if (!safeName) return reply;
  return { success: true, fileName: safeName, url: `/backgrounds/${encodeURIComponent(safeName)}` };
});

function jsonDownload(reply: FastifyReply, fileName: string, data: unknown) {
  reply.header("Content-Type", "application/json; charset=utf-8");
  reply.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  return reply.send(JSON.stringify(data, null, 2));
}

async function readJsonUpload(request: FastifyRequest) {
  const file = await request.file();
  if (!file) {
    const error = new Error("缺少导入文件") as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of file.file) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as any;
  } catch {
    const error = new Error("导入文件不是有效 JSON") as Error & { statusCode?: number };
    error.statusCode = 400;
    throw error;
  }
}

function parseDate(value: unknown, fallback = new Date()) {
  const date = value ? new Date(String(value)) : fallback;
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function crc32(buffer: Buffer) {
  let crc = -1;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}

function dosTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function zipArchive(entries: Array<{ name: string; data: Buffer; date?: Date }>) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name.replace(/^\/+/, ""), "utf8");
    const data = entry.data;
    const crc = crc32(data);
    const { time, day } = dosTime(entry.date);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

function zipSafeName(name: string) {
  return name.replace(/[\\/:*?"<>|]+/g, "_").replace(/\.+/g, ".").slice(0, 180) || "file";
}

function backupFileUrl(fileName: string) {
  return `/api/admin/backups/${encodeURIComponent(path.basename(fileName))}`;
}

function isManagedBackupFileName(fileName: string) {
  return /^liao-full-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.zip$/.test(path.basename(fileName));
}

function backupFilePath(fileName: string) {
  const safeName = path.basename(fileName);
  if (!isManagedBackupFileName(safeName)) return "";
  return path.join(BACKUP_DIR, safeName);
}

function listAdminBackups(): AdminBackupDTO[] {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isManagedBackupFileName(entry.name))
    .map((entry) => {
      const filePath = path.join(BACKUP_DIR, entry.name);
      const stat = fs.statSync(filePath);
      return {
        fileName: entry.name,
        size: stat.size,
        createdAt: stat.birthtime.toISOString(),
        url: backupFileUrl(entry.name)
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function shouldSkipBackupEntry(relativePath: string, isDirectory: boolean) {
  const parts = relativePath.split(path.sep).filter(Boolean);
  if (!parts.length) return false;
  const first = parts[0];
  if ([".git", "node_modules", ".playwright-cli", ".codebase-memory", "coverage"].includes(first)) return true;
  if (first === "storage" && parts[1] === "backups") return true;
  if (isDirectory && first === ".vite") return true;
  return relativePath.endsWith(".tmp") || relativePath.endsWith(".log");
}

function collectDirectoryBackupEntries(rootDir: string, zipPrefix: string, skipEntry: (relativePath: string, isDirectory: boolean) => boolean) {
  const entries: Array<{ name: string; data: Buffer; date?: Date }> = [];
  if (!fs.existsSync(rootDir)) return entries;
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(rootDir, fullPath);
      if (!relativePath || skipEntry(relativePath, entry.isDirectory())) continue;
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = fs.statSync(fullPath);
      entries.push({
        name: `${zipPrefix}/${relativePath.split(path.sep).map(zipSafeName).join("/")}`,
        data: fs.readFileSync(fullPath),
        date: stat.mtime
      });
    }
  };
  walk(rootDir);
  return entries;
}

function collectBackupProgramEntries(rootDir = ROOT) {
  return collectDirectoryBackupEntries(rootDir, "program", shouldSkipBackupEntry);
}

function isPathInside(childPath: string, parentPath: string) {
  const relative = path.relative(parentPath, childPath);
  return !relative || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function collectExternalStorageEntries() {
  if (STORAGE_ROOT === path.join(ROOT, "storage") || isPathInside(STORAGE_ROOT, ROOT)) return [];
  return collectDirectoryBackupEntries(STORAGE_ROOT, "storage", (relativePath, isDirectory) => {
    const parts = relativePath.split(path.sep).filter(Boolean);
    if (parts[0] === "backups") return true;
    return isDirectory ? false : relativePath.endsWith(".tmp") || relativePath.endsWith(".log");
  });
}

function sqliteDatabasePath() {
  const databaseUrl = process.env.DATABASE_URL || "";
  if (!databaseUrl.startsWith("file:")) return "";
  const rawPath = databaseUrl.slice("file:".length).split("?")[0];
  if (!rawPath || rawPath === ":memory:") return "";
  return path.resolve(ROOT, rawPath);
}

function collectExternalDatabaseEntry(existingEntries: Array<{ name: string }>) {
  const dbPath = sqliteDatabasePath();
  if (!dbPath || !fs.existsSync(dbPath) || isPathInside(dbPath, ROOT) || isPathInside(dbPath, STORAGE_ROOT)) return [];
  const stat = fs.statSync(dbPath);
  const name = `database/${zipSafeName(path.basename(dbPath))}`;
  if (existingEntries.some((entry) => entry.name === name)) return [];
  return [{ name, data: fs.readFileSync(dbPath), date: stat.mtime }];
}

async function createFullBackup(auth: AuthContext) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const createdAt = new Date();
  const stamp = createdAt.toISOString().replace(/[:.]/g, "-");
  const fileName = `liao-full-backup-${stamp}.zip`;
  const filePath = path.join(BACKUP_DIR, fileName);
  const [chatData, userData, appearance, attachments] = await Promise.all([chatExportPayload(), usersExportPayload(), appearanceDto(), adminAttachmentList()]);
  const entries = [...collectBackupProgramEntries(), ...collectExternalStorageEntries()];
  entries.push(...collectExternalDatabaseEntry(entries));
  const manifest = {
    kind: "liao-full-backup",
    version: 1,
    appVersion: APP_VERSION,
    createdAt: createdAt.toISOString(),
    createdBy: auth.username,
    root: ROOT,
    storageRoot: STORAGE_ROOT,
    included: {
      programFiles: entries.length,
      attachments: attachments.length,
      chatMessages: Array.isArray((chatData as { messages?: unknown[] }).messages) ? (chatData as { messages: unknown[] }).messages.length : 0,
      accounts: Array.isArray((userData as { accounts?: unknown[] }).accounts) ? (userData as { accounts: unknown[] }).accounts.length : 0
    },
    notes: [
      "program/ contains the application files and storage data except generated backups, dependency folders, git metadata, and transient logs.",
      "data/chat.json and data/users.json are portable exports from the admin data tools."
    ]
  };
  entries.unshift(
    { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2), "utf8"), date: createdAt },
    { name: "data/chat.json", data: Buffer.from(JSON.stringify(chatData, null, 2), "utf8"), date: createdAt },
    { name: "data/users.json", data: Buffer.from(JSON.stringify(userData, null, 2), "utf8"), date: createdAt },
    { name: "data/appearance.json", data: Buffer.from(JSON.stringify(appearance, null, 2), "utf8"), date: createdAt }
  );
  fs.writeFileSync(filePath, zipArchive(entries));
  return { fileName, filePath };
}

function storageFilePath(kind: AdminAttachmentDTO["kind"], fileName: string) {
  const dir = kind === "upload" ? UPLOAD_DIR : kind === "avatar" ? AVATAR_DIR : BG_DIR;
  return path.join(dir, path.basename(fileName));
}

function attachmentId(kind: AdminAttachmentDTO["kind"], fileName: string) {
  return `${kind}:${path.basename(fileName)}`;
}

function adminAttachmentFileUrl(kind: AdminAttachmentDTO["kind"], fileName: string) {
  return `/api/admin/attachments/file/${kind}/${encodeURIComponent(path.basename(fileName))}`;
}

function parseAttachmentId(id: string) {
  const [kind, ...rest] = String(id || "").split(":");
  const fileName = path.basename(rest.join(":"));
  if ((kind === "upload" || kind === "avatar" || kind === "background") && fileName) {
    return { kind: kind as AdminAttachmentDTO["kind"], fileName };
  }
  return null;
}

function safeUnlink(kind: AdminAttachmentDTO["kind"], fileName: string) {
  const target = storageFilePath(kind, fileName);
  if (fs.existsSync(target)) fs.unlinkSync(target);
}

function safeUnlinkMusicScore(fileName: string) {
  const target = path.join(MUSIC_SCORE_DIR, path.basename(fileName));
  if (fs.existsSync(target)) fs.unlinkSync(target);
}

async function activePinnedUsesUpload(fileName: string) {
  const target = path.basename(fileName);
  const pins = await prisma.pinnedItem.findMany({ where: { active: true }, select: { body: true, content: true } });
  return pins.some((pin) => pinnedBodyUploadFilePaths(serializePinnedBody(pin.body, pin.content)).has(target));
}

async function uploadIsStillReferenced(fileName: string) {
  const target = path.basename(fileName);
  return (await prisma.message.count({ where: { filePath: target } })) > 0 || (await activePinnedUsesUpload(target));
}

function listStorageFiles(dir: string) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const filePath = path.join(dir, entry.name);
      const stat = fs.statSync(filePath);
      return { name: entry.name, size: stat.size, createdAt: stat.birthtime };
    });
}

function messagePreview(message: Pick<Message, "content" | "fileName" | "type">) {
  const raw = message.content || message.fileName || (message.type === "prayer" ? "[代祷]" : message.type === "image" ? "[图片]" : message.type === "file" ? "[文件]" : "");
  return stripMarkdownSyntax(raw.replace(/<[^>]*>/g, " ")).slice(0, 120);
}

async function detachMessageAttachments(messages: Array<Pick<Message, "id" | "channelId" | "filePath">>) {
  const ids = messages.map((message) => message.id);
  const channelIds = [...new Set(messages.map((message) => message.channelId))];
  const scorePages = ids.length
    ? await prisma.musicScorePage.findMany({ where: { score: { trackId: { in: ids } } }, select: { filePath: true } })
    : [];
  if (ids.length) {
    await prisma.$transaction([
      prisma.voiceListen.deleteMany({ where: { messageId: { in: ids } } }),
      prisma.prayerAction.deleteMany({ where: { messageId: { in: ids } } }),
      prisma.musicScorePage.deleteMany({ where: { score: { trackId: { in: ids } } } }),
      prisma.musicScore.deleteMany({ where: { trackId: { in: ids } } }),
      prisma.message.updateMany({
        where: { id: { in: ids } },
        data: { type: "text", content: "[附件已由管理员删除]", payload: Prisma.JsonNull, fileName: null, filePath: null, fileSize: null }
      })
    ]);
  }
  for (const message of messages) {
    if (message.filePath && !(await uploadIsStillReferenced(message.filePath))) safeUnlink("upload", message.filePath);
  }
  for (const page of scorePages) safeUnlinkMusicScore(page.filePath);
  for (const channelId of channelIds) io.to(`ch:${channelId}`).emit("messages:refresh", { channelId });
  return ids.length;
}

async function deleteMessages(messages: Array<Pick<Message, "id" | "channelId" | "filePath">>) {
  const ids = messages.map((message) => message.id);
  const channelIds = [...new Set(messages.map((message) => message.channelId))];
  if (!ids.length) return 0;
  const scorePages = await prisma.musicScorePage.findMany({ where: { score: { trackId: { in: ids } } }, select: { filePath: true } });
  await prisma.$transaction([
    prisma.pinnedItem.updateMany({ where: { messageId: { in: ids } }, data: { active: false, messageId: null } }),
    prisma.message.updateMany({ where: { replyToId: { in: ids } }, data: { replyToId: null } }),
    prisma.voiceListen.deleteMany({ where: { messageId: { in: ids } } }),
    prisma.prayerAction.deleteMany({ where: { messageId: { in: ids } } }),
    prisma.messageAiSuggestion.deleteMany({ where: { messageId: { in: ids } } }),
    prisma.message.deleteMany({ where: { id: { in: ids } } })
  ]);
  for (const message of messages) {
    if (message.filePath && !(await uploadIsStillReferenced(message.filePath))) safeUnlink("upload", message.filePath);
  }
  for (const page of scorePages) safeUnlinkMusicScore(page.filePath);
  for (const channelId of channelIds) io.to(`ch:${channelId}`).emit("messages:refresh", { channelId });
  if (await prisma.channel.count({ where: { id: { in: channelIds }, kind: "music" } })) io.emit("music:updated", { action: "deleted" });
  return ids.length;
}

async function adminAttachmentList(): Promise<AdminAttachmentDTO[]> {
  const [messages, accounts, channels, pinnedItems, appearance] = await Promise.all([
    prisma.message.findMany({
      where: { filePath: { not: null } },
      include: { channel: true, sender: true },
      orderBy: { id: "desc" }
    }),
    prisma.account.findMany({ select: { displayName: true, avatarPath: true } }),
    prisma.channel.findMany({ select: { name: true, icon: true } }),
    prisma.pinnedItem.findMany({ where: { active: true }, include: { channel: true }, orderBy: { id: "desc" } }),
    appearanceDto()
  ]);

  const rows = new Map<string, AdminAttachmentDTO>();
  for (const file of listStorageFiles(UPLOAD_DIR)) {
    rows.set(attachmentId("upload", file.name), {
      id: attachmentId("upload", file.name),
      kind: "upload",
      fileName: file.name,
      label: file.name,
      size: file.size,
      createdAt: file.createdAt.toISOString(),
      url: adminAttachmentFileUrl("upload", file.name),
      usage: [],
      exists: true
    });
  }
  for (const message of messages) {
    if (!message.filePath) continue;
    const fileName = path.basename(message.filePath);
    const id = attachmentId("upload", fileName);
    const current = rows.get(id);
    rows.set(id, {
      id,
      kind: "upload",
      fileName,
      label: message.fileName || fileName,
      size: current?.size || message.fileSize || 0,
      createdAt: message.createdAt.toISOString(),
      url: current?.exists ? current.url : undefined,
      messageId: message.id,
      channelName: message.channel.name,
      ownerName: message.sender.displayName,
      usage: [...new Set([...(current?.usage || []), `消息 #${message.id}`, message.channel.name, message.sender.displayName])],
      exists: current?.exists || false
    });
  }
  for (const pin of pinnedItems) {
    const body = serializePinnedBody(pin.body, pin.content);
    for (const block of body.blocks) {
      if (block.type !== "image" && block.type !== "file") continue;
      const fileName = path.basename(block.filePath);
      const id = attachmentId("upload", fileName);
      const current = rows.get(id);
      const usage = [...(current?.usage || []), `置顶 · ${pin.channel.name}`];
      rows.set(id, {
        id,
        kind: "upload",
        fileName,
        label: current?.label || block.fileName || fileName,
        size: current?.size || block.fileSize || 0,
        createdAt: current?.createdAt || pin.createdAt.toISOString(),
        url: current?.exists ? current.url : undefined,
        messageId: current?.messageId,
        channelName: current?.channelName || pin.channel.name,
        ownerName: current?.ownerName,
        usage,
        exists: current?.exists || false
      });
    }
  }

  for (const file of listStorageFiles(AVATAR_DIR)) {
    const usage = accounts.filter((account) => account.avatarPath === file.name).map((account) => `${account.displayName} 头像`);
    rows.set(attachmentId("avatar", file.name), {
      id: attachmentId("avatar", file.name),
      kind: "avatar",
      fileName: file.name,
      label: usage[0] || file.name,
      size: file.size,
      createdAt: file.createdAt.toISOString(),
      url: adminAttachmentFileUrl("avatar", file.name),
      usage,
      exists: true
    });
  }

  const backgroundUsage = new Map<string, string[]>();
  if (appearance.appIconPath) backgroundUsage.set(path.basename(appearance.appIconPath), ["聊天室标签页图标"]);
  if (appearance.wallpaperPath) backgroundUsage.set(path.basename(appearance.wallpaperPath), ["聊天室壁纸"]);
  if (appearance.loginBackgroundPath) backgroundUsage.set(path.basename(appearance.loginBackgroundPath), [...(backgroundUsage.get(path.basename(appearance.loginBackgroundPath)) || []), "登录页背景"]);
  if (appearance.loginIconPath) backgroundUsage.set(path.basename(appearance.loginIconPath), [...(backgroundUsage.get(path.basename(appearance.loginIconPath)) || []), "登录页图标"]);
  for (const channel of channels) {
    if (channel.icon && /\.(jpe?g|png|gif|webp)$/i.test(channel.icon)) {
      const fileName = path.basename(channel.icon);
      backgroundUsage.set(fileName, [...(backgroundUsage.get(fileName) || []), `${channel.name} 频道图标`]);
    }
  }
  for (const file of listStorageFiles(BG_DIR)) {
    const usage = backgroundUsage.get(file.name) || [];
    rows.set(attachmentId("background", file.name), {
      id: attachmentId("background", file.name),
      kind: "background",
      fileName: file.name,
      label: usage[0] || file.name,
      size: file.size,
      createdAt: file.createdAt.toISOString(),
      url: adminAttachmentFileUrl("background", file.name),
      usage,
      exists: true
    });
  }

  return [...rows.values()].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

async function deleteAttachmentTargets(targets: Array<{ kind: AdminAttachmentDTO["kind"]; fileName: string }>) {
  let deleted = 0;
  const refreshChannels = new Set<number>();
  let appearanceChanged = false;
  let channelsChanged = false;
  for (const target of targets) {
    const fileName = path.basename(target.fileName);
    const filePath = storageFilePath(target.kind, fileName);
    const existed = fs.existsSync(filePath);
    const keepForPinned = target.kind === "upload" && (await activePinnedUsesUpload(fileName));
    if (target.kind === "upload") {
      const messages = await prisma.message.findMany({ where: { filePath: fileName }, select: { id: true, channelId: true, filePath: true } });
      for (const message of messages) refreshChannels.add(message.channelId);
      if (messages.length) await detachMessageAttachments(messages);
    } else if (target.kind === "avatar") {
      await prisma.account.updateMany({ where: { avatarPath: fileName }, data: { avatarPath: null } });
      await prisma.actor.updateMany({ where: { avatarPath: fileName }, data: { avatarPath: null } });
    } else {
      const appearance = await appearanceDto();
      if (appearance.wallpaperPath === fileName) {
        await setSetting("wallpaperPath", "");
        appearanceChanged = true;
      }
      if (appearance.appIconPath === fileName) {
        await setSetting("appIconPath", "");
        appearanceChanged = true;
      }
      if (appearance.loginBackgroundPath === fileName) {
        await setSetting("loginBackgroundPath", "");
        appearanceChanged = true;
      }
      if (appearance.loginIconPath === fileName) {
        await setSetting("loginIconPath", "");
        appearanceChanged = true;
      }
      const updated = await prisma.channel.updateMany({ where: { icon: fileName }, data: { icon: "" } });
      channelsChanged = channelsChanged || updated.count > 0;
    }
    if (existed && !keepForPinned) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      deleted += 1;
    }
  }
  for (const channelId of refreshChannels) io.to(`ch:${channelId}`).emit("messages:refresh", { channelId });
  if (appearanceChanged) io.emit("appearance:updated", await appearanceDto());
  if (channelsChanged) io.emit("channel:updated", { action: "updated" });
  return deleted;
}

async function emitPinnedRefresh(channelIds: Set<number>) {
  for (const channelId of channelIds) {
    const pin = await prisma.pinnedItem.findFirst({ where: { channelId, active: true }, orderBy: { updatedAt: "desc" } });
    io.to(`ch:${channelId}`).emit("pinned:updated", pin ? await serializePinnedItem(pin) : null);
  }
}

async function replaceUploadAttachmentReferences(oldFileName: string, newFileName: string, newSize: number) {
  const refreshChannels = new Set<number>();
  const pinChannels = new Set<number>();
  const messages = await prisma.message.findMany({ where: { filePath: oldFileName }, select: { id: true, channelId: true, fileName: true, type: true } });
  for (const message of messages) {
    refreshChannels.add(message.channelId);
    await prisma.message.update({
      where: { id: message.id },
      data: {
        filePath: newFileName,
        fileName: message.type === "image" ? displayWebpFileName(message.fileName || oldFileName) : message.fileName,
        fileSize: newSize
      }
    });
  }

  const pins = await prisma.pinnedItem.findMany({ orderBy: { id: "asc" } });
  for (const pin of pins) {
    const body = serializePinnedBody(pin.body, pin.content);
    let changed = false;
    for (const block of body.blocks) {
      if ((block.type === "image" || block.type === "file") && path.basename(block.filePath) === oldFileName) {
        block.filePath = newFileName;
        block.fileName = block.type === "image" ? displayWebpFileName(block.fileName || oldFileName) : block.fileName;
        block.fileSize = newSize;
        changed = true;
      }
    }
    if (changed) {
      await prisma.pinnedItem.update({ where: { id: pin.id }, data: { body: body as unknown as Prisma.InputJsonValue } });
      pinChannels.add(pin.channelId);
    }
  }

  for (const channelId of refreshChannels) io.to(`ch:${channelId}`).emit("messages:refresh", { channelId });
  await emitPinnedRefresh(pinChannels);
}

async function replaceAvatarAttachmentReferences(oldFileName: string, newFileName: string) {
  await prisma.account.updateMany({ where: { avatarPath: oldFileName }, data: { avatarPath: newFileName } });
  await prisma.actor.updateMany({ where: { avatarPath: oldFileName }, data: { avatarPath: newFileName } });
  const accounts = await prisma.account.findMany({ where: { avatarPath: newFileName }, include: { actor: true } });
  for (const account of accounts) refreshAccountConnections(account);
  io.emit("channel:updated", { action: "updated" });
}

async function replaceBackgroundAttachmentReferences(oldFileName: string, newFileName: string) {
  const appearance = await appearanceDto();
  let appearanceChanged = false;
  if (appearance.wallpaperPath === oldFileName) {
    await setSetting("wallpaperPath", newFileName);
    appearanceChanged = true;
  }
  if (appearance.appIconPath === oldFileName) {
    await setSetting("appIconPath", newFileName);
    appearanceChanged = true;
  }
  if (appearance.loginBackgroundPath === oldFileName) {
    await setSetting("loginBackgroundPath", newFileName);
    appearanceChanged = true;
  }
  if (appearance.loginIconPath === oldFileName) {
    await setSetting("loginIconPath", newFileName);
    appearanceChanged = true;
  }
  const updated = await prisma.channel.updateMany({ where: { icon: oldFileName }, data: { icon: newFileName } });
  if (appearanceChanged) io.emit("appearance:updated", await appearanceDto());
  if (updated.count > 0) io.emit("channel:updated", { action: "updated" });
}

async function compressAttachmentTarget(target: { kind: AdminAttachmentDTO["kind"]; fileName: string }) {
  const fileName = path.basename(target.fileName);
  if (!isImageFileName(fileName)) return { id: attachmentId(target.kind, fileName), status: "skipped" as const, reason: "不是图片文件" };
  const filePath = storageFilePath(target.kind, fileName);
  if (!fs.existsSync(filePath)) return { id: attachmentId(target.kind, fileName), status: "skipped" as const, reason: "文件不存在" };
  const shortName = target.kind === "background" && (await prisma.channel.count({ where: { icon: fileName } })) > 0;
  const compressed = await compressImageFile(filePath, path.dirname(filePath), { shortName });
  if (!compressed) return { id: attachmentId(target.kind, fileName), status: "skipped" as const, reason: "压缩后没有更小" };

  fs.unlinkSync(filePath);
  if (target.kind === "upload") {
    await replaceUploadAttachmentReferences(fileName, compressed.fileName, compressed.size);
  } else if (target.kind === "avatar") {
    await replaceAvatarAttachmentReferences(fileName, compressed.fileName);
  } else {
    await replaceBackgroundAttachmentReferences(fileName, compressed.fileName);
  }
  return {
    id: attachmentId(target.kind, fileName),
    status: "compressed" as const,
    fileName: compressed.fileName,
    size: compressed.size,
    originalSize: compressed.originalSize,
    savedBytes: compressed.savedBytes
  };
}

async function chatExportPayload() {
  const [channels, channelMembers, messages, pinnedItems, voiceListens, prayerActions, messageAiSuggestions] = await Promise.all([
    prisma.channel.findMany({ orderBy: { id: "asc" } }),
    prisma.channelMember.findMany({ orderBy: { id: "asc" } }),
    prisma.message.findMany({ orderBy: { id: "asc" } }),
    prisma.pinnedItem.findMany({ orderBy: { id: "asc" } }),
    prisma.voiceListen.findMany({ orderBy: { id: "asc" } }),
    prisma.prayerAction.findMany({ orderBy: { id: "asc" } }),
    prisma.messageAiSuggestion.findMany({ orderBy: { id: "asc" } })
  ]);
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    channels,
    channelMembers,
    messages,
    pinnedItems,
    voiceListens,
    prayerActions,
    messageAiSuggestions
  };
}

async function usersExportPayload() {
  const accounts = await prisma.account.findMany({ include: { actor: true }, orderBy: { id: "asc" } });
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    accounts: accounts.map((account) => ({
      id: account.id,
      username: account.username,
      passwordHash: account.passwordHash,
      displayName: account.displayName,
      avatarPath: account.avatarPath,
      role: account.role,
      canPinMessages: account.canPinMessages,
      theme: account.theme,
      biblePreferences: cleanBiblePreferences(account.biblePreferences),
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
      actor: account.actor
    }))
  };
}

app.post("/api/channels/:id/pinned", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const pushOrigin = pushOriginFromHeaders(request.headers);
  const channelId = Number((request.params as { id: string }).id);
  const body = z
    .object({
      kind: z.literal("notice").optional(),
      title: z.string().max(160).optional(),
      content: z.string().optional(),
      body: z.unknown().optional(),
      messageIds: z.array(z.number().int().positive()).max(80).optional(),
      active: z.boolean().default(true)
    })
    .parse(request.body);
  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel) return reply.code(404).send({ success: false, message: "频道不存在" });
  if (!(await canPinChannel(auth, channelId))) return reply.code(403).send({ success: false, message: "无权置顶此频道" });
  if (body.active) {
    const pinnedBody = body.messageIds?.length ? await pinnedBodyFromMessages(channelId, body.messageIds) : serializePinnedBody(body.body, body.content);
    if (!pinnedBody.blocks.length) return reply.code(400).send({ success: false, message: "置顶内容不能为空" });
    const textContent = pinnedBody.blocks
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .slice(0, 10000);
    await prisma.pinnedItem.updateMany({ where: { channelId }, data: { active: false } });
    const created = await prisma.pinnedItem.create({
      data: {
        channelId,
        kind: "notice",
        title: cleanPinnedTitle(body.title),
        content: textContent,
        body: pinnedBody as unknown as Prisma.InputJsonValue,
        messageId: null,
        active: true
      }
    });
    void sendPinnedPush(channelId, { title: created.title, body: pinnedBody }, pushOrigin).catch((error) => app.log.warn({ error }, "pinned push failed"));
  } else {
    await prisma.pinnedItem.updateMany({ where: { channelId }, data: { active: false } });
  }
  const dto = await channelDto(channelId, auth);
  io.to(`ch:${channelId}`).emit("pinned:updated", dto?.pinned || null);
  return { success: true, pinned: dto?.pinned || null };
});

app.post("/api/channels/:id/pinned/dismiss", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const channelId = Number((request.params as { id: string }).id);
  const body = z.object({ pinnedId: z.number().int().positive(), version: z.number().int().positive() }).parse(request.body);
  if (!(await canAccessChannel(auth.accountId, channelId))) return reply.code(403).send({ success: false, message: "无权访问此频道" });
  const pin = await prisma.pinnedItem.findFirst({ where: { id: body.pinnedId, channelId, version: body.version, active: true }, select: { id: true } });
  if (!pin) return reply.code(404).send({ success: false, message: "置顶不存在" });
  await prisma.pinnedSeen.upsert({
    where: { accountId_pinnedItemId_pinnedVersion: { accountId: auth.accountId, pinnedItemId: body.pinnedId, pinnedVersion: body.version } },
    update: { seenAt: new Date() },
    create: { accountId: auth.accountId, channelId, pinnedItemId: body.pinnedId, pinnedVersion: body.version }
  });
  return { success: true };
});

app.get("/api/channels/:id/pinned/files/:file", { preHandler: requireMediaAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const channelId = Number((request.params as { id: string }).id);
  const file = path.basename((request.params as { file: string }).file);
  if (!file || !(await canAccessChannel(auth.accountId, channelId))) return reply.code(403).send({ success: false, message: "无权访问文件" });
  const pin = await prisma.pinnedItem.findFirst({ where: { channelId, active: true }, orderBy: { updatedAt: "desc" } });
  if (!pin || !pinnedBodyUploadFilePaths(serializePinnedBody(pin.body, pin.content)).has(file)) return reply.code(404).send("Not found");
  const filePath = path.join(UPLOAD_DIR, file);
  if (!fs.existsSync(filePath)) return reply.code(404).send("Not found");
  const stat = fs.statSync(filePath);
  applyFileResponseHeaders(reply, file, false);
  if (applyFileValidation(request, reply, stat)) return reply.code(304).send();
  reply.header("Content-Length", String(stat.size));
  return reply.send(fs.createReadStream(filePath));
});

registerAdminAccountRoutes(app, {
  prisma,
  requireAdmin,
  toAccountDto: authDto,
  updateAccountAvatarFromUpload,
  writeLoginLog,
  disconnectSessions,
  refreshAccountConnections,
  deleteAccount: (input) =>
    deleteAccountService(
      {
        runTransaction: (operation) =>
          prisma.$transaction((tx) => operation(tx))
      },
      input
    ),
  emitAccountDeleted: (payload) => {
    io.emit("channel:updated", payload);
  }
});

app.get("/api/admin/export/chat", { preHandler: requireAdmin }, async (_request, reply) => {
  return jsonDownload(reply, `team-chat-data-${new Date().toISOString().slice(0, 10)}.json`, await chatExportPayload());
});

app.post("/api/admin/import/chat", { preHandler: requireAdmin }, async (request, reply) => {
  const payload = await readJsonUpload(request);
  const channels = Array.isArray(payload.channels) ? payload.channels : [];
  const channelMembers = Array.isArray(payload.channelMembers) ? payload.channelMembers : [];
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const pinnedItems = Array.isArray(payload.pinnedItems) ? payload.pinnedItems : [];
  const voiceListens = Array.isArray(payload.voiceListens) ? payload.voiceListens : [];
  const prayerActions = Array.isArray(payload.prayerActions) ? payload.prayerActions : [];
  const messageAiSuggestions = Array.isArray(payload.messageAiSuggestions) ? payload.messageAiSuggestions : [];
  await prisma.$transaction(async (tx) => {
    for (const channel of channels) {
      await tx.channel.upsert({
        where: { id: Number(channel.id) },
        update: {
          name: String(channel.name || "未命名频道").slice(0, 80),
          description: String(channel.description || "").slice(0, 255),
          icon: cleanChannelIcon(channel.icon),
          isPrivate: !!channel.isPrivate,
          isDefault: !!channel.isDefault,
          directKey: channel.directKey ? String(channel.directKey).slice(0, 120) : null,
          createdAt: parseDate(channel.createdAt),
          updatedAt: parseDate(channel.updatedAt)
        },
        create: {
          id: Number(channel.id) || undefined,
          name: String(channel.name || "未命名频道").slice(0, 80),
          description: String(channel.description || "").slice(0, 255),
          icon: cleanChannelIcon(channel.icon),
          isPrivate: !!channel.isPrivate,
          isDefault: !!channel.isDefault,
          directKey: channel.directKey ? String(channel.directKey).slice(0, 120) : null,
          createdAt: parseDate(channel.createdAt),
          updatedAt: parseDate(channel.updatedAt)
        }
      });
    }
    for (const member of channelMembers) {
      await tx.channelMember.upsert({
        where: { channelId_accountId: { channelId: Number(member.channelId), accountId: Number(member.accountId) } },
        update: { role: member.role || "member" },
        create: { channelId: Number(member.channelId), accountId: Number(member.accountId), role: member.role || "member", createdAt: parseDate(member.createdAt) }
      });
    }
    for (const message of messages) {
      await tx.message.upsert({
        where: { id: Number(message.id) },
        update: {
          channelId: Number(message.channelId),
          senderActorId: Number(message.senderActorId),
          content: message.content || "",
          type: message.type || "text",
          payload: message.payload === null || message.payload === undefined ? Prisma.JsonNull : message.payload,
          fileName: message.fileName || null,
          filePath: message.filePath || null,
          fileSize: message.fileSize === null || message.fileSize === undefined ? null : Number(message.fileSize),
          replyToId: message.replyToId || null,
          chainRootId: message.chainRootId || null,
          chainVersion: message.chainVersion || null,
          createdAt: parseDate(message.createdAt)
        },
        create: {
          id: Number(message.id) || undefined,
          channelId: Number(message.channelId),
          senderActorId: Number(message.senderActorId),
          content: message.content || "",
          type: message.type || "text",
          payload: message.payload === null || message.payload === undefined ? Prisma.JsonNull : message.payload,
          fileName: message.fileName || null,
          filePath: message.filePath || null,
          fileSize: message.fileSize === null || message.fileSize === undefined ? null : Number(message.fileSize),
          replyToId: message.replyToId || null,
          chainRootId: message.chainRootId || null,
          chainVersion: message.chainVersion || null,
          createdAt: parseDate(message.createdAt)
        }
      });
    }
    for (const pin of pinnedItems) {
      await tx.pinnedItem.upsert({
        where: { id: Number(pin.id) },
        update: {
          channelId: Number(pin.channelId),
          kind: pin.kind || "notice",
          title: pin.title || null,
          content: pin.content || null,
          body: pin.body === null || pin.body === undefined ? Prisma.JsonNull : pin.body,
          messageId: pin.messageId || null,
          version: Number(pin.version) || 1,
          active: !!pin.active
        },
        create: {
          id: Number(pin.id) || undefined,
          channelId: Number(pin.channelId),
          kind: pin.kind || "notice",
          title: pin.title || null,
          content: pin.content || null,
          body: pin.body === null || pin.body === undefined ? Prisma.JsonNull : pin.body,
          messageId: pin.messageId || null,
          version: Number(pin.version) || 1,
          active: !!pin.active,
          createdAt: parseDate(pin.createdAt),
          updatedAt: parseDate(pin.updatedAt)
        }
      });
    }
    for (const listen of voiceListens) {
      await tx.voiceListen.upsert({
        where: { messageId_accountId: { messageId: Number(listen.messageId), accountId: Number(listen.accountId) } },
        update: { listenedAt: parseDate(listen.listenedAt) },
        create: { messageId: Number(listen.messageId), accountId: Number(listen.accountId), listenedAt: parseDate(listen.listenedAt) }
      });
    }
    for (const action of prayerActions) {
      const id = Number(action.id) || undefined;
      const data = { messageId: Number(action.messageId), accountId: Number(action.accountId), prayedAt: parseDate(action.prayedAt) };
      if (id) {
        await tx.prayerAction.upsert({ where: { id }, update: data, create: { id, ...data } });
      } else {
        await tx.prayerAction.create({ data });
      }
    }
    for (const suggestion of messageAiSuggestions) {
      const id = Number(suggestion.id) || undefined;
      const data = {
        messageId: Number(suggestion.messageId),
        kind: String(suggestion.kind || AI_RELATED_VERSES_KIND).slice(0, 64),
        status: String(suggestion.status || "success").slice(0, 24),
        promptCommand: String(suggestion.promptCommand || "").slice(0, 4000),
        contextText: String(suggestion.contextText || "").slice(0, 5000),
        responseText: suggestion.responseText ? String(suggestion.responseText).slice(0, 4000) : null,
        references: suggestion.references === null || suggestion.references === undefined ? Prisma.JsonNull : suggestion.references,
        errorText: suggestion.errorText ? String(suggestion.errorText).slice(0, 1000) : null,
        model: suggestion.model ? String(suggestion.model).slice(0, 120) : null,
        baseUrl: suggestion.baseUrl ? String(suggestion.baseUrl).slice(0, 255) : null,
        createdByAccountId: suggestion.createdByAccountId ? Number(suggestion.createdByAccountId) : null,
        createdAt: parseDate(suggestion.createdAt)
      };
      if (id) {
        await tx.messageAiSuggestion.upsert({ where: { id }, update: data, create: { id, ...data } });
      } else {
        await tx.messageAiSuggestion.create({ data });
      }
    }
  });
  return { success: true, imported: { channels: channels.length, messages: messages.length } };
});

app.get("/api/admin/export/users", { preHandler: requireAdmin }, async (_request, reply) => {
  return jsonDownload(reply, `liao-users-${new Date().toISOString().slice(0, 10)}.json`, await usersExportPayload());
});

app.get("/api/admin/backups", { preHandler: requireAdmin }, async () => {
  return { backups: listAdminBackups() };
});

app.post("/api/admin/backups", { preHandler: requireAdmin }, async (request) => {
  const { fileName } = await createFullBackup((request as AuthedRequest).auth);
  return { success: true, backup: listAdminBackups().find((backup) => backup.fileName === fileName) };
});

app.get("/api/admin/backups/:file", { preHandler: requireAdmin }, async (request, reply) => {
  const fileName = path.basename((request.params as { file: string }).file);
  const filePath = backupFilePath(fileName);
  if (!filePath || !fs.existsSync(filePath)) return reply.code(404).send({ success: false, message: "备份不存在" });
  const stat = fs.statSync(filePath);
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("Content-Type", "application/zip");
  reply.header("Content-Length", String(stat.size));
  reply.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  return reply.send(fs.createReadStream(filePath));
});

app.delete("/api/admin/backups/:file", { preHandler: requireAdmin }, async (request, reply) => {
  const fileName = path.basename((request.params as { file: string }).file);
  const filePath = backupFilePath(fileName);
  if (!filePath || !fs.existsSync(filePath)) return reply.code(404).send({ success: false, message: "备份不存在" });
  fs.unlinkSync(filePath);
  return { success: true, deleted: fileName, backups: listAdminBackups() };
});

app.get("/api/admin/messages", { preHandler: requireAdmin }, async (request) => {
  const query = request.query as { channelId?: string; q?: string; limit?: string };
  const channelId = Number(query.channelId || 0);
  const q = String(query.q || "").trim();
  const limit = Math.min(Math.max(Number(query.limit || 80), 1), 200);
  const where: Prisma.MessageWhereInput = {
    ...(channelId ? { channelId } : {}),
    ...(q
      ? {
          OR: [
            { content: { contains: q } },
            { fileName: { contains: q } },
            { sender: { displayName: { contains: q } } },
            { channel: { name: { contains: q } } }
          ]
        }
      : {})
  };
  const messages = await prisma.message.findMany({
    where,
    include: { channel: true, sender: true },
    orderBy: { id: "desc" },
    take: limit
  });
  return {
    messages: messages.map(
      (message): AdminMessageDTO => ({
        id: message.id,
        channelId: message.channelId,
        channelName: message.channel.name,
        senderName: message.sender.displayName,
        type: message.type,
        content: messagePreview(message),
        fileName: message.fileName,
        fileSize: message.fileSize,
        createdAt: message.createdAt.toISOString()
      })
    )
  };
});

app.delete("/api/admin/messages/:id", { preHandler: requireAdmin }, async (request, reply) => {
  const id = Number((request.params as { id: string }).id);
  const message = await prisma.message.findUnique({ where: { id }, select: { id: true, channelId: true, filePath: true } });
  if (!message) return reply.code(404).send({ success: false, message: "消息不存在" });
  const deleted = await deleteMessages([message]);
  return { success: true, deleted };
});

app.delete("/api/admin/messages", { preHandler: requireAdmin }, async (request, reply) => {
  const query = request.query as { channelId?: string };
  if (request.body !== undefined && (typeof request.body !== "object" || Array.isArray(request.body))) {
    return reply.code(400).send({ success: false, message: "聊天记录参数无效" });
  }
  const body = request.body || {};
  const parsedBody = z.object({ ids: z.array(z.number().int().positive()).max(200).optional() }).strict().safeParse(body);
  if (!parsedBody.success) return reply.code(400).send({ success: false, message: "聊天记录参数无效" });
  const ids = parsedBody.success ? parsedBody.data.ids || [] : [];
  if (ids.length) {
    const messages = await prisma.message.findMany({
      where: { id: { in: ids } },
      select: { id: true, channelId: true, filePath: true }
    });
    const deleted = await deleteMessages(messages);
    return { success: true, deleted };
  }
  const channelId = Number(query.channelId || 0);
  const messages = await prisma.message.findMany({
    where: channelId ? { channelId } : {},
    select: { id: true, channelId: true, filePath: true }
  });
  const deleted = await deleteMessages(messages);
  return { success: true, deleted };
});

app.get("/api/admin/attachments", { preHandler: requireAdmin }, async () => {
  return { attachments: await adminAttachmentList() };
});

app.get("/api/admin/attachments/file/:kind/:file", { preHandler: requireAdmin }, async (request, reply) => {
  const { kind, file } = request.params as { kind: AdminAttachmentDTO["kind"]; file: string };
  const query = request.query as { download?: string };
  if (kind !== "upload" && kind !== "avatar" && kind !== "background") return reply.code(404).send("Not found");
  const fileName = path.basename(file);
  const filePath = storageFilePath(kind, fileName);
  if (!fileName || !fs.existsSync(filePath)) return reply.code(404).send("Not found");
  const stat = fs.statSync(filePath);
  const range = request.headers.range;
  reply.header("Accept-Ranges", "bytes");
  applyFileResponseHeaders(reply, fileName, query.download === "1");
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
      if (Number.isFinite(start) && Number.isFinite(end) && start <= end && start < stat.size) {
        reply.code(206);
        reply.header("Content-Range", `bytes ${start}-${end}/${stat.size}`);
        reply.header("Content-Length", String(end - start + 1));
        return reply.send(fs.createReadStream(filePath, { start, end }));
      }
    }
    reply.code(416);
    reply.header("Content-Range", `bytes */${stat.size}`);
    return reply.send();
  }
  reply.header("Content-Length", String(stat.size));
  return reply.send(fs.createReadStream(filePath));
});

app.delete("/api/admin/attachments", { preHandler: requireAdmin }, async (request, reply) => {
  const body = z.object({ ids: z.array(z.string()).optional(), all: z.boolean().optional() }).parse(request.body || {});
  const targets = body.all ? (await adminAttachmentList()).map((item) => parseAttachmentId(item.id)).filter(Boolean) : (body.ids || []).map(parseAttachmentId).filter(Boolean);
  if (!targets.length) return reply.code(400).send({ success: false, message: "请选择要删除的附件" });
  const deleted = await deleteAttachmentTargets(targets as Array<{ kind: AdminAttachmentDTO["kind"]; fileName: string }>);
  return { success: true, deleted, requested: targets.length };
});

app.post("/api/admin/attachments/compress", { preHandler: requireAdmin }, async (request, reply) => {
  const body = z.object({ ids: z.array(z.string()).min(1).max(50) }).parse(request.body || {});
  const targets = body.ids.map(parseAttachmentId).filter(Boolean) as Array<{ kind: AdminAttachmentDTO["kind"]; fileName: string }>;
  if (!targets.length) return reply.code(400).send({ success: false, message: "请选择要压缩的图片" });
  const results = [];
  for (const target of targets) results.push(await compressAttachmentTarget(target));
  const compressed = results.filter((item) => item.status === "compressed");
  const savedBytes = compressed.reduce((sum, item) => sum + ("savedBytes" in item ? item.savedBytes : 0), 0);
  return {
    success: true,
    compressed: compressed.length,
    skipped: results.length - compressed.length,
    savedBytes,
    results,
    attachments: await adminAttachmentList()
  };
});

app.post("/api/admin/import/users", { preHandler: requireAdmin }, async (request) => {
  const auth = (request as AuthedRequest).auth;
  const payload = await readJsonUpload(request);
  const accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
  const changedAccountIds = new Set<number>();
  for (const item of accounts) {
    const role = item.role === "admin" ? "admin" : "user";
    const theme = THEMES.has(item.theme) ? item.theme : "wechat";
    const biblePreferences = biblePreferencesJson(item.biblePreferences);
    const passwordHash = String(item.passwordHash || (await bcrypt.hash(crypto.randomUUID(), 12)));
    const account = await prisma.account.upsert({
      where: { username: String(item.username) },
      update: {
        passwordHash,
        displayName: String(item.displayName || item.username).slice(0, 80),
        avatarPath: item.avatarPath || null,
        role,
        canPinMessages: !!item.canPinMessages,
        theme,
        biblePreferences
      },
      create: {
        id: Number(item.id) || undefined,
        username: String(item.username).slice(0, 64),
        passwordHash,
        displayName: String(item.displayName || item.username).slice(0, 80),
        avatarPath: item.avatarPath || null,
        role,
        canPinMessages: !!item.canPinMessages,
        theme,
        biblePreferences,
        createdAt: parseDate(item.createdAt),
        actor: {
          create: {
            id: Number(item.actor?.id) || undefined,
            kind: "human",
            username: String(item.actor?.username || item.username).slice(0, 80),
            displayName: String(item.actor?.displayName || item.displayName || item.username).slice(0, 80),
            avatarPath: item.actor?.avatarPath || item.avatarPath || null,
            status: item.actor?.status || "active",
            createdAt: parseDate(item.actor?.createdAt)
          }
        }
      },
      include: { actor: true }
    });
    changedAccountIds.add(account.id);
    if (account.actor) {
      await prisma.actor.update({
        where: { id: account.actor.id },
        data: {
          displayName: String(item.actor?.displayName || item.displayName || item.username).slice(0, 80),
          avatarPath: item.actor?.avatarPath || item.avatarPath || null,
          status: item.actor?.status || "active"
        }
      });
    }
  }
  const adminCount = await prisma.account.count({ where: { role: "admin" } });
  if (!adminCount) {
    await prisma.account.update({ where: { id: auth.accountId }, data: { role: "admin" } });
    changedAccountIds.add(auth.accountId);
  }
  const changedAccounts = changedAccountIds.size
    ? await prisma.account.findMany({ where: { id: { in: [...changedAccountIds] } }, include: { actor: true } })
    : [];
  changedAccounts.forEach(refreshAccountConnections);
  return { success: true, imported: { accounts: accounts.length } };
});

app.get("/api/admin/accounts/:id/attachments/export", { preHandler: requireAdmin }, async (request, reply) => {
  const accountId = Number((request.params as { id: string }).id);
  const account = await prisma.account.findUnique({ where: { id: accountId }, include: { actor: true } });
  if (!account) return reply.code(404).send({ success: false, message: "用户不存在" });
  const messages = await prisma.message.findMany({ where: { sender: { accountId }, filePath: { not: null } }, orderBy: { id: "asc" } });
  const manifest = {
    account: authDto(account),
    exportedAt: new Date().toISOString(),
    files: messages.map((message) => ({ messageId: message.id, fileName: message.fileName, filePath: message.filePath, fileSize: message.fileSize, createdAt: message.createdAt }))
  };
  const entries: Array<{ name: string; data: Buffer; date?: Date }> = [{ name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2), "utf8") }];
  for (const message of messages) {
    if (!message.filePath) continue;
    const filePath = path.join(UPLOAD_DIR, path.basename(message.filePath));
    if (fs.existsSync(filePath)) {
      entries.push({ name: `attachments/${message.id}-${zipSafeName(message.fileName || message.filePath)}`, data: fs.readFileSync(filePath), date: message.createdAt });
    }
  }
  const zip = zipArchive(entries);
  reply.header("Content-Type", "application/zip");
  reply.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`liao-${account.username}-attachments.zip`)}`);
  return reply.send(zip);
});

app.delete("/api/admin/accounts/:id/attachments", { preHandler: requireAdmin }, async (request, reply) => {
  const accountId = Number((request.params as { id: string }).id);
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) return reply.code(404).send({ success: false, message: "用户不存在" });
  const messages = await prisma.message.findMany({ where: { sender: { accountId }, filePath: { not: null } }, select: { id: true, channelId: true, filePath: true } });
  const deleted = await detachMessageAttachments(messages);
  return { success: true, deleted };
});

app.get("/api/virtual-characters", { preHandler: requireAdmin }, async () => {
  const rows = await prisma.virtualCharacter.findMany({ include: { actor: true, memories: { take: 20, orderBy: { updatedAt: "desc" } } }, orderBy: { id: "asc" } });
  return { characters: rows };
});

app.post("/api/virtual-characters", { preHandler: requireAdmin }, async (request, reply) => {
  const body = z
    .object({
      username: z.string().regex(/^[a-zA-Z0-9_.-]{2,40}$/),
      displayName: z.string().min(1).max(80),
      enabled: z.boolean().default(true),
      config: z.unknown().optional(),
      engineBinding: z.unknown().optional()
    })
    .parse(request.body);
  try {
    const character = await prisma.virtualCharacter.create({
      data: {
        enabled: body.enabled,
        config: (body.config as object) || defaultVirtualCharacterConfig(body.displayName),
        engineBinding: (body.engineBinding as object) || {},
        actor: { create: { kind: "virtual", username: body.username, displayName: body.displayName } }
      },
      include: { actor: true }
    });
    return { success: true, character };
  } catch {
    return reply.code(409).send({ success: false, message: "角色用户名已存在" });
  }
});

app.put("/api/virtual-characters/:id", { preHandler: requireAdmin }, async (request, reply) => {
  const id = Number((request.params as { id: string }).id);
  const body = z.object({ displayName: z.string().min(1).max(80).optional(), enabled: z.boolean().optional(), config: z.unknown().optional(), engineBinding: z.unknown().optional() }).parse(request.body);
  const current = await prisma.virtualCharacter.findUnique({ where: { id }, include: { actor: true } });
  if (!current) return reply.code(404).send({ success: false, message: "角色不存在" });
  const updated = await prisma.virtualCharacter.update({
    where: { id },
    data: {
      enabled: body.enabled,
      config: body.config as object | undefined,
      engineBinding: body.engineBinding as object | undefined,
      actor: body.displayName ? { update: { displayName: body.displayName } } : undefined
    },
    include: { actor: true }
  });
  return { success: true, character: updated };
});

app.post("/api/virtual-characters/:id/avatar", { preHandler: requireAdmin }, async (request, reply) => {
  const id = Number((request.params as { id: string }).id);
  const character = await prisma.virtualCharacter.findUnique({ where: { id }, include: { actor: true } });
  if (!character) return reply.code(404).send({ success: false, message: "角色不存在" });
  const file = await request.file();
  if (!file) return reply.code(400).send({ success: false, message: "缺少头像图片" });
  const ext = path.extname(file.filename).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext) || !file.mimetype.startsWith("image/")) return reply.code(400).send({ success: false, message: "只支持图片头像" });
  const safeName = `${crypto.randomUUID()}${ext}`;
  const outPath = path.join(AVATAR_DIR, safeName);
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createWriteStream(outPath);
    file.file.pipe(stream);
    file.file.on("error", reject);
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
  if (!(await validateStoredImage(outPath))) {
    safeUnlink("avatar", safeName);
    return reply.code(400).send({ success: false, message: "头像内容无效或尺寸过大" });
  }
  let avatarPath = safeName;
  const compressed = await compressImageFile(outPath, AVATAR_DIR, { maxDimension: 256 });
  if (compressed) {
    fs.unlinkSync(outPath);
    avatarPath = compressed.fileName;
  }
  const actor = await prisma.actor.update({ where: { id: character.actorId }, data: { avatarPath } });
  return { success: true, character: { ...character, actor } };
});

app.delete("/api/virtual-characters/:id", { preHandler: requireAdmin }, async (request) => {
  const id = Number((request.params as { id: string }).id);
  await prisma.virtualCharacter.delete({ where: { id } });
  return { success: true };
});

app.post("/api/virtual-characters/:id/test-event", { preHandler: requireAdmin }, async (request) => {
  const id = Number((request.params as { id: string }).id);
  const body = z.object({ channelId: z.number(), prompt: z.string().default("手动测试") }).parse(request.body);
  await createEngineEvent("manual_test", { prompt: body.prompt }, body.channelId, undefined, id);
  return { success: true };
});

app.get("/api/engine/v1/events", async (request, reply) => {
  if (!checkEngineAuth(request)) return reply.code(401).send({ success: false, message: "engine token invalid" });
  const after = Number((request.query as { after?: string }).after || 0);
  const events = await prisma.engineEvent.findMany({ where: { id: { gt: after } }, orderBy: { id: "asc" }, take: 100 });
  return { events };
});

app.post("/api/engine/v1/actions", async (request, reply) => {
  if (!checkEngineAuth(request)) return reply.code(401).send({ success: false, message: "engine token invalid" });
  const body = z
    .object({
      eventId: z.number().optional(),
      event_id: z.number().optional(),
      idempotencyKey: z.string().min(8).max(120).optional(),
      idempotency_key: z.string().min(8).max(120).optional(),
      actionType: z.enum(["skip", "typing_start", "typing_stop", "send_message", "remember_user", "schedule_topic"]).optional(),
      action_type: z.enum(["skip", "typing_start", "typing_stop", "send_message", "remember_user", "schedule_topic"]).optional(),
      action: z.enum(["skip", "typing_start", "typing_stop", "send_message", "remember_user", "schedule_topic"]).optional(),
      characterId: z.number().optional(),
      character_id: z.number().optional(),
      channelId: z.number().optional(),
      channel_id: z.number().optional(),
      payload: z.unknown().optional()
    })
    .parse(request.body);

  const idempotencyKey = body.idempotencyKey || body.idempotency_key;
  const actionType = body.actionType || body.action_type || body.action;
  if (!idempotencyKey || !actionType) return reply.code(400).send({ success: false, message: "idempotency_key and action are required" });

  const rawPayload = body.payload && typeof body.payload === "object" && !Array.isArray(body.payload) ? (body.payload as Record<string, unknown>) : {};
  const payload = {
    ...rawPayload,
    characterId: rawPayload.characterId || rawPayload.character_id || body.characterId || body.character_id,
    channelId: rawPayload.channelId || rawPayload.channel_id || body.channelId || body.channel_id
  };
  const eventId = body.eventId || body.event_id;

  const existing = await prisma.engineAction.findUnique({ where: { idempotencyKey } });
  if (existing) return { success: true, duplicate: true, result: existing.result };
  const result = await handleEngineAction(actionType, payload, eventId);
  await prisma.engineAction.create({
    data: {
      eventId: eventId || null,
      idempotencyKey,
      actionType,
      payload,
      result: result as object
    }
  });
  return { success: true, result };
});

function defaultVirtualCharacterConfig(displayName: string) {
  return {
    profile: { name: displayName, persona: "", speakingStyle: "像微信群里的真人，简短自然" },
    channels: [],
    manualMemory: { shortTerm: "", midTerm: "", longTerm: "" },
    generation: { model: "", thinkingEnabled: false },
    replyPolicy: { mode: "external_engine_decides", allowSkip: true, allowMultipleMessages: true },
    proactivePolicy: { enabled: false, idleMinutes: 30 },
    typing: { show: true, minMs: 800, maxMs: 8000 },
    memory: { rememberUsers: true, maxItemsPerUser: 50 },
    modelHints: { provider: "deepseek", compatibleEndpoint: "/chat/completions", preferredModels: ["deepseek-v4-flash", "deepseek-v4-pro"] },
    multichar: {
      bio: { basics: { name: displayName, identity: "" } },
      emotionBaseline: "平静中性",
      modelHints: {}
    }
  };
}

function checkEngineAuth(request: FastifyRequest) {
  if (!ENGINE_API_TOKEN) return false;
  const token = request.headers.authorization?.startsWith("Bearer ") ? request.headers.authorization.slice(7) : request.headers["x-engine-token"];
  return token === ENGINE_API_TOKEN;
}

async function handleEngineAction(actionType: string, payload: unknown, eventId?: number) {
  const data = payload as any;
  if (actionType === "skip") return { skipped: true };
  if (actionType === "typing_start" || actionType === "typing_stop") {
    const channelId = Number(data.channelId);
    const character = await prisma.virtualCharacter.findUnique({ where: { id: Number(data.characterId) }, include: { actor: true } });
    if (!channelId || !character) throw new Error("invalid typing action");
    io.to(`ch:${channelId}`).emit("message:typing", {
      channelId,
      actor: { id: character.actor.id, username: character.actor.username, displayName: character.actor.displayName, kind: "virtual" },
      state: actionType === "typing_start" ? "start" : "stop"
    });
    return { typing: actionType };
  }
  if (actionType === "send_message") {
    const channelId = Number(data.channelId);
    const character = await prisma.virtualCharacter.findUnique({ where: { id: Number(data.characterId) }, include: { actor: true } });
    if (!channelId || !character?.enabled) throw new Error("invalid send action");
    const messages = Array.isArray(data.messages) ? data.messages : [{ content: data.content }];
    const created: MessageDTO[] = [];
    for (const msg of messages.slice(0, 6)) {
      const content = cleanText(msg.content);
      if (!content) continue;
      const row = await createMessageFromActor({ channelId, actorId: character.actorId, content, type: "text", replyToId: Number(msg.replyToId) || null });
      const dto = await hydrateMessage(row.id);
      if (dto) created.push(dto);
    }
    return { sent: created.map((m) => m.id) };
  }
  if (actionType === "remember_user") {
    const characterId = Number(data.characterId);
    const subjectType = String(data.subjectType || "account").slice(0, 32);
    const subjectId = String(data.subjectId || "").slice(0, 80);
    const content = String(data.content || "").slice(0, 2000);
    if (!characterId || !subjectId || !content) throw new Error("invalid memory action");
    const memory = await prisma.characterMemory.create({ data: { characterId, subjectType, subjectId, content, confidence: Number(data.confidence || 1) } });
    return { memoryId: memory.id };
  }
  if (actionType === "schedule_topic") {
    const channelId = Number(data.channelId);
    await createEngineEvent("active_topic_due", { topic: data.topic || "", scheduledBy: data.characterId || null }, channelId, undefined, Number(data.characterId) || undefined);
    return { scheduled: true };
  }
  return { ok: true, eventId };
}

const multicharDeps: MulticharDeps = {
  prisma,
  io,
  log: (level: "info" | "warn" | "error", msg: string, data?: unknown) => {
    const logger = app.log as any;
    if (typeof logger[level] === "function") logger[level]({ data }, `[multichar] ${msg}`);
  },
  loadAiSettings: () => loadAiSettings(),
  decryptAiApiKey: (value: string) => decryptAiApiKey(value),
  createMessageFromActor: (input: any) => createMessageFromActor(input),
};
const multicharManager = createMulticharManager(multicharDeps);
registerMulticharRoutes(app, multicharDeps, multicharManager, requireAdmin);

const musicResourceAiClient = createAiClient(multicharDeps);
registerMusicResourceRoutes(app, {
  prisma,
  io,
  musicService,
  requireAuth,
  musicScoreDir: MUSIC_SCORE_DIR,
  imageWebpEffort: IMAGE_WEBP_EFFORT,
  serializeMessage,
  displayWebpFileName,
  safeUnlinkMusicScore,
  loadAiSettings,
  decryptAiApiKey,
  callLlm: (messages, options) => musicResourceAiClient.callLlm(messages, options)
});

app.addHook("onClose", async () => {
  if (musicListenerCleanupTimer) clearInterval(musicListenerCleanupTimer);
  if (bibleReaderCleanupTimer) clearInterval(bibleReaderCleanupTimer);
  if (friendListenerCleanupTimer) clearInterval(friendListenerCleanupTimer);
  if (friendFeedRefreshTimer) clearTimeout(friendFeedRefreshTimer);
  multicharManager.stopAll();
  io.close();
  await musicProgressTracker.flushAll();
  musicProgressTracker.dispose();
  await prisma.$disconnect();
});

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token || socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, "");
    socket.data.token = token;
    socket.data.auth = await verifyJwtToken(token);
    next();
  } catch {
    next(new Error("认证失败"));
  }
});

io.on("connection", async (socket: Socket) => {
  const auth = socket.data.auth as AuthContext;
  const pushOrigin = pushOriginFromHeaders(socket.handshake.headers);
  const account = await prisma.account.findUnique({ where: { id: auth.accountId }, include: { actor: true } });
  if (!account?.actor) return socket.disconnect(true);
  const session = await prisma.accountSession.findUnique({
    where: { id: auth.sessionId },
    select: { id: true, deviceKind: true, deviceName: true, ipAddress: true, userAgent: true }
  });
  const ids = accountSocketIds.get(account.id) || new Set<string>();
  const wasOffline = ids.size === 0;
  ids.add(socket.id);
  accountSocketIds.set(account.id, ids);
  socket.join(`acct:${account.id}`);
  online.set(socket.id, { actorId: account.actor.id, accountId: account.id, username: account.username, displayName: account.displayName, avatarPath: account.avatarPath });
  if (wasOffline) {
    const joinedAt = new Date();
    accountPresenceStartedAt.set(account.id, joinedAt);
    await writeLoginLog("presence_join", account.id, session, joinedAt);
  }
  const channels = await prisma.channel.findMany({
    where: {
      OR: [
        { kind: "music" },
        { kind: { in: PUBLIC_CHANNEL_KINDS }, isPrivate: false },
        { kind: { in: PUBLIC_CHANNEL_KINDS }, members: { some: { accountId: auth.accountId } } }
      ]
    },
    select: { id: true }
  });
  channels.forEach((ch) => socket.join(`ch:${ch.id}`));
  await broadcastPresence();
  // Listener lists did not change on connect: send the snapshots only to the
  // new socket instead of broadcasting them to everyone.
  socket.emit("music:listeners", musicListenersSnapshot());
  socket.emit("friend:listeners", friendListenersSnapshot());

  socket.on("channel:join", async (data: { channelId: number }) => {
    const currentAuth = await refreshSocketAuth(socket);
    if (!currentAuth) return;
    const channelId = Number(data.channelId);
    if (await canAccessChannel(currentAuth.accountId, channelId)) {
      socket.join(`ch:${channelId}`);
      void writeActivityLog({ kind: "channel_view", accountId: currentAuth.accountId, sessionId: currentAuth.sessionId, channelId });
    }
  });

  socket.on("message:send", async (data: unknown, ack?: (payload: unknown) => void) => {
    try {
      const currentAuth = await refreshSocketAuth(socket);
      if (!currentAuth) return ack?.({ success: false, message: "认证失败" });
      const body = z
        .object({
          channelId: z.number(),
          content: z.string(),
          type: z.enum(["text", "prayer"]).default("text"),
          payload: z.unknown().optional(),
          replyToId: z.number().nullable().optional()
        })
        .parse(data);
      if (!(await canWriteChannel(currentAuth.accountId, body.channelId))) return ack?.({ success: false, message: "无权在此频道发言" });
      if (await isMusicChannel(body.channelId)) return ack?.({ success: false, message: "音乐频道只能上传 MP3 和 M4A 文件" });
      const content = cleanText(body.content);
      if (!content.replace(/<[^>]*>/g, "").trim() && !/<br\s*\/?>/i.test(content)) return ack?.({ success: false, message: "消息不能为空" });
      const payload = body.type === "prayer" ? cleanPrayerPayload(body.payload) : await cleanTextMessagePayload(body.payload);
      const prayerImageMessageId = body.type === "prayer" ? Number((payload as { imageMessageId?: unknown }).imageMessageId || 0) : 0;
      if (prayerImageMessageId && !(await isValidPrayerImageMessage(prayerImageMessageId, body.channelId))) {
        return ack?.({ success: false, message: "附带照片无效" });
      }
      const message = await createMessageFromActor({
        channelId: body.channelId,
        actorId: currentAuth.actorId,
        content,
        type: body.type,
        payload,
        replyToId: body.replyToId || null,
        pushOrigin
      });
      void writeActivityLog({
        kind: "message_sent",
        accountId: currentAuth.accountId,
        sessionId: currentAuth.sessionId,
        channelId: body.channelId,
        state: body.type
      });
      ack?.({ success: true, messageId: message.id, message: await hydrateMessage(message.id, currentAuth.accountId) });
    } catch (error) {
      ack?.({ success: false, message: error instanceof Error ? error.message : "发送失败" });
    }
  });

  // Per-socket debounce for typing signals: identical states inside the
  // window skip auth and DB work entirely. The client throttles sends too.
  const typingSeenAt = new Map<string, number>();

  socket.on("message:typing", async (data: { channelId: number; state: "start" | "stop" }) => {
    const channelId = Number(data.channelId);
    const typingKey = `${channelId}:${data.state}`;
    const now = Date.now();
    if (now - (typingSeenAt.get(typingKey) ?? 0) < 2000) return;
    typingSeenAt.set(typingKey, now);
    const currentAuth = await refreshSocketAuth(socket);
    if (!currentAuth || !(await canAccessChannel(currentAuth.accountId, channelId))) return;
    // The profile was resolved at connect time; no per-event actor lookup.
    const profile = online.get(socket.id);
    if (!profile) return;
    socket.to(`ch:${channelId}`).emit("message:typing", {
      channelId,
      actor: { id: profile.actorId, username: profile.username, displayName: profile.displayName, kind: "human" },
      state: data.state
    });
  });

  socket.on("music:listening", async (data: unknown) => {
    const currentAuth = await refreshSocketAuth(socket);
    if (!currentAuth) return;
    const body = z.object({ trackId: z.number().int().positive().nullable() }).safeParse(data);
    if (!body.success || body.data.trackId === null) {
      // Only broadcast when the listener entry actually existed.
      if (musicListeners.delete(socket.id)) broadcastMusicListeners();
      return;
    }
    const existing = musicListeners.get(socket.id);
    if (existing?.trackId === body.data.trackId) {
      existing.updatedAt = Date.now();
      return;
    }
    const track = await prisma.message.findFirst({
      where: { id: body.data.trackId, channel: { kind: "music" }, type: "file", fileName: { not: null } },
      select: { id: true, fileName: true }
    });
    if (!track || !isMusicFileName(track.fileName)) return;
    musicListeners.set(socket.id, {
      accountId: currentAuth.accountId,
      displayName: account.displayName,
      trackId: track.id,
      trackTitle: musicTrackTitle(track.fileName || ""),
      updatedAt: Date.now()
    });
    broadcastMusicListeners();
  });

  socket.on("bible:reading", async (data: unknown) => {
    const currentAuth = await refreshSocketAuth(socket);
    if (!currentAuth) return;
    const body = z.object({ active: z.boolean(), bookName: z.string().trim().min(1).max(40).nullable() }).safeParse(data);
    if (!body.success || !body.data.active) {
      if (bibleReaders.delete(socket.id)) broadcastBibleReaders();
      return;
    }
    const existing = bibleReaders.get(socket.id);
    if (existing?.bookName === body.data.bookName) {
      existing.updatedAt = Date.now();
      return;
    }
    bibleReaders.set(socket.id, {
      accountId: currentAuth.accountId,
      displayName: account.displayName,
      bookName: body.data.bookName,
      updatedAt: Date.now()
    });
    broadcastBibleReaders();
  });

  socket.on("friend:listening", async (data: unknown) => {
    const currentAuth = await refreshSocketAuth(socket);
    if (!currentAuth) return;
    const body = z.object({
      programId: z.string().trim().min(1).max(32),
      programTitle: z.string().trim().min(1).max(255)
    }).nullable().safeParse(data);
    if (!body.success || body.data === null) {
      if (friendListeners.delete(socket.id)) broadcastFriendListeners();
      return;
    }
    const existing = friendListeners.get(socket.id);
    if (existing?.programId === body.data.programId) {
      existing.updatedAt = Date.now();
      return;
    }
    friendListeners.set(socket.id, {
      accountId: currentAuth.accountId,
      displayName: account.displayName,
      programId: body.data.programId,
      programTitle: body.data.programTitle,
      updatedAt: Date.now()
    });
    broadcastFriendListeners();
  });

  socket.on("disconnect", async () => {
    online.delete(socket.id);
    const musicListenerChanged = musicListeners.delete(socket.id);
    const bibleReaderChanged = bibleReaders.delete(socket.id);
    const friendListenerChanged = friendListeners.delete(socket.id);
    const set = accountSocketIds.get(account.id);
    let isOffline = false;
    if (set) {
      set.delete(socket.id);
      if (!set.size) {
        accountSocketIds.delete(account.id);
        isOffline = true;
      }
    }
    if (isOffline) {
      const leftAt = new Date();
      const joinedAt = accountPresenceStartedAt.get(account.id);
      accountPresenceStartedAt.delete(account.id);
      await writeLoginLog("presence_leave", account.id, session, leftAt, {
        durationMs: joinedAt ? Math.max(0, leftAt.getTime() - joinedAt.getTime()) : undefined
      });
    }
    await broadcastPresence();
    if (musicListenerChanged) broadcastMusicListeners();
    if (bibleReaderChanged) broadcastBibleReaders();
    if (friendListenerChanged) broadcastFriendListeners();
  });
});

app.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith("/api/")) return reply.code(404).send({ success: false, message: "Not found" });
  const indexPath = path.join(DIST_CLIENT, "index.html");
  if (fs.existsSync(indexPath)) return reply.type("text/html").send(fs.createReadStream(indexPath));
  return reply.code(404).send("Client build not found");
});

app.addHook("onListen", async () => {
  void backfillImageMessageDimensions().catch((error) => app.log.warn({ error }, "image dimensions backfill failed"));
  void backfillAudioMessageWaveforms().catch((error) => app.log.warn({ error }, "audio waveform backfill failed"));
  void backfillImageThumbnails().catch((error) => app.log.warn({ error }, "image thumbnail backfill failed"));
});

let appBuilt = false;

export async function buildApp(options: BuildAppOptions = {}) {
  if (appBuilt) throw new Error("Fastify application has already been built");
  appBuilt = true;
  for (const dir of [STORAGE_ROOT, UPLOAD_DIR, MUSIC_SCORE_DIR, AVATAR_DIR, BG_DIR, PARALLAX_DIR, BACKUP_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  startCleanupTimers();
  try {
    if (options.runStartupTasks !== false) {
      await ensureBootstrap();
      await ensureWebPush();
    }
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}
