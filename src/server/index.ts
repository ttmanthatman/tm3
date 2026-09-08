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
import { Server as SocketIOServer, type Socket } from "socket.io";
import webPush from "web-push";
import { z } from "zod";
import { createMulticharManager } from "./multichar/index.js";
import { createAiClient } from "./multichar/ai.js";
import { registerMulticharRoutes } from "./multichar/routes.js";
import type { MulticharDeps } from "./multichar/types.js";
import { registerAdminAccountRoutes } from "./routes/adminAccounts.js";
import { registerBibleRoutes } from "./routes/bible.js";
import { chatRecordItemRef, registerForwardRoutes } from "./routes/forward.js";
import { registerBooksRoutes } from "./routes/books.js";
import { registerFriendRoutes } from "./routes/friend.js";
import { registerMusicRoutes } from "./routes/music.js";
import { registerMusicResourceRoutes } from "./routes/musicResources.js";
import { registerUnreadCountsRoutes } from "./routes/unreadCounts.js";
import { registerChannelOwnershipRoutes } from "./routes/channelOwnership.js";
import { registerReceptionRoutes } from "./routes/reception.js";
import { normalizeWeChatRelayNasAccessUrl, registerWeChatRelayRoutes } from "./routes/wechatRelay.js";
import { registerSermonRoutes } from "./routes/sermon.js";
import { registerAdminDataRoutes } from "./routes/adminData.js";
import { registerAdminLogRoutes } from "./routes/adminLogs.js";
import { registerAdminUpdateRoutes, UPDATE_REPO_URL } from "./routes/adminUpdate.js";
import { registerAiSettingsRoutes } from "./routes/aiSettings.js";
import { createAppearanceService, registerAppearanceRoutes, saveImageUpload } from "./routes/appearance.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerBibleLookupRoutes } from "./routes/bibleLookup.js";
import { registerEngineRoutes, defaultVirtualCharacterConfig } from "./routes/engine.js";
import { registerNotificationsRoutes } from "./routes/notifications.js";
import { registerSystemRoutes } from "./routes/system.js";
import { registerWhyTopicsRoutes } from "./routes/whyTopics.js";
import {
  AI_RELATED_VERSES_KIND,
  AI_ROLE_USERNAMES,
  DEFAULT_QUESTION_ASSISTANT_CONTEXT_TURNS,
  DEFAULT_QUESTION_ASSISTANT_CONTEXT_WINDOW_MINUTES,
  DEFAULT_QUESTION_ASSISTANT_JUDGE_PROMPT,
  DEFAULT_QUESTION_ASSISTANT_PROMPT,
  DEFAULT_WHY_ASSISTANT_PROMPT,
  QUESTION_ASSISTANT_NAME,
  QUESTION_ASSISTANT_USERNAME,
  WHY_ASSISTANT_NAME,
  WHY_ASSISTANT_USERNAME,
  clampInteger,
  createAiSettingsStore,
  parseAiVerseReferences
} from "./aiSettings.js";
import { cleanBiblePreferences } from "./biblePreferences.js";
import { applyFileResponseHeaders, applyFileValidation } from "./fileResponses.js";
import {
  IMAGE_EXTENSIONS,
  IMAGE_WEBP_EFFORT,
  compressImageFile,
  displayWebpFileName,
  imageProcessingLog,
  isImageFileName,
  storedImageDimensions,
  validateStoredImage,
  wantsOriginalImage,
  writeImageThumbnail
} from "./imageProcessing.js";
import { appendPinnedTextBlock, cleanPinnedTitle, pinnedBlocksFromMessage, pinnedBodyUploadFilePaths, pinnedPlainTextFromHtml, serializePinnedBody } from "./pinnedBody.js";
import { AVATAR_DIR, BACKUP_DIR, BG_DIR, BOOKS_DIR, DIST_CLIENT, MUSIC_SCORE_DIR, PARALLAX_DIR, STORAGE_ROOT, UPLOAD_DIR, safeUnlink, safeUnlinkMusicScore } from "./storageDirs.js";
import { parseJsonField, plainTextFromHtml, stripMarkdownSyntax } from "./textUtils.js";

export { writeImageThumbnail };
import { createSermonPresentationService } from "./sermon/presentations.js";
import { registerSermonSocket } from "./sermon/socket.js";
import { deleteAccount as deleteAccountService } from "./services/accountDeletion.js";
import { createFriendFeedService, nextFriendFeedRefreshAt } from "./friendFeed.js";
import { createMusicService } from "./services/musicService.js";
import { createReceptionService } from "./services/receptionService.js";
import {
  appendChainParticipant,
  CHAIN_CUSTOM_TEXT_LIMIT,
  CHAIN_OPTION_LABEL_LIMIT,
  CHAIN_OPTION_LIMIT,
  createChainPayload,
  normalizeChainOptionLabels
} from "./services/chainService.js";
import type {
  AdminLoginLogKind,
  AiSettingsDTO,
  AiSuggestionDTO,
  BibleReaderPresenceDTO,
  BookReaderPresenceDTO,
  ChainPayload,
  FriendListenerDTO,
  MessageDTO,
  MessageEffect,
  MusicListenerDTO,
  PinnedBodyDTO,
  PinnedContentBlockDTO,
  PrayerStatus
} from "../shared/types.js";
import { APP_VERSION, RELEASE_NOTES } from "../shared/release.js";
import { cleanSupportedMessageEffect } from "../shared/messageEffects.js";
import { fetchLinkPreview } from "./linkPreview.js";
import {
  channelNeedsExplicitMembership,
  channelNotificationAudienceWhere,
  virtualCharacterConfigForChannel,
  virtualCharacterVisibleInChannel
} from "./channelMembership.js";
import { fileResponsePolicy } from "./filePolicy.js";
import { leaveAccountSocketsFromChannel } from "./channelSocketMembership.js";
import { CONTENT_SECURITY_POLICY } from "./securityHeaders.js";
import { envFlagEnabled } from "./featureFlags.js";
import { pushOriginFromHeaders } from "./pushOrigin.js";
import { MUSIC_EXTENSIONS, canManageMusicRole, isMusicFileName, isStoredMusicFile, musicTrackTitle } from "./music.js";
import { analyzeAudioWaveform, mergeAudioWaveformPayload } from "./audioWaveform.js";
import { parseLyrics } from "./srt.js";
import { activityLogCategory, friendlyDeviceName } from "../shared/activityLog.js";
import { deduplicateStoredUpload, sha256File } from "./uploadDeduplication.js";
import { imageDimensionsFromPayload, mergeImageDimensionsPayload, orientedImageDimensions, type ImageDimensions } from "../shared/imageDimensions.js";
import { recalledMessageData } from "./messageRecall.js";
import { prependPrayerUpdateHistory } from "./prayerUpdates.js";
import { fallbackDirectChatNames, isAutomaticDirectChatName, parseDirectChatNameSuggestions } from "./directChatNames.js";
import { demoCacheDir, demoManifestUrl, demoModeAvailable, demoStatePath } from "./demo/config.js";

export type BuildAppOptions = {
  runStartupTasks?: boolean;
};

