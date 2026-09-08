import crypto from "node:crypto";
import path from "node:path";
import type { Message } from "@prisma/client";
import type { ChainPayload, PinnedBodyDTO, PinnedContentBlockDTO } from "../shared/types.js";

export function decodeBasicHtmlEntities(input: string) {
  return input
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function pinnedPlainTextFromHtml(input?: string | null) {
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

export function cleanPinnedText(input: unknown) {
  return String(input || "").replace(/\r\n/g, "\n").trim().slice(0, 20000);
}

export function cleanPinnedTitle(input: unknown) {
  return String(input || "").trim().slice(0, 160);
}

export function pinnedBlockId() {
  return crypto.randomBytes(6).toString("hex");
}

export function appendPinnedTextBlock(blocks: PinnedContentBlockDTO[], text: string) {
  const cleaned = cleanPinnedText(text);
  if (!cleaned) return;
  const previous = blocks[blocks.length - 1];
  if (previous?.type === "text") {
    previous.text = [previous.text, cleaned].filter(Boolean).join("\n");
  } else {
    blocks.push({ id: pinnedBlockId(), type: "text", text: cleaned });
  }
}

export function serializePinnedBody(input: unknown, fallbackContent?: string | null): PinnedBodyDTO {
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

export function pinnedBodyUploadFilePaths(body: PinnedBodyDTO) {
  return new Set(body.blocks.flatMap((block) => (block.type === "image" || block.type === "file" ? [path.basename(block.filePath)] : [])));
}

export function pinnedBlocksFromMessage(message: Message): PinnedContentBlockDTO[] {
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
