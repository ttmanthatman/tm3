import type { MessageDTO } from "./types.js";

export const WECHAT_RELAY_TEMPLATE_KEYS = [
  "message", "mention", "prayer", "prayerUpdate", "image", "file", "voice",
  "musicPlaylist", "chain", "whyTopic", "pinned", "versionUpdate", "system", "other"
] as const;

export type WeChatRelayTemplateKey = (typeof WECHAT_RELAY_TEMPLATE_KEYS)[number];
export type WeChatRelayTemplates = Record<WeChatRelayTemplateKey, string[]>;

export interface WeChatRelayUserMapping {
  accountId: number;
  wechatName: string;
}

export interface WeChatRelayMentionTarget {
  accountId: number;
  displayName: string;
  username: string;
  wechatName?: string;
}

export interface WeChatRelayRenderContext {
  channel?: string;
  group?: string;
  systemPrefix?: string;
  senderWechatName?: string;
  mentions?: WeChatRelayMentionTarget[];
  title?: string;
  version?: string;
}

export const WECHAT_RELAY_TEMPLATE_VARIABLES = [
  { key: "name", label: "发送人昵称", example: "小夏" },
  { key: "username", label: "发送人账号", example: "xiaoxia" },
  { key: "wechatName", label: "发送人的微信名", example: "夏天" },
  { key: "channel", label: "来源频道", example: "综合频道" },
  { key: "group", label: "目标微信群", example: "通知群" },
  { key: "type", label: "通知类别", example: "普通发言" },
  { key: "kind", label: "内容种类", example: "一张图片" },
  { key: "content", label: "正文摘要", example: "请大家留意今晚安排" },
  { key: "fileName", label: "附件文件名", example: "安排表.pdf" },
  { key: "fileSize", label: "附件大小", example: "1.2 MB" },
  { key: "mentions", label: "被提到的聊天室用户", example: "小明、小美" },
  { key: "wechatMentions", label: "对应的微信名", example: "明明、美美" },
  { key: "mentionCount", label: "聊天室 @ 人数", example: "2" },
  { key: "wechatMentionCount", label: "可定向微信 @ 人数", example: "2" },
  { key: "title", label: "系统消息标题", example: "本周聚会安排" },
  { key: "version", label: "系统版本", example: "1.13.0" },
  { key: "systemPrefix", label: "系统消息前缀", example: "系统消息" },
  { key: "messageId", label: "聊天室消息编号", example: "123" },
  { key: "date", label: "日期", example: "2026/8/22" },
  { key: "time", label: "时间", example: "20:30" },
  { key: "datetime", label: "日期和时间", example: "2026/8/22 20:30" }
] as const;

export const WECHAT_RELAY_TEMPLATE_VARIABLE_KEYS = new Set<string>(
  WECHAT_RELAY_TEMPLATE_VARIABLES.map((variable) => variable.key)
);

export const DEFAULT_WECHAT_RELAY_TEMPLATES: WeChatRelayTemplates = {
  message: ["{name}说话了", "{name}来消息了", "聊天室里{name}开口了"],
  mention: ["{name}在聊天室里@了{mentions}", "{name}在等{mentions}回应", "{mentions}，{name}给你说话了"],
  prayer: ["{name}发送了代祷事项", "{name}邀请大家一起代祷", "有新的代祷事项，是{name}发来的"],
  prayerUpdate: ["代祷信息更新了", "{name}更新了代祷事项", "有新的代祷进展，去看看吧"],
  image: ["{name}分享了一张图片", "{name}发来了一张图片"],
  file: ["{name}分享了文件 {fileName}", "{name}发来了一个文件"],
  voice: ["{name}发来了一条语音", "聊天室里有{name}的新语音"],
  musicPlaylist: ["{name}分享了一个歌单", "聊天室里有{name}分享的新歌单"],
  chain: ["{name}发起了接龙：{content}", "{name}更新了接龙"],
  whyTopic: ["{name}分享了一个‘为什么’话题", "聊天室里有{name}分享的新话题"],
  pinned: ["【{systemPrefix}】{channel}更新了置顶消息：{title}"],
  versionUpdate: ["【{systemPrefix}】聊天室已升级到 v{version}"],
  system: ["【{systemPrefix}】{content}"],
  other: ["{name}在聊天室有新动态", "聊天室有新动静了", "{name}带来了新消息"]
};

function recordPayload(payload: unknown) {
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
}

function prayerSourceId(payload: unknown) {
  const sourceId = Number(recordPayload(payload).sourcePrayerMessageId || 0);
  return Number.isInteger(sourceId) && sourceId > 0 ? sourceId : 0;
}

