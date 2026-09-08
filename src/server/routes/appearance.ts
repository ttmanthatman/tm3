import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import sharp from "sharp";
import { z } from "zod";
import type { FlashEffectSettingsDTO, ThemeDTO, ThemePaletteDTO } from "../../shared/types.js";
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
} from "../../shared/composerPrompts.js";
import { cleanParallaxKits, cleanParallaxSpeed } from "../../shared/parallax.js";
import {
  MUSIC_PANEL_FONT_SIZE_MAX,
  MUSIC_PANEL_FONT_SIZE_MIN,
  cleanMusicPanelFontSize
} from "../../shared/musicPlayback.js";
import {
  WALLPAPER_PAN_SPEED_MAX,
  WALLPAPER_PAN_SPEED_MIN,
  cleanWallpaperPanDirection,
  cleanWallpaperPanFocusX,
  cleanWallpaperPanSpeed
} from "../../shared/wallpaperPan.js";
import { compressImageFile, IMAGE_EXTENSIONS, shortStorageFileName, validateStoredImage } from "../imageProcessing.js";
import { parseJsonField } from "../textUtils.js";
import { BG_DIR, PARALLAX_DIR, safeUnlink } from "../storageDirs.js";

export const THEMES = new Set(["wechat", "jade", "paper", "night"]);
const WALLPAPER_FITS = new Set(["cover", "contain", "stretch", "repeat", "pan"]);
const LOGIN_BACKGROUND_FITS = new Set(["cover", "contain", "stretch", "repeat"]);
const LOGIN_FORM_POSITIONS = new Set(["top", "middle", "bottom"]);
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

export function cleanHexColor(input: unknown, fallback: string) {
  const value = String(input || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : fallback;
}

export function cleanThemeId(input: unknown) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 32)
    .replace(/^-|-$/g, "");
}

export function cleanThemePalette(input: unknown): ThemePaletteDTO {
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

export function cleanFlashEffect(input: unknown): FlashEffectSettingsDTO {
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

export function cleanCustomThemes(input: unknown): ThemeDTO[] {
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

export type AppearanceService = ReturnType<typeof createAppearanceService>;

export function createAppearanceService(deps: { prisma: PrismaClient }) {
  const { prisma } = deps;

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

  async function themeExists(theme: string) {
    if (THEMES.has(theme)) return true;
    const customThemes = await customThemesSetting();
    return customThemes.some((item) => item.id === theme);
  }

  return { appearanceDto, setSetting, settingBool, customThemesSetting, themeExists };
}

export async function saveImageUpload(request: FastifyRequest, reply: FastifyReply, missingMessage: string, shortName = false) {
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

export type AppearanceRouteDependencies = {
  requireAdmin: preHandlerHookHandler;
  appearance: AppearanceService;
  io: { emit(event: string, payload: unknown): unknown };
  applyFileValidation(request: FastifyRequest, reply: FastifyReply, stat: fs.Stats): boolean;
};

export function registerAppearanceRoutes(app: FastifyInstance, deps: AppearanceRouteDependencies) {
  const { requireAdmin, appearance, io, applyFileValidation } = deps;
  const { appearanceDto, setSetting } = appearance;

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
}
