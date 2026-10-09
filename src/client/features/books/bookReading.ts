export type BookLocation = { bookId: number; fraction: number };
export type BookReadingContext = BookLocation & { title: string; chapter: string; quote: string };

export function bookChapterLabel(chapter: string): string {
  const value = chapter.trim();
  return /^\d+$/.test(value) ? `第${value}章` : value;
}

export function bookPositionLabel(chapter: string, fraction: number): string {
  return [bookChapterLabel(chapter), `${Math.round(fraction * 100)}%`].filter(Boolean).join(" · ");
}

export function bookReadingUrl(location: BookLocation, origin: string): string {
  const url = new URL("/", origin);
  url.searchParams.set("bookId", String(location.bookId));
  url.searchParams.set("bookFraction", String(location.fraction));
  return url.href;
}

export function parseBookReadingUrl(value: string, origin: string): BookLocation | null {
  try {
    const url = new URL(value, origin);
    if (url.origin !== new URL(origin).origin || url.pathname !== "/") return null;
    const id = url.searchParams.get("bookId");
    const rawFraction = url.searchParams.get("bookFraction");
    if (!id || !/^\d+$/.test(id) || !rawFraction?.trim()) return null;
    const bookId = Number(id), fraction = Number(rawFraction);
    return Number.isSafeInteger(bookId) && bookId > 0 && Number.isFinite(fraction) && fraction >= 0 && fraction <= 1
      ? { bookId, fraction } : null;
  } catch { return null; }
}

function html(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/\n/g, "<br>");
}

export function bookShareContent(context: BookReadingContext, origin: string): string {
  const heading = context.quote ? `摘录自《${context.title}》` : `邀请你一起读《${context.title}》`;
  return `${html(heading)}${context.quote ? `<br>“${html(context.quote)}”` : ""}<br><a href="${html(bookReadingUrl(context, origin))}">打开书中的位置：${html(bookPositionLabel(context.chapter, context.fraction))}</a>`;
}

export function wrapBookCardText(text: string, measure: (value: string) => number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const character of paragraph) {
      if (line && measure(line + character) > width) { lines.push(line); line = ""; }
      line += character;
    }
    lines.push(line);
  }
  return lines;
}

export async function bookExcerptImage(context: BookReadingContext): Promise<File> {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法生成摘录卡片，请重试");
  const font = '32px "Songti SC", "STSong", serif';
  ctx.font = font;
  const lines = wrapBookCardText(context.quote, (text) => ctx.measureText(text).width, 912);
  const titleLines = wrapBookCardText(`《${context.title}》`, (text) => ctx.measureText(text).width, 912);
  const chapterLines = wrapBookCardText(context.chapter, (text) => ctx.measureText(text).width, 912);
  canvas.width = 1080;
  canvas.height = Math.max(720, (lines.length + titleLines.length + chapterLines.length) * 50 + 300);
  ctx.fillStyle = "#faf5e9"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#89704d"; ctx.font = font;
  ctx.fillText("阅读摘录", 84, 100);
  ctx.fillStyle = "#332c23";
  let y = 200;
  for (const line of lines) { ctx.fillText(line, 84, y); y += 50; }
  y += 50; ctx.fillStyle = "#89704d";
  for (const line of [...titleLines, ...chapterLines]) { ctx.fillText(line, 84, y); y += 50; }
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("摘录卡片生成失败")), "image/png"));
  canvas.width = canvas.height = 0;
  return new File([blob], "reading-excerpt.png", { type: "image/png" });
}
