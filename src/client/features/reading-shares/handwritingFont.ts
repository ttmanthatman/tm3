import { readonly, ref } from "vue";
import { api } from "../../api";
import type { AppearanceDTO } from "@shared/types";
import { READING_FONT_MAX_BYTES, readingFontUrl, type ReadingFontDTO } from "@shared/readingFont";

const FAMILY = "ReadingCommentHandwriting";
const FALLBACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
const fileName = ref("");
const busy = ref(false);
const error = ref("");
let activeFace: FontFace | null = null;
let requestedId: string | null | undefined;
let revision = 0;
let pending = Promise.resolve();
export const handwritingFont = { fileName: readonly(fileName), busy: readonly(busy), error: readonly(error) };

function activateFont(face: FontFace | null) {
  if (activeFace) document.fonts.delete(activeFace);
  activeFace = face;
  if (face) document.fonts.add(face);
  document.documentElement.style.setProperty("--reading-comment-font", face ? `"${FAMILY}", ${FALLBACK}` : FALLBACK);
}

// Appearance bootstrap and socket updates share the same versioned global font.
// Never read the obsolete per-browser IndexedDB font setting.
export function syncHandwritingFont(font?: ReadingFontDTO | null): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  const id = font?.id ?? null;
  if (requestedId === id) return pending;
  requestedId = id;
  const request = ++revision;
  fileName.value = font?.name ?? "";
  error.value = "";
  if (!font) {
    activateFont(null);
    busy.value = false;
    return pending = Promise.resolve();
  }
  busy.value = true;
  return pending = (async () => {
    try {
      const face = await new FontFace(FAMILY, `url("${readingFontUrl(font)}")`).load();
      if (revision === request) activateFont(face);
    } catch {
      if (revision === request) {
        activateFont(null);
        requestedId = undefined;
        error.value = "全局手写字体暂时无法加载，已使用默认字体";
      }
    } finally { if (revision === request) busy.value = false; }
  })();
}

export async function setHandwritingFont(file: File | null): Promise<AppearanceDTO> {
  let body: FormData | undefined;
  if (file) {
    if (!/\.(ttf|otf|woff2?)$/i.test(file.name)) throw new Error("请选择 TTF、OTF、WOFF 或 WOFF2 字体文件");
    if (!file.size || file.size > READING_FONT_MAX_BYTES) throw new Error("字体文件不能为空，大小不能超过 30 MB");
    try { await new FontFace(FAMILY, await file.arrayBuffer()).load(); }
    catch { throw new Error("无法读取这个字体，请选择有效的字体文件；原字体已保留"); }
    body = new FormData(); body.append("file", file);
  }
  const result = await api<{ appearance: AppearanceDTO }>("/api/admin/appearance/reading-font", { method: file ? "POST" : "DELETE", body });
  await syncHandwritingFont(result.appearance.readingFont);
  return result.appearance;
}
