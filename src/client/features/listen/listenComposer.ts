import type { ListenPlaylistDraftItem } from "@shared/listenPlaylist";
import { extractBibleReferenceMatches } from "../../bibleReferences";

export const LISTEN_COMMAND = "/听";

/** 草稿是否以「/听」开头（后接空白/换行或到此结束）；composer 与 App 的 @@ 多选逻辑共用这一判定 */
export function isListenDraft(value: string) {
  return /^\s*\/听(?:\s|$)/.test(value);
}

export type ListenDraftMention = { id: number; title: string };

export type ListenDraftPreviewItem = { kind: "scripture"; reference: string } | { kind: "track"; title: string };

export type ListenDraft = {
  items: ListenPlaylistDraftItem[];
  preview: ListenDraftPreviewItem[];
  note: string;
};

type Span = { start: number; end: number };

function overlaps(span: Span, taken: Span[]) {
  return taken.some((other) => span.start < other.end && other.start < span.end);
}

// 按 UTF-16 下标抹空（与 indexOf / 引用识别器的下标口径一致，emoji 等代理对也不会错位）
function blank(text: string, spans: Span[]) {
  let result = text;
  for (const span of spans) {
    const end = Math.min(span.end, result.length);
    if (span.start >= end) continue;
    result = `${result.slice(0, span.start)}${" ".repeat(end - span.start)}${result.slice(end)}`;
  }
  return result;
}

/**
 * 「/听」正文 → 有序清单：`@@歌名` 标记按在正文中的位置排序，经文引用用聊天里同一套
 * 识别器抽出（先把歌名位置抹成空格，避免歌名里的数字被当成章节）。剩下的文字作为备注。
 * 被用户从正文里删掉标记的歌不进清单。
 */
export function buildListenDraft(body: string, mentions: ListenDraftMention[]): ListenDraft {
  const trackSpans: Array<Span & { mention: ListenDraftMention }> = [];
  for (const mention of mentions) {
    const marker = `@@${mention.title}`;
    if (!mention.title.trim()) continue;
    let from = 0;
    while (from <= body.length) {
      const found = body.indexOf(marker, from);
      if (found < 0) break;
      const span = { start: found, end: found + marker.length };
      if (!overlaps(span, trackSpans)) {
        trackSpans.push({ ...span, mention });
        break;
      }
      from = found + 1;
    }
  }
  const withoutTracks = blank(body, trackSpans);
  const references = extractBibleReferenceMatches(withoutTracks);
  const ordered = [
    ...trackSpans.map((span) => ({ start: span.start, item: { kind: "track" as const, trackId: span.mention.id }, preview: { kind: "track" as const, title: span.mention.title } })),
    ...references.map((match) => ({ start: match.start, item: { kind: "scripture" as const, reference: match.reference }, preview: { kind: "scripture" as const, reference: match.reference } }))
  ].sort((left, right) => left.start - right.start);
  const note = blank(withoutTracks, references)
    .replace(/[\s、，,;；·•|]+/g, " ")
    .trim();
  return {
    items: ordered.map((entry) => entry.item),
    preview: ordered.map((entry) => entry.preview),
    note
  };
}
