import type { SermonDisplayDTO } from "@shared/types";

/** 服务端快照到达前的兜底显示设置（与服务端 DEFAULT_SERMON_DISPLAY 保持一致）。 */
export const SERMON_DISPLAY_FALLBACK: SermonDisplayDTO = {
  fontFamily: "puhuiti",
  fontScale: 1,
  marginPct: 4,
  background: "gradient"
};

/** 自定义 hex 背景的相对亮度（sRGB 0–1），超过阈值时前景文字用深色。 */
export function isLightSermonBackground(hex: string): boolean {
  const value = Number.parseInt(hex.slice(1), 16);
  const r = ((value >> 16) & 0xff) / 255;
  const g = ((value >> 8) & 0xff) / 255;
  const b = (value & 0xff) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5;
}

/**
 * 舞台根元素（.sermon-overlay）的内联 CSS 变量：倍率与边距总是内联；
 * 自定义 hex 背景连同按亮度挑选的前景色内联，预设背景交给 data 属性选择器。
 */
export function sermonDisplayStyle(display: SermonDisplayDTO): Record<string, string> {
  const style: Record<string, string> = {
    "--sermon-font-scale": String(display.fontScale),
    "--sermon-margin-pct": String(display.marginPct)
  };
  if (display.background.startsWith("#")) {
    style["--sermon-bg"] = display.background;
    style["--sermon-fg"] = isLightSermonBackground(display.background) ? "#1f2937" : "#f5f1e6";
  }
  return style;
}

/** 舞台根元素的 data 属性：预设背景与字体族由 styles.css 的 [data-sermon-*] 选择器映射。 */
export function sermonDisplayAttrs(display: SermonDisplayDTO): Record<string, string | null> {
  return {
    "data-sermon-font": display.fontFamily,
    "data-sermon-bg": display.background.startsWith("#") ? null : display.background
  };
}
