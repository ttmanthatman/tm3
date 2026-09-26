import { plainTextFromHtml } from "../textUtils.js";
import { graceImages } from "../../shared/grace.js";
import type { GracePayload } from "../../shared/types.js";
import { PRAYER_UPDATE_HISTORY_LIMIT } from "../prayerUpdates.js";

export function prependGraceUpdateHistory(raw: Record<string, unknown>, content: string, at: string, by?: string) {
  const previous = Array.isArray(raw.updates) ? raw.updates : [];
  const history: NonNullable<GracePayload["updates"]> = [];
  for (const input of [{ content, at, by, imageMessageId: raw.imageMessageId, images: raw.images }, ...previous]) {
    if (!input || typeof input !== "object" || Array.isArray(input)) continue;
    const entry = input as Record<string, unknown>;
    if (typeof entry.content !== "string") continue;
    const imageMessageId = Number(entry.imageMessageId || 0);
    history.push({
      content: entry.content,
      at: typeof entry.at === "string" ? entry.at : "",
      ...(typeof entry.by === "string" && entry.by ? { by: entry.by } : {}),
      ...(Number.isInteger(imageMessageId) && imageMessageId > 0 ? { imageMessageId } : {}),
      images: graceImages(entry)
    });
  }
  return history.slice(0, PRAYER_UPDATE_HISTORY_LIMIT);
}

export function graceUpdateStoryText(previous: string, current: string): string {
  const before = plainTextFromHtml(previous, 10000);
  const after = plainTextFromHtml(current, 10000);
  if (before === after) return "恩典照片已更新";
  if (after.startsWith(before)) return `恩典更新：\n${after.slice(before.length).trim() || "内容已调整"}`;
  // Keep changed lines, so an appended testimony does not repost the original.
  const oldLines = new Set(before.split("\n"));
  const changed = after.split("\n").filter((line) => !oldLines.has(line)).join("\n").trim();
  return `恩典更新：\n${changed || "已删减原有文字"}`;
}
