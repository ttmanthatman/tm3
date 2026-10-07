import { COPYWORK_PAGE, type CopyworkDTO, type CopyworkGlyph, type CopyworkPlacement } from "@shared/bibleCopywork";
import { api } from "../../../api";
import { drawHandwritingInk } from "../../handwriting/handwritingRenderer";
import { copyworkInkViewport } from "./copyworkPageLayout";

type IndexedGlyph = CopyworkGlyph & { index: number };
type Manifest = { work: CopyworkDTO; pages: CopyworkPlacement[][] };
type ExportResult = { blob: Blob; cacheWarning: string };
const CACHE = "bible-copywork-exports-v1";

export function copyworkExportLayout(glyphs: IndexedGlyph[], pages: CopyworkPlacement[][]) {
  let height = 0;
  const frames = pages.map((placements) => {
    const viewport = copyworkInkViewport(glyphs, placements);
    const frame = { placements, viewport, y: height };
    height += viewport.height + 24;
    return frame;
  });
  height = Math.max(1, height - 24);
  const width = Math.max(1, ...frames.map((frame) => frame.viewport.width));
  const scale = Math.min(2, 16000 / height, Math.sqrt(16_000_000 / (width * height)));
  return { frames, width: Math.ceil(width * scale), height: Math.ceil(height * scale), scale };
}

async function render(glyphs: IndexedGlyph[], pages: CopyworkPlacement[][]): Promise<Blob> {
  const layout = copyworkExportLayout(glyphs, pages);
  const canvas = document.createElement("canvas");
  canvas.width = layout.width;
  canvas.height = layout.height;
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器无法渲染下载图片");
    const byIndex = new Map(glyphs.map((glyph) => [glyph.index, glyph]));
    context.scale(layout.scale, layout.scale);
    for (const frame of layout.frames) {
      for (const placement of frame.placements) {
        const glyph = byIndex.get(placement.index);
        if (!glyph) throw new Error("册页笔迹不完整，请重试");
        context.save();
        context.translate(placement.x - frame.viewport.x, frame.y + placement.y - frame.viewport.y);
        context.scale(COPYWORK_PAGE.font / 10000, COPYWORK_PAGE.font / 10000);
        drawHandwritingInk(context, glyph.character);
        context.restore();
      }
    }
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("图片生成失败，请重试"));
    }, "image/png"));
  } finally {
    canvas.width = canvas.height = 0;
  }
}

type ExportDependencies = {
  authorize: (id: string) => Promise<Manifest>;
  loadPage: (id: string, page: number) => Promise<{ glyphs: IndexedGlyph[] }>;
  read: (key: string) => Promise<Blob | undefined>;
  write: (key: string, blob: Blob) => Promise<void>;
  render: typeof render;
};

export function createCopyworkExporter(dependencies: ExportDependencies) {
  const memory = new Map<string, ExportResult>();
  return async (accountId: number, id: string): Promise<ExportResult> => {
    // Always recheck access, even when an immutable image is already cached.
    const { work, pages } = await dependencies.authorize(id);
    const key = `/__copywork-export/${accountId}/${encodeURIComponent(id)}/${encodeURIComponent(work.completedAt)}.png`;
    const cached = memory.get(key);
    if (cached) return cached;
    let cacheWarning = "";
    try {
      const blob = await dependencies.read(key);
      if (blob) { const result = { blob, cacheWarning }; memory.set(key, result); return result; }
    } catch {
      cacheWarning = "浏览器无法保留图片缓存，本次打开期间仍可复用，重新打开后可能需要重新生成。";
    }
    const glyphs: IndexedGlyph[] = [];
    for (let page = 0; page < pages.length; page++)
      glyphs.push(...(await dependencies.loadPage(id, page)).glyphs);
    const blob = await dependencies.render(glyphs, pages);
    try { await dependencies.write(key, blob); }
    catch { cacheWarning = "浏览器无法保留图片缓存，本次打开期间仍可复用，重新打开后可能需要重新生成。"; }
    const result = { blob, cacheWarning };
    memory.set(key, result);
    return result;
  };
}

export const exportCopywork = createCopyworkExporter({
  authorize: (id) => api<Manifest>(`/api/bible/copyworks/${id}`),
  loadPage: (id, page) => api<{ glyphs: IndexedGlyph[] }>(`/api/bible/copyworks/${id}/pages/${page}`),
  read: async (key) => (await (await caches.open(CACHE)).match(key))?.blob(),
  write: async (key, blob) => { await (await caches.open(CACHE)).put(key, new Response(blob, { headers: { "Content-Type": "image/png" } })); },
  render
});

export function downloadCopywork(blob: Blob, reference: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${reference.replace(/[\\/:*?"<>|]/g, "-")}-手写.png`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
