import type { LikeNotificationDTO } from "@shared/types";

export type LikeTopNotice = {
  id: string;
  kind: "like";
  title: string;
  body: string;
  channelId: number;
  messageId: number;
  notificationId: number;
};

export function likeNotificationToTopNotice(notification: LikeNotificationDTO, channelName?: string): LikeTopNotice {
  return {
    id: `like-${notification.id}`,
    kind: "like",
    title: `${notification.likerName}点赞了你的消息`,
    body: `${channelName || "聊天消息"} · 点击查看`,
    channelId: notification.channelId,
    messageId: notification.messageId,
    notificationId: notification.id
  };
}
