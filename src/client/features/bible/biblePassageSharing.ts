import type { BibleLookupDTO } from "@shared/types";
import { listenPlaylistContent, type ListenPlaylistDraft } from "@shared/listenPlaylist";
import { escapeHtmlText } from "../messages/messageRendering";

export const BIBLE_BULK_SHARE_NOTICE = "您可能不小心全选了经文，发送大量经文会造成聊天室刷屏，现在将以合并消息发送。如果您一定要单独发送每条经文，请联系管理员，让他告诉你为什么这样做不理智。";

/** 分享对话框往聊天室发一条普通 text 消息；带 payload 时是「/听」清单（服务端按引用解析并重写正文）。 */
export type BibleShareTextSender = (content: string, requestId: string, payload?: ListenPlaylistDraft) => Promise<void>;

export function shouldMergeBiblePassages(lookups: BibleLookupDTO[]) {
  return lookups.reduce((count, lookup) => count + lookup.verses.reduce(
    (total, verse) => total + verse.endVerse - verse.verse + 1, 0
  ), 0) > 3;
}

export function mergedBiblePassageContent(lookups: BibleLookupDTO[], includeTranslation: boolean) {
  return lookups.map(lookup => [
    lookup.normalizedReference,
    ...lookup.verses.map(verse => `${verse.verse} ${verse.text}`),
    ...(includeTranslation ? [`—— ${lookup.translation}`] : [])
  ].map(escapeHtmlText).join("\n")).join("\n\n");
}

/**
 * 「一起听」：把选中的经文卡片变成一条「/听」清单消息。只交引用串，与输入框 `/听 诗篇 23` 走同一条
 * 服务端解析路径（listenPlaylist.cleanListenPlaylistPayload），正文摘要与 composer 用同一个生成器。
 */
export function listenBiblePassageDraft(lookups: BibleLookupDTO[]): { content: string; payload: ListenPlaylistDraft } {
  const items = lookups.map(lookup => ({ kind: "scripture" as const, reference: lookup.normalizedReference }));
  return { content: listenPlaylistContent(items), payload: { kind: "listen_playlist", items } };
}
