import type { BibleLookupDTO } from "@shared/types";
import { escapeHtmlText } from "../messages/messageRendering";

export const BIBLE_BULK_SHARE_NOTICE = "您可能不小心全选了经文，发送大量经文会造成聊天室刷屏，现在将以合并消息发送。如果您一定要单独发送每条经文，请联系管理员，让他告诉你为什么这样做不理智。";

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
