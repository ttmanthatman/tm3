import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";
import { Prisma, PrismaClient, type Actor, type Account, type AccountSession, type DeviceKind, type Message, type MessageType, type PinnedItem } from "@prisma/client";
import sanitizeHtml from "sanitize-html";
import sharp from "sharp";
import { Server as SocketIOServer, type Socket } from "socket.io";
import webPush from "web-push";
import { z } from "zod";
import type {
  AdminAttachmentDTO,
  AdminLoginLogKind,
  AdminMessageDTO,
  AiSettingsDTO,
  AiSuggestionDTO,
  BibleLookupDTO,
  BiblePreferencesDTO,
  ChainPayload,
  FlashEffectSettingsDTO,
  LinkPreviewDTO,
  MessageDTO,
  MessageEffect,
  PinnedBodyDTO,
  PinnedContentBlockDTO,
  PrayerStatus,
  ThemeDTO,
  ThemePaletteDTO,
  WhyAssistantRunDTO,
  WhyTopicCardPayload,
  WhyTopicDTO,
  WhyTopicMemberDTO
} from "../shared/types.js";
import { APP_VERSION, RELEASE_DATE, RELEASE_DEVELOPER, RELEASE_NOTES } from "../shared/release.js";
import { lookupBibleReference } from "./bible/lookup.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.cwd();
const DIST_CLIENT = path.join(ROOT, "dist/client");
const STORAGE_ROOT = process.env.STORAGE_ROOT || path.join(ROOT, "storage");
const UPLOAD_DIR = path.join(STORAGE_ROOT, "uploads");
const AVATAR_DIR = path.join(STORAGE_ROOT, "avatars");
const BG_DIR = path.join(STORAGE_ROOT, "backgrounds");
const PORT = Number(process.env.PORT || 3003);
const JWT_SECRET = process.env.JWT_SECRET || "dev-change-me-before-production";
const ENGINE_API_TOKEN = process.env.ENGINE_API_TOKEN || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || process.env.WEB_PUSH_SUBJECT || "mailto:admin@example.com";
const RELEASE_DISPLAY_DEVELOPER = process.env.APP_RELEASE_DEVELOPER || process.env.RELEASE_DEVELOPER || RELEASE_DEVELOPER;
const UPDATE_REPO_URL = process.env.UPDATE_REPO_URL || process.env.REPO_URL || "https://github.com/ttmanthatman/tm3.git";
const UPDATE_BRANCH = process.env.UPDATE_BRANCH || process.env.BRANCH || "main";
const UPDATE_PM2_APP = process.env.UPDATE_PM2_APP || process.env.APP_NAME || "team-chat";
const UPDATE_STATUS_PATH = path.join(STORAGE_ROOT, "update-status.json");
const UPDATE_LOG_PATH = path.join(STORAGE_ROOT, "update.log");
const UPDATE_RUNNING_TIMEOUT_MS = Number(process.env.UPDATE_RUNNING_TIMEOUT_MS || 30 * 60 * 1000);
const AI_SETTINGS_SECRET = process.env.AI_SETTINGS_SECRET || JWT_SECRET;
const CONFIGURED_CORS_ORIGINS = (process.env.CORS_ORIGINS || process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const SESSION_TTL_DAYS = 30;
const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
const JWT_EXPIRES_IN = `${SESSION_TTL_DAYS}d`;
const THEMES = new Set(["wechat", "jade", "paper", "night"]);
const MESSAGE_EFFECTS = new Set<MessageEffect>(["flash", "shine", "shake", "fly", "sunburst", "marquee", "water", "drip", "rain"]);
const WALLPAPER_FITS = new Set(["cover", "contain", "stretch", "repeat"]);
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
const LINK_PREVIEW_MAX_BYTES = 350 * 1024;
const LINK_PREVIEW_TIMEOUT_MS = 7000;
const LINK_PREVIEW_MAX_REDIRECTS = 3;
const IMAGE_WEBP_QUALITY = 82;
const IMAGE_WEBP_EFFORT = 5;
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif", ".tif", ".tiff"]);

for (const dir of [STORAGE_ROOT, UPLOAD_DIR, AVATAR_DIR, BG_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

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

async function latestGitHubPackage() {
  const repo = parseGitHubRepo(UPDATE_REPO_URL);
  if (!repo) throw new Error("只支持 GitHub 仓库更新地址");
  const url = `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${encodeURIComponent(UPDATE_BRANCH)}/package.json`;
  const response = await fetch(url, { headers: { "user-agent": "team-chat-updater" } });
  if (!response.ok) throw new Error(`无法读取 GitHub 版本：HTTP ${response.status}`);
  const pkg = (await response.json()) as { version?: string };
  return {
    owner: repo.owner,
    repo: repo.repo,
    branch: UPDATE_BRANCH,
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
  const log = fs.existsSync(UPDATE_LOG_PATH)
    ? fs
        .readFileSync(UPDATE_LOG_PATH, "utf8")
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-120)
    : [];
  return { ...expireStaleUpdateStatus(status), log };
}

function writeUpdateStatus(state: string, progress: number, detail: string) {
  fs.mkdirSync(STORAGE_ROOT, { recursive: true });
  fs.writeFileSync(UPDATE_STATUS_PATH, `${JSON.stringify({ state, progress, detail, updatedAt: new Date().toISOString() }, null, 2)}\n`);
}

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
  bodyLimit: 8 * 1024 * 1024,
  trustProxy: true
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
});

await app.register(cors, { origin: fastifyCorsOrigin as any, credentials: true });
await app.register(rateLimit, { max: 240, timeWindow: "1 minute" });
await app.register(multipart, { limits: { fileSize: 80 * 1024 * 1024, files: 1 } });

if (fs.existsSync(DIST_CLIENT)) {
  await app.register(fastifyStatic, {
    root: DIST_CLIENT,
    wildcard: false
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

const online = new Map<string, { actorId: number; accountId: number; username: string; displayName: string; avatarPath?: string | null }>();
const accountSocketIds = new Map<number, Set<string>>();
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
  const name = String(override || "").trim().slice(0, 120);
  if (name) return name;
  const ua = String(request.headers["user-agent"] || "");
  if (/iphone/i.test(ua)) return "iPhone";
  if (/ipad/i.test(ua)) return "iPad";
  if (/android/i.test(ua) && /mobile/i.test(ua)) return "Android 手机";
  if (/android/i.test(ua)) return "Android 平板";
  if (/macintosh|mac os/i.test(ua)) return "Mac";
  if (/windows/i.test(ua)) return "Windows";
  return "未知设备";
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
  const [account, session] = await Promise.all([
    prisma.account.findUnique({ where: { id: decoded.accountId }, include: { actor: true } }),
    prisma.accountSession.findUnique({ where: { id: decoded.sessionId } })
  ]);
  if (!account || !account.actor) throw new Error("account not found");
  if (!session || session.accountId !== account.id || session.revokedAt || session.expiresAt <= new Date()) throw new Error("session expired");
  await prisma.accountSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  return {
    accountId: account.id,
    actorId: account.actor.id,
    username: account.username,
    isAdmin: account.role === "admin",
    canPinMessages: account.canPinMessages,
    sessionId: session.id
  };
}

async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization;
  const queryToken = (request.query as { token?: string } | undefined)?.token;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : queryToken;
  try {
    (request as AuthedRequest).auth = await verifyJwtToken(token);
  } catch {
    reply.code(401).send({ success: false, message: "认证失败" });
  }
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

function normalizePreviewUrl(rawUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error("链接格式不正确");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("只支持 http 或 https 链接");
  if (parsed.username || parsed.password) throw new Error("链接不能包含用户名或密码");
  if (parsed.port && !["80", "443"].includes(parsed.port)) throw new Error("链接端口不支持预览");
  parsed.hash = "";
  return parsed;
}

function isBlockedPreviewAddress(address: string) {
  const family = net.isIP(address);
  if (family === 4) {
    const parts = address.split(".").map(Number);
    const [a, b] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (family === 6) {
    const value = address.toLowerCase();
    return value === "::1" || value === "::" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80:");
  }
  return true;
}

async function assertPublicPreviewHost(url: URL) {
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) throw new Error("本地链接不能生成预览");
  const records = await dns.lookup(hostname, { all: true, verbatim: false });
  if (!records.length || records.some((record) => isBlockedPreviewAddress(record.address))) throw new Error("此链接不能生成预览");
}

function decodeHtmlEntities(input?: string) {
  return String(input || "")
    .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number(value)))
    .replace(/&#x([0-9a-f]+);/gi, (_, value) => String.fromCodePoint(parseInt(value, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function parseHtmlAttributes(tag: string) {
  const attrs: Record<string, string> = {};
  const pattern = /([^\s"'=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  for (const match of tag.matchAll(pattern)) attrs[match[1].toLowerCase()] = decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? "");
  return attrs;
}

function firstMetaContent(html: string, keys: string[]) {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = parseHtmlAttributes(match[0]);
    const key = (attrs.property || attrs.name || attrs.itemprop || "").toLowerCase();
    if (wanted.has(key) && attrs.content) return attrs.content;
  }
  return "";
}

function firstImageSrc(html: string) {
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const attrs = parseHtmlAttributes(match[0]);
    if (attrs.src) return attrs.src;
  }
  return "";
}

function absoluteHttpUrl(value: string, baseUrl: string) {
  if (!value) return "";
  try {
    const parsed = new URL(value, baseUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function parseLinkPreview(html: string, finalUrl: string): LinkPreviewDTO {
  const title =
    firstMetaContent(html, ["og:title", "twitter:title"]) ||
    decodeHtmlEntities(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]*>/g, "") || "");
  const description = firstMetaContent(html, ["og:description", "twitter:description", "description"]);
  const image = absoluteHttpUrl(firstMetaContent(html, ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"]) || firstImageSrc(html), finalUrl);
  const siteName = firstMetaContent(html, ["og:site_name", "application-name"]) || new URL(finalUrl).hostname.replace(/^www\./, "");
  return {
    url: finalUrl,
    title: decodeHtmlEntities(title || siteName || finalUrl).slice(0, 220),
    description: decodeHtmlEntities(description).slice(0, 360) || undefined,
    image: image || undefined,
    siteName: decodeHtmlEntities(siteName).slice(0, 120) || undefined
  };
}

async function readResponseText(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < LINK_PREVIEW_MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    const slice = value.slice(0, Math.max(0, LINK_PREVIEW_MAX_BYTES - total));
    chunks.push(slice);
    total += slice.byteLength;
    if (value.byteLength > slice.byteLength) break;
  }
  await reader.cancel().catch(() => undefined);
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks));
}

async function fetchLinkPreviewHtml(rawUrl: string, redirectCount = 0): Promise<{ html: string; url: string }> {
  if (redirectCount > LINK_PREVIEW_MAX_REDIRECTS) throw new Error("链接跳转次数过多");
  const url = normalizePreviewUrl(rawUrl);
  await assertPublicPreviewHost(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LINK_PREVIEW_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "team-chat-link-preview/1.0"
      }
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error("链接跳转无效");
      return fetchLinkPreviewHtml(new URL(location, url).toString(), redirectCount + 1);
    }
    if (!response.ok) throw new Error(`网页读取失败：HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) throw new Error("链接不是网页");
    return { html: await readResponseText(response), url: url.toString() };
  } finally {
    clearTimeout(timeout);
  }
}

function cleanMessageEffect(input: unknown): { effect: MessageEffect } | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const effect = (input as { effect?: unknown }).effect;
  return typeof effect === "string" && MESSAGE_EFFECTS.has(effect as MessageEffect) ? { effect: effect as MessageEffect } : undefined;
}

function cleanPrayerStatus(input: unknown): PrayerStatus {
  return input === "closed" || input === "answered" ? input : "active";
}

function cleanPrayerPayload(input: unknown) {
  const effect = cleanMessageEffect(input);
  const status = input && typeof input === "object" && !Array.isArray(input) ? cleanPrayerStatus((input as { status?: unknown }).status) : "active";
  return {
    kind: "prayer",
    status,
    ...(status === "active" ? {} : { statusAt: new Date().toISOString() }),
    ...(effect ? { effect: effect.effect } : {})
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

function cleanAiError(error: unknown) {
  if (error instanceof Error) return error.message.slice(0, 1000);
  return String(error || "AI request failed").slice(0, 1000);
}

function parseAiVerseReferences(input: string) {
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
    if (references.length >= 3) break;
  }
  return references;
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

function contentTypeForFile(name: string) {
  const ext = path.extname(name).toLowerCase();
  const contentTypes: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".m4a": "audio/mp4",
    ".wav": "audio/wav",
    ".webm": "audio/webm",
    ".ogg": "audio/ogg",
    ".aac": "audio/aac",
    ".mov": "video/quicktime",
    ".m4v": "video/mp4",
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".txt": "text/plain; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".zip": "application/zip"
  };
  return contentTypes[ext] || "application/octet-stream";
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

async function compressImageFile(inputPath: string, outputDir: string, options: { shortName?: boolean } = {}) {
  const originalStat = fs.statSync(inputPath);
  const outputName = compressedImageFileName(options.shortName);
  const outputPath = path.join(outputDir, outputName);
  try {
    await sharp(inputPath, { animated: true, failOn: "none", limitInputPixels: false })
      .rotate()
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

function isAudioFileName(name?: string | null) {
  return /\.(webm|mp3|m4a|wav|ogg|aac|mp4)$/i.test(name || "");
}

function cleanChannelIcon(input: unknown) {
  const icon = path.basename(String(input || "").trim()).slice(0, 16);
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
  if (channel.kind === "why") {
    const member = await prisma.channelMember.findUnique({ where: { channelId_accountId: { channelId, accountId } } });
    return !!member;
  }
  if (channel.directKey) {
    const member = await prisma.channelMember.findUnique({ where: { channelId_accountId: { channelId, accountId } } });
    return !!member;
  }
  if (!channel.isPrivate) return true;
  const account = await prisma.account.findUnique({ where: { id: accountId }, select: { role: true } });
  if (account?.role === "admin") return true;
  const member = await prisma.channelMember.findUnique({ where: { channelId_accountId: { channelId, accountId } } });
  return !!member;
}

async function canWriteChannel(accountId: number, channelId: number) {
  const channel = await prisma.channel.findUnique({ where: { id: channelId } });
  if (!channel) return false;
  if (channel.kind === "why") {
    const member = await prisma.channelMember.findUnique({ where: { channelId_accountId: { channelId, accountId } } });
    return !!member && member.role !== "viewer";
  }
  if (channel.directKey) {
    const member = await prisma.channelMember.findUnique({ where: { channelId_accountId: { channelId, accountId } } });
    return !!member && member.role !== "viewer";
  }
  if (!channel.isPrivate) return true;
  const account = await prisma.account.findUnique({ where: { id: accountId }, select: { role: true } });
  if (account?.role === "admin") return true;
  const member = await prisma.channelMember.findUnique({ where: { channelId_accountId: { channelId, accountId } } });
  return !!member && member.role !== "viewer";
}

async function canManageChannel(accountId: number, channelId: number) {
  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { directKey: true, kind: true } });
  if (channel?.kind === "why") {
    const member = await prisma.channelMember.findUnique({ where: { channelId_accountId: { channelId, accountId } } });
    return member?.role === "owner" || member?.role === "admin";
  }
  if (channel?.directKey) {
    const member = await prisma.channelMember.findUnique({ where: { channelId_accountId: { channelId, accountId } } });
    return member?.role === "owner" || member?.role === "admin";
  }
  const account = await prisma.account.findUnique({ where: { id: accountId }, select: { role: true } });
  if (account?.role === "admin") return true;
  const member = await prisma.channelMember.findUnique({ where: { channelId_accountId: { channelId, accountId } } });
  return member?.role === "owner" || member?.role === "admin";
}

async function canPinChannel(auth: Pick<AuthContext, "accountId" | "isAdmin" | "canPinMessages">, channelId: number) {
  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { isDefault: true, directKey: true } });
  if (!channel || channel.directKey) return false;
  if (auth.isAdmin) return true;
  return !!auth.canPinMessages && channel.isDefault && (await canAccessChannel(auth.accountId, channelId));
}

async function serializeMessage(message: Message & { sender: Actor; replyTo?: (Message & { sender: Actor }) | null }, viewerAccountId?: number): Promise<MessageDTO> {
  let voiceListened: boolean | undefined;
  if (isVoiceMessage(message)) {
    voiceListened = message.sender.accountId === viewerAccountId;
    if (!voiceListened && viewerAccountId) {
      const listened = await prisma.voiceListen.findUnique({ where: { messageId_accountId: { messageId: message.id, accountId: viewerAccountId } } });
      voiceListened = !!listened;
    }
  }
  let payload: unknown = message.payload || undefined;
  if (message.type === "prayer") {
    const aiSettings = await loadAiSettings();
    const raw = prayerPayloadRaw(message.payload);
    const sourceId = sourcePrayerMessageId(message.payload, message.id);
    const sourceMessage =
      sourceId !== message.id ? await prisma.message.findFirst({ where: { id: sourceId, channelId: message.channelId, type: "prayer" } }) : null;
    const actionMessageId = sourceMessage?.id || message.id;
    const sourceRaw = prayerPayloadRaw(sourceMessage?.payload);
    const displayRaw = sourceMessage ? { ...raw, ...sourceRaw, sourcePrayerMessageId: sourceMessage.id, latestUpdateAt: raw.latestUpdateAt, latestUpdateBy: raw.latestUpdateBy } : raw;
    const [actions, aiSuggestionRows, aiSuggestionSuccessCount] = await Promise.all([
      prisma.prayerAction.findMany({
        where: { messageId: actionMessageId },
        include: { account: true },
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
  if (message.type === "why_topic_card") {
    const raw = message.payload && typeof message.payload === "object" && !Array.isArray(message.payload) ? (message.payload as Record<string, unknown>) : {};
    const topicId = Number(raw.topicId || 0);
    const topic = topicId
      ? await prisma.whyTopic.findUnique({ where: { id: topicId } })
      : null;
    const owner = topic ? await prisma.account.findUnique({ where: { id: topic.ownerAccountId }, select: { displayName: true } }) : null;
    const membership = topic && viewerAccountId
      ? await prisma.whyTopicMember.findUnique({ where: { topicId_accountId: { topicId: topic.id, accountId: viewerAccountId } }, select: { role: true } })
      : null;
    const requestStatus = topic && viewerAccountId === topic.ownerAccountId ? "owner" : membership?.role === "requested" ? "requested" : membership ? "member" : "none";
    payload = {
      kind: "why_topic_card",
      topicId,
      title: topic?.title || String(raw.title || "一个新问题"),
      status: topic?.status || "deleted",
      ownerName: owner?.displayName || String(raw.ownerName || message.sender.displayName),
      requestStatus,
      sourceMessageId: topic?.sourceMessageId || Number(raw.sourceMessageId || 0) || null
    } satisfies WhyTopicCardPayload;
  }
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
    voiceListened,
    replyTo: message.replyTo
      ? {
          id: message.replyTo.id,
          content: message.replyTo.content || message.replyTo.fileName || "",
          type: message.replyTo.type,
          senderName: message.replyTo.sender.displayName
        }
      : null,
    chainRootId: message.chainRootId,
    chainVersion: message.chainVersion,
    createdAt: message.createdAt.toISOString()
  };
}

async function hydrateMessage(id: number, viewerAccountId?: number) {
  const message = await prisma.message.findUnique({
    where: { id },
    include: { sender: true, replyTo: { include: { sender: true } } }
  });
  return message ? serializeMessage(message, viewerAccountId) : null;
}

function plainTextPreview(input?: string | null, maxLength = 80) {
  return plainTextFromHtml(input, maxLength * 3).replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function makeWhyTitle(question: string) {
  const text = plainTextPreview(question, 34).replace(/^[/？?为什么\s]+/g, "").trim() || "一个新问题";
  return `关于“${text}${text.length >= 34 ? "..." : ""}”的问题`.slice(0, 160);
}

function cleanWhyQuestion(input: unknown) {
  return cleanText(String(input || "")).slice(0, 8000);
}

function messageWhyTrack(message: Pick<Message, "payload">) {
  const payload = message.payload && typeof message.payload === "object" && !Array.isArray(message.payload) ? (message.payload as Record<string, unknown>) : {};
  return payload.whyTrack === "discussion" ? "discussion" : "study";
}

async function ensureWhyAssistantCharacter() {
  const actor = await prisma.actor.upsert({
    where: { username: WHY_ASSISTANT_USERNAME },
    update: { displayName: WHY_ASSISTANT_NAME, kind: "virtual", status: "active" },
    create: { kind: "virtual", username: WHY_ASSISTANT_USERNAME, displayName: WHY_ASSISTANT_NAME }
  });
  await prisma.virtualCharacter.upsert({
    where: { actorId: actor.id },
    update: { enabled: true },
    create: {
      actorId: actor.id,
      enabled: true,
      config: defaultVirtualCharacterConfig(WHY_ASSISTANT_NAME),
      engineBinding: {}
    }
  });
  return actor;
}

async function whyTopicMembership(topicId: number, accountId: number) {
  return prisma.whyTopicMember.findUnique({ where: { topicId_accountId: { topicId, accountId } } });
}

async function canAccessWhyTopic(accountId: number, topicId: number) {
  const topic = await prisma.whyTopic.findUnique({ where: { id: topicId } });
  if (!topic || topic.status === "deleted") return false;
  const member = await whyTopicMembership(topicId, accountId);
  return !!member && member.role !== "requested";
}

async function canManageWhyTopic(auth: AuthContext, topicId: number) {
  const topic = await prisma.whyTopic.findUnique({ where: { id: topicId } });
  if (!topic) return false;
  if (auth.isAdmin) return true;
  return topic.ownerAccountId === auth.accountId;
}

async function whyTopicDto(topicId: number, auth: AuthContext, includeQuestion = false): Promise<WhyTopicDTO | null> {
  const topic = await prisma.whyTopic.findUnique({ where: { id: topicId } });
  if (!topic) return null;
  const [owner, member, sourceChannel, participantCount, pendingRequestCount, lastMessage, read] = await Promise.all([
    prisma.account.findUnique({ where: { id: topic.ownerAccountId }, select: { displayName: true } }),
    whyTopicMembership(topic.id, auth.accountId),
    topic.sourceChannelId ? prisma.channel.findUnique({ where: { id: topic.sourceChannelId }, select: { name: true } }) : null,
    prisma.whyTopicMember.count({ where: { topicId: topic.id, role: { not: "requested" } } }),
    prisma.whyTopicMember.count({ where: { topicId: topic.id, role: "requested" } }),
    prisma.message.findFirst({ where: { channelId: topic.channelId }, orderBy: { id: "desc" } }),
    prisma.whyTopicRead.findUnique({ where: { topicId_accountId: { topicId: topic.id, accountId: auth.accountId } } })
  ]);
  const unreadCount = await prisma.message.count({
    where: {
      channelId: topic.channelId,
      id: read?.lastReadMessageId ? { gt: read.lastReadMessageId } : undefined,
      sender: { accountId: { not: auth.accountId } }
    }
  });
  return {
    id: topic.id,
    ownerAccountId: topic.ownerAccountId,
    ownerName: owner?.displayName || "成员",
    channelId: topic.channelId,
    sourceChannelId: topic.sourceChannelId,
    sourceChannelName: sourceChannel?.name || null,
    sourceMessageId: topic.sourceMessageId,
    cardMessageId: topic.cardMessageId,
    title: topic.title,
    summary: topic.summary,
    originalQuestion: includeQuestion && member && member.role !== "requested" ? topic.originalQuestion : undefined,
    completionNote: topic.completionNote,
    status: topic.status,
    memberRole: member?.role || "requested",
    participantCount,
    pendingRequestCount,
    unreadCount,
    lastMessagePreview: plainTextPreview(lastMessage?.content || topic.originalQuestion, 80),
    createdAt: topic.createdAt.toISOString(),
    updatedAt: topic.updatedAt.toISOString()
  };
}

async function whyTopicMembersDto(topicId: number): Promise<WhyTopicMemberDTO[]> {
  const members = await prisma.whyTopicMember.findMany({ where: { topicId }, orderBy: [{ role: "asc" }, { createdAt: "asc" }] });
  const accounts = await prisma.account.findMany({ where: { id: { in: members.map((member) => member.accountId) } }, select: { id: true, displayName: true, avatarPath: true } });
  const accountMap = new Map(accounts.map((account) => [account.id, account]));
  return members.map((member) => {
    const account = accountMap.get(member.accountId);
    return {
      accountId: member.accountId,
      displayName: account?.displayName || "成员",
      avatarPath: account?.avatarPath || null,
      role: member.role,
      createdAt: member.createdAt.toISOString()
    };
  });
}

function whyRunDto(run: { id: number; topicId: number; status: string; errorText?: string | null; createdAt: Date; updatedAt: Date }): WhyAssistantRunDTO {
  return {
    id: run.id,
    topicId: run.topicId,
    status: run.status === "success" || run.status === "failed" || run.status === "running" ? run.status : "pending",
    errorText: run.errorText || null,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString()
  };
}

async function buildWhyAssistantContext(topicId: number) {
  const topic = await prisma.whyTopic.findUnique({ where: { id: topicId } });
  if (!topic) throw new Error("topic not found");
  const rows = await prisma.message.findMany({
    where: { channelId: topic.channelId, type: "text" },
    include: { sender: true },
    orderBy: { id: "desc" },
    take: 80
  });
  const studyRows = rows
    .reverse()
    .filter((message) => message.sender.accountId === topic.ownerAccountId || message.sender.username === WHY_ASSISTANT_USERNAME)
    .filter((message) => messageWhyTrack(message) === "study")
    .slice(-30);
  const lines = [
    `标题：${topic.title}`,
    `原始问题：${plainTextFromHtml(topic.originalQuestion, 2000)}`,
    topic.summary ? `话题摘要：${plainTextFromHtml(topic.summary, 1000)}` : "",
    "",
    "研究主线（只包含提问者与为什么助手，不包含弟兄姐妹讨论）：",
    ...studyRows.map((message) => `${message.sender.username === WHY_ASSISTANT_USERNAME ? "为什么助手" : "提问者"}：${plainTextFromHtml(message.content, 1200)}`),
    "",
    "请按为什么助手规则回应。"
  ].filter(Boolean);
  return lines.join("\n").slice(0, 12000);
}

async function loadWhyAssistantSettings() {
  const aiSettings = await loadAiSettings();
  const rows = await prisma.setting.findMany({
    where: { key: { in: ["whyAssistantEnabled", "whyAssistantPromptCommand", "whyAssistantWebSearchEnabled"] } }
  });
  const settings = new Map(rows.map((row) => [row.key, row.value]));
  return {
    value: {
      ...aiSettings.value,
      enabled: settings.get("whyAssistantEnabled") !== "false",
      promptCommand: settings.get("whyAssistantPromptCommand") || DEFAULT_WHY_ASSISTANT_PROMPT,
      webSearchEnabled: settings.get("whyAssistantWebSearchEnabled") !== "false"
    },
    encryptedApiKey: aiSettings.encryptedApiKey
  };
}

async function callWhyAssistant(settings: AiSettingsDTO & { webSearchEnabled?: boolean }, apiKey: string, contextText: string) {
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
        thinking: { type: "enabled" },
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

async function processWhyAssistantRun(runId: number) {
  const run = await prisma.whyAssistantRun.findUnique({ where: { id: runId }, include: { topic: true } });
  if (!run || run.status === "success") return;
  await prisma.whyAssistantRun.update({ where: { id: runId }, data: { status: "running" } });
  io.to(`ch:${run.topic.channelId}`).emit("why:updated", { topicId: run.topicId });
  const settings = await loadWhyAssistantSettings();
  const apiKey = decryptAiApiKey(settings.encryptedApiKey);
  const assistant = await ensureWhyAssistantCharacter();
  const contextText = await buildWhyAssistantContext(run.topicId);
  try {
    if (!settings.value.enabled || !apiKey) throw new Error("为什么助手尚未配置 API Key");
    const responseText = await callWhyAssistant(settings.value, apiKey, contextText);
    const message = await createMessageFromActor({
      channelId: run.topic.channelId,
      actorId: assistant.id,
      content: responseText,
      type: "text",
      payload: { whyTrack: "study", whyAssistantRunId: run.id },
      skipPush: true,
      skipEngineEvent: true
    });
    await prisma.whyAssistantRun.update({
      where: { id: runId },
      data: { status: "success", contextText, responseText, model: settings.value.model, baseUrl: settings.value.baseUrl }
    });
    await prisma.whyTopic.update({ where: { id: run.topicId }, data: { updatedAt: new Date() } });
    io.to(`ch:${run.topic.channelId}`).emit("messages:refresh", { channelId: run.topic.channelId });
    io.to(`ch:${run.topic.channelId}`).emit("why:updated", { topicId: run.topicId, messageId: message.id });
  } catch (error) {
    await prisma.whyAssistantRun.update({
      where: { id: runId },
      data: { status: "failed", contextText, errorText: cleanAiError(error), model: settings.value.model, baseUrl: settings.value.baseUrl }
    });
    io.to(`ch:${run.topic.channelId}`).emit("why:updated", { topicId: run.topicId });
  }
}

async function queueWhyAssistantRun(topicId: number, triggerMessageId?: number | null) {
  const contextText = await buildWhyAssistantContext(topicId).catch(() => "");
  const run = await prisma.whyAssistantRun.create({
    data: { topicId, triggerMessageId: triggerMessageId || null, status: "pending", promptText: DEFAULT_WHY_ASSISTANT_PROMPT, contextText }
  });
  void processWhyAssistantRun(run.id).catch((error) => app.log.warn({ error, runId: run.id }, "why assistant run failed"));
  return run;
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
  const where = channel.kind === "why"
    ? { memberships: { some: { channelId } } }
    : channel.directKey
    ? { memberships: { some: { channelId } } }
    : channel.isPrivate
      ? { OR: [{ role: "admin" as const }, { memberships: { some: { channelId } } }] }
      : {};
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

async function sendPushToAccounts(accountIds: number[], payload: { title: string; body: string; url: string; tag: string; channelId: number }) {
  if (!pushReady || !accountIds.length) return;
  const subscriptions = await prisma.pushSubscription.findMany({ where: { accountId: { in: accountIds } } });
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

async function sendMessagePush(messageId: number) {
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
  });
}

async function sendAdminBroadcastPush(channelId: number, content: string) {
  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { name: true } });
  if (!channel) return;
  const accountIds = await notificationRecipientIds(channelId, null, true);
  await sendPushToAccounts(accountIds, {
    title: `管理员广播 · ${channel.name}`,
    body: stripPushText(content) || "新的管理员广播",
    url: `/?channelId=${channelId}`,
    tag: `admin-broadcast-${channelId}`,
    channelId
  });
}

async function sendPinnedPush(channelId: number, pinned: { title?: string | null; body: PinnedBodyDTO }) {
  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { name: true } });
  if (!channel) return;
  const accountIds = await notificationRecipientIds(channelId, null, true);
  await sendPushToAccounts(accountIds, {
    title: `新置顶 · ${channel.name}`,
    body: pinnedBodyPreview(pinned.body, pinned.title),
    url: `/?channelId=${channelId}`,
    tag: `pinned-${channelId}`,
    channelId
  });
}

async function sendPrayerUpdatePush(messageId: number) {
  const message = await prisma.message.findUnique({ where: { id: messageId }, include: { sender: true, channel: true } });
  if (!message || message.type !== "prayer") return;
  const accountIds = await notificationRecipientIds(message.channelId, null, true);
  await sendPushToAccounts(accountIds, {
    title: `代祷最新动态 · ${message.channel.name}`,
    body: `${message.sender.displayName} 更新代祷：${stripPushText(message.content) || "代祷事项"}`,
    url: `/?channelId=${message.channelId}`,
    tag: `prayer-update-${message.channelId}-${sourcePrayerMessageId(message.payload, message.id)}`,
    channelId: message.channelId
  });
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

function disconnectSessions(sessionIds: string[]) {
  const targets = new Set(sessionIds);
  if (!targets.size) return;
  for (const socket of io.sockets.sockets.values()) {
    const auth = socket.data.auth as AuthContext | undefined;
    if (auth?.sessionId && targets.has(auth.sessionId)) socket.disconnect(true);
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

async function writeLoginLog(kind: AdminLoginLogKind, accountId: number, session?: LoginLogSession | null, createdAt = new Date()) {
  await prisma
    .$executeRaw`
      INSERT INTO account_login_logs (kind, account_id, session_id, device_kind, device_name, ip_address, user_agent, created_at)
      VALUES (${kind}, ${accountId}, ${session?.id || null}, ${session?.deviceKind || null}, ${session?.deviceName || null}, ${session?.ipAddress || null}, ${session?.userAgent || null}, ${createdAt})
    `
    .catch((error) => app.log.warn({ error, kind, accountId }, "Failed to write login log"));
}

async function createAuthSession(accountId: number, request: FastifyRequest, deviceNameOverride?: string) {
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
    writeLoginLog("auth_login", accountId, session, now),
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

async function ensureBootstrap() {
  await ensureLoginLogTable();
  const defaultChannel = await prisma.channel.findFirst({ where: { isDefault: true } });
  if (!defaultChannel) {
    await prisma.channel.create({ data: { name: "综合频道", description: "默认公开频道", isDefault: true } });
  }
  const accountCount = await prisma.account.count();
  if (accountCount === 0) {
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

async function channelDto(channelId: number, viewer?: Pick<AuthContext, "accountId" | "isAdmin" | "canPinMessages">) {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    include: {
      _count: { select: { members: true } },
      pinned: { where: { active: true }, orderBy: { updatedAt: "desc" }, take: 1 }
    }
  });
  if (!channel) return null;
  const pin = channel.pinned[0];
  const membership = viewer ? await prisma.channelMember.findUnique({ where: { channelId_accountId: { channelId, accountId: viewer.accountId } }, select: { role: true } }) : null;
  const pinned = pin ? await serializePinnedItem(pin, viewer) : null;
  return {
    id: channel.id,
    name: channel.name,
    description: channel.description,
    icon: cleanChannelIcon(channel.icon),
    isPrivate: channel.isPrivate,
    isDefault: channel.isDefault,
    directKey: channel.directKey,
    canManage: viewer ? !!viewer.isAdmin || membership?.role === "owner" || membership?.role === "admin" : undefined,
    canPin: viewer ? await canPinChannel(viewer, channelId) : undefined,
    memberCount: channel._count.members,
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
  skipEngineEvent?: boolean;
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
  if (!input.skipPush) void sendMessagePush(message.id).catch((error) => app.log.warn({ error }, "message push failed"));
  if (!input.skipEngineEvent && (input.type === "text" || input.type === "chain" || input.type === "prayer")) {
    await createEngineEvent("message_created", { messageId: message.id }, input.channelId, message.id);
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
    branch: UPDATE_BRANCH
  }
}));

app.get("/api/admin/update/check", { preHandler: requireAdmin }, async () => {
  const latest = await latestGitHubPackage();
  return {
    current: APP_VERSION,
    latest: latest.version,
    updateAvailable: compareVersions(latest.version, APP_VERSION) > 0,
    repo: `${latest.owner}/${latest.repo}`,
    branch: latest.branch,
    url: latest.url,
    status: readUpdateStatus()
  };
});

app.get("/api/admin/update/status", { preHandler: requireAdmin }, async () => readUpdateStatus());

app.post("/api/admin/update/start", { preHandler: requireAdmin }, async (request, reply) => {
  const status = readUpdateStatus();
  if (status.state === "running") return reply.code(409).send({ success: false, message: "更新已经在进行中", status });
  const scriptPath = path.join(ROOT, "scripts", "self-update.sh");
  if (!fs.existsSync(scriptPath)) return reply.code(500).send({ success: false, message: "缺少更新脚本" });
  fs.writeFileSync(UPDATE_LOG_PATH, "");
  writeUpdateStatus("running", 1, "准备更新");
  const child = spawn("bash", [scriptPath], {
    cwd: ROOT,
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      APP_DIR: ROOT,
      UPDATE_REPO_URL,
      UPDATE_BRANCH,
      UPDATE_PM2_APP,
      UPDATE_STATUS_PATH,
      UPDATE_LOG_PATH
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
  reply.header("Cache-Control", "public, max-age=2592000, immutable");
  return reply.send(fs.createReadStream(filePath));
});

app.get("/backgrounds/:file", async (request, reply) => {
  const file = path.basename((request.params as { file: string }).file);
  const filePath = path.join(BG_DIR, file);
  if (!fs.existsSync(filePath)) return reply.code(404).send("Not found");
  reply.header("Cache-Control", "public, max-age=2592000, immutable");
  return reply.send(fs.createReadStream(filePath));
});

app.post("/api/auth/login", async (request, reply) => {
  const body = z.object({ username: z.string().min(1), password: z.string().min(1), deviceName: z.string().max(120).optional() }).safeParse(request.body);
  if (!body.success) return reply.code(400).send({ success: false, message: "参数错误" });
  const account = await prisma.account.findUnique({ where: { username: body.data.username }, include: { actor: true } });
  if (!account || !(await bcrypt.compare(body.data.password, account.passwordHash))) {
    return reply.code(401).send({ success: false, message: "用户名或密码错误" });
  }
  const session = await createAuthSession(account.id, request, body.data.deviceName);
  const updated = await prisma.account.findUniqueOrThrow({ where: { id: account.id }, include: { actor: true } });
  return { success: true, token: signToken(updated, session), account: authDto(updated) };
});

app.post("/api/auth/register", async (request, reply) => {
  const enabled = await settingBool("registrationEnabled", false);
  if (!enabled) return reply.code(403).send({ success: false, message: "暂未开放注册" });
  const body = z
    .object({
      username: z.string().regex(/^[a-zA-Z0-9_.-]{2,40}$/),
      displayName: z.string().min(1).max(80),
      password: z.string().min(6),
      deviceName: z.string().max(120).optional()
    })
    .safeParse(request.body);
  if (!body.success) return reply.code(400).send({ success: false, message: "用户名需 2-40 位，密码至少 6 位" });
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
  const session = await createAuthSession(account.id, request, body.data.deviceName);
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

app.post("/api/auth/change-password", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const body = z.object({ oldPassword: z.string(), newPassword: z.string().min(6) }).safeParse(request.body);
  if (!body.success) return reply.code(400).send({ success: false, message: "新密码不能小于 6 位" });
  const account = await prisma.account.findUniqueOrThrow({ where: { id: auth.accountId } });
  if (!(await bcrypt.compare(body.data.oldPassword, account.passwordHash))) return reply.code(400).send({ success: false, message: "原密码错误" });
  await prisma.account.update({ where: { id: auth.accountId }, data: { passwordHash: await bcrypt.hash(body.data.newPassword, 12) } });
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

app.get("/api/admin/login-logs", { preHandler: requireAdmin }, async (request, reply) => {
  const parsed = z.object({ limit: z.coerce.number().int().min(1).max(500).default(200) }).safeParse(request.query);
  if (!parsed.success) return reply.code(400).send({ success: false, message: "日志参数无效" });
  const rows = await prisma.$queryRaw<
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
    LIMIT ${parsed.data.limit}
  `;
  return {
    logs: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      accountId: row.accountId,
      username: row.username || `user-${row.accountId}`,
      displayName: row.displayName || row.username || `用户 ${row.accountId}`,
      deviceKind: row.deviceKind,
      deviceName: row.deviceName,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      sessionId: row.sessionId,
      createdAt: row.createdAt.toISOString()
    }))
  };
});

