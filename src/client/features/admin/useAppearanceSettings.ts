import { computed, ref, type Ref } from "vue";
import type {
  AdminAttachmentDTO,
  AppearanceDTO,
  FlashEffectSettingsDTO,
  ParallaxKitDTO,
  ParallaxLayerDTO,
  ThemeDTO,
  ThemePaletteDTO
} from "@shared/types";
import { api, authHeaders } from "../../api";
import { randomId } from "../../randomId";
import { useChatStore } from "../../store";
import { DEFAULT_PARALLAX_KITS, cleanParallaxKits, cleanParallaxSpeed, parallaxKit } from "../../parallax";
import {
  cleanWallpaperPanDirection,
  cleanWallpaperPanFocusX,
  cleanWallpaperPanSpeed,
  type WallpaperPanDirection
} from "@shared/wallpaperPan";
import { cleanMusicPanelFontSize } from "@shared/musicPlayback";
import {
  DEFAULT_COMPOSER_PROMPT_APPEAR,
  DEFAULT_COMPOSER_PROMPT_DISAPPEAR,
  DEFAULT_COMPOSER_PROMPT_GAP,
  DEFAULT_COMPOSER_PROMPT_INTERVAL,
  cleanComposerPromptAppearSeconds,
  cleanComposerPromptDisappearSeconds,
  cleanComposerPromptGapSeconds,
  cleanComposerPromptIntervalSeconds,
  cleanComposerPrompts
} from "@shared/composerPrompts";
import { themeSlug } from "./adminFormat";

export type WallpaperFit = AppearanceDTO["wallpaperFit"];
export type LoginBackgroundFit = AppearanceDTO["loginBackgroundFit"];
export type LoginFormPosition = AppearanceDTO["loginFormPosition"];
export type AppearanceSection = "brand" | "login" | "chat" | "parallax" | "themes" | "flash";
export type AppearanceImageField = "appIconPath" | "loginIconPath" | "loginBackgroundPath" | "wallpaperPath";
export type AppearanceFitField = "loginBackgroundFit" | "wallpaperFit";