function visibleText(content: string) {
  return content
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function containsMention(content: string) {
  return /(^|[\s，。！？、,.!?:;；：])@(?!@)[^\s，。！？、,.!?:;；：<]{1,80}/u.test(visibleText(content));
}

function isVoice(message: Pick<MessageDTO, "type" | "payload">) {
  return message.type === "file" && recordPayload(message.payload).kind === "voice";
}

export function weChatRelayTemplateKey(message: Pick<MessageDTO, "id" | "type" | "content" | "payload">): WeChatRelayTemplateKey {
  if (message.type === "prayer") {
    const sourceId = prayerSourceId(message.payload);
    return sourceId && sourceId !== message.id ? "prayerUpdate" : "prayer";
  }
  if (message.type === "image") return "image";
  if (isVoice(message)) return "voice";
  if (message.type === "file") return "file";
  if (message.type === "music_playlist") return "musicPlaylist";
  if (message.type === "chain") return "chain";
  if (message.type === "why_topic_card") return "whyTopic";
  if (message.type === "text") return containsMention(message.content || "") ? "mention" : "message";
  if (message.type === "system") {
    const kind = recordPayload(message.payload).systemKind;
    if (kind === "pinned") return "pinned";
    if (kind === "versionUpdate") return "versionUpdate";
    return "system";
  }
  return "other";
}

function attachmentKind(message: Pick<MessageDTO, "type" | "payload">) {
  const key = weChatRelayTemplateKey({ ...message, id: 0, content: "" });
  switch (key) {
    case "image": return "一张图片";
    case "voice": return "一条语音";
    case "file": return "一个文件";
    case "musicPlaylist": return "一个歌单";
    case "chain": return "一条接龙";
    default: return "新内容";
  }
}

function typeLabel(key: WeChatRelayTemplateKey) {
  return ({
    message: "普通发言", mention: "@ 提醒", prayer: "新代祷", prayerUpdate: "代祷更新",
    image: "图片", file: "文件", voice: "语音", musicPlaylist: "歌单", chain: "接龙", whyTopic: "为什么话题",
    pinned: "置顶消息", versionUpdate: "版本升级", system: "系统消息", other: "其他动态"
  } satisfies Record<WeChatRelayTemplateKey, string>)[key];
}

function compactBytes(value: number | null | undefined) {
  if (!value || value < 1) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function weChatRelayTemplateVariables(
  message: Pick<MessageDTO, "id" | "type" | "content" | "payload" | "sender" | "fileName" | "fileSize" | "createdAt">,
  context: WeChatRelayRenderContext = {}
) {
  const key = weChatRelayTemplateKey(message);
  const payload = recordPayload(message.payload);
  const timestamp = new Date(message.createdAt);
  const validTime = Number.isFinite(timestamp.getTime());
  const date = validTime ? timestamp.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }) : "";
  const time = validTime ? timestamp.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Shanghai" }) : "";
  const mentions = context.mentions || [];
  return {
    name: message.sender.displayName.trim() || "有人",
    username: message.sender.username.trim(),
    wechatName: context.senderWechatName?.trim() || message.sender.displayName.trim() || "有人",
    channel: context.channel?.trim() || "聊天室",
    group: context.group?.trim() || "微信群",
    type: typeLabel(key),
    kind: attachmentKind(message),
    content: visibleText(message.content || "").slice(0, 200),
    fileName: message.fileName?.trim() || "",
    fileSize: compactBytes(message.fileSize),
    mentions: mentions.map((target) => target.displayName).join("、"),
    wechatMentions: mentions.flatMap((target) => target.wechatName ? [target.wechatName] : []).join("、"),
    mentionCount: String(mentions.length),
    wechatMentionCount: String(mentions.filter((target) => target.wechatName).length),
    title: context.title?.trim() || String(payload.title || "").trim(),
    version: context.version?.trim() || String(payload.version || "").trim(),
    systemPrefix: context.systemPrefix?.trim() || "系统消息",
    messageId: String(message.id),
    date,
    time,
    datetime: [date, time].filter(Boolean).join(" ")
  };
}

export function renderWeChatRelayTemplate(template: string, variables: Record<string, string>) {
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (match, key: string) => (
    Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] : match
  )).trim();
}

export function renderWeChatRelayNotification(
  message: Pick<MessageDTO, "id" | "type" | "content" | "payload" | "sender" | "fileName" | "fileSize" | "createdAt">,
  templates: WeChatRelayTemplates = DEFAULT_WECHAT_RELAY_TEMPLATES,
  context: WeChatRelayRenderContext = {}
) {
  const key = weChatRelayTemplateKey(message);
  const choices = templates[key]?.length ? templates[key] : DEFAULT_WECHAT_RELAY_TEMPLATES[key];
  const template = choices[Math.abs(message.id) % choices.length];
  return renderWeChatRelayTemplate(template, weChatRelayTemplateVariables(message, context));
}