app.get("/api/notifications/settings", { preHandler: requireAuth }, async (request) => {
  const auth = (request as AuthedRequest).auth;
  const preferences = await prisma.channelNotificationPreference.findMany({
    where: { accountId: auth.accountId, muted: true },
    select: { channelId: true }
  });
  const subscriptions = await prisma.pushSubscription.count({ where: { accountId: auth.accountId } });
  return {
    publicKey: vapidPublicKey,
    pushReady,
    subscriptions,
    mutedChannelIds: preferences.map((item) => item.channelId)
  };
});

app.post("/api/push-subscriptions", { preHandler: requireAuth }, async (request) => {
  const auth = (request as AuthedRequest).auth;
  const body = pushSubscriptionSchema.parse(request.body);
  await prisma.pushSubscription.upsert({
    where: { endpoint: body.endpoint },
    update: {
      accountId: auth.accountId,
      keysP256dh: body.keys.p256dh,
      keysAuth: body.keys.auth
    },
    create: {
      accountId: auth.accountId,
      endpoint: body.endpoint,
      keysP256dh: body.keys.p256dh,
      keysAuth: body.keys.auth
    }
  });
  return { success: true };
});

app.delete("/api/push-subscriptions", { preHandler: requireAuth }, async (request) => {
  const auth = (request as AuthedRequest).auth;
  const body = z.object({ endpoint: z.string().url().max(512).optional() }).parse(request.body || {});
  const where = body.endpoint ? { accountId: auth.accountId, endpoint: body.endpoint } : { accountId: auth.accountId };
  await prisma.pushSubscription.deleteMany({ where });
  return { success: true };
});