export const defaultPalette: ThemePaletteDTO = {
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
export const builtInThemes: ThemeDTO[] = [
  { id: "wechat", name: "微信绿", palette: { ...defaultPalette } },
  {
    id: "jade",
    name: "竹影",
    palette: {
      ...defaultPalette,
      accent: "#0f8f72",
      accentDark: "#0a6f5d",
      bg: "#e8efed",
      chatBg: "#edf4f1",
      panel: "#f7faf8",
      line: "#cfded9",
      text: "#13201d",
      muted: "#64756f",
      bubbleOther: "#ffffff",
      bubbleMine: "#bfead8"
    }
  },
  {
    id: "paper",
    name: "纸墨",
    palette: {
      ...defaultPalette,
      accent: "#33658a",
      accentDark: "#274c68",
      bg: "#f1f0ea",
      chatBg: "#f6f5ef",
      panel: "#fbfaf6",
      line: "#ddd8ca",
      text: "#202124",
      muted: "#6f6a61",
      bubbleOther: "#ffffff",
      bubbleMine: "#d7e7f3"
    }
  },
  {
    id: "night",
    name: "夜航",
    palette: {
      ...defaultPalette,
      accent: "#35a7ff",
      accentDark: "#1e7ec4",
      buttonText: "#07131f",
      bg: "#171b20",
      chatBg: "#1d232a",
      panel: "#222932",
      line: "#3a4450",
      text: "#f5f7fa",
      muted: "#a8b3bf",
      bubbleOther: "#2c343e",
      bubbleOtherText: "#f5f7fa",
      bubbleMine: "#245d82",
      bubbleMineText: "#ffffff"
    }
  }
];
export const colorFields: Array<{ key: keyof ThemePaletteDTO; label: string }> = [
  { key: "accent", label: "按钮颜色" },
  { key: "accentDark", label: "按钮按下" },
  { key: "buttonText", label: "按钮文字" },
  { key: "bubbleMine", label: "我的气泡背景" },
  { key: "bubbleMineText", label: "我的气泡文字" },
  { key: "bubbleOther", label: "对方气泡背景" },
  { key: "bubbleOtherText", label: "对方气泡文字" },
  { key: "bg", label: "页面背景" },
  { key: "chatBg", label: "聊天区背景" },
  { key: "panel", label: "面板背景" },
  { key: "text", label: "主文字" },
  { key: "muted", label: "辅助文字" },
  { key: "line", label: "边框线" }
];
export const primaryColorFieldKeys = new Set<keyof ThemePaletteDTO>(["accent", "bubbleMine", "bubbleOther", "chatBg", "text"]);
export const primaryColorFields = colorFields.filter((field) => primaryColorFieldKeys.has(field.key));

export const wallpaperFitOptions: Array<{ value: WallpaperFit; label: string }> = [
  { value: "cover", label: "填满" },
  { value: "contain", label: "适合" },
  { value: "stretch", label: "拉伸" },
  { value: "repeat", label: "平铺" },
  { value: "pan", label: "推拉摇移" }
];
export const loginBackgroundFitOptions = wallpaperFitOptions.filter((option): option is { value: LoginBackgroundFit; label: string } => option.value !== "pan");
export const loginPositionOptions: Array<{ value: LoginFormPosition; label: string }> = [
  { value: "top", label: "上" },
  { value: "middle", label: "中" },
  { value: "bottom", label: "下" }
];
export const appearanceSections: Array<{ id: AppearanceSection; label: string; description: string }> = [
  { id: "brand", label: "品牌与标签页", description: "浏览器标题和站点图标" },
  { id: "login", label: "登录页", description: "登录内容、背景和入口" },
  { id: "chat", label: "聊天室", description: "聊天壁纸和显示方式" },
  { id: "parallax", label: "卷轴背景", description: "随消息阅读方向横向移动的多层景色" },
  { id: "themes", label: "主题颜色", description: "成员可选的自定义主题" },
  { id: "flash", label: "闪动特效", description: "/闪动 消息的颜色节奏" }
];

export interface AppearanceStyleHelpers {
  wallpaperUrl: (path?: string | null) => string;
  paletteStyle: (palette: ThemePaletteDTO) => Record<string, string>;
  wallpaperFitStyle: (fit?: WallpaperFit | null) => { size: string; repeat: string };
  readableTextColor: (hex: string) => string;
  cleanFlashEffectSettings: (input?: FlashEffectSettingsDTO | null) => FlashEffectSettingsDTO;
}

interface UseAppearanceSettingsOptions extends AppearanceStyleHelpers {
  adminMsg: Ref<string>;
  adminAttachments: Ref<AdminAttachmentDTO[]>;
  loadAdminAttachments: () => Promise<void>;
  authMode: Ref<"login" | "register" | "reception">;
  activePalette: () => ThemePaletteDTO;
  flashEffect: () => FlashEffectSettingsDTO;
  flashEffectStep: Ref<number>;
}

export function useAppearanceSettings(options: UseAppearanceSettingsOptions) {
  const store = useChatStore();
  const { adminMsg } = options;

  const appearanceSection = ref<AppearanceSection>("brand");
  const appearancePreviewOpen = ref(false);
  const appearanceThemeAdvancedOpen = ref(false);
  const appearanceImagePicker = ref<{ field: AppearanceImageField; title: string; fitField?: AppearanceFitField; hint: string } | null>(null);
  const loginAppearanceEdit = ref({
    appTitle: "Team Chat",
    appIconPath: null as string | null,
    loginTitle: "Team Chat",
    loginSubtitle: "轻快、稳定的团队聊天。",
    loginIconPath: null as string | null,
    loginShowIcon: true,
    loginShowSubtitle: true,
    loginBackgroundPath: null as string | null,
    loginFormPosition: "middle" as LoginFormPosition,
    loginBackgroundFit: "cover" as LoginBackgroundFit,
    wallpaperPath: null as string | null,
    wallpaperFit: "cover" as WallpaperFit,
    wallpaperPanFocusX: 0.5,
    wallpaperPanDirection: "left" as WallpaperPanDirection,
    wallpaperPanSpeed: 0.18,
    parallaxKit: "none",
    parallaxSpeed: 1,
    parallaxKits: cleanParallaxKits(DEFAULT_PARALLAX_KITS),
    registrationEnabled: false,
    musicPanelFontSize: 20,
    prayerBubbleMineColor: "#f0fbf1",
    prayerBubbleOtherColor: "#fffaf0"
  });
  const flashEffectEdit = ref<FlashEffectSettingsDTO>({
    colors: ["#fff176", "#ef4444", "#60a5fa", "#6d28d9", "#34d399", "#111827"],
    intervalSeconds: 0.4,
    transitionMode: "smooth"
  });
  const composerPromptsText = ref("");
  const composerPromptIntervalEdit = ref(DEFAULT_COMPOSER_PROMPT_INTERVAL);
  const composerPromptAppearEdit = ref(DEFAULT_COMPOSER_PROMPT_APPEAR);
  const composerPromptDisappearEdit = ref(DEFAULT_COMPOSER_PROMPT_DISAPPEAR);
  const composerPromptGapEdit = ref(DEFAULT_COMPOSER_PROMPT_GAP);
  const customThemesDraft = ref<ThemeDTO[]>([]);
  const customThemeEdit = ref<ThemeDTO>({ id: "", name: "我的主题", palette: { ...defaultPalette } });
  const parallaxLayerInput = ref<HTMLInputElement | null>(null);
  const parallaxLayerUploadBusy = ref(false);

  const backgroundAttachmentOptions = computed(() => options.adminAttachments.value.filter((item) => item.kind === "background" && item.exists && item.url));
  const activeAppearanceSection = computed(() => appearanceSections.find((section) => section.id === appearanceSection.value) || appearanceSections[0]);
  const appearanceDraftIcon = computed(() => loginAppearanceEdit.value.appIconPath ? options.wallpaperUrl(loginAppearanceEdit.value.appIconPath) : "/images/icon-192.svg");
  const appearanceDraftLoginIcon = computed(() => loginAppearanceEdit.value.loginIconPath ? options.wallpaperUrl(loginAppearanceEdit.value.loginIconPath) : "/images/icon-192.svg");
  const appearanceDraftLoginBackground = computed(() => loginAppearanceEdit.value.loginBackgroundPath);
  const appearanceDraftWallpaper = computed(() => loginAppearanceEdit.value.wallpaperPath);
  const appearanceImagePickerSelection = computed(() => {
    const picker = appearanceImagePicker.value;
    return picker ? loginAppearanceEdit.value[picker.field] : null;
  });
  const appearanceImagePickerFit = computed(() => {
    const picker = appearanceImagePicker.value;
    return picker?.fitField ? loginAppearanceEdit.value[picker.fitField] : null;
  });
  const appearanceImagePickerFitOptions = computed(() => appearanceImagePicker.value?.fitField === "loginBackgroundFit" ? loginBackgroundFitOptions : wallpaperFitOptions);
  const appearancePreviewLoginStyle = computed(() => {
    const fit = options.wallpaperFitStyle(loginAppearanceEdit.value.loginBackgroundFit);
    return {
      backgroundImage: appearanceDraftLoginBackground.value ? `url(${options.wallpaperUrl(appearanceDraftLoginBackground.value)})` : "none",
      backgroundSize: fit.size,
      backgroundRepeat: fit.repeat
    };
  });
  const appearancePreviewChatStyle = computed(() => {
    const fit = options.wallpaperFitStyle(loginAppearanceEdit.value.wallpaperFit);
    return {
      backgroundImage: appearanceDraftWallpaper.value ? `url(${options.wallpaperUrl(appearanceDraftWallpaper.value)})` : "none",
      backgroundSize: fit.size,
      backgroundRepeat: fit.repeat,
      backgroundPosition: "center"
    };
  });
  const wallpaperPanFocusMarkerStyle = computed(() => ({ left: `${cleanWallpaperPanFocusX(loginAppearanceEdit.value.wallpaperPanFocusX) * 100}%` }));
  const wallpaperPanSpeedLabel = computed(() => `${cleanWallpaperPanSpeed(loginAppearanceEdit.value.wallpaperPanSpeed).toFixed(2)}×`);
  const parallaxKitOptions = computed(() => loginAppearanceEdit.value.parallaxKits);
  const draftParallaxKit = computed(() => parallaxKit(loginAppearanceEdit.value.parallaxKits, loginAppearanceEdit.value.parallaxKit));
  const parallaxSpeedLabel = computed(() => `${cleanParallaxSpeed(loginAppearanceEdit.value.parallaxSpeed).toFixed(2)}×`);
  const appearancePreviewFlash = computed(() => options.cleanFlashEffectSettings(flashEffectEdit.value));
  const appearancePreviewFlashColor = computed(() => {
    const colors = appearancePreviewFlash.value.colors;
    return colors[options.flashEffectStep.value % colors.length] || colors[0] || "#fff176";
  });
  const appearancePreviewFlashStyle = computed(() => {
    const interval = `${appearancePreviewFlash.value.intervalSeconds}s`;
    return {
      background: appearancePreviewFlashColor.value,
      color: options.readableTextColor(appearancePreviewFlashColor.value),
      transition: appearancePreviewFlash.value.transitionMode === "smooth" ? `background ${interval} linear, color ${interval} linear` : "none"
    };
  });
  const appearanceThemePreviewStyle = computed(() => options.paletteStyle(customThemeEdit.value.palette));
  const appearanceThemeOptions = computed<ThemeDTO[]>(() => [...builtInThemes, ...customThemesDraft.value]);
  const customThemeDraftIds = computed(() => new Set(customThemesDraft.value.map((theme) => theme.id)));
  const appearanceAdvancedColorFields = computed(() => colorFields.filter((field) => !primaryColorFieldKeys.has(field.key)));
  const appearanceSavePayload = computed(() => ({
    appTitle: loginAppearanceEdit.value.appTitle,
    appIconPath: loginAppearanceEdit.value.appIconPath,
    loginTitle: loginAppearanceEdit.value.loginTitle,
    loginSubtitle: loginAppearanceEdit.value.loginSubtitle,
    loginIconPath: loginAppearanceEdit.value.loginIconPath,
    loginShowIcon: loginAppearanceEdit.value.loginShowIcon,
    loginShowSubtitle: loginAppearanceEdit.value.loginShowSubtitle,
    loginBackgroundPath: loginAppearanceEdit.value.loginBackgroundPath,
    loginFormPosition: loginAppearanceEdit.value.loginFormPosition,
    loginBackgroundFit: loginAppearanceEdit.value.loginBackgroundFit,
    wallpaperPath: loginAppearanceEdit.value.wallpaperPath,
    wallpaperFit: loginAppearanceEdit.value.wallpaperFit,
    wallpaperPanFocusX: cleanWallpaperPanFocusX(loginAppearanceEdit.value.wallpaperPanFocusX),
    wallpaperPanDirection: cleanWallpaperPanDirection(loginAppearanceEdit.value.wallpaperPanDirection),
    wallpaperPanSpeed: cleanWallpaperPanSpeed(loginAppearanceEdit.value.wallpaperPanSpeed),
    parallaxKit: loginAppearanceEdit.value.parallaxKit,
    parallaxSpeed: cleanParallaxSpeed(loginAppearanceEdit.value.parallaxSpeed),
    parallaxKits: cleanParallaxKits(loginAppearanceEdit.value.parallaxKits),
    registrationEnabled: loginAppearanceEdit.value.registrationEnabled,
    musicPanelFontSize: cleanMusicPanelFontSize(loginAppearanceEdit.value.musicPanelFontSize),
    prayerBubbleMineColor: loginAppearanceEdit.value.prayerBubbleMineColor,
    prayerBubbleOtherColor: loginAppearanceEdit.value.prayerBubbleOtherColor,
    flashEffect: options.cleanFlashEffectSettings(flashEffectEdit.value),
    customThemes: customThemesDraft.value.map((theme) => ({ ...theme, palette: { ...theme.palette } })),
    composerPrompts: cleanComposerPrompts(composerPromptsText.value.split("\n")),
    composerPromptIntervalSeconds: cleanComposerPromptIntervalSeconds(composerPromptIntervalEdit.value),
    composerPromptAppearSeconds: cleanComposerPromptAppearSeconds(composerPromptAppearEdit.value),
    composerPromptDisappearSeconds: cleanComposerPromptDisappearSeconds(composerPromptDisappearEdit.value),
    composerPromptGapSeconds: cleanComposerPromptGapSeconds(composerPromptGapEdit.value)
  }));
  const currentAppearancePayload = computed(() => ({
    appTitle: store.appearance.appTitle || "Team Chat",
    appIconPath: store.appearance.appIconPath || null,
    loginTitle: store.appearance.loginTitle || "Team Chat",
    loginSubtitle: store.appearance.loginSubtitle || "",
    loginIconPath: store.appearance.loginIconPath || null,
    loginShowIcon: store.appearance.loginShowIcon !== false,
    loginShowSubtitle: store.appearance.loginShowSubtitle !== false,
    loginBackgroundPath: store.appearance.loginBackgroundPath || null,
    loginFormPosition: store.appearance.loginFormPosition || "middle",
    loginBackgroundFit: store.appearance.loginBackgroundFit || "cover",
    wallpaperPath: store.appearance.wallpaperPath || null,
    wallpaperFit: store.appearance.wallpaperFit || "cover",
    wallpaperPanFocusX: cleanWallpaperPanFocusX(store.appearance.wallpaperPanFocusX),
    wallpaperPanDirection: cleanWallpaperPanDirection(store.appearance.wallpaperPanDirection),
    wallpaperPanSpeed: cleanWallpaperPanSpeed(store.appearance.wallpaperPanSpeed),
    parallaxKit: store.appearance.parallaxKit || "none",
    parallaxSpeed: cleanParallaxSpeed(store.appearance.parallaxSpeed),
    parallaxKits: cleanParallaxKits(store.appearance.parallaxKits),
    registrationEnabled: !!store.appearance.registrationEnabled,
    musicPanelFontSize: cleanMusicPanelFontSize(store.appearance.musicPanelFontSize),
    prayerBubbleMineColor: store.appearance.prayerBubbleMineColor || "#f0fbf1",
    prayerBubbleOtherColor: store.appearance.prayerBubbleOtherColor || "#fffaf0",
    flashEffect: options.cleanFlashEffectSettings(store.appearance.flashEffect),
    customThemes: (store.appearance.customThemes || []).map((theme) => ({ ...theme, palette: { ...theme.palette } })),
    composerPrompts: cleanComposerPrompts(store.appearance.composerPrompts || []),
    composerPromptIntervalSeconds: cleanComposerPromptIntervalSeconds(store.appearance.composerPromptIntervalSeconds),
    composerPromptAppearSeconds: cleanComposerPromptAppearSeconds(store.appearance.composerPromptAppearSeconds),
    composerPromptDisappearSeconds: cleanComposerPromptDisappearSeconds(store.appearance.composerPromptDisappearSeconds),
    composerPromptGapSeconds: cleanComposerPromptGapSeconds(store.appearance.composerPromptGapSeconds)
  }));
  const appearanceHasDraftChanges = computed(() => JSON.stringify(appearanceSavePayload.value) !== JSON.stringify(currentAppearancePayload.value));

  function setAppearanceDraftImage(field: AppearanceImageField, fileName: string | null, message: string) {
    loginAppearanceEdit.value[field] = fileName;
    adminMsg.value = message;
  }

  function openAppearanceImagePicker(field: AppearanceImageField, title: string, hint: string, fitField?: AppearanceFitField) {
    appearanceImagePicker.value = { field, title, hint, fitField };
    void options.loadAdminAttachments().catch(() => undefined);
  }

  function closeAppearanceImagePicker() {
    appearanceImagePicker.value = null;
  }

  async function uploadAppearanceImage(event: Event, url: string, field: AppearanceImageField, failureMessage: string, successMessage: string) {
    const file = (event.target as HTMLInputElement).files?.[0];
    (event.target as HTMLInputElement).value = "";
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(url, { method: "POST", headers: authHeaders(), body: form });
    if (!response.ok) {
      const result = await response.json().catch(() => ({ message: failureMessage }));
      alert(result.message || failureMessage);
      return;
    }
    const result = (await response.json()) as { fileName: string; url?: string };
    setAppearanceDraftImage(field, result.fileName, successMessage);
    await options.loadAdminAttachments().catch(() => undefined);
  }

  async function uploadAppearanceImageForPicker(event: Event) {
    const picker = appearanceImagePicker.value;
    if (!picker) return;
    const uploadConfig: Record<AppearanceImageField, { url: string; failure: string; success: string }> = {
      appIconPath: { url: "/api/admin/appearance/app-icon", failure: "标签页图标上传失败", success: "标签页图标已上传并选入草稿，保存后生效" },
      loginIconPath: { url: "/api/admin/appearance/login-icon", failure: "登录页图标上传失败", success: "登录页图标已上传并选入草稿，保存后生效" },
      loginBackgroundPath: { url: "/api/admin/appearance/login-background", failure: "登录页背景上传失败", success: "登录页背景已上传并选入草稿，保存后生效" },
      wallpaperPath: { url: "/api/admin/appearance/wallpaper", failure: "壁纸上传失败", success: "壁纸已上传并选入草稿，保存后生效" }
    };
    const config = uploadConfig[picker.field];
    await uploadAppearanceImage(event, config.url, picker.field, config.failure, config.success);
  }

  function createParallaxKit() {
    const suffix = `${Date.now().toString(36)}-${randomId().slice(0, 8)}`;
    const kit: ParallaxKitDTO = {
      id: `custom-${suffix}`,
      name: `自定义卷轴 ${loginAppearanceEdit.value.parallaxKits.filter((item) => !item.builtIn).length + 1}`,
      description: "上传透明 PNG，并按从后到前排列图层。",
      credit: "",
      builtIn: false,
      layers: []
    };
    loginAppearanceEdit.value.parallaxKits.push(kit);
    loginAppearanceEdit.value.parallaxKit = kit.id;
    adminMsg.value = "已创建卷轴套件草稿，请上传至少一个图层";
  }

  function deleteParallaxKit(kit: ParallaxKitDTO) {
    if (kit.builtIn || !confirm(`删除卷轴套件“${kit.name}”？已上传的文件仍保留在服务器。`)) return;
    loginAppearanceEdit.value.parallaxKits = loginAppearanceEdit.value.parallaxKits.filter((item) => item.id !== kit.id);
    if (loginAppearanceEdit.value.parallaxKit === kit.id) loginAppearanceEdit.value.parallaxKit = "none";
  }

  function restoreBuiltInParallaxKit() {
    const defaultKit = cleanParallaxKits(DEFAULT_PARALLAX_KITS).find((kit) => kit.id === "rural");
    if (!defaultKit) return;
    const index = loginAppearanceEdit.value.parallaxKits.findIndex((kit) => kit.id === "rural");
    if (index >= 0) loginAppearanceEdit.value.parallaxKits.splice(index, 1, defaultKit);
    else loginAppearanceEdit.value.parallaxKits.unshift(defaultKit);
    loginAppearanceEdit.value.parallaxKit = "rural";
    adminMsg.value = "乡野河谷已恢复官方层序和速度草稿";
  }

  function moveParallaxLayer(index: number, direction: -1 | 1) {
    const kit = draftParallaxKit.value;
    const target = index + direction;
    if (!kit || target < 0 || target >= kit.layers.length) return;
    const [layer] = kit.layers.splice(index, 1);
    if (layer) kit.layers.splice(target, 0, layer);
  }

  function removeParallaxLayer(index: number) {
    const kit = draftParallaxKit.value;
    if (!kit) return;
    kit.layers.splice(index, 1);
  }

  function pickParallaxLayer() {
    if (!draftParallaxKit.value) createParallaxKit();
    parallaxLayerInput.value?.click();
  }

  async function uploadParallaxLayer(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    const kit = draftParallaxKit.value;
    if (!file || !kit || parallaxLayerUploadBusy.value) return;
    parallaxLayerUploadBusy.value = true;
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`/api/admin/parallax/${encodeURIComponent(kit.id)}/layers`, { method: "POST", headers: authHeaders(), body: form });
      if (!response.ok) {
        const result = await response.json().catch(() => ({ message: "卷轴图层上传失败" }));
        throw new Error(result.message || "卷轴图层上传失败");
      }
      const result = (await response.json()) as { layer: ParallaxLayerDTO; size: { width: number; height: number } };
      kit.layers.push(result.layer);
      adminMsg.value = `已上传 ${result.layer.name}（${result.size.width}×${result.size.height}），保存外观后生效`;
    } catch (error) {
      alert(error instanceof Error ? error.message : "卷轴图层上传失败");
    } finally {
      parallaxLayerUploadBusy.value = false;
    }
  }

  function selectAppearanceImage(fileName: string) {
    const picker = appearanceImagePicker.value;
    if (!picker) return;
    const image = backgroundAttachmentOptions.value.find((item) => item.fileName === fileName);
    if (!image) return;
    setAppearanceDraftImage(picker.field, image.fileName, "已选择图片草稿，保存后生效");
  }

  function setWallpaperPanFocus(event: MouseEvent) {
    const image = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLImageElement>("img");
    if (!image) return;
    const rect = image.getBoundingClientRect();
    if (rect.width <= 0) return;
    loginAppearanceEdit.value.wallpaperPanFocusX = cleanWallpaperPanFocusX((event.clientX - rect.left) / rect.width);
  }

  function clearAppearancePickerImage() {
    const picker = appearanceImagePicker.value;
    if (!picker) return;
    const labels: Record<AppearanceImageField, string> = {
      appIconPath: "标签页图标已在草稿中恢复默认，保存后生效",
      loginIconPath: "登录页图标已从草稿移除，保存后生效",
      loginBackgroundPath: "登录页背景已从草稿移除，保存后生效",
      wallpaperPath: "聊天室壁纸已从草稿移除，保存后生效"
    };
    setAppearanceDraftImage(picker.field, null, labels[picker.field]);
  }

  function resetThemeEditor() {
    customThemeEdit.value = { id: "", name: "我的主题", palette: { ...options.activePalette() } };
  }

  function abandonAppearanceDraft() {
    syncLoginAppearanceEdit();
    resetThemeEditor();
    appearanceImagePicker.value = null;
  }

  function syncLoginAppearanceEdit() {
    const flashEffect = options.flashEffect();
    loginAppearanceEdit.value = {
      appTitle: store.appearance.appTitle || "Team Chat",
      appIconPath: store.appearance.appIconPath || null,
      loginTitle: store.appearance.loginTitle || "Team Chat",
      loginSubtitle: store.appearance.loginSubtitle || "",
      loginIconPath: store.appearance.loginIconPath || null,
      loginShowIcon: store.appearance.loginShowIcon !== false,
      loginShowSubtitle: store.appearance.loginShowSubtitle !== false,
      loginBackgroundPath: store.appearance.loginBackgroundPath || null,
      loginFormPosition: store.appearance.loginFormPosition || "middle",
      loginBackgroundFit: store.appearance.loginBackgroundFit || "cover",
      wallpaperPath: store.appearance.wallpaperPath || null,
      wallpaperFit: store.appearance.wallpaperFit || "cover",
      wallpaperPanFocusX: cleanWallpaperPanFocusX(store.appearance.wallpaperPanFocusX),
      wallpaperPanDirection: cleanWallpaperPanDirection(store.appearance.wallpaperPanDirection),
      wallpaperPanSpeed: cleanWallpaperPanSpeed(store.appearance.wallpaperPanSpeed),
      parallaxKit: store.appearance.parallaxKit || "none",
      parallaxSpeed: cleanParallaxSpeed(store.appearance.parallaxSpeed),
      parallaxKits: cleanParallaxKits(store.appearance.parallaxKits),
      registrationEnabled: !!store.appearance.registrationEnabled,
      musicPanelFontSize: cleanMusicPanelFontSize(store.appearance.musicPanelFontSize),
      prayerBubbleMineColor: store.appearance.prayerBubbleMineColor || "#f0fbf1",
      prayerBubbleOtherColor: store.appearance.prayerBubbleOtherColor || "#fffaf0"
    };
    flashEffectEdit.value = {
      colors: [...flashEffect.colors],
      intervalSeconds: flashEffect.intervalSeconds,
      transitionMode: flashEffect.transitionMode
    };
    customThemesDraft.value = (store.appearance.customThemes || []).map((theme) => ({ ...theme, palette: { ...theme.palette } }));
    composerPromptsText.value = cleanComposerPrompts(store.appearance.composerPrompts || []).join("\n");
    composerPromptIntervalEdit.value = cleanComposerPromptIntervalSeconds(store.appearance.composerPromptIntervalSeconds);
    composerPromptAppearEdit.value = cleanComposerPromptAppearSeconds(store.appearance.composerPromptAppearSeconds);
    composerPromptDisappearEdit.value = cleanComposerPromptDisappearSeconds(store.appearance.composerPromptDisappearSeconds);
    composerPromptGapEdit.value = cleanComposerPromptGapSeconds(store.appearance.composerPromptGapSeconds);
    if (customThemeEdit.value.id && !customThemesDraft.value.some((theme) => theme.id === customThemeEdit.value.id)) resetThemeEditor();
    if (!store.appearance.registrationEnabled && options.authMode.value === "register") options.authMode.value = "login";
  }

  function addFlashColor() {
    if (flashEffectEdit.value.colors.length >= 10) return;
    flashEffectEdit.value.colors.push(flashEffectEdit.value.colors[flashEffectEdit.value.colors.length - 1] || "#fff176");
  }

  function removeFlashColor(index: number) {
    if (flashEffectEdit.value.colors.length <= 1) return;
    flashEffectEdit.value.colors.splice(index, 1);
  }

  async function saveLoginAppearance() {
    const result = await api<{ appearance: AppearanceDTO }>("/api/admin/appearance", {
      method: "POST",
      body: JSON.stringify(appearanceSavePayload.value)
    });
    store.appearance = result.appearance;
    syncLoginAppearanceEdit();
    await options.loadAdminAttachments().catch(() => undefined);
    adminMsg.value = "外观设置已保存并生效";
  }

  function editTheme(theme: ThemeDTO) {
    const isBuiltIn = builtInThemes.some((item) => item.id === theme.id);
    customThemeEdit.value = {
      id: isBuiltIn ? "" : theme.id,
      name: isBuiltIn ? `${theme.name}副本` : theme.name,
      palette: { ...theme.palette }
    };
    adminMsg.value = isBuiltIn ? "已用内置主题填充草稿，可另存为自定义主题" : "正在编辑自定义主题草稿";
  }

  function saveCustomTheme() {
    const id = customThemeEdit.value.id || themeSlug(customThemeEdit.value.name);
    const theme: ThemeDTO = {
      id,
      name: customThemeEdit.value.name.trim() || "自定义主题",
      palette: { ...customThemeEdit.value.palette }
    };
    const existing = customThemesDraft.value;
    customThemesDraft.value = existing.some((item) => item.id === id) ? existing.map((item) => (item.id === id ? theme : item)) : [...existing, theme];
    customThemeEdit.value = { ...theme, palette: { ...theme.palette } };
    adminMsg.value = "主题已更新到草稿，保存外观后生效";
  }

  function deleteCustomTheme(theme: ThemeDTO) {
    if (!confirm(`删除主题“${theme.name}”的草稿？保存外观后，使用该主题的成员会回到默认主题。`)) return;
    customThemesDraft.value = customThemesDraft.value.filter((item) => item.id !== theme.id);
    if (customThemeEdit.value.id === theme.id) resetThemeEditor();
    adminMsg.value = "主题已从草稿移除，保存外观后生效";
  }

  return {
    appearanceSection,
    appearancePreviewOpen,
    appearanceThemeAdvancedOpen,
    appearanceImagePicker,
    loginAppearanceEdit,
    flashEffectEdit,
    composerPromptsText,
    composerPromptIntervalEdit,
    composerPromptAppearEdit,
    composerPromptDisappearEdit,
    composerPromptGapEdit,
    customThemesDraft,
    customThemeEdit,
    parallaxLayerInput,
    parallaxLayerUploadBusy,
    backgroundAttachmentOptions,
    activeAppearanceSection,
    appearanceDraftIcon,
    appearanceDraftLoginIcon,
    appearanceDraftLoginBackground,
    appearanceDraftWallpaper,
    appearanceImagePickerSelection,
    appearanceImagePickerFit,
    appearanceImagePickerFitOptions,
    appearancePreviewLoginStyle,
    appearancePreviewChatStyle,
    wallpaperPanFocusMarkerStyle,
    wallpaperPanSpeedLabel,
    parallaxKitOptions,
    draftParallaxKit,
    parallaxSpeedLabel,
    appearancePreviewFlash,
    appearancePreviewFlashColor,
    appearancePreviewFlashStyle,
    appearanceThemePreviewStyle,
    appearanceThemeOptions,
    customThemeDraftIds,
    appearanceAdvancedColorFields,
    appearanceSavePayload,
    currentAppearancePayload,
    appearanceHasDraftChanges,
    setAppearanceDraftImage,
    openAppearanceImagePicker,
    closeAppearanceImagePicker,
    uploadAppearanceImage,
    uploadAppearanceImageForPicker,
    createParallaxKit,
    deleteParallaxKit,
    restoreBuiltInParallaxKit,
    moveParallaxLayer,
    removeParallaxLayer,
    pickParallaxLayer,
    uploadParallaxLayer,
    selectAppearanceImage,
    setWallpaperPanFocus,
    clearAppearancePickerImage,
    abandonAppearanceDraft,
    syncLoginAppearanceEdit,
    addFlashColor,
    removeFlashColor,
    saveLoginAppearance,
    editTheme,
    resetThemeEditor,
    saveCustomTheme,
    deleteCustomTheme
  };
}
