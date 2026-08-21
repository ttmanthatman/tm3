import path from "node:path";
import { z } from "zod";

export interface Point {
  x: number;
  y: number;
}

export interface Rectangle extends Point {
  width: number;
  height: number;
}

export interface X11DriverConfig {
  display: string;
  windowClass: string;
  windowTitle: string;
  windowWidth: number;
  windowHeight: number;
  anchorPath: string;
  anchorRegion: Rectangle;
  inputPoint: Point;
  messageRegion: Rectangle;
  anchorMaxDifference: number;
  messageMinDifference: number;
  pasteWaitMs: number;
  postSendWaitMs: number;
}

export interface RelayConfig {
  baseUrl: string;
  agentToken: string;
  username: string;
  password: string;
  channelId: number;
  targetGroup: string;
  databasePath: string;
  pollIntervalMs: number;
  idleIntervalMs: number;
  minSendIntervalMs: number;
  retryBaseMs: number;
  maxAttempts: number;
  maxMessageAgeMs: number;
  driver: "dry-run" | "x11";
  x11: X11DriverConfig;
}

const envSchema = z.object({
  RELAY_BASE_URL: z.string().url(),
  RELAY_AGENT_TOKEN: z.string().default(""),
  RELAY_USERNAME: z.string().default(""),
  RELAY_PASSWORD: z.string().default(""),
  RELAY_CHANNEL_ID: z.coerce.number().int().nonnegative().default(0),
  RELAY_TARGET_GROUP: z.string().default(""),
  RELAY_DATABASE_PATH: z.string().default("storage/wechat-relay/relay.sqlite"),
  RELAY_POLL_INTERVAL_MS: z.coerce.number().int().min(5000).max(300000).default(30000),
  RELAY_IDLE_INTERVAL_MS: z.coerce.number().int().min(100).max(10000).default(500),
  RELAY_MIN_SEND_INTERVAL_MS: z.coerce.number().int().min(1000).max(300000).default(5000),
  RELAY_RETRY_BASE_MS: z.coerce.number().int().min(1000).max(3600000).default(30000),
  RELAY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(5),
  RELAY_MAX_MESSAGE_AGE_MS: z.coerce.number().int().min(60000).max(2592000000).default(43200000),
  RELAY_DRIVER: z.enum(["dry-run", "x11"]).default("dry-run"),
  RELAY_ALLOW_HTTP_SOURCE: z.enum(["0", "1"]).default("0"),
  DISPLAY: z.string().default(":0"),
  RELAY_X11_WINDOW_CLASS: z.string().default("wechat"),
  RELAY_X11_WINDOW_TITLE: z.string().default("微信"),
  RELAY_X11_WINDOW_WIDTH: z.coerce.number().int().min(800).max(4096).default(1280),
  RELAY_X11_WINDOW_HEIGHT: z.coerce.number().int().min(600).max(2160).default(720),
  RELAY_X11_ANCHOR_PATH: z.string().default("storage/wechat-relay/target-anchor.png"),
  RELAY_X11_ANCHOR_REGION: z.string().default("420,20,440,70"),
  RELAY_X11_INPUT_POINT: z.string().default("820,650"),
  RELAY_X11_MESSAGE_REGION: z.string().default("330,100,900,470"),
  RELAY_X11_ANCHOR_MAX_DIFFERENCE: z.coerce.number().min(0).max(1).default(0.06),
  RELAY_X11_MESSAGE_MIN_DIFFERENCE: z.coerce.number().min(0).max(1).default(0.01),
  RELAY_X11_PASTE_WAIT_MS: z.coerce.number().int().min(100).max(10000).default(500),
  RELAY_X11_POST_SEND_WAIT_MS: z.coerce.number().int().min(500).max(30000).default(2500)
});

function absolutePath(value: string) {
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

function parseNumbers(value: string, expected: number, name: string) {
  const values = value.split(",").map((part) => Number(part.trim()));
  if (values.length !== expected || values.some((item) => !Number.isInteger(item) || item < 0)) {
    throw new Error(`${name} must contain ${expected} comma-separated non-negative integers`);
  }
  return values;
}

export function parsePoint(value: string, name = "point"): Point {
  const [x, y] = parseNumbers(value, 2, name);
  return { x, y };
}

export function parseRectangle(value: string, name = "rectangle"): Rectangle {
  const [x, y, width, height] = parseNumbers(value, 4, name);
  if (width <= 0 || height <= 0) throw new Error(`${name} width and height must be positive`);
  return { x, y, width, height };
}

export function loadRelayConfig(input: NodeJS.ProcessEnv = process.env): RelayConfig {
  const env = envSchema.parse(input);
  if (!env.RELAY_AGENT_TOKEN && (!env.RELAY_USERNAME || !env.RELAY_PASSWORD || !env.RELAY_CHANNEL_ID)) {
    throw new Error("Set RELAY_AGENT_TOKEN or the legacy relay account and channel settings");
  }
  const baseUrl = new URL(env.RELAY_BASE_URL);
  if (baseUrl.protocol !== "https:" && env.RELAY_ALLOW_HTTP_SOURCE !== "1") {
    throw new Error("RELAY_BASE_URL must use HTTPS unless RELAY_ALLOW_HTTP_SOURCE=1");
  }
  baseUrl.pathname = baseUrl.pathname.replace(/\/$/, "");
  baseUrl.search = "";
  baseUrl.hash = "";

  return {
    baseUrl: baseUrl.toString().replace(/\/$/, ""),
    agentToken: env.RELAY_AGENT_TOKEN,
    username: env.RELAY_USERNAME,
    password: env.RELAY_PASSWORD,
    channelId: env.RELAY_CHANNEL_ID,
    targetGroup: env.RELAY_TARGET_GROUP,
    databasePath: absolutePath(env.RELAY_DATABASE_PATH),
    pollIntervalMs: env.RELAY_POLL_INTERVAL_MS,
    idleIntervalMs: env.RELAY_IDLE_INTERVAL_MS,
    minSendIntervalMs: env.RELAY_MIN_SEND_INTERVAL_MS,
    retryBaseMs: env.RELAY_RETRY_BASE_MS,
    maxAttempts: env.RELAY_MAX_ATTEMPTS,
    maxMessageAgeMs: env.RELAY_MAX_MESSAGE_AGE_MS,
    driver: env.RELAY_DRIVER,
    x11: {
      display: env.DISPLAY,
      windowClass: env.RELAY_X11_WINDOW_CLASS,
      windowTitle: env.RELAY_X11_WINDOW_TITLE,
      windowWidth: env.RELAY_X11_WINDOW_WIDTH,
      windowHeight: env.RELAY_X11_WINDOW_HEIGHT,
      anchorPath: absolutePath(env.RELAY_X11_ANCHOR_PATH),
      anchorRegion: parseRectangle(env.RELAY_X11_ANCHOR_REGION, "RELAY_X11_ANCHOR_REGION"),
      inputPoint: parsePoint(env.RELAY_X11_INPUT_POINT, "RELAY_X11_INPUT_POINT"),
      messageRegion: parseRectangle(env.RELAY_X11_MESSAGE_REGION, "RELAY_X11_MESSAGE_REGION"),
      anchorMaxDifference: env.RELAY_X11_ANCHOR_MAX_DIFFERENCE,
      messageMinDifference: env.RELAY_X11_MESSAGE_MIN_DIFFERENCE,
      pasteWaitMs: env.RELAY_X11_PASTE_WAIT_MS,
      postSendWaitMs: env.RELAY_X11_POST_SEND_WAIT_MS
    }
  };
}
