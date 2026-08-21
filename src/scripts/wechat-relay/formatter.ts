import sanitizeHtml from "sanitize-html";
import type { MessageDTO } from "../../shared/types.js";

export interface FormatOptions {
  maxContentLength: number;
  messageUrlTemplate?: string;
}
function plainText(content: string) {
  const withLineBreaks = content
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|blockquote|h[1-6])>/gi, "\n");
  return sanitizeHtml(withLineBreaks, { allowedTags: [], allowedAttributes: {} })
    .replace(/\r/g, "")
    .replace(/[\t ]+\n/g, "\n")
    .replace(/\n[\t ]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function attachmentLabel(message: MessageDTO) {
  switch (message.type) {
    case "image":
      return message.fileName ? `【图片】${message.fileName}` : "【图片】";
    case "file":
      return message.fileName ? `【文件】${message.fileName}` : "【文件】";
    case "music_playlist":
      return "【歌单】";
    case "chain":
      return "【接龙】";
    case "prayer":
      return "【祷告】";
    case "why_topic_card":
      return "【话题卡片】";
    case "system":
      return "【系统消息】";
    case "text":
      return "";
  }
}

function messageLink(template: string | undefined, message: MessageDTO) {
  if (!template) return "";
  return template
    .replaceAll("{channelId}", String(message.channelId))
    .replaceAll("{messageId}", String(message.id));
}

export function formatRelayMessage(message: MessageDTO, options: FormatOptions) {
  const label = attachmentLabel(message);
  const content = plainText(message.content || "");
  const combined = [label, content].filter(Boolean).join(content && label ? "\n" : "");
  const body = combined.length > options.maxContentLength
    ? `${combined.slice(0, Math.max(1, options.maxContentLength - 1)).trimEnd()}…`
    : combined || "【无文字内容】";
  const link = messageLink(options.messageUrlTemplate, message);
  return [
    `【通知 #${message.id}】`,
    `发送者：${message.sender.displayName}`,
    "",
    body,
    ...(link ? ["", `查看原消息：${link}`] : [])
  ].join("\n");
}
