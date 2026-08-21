import type { MessageDTO } from "./types.js";

export const WECHAT_RELAY_TEMPLATE_KEYS = [
  "message",
  "mention",
  "prayer",
  "prayerUpdate",
  "attachment",
  "other"
] as const;

export type WeChatRelayTemplateKey = (typeof WECHAT_RELAY_TEMPLATE_KEYS)[number];

export type WeChatRelayTemplates = Record<WeChatRelayTemplateKey, string[]>;

export const DEFAULT_WECHAT_RELAY_TEMPLATES: WeChatRelayTemplates = {
  message: [
    "{name}说话了",
    "{name}来消息了",
    "聊天室里{name}开口了"
  ],
  mention: [
    "{name}给你说话了",
    "{name}叫你了",
    "{name}在等你回应"
  ],
  prayer: [
    "{name}发送了代祷事项",
    "{name}邀请大家一起代祷",
    "有新的代祷事项，是{name}发来的"
  ],
  prayerUpdate: [
    "代祷信息更新了",
    "{name}更新了代祷事项",
    "有新的代祷进展，去看看吧"
  ],
  attachment: [
    "{name}分享了{kind}",
    "{name}发来了{kind}",
    "聊天室里有{name}分享的新内容"
  ],
  other: [
    "{name}在聊天室有新动态",
    "聊天室有新动静了",
    "{name}带来了新消息"
  ]
};

function prayerSourceId(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return 0;
  const sourceId = Number((payload as { sourcePrayerMessageId?: unknown }).sourcePrayerMessageId || 0);
  return Number.isInteger(sourceId) && sourceId > 0 ? sourceId : 0;
}

function containsMention(content: string) {
  const visible = content.replace(/<[^>]*>/g, " ");
  return /(^|[\s，。！？、,.!?:;；：])@(?!@)[^\s，。！？、,.!?:;；：<]{1,80}/u.test(visible);
}

export function weChatRelayTemplateKey(message: Pick<MessageDTO, "id" | "type" | "content" | "payload">): WeChatRelayTemplateKey {
  if (message.type === "prayer") {
    const sourceId = prayerSourceId(message.payload);
    return sourceId && sourceId !== message.id ? "prayerUpdate" : "prayer";
  }
  if (["image", "file", "music_playlist", "chain"].includes(message.type)) return "attachment";
  if (message.type === "text") return containsMention(message.content || "") ? "mention" : "message";
  return "other";
}

function attachmentKind(message: Pick<MessageDTO, "type">) {
  switch (message.type) {
    case "image": return "一张图片";
    case "file": return "一个文件";
    case "music_playlist": return "一个歌单";
    case "chain": return "一条接龙";
    default: return "新内容";
  }
}

export function renderWeChatRelayNotification(
  message: Pick<MessageDTO, "id" | "type" | "content" | "payload" | "sender">,
  templates: WeChatRelayTemplates = DEFAULT_WECHAT_RELAY_TEMPLATES
) {
  const key = weChatRelayTemplateKey(message);
  const choices = templates[key]?.length ? templates[key] : DEFAULT_WECHAT_RELAY_TEMPLATES[key];
  const template = choices[Math.abs(message.id) % choices.length];
  return template
    .replaceAll("{name}", message.sender.displayName.trim() || "有人")
    .replaceAll("{kind}", attachmentKind(message))
    .trim();
}
