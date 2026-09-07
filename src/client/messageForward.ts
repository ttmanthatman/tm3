import type { ChannelDTO, ChatRecordItemDTO, ChatRecordPayloadDTO, MessageDTO } from "@shared/types";

// 与服务端转发白名单保持一致：只有文本、图片、文件（含语音/音频/视频）可以转发。
export const FORWARDABLE_TYPES: ReadonlySet<MessageDTO["type"]> = new Set(["text", "image", "file"]);

export function isForwardableMessage(message: MessageDTO) {
  if (message.id <= 0) return false;
  if (!FORWARDABLE_TYPES.has(message.type)) return false;
  if (message.type === "text" && !message.content?.trim()) return false;
  return true;
}

export function forwardableMessages(messages: MessageDTO[]): { supported: MessageDTO[]; skippedCount: number } {
  const supported = messages.filter(isForwardableMessage);
  return { supported, skippedCount: messages.length - supported.length };
}

// 可转发到的目标：公开/私密聊天频道与私聊，且当前账号可发言；不排除当前频道（允许转发回当前聊天）。
export function forwardTargetChannels(channels: ChannelDTO[]): ChannelDTO[] {
  return channels.filter((channel) => (channel.kind === "standard" || channel.kind === "direct") && channel.canWrite !== false);
}

const PREVIEW_TEXT_LIMIT = 50;

function chatRecordItemSummary(item: ChatRecordItemDTO): string {
  if (item.type === "image") return "[图片]";
  if (item.type === "file") {
    if (item.voiceDurationMs) return "[语音]";
    return item.fileName ? `[文件] ${item.fileName}` : "[文件]";
  }
  const content = (item.content || "").replace(/\s+/g, " ").trim();
  return content.length > PREVIEW_TEXT_LIMIT ? `${content.slice(0, PREVIEW_TEXT_LIMIT)}…` : content;
}

export function chatRecordPreviewLines(payload: ChatRecordPayloadDTO, maxLines = 4): string[] {
  return payload.items.slice(0, maxLines).map((item) => `${item.senderName}: ${chatRecordItemSummary(item)}`);
}

export function chatRecordItemUrl(recordMessageId: number, index: number, token: string): string {
  return `/api/files/${recordMessageId}?item=${index}&token=${encodeURIComponent(token)}`;
}

export function chatRecordPreviewTitle(channelName: string): string {
  return `${channelName || "当前聊天"}的聊天记录`;
}

// 合并转发确认态的静态预览 payload；服务端会重算真实标题与条目，这里只用于展示。
export function chatRecordPreviewPayload(title: string, sourceChannelId: number, messages: MessageDTO[]): ChatRecordPayloadDTO {
  return {
    kind: "chat_record",
    title,
    sourceChannelId,
    itemCount: messages.length,
    items: messages.map((message) => {
      const payload = message.payload as { durationMs?: number } | undefined;
      return {
        senderName: message.sender.displayName,
        senderAvatarPath: message.sender.avatarPath,
        type: message.type === "image" ? "image" : message.type === "file" ? "file" : "text",
        content: message.content,
        fileName: message.fileName || undefined,
        voiceDurationMs: typeof payload?.durationMs === "number" ? payload.durationMs : undefined,
        createdAt: message.createdAt
      };
    })
  };
}