app.post("/api/notifications/test", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  if (!pushReady) return reply.code(400).send({ success: false, message: "服务器推送未就绪" });
  const body = z.object({ endpoint: z.string().url().max(512).optional() }).parse(request.body || {});
  const subscriptions = await prisma.pushSubscription.findMany({
    where: body.endpoint ? { accountId: auth.accountId, endpoint: body.endpoint } : { accountId: auth.accountId }
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
  const auth = (request as AuthedRequest).auth;
  const memberships = await prisma.whyTopicMember.findMany({
    where: { accountId: auth.accountId },
    orderBy: { updatedAt: "desc" },
    take: 200
  });
  const topicIds = memberships.map((membership) => membership.topicId);
  const topics = await Promise.all(topicIds.map((id) => whyTopicDto(id, auth)));
  return { topics: topics.filter(Boolean) };
});

app.get("/api/why/summary", { preHandler: requireAuth }, async (request) => {
  const auth = (request as AuthedRequest).auth;
  const memberships = await prisma.whyTopicMember.findMany({ where: { accountId: auth.accountId, role: { not: "requested" } } });
  const topicIds = memberships.map((membership) => membership.topicId);
  const pendingRequestCount = await prisma.whyTopicMember.count({
    where: { role: "requested", topic: { ownerAccountId: auth.accountId, status: { not: "deleted" } } }
  });
  let unreadCount = 0;
  for (const topicId of topicIds) {
    const topic = await whyTopicDto(topicId, auth);
    unreadCount += topic?.unreadCount || 0;
  }
  return { unreadCount, pendingRequestCount };
});

app.post("/api/why/topics", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const body = z
    .object({
      question: z.string().min(1).max(8000),
      sourceChannelId: z.number().int().positive().nullable().optional(),
      sourceMessageId: z.number().int().positive().nullable().optional()
    })
    .parse(request.body);
  const question = cleanWhyQuestion(body.question);
  if (!plainTextFromHtml(question, 8000)) return reply.code(400).send({ success: false, message: "问题不能为空" });
  const sourceChannelId = body.sourceChannelId || null;
  if (sourceChannelId) {
    const sourceChannel = await prisma.channel.findUnique({ where: { id: sourceChannelId }, select: { kind: true } });
    if (!sourceChannel || sourceChannel.kind === "why" || !(await canWriteChannel(auth.accountId, sourceChannelId))) {
      return reply.code(403).send({ success: false, message: "无权在此频道创建为什么研究" });
    }
  }
  let sourceMessageId = body.sourceMessageId || null;
  if (sourceMessageId) {
    const sourceMessage = await prisma.message.findUnique({ where: { id: sourceMessageId } });
    if (!sourceMessage || sourceMessage.type !== "text" || !sourceChannelId || sourceMessage.channelId !== sourceChannelId || !(await canAccessChannel(auth.accountId, sourceMessage.channelId))) {
      return reply.code(400).send({ success: false, message: "只能从当前频道的文本消息开始研究" });
    }
  }
  const actor = await prisma.actor.findUniqueOrThrow({ where: { id: auth.actorId } });
  const title = makeWhyTitle(question);
  const channel = await prisma.channel.create({
    data: {
      kind: "why",
      name: title,
      description: "为什么研究话题",
      icon: "",
      isPrivate: true,
      members: { create: { accountId: auth.accountId, role: "owner" } }
    }
  });
  const topic = await prisma.whyTopic.create({
    data: {
      ownerAccountId: auth.accountId,
      channelId: channel.id,
      sourceChannelId,
      sourceMessageId,
      title,
      summary: "",
      originalQuestion: question,
      members: { create: { accountId: auth.accountId, role: "owner" } }
    }
  });
  const firstMessage = await createMessageFromActor({
    channelId: channel.id,
    actorId: actor.id,
    content: question,
    type: "text",
    payload: { whyTrack: "study", originalQuestion: true },
    skipPush: true,
    skipEngineEvent: true
  });
  let card: MessageDTO | null = null;
  if (sourceChannelId) {
    const cardMessage = await createMessageFromActor({
      channelId: sourceChannelId,
      actorId: actor.id,
      content: title,
      type: "why_topic_card",
      payload: { kind: "why_topic_card", topicId: topic.id, title, status: "active", ownerName: actor.displayName, sourceMessageId },
      skipPush: true,
      skipEngineEvent: true
    });
    await prisma.whyTopic.update({ where: { id: topic.id }, data: { cardMessageId: cardMessage.id } });
    card = await hydrateMessage(cardMessage.id, auth.accountId);
  }
  joinAccountChannel(auth.accountId, channel.id);
  const run = await queueWhyAssistantRun(topic.id, firstMessage.id);
  const dto = await whyTopicDto(topic.id, auth, true);
  return { success: true, topic: dto, run: whyRunDto(run), card };
});