const JWT_SECRET = process.env.JWT_SECRET || "dev-change-me-before-production";
const RECEPTION_INVITE_ORIGIN = process.env.RECEPTION_INVITE_ORIGIN?.trim() || undefined;
const IS_PRODUCTION = process.env.NODE_ENV === "production";
if (IS_PRODUCTION && (JWT_SECRET === "dev-change-me-before-production" || JWT_SECRET.length < 32)) {
  throw new Error("JWT_SECRET must be set to at least 32 characters in production");
}
// 登录限流阈值可用环境变量放宽（e2e 多账号并发登录），默认保持 10 次/分钟。
const AUTH_LOGIN_RATE_LIMIT_MAX = Math.max(1, Number(process.env.AUTH_LOGIN_RATE_LIMIT_MAX || 10) || 10);
const WECHAT_RELAY_AGENT_TOKEN = process.env.WECHAT_RELAY_AGENT_TOKEN || "";
const WECHAT_RELAY_NAS_ACCESS_URL = normalizeWeChatRelayNasAccessUrl(process.env.WECHAT_RELAY_NAS_ACCESS_URL);
const PUSH_NOTIFICATIONS_ENABLED = envFlagEnabled(process.env.PUSH_NOTIFICATIONS_ENABLED);
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || process.env.WEB_PUSH_SUBJECT || "mailto:admin@example.com";
const AI_SETTINGS_SECRET = process.env.AI_SETTINGS_SECRET || JWT_SECRET;
const DEMO_MODE_AVAILABLE = demoModeAvailable();
const DEMO_MANIFEST_URL = DEMO_MODE_AVAILABLE ? demoManifestUrl(UPDATE_REPO_URL) : "";
const demoResetGate = { busy: false };
const CONFIGURED_CORS_ORIGINS = (process.env.CORS_ORIGINS || process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const SESSION_TTL_DAYS = 30;
const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
const JWT_EXPIRES_IN = `${SESSION_TTL_DAYS}d`;
const PUBLIC_CHANNEL_KINDS: ChannelKind[] = ["standard", "direct"];

// Channel visibility shared by the channel list and the unread-counts route:
// music channels are open; standard/direct channels are public or member-only.
function channelListWhere(accountId: number, isGuest = false): Prisma.ChannelWhereInput {
  if (isGuest) {
    return { kind: "reception", members: { some: { accountId } } };
  }
  return {
    OR: [
      { kind: "music" },
      { kind: { in: PUBLIC_CHANNEL_KINDS }, OR: [{ isPrivate: false }, { members: { some: { accountId } } }] },
      { kind: "reception", members: { some: { accountId } } }
    ]
  };
}
const MUSIC_CHANNEL_NAME = "音乐频道";
const MUSIC_CHANNEL_ICON = "歌";

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
const appearanceService = createAppearanceService({ prisma });
const aiSettingsStore = createAiSettingsStore({ prisma, secret: AI_SETTINGS_SECRET });

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

imageProcessingLog.warn = (data, message) => app.log.warn(data, message);

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

if (DEMO_MODE_AVAILABLE) {
  app.addHook("onRequest", async (request, reply) => {
    if (!demoResetGate.busy) return;
    const requestPath = request.url.split("?", 1)[0];
    if (requestPath.startsWith("/api/admin/demo/") || requestPath === "/api/health" || requestPath === "/api/version") return;
    if (requestPath.startsWith("/api/")) return reply.code(503).send({ success: false, message: "演示数据正在复位，请稍后重新载入" });
  });
}

await app.register(cors, { origin: fastifyCorsOrigin as any, credentials: true });
// 全局限流阈值可用环境变量放宽（e2e 短时间内请求密度远超生产），默认保持 240 次/分钟。
await app.register(rateLimit, { max: Math.max(1, Number(process.env.API_RATE_LIMIT_MAX || 240) || 240), timeWindow: "1 minute" });
await app.register(multipart, { limits: { fileSize: 80 * 1024 * 1024, files: 1 } });
// JSON APIs and text assets cross a high-latency link; only compressible
// content types are transformed, so media streams and binaries pass through.
await app.register(compress, { global: true, threshold: 1024 });

if (fs.existsSync(DIST_CLIENT)) {
  await app.register(fastifyStatic, {
    root: DIST_CLIENT,
    wildcard: false,
    cacheControl: false,
    setHeaders(reply, filePath) {
      // Vite emits content-hashed filenames under assets/, which are safe to
      // cache forever; everything else (index.html, sw.js, icons) revalidates.
      const immutable = filePath.includes(`${path.sep}assets${path.sep}`);
      reply.header("Cache-Control", immutable ? "public, max-age=31536000, immutable" : "public, max-age=0");
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
  isGuest: boolean;
  guestExpiresAt: Date | null;
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

const online = new Map<string, { actorId: number; accountId: number; username: string; displayName: string; avatarPath?: string | null; isGuest: boolean }>();
const accountSocketIds = new Map<number, Set<string>>();
const accountPresenceStartedAt = new Map<number, Date>();
const musicListeners = new Map<string, MusicListenerDTO & { updatedAt: number }>();
const bibleReaders = new Map<string, BibleReaderPresenceDTO & { updatedAt: number }>();
const bookReaders = new Map<string, BookReaderPresenceDTO & { updatedAt: number }>();
const friendListeners = new Map<string, FriendListenerDTO & { updatedAt: number }>();
let vapidPublicKey = "";
let pushReady = false;


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
      isGuest: account.isGuest,
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
  if (account.isGuest && (!account.guestExpiresAt || account.guestExpiresAt <= new Date())) throw new Error("guest session expired");
  const touchBefore = new Date(Date.now() - 5 * 60 * 1000);
  await prisma.accountSession.updateMany({ where: { id: session.id, lastSeenAt: { lt: touchBefore } }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  return {
    accountId: account.id,
    actorId: account.actor.id,
    username: account.username,
    isAdmin: account.role === "admin",
    isGuest: account.isGuest,
    guestExpiresAt: account.guestExpiresAt,
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

// 讲道权限申请卡：留言裁剪到 500 字，status 恒为 pending，客户端无法伪造审批结果。
function cleanSermonRequestPayload(input: unknown) {
  const note = input && typeof input === "object" && !Array.isArray(input) ? (input as { note?: unknown }).note : undefined;
  return {
    kind: "sermon_request",
    status: "pending" as const,
    note: plainTextFromHtml(typeof note === "string" ? note : "", 500)
  };
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
  const aiSettings = await aiSettingsStore.loadAiSettings();
  const apiKey = aiSettingsStore.decryptAiApiKey(aiSettings.encryptedApiKey);
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




// Older uploads predate thumbnails; generate missing variants once in the
// background after boot. Already-covered files skip on an existsSync check.
async function backfillImageThumbnails() {
  for (const name of fs.readdirSync(UPLOAD_DIR)) {
    if (name.endsWith(".thumb.webp") || !isImageFileName(name)) continue;
    await writeImageThumbnail(path.join(UPLOAD_DIR, name));
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
    isGuest: account.isGuest,
    guestExpiresAt: account.guestExpiresAt?.toISOString() || null,
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

async function canAccessChannel(accountId: number, channelId: number) {
  const [channel, account] = await Promise.all([
    prisma.channel.findUnique({ where: { id: channelId } }),
    prisma.account.findUnique({ where: { id: accountId }, select: { isGuest: true, guestExpiresAt: true } })
  ]);
  if (!channel || !account) return false;
  if (account.isGuest) {
    if (!account.guestExpiresAt || account.guestExpiresAt <= new Date() || channel.kind !== "reception" || !channel.receptionExpiresAt || channel.receptionExpiresAt <= new Date()) return false;
    const member = await prisma.channelMember.findUnique({ where: { channelId_accountId: { channelId, accountId } } });
    return !!member;
  }
  if (channel.kind === "aiLounge") return false;
  if (channel.kind === "music") return true;
  if (!channelNeedsExplicitMembership(channel)) return true;
  const member = await prisma.channelMember.findUnique({ where: { channelId_accountId: { channelId, accountId } } });
  return !!member;
}

async function canWriteChannel(accountId: number, channelId: number) {
  const [channel, account] = await Promise.all([
    prisma.channel.findUnique({ where: { id: channelId } }),
    prisma.account.findUnique({ where: { id: accountId }, select: { isGuest: true, guestExpiresAt: true } })
  ]);
  if (!channel || !account) return false;
  if (account.isGuest) {
    if (!account.guestExpiresAt || account.guestExpiresAt <= new Date() || channel.kind !== "reception" || !channel.receptionExpiresAt || channel.receptionExpiresAt <= new Date()) return false;
    const member = await prisma.channelMember.findUnique({ where: { channelId_accountId: { channelId, accountId } } });
    return !!member && member.role !== "viewer";
  }
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
  if (channel.kind === "reception") {
    const member = await prisma.channelMember.findUnique({ where: { channelId_accountId: { channelId, accountId } } });
    return member?.role === "owner" || member?.role === "admin";
  }
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
    aiSettings: Awaited<ReturnType<typeof aiSettingsStore.loadAiSettings>>;
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
    const aiSettings = batch?.prayer ? batch.prayer.aiSettings : await aiSettingsStore.loadAiSettings();
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
  const aiSettings = await aiSettingsStore.loadAiSettings();
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
  const apiKey = aiSettingsStore.decryptAiApiKey(settings.encryptedApiKey);
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
  const aiSettings = await aiSettingsStore.loadAiSettings();
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
  const apiKey = aiSettingsStore.decryptAiApiKey(settings.encryptedApiKey);
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


function pinnedBodyPreview(body: PinnedBodyDTO, title?: string | null) {
  const text = body.blocks
    .map((block) => (block.type === "text" ? block.text : block.type === "image" ? "[图片]" : block.fileName || "[文件]"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return stripPushText(title || text || "新的置顶消息");
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
  if (message.type === "sermon_request") return `${message.sender.displayName} 申请讲道权限：${stripPushText(message.content) || "申请演讲"}`;
  if (message.type === "bible_session") return `${message.sender.displayName} 分享了打开的圣经：${stripPushText(message.content) || "一起阅读"}`;
  if (message.type === "chat_record") return `${message.sender.displayName} 转发了聊天记录：${stripPushText(message.content) || "聊天记录"}`;
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
      await Promise.all([appearanceService.setSetting("webPushVapidPublicKey", publicKey), appearanceService.setSetting("webPushVapidPrivateKey", privateKey)]);
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
  const where = channelNotificationAudienceWhere(channelId, channel);
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
  if (message.type === "why_topic_card" || message.channel.kind === "why" || message.channel.kind === "reception") return;
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
  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { name: true, kind: true } });
  if (!channel || channel.kind === "reception") return;
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
  if (!message || message.type !== "prayer" || message.channel.kind === "reception") return;
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
  const unique = [...new Map([...online.values()].filter((u) => !u.isGuest).map((u) => [u.accountId, u])).values()]
    .map(({ isGuest: _isGuest, ...user }) => user);
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

function bookReadersSnapshot() {
  return [...bookReaders.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .filter((reader, index, all) => all.findIndex((candidate) => candidate.accountId === reader.accountId) === index)
    .map(({ updatedAt: _updatedAt, ...reader }) => reader);
}

function broadcastBookReaders() {
  io.emit("book:readers", bookReadersSnapshot());
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
let bookReaderCleanupTimer: NodeJS.Timeout | undefined;
let friendListenerCleanupTimer: NodeJS.Timeout | undefined;
let friendFeedRefreshTimer: NodeJS.Timeout | undefined;
let stopReceptionCleanup: (() => void) | undefined;

function startCleanupTimers() {
  stopReceptionCleanup = receptionService.startCleanupTimer();
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

  bookReaderCleanupTimer = setInterval(() => {
    const staleBefore = Date.now() - 45_000;
    let changed = false;
    for (const [socketId, reader] of bookReaders) {
      if (reader.updatedAt >= staleBefore) continue;
      bookReaders.delete(socketId);
      changed = true;
    }
    if (changed) broadcastBookReaders();
  }, 15_000);
  bookReaderCleanupTimer.unref();

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

function invalidateAuthSessionCacheByAccountIds(accountIds: number[]) {
  if (!accountIds.length) return;
  const targets = new Set(accountIds.map(String));
  for (const [key] of authSessionCache) {
    if (targets.has(key.slice(0, key.indexOf(":")))) authSessionCache.delete(key);
  }
}

function disconnectAccounts(accountIds: number[]) {
  const targets = new Set(accountIds);
  for (const socket of io.sockets.sockets.values()) {
    const auth = socket.data.auth as AuthContext | undefined;
    if (auth?.accountId && targets.has(auth.accountId)) socket.disconnect(true);
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
  const accountState = await prisma.account.findUnique({ where: { id: accountId }, select: { isGuest: true } });
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
  if (!accountState?.isGuest) {
    await Promise.all([
      writeLoginLog("auth_login", accountId, session, now, { appVersion }),
      ...replacedSessions.map((row) => writeLoginLog("session_replaced", accountId, row, now))
    ]);
  }
  return session;
}

function joinAccountChannel(accountId: number, channelId: number) {
  for (const socketId of accountSocketIds.get(accountId) || []) {
    io.sockets.sockets.get(socketId)?.join(`ch:${channelId}`);
  }
}

function leaveAccountChannel(accountId: number, channelId: number) {
  leaveAccountSocketsFromChannel(accountSocketIds.get(accountId), (socketId) => io.sockets.sockets.get(socketId), channelId);
}

async function emitChannelMembersChanged(channelId: number, action: string, affectedAccountIds: number[] = []) {
  const dto = await channelDto(channelId);
  const memberRows = await prisma.channelMember.findMany({ where: { channelId }, select: { accountId: true } });
  const recipients = new Set([...memberRows.map((row) => row.accountId), ...affectedAccountIds]);
  io.to([`ch:${channelId}`, ...[...recipients].map((accountId) => `acct:${accountId}`)]).emit("channel:updated", { action, channel: dto });
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
    listColor: channel.listColor,
    icon: directPeer?.avatarPath
      ? directPeer.avatarPath.startsWith("/")
        ? directPeer.avatarPath
        : `/avatars/${directPeer.avatarPath}`
      : cleanChannelIcon(channel.icon),
    kind: channel.kind,
    isPrivate: channel.isPrivate,
    isDefault: channel.isDefault,
    directKey: channel.directKey,
    receptionExpiresAt: channel.receptionExpiresAt?.toISOString() || null,
    canManage: viewer ? await canManageChannel(viewer.accountId, channelId) : undefined,
    canWrite: viewer ? await canWriteChannel(viewer.accountId, channelId) : undefined,
    canPin: viewer ? await canPinChannel(viewer, channelId) : undefined,
    hasPrayerItems: prayerCount > 0,
    memberCount: channel._count.members,
    lastMessageId: lastMessageIds?.get(channelId) ?? null,
    pinned
  };
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
    },
    include: { channel: { select: { kind: true } } }
  });
  const isolatedReception = message.channel.kind === "reception";
  await emitMessage(message.id);
  if (!isolatedReception && !input.skipPush) void sendMessagePush(message.id, input.pushOrigin || "").catch((error) => app.log.warn({ error }, "message push failed"));
  if (!isolatedReception && !input.skipEngineEvent && (input.type === "text" || input.type === "chain" || input.type === "prayer")) {
    await createEngineEvent("message_created", { messageId: message.id }, input.channelId, message.id);
  }
  if (!isolatedReception && !input.skipQuestionAssistant && (input.type || "text") === "text") {
    void maybeTriggerWhyDirectAssistant(message.id).catch((error) => app.log.warn({ error, messageId: message.id }, "why direct assistant failed"));
    void maybeTriggerQuestionAssistant(message.id).catch((error) => app.log.warn({ error, messageId: message.id }, "question assistant failed"));
  }
  return message;
}










app.get("/api/channels", { preHandler: requireAuth }, async (request) => {
  const auth = (request as AuthedRequest).auth;
  const channels = await prisma.channel.findMany({
    where: channelListWhere(auth.accountId, auth.isGuest),
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
  const serializedChannels = channels.map((channel) => {
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
        listColor: channel.listColor,
        icon: directPeer?.avatarPath
          ? directPeer.avatarPath.startsWith("/")
            ? directPeer.avatarPath
            : `/avatars/${directPeer.avatarPath}`
          : cleanChannelIcon(channel.icon),
        kind: channel.kind,
        isPrivate: channel.isPrivate,
        isDefault: channel.isDefault,
        directKey: channel.directKey,
        receptionExpiresAt: channel.receptionExpiresAt?.toISOString() || null,
        canManage,
        canWrite,
        canPin,
        hasPrayerItems: (prayerCounts.get(channel.id) ?? 0) > 0,
        memberCount: channel._count.members,
        lastMessageId: lastMessageIds.get(channel.id) ?? null,
        pinned: pinnedByChannel.get(channel.id) ?? null
      };
    });
  serializedChannels.sort((left, right) => {
    if (left.isDefault !== right.isDefault) return left.isDefault ? -1 : 1;
    return ((right.lastMessageId ?? 0) - (left.lastMessageId ?? 0)) || left.id - right.id;
  });
  return { channels: serializedChannels };
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
    listColor: channel.listColor,
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

app.post("/api/channels", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  if (auth.isGuest) return reply.code(403).send({ success: false, message: "来访者不能创建频道" });
  const body = z.object({
    name: z.string().min(1).max(80),
    description: z.string().max(255).optional(),
    icon: z.string().max(16).optional(),
    listColor: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional(),
    isPrivate: z.boolean().optional()
  }).parse(request.body);
  const channel = await prisma.channel.create({
    data: {
      name: body.name,
      description: body.description || "",
      icon: cleanChannelIcon(body.icon),
      listColor: body.listColor?.toLowerCase() || null,
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
  if (!(await canManageChannel(auth.accountId, channelId))) return reply.code(403).send({ success: false, message: "无权管理此频道" });
  const body = z
    .object({
      name: z.string().min(1).max(80).optional(),
      description: z.string().max(255).optional(),
      icon: z.string().max(16).optional(),
      listColor: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional()
    })
    .parse(request.body);
  if (protectedChannel?.kind === "music" && (body.name !== undefined || body.description !== undefined || body.icon !== undefined)) {
    return reply.code(400).send({ success: false, message: "音乐频道只能修改列表底色" });
  }
  await prisma.channel.update({
    where: { id: channelId },
    data: {
      name: body.name,
      description: body.description,
      icon: body.icon === undefined ? undefined : cleanChannelIcon(body.icon),
      listColor: body.listColor === undefined ? undefined : body.listColor?.toLowerCase() || null
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

const receptionService = createReceptionService({
  prisma,
  deleteChannelWithAttachments,
  disconnectAccounts,
  invalidateAccounts: invalidateAuthSessionCacheByAccountIds,
  notifyRoomClosing: (channelId) => io.to(`ch:${channelId}`).emit("reception:closed", { channelId }),
  onError: (error, channelId) => app.log.error({ error, channelId }, "Failed to collect reception room")
});

registerReceptionRoutes(app, {
  prisma,
  tokenSecret: JWT_SECRET,
  requireAuth,
  requireAdmin,
  authFor: (request) => (request as AuthedRequest).auth,
  createAuthSession,
  signToken,
  authDto,
  channelDto,
  joinAccountChannel,
  emitRoomUpdated: async (channelId, action) => {
    await emitChannelMembersChanged(channelId, action);
    return undefined;
  },
  deleteRoom: receptionService.deleteRoom,
  inviteOrigin: RECEPTION_INVITE_ORIGIN
});

app.delete("/api/channels/:id", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const channelId = Number((request.params as { id: string }).id);
  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { id: true, name: true, isDefault: true, directKey: true, kind: true } });
  if (!channel) return reply.code(404).send({ success: false, message: "频道不存在" });
  if (channel.isDefault) return reply.code(400).send({ success: false, message: "默认频道不能删除" });
  if (channel.kind === "music") return reply.code(400).send({ success: false, message: "音乐频道为系统频道，不能删除" });
  if (channel.kind === "reception") {
    if (!(await canManageChannel(auth.accountId, channelId))) return reply.code(403).send({ success: false, message: "无权回收此会客厅" });
    await receptionService.deleteRoom(channelId);
    return { success: true };
  }
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
  if (auth.isGuest) return reply.code(403).send({ success: false, message: "来访者不能发起私聊" });
  const body = z.object({ accountId: z.number().int().positive() }).parse(request.body);
  if (body.accountId === auth.accountId) return reply.code(400).send({ success: false, message: "不能和自己发起私聊" });
  const [me, peer] = await Promise.all([
    prisma.account.findUnique({ where: { id: auth.accountId }, include: { actor: true } }),
    prisma.account.findUnique({ where: { id: body.accountId }, include: { actor: true } })
  ]);
  if (!me?.actor || !peer?.actor || me.isGuest || peer.isGuest) return reply.code(404).send({ success: false, message: "用户不存在" });
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
  if (auth.isGuest) return reply.code(403).send({ success: false, message: "来访者不能发起私聊" });
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
  const explicitMemberWhere: Prisma.AccountWhereInput = {
    memberships: { some: { channelId } },
    ...(channel.kind === "reception" ? { OR: [{ isGuest: false }, { guestExpiresAt: { gt: new Date() } }] } : {})
  };
  const accounts = await prisma.account.findMany({
    where: channel?.kind === "music"
      ? { isGuest: false, OR: [{ role: "admin" }, { canPinMessages: true }] }
      : channel && channelNeedsExplicitMembership(channel)
        ? explicitMemberWhere
        : { isGuest: false },
    include: { actor: true, memberships: { where: { channelId } } },
    orderBy: { displayName: "asc" }
  });
  const virtuals = channel.kind === "reception"
    ? []
    : (await prisma.virtualCharacter.findMany({ where: { enabled: true }, include: { actor: true }, orderBy: { id: "asc" } }))
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
      where: { isGuest: false, memberships: { none: { channelId } } },
      include: { actor: true },
      orderBy: { displayName: "asc" }
    }),
    prisma.virtualCharacter.findMany({ where: { enabled: true }, include: { actor: true }, orderBy: { id: "asc" } })
  ]);
  const virtuals = channel.kind === "reception" ? [] : virtualCharacters
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
  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { id: true, kind: true, isPrivate: true, directKey: true } });
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
  if (channel.kind === "reception" && requestedVirtualIds.length) {
    return reply.code(400).send({ success: false, message: "会客厅不能邀请 AI 角色" });
  }
  const [accounts, virtualCharacters, existingMemberships] = await Promise.all([
    prisma.account.findMany({ where: { id: { in: requestedIds }, isGuest: false }, select: { id: true, displayName: true } }),
    prisma.virtualCharacter.findMany({ where: { id: { in: requestedVirtualIds }, enabled: true }, include: { actor: true } }),
    requestedIds.length
      ? prisma.channelMember.findMany({ where: { channelId, accountId: { in: requestedIds } }, select: { accountId: true } })
      : Promise.resolve([])
  ]);
  if (accounts.length !== requestedIds.length) return reply.code(404).send({ success: false, message: "用户不存在" });
  if (virtualCharacters.length !== requestedVirtualIds.length || virtualCharacters.some((character) => !AI_ROLE_USERNAMES.has(character.actor.username))) {
    return reply.code(404).send({ success: false, message: "AI 角色不存在" });
  }
  const existingAccountIds = new Set(existingMemberships.map((membership) => membership.accountId));
  const addedAccounts = accounts.filter((account) => !existingAccountIds.has(account.id));
  const addedVirtualCharacters = virtualCharacters.filter(
    (character) => !virtualCharacterVisibleInChannel(channel, { username: character.actor.username, config: character.config })
  );
  const addedNames = [...addedAccounts.map((account) => account.displayName), ...addedVirtualCharacters.map((character) => character.actor.displayName)];
  const noticeId = await prisma.$transaction(async (transaction) => {
    await transaction.channelMember.createMany({
      data: addedAccounts.map((account) => ({ channelId, accountId: account.id, role: "member" as const }))
    });
    await Promise.all(
      addedVirtualCharacters.map((character) =>
        transaction.virtualCharacter.update({
          where: { id: character.id },
          data: { config: virtualCharacterConfigForChannel(character.config, channelId, true) as Prisma.InputJsonObject }
        })
      )
    );
    if (!addedNames.length) return null;
    const notice = await transaction.message.create({
      data: {
        channelId,
        senderActorId: auth.actorId,
        type: "system",
        content: `${addedNames.join("、")} 加入了频道`,
        payload: {
          systemKind: "channel-membership",
          action: "joined",
          accountIds: addedAccounts.map((account) => account.id),
          virtualCharacterIds: addedVirtualCharacters.map((character) => character.id)
        }
      },
      select: { id: true }
    });
    return notice.id;
  });
  for (const account of addedAccounts) joinAccountChannel(account.id, channelId);
  await ensureDirectGroupDefaultName(channelId);
  if (noticeId) await emitMessage(noticeId);
  await emitChannelMembersChanged(channelId, "members-added", addedAccounts.map((account) => account.id));
  const dto = await channelDto(channelId, auth);
  return { success: true, channel: dto, added: addedAccounts.length + addedVirtualCharacters.length };
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
  const notice = await prisma.message.create({
    data: {
      channelId,
      senderActorId: auth.actorId,
      type: "system",
      content: `${character.actor.displayName} 退出了频道`,
      payload: { systemKind: "channel-membership", action: "left", virtualCharacterId: character.id }
    },
    select: { id: true }
  });
  await emitMessage(notice.id);
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
  const targetAccount = await prisma.account.findUnique({ where: { id: accountId }, select: { isGuest: true, displayName: true } });
  if (!targetAccount) return reply.code(404).send({ success: false, message: "用户不存在" });
  if (channel.kind === "reception" && targetAccount?.isGuest) {
    const revokedAt = new Date();
    await prisma.$transaction([
      prisma.account.update({ where: { id: accountId }, data: { guestExpiresAt: new Date(0) } }),
      prisma.accountSession.updateMany({ where: { accountId, revokedAt: null }, data: { revokedAt } })
    ]);
    invalidateAuthSessionCacheByAccountIds([accountId]);
    disconnectAccounts([accountId]);
    leaveAccountChannel(accountId, channelId);
    const notice = await prisma.message.create({
      data: {
        channelId,
        senderActorId: auth.actorId,
        type: "system",
        content: `${targetAccount.displayName} 退出了频道`,
        payload: { systemKind: "channel-membership", action: "left", accountId }
      },
      select: { id: true }
    });
    await emitMessage(notice.id);
    await emitChannelMembersChanged(channelId, "members-removed", [accountId]);
    const dto = await channelDto(channelId, auth);
    return { success: true, channel: dto, removed: accountId };
  }
  const [, notice] = await prisma.$transaction([
    prisma.channelMember.delete({ where: { channelId_accountId: { channelId, accountId } } }),
    prisma.message.create({
      data: {
        channelId,
        senderActorId: auth.actorId,
        type: "system",
        content: `${targetAccount.displayName} 退出了频道`,
        payload: { systemKind: "channel-membership", action: "left", accountId }
      },
      select: { id: true }
    })
  ]);
  leaveAccountChannel(accountId, channelId);
  await emitMessage(notice.id);
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
    const aiSettings = await aiSettingsStore.loadAiSettings();
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
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { channelId: true, sender: { select: { accountId: true, displayName: true } } }
  });
  if (!message || !(await canAccessChannel(auth.accountId, message.channelId))) return reply.code(404).send({ success: false, message: "消息不存在" });
  const key = { messageId_accountId: { messageId, accountId: auth.accountId } };
  const existing = await prisma.messageFavorite.findUnique({ where: key });
  let notification = null;
  if (body.favorited) {
    const favorite = await prisma.messageFavorite.upsert({ where: key, create: { messageId, accountId: auth.accountId }, update: {} });
    if (!existing && message.sender.accountId && message.sender.accountId !== auth.accountId) {
      const favoriter = await prisma.account.findUnique({ where: { id: auth.accountId }, select: { displayName: true } });
      notification = {
        id: favorite.id,
        channelId: message.channelId,
        messageId,
        senderName: message.sender.displayName,
        favoriterName: favoriter?.displayName || auth.username,
        createdAt: favorite.createdAt.toISOString()
      };
      io.to(`acct:${message.sender.accountId}`).emit("message:favorited", notification);
    }
  } else if (existing) {
    await prisma.messageFavorite.deleteMany({ where: { messageId, accountId: auth.accountId } });
    if (message.sender.accountId && message.sender.accountId !== auth.accountId) {
      io.to(`acct:${message.sender.accountId}`).emit("message:favorite-removed", { id: existing.id });
    }
  }
  const reactions = await broadcastMessageReactions(messageId, auth.accountId);
  return { success: true, reactions, notification };
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
  const [rows, favoriteRows] = await Promise.all([
    prisma.messageLike.findMany({
      where: {
        dismissedAt: null,
        accountId: { not: auth.accountId },
        message: { sender: { accountId: auth.accountId } }
      },
      include: { account: { select: { displayName: true } }, message: { include: { sender: true } } },
      orderBy: { createdAt: "desc" },
      take: 20
    }),
    prisma.messageFavorite.findMany({
      where: {
        accountId: { not: auth.accountId },
        message: { sender: { accountId: auth.accountId } }
      },
      include: { account: { select: { displayName: true } }, message: { include: { sender: true } } },
      orderBy: { createdAt: "desc" },
      take: 20
    })
  ]);
  return {
    notifications: rows.map((like) => ({
      id: like.id,
      channelId: like.message.channelId,
      messageId: like.messageId,
      senderName: like.message.sender.displayName,
      likerName: like.account.displayName,
      createdAt: like.createdAt.toISOString()
    })),
    favoriteNotifications: favoriteRows.map((favorite) => ({
      id: favorite.id,
      channelId: favorite.message.channelId,
      messageId: favorite.messageId,
      senderName: favorite.message.sender.displayName,
      favoriterName: favorite.account.displayName,
      createdAt: favorite.createdAt.toISOString()
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
  const chainConfigSchema = z
    .object({
      requiredSelection: z.literal(true),
      allowMultiple: z.boolean().optional(),
      options: z.array(z.string().trim().min(1).max(CHAIN_OPTION_LABEL_LIMIT)).min(1).max(CHAIN_OPTION_LIMIT)
    })
    .superRefine((value, context) => {
      if (normalizeChainOptionLabels(value.options).length !== value.options.length) {
        context.addIssue({ code: "custom", path: ["options"], message: "接龙项目不能重复，也不能使用“其他”" });
      }
    });
  const chainSelectionSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("option"), optionId: z.string().min(1).max(40) }),
    z.object({ kind: z.literal("custom"), text: z.string().trim().min(1).max(CHAIN_CUSTOM_TEXT_LIMIT) }),
    z.object({
      kind: z.literal("multiple"),
      optionIds: z.array(z.string().min(1).max(40)).max(CHAIN_OPTION_LIMIT),
      customText: z.string().trim().min(1).max(CHAIN_CUSTOM_TEXT_LIMIT).optional()
    })
  ]);
  const body = z
    .object({
      channelId: z.number(),
      content: z.string().optional(),
      replyToId: z.number().nullable().optional(),
      type: z.enum(["text", "chain", "prayer", "sermon_request"]).default("text"),
      payload: z.unknown().optional(),
      chainTopic: z.string().optional(),
      chainText: z.string().optional(),
      chainRootId: z.number().optional(),
      chainConfig: chainConfigSchema.optional(),
      chainSelection: chainSelectionSchema.optional()
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
      payload = createChainPayload(body.chainTopic || "接龙", body.chainConfig);
    }
    const appended = body.chainRootId
      ? appendChainParticipant(payload, actor, body.chainSelection, new Date().toISOString(), body.chainText || "")
      : { success: true as const, payload };
    if (!appended.success) return reply.code(appended.status).send({ success: false, message: appended.message });
    payload = appended.payload;
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
  if (body.type === "sermon_request") {
    const message = await createMessageFromActor({
      channelId: body.channelId,
      actorId: auth.actorId,
      content,
      type: "sermon_request",
      payload: cleanSermonRequestPayload(body.payload),
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

registerBibleRoutes(app, {
  prisma,
  requireAuth,
  canWriteChannel,
  emitMessage,
  sendMessagePush,
  hydrateMessage
});

registerForwardRoutes(app, {
  prisma,
  requireAuth,
  canAccessChannel,
  canWriteChannel,
  emitMessage,
  sendMessagePush
});

registerBooksRoutes(app, {
  prisma,
  booksDir: BOOKS_DIR,
  requireAuth,
  requireMediaAuth,
  requireAdmin,
  authFor: (request) => (request as AuthedRequest).auth,
  imageWebpEffort: IMAGE_WEBP_EFFORT
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
  channelListWhere,
  emitRead: (accountId, event) => io.to(`acct:${accountId}`).emit("channel:read", event)
});

registerChannelOwnershipRoutes(app, {
  requireAuth,
  prisma,
  authFor: (request) => (request as AuthedRequest).auth,
  leaveAccountChannel,
  emitMemberLeft: async (channelId, previousOwnerId, successorAccountId) => {
    await emitChannelMembersChanged(
      channelId,
      successorAccountId ? "ownership-transferred" : "member-left",
      successorAccountId ? [previousOwnerId, successorAccountId] : [previousOwnerId]
    );
    io.to(`acct:${previousOwnerId}`).emit("channel:updated", { action: "left", channelId });
  },
  emitSystemMessage: async (messageId) => {
    await emitMessage(messageId);
  }
});

// 讲道演示（二期）：按讲道者并发的多演示服务，状态按 sermon.presentation.{accountId} 键持久化到
// Setting 表；一期全局行 sermon.presentation 启动时迁移；变更经 sermon:{presenterAccountId} 房间定向广播。
const loadSermonPresenterAccount = async (accountId: number) => {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { role: true, displayName: true, sermonPresenterUntil: true }
  });
  return account
    ? { isAdmin: account.role === "admin", displayName: account.displayName, sermonPresenterUntil: account.sermonPresenterUntil }
    : null;
};

const sermonService = createSermonPresentationService({
  loadSetting: async (key) =>
    (await prisma.setting.findUnique({ where: { key }, select: { value: true } }))?.value ?? null,
  saveSetting: async (key, value) => {
    await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
  },
  deleteSetting: async (key) => {
    await prisma.setting.deleteMany({ where: { key } });
  },
  listSettingKeys: async (prefix) =>
    (await prisma.setting.findMany({ where: { key: { startsWith: prefix } }, select: { key: true } })).map((row) => row.key),
  presenterAccount: loadSermonPresenterAccount,
  accountExists: async (accountId) =>
    (await prisma.account.findUnique({ where: { id: accountId }, select: { id: true } })) !== null
});

registerSermonRoutes(app, {
  prisma,
  io,
  requireAuth,
  requireAdmin,
  hydrateMessage,
  service: sermonService,
  listWatchAccounts: () =>
    prisma.account.findMany({ select: { id: true, displayName: true, avatarPath: true, isGuest: true } }),
  isOnline: (accountId) => (accountSocketIds.get(accountId)?.size ?? 0) > 0
});
app.get("/api/files/:messageId", { preHandler: requireMediaAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const messageId = Number((request.params as { messageId: string }).messageId);
  const query = request.query as { download?: string; thumb?: string; item?: string };
  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message) return reply.code(404).send({ success: false, message: "文件不存在" });
  let storedFileName: string;
  let fileName: string;
  if (message.type === "chat_record") {
    // 合并转发记录条目的附件按 ?item=<index> 解析到源消息，引用原文件提供；
    // 源消息或源文件被删除后按“转发附件已被删除”处理。附件可见性以源频道权限为准。
    const itemIndex = Number(query.item);
    const ref = Number.isInteger(itemIndex) && itemIndex >= 0 ? chatRecordItemRef(message.payload, itemIndex) : null;
    if (!ref) return reply.code(404).send({ success: false, message: "转发附件已被删除" });
    const source = await prisma.message.findUnique({
      where: { id: ref.sourceMessageId },
      select: { channelId: true, filePath: true, fileName: true }
    });
    if (!source?.filePath) return reply.code(404).send({ success: false, message: "转发附件已被删除" });
    if (!(await canAccessChannel(auth.accountId, source.channelId))) return reply.code(403).send({ success: false, message: "无权访问文件" });
    storedFileName = source.filePath;
    fileName = source.fileName || ref.fileName;
  } else {
    if (!message.filePath) return reply.code(404).send({ success: false, message: "文件不存在" });
    if (!(await canAccessChannel(auth.accountId, message.channelId))) return reply.code(403).send({ success: false, message: "无权访问文件" });
    storedFileName = message.filePath;
    fileName = message.fileName || message.filePath;
  }
  let filePath = path.join(UPLOAD_DIR, path.basename(storedFileName));
  // Bubble rendering asks for the thumbnail variant; fall back to the
  // original for older uploads that predate thumbnail generation.
  const servingThumb = query.thumb === "1" && fs.existsSync(`${filePath}.thumb.webp`);
  if (servingThumb) filePath = `${filePath}.thumb.webp`;
  if (!fs.existsSync(filePath)) return reply.code(404).send({ success: false, message: "文件不存在" });
  const stat = fs.statSync(filePath);
  const range = request.headers.range;
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












async function activePinnedUsesUpload(fileName: string) {
  const target = path.basename(fileName);
  const pins = await prisma.pinnedItem.findMany({ where: { active: true }, select: { body: true, content: true } });
  return pins.some((pin) => pinnedBodyUploadFilePaths(serializePinnedBody(pin.body, pin.content)).has(target));
}

async function uploadIsStillReferenced(fileName: string) {
  const target = path.basename(fileName);
  return (await prisma.message.count({ where: { filePath: target } })) > 0 || (await activePinnedUsesUpload(target));
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




async function emitPinnedRefresh(channelIds: Set<number>) {
  for (const channelId of channelIds) {
    const pin = await prisma.pinnedItem.findFirst({ where: { channelId, active: true }, orderBy: { updatedAt: "desc" } });
    io.to(`ch:${channelId}`).emit("pinned:updated", pin ? await serializePinnedItem(pin) : null);
  }
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
  deleteAccount: async (input) => {
    const ownedRooms = await prisma.channel.findMany({
      where: { kind: "reception", receptionOwnerAccountId: input.targetAccountId },
      select: { id: true }
    });
    for (const room of ownedRooms) await receptionService.deleteRoom(room.id);
    return deleteAccountService(
      {
        runTransaction: (operation) =>
          prisma.$transaction((tx) => operation(tx))
      },
      input
    );
  },
  emitAccountDeleted: (payload) => {
    io.emit("channel:updated", payload);
  }
});

registerWeChatRelayRoutes(app, {
  prisma,
  requireAdmin,
  agentToken: WECHAT_RELAY_AGENT_TOKEN,
  nasAccessUrl: WECHAT_RELAY_NAS_ACCESS_URL
});

registerSystemRoutes(app);

registerAdminUpdateRoutes(app, { requireAdmin });

registerAuthRoutes(app, {
  prisma,
  requireAuth,
  authLoginRateLimitMax: AUTH_LOGIN_RATE_LIMIT_MAX,
  settingBool: appearanceService.settingBool,
  themeExists: appearanceService.themeExists,
  signToken,
  authDto,
  createAuthSession,
  sessionExpiresAt,
  writeLoginLog,
  disconnectSessions,
  refreshAccountConnections,
  updateAccountAvatarFromUpload,
  deleteOwnedReceptionRooms: async (accountId: number) => {
    const ownedRooms = await prisma.channel.findMany({
      where: { kind: "reception", receptionOwnerAccountId: accountId },
      select: { id: true }
    });
    for (const room of ownedRooms) await receptionService.deleteRoom(room.id);
  }
});

registerAdminLogRoutes(app, { prisma, requireAdmin });

registerNotificationsRoutes(app, {
  prisma,
  requireAuth,
  pushNotificationsEnabled: PUSH_NOTIFICATIONS_ENABLED,
  vapidPublicKey: () => vapidPublicKey,
  pushReady: () => pushReady,
  canAccessChannel
});

registerWhyTopicsRoutes(app, { requireAuth });

registerAppearanceRoutes(app, {
  requireAdmin,
  appearance: appearanceService,
  io,
  applyFileValidation
});

registerBibleLookupRoutes(app, {
  prisma,
  requireAuth,
  aiSettings: aiSettingsStore
});

registerAiSettingsRoutes(app, {
  prisma,
  requireAuth,
  requireAdmin,
  io,
  aiSettings: aiSettingsStore,
  setSetting: appearanceService.setSetting,
  canAccessChannel,
  canonicalPrayerMessage,
  hydrateMessage,
  ensureAiRoleCharacter,
  ensureWhyAssistantCharacter,
  roleConfigDetails,
  normalizeRoleModel,
  syncAiRoleVirtualCharacterConfig
});

const adminDataRoutes = registerAdminDataRoutes(app, {
  prisma,
  requireAdmin,
  io,
  authDto,
  refreshAccountConnections,
  cleanChannelIcon,
  deleteMessages,
  activePinnedUsesUpload,
  uploadIsStillReferenced,
  emitPinnedRefresh,
  appearanceDto: appearanceService.appearanceDto,
  setSetting: appearanceService.setSetting
});

registerEngineRoutes(app, {
  prisma,
  requireAdmin,
  io,
  cleanText,
  createMessageFromActor,
  hydrateMessage,
  createEngineEvent
});




const multicharDeps: MulticharDeps = {
  prisma,
  io,
  log: (level: "info" | "warn" | "error", msg: string, data?: unknown) => {
    const logger = app.log as any;
    if (typeof logger[level] === "function") logger[level]({ data }, `[multichar] ${msg}`);
  },
  loadAiSettings: () => aiSettingsStore.loadAiSettings(),
  decryptAiApiKey: (value: string) => aiSettingsStore.decryptAiApiKey(value),
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
  loadAiSettings: aiSettingsStore.loadAiSettings,
  decryptAiApiKey: aiSettingsStore.decryptAiApiKey,
  callLlm: (messages, options) => musicResourceAiClient.callLlm(messages, options)
});

app.addHook("onClose", async () => {
  if (musicListenerCleanupTimer) clearInterval(musicListenerCleanupTimer);
  if (bibleReaderCleanupTimer) clearInterval(bibleReaderCleanupTimer);
  if (bookReaderCleanupTimer) clearInterval(bookReaderCleanupTimer);
  if (friendListenerCleanupTimer) clearInterval(friendListenerCleanupTimer);
  if (friendFeedRefreshTimer) clearTimeout(friendFeedRefreshTimer);
  stopReceptionCleanup?.();
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

const sermonSocketDeps = {
  refreshAuth: (socket: Socket) => refreshSocketAuth(socket),
  presenterAccount: loadSermonPresenterAccount,
  service: sermonService,
  socketsLeave: (accountId: number, room: string) => {
    io.in(`acct:${accountId}`).socketsLeave(room);
  }
};

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
  online.set(socket.id, { actorId: account.actor.id, accountId: account.id, username: account.username, displayName: account.displayName, avatarPath: account.avatarPath, isGuest: account.isGuest });
  if (wasOffline && !account.isGuest) {
    const joinedAt = new Date();
    accountPresenceStartedAt.set(account.id, joinedAt);
    await writeLoginLog("presence_join", account.id, session, joinedAt);
  }
  const channels = await prisma.channel.findMany({
    where: channelListWhere(auth.accountId, auth.isGuest),
    select: { id: true }
  });
  channels.forEach((ch) => socket.join(`ch:${ch.id}`));
  await broadcastPresence();
  // Listener lists did not change on connect: send the snapshots only to the
  // new socket instead of broadcasting them to everyone.
  socket.emit("music:listeners", musicListenersSnapshot());
  socket.emit("friend:listeners", friendListenersSnapshot());
  registerSermonSocket(io, socket, sermonSocketDeps);

  socket.on("channel:join", async (data: { channelId: number }) => {
    const currentAuth = await refreshSocketAuth(socket);
    if (!currentAuth) return;
    const channelId = Number(data.channelId);
    if (await canAccessChannel(currentAuth.accountId, channelId)) {
      socket.join(`ch:${channelId}`);
      if (!currentAuth.isGuest) void writeActivityLog({ kind: "channel_view", accountId: currentAuth.accountId, sessionId: currentAuth.sessionId, channelId });
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
          type: z.enum(["text", "prayer", "sermon_request"]).default("text"),
          payload: z.unknown().optional(),
          replyToId: z.number().nullable().optional()
        })
        .parse(data);
      if (!(await canWriteChannel(currentAuth.accountId, body.channelId))) return ack?.({ success: false, message: "无权在此频道发言" });
      if (await isMusicChannel(body.channelId)) return ack?.({ success: false, message: "音乐频道只能上传 MP3 和 M4A 文件" });
      const content = cleanText(body.content);
      if (!content.replace(/<[^>]*>/g, "").trim() && !/<br\s*\/?>/i.test(content)) return ack?.({ success: false, message: "消息不能为空" });
      const payload =
        body.type === "prayer"
          ? cleanPrayerPayload(body.payload)
          : body.type === "sermon_request"
            ? cleanSermonRequestPayload(body.payload)
            : await cleanTextMessagePayload(body.payload);
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
      if (!currentAuth.isGuest) {
        void writeActivityLog({
          kind: "message_sent",
          accountId: currentAuth.accountId,
          sessionId: currentAuth.sessionId,
          channelId: body.channelId,
          state: body.type
        });
      }
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
    if (currentAuth.isGuest) {
      if (musicListeners.delete(socket.id)) broadcastMusicListeners();
      return;
    }
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
    if (currentAuth.isGuest) {
      if (bibleReaders.delete(socket.id)) broadcastBibleReaders();
      return;
    }
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

  socket.on("book:reading", async (data: unknown) => {
    const currentAuth = await refreshSocketAuth(socket);
    if (!currentAuth) return;
    if (currentAuth.isGuest) {
      if (bookReaders.delete(socket.id)) broadcastBookReaders();
      return;
    }
    const body = z.object({ active: z.boolean(), bookTitle: z.string().trim().min(1).max(80).nullable() }).safeParse(data);
    if (!body.success || !body.data.active || !body.data.bookTitle) {
      if (bookReaders.delete(socket.id)) broadcastBookReaders();
      return;
    }
    const existing = bookReaders.get(socket.id);
    if (existing?.bookTitle === body.data.bookTitle) {
      existing.updatedAt = Date.now();
      return;
    }
    bookReaders.set(socket.id, {
      accountId: currentAuth.accountId,
      displayName: account.displayName,
      bookTitle: body.data.bookTitle,
      updatedAt: Date.now()
    });
    broadcastBookReaders();
  });

  socket.on("friend:listening", async (data: unknown) => {
    const currentAuth = await refreshSocketAuth(socket);
    if (!currentAuth) return;
    if (currentAuth.isGuest) {
      if (friendListeners.delete(socket.id)) broadcastFriendListeners();
      return;
    }
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
    const bookReaderChanged = bookReaders.delete(socket.id);
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
    if (isOffline && !account.isGuest) {
      const leftAt = new Date();
      const joinedAt = accountPresenceStartedAt.get(account.id);
      accountPresenceStartedAt.delete(account.id);
      await writeLoginLog("presence_leave", account.id, session, leftAt, {
        durationMs: joinedAt ? Math.max(0, leftAt.getTime() - joinedAt.getTime()) : undefined
      });
    }
    if (isOffline) {
      // 观众关系易失：最后一个 socket 断开即释放席位（主持人的演示不结束）。
      const released = sermonService.releaseSeats(account.id);
      if (released !== null) io.emit("sermon:directory", sermonService.directory());
    }
    await broadcastPresence();
    if (musicListenerChanged) broadcastMusicListeners();
    if (bibleReaderChanged) broadcastBibleReaders();
    if (bookReaderChanged) broadcastBookReaders();
    if (friendListenerChanged) broadcastFriendListeners();
  });
});

app.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith("/api/")) return reply.code(404).send({ success: false, message: "Not found" });
  if (request.url.startsWith("/visit/")) {
    reply.header("Cache-Control", "no-store");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-Robots-Tag", "noindex, nofollow");
  }
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
  try {
    if (DEMO_MODE_AVAILABLE) {
      const [{ createDemoModeService }, { registerDemoModeRoutes }] = await Promise.all([
        import("./demo/service.js"),
        import("./routes/demoMode.js")
      ]);
      const service = createDemoModeService({
        prisma,
        manifestUrl: DEMO_MANIFEST_URL,
        statePath: demoStatePath(STORAGE_ROOT),
        cacheDir: demoCacheDir(STORAGE_ROOT),
        storageDirs: {
          upload: UPLOAD_DIR,
          avatar: AVATAR_DIR,
          background: BG_DIR,
          parallax: PARALLAX_DIR,
          "music-score": MUSIC_SCORE_DIR
        },
        gate: demoResetGate,
        createBackup: async (operator) => {
          await adminDataRoutes.createFullBackup(operator);
        },
        afterReset: async (operatorAccountId, datasetVersion) => {
          aiSettingsStore.resetAiSettingsCache();
          authSessionCache.clear();
          io.emit("appearance:updated", await appearanceService.appearanceDto());
          io.emit("demo:reset", { datasetVersion });
          for (const socket of io.sockets.sockets.values()) {
            const auth = socket.data.auth as AuthContext | undefined;
            if (auth?.accountId !== operatorAccountId) socket.disconnect(true);
          }
        },
        log: (message, details) => app.log.error({ details }, message)
      });
      registerDemoModeRoutes(app, { requireAdmin, service });
    }
    if (options.runStartupTasks !== false) {
      startCleanupTimers();
      await ensureBootstrap();
      await ensureWebPush();
      await sermonService.migrateLegacy();
      await sermonService.restoreAll();
    }
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}
