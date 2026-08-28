import type { SermonSlideInput, SermonSlideInputBlock } from "@shared/types";
import { extractBibleReferenceMatches } from "../../bibleReferences";

// 讲道台统一输入解析：自由文本里自动识别经文出处（复用聊天消息的同一份识别规则），
// 识别出的经文保持经文、其余文字原样保留。Cmd/Ctrl+Enter 提交一屏；
// 勾选「每处经文一屏」时每个出处独立成屏，连续文字合并为文字屏。

const SEPARATOR_ONLY_TEXT = /^[\s，,、；;：:．.。！!？?·—…]+$/;

type LineSegment = { type: "text"; text: string } | { type: "reference"; reference: string };

/** 单行切分成有序片段：经文出处与文字。仅含分隔符的文字片段直接丢弃（如「约3:16，诗篇23」里的逗号）。 */
function lineSegments(line: string): LineSegment[] {
  const matches = extractBibleReferenceMatches(line);
  const segments: LineSegment[] = [];
  let cursor = 0;
  for (const match of matches) {
    const before = line.slice(cursor, match.start);
    if (before.trim() && !SEPARATOR_ONLY_TEXT.test(before)) segments.push({ type: "text", text: before });
    segments.push({ type: "reference", reference: match.reference });
    cursor = match.end;
  }
  const after = line.slice(cursor);
  if (after.trim() && !SEPARATOR_ONLY_TEXT.test(after)) segments.push({ type: "text", text: after });
  return segments;
}

function flushTextBuffer(buffer: string[]): string {
  const content = buffer.join("\n").trim();
  buffer.length = 0;
  return content;
}

/** 服务端校验单文本块 ≤4000 字，超长块按行边界拆成多块。 */
function splitTextBlock(content: string): SermonSlideInputBlock[] {
  const blocks: SermonSlideInputBlock[] = [];
  let current = "";
  for (const line of content.split("\n")) {
    const piece = current ? `${current}\n${line}` : line;
    if (piece.length > 4000 && current) {
      blocks.push({ type: "text", content: current });
      current = line;
    } else {
      current = piece;
    }
  }
  // 单行超过 4000 字时按行边界拆无可拆，硬切成 4000 字一块。
  while (current.length > 4000) {
    blocks.push({ type: "text", content: current.slice(0, 4000) });
    current = current.slice(4000);
  }
  if (current.trim()) blocks.push({ type: "text", content: current });
  return blocks;
}

/**
 * 把讲道台输入解析成一屏或多屏。
 * onePerSlide = false：整段输入为 1 屏，经文与文字按出现顺序混排；
 * onePerSlide = true：每处经文独立成屏，连续文字合并成文字屏，顺序保持。
 */
export function parseSermonInput(text: string, onePerSlide: boolean): SermonSlideInput[] {
  const buffer: string[] = [];
  if (!onePerSlide) {
    const blocks: SermonSlideInputBlock[] = [];
    const flushText = () => {
      const content = flushTextBuffer(buffer);
      if (content) blocks.push(...splitTextBlock(content));
    };
    for (const line of text.split(/\r\n?|\n/)) {
      const segments = lineSegments(line);
      if (!segments.length) {
        buffer.push("");
        continue;
      }
      for (const segment of segments) {
        if (segment.type === "text") buffer.push(segment.text);
        else {
          flushText();
          blocks.push({ type: "reference", reference: segment.reference });
        }
      }
    }
    flushText();
    return blocks.length ? [{ blocks }] : [];
  }

  const slides: SermonSlideInput[] = [];
  const flushText = () => {
    const content = flushTextBuffer(buffer);
    if (content) slides.push({ blocks: splitTextBlock(content) });
  };
  for (const line of text.split(/\r\n?|\n/)) {
    const segments = lineSegments(line);
    if (!segments.length) {
      buffer.push("");
      continue;
    }
    for (const segment of segments) {
      if (segment.type === "text") buffer.push(segment.text);
      else {
        flushText();
        slides.push({ blocks: [{ type: "reference", reference: segment.reference }] });
      }
    }
  }
  flushText();
  return slides;
}