app.get("/api/why/topics/:id", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const topicId = Number((request.params as { id: string }).id);
  const topicRow = await prisma.whyTopic.findUnique({ where: { id: topicId }, select: { status: true } });
  if (!topicRow || topicRow.status === "deleted") return reply.code(410).send({ success: false, message: "问题已删除" });
  if (!(await canAccessWhyTopic(auth.accountId, topicId))) return reply.code(403).send({ success: false, message: "无权访问此为什么研究" });
  const topic = await whyTopicDto(topicId, auth, true);
  if (!topic) return reply.code(404).send({ success: false, message: "为什么研究不存在" });
  const messages = await prisma.message.findMany({
    where: { channelId: topic.channelId },
    include: { sender: true, replyTo: { include: { sender: true } } },
    orderBy: { id: "asc" },
    take: 300
  });
  const lastMessageId = messages[messages.length - 1]?.id || null;
  await prisma.whyTopicRead.upsert({
    where: { topicId_accountId: { topicId, accountId: auth.accountId } },
    update: { lastReadMessageId: lastMessageId, readAt: new Date() },
    create: { topicId, accountId: auth.accountId, lastReadMessageId: lastMessageId }
  });
  const [members, runs] = await Promise.all([
    whyTopicMembersDto(topicId),
    prisma.whyAssistantRun.findMany({ where: { topicId, status: { in: ["pending", "running", "failed"] } }, orderBy: { createdAt: "desc" }, take: 5 })
  ]);
  return { topic, members, messages: await Promise.all(messages.map((message) => serializeMessage(message, auth.accountId))), runs: runs.map(whyRunDto) };
});

