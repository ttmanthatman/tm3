import type {
  AdminAttachmentDTO,
  AdminChannelDTO,
  AdminLoginLogDTO,
  AdminLoginLogKind,
  DeviceSessionDTO
} from "@shared/types";
import { friendlyDeviceName } from "@shared/activityLog";

export function adminDate(value?: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function adminDateTime(value?: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function loginLogKindLabel(kind: AdminLoginLogKind) {
  const labels: Record<AdminLoginLogKind, string> = {
    auth_login: "登录",
    auth_logout: "退出登录",
    session_replaced: "旧设备被新登录替换",
    session_revoked: "设备被撤销",
    presence_join: "进入聊天",
    presence_leave: "离开聊天",
    music_progress: "歌曲进度",
    channel_view: "查看频道",
    message_sent: "发送消息"
  };
  return labels[kind] || kind;
}

export function loginLogTone(kind: AdminLoginLogKind) {
  if (kind === "auth_login" || kind === "presence_join") return "enter";
  if (kind === "auth_logout" || kind === "presence_leave") return "leave";
  if (kind === "music_progress") return "music";
  if (kind === "channel_view" || kind === "message_sent") return "usage";
  return "system";
}

export function displayedDeviceName(log: Pick<AdminLoginLogDTO, "deviceName" | "userAgent"> | Pick<DeviceSessionDTO, "deviceName">) {
  return friendlyDeviceName(log.deviceName, "userAgent" in log ? log.userAgent || "" : "");
}

export function activityStateLabel(state?: string | null) {
  const labels: Record<string, string> = {
    started: "开始 / 恢复",
    progress: "播放中",
    paused: "暂停",
    changed: "切换歌曲",
    ended: "播放完毕",
    error: "播放出错",
    text: "文字消息",
    prayer: "代祷消息"
  };
  return state ? labels[state] || state : "";
}

export function activityDuration(value?: number | null) {
  const totalSeconds = Math.max(0, Math.round((value || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours ? `${hours} 小时` : "", minutes ? `${minutes} 分` : "", `${seconds} 秒`].filter(Boolean).join(" ");
}

export function musicProgressSummary(log: AdminLoginLogDTO) {
  const durationMs = Math.max(1, log.durationMs || 0);
  const percent = Math.min(100, Math.max(0, Math.round(((log.progressMs || 0) / durationMs) * 100)));
  return `进度 ${activityDuration(log.progressMs)} / ${activityDuration(log.durationMs)}（${percent}%） · 自然收听 ${activityDuration(log.listenedMs)}`;
}

export function backgroundAttachmentLabel(item: AdminAttachmentDTO) {
  const usage = item.usage.length ? item.usage.join("、") : "未使用";
  const date = adminDate(item.createdAt);
  return `${date ? `${date} · ` : ""}${usage} · ${item.label}`;
}

export function isImageAttachmentId(id: string) {
  const fileName = id.split(":").slice(1).join(":");
  return /\.(jpe?g|png|gif|webp|heic|heif|tiff?)$/i.test(fileName);
}

export function directConversationLabel(channel: AdminChannelDTO) {
  return channel.name.replace(/^私聊[：:]\s*/, "") || "未命名私聊";
}

export function directConversationActivity(channel: AdminChannelDTO) {
  const time = channel.lastMessageAt || channel.createdAt;
  return time ? adminDateTime(time) : "无活动记录";
}

export function themeSlug(name: string) {
  const ascii = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  return ascii || `theme-${Date.now().toString(36)}`;
}
