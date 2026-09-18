import { nextTick, ref, watch } from "vue";
import type { MessageDTO } from "@shared/types";
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
import { createLinkPreviewQueue, type LinkPreviewState } from "./linkPreviewQueue";

export type { LinkPreviewState } from "./linkPreviewQueue";
export type MentionToast = { id: number; channelId: number; channelName: string; senderName: string; text: string; createdAt: string };

interface UseMessageRenderingOptions {
  linkifyMessageHtml: LinkifyMessageHtml;
  isMine: (message: MessageDTO) => boolean;
  reconcileReadPositionAfterLayout: () => void;
  // 预览预取只针对实际渲染窗口（虚拟时间线可见区 + overscan）内的消息；
  // 缺省退回全部已加载消息（仅测试或无虚拟窗口场景）。
  visibleMessages?: () => MessageDTO[];
  // 测试注入口：默认从消息 HTML 提取首个链接（需要 DOM）。
  previewUrlFor?: (message: MessageDTO) => string;
  // 测试注入口：覆盖失败重试退避节奏。
  linkPreviewRetryDelaysMs?: readonly number[];
}

export function useMessageRendering(options: UseMessageRenderingOptions) {
  const store = useChatStore();
  const linkPreviewCache = ref<Record<string, LinkPreviewState>>({});
  let linkPreviewGeneration = 0;
  const linkPreviewQueue = createLinkPreviewQueue({
    fetchPreview: (url, signal) => api(`/api/link-preview?url=${encodeURIComponent(url)}`, { signal }),
    retryDelaysMs: options.linkPreviewRetryDelaysMs,
    onPreviewReady: () => {
      const generation = linkPreviewGeneration;
      void nextTick(() => {
        // 卡片渲染会改变行高；切频道后落地的旧请求不再触碰新频道布局。
        if (generation === linkPreviewGeneration) options.reconcileReadPositionAfterLayout();
      });
    }
  });
  linkPreviewQueue.onStateChange(() => {
    linkPreviewCache.value = linkPreviewQueue.state();
  });
  const mentionToasts = ref<MentionToast[]>([]);
  const acknowledgedMentionIds = ref<Set<number>>(new Set());

  const messagePreviewUrl = memoizeMessage((message: MessageDTO) => {
    if (message.type !== "text" && message.type !== "prayer") return "";
    return extractMessageUrls(message.content)[0] || "";
  });

  const previewUrlFor = options.previewUrlFor || messagePreviewUrl;

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
    const url = previewUrlFor(message);
    if (!url) return null;
    // 渲染期必须读取 ref 保持响应式；previewFor 顺带刷新缓存淘汰顺序。
    const state = linkPreviewCache.value[url];
    return state?.status === "ready" ? linkPreviewQueue.previewFor(url) : null;
  }

  function ensureVisibleLinkPreviews() {
    if (!store.account) return;
    const messages = options.visibleMessages ? options.visibleMessages() : store.messages;
    linkPreviewQueue.ensureVisible([...new Set(messages.map(previewUrlFor).filter(Boolean))]);
  }

  // 切频道/切换代祷或恩典视图：丢弃旧队列并中止进行中请求（不算失败，可重新请求）；
  // 换账号：整池缓存作废，避免跨账号残留。
  watch(
    () => [store.currentChannelId, store.prayerOnly, store.graceOnly, store.account?.id] as const,
    (current, previous) => {
      linkPreviewGeneration += 1;
      linkPreviewQueue.reset({ clearCache: current[3] !== previous[3] });
    }
  );

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