app.post("/api/why/topics/:id/messages", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const topicId = Number((request.params as { id: string }).id);
  const body = z.object({ content: z.string().min(1).max(8000) }).parse(request.body);
  if (!(await canAccessWhyTopic(auth.accountId, topicId))) return reply.code(403).send({ success: false, message: "无权访问此为什么研究" });
  const topic = await prisma.whyTopic.findUnique({ where: { id: topicId } });
  if (!topic || topic.status === "deleted") return reply.code(404).send({ success: false, message: "为什么研究不存在" });
  const content = cleanWhyQuestion(body.content);
  if (!plainTextFromHtml(content, 8000)) return reply.code(400).send({ success: false, message: "消息不能为空" });
  const isOwner = topic.ownerAccountId === auth.accountId;
  const message = await createMessageFromActor({
    channelId: topic.channelId,
    actorId: auth.actorId,
    content,
    type: "text",
    payload: { whyTrack: isOwner ? "study" : "discussion" },
    skipPush: true,
    skipEngineEvent: true
  });
  if (topic.status === "completed") await prisma.whyTopic.update({ where: { id: topicId }, data: { status: "active" } });
  else await prisma.whyTopic.update({ where: { id: topicId }, data: { updatedAt: new Date() } });
  const run = isOwner ? await queueWhyAssistantRun(topicId, message.id) : null;
  io.to(`ch:${topic.channelId}`).emit("why:updated", { topicId });
  return { success: true, message: await hydrateMessage(message.id, auth.accountId), run: run ? whyRunDto(run) : null };
});

app.post("/api/why/topics/:id/request", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const topicId = Number((request.params as { id: string }).id);
  const topic = await prisma.whyTopic.findUnique({ where: { id: topicId } });
  if (!topic || topic.status === "deleted") return reply.code(410).send({ success: false, message: "问题已删除" });
  if (topic.ownerAccountId === auth.accountId) return { success: true, role: "owner" };
  const existing = await whyTopicMembership(topicId, auth.accountId);
  if (existing && existing.role !== "requested") return { success: true, role: existing.role };
  await prisma.whyTopicMember.upsert({
    where: { topicId_accountId: { topicId, accountId: auth.accountId } },
    update: { role: "requested" },
    create: { topicId, accountId: auth.accountId, role: "requested" }
  });
  const requester = await prisma.account.findUnique({ where: { id: auth.accountId }, select: { displayName: true } });
  await sendPushToAccounts([topic.ownerAccountId], {
    title: "新的为什么研究加入请求",
    body: `${requester?.displayName || "有人"} 请求加入：${topic.title}`,
    url: `/?whyTopicId=${topic.id}`,
    tag: `why-request-${topic.id}`,
    channelId: topic.channelId
  });
  io.to(`acct:${topic.ownerAccountId}`).emit("why:updated", { topicId });
  return { success: true, role: "requested" };
});

app.post("/api/why/topics/:id/requests/:accountId", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const topicId = Number((request.params as { id: string }).id);
  const accountId = Number((request.params as { accountId: string }).accountId);
  const body = z.object({ action: z.enum(["approve", "reject"]) }).parse(request.body);
  const topic = await prisma.whyTopic.findUnique({ where: { id: topicId } });
  if (!topic || topic.status === "deleted") return reply.code(404).send({ success: false, message: "为什么研究不存在" });
  if (topic.ownerAccountId !== auth.accountId && !auth.isAdmin) return reply.code(403).send({ success: false, message: "只有提问者可以处理请求" });
  const requestRow = await whyTopicMembership(topicId, accountId);
  if (!requestRow || requestRow.role !== "requested") return reply.code(404).send({ success: false, message: "请求不存在" });
  if (body.action === "approve") {
    await prisma.whyTopicMember.update({ where: { id: requestRow.id }, data: { role: "member" } });
    await prisma.channelMember.createMany({ data: [{ channelId: topic.channelId, accountId, role: "member" }], skipDuplicates: true });
    joinAccountChannel(accountId, topic.channelId);
  } else {
    await prisma.whyTopicMember.delete({ where: { id: requestRow.id } });
  }
  await sendPushToAccounts([accountId], {
    title: body.action === "approve" ? "为什么研究请求已通过" : "为什么研究请求未通过",
    body: topic.title,
    url: `/?whyTopicId=${topic.id}`,
    tag: `why-request-result-${topic.id}`,
    channelId: topic.channelId
  });
  io.to(`acct:${accountId}`).to(`acct:${topic.ownerAccountId}`).emit("why:updated", { topicId });
  return { success: true };
});

app.patch("/api/why/topics/:id", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const topicId = Number((request.params as { id: string }).id);
  if (!(await canManageWhyTopic(auth, topicId))) return reply.code(403).send({ success: false, message: "无权管理此为什么研究" });
  const body = z.object({ title: z.string().min(1).max(160).optional(), status: z.enum(["active", "completed"]).optional(), completionNote: z.string().max(8000).optional() }).parse(request.body);
  const topic = await prisma.whyTopic.update({
    where: { id: topicId },
    data: {
      title: body.title ? body.title.trim() : undefined,
      status: body.status,
      completionNote: body.completionNote
    }
  });
  if (topic.cardMessageId && body.title) {
    const card = await prisma.message.findUnique({ where: { id: topic.cardMessageId } });
    const payload = card?.payload && typeof card.payload === "object" && !Array.isArray(card.payload) ? { ...(card.payload as Record<string, unknown>), title: topic.title } : { kind: "why_topic_card", topicId: topic.id, title: topic.title, status: topic.status };
    await prisma.message.update({ where: { id: topic.cardMessageId }, data: { content: topic.title, payload } });
    const dto = await hydrateMessage(topic.cardMessageId);
    if (dto) io.to(`ch:${dto.channelId}`).emit("message:updated", dto);
  }
  io.to(`ch:${topic.channelId}`).emit("why:updated", { topicId });
  return { success: true, topic: await whyTopicDto(topicId, auth, true) };
});

app.post("/api/why/topics/:id/complete", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const topicId = Number((request.params as { id: string }).id);
  if (!(await canManageWhyTopic(auth, topicId))) return reply.code(403).send({ success: false, message: "无权完成此为什么研究" });
  const topic = await prisma.whyTopic.findUnique({ where: { id: topicId } });
  if (!topic || topic.status === "deleted") return reply.code(404).send({ success: false, message: "为什么研究不存在" });
  const contextText = await buildWhyAssistantContext(topicId);
  const note = [
    "整理草稿",
    "",
    `原问题：${plainTextFromHtml(topic.originalQuestion, 600)}`,
    "",
    "请你在这里补上：我观察到什么、还需要查证什么、要带去祷告或和弟兄姐妹讨论什么。",
    "",
    "研究主线摘录：",
    plainTextFromHtml(contextText, 1800)
  ].join("\n").slice(0, 8000);
  const updated = await prisma.whyTopic.update({ where: { id: topicId }, data: { status: "completed", completionNote: note } });
  io.to(`ch:${updated.channelId}`).emit("why:updated", { topicId });
  return { success: true, topic: await whyTopicDto(topicId, auth, true) };
});

app.post("/api/why/topics/:id/retry-assistant", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const topicId = Number((request.params as { id: string }).id);
  if (!(await canAccessWhyTopic(auth.accountId, topicId))) return reply.code(403).send({ success: false, message: "无权访问此为什么研究" });
  const topic = await prisma.whyTopic.findUnique({ where: { id: topicId } });
  if (!topic || topic.ownerAccountId !== auth.accountId) return reply.code(403).send({ success: false, message: "只有提问者可以重试助手" });
  const latestOwnerMessage = await prisma.message.findFirst({ where: { channelId: topic.channelId, senderActorId: auth.actorId }, orderBy: { id: "desc" } });
  const run = await queueWhyAssistantRun(topicId, latestOwnerMessage?.id || null);
  return { success: true, run: whyRunDto(run) };
});

app.delete("/api/why/topics/:id", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const topicId = Number((request.params as { id: string }).id);
  if (!(await canManageWhyTopic(auth, topicId))) return reply.code(403).send({ success: false, message: "无权删除此为什么研究" });
  const topic = await prisma.whyTopic.findUnique({ where: { id: topicId }, include: { members: { select: { accountId: true } } } });
  if (!topic) return reply.code(404).send({ success: false, message: "为什么研究不存在" });
  const channelMessageIds = (await prisma.message.findMany({ where: { channelId: topic.channelId }, select: { id: true } })).map((message) => message.id);
  await prisma.$transaction(async (tx) => {
    if (topic.cardMessageId) {
      const card = await tx.message.findUnique({ where: { id: topic.cardMessageId } });
      const payload = card?.payload && typeof card.payload === "object" && !Array.isArray(card.payload)
        ? { ...(card.payload as Record<string, unknown>), status: "deleted" }
        : { kind: "why_topic_card", topicId: topic.id, title: topic.title, status: "deleted" };
      await tx.message.update({ where: { id: topic.cardMessageId }, data: { payload } }).catch(() => undefined);
    }
    if (channelMessageIds.length) {
      await tx.message.updateMany({ where: { replyToId: { in: channelMessageIds } }, data: { replyToId: null } });
    }
    await tx.channel.deleteMany({ where: { id: topic.channelId } });
    await tx.whyTopic.deleteMany({ where: { id: topicId } });
  });
  if (topic.cardMessageId) {
    const dto = await hydrateMessage(topic.cardMessageId);
    if (dto) io.to(`ch:${dto.channelId}`).emit("message:updated", dto);
  }
  for (const member of topic.members) {
    io.to(`acct:${member.accountId}`).emit("why:updated", { topicId });
  }
  return { success: true };
});

