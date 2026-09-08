import { nextTick, ref } from "vue";
import type { LinkPreviewDTO, MessageDTO } from "@shared/types";
import { api } from "../../api";
import { useChatStore } from "../../store";
import { memoizeMessage } from "../../memoize";
import {
  bibleRichTextSegmentsFromHtml as bibleRichTextSegmentsFromHtmlPure,
  escapeRegExp,
  extractMessageUrls,
  plainTextFromHtml,
  renderMarkdownToHtml,
  textContentHtml as textContentHtmlPure,
  type BibleRichTextSegment,
  type LinkifyMessageHtml
} from "./messageRendering";

export type LinkPreviewState = { status: "loading" | "ready" | "error"; preview?: LinkPreviewDTO; error?: string };
export type MentionToast = { id: number; channelId: number; channelName: string; senderName: string; text: string; createdAt: string };

interface UseMessageRenderingOptions {
  linkifyMessageHtml: LinkifyMessageHtml;
  isMine: (message: MessageDTO) => boolean;
  reconcileReadPositionAfterLayout: () => void;
}

export function useMessageRendering(options: UseMessageRenderingOptions) {
  const store = useChatStore();
  const linkPreviewCache = ref<Record<string, LinkPreviewState>>({});
  // Preview requests queue here instead of firing all at once; a small worker
  // pool keeps previews from crowding out message and channel traffic.
  const linkPreviewQueue: string[] = [];
  const linkPreviewQueued = new Set<string>();
  let activeLinkPreviews = 0;
  const mentionToasts = ref<MentionToast[]>([]);
  const acknowledgedMentionIds = ref<Set<number>>(new Set());

  const messagePreviewUrl = memoizeMessage((message: MessageDTO) => {
    if (message.type !== "text" && message.type !== "prayer") return "";
    return extractMessageUrls(message.content)[0] || "";
  });

  function messageContentHtml(message: MessageDTO) {
    return options.linkifyMessageHtml(message.content);
  }

  const markdownMessageHtml = memoizeMessage((message: MessageDTO) => options.linkifyMessageHtml(renderMarkdownToHtml(message.content || "")));

  function aiMessageHtml(message: MessageDTO) {
    return markdownMessageHtml(message);
  }

  function textContentHtml(text: string) {
    return textContentHtmlPure(text, options.linkifyMessageHtml);
  }

  function bibleRichTextSegmentsFromHtml(html: string, keyPrefix: string): BibleRichTextSegment[] {
    return bibleRichTextSegmentsFromHtmlPure(html, keyPrefix, options.linkifyMessageHtml);
  }

  // Message rows re-render whenever any reactive input changes (effect ticks,
  // presence updates), so the heavy per-row derivations are memoized on the message
  // object itself: identical rows return instantly from the WeakMap.
  const messageRichTextSegments = memoizeMessage((message: MessageDTO) => bibleRichTextSegmentsFromHtml(message.content, `message-${message.id}`));

  const prayerRichTextSegments = memoizeMessage((message: MessageDTO) => bibleRichTextSegmentsFromHtml(message.content, `prayer-${message.id}`));

  function linkPreviewFor(message: MessageDTO) {
    const url = messagePreviewUrl(message);
    const state = url ? linkPreviewCache.value[url] : undefined;
    return state?.status === "ready" ? state.preview || null : null;
  }

  function pumpLinkPreviews() {
    // Cold caches used to fire up to 40 preview requests at once; keep a small
    // worker pool so previews never crowd out message and channel traffic.
    while (activeLinkPreviews < 3 && linkPreviewQueue.length) {
      const url = linkPreviewQueue.shift();
      if (!url) return;
      activeLinkPreviews += 1;
      void ensureLinkPreview(url).finally(() => {
        linkPreviewQueued.delete(url);
        activeLinkPreviews -= 1;
        pumpLinkPreviews();
      });
    }
  }

  function ensureVisibleLinkPreviews() {
    const urls = [...new Set(store.messages.map(messagePreviewUrl).filter(Boolean))].slice(-40);
    for (const url of urls) {
      if (linkPreviewCache.value[url] || linkPreviewQueued.has(url)) continue;
      linkPreviewQueued.add(url);
      linkPreviewQueue.push(url);
    }
    pumpLinkPreviews();
  }

  async function ensureLinkPreview(url: string) {
    if (!store.account || linkPreviewCache.value[url]) return;
    linkPreviewCache.value = { ...linkPreviewCache.value, [url]: { status: "loading" } };
    try {
      const preview = await api<LinkPreviewDTO>(`/api/link-preview?url=${encodeURIComponent(url)}`);
      if (!preview.title && !preview.image && !preview.description) throw new Error("empty preview");
      linkPreviewCache.value = { ...linkPreviewCache.value, [url]: { status: "ready", preview } };
      await nextTick();
      options.reconcileReadPositionAfterLayout();
    } catch (error) {
      linkPreviewCache.value = { ...linkPreviewCache.value, [url]: { status: "error", error: error instanceof Error ? error.message : "preview failed" } };
    }
  }

  function channelName(channelId: number) {
    return store.channels.find((channel) => channel.id === channelId)?.name || "聊天室";
  }

  function messageMentionsCurrentUser(message: MessageDTO) {
    if (!store.account || options.isMine(message) || message.type !== "text") return false;
    const text = plainTextFromHtml(message.content);
    const names = [store.account.displayName, store.account.username].filter((name): name is string => !!name?.trim());
    return names.some((name) => {
      const pattern = new RegExp(`(^|[\\s，。！？、,.!?:;；：])@${escapeRegExp(name.trim())}(?=$|[\\s，。！？、,.!?:;；：])`);
      return pattern.test(text);
    });
  }

  function messagePreviewText(message: MessageDTO) {
    const text = plainTextFromHtml(message.content || message.fileName || "");
    return text.length > 48 ? `${text.slice(0, 48)}...` : text || "新消息";
  }

  function queueMentionToast(message: MessageDTO) {
    if (!messageMentionsCurrentUser(message) || mentionToasts.value.some((toast) => toast.id === message.id)) return;
    mentionToasts.value = [
      ...mentionToasts.value,
      {
        id: message.id,
        channelId: message.channelId,
        channelName: channelName(message.channelId),
        senderName: message.sender.displayName,
        text: messagePreviewText(message),
        createdAt: message.createdAt
      }
    ].slice(-8);
  }

  function mentionAcknowledgementKey() {
    return store.account ? `team-chat-mention-acknowledged-${store.account.id}` : "";
  }

  function loadAcknowledgedMentionIds() {
    const key = mentionAcknowledgementKey();
    if (!key) return new Set<number>();
    try {
      const ids = JSON.parse(localStorage.getItem(key) || "[]");
      return new Set(Array.isArray(ids) ? ids.map(Number).filter(Number.isFinite) : []);
    } catch {
      return new Set<number>();
    }
  }

  function saveAcknowledgedMentionIds() {
    const key = mentionAcknowledgementKey();
    if (!key) return;
    const ids = [...acknowledgedMentionIds.value].slice(-500);
    localStorage.setItem(key, JSON.stringify(ids));
  }

  function isMentionAlertActive(message: MessageDTO) {
    return messageMentionsCurrentUser(message) && !acknowledgedMentionIds.value.has(message.id);
  }

  function acknowledgeMentionAlert(message: MessageDTO) {
    if (!isMentionAlertActive(message)) return false;
    acknowledgeMentionId(message.id);
    return true;
  }

  function acknowledgeMentionId(messageId: number) {
    if (acknowledgedMentionIds.value.has(messageId)) return;
    acknowledgedMentionIds.value = new Set([...acknowledgedMentionIds.value, messageId]);
    saveAcknowledgedMentionIds();
  }

  return {
    linkPreviewCache,
    mentionToasts,
    acknowledgedMentionIds,
    messagePreviewUrl,
    messageContentHtml,
    markdownMessageHtml,
    aiMessageHtml,
    textContentHtml,
    bibleRichTextSegmentsFromHtml,
    messageRichTextSegments,
    prayerRichTextSegments,
    linkPreviewFor,
    ensureVisibleLinkPreviews,
    channelName,
    messageMentionsCurrentUser,
    messagePreviewText,
    queueMentionToast,
    loadAcknowledgedMentionIds,
    isMentionAlertActive,
    acknowledgeMentionAlert,
    acknowledgeMentionId
  };
}