app.get("/api/channels", { preHandler: requireAuth }, async (request) => {
  const auth = (request as AuthedRequest).auth;
  const where = auth.isAdmin
    ? { kind: { not: "why" as const }, OR: [{ directKey: null }, { members: { some: { accountId: auth.accountId } } }] }
    : {
        kind: { not: "why" as const },
        OR: [{ isPrivate: false }, { members: { some: { accountId: auth.accountId } } }]
      };
  const channels = await prisma.channel.findMany({ where, orderBy: [{ isDefault: "desc" }, { id: "asc" }] });
  return { channels: await Promise.all(channels.map((ch) => channelDto(ch.id, auth))) };
});

app.post("/api/channels", { preHandler: requireAdmin }, async (request) => {
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
  if (!body.isPrivate) {
    const accounts = await prisma.account.findMany({ select: { id: true } });
    await prisma.channelMember.createMany({
      data: accounts.map((a) => ({ accountId: a.id, channelId: channel.id, role: a.id === auth.accountId ? "owner" : "member" })),
      skipDuplicates: true
    });
  }
  const dto = await channelDto(channel.id);
  io.emit("channel:updated", { action: "created", channel: dto });
  return { success: true, channel: dto };
});

app.patch("/api/channels/:id", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const channelId = Number((request.params as { id: string }).id);
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
  const dto = await channelDto(channelId);
  io.emit("channel:updated", { action: "updated", channel: dto });
  return { success: true, channel: dto };
});

app.post("/api/channels/:id/icon", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const channelId = Number((request.params as { id: string }).id);
  if (!(await canManageChannel(auth.accountId, channelId))) return reply.code(403).send({ success: false, message: "无权管理此频道" });
  const safeName = await saveImageUpload(request, reply, "缺少频道图标", true);
  if (!safeName) return reply;
  await prisma.channel.update({ where: { id: channelId }, data: { icon: safeName } });
  const dto = await channelDto(channelId, auth);
  io.emit("channel:updated", { action: "updated", channel: dto });
  return { success: true, channel: dto };
});

app.delete("/api/channels/:id", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const channelId = Number((request.params as { id: string }).id);
  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { id: true, name: true, isDefault: true, directKey: true } });
  if (!channel) return reply.code(404).send({ success: false, message: "频道不存在" });
  if (channel.isDefault) return reply.code(400).send({ success: false, message: "默认频道不能删除" });
  if (channel.directKey) return reply.code(400).send({ success: false, message: "私聊请使用关闭私聊" });
  if (!(await canManageChannel(auth.accountId, channelId))) return reply.code(403).send({ success: false, message: "无权删除此频道" });

  const messages = await prisma.message.findMany({ where: { channelId }, select: { id: true, filePath: true } });
  const messageIds = messages.map((message) => message.id);
  if (messageIds.length) {
    await prisma.message.updateMany({ where: { replyToId: { in: messageIds } }, data: { replyToId: null } });
  }
  await prisma.channel.delete({ where: { id: channelId } });

  for (const attachment of messages) {
    if (!attachment.filePath) continue;
    const filePath = path.join(UPLOAD_DIR, path.basename(attachment.filePath));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  io.emit("channel:updated", { action: "deleted", channelId });
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
  const dto = await channelDto(channel.id);
  io.to(`acct:${auth.accountId}`).to(`acct:${body.accountId}`).emit("channel:updated", { action: "direct", channel: dto });
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
  if (!(await canAccessChannel(auth.accountId, channelId))) return reply.code(403).send({ success: false, message: "无权访问此频道" });
  const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { directKey: true, isPrivate: true } });
  const accounts = await prisma.account.findMany({
    where: channel?.directKey
      ? { memberships: { some: { channelId } } }
      : channel?.isPrivate
        ? { OR: [{ role: "admin" }, { memberships: { some: { channelId } } }] }
        : {},
    include: { actor: true, memberships: { where: { channelId } } },
    orderBy: { displayName: "asc" }
  });
  const virtuals = await prisma.virtualCharacter.findMany({ where: { enabled: true }, include: { actor: true }, orderBy: { id: "asc" } });
  return {
    members: [
      ...accounts.map((a) => ({
        id: a.actor?.id,
        accountId: a.id,
        kind: "human",
        username: a.username,
        displayName: a.displayName,
        avatarPath: a.avatarPath,
        role: a.role === "admin" ? "admin" : a.memberships[0]?.role || "member"
      })),
      ...virtuals.map((v) => ({
        id: v.actor.id,
        kind: "virtual",
        username: v.actor.username,
        displayName: v.actor.displayName,
        avatarPath: v.actor.avatarPath,
        role: "virtual"
      }))
    ]
  };
});

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
    include: { sender: true, replyTo: { include: { sender: true } } },
    orderBy: { id: after > 0 ? "asc" : "desc" },
    take: limit
  });
  const filteredRows = query.prayers === "1" ? rows.filter((message) => !isPrayerUpdateMessage(message)) : rows;
  const messages = await Promise.all((after > 0 ? filteredRows : filteredRows.reverse()).map((message) => serializeMessage(message, auth.accountId)));
  return { messages };
});

app.get("/api/link-preview", { preHandler: requireAuth }, async (request, reply) => {
  const query = request.query as { url?: string };
  try {
    const { html, url } = await fetchLinkPreviewHtml(String(query.url || ""));
    return parseLinkPreview(html, url);
  } catch (error) {
    return reply.code(400).send({ success: false, message: error instanceof Error ? error.message : "无法生成网页预览" });
  }
});

app.post("/api/messages", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
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
      chainVersion: version
    });
    if (!rootId) await prisma.message.update({ where: { id: created.id }, data: { chainRootId: created.id } });
    return { success: true, message: await hydrateMessage(created.id) };
  }
  const content = cleanText(body.content);
  if (!content.replace(/<[^>]*>/g, "").trim() && !/<br\s*\/?>/i.test(content)) return reply.code(400).send({ success: false, message: "消息不能为空" });
  if (body.type === "prayer") {
    const message = await createMessageFromActor({
      channelId: body.channelId,
      actorId: auth.actorId,
      content,
      type: "prayer",
      payload: cleanPrayerPayload(body.payload),
      replyToId: body.replyToId || null
    });
    return { success: true, message: await hydrateMessage(message.id, auth.accountId) };
  }
  const message = await createMessageFromActor({
    channelId: body.channelId,
    actorId: auth.actorId,
    content,
    type: "text",
    payload: cleanMessageEffect(body.payload),
    replyToId: body.replyToId || null
  });
  return { success: true, message: await hydrateMessage(message.id) };
});

app.post("/api/files/upload", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const file = await request.file();
  if (!file) return reply.code(400).send({ success: false, message: "缺少文件" });
  const fields = file.fields as Record<string, { value?: string }>;
  const channelId = Number(fields.channelId?.value || 0);
  if (!channelId || !(await canWriteChannel(auth.accountId, channelId))) return reply.code(403).send({ success: false, message: "无权上传" });
  const ext = path.extname(file.filename).toLowerCase();
  const allowed = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif", ".tif", ".tiff", ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".csv", ".zip", ".mp3", ".mp4", ".mov", ".webm", ".m4a", ".wav", ".ogg", ".aac"]);
  if (!allowed.has(ext)) return reply.code(400).send({ success: false, message: "不支持的文件类型" });
  const voicePayload = parseVoiceUploadPayload(fields, file.mimetype);
  const safeName = `${crypto.randomUUID()}${ext}`;
  const outPath = path.join(UPLOAD_DIR, safeName);
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createWriteStream(outPath);
    file.file.pipe(stream);
    file.file.on("error", reject);
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
  let storedFileName = safeName;
  let displayFileName = file.filename;
  let stat = fs.statSync(outPath);
  const isImageUpload = file.mimetype.startsWith("image/") && isImageFileName(file.filename);
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
  const type: MessageType = isImageUpload ? "image" : "file";
  const message = await createMessageFromActor({
    channelId,
    actorId: auth.actorId,
    content: "",
    type,
    payload: voicePayload,
    fileName: displayFileName,
    filePath: storedFileName,
    fileSize: stat.size
  });
  return { success: true, message: await hydrateMessage(message.id) };
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
  io.to(`ch:${message.channelId}`).emit("messages:refresh", { channelId: message.channelId });
  return { success: true, message: await hydrateMessage(messageId, auth.accountId) };
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
  io.to(`ch:${message.channelId}`).emit("messages:refresh", { channelId: message.channelId });
  return { success: true, message: await hydrateMessage(messageId, auth.accountId) };
});

app.post("/api/messages/:messageId/prayer-update", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const messageId = Number((request.params as { messageId: string }).messageId);
  const body = z.object({ content: z.string().max(10000).optional() }).parse(request.body || {});
  const message = await prisma.message.findUnique({ where: { id: messageId }, include: { sender: true } });
  if (!message || message.type !== "prayer") return reply.code(404).send({ success: false, message: "代祷事项不存在" });
  if (!(await canAccessChannel(auth.accountId, message.channelId))) return reply.code(403).send({ success: false, message: "无权访问此代祷" });
  const source = await canonicalPrayerMessage(message);
  const sourceSender = source.id === message.id ? message.sender : await prisma.actor.findUnique({ where: { id: source.senderActorId } });
  if (sourceSender?.accountId !== auth.accountId && !auth.isAdmin) return reply.code(403).send({ success: false, message: "只有发起者可以更新此代祷" });
  const content = cleanText(body.content ?? source.content ?? "");
  if (!content.replace(/<[^>]*>/g, "").trim() && !/<br\s*\/?>/i.test(content)) return reply.code(400).send({ success: false, message: "代祷内容不能为空" });
  const raw = prayerPayloadRaw(source.payload);
  const sourcePayload = {
    ...raw,
    kind: "prayer",
    latestUpdateAt: new Date().toISOString(),
    latestUpdateBy: auth.username
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
  void sendPrayerUpdatePush(updateMessage.id).catch((error) => app.log.warn({ error }, "prayer update push failed"));
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
  if (!(await canAccessChannel(auth.accountId, message.channelId))) return reply.code(403).send({ success: false, message: "无权访问此消息" });
  if (message.sender.accountId !== auth.accountId) return reply.code(403).send({ success: false, message: "只能撤回自己发送的消息" });
  if (Date.now() - message.createdAt.getTime() > 2 * 60 * 1000) return reply.code(409).send({ success: false, message: "只能撤回 2 分钟内的消息" });
  await prisma.$transaction([
    prisma.pinnedItem.updateMany({ where: { messageId }, data: { active: false, messageId: null } }),
    prisma.message.updateMany({ where: { replyToId: messageId }, data: { replyToId: null } }),
    prisma.voiceListen.deleteMany({ where: { messageId } }),
    prisma.prayerAction.deleteMany({ where: { messageId } }),
    prisma.messageAiSuggestion.deleteMany({ where: { messageId } }),
    prisma.message.update({
      where: { id: messageId },
      data: {
        type: "system",
        content: `${message.sender.displayName} 撤回了一条消息`,
        payload: { recalled: true },
        fileName: null,
        filePath: null,
        fileSize: null,
        chainRootId: null,
        chainVersion: null
      }
    })
  ]);
  if (message.filePath) safeUnlink("upload", message.filePath);
  const recalled = await hydrateMessage(messageId, auth.accountId);
  if (recalled) io.to(`ch:${message.channelId}`).emit("message:updated", recalled);
  io.to(`ch:${message.channelId}`).emit("messages:refresh", { channelId: message.channelId });
  return { success: true };
});

app.get("/api/files/:messageId", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const messageId = Number((request.params as { messageId: string }).messageId);
  const query = request.query as { download?: string };
  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message?.filePath) return reply.code(404).send({ success: false, message: "文件不存在" });
  if (!(await canAccessChannel(auth.accountId, message.channelId))) return reply.code(403).send({ success: false, message: "无权访问文件" });
  const filePath = path.join(UPLOAD_DIR, path.basename(message.filePath));
  if (!fs.existsSync(filePath)) return reply.code(404).send({ success: false, message: "文件不存在" });
  const stat = fs.statSync(filePath);
  const range = request.headers.range;
  const contentType = contentTypeForFile(message.filePath || message.fileName || "");
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("Accept-Ranges", "bytes");
  reply.header("Content-Type", contentType);
  reply.header("Content-Disposition", `${query.download === "1" ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(message.fileName || message.filePath)}`);
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
          "loginIconPath",
          "loginShowIcon",
          "loginTitle",
          "loginSubtitle",
          "loginShowSubtitle",
          "loginBackgroundPath",
          "loginBackgroundFit",
          "loginFormPosition",
          "registrationEnabled",
          "flashEffect",
          "customThemes"
        ]
      }
    }
  });
  const settings = new Map(rows.map((row) => [row.key, row.value]));
  const wallpaperFit = settings.get("wallpaperFit") || "cover";
  const loginBackgroundFit = settings.get("loginBackgroundFit") || "cover";
  const loginFormPosition = settings.get("loginFormPosition") || "middle";
  return {
    appTitle: settings.get("appTitle") || DEFAULT_APP_TITLE,
    appIconPath: settings.get("appIconPath") || null,
    wallpaperPath: settings.get("wallpaperPath") || null,
    wallpaperFit: WALLPAPER_FITS.has(wallpaperFit) ? wallpaperFit : "cover",
    loginIconPath: settings.get("loginIconPath") || null,
    loginShowIcon: settings.get("loginShowIcon") !== "false",
    loginTitle: settings.get("loginTitle") || DEFAULT_LOGIN_TITLE,
    loginSubtitle: settings.has("loginSubtitle") ? settings.get("loginSubtitle") || "" : DEFAULT_LOGIN_SUBTITLE,
    loginShowSubtitle: settings.get("loginShowSubtitle") !== "false",
    loginBackgroundPath: settings.get("loginBackgroundPath") || null,
    loginBackgroundFit: WALLPAPER_FITS.has(loginBackgroundFit) ? loginBackgroundFit : "cover",
    loginFormPosition: LOGIN_FORM_POSITIONS.has(loginFormPosition) ? loginFormPosition : "middle",
    registrationEnabled: settings.get("registrationEnabled") === "true",
    flashEffect: cleanFlashEffect(parseJsonField(settings.get("flashEffect"), DEFAULT_FLASH_EFFECT)),
    customThemes: cleanCustomThemes(parseJsonField(settings.get("customThemes"), []))
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
  const rows = await prisma.setting.findMany({ where: { key: { in: ["whyAssistantEnabled", "whyAssistantPromptCommand", "whyAssistantWebSearchEnabled"] } } });
  const settings = new Map(rows.map((row) => [row.key, row.value]));
  return {
    ...base,
    whyAssistantEnabled: settings.get("whyAssistantEnabled") !== "false",
    whyAssistantWebSearchEnabled: settings.get("whyAssistantWebSearchEnabled") !== "false",
    whyAssistantPromptCommand: settings.get("whyAssistantPromptCommand") || DEFAULT_WHY_ASSISTANT_PROMPT
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

async function callDeepSeekRelatedVerses(settings: AiSettingsDTO, apiKey: string, contextText: string) {
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
          { role: "system", content: settings.promptCommand },
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
    const references = parseAiVerseReferences(responseText);
    if (!references.length) throw new Error("DeepSeek did not return verse references");
    return { responseText, references };
  } finally {
    clearTimeout(timeout);
  }
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
      whyAssistantPromptCommand: z.string().max(6000).optional()
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
  resetAiSettingsCache();
  return aiSettingsDto();
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
    io.to(`ch:${message.channelId}`).emit("messages:refresh", { channelId: message.channelId });
    return { success: true, message: await hydrateMessage(messageId, auth.accountId) };
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

app.get("/api/bible/lookup", { preHandler: requireAuth }, async (request) => {
  const query = z.object({ reference: z.string().min(1).max(120) }).parse(request.query);
  try {
    const result: BibleLookupDTO = lookupBibleReference(query.reference);
    return { success: true, result };
  } catch {
    return { success: false, message: "暂时找不到这处经文" };
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
  const compressed = await compressImageFile(outPath, BG_DIR, { shortName });
  if (compressed) {
    fs.unlinkSync(outPath);
    return compressed.fileName;
  }
  return safeName;
}

app.get("/api/settings/appearance", async () => {
  return appearanceDto();
});

app.post("/api/admin/appearance", { preHandler: requireAdmin }, async (request) => {
  const body = z
    .object({
      wallpaperPath: z.string().nullable().optional(),
      appTitle: z.string().max(80).nullable().optional(),
      appIconPath: z.string().nullable().optional(),
      wallpaperFit: z.enum(["cover", "contain", "stretch", "repeat"]).optional(),
      loginIconPath: z.string().nullable().optional(),
      loginShowIcon: z.boolean().optional(),
      loginTitle: z.string().max(80).nullable().optional(),
      loginSubtitle: z.string().max(160).nullable().optional(),
      loginShowSubtitle: z.boolean().optional(),
      loginBackgroundPath: z.string().nullable().optional(),
      loginBackgroundFit: z.enum(["cover", "contain", "stretch", "repeat"]).optional(),
      loginFormPosition: z.enum(["top", "middle", "bottom"]).optional(),
      registrationEnabled: z.boolean().optional(),
      flashEffect: z.unknown().optional(),
      customThemes: z.array(z.unknown()).optional()
    })
    .parse(request.body);
  if (Object.prototype.hasOwnProperty.call(body, "appTitle")) await setSetting("appTitle", (body.appTitle || "").trim() || DEFAULT_APP_TITLE);
  if (Object.prototype.hasOwnProperty.call(body, "appIconPath")) await setSetting("appIconPath", body.appIconPath || "");
  if (Object.prototype.hasOwnProperty.call(body, "wallpaperPath")) await setSetting("wallpaperPath", body.wallpaperPath || "");
  if (Object.prototype.hasOwnProperty.call(body, "wallpaperFit")) await setSetting("wallpaperFit", body.wallpaperFit || "cover");
  if (Object.prototype.hasOwnProperty.call(body, "loginIconPath")) await setSetting("loginIconPath", body.loginIconPath || "");
  if (Object.prototype.hasOwnProperty.call(body, "loginShowIcon")) await setSetting("loginShowIcon", body.loginShowIcon ? "true" : "false");
  if (Object.prototype.hasOwnProperty.call(body, "loginTitle")) await setSetting("loginTitle", (body.loginTitle || "").trim() || DEFAULT_LOGIN_TITLE);
  if (Object.prototype.hasOwnProperty.call(body, "loginSubtitle")) await setSetting("loginSubtitle", (body.loginSubtitle || "").trim());
  if (Object.prototype.hasOwnProperty.call(body, "loginShowSubtitle")) await setSetting("loginShowSubtitle", body.loginShowSubtitle ? "true" : "false");
  if (Object.prototype.hasOwnProperty.call(body, "loginBackgroundPath")) await setSetting("loginBackgroundPath", body.loginBackgroundPath || "");
  if (Object.prototype.hasOwnProperty.call(body, "loginBackgroundFit")) await setSetting("loginBackgroundFit", body.loginBackgroundFit || "cover");
  if (Object.prototype.hasOwnProperty.call(body, "loginFormPosition")) await setSetting("loginFormPosition", body.loginFormPosition || "middle");
  if (Object.prototype.hasOwnProperty.call(body, "registrationEnabled")) await setSetting("registrationEnabled", body.registrationEnabled ? "true" : "false");
  if (Object.prototype.hasOwnProperty.call(body, "flashEffect")) await setSetting("flashEffect", JSON.stringify(cleanFlashEffect(body.flashEffect)));
  if (Object.prototype.hasOwnProperty.call(body, "customThemes")) await setSetting("customThemes", JSON.stringify(cleanCustomThemes(body.customThemes)));
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

function storageFilePath(kind: AdminAttachmentDTO["kind"], fileName: string) {
  const dir = kind === "upload" ? UPLOAD_DIR : kind === "avatar" ? AVATAR_DIR : BG_DIR;
  return path.join(dir, path.basename(fileName));
}

function attachmentId(kind: AdminAttachmentDTO["kind"], fileName: string) {
  return `${kind}:${path.basename(fileName)}`;
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

async function activePinnedUsesUpload(fileName: string) {
  const target = path.basename(fileName);
  const pins = await prisma.pinnedItem.findMany({ where: { active: true }, select: { body: true, content: true } });
  return pins.some((pin) => pinnedBodyUploadFilePaths(serializePinnedBody(pin.body, pin.content)).has(target));
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
  return raw.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

async function detachMessageAttachments(messages: Array<Pick<Message, "id" | "channelId" | "filePath">>) {
  const ids = messages.map((message) => message.id);
  const channelIds = [...new Set(messages.map((message) => message.channelId))];
  for (const message of messages) {
    if (message.filePath && !(await activePinnedUsesUpload(message.filePath))) safeUnlink("upload", message.filePath);
  }
  if (ids.length) {
    await prisma.$transaction([
      prisma.voiceListen.deleteMany({ where: { messageId: { in: ids } } }),
      prisma.prayerAction.deleteMany({ where: { messageId: { in: ids } } }),
      prisma.message.updateMany({
        where: { id: { in: ids } },
        data: { type: "text", content: "[附件已由管理员删除]", payload: Prisma.JsonNull, fileName: null, filePath: null, fileSize: null }
      })
    ]);
  }
  for (const channelId of channelIds) io.to(`ch:${channelId}`).emit("messages:refresh", { channelId });
  return ids.length;
}

async function deleteMessages(messages: Array<Pick<Message, "id" | "channelId" | "filePath">>) {
  const ids = messages.map((message) => message.id);
  const channelIds = [...new Set(messages.map((message) => message.channelId))];
  if (!ids.length) return 0;
  await prisma.$transaction([
    prisma.pinnedItem.updateMany({ where: { messageId: { in: ids } }, data: { active: false, messageId: null } }),
    prisma.message.updateMany({ where: { replyToId: { in: ids } }, data: { replyToId: null } }),
    prisma.voiceListen.deleteMany({ where: { messageId: { in: ids } } }),
    prisma.prayerAction.deleteMany({ where: { messageId: { in: ids } } }),
    prisma.messageAiSuggestion.deleteMany({ where: { messageId: { in: ids } } }),
    prisma.message.deleteMany({ where: { id: { in: ids } } })
  ]);
  for (const message of messages) {
    if (message.filePath && !(await activePinnedUsesUpload(message.filePath))) safeUnlink("upload", message.filePath);
  }
  for (const channelId of channelIds) io.to(`ch:${channelId}`).emit("messages:refresh", { channelId });
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
      url: undefined,
      usage: []
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
      url: `/api/files/${message.id}`,
      messageId: message.id,
      channelName: message.channel.name,
      ownerName: message.sender.displayName,
      usage: [`消息 #${message.id}`, message.channel.name, message.sender.displayName]
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
        url: current?.url || `/api/channels/${pin.channelId}/pinned/files/${encodeURIComponent(fileName)}`,
        messageId: current?.messageId,
        channelName: current?.channelName || pin.channel.name,
        ownerName: current?.ownerName,
        usage
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
      url: `/avatars/${encodeURIComponent(file.name)}`,
      usage
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
      url: `/backgrounds/${encodeURIComponent(file.name)}`,
      usage
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
    void sendPinnedPush(channelId, { title: created.title, body: pinnedBody }).catch((error) => app.log.warn({ error }, "pinned push failed"));
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

app.get("/api/channels/:id/pinned/files/:file", { preHandler: requireAuth }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const channelId = Number((request.params as { id: string }).id);
  const file = path.basename((request.params as { file: string }).file);
  if (!file || !(await canAccessChannel(auth.accountId, channelId))) return reply.code(403).send({ success: false, message: "无权访问文件" });
  const pin = await prisma.pinnedItem.findFirst({ where: { channelId, active: true }, orderBy: { updatedAt: "desc" } });
  if (!pin || !pinnedBodyUploadFilePaths(serializePinnedBody(pin.body, pin.content)).has(file)) return reply.code(404).send("Not found");
  const filePath = path.join(UPLOAD_DIR, file);
  if (!fs.existsSync(filePath)) return reply.code(404).send("Not found");
  reply.header("Cache-Control", "private, max-age=86400");
  reply.header("Content-Type", contentTypeForFile(file));
  return reply.send(fs.createReadStream(filePath));
});

app.get("/api/admin/accounts", { preHandler: requireAdmin }, async () => {
  const accounts = await prisma.account.findMany({ include: { actor: true }, orderBy: { id: "asc" } });
  return { accounts: accounts.map((a) => authDto(a)) };
});

app.post("/api/admin/accounts", { preHandler: requireAdmin }, async (request, reply) => {
  const body = z
    .object({
      username: z.string().regex(/^[a-zA-Z0-9_.-]{2,40}$/),
      password: z.string().min(6),
      displayName: z.string().min(1).max(80),
      isAdmin: z.boolean().optional(),
      canPinMessages: z.boolean().optional()
    })
    .parse(request.body);
  try {
    const account = await prisma.account.create({
      data: {
        username: body.username,
        passwordHash: await bcrypt.hash(body.password, 12),
        displayName: body.displayName,
        role: body.isAdmin ? "admin" : "user",
        canPinMessages: !!body.canPinMessages,
        actor: { create: { kind: "human", username: body.username, displayName: body.displayName } }
      },
      include: { actor: true }
    });
    const publicChannels = await prisma.channel.findMany({ where: { isPrivate: false }, select: { id: true } });
    await prisma.channelMember.createMany({ data: publicChannels.map((c) => ({ channelId: c.id, accountId: account.id, role: "member" })), skipDuplicates: true });
    return { success: true, account: authDto(account) };
  } catch {
    return reply.code(409).send({ success: false, message: "用户名已存在" });
  }
});

app.patch("/api/admin/accounts/:id", { preHandler: requireAdmin }, async (request, reply) => {
  const auth = (request as AuthedRequest).auth;
  const id = Number((request.params as { id: string }).id);
  const body = z
    .object({
      displayName: z.string().min(1).max(80).optional(),
      isAdmin: z.boolean().optional(),
      canPinMessages: z.boolean().optional(),
      password: z.string().min(6).optional(),
      avatarPath: z.string().max(255).nullable().optional()
    })
    .parse(request.body);
  const current = await prisma.account.findUnique({ where: { id }, include: { actor: true } });
  if (!current) return reply.code(404).send({ success: false, message: "用户不存在" });
  if (body.isAdmin === false) {
    if (id === auth.accountId) return reply.code(400).send({ success: false, message: "不能取消自己的管理员权限" });
    const otherAdmins = await prisma.account.count({ where: { role: "admin", id: { not: id } } });
    if (!otherAdmins) return reply.code(400).send({ success: false, message: "至少需要保留一个管理员" });
  }
  const updated = await prisma.account.update({
    where: { id },
    data: {
      displayName: body.displayName,
      avatarPath: body.avatarPath === undefined ? undefined : body.avatarPath || null,
      role: body.isAdmin === undefined ? undefined : body.isAdmin ? "admin" : "user",
      canPinMessages: body.canPinMessages,
      passwordHash: body.password ? await bcrypt.hash(body.password, 12) : undefined,
      actor:
        body.displayName || body.avatarPath !== undefined
          ? {
              update: {
                displayName: body.displayName,
                avatarPath: body.avatarPath === undefined ? undefined : body.avatarPath || null
              }
            }
          : undefined
    },
    include: { actor: true }
  });
  if (body.password) {
    const sessionsToRevoke = await prisma.accountSession.findMany({
      where: { accountId: id, revokedAt: null, ...(id === auth.accountId ? { id: { not: auth.sessionId } } : {}) },
      select: { id: true, deviceKind: true, deviceName: true, ipAddress: true, userAgent: true }
    });
    const revokedAt = new Date();
    await prisma.accountSession.updateMany({
      where: { id: { in: sessionsToRevoke.map((session) => session.id) } },
      data: { revokedAt }
    });
    await Promise.all(sessionsToRevoke.map((session) => writeLoginLog("session_revoked", id, session, revokedAt)));
    disconnectSessions(sessionsToRevoke.map((session) => session.id));
  }
  refreshAccountConnections(updated);
  return { success: true, account: authDto(updated) };
});

app.post("/api/admin/accounts/:id/avatar", { preHandler: requireAdmin }, async (request, reply) => {
  const id = Number((request.params as { id: string }).id);
  const account = await prisma.account.findUnique({ where: { id } });
  if (!account) return reply.code(404).send({ success: false, message: "用户不存在" });
  const file = await request.file();
  if (!file) return reply.code(400).send({ success: false, message: "缺少头像图片" });
  const ext = path.extname(file.filename).toLowerCase();
  const allowed = IMAGE_EXTENSIONS;
  if (!allowed.has(ext) || !file.mimetype.startsWith("image/")) return reply.code(400).send({ success: false, message: "只支持图片头像" });
  const safeName = `${crypto.randomUUID()}${ext}`;
  const outPath = path.join(AVATAR_DIR, safeName);
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createWriteStream(outPath);
    file.file.pipe(stream);
    file.file.on("error", reject);
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
  let avatarPath = safeName;
  const compressed = await compressImageFile(outPath, AVATAR_DIR);
  if (compressed) {
    fs.unlinkSync(outPath);
    avatarPath = compressed.fileName;
  }
  const updated = await prisma.account.update({
    where: { id },
    data: { avatarPath, actor: { update: { avatarPath } } },
    include: { actor: true }
  });
  refreshAccountConnections(updated);
  return { success: true, account: authDto(updated) };
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
    replyPolicy: { mode: "external_engine_decides", allowSkip: true, allowMultipleMessages: true },
    proactivePolicy: { enabled: false, idleMinutes: 30 },
    typing: { show: true, minMs: 800, maxMs: 8000 },
    memory: { rememberUsers: true, maxItemsPerUser: 50 },
    modelHints: { provider: "deepseek", compatibleEndpoint: "/chat/completions", preferredModels: ["deepseek-v4-flash", "deepseek-v4-pro"] }
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
  if (wasOffline) await writeLoginLog("presence_join", account.id, session);
  const channels = await prisma.channel.findMany({
    where: auth.isAdmin
      ? { OR: [{ kind: { not: "why" as const }, directKey: null }, { members: { some: { accountId: auth.accountId } } }] }
      : { OR: [{ kind: { not: "why" as const }, isPrivate: false }, { members: { some: { accountId: auth.accountId } } }] },
    select: { id: true }
  });
  channels.forEach((ch) => socket.join(`ch:${ch.id}`));
  await broadcastPresence();

  socket.on("channel:join", async (data: { channelId: number }) => {
    const currentAuth = await refreshSocketAuth(socket);
    if (!currentAuth) return;
    if (await canAccessChannel(currentAuth.accountId, Number(data.channelId))) socket.join(`ch:${Number(data.channelId)}`);
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
      const content = cleanText(body.content);
      if (!content.replace(/<[^>]*>/g, "").trim() && !/<br\s*\/?>/i.test(content)) return ack?.({ success: false, message: "消息不能为空" });
      const message = await createMessageFromActor({
        channelId: body.channelId,
        actorId: currentAuth.actorId,
        content,
        type: body.type,
        payload: body.type === "prayer" ? cleanPrayerPayload(body.payload) : cleanMessageEffect(body.payload),
        replyToId: body.replyToId || null
      });
      ack?.({ success: true, messageId: message.id, message: await hydrateMessage(message.id, currentAuth.accountId) });
    } catch (error) {
      ack?.({ success: false, message: error instanceof Error ? error.message : "发送失败" });
    }
  });

  socket.on("message:typing", async (data: { channelId: number; state: "start" | "stop" }) => {
    const currentAuth = await refreshSocketAuth(socket);
    if (!currentAuth || !(await canAccessChannel(currentAuth.accountId, Number(data.channelId)))) return;
    const actor = await prisma.actor.findUnique({ where: { id: currentAuth.actorId } });
    if (!actor) return;
    socket.to(`ch:${Number(data.channelId)}`).emit("message:typing", {
      channelId: Number(data.channelId),
      actor: { id: actor.id, username: actor.username, displayName: actor.displayName, kind: "human" },
      state: data.state
    });
  });

  socket.on("disconnect", async () => {
    online.delete(socket.id);
    const set = accountSocketIds.get(account.id);
    let isOffline = false;
    if (set) {
      set.delete(socket.id);
      if (!set.size) {
        accountSocketIds.delete(account.id);
        isOffline = true;
      }
    }
    if (isOffline) await writeLoginLog("presence_leave", account.id, session);
    await broadcastPresence();
  });
});

app.setNotFoundHandler((request, reply) => {
  if (request.url.startsWith("/api/")) return reply.code(404).send({ success: false, message: "Not found" });
  const indexPath = path.join(DIST_CLIENT, "index.html");
  if (fs.existsSync(indexPath)) return reply.type("text/html").send(fs.createReadStream(indexPath));
  return reply.code(404).send("Client build not found");
});

process.on("SIGTERM", async () => {
  io.close();
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
});

await ensureBootstrap();
await ensureWebPush();
await app.listen({ port: PORT, host: "0.0.0.0" });
