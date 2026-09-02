import assert from "node:assert/strict";
import test from "node:test";
import { favoriteNotificationToTopNotice, likeNotificationToTopNotice } from "./likeNotification";

test("like notifications become clickable top notices for the liked message", () => {
  assert.deepEqual(
    likeNotificationToTopNotice(
      { id: 7, channelId: 3, messageId: 42, senderName: "我", likerName: "小明", createdAt: "2026-07-11T00:00:00.000Z" },
      "日常交通"
    ),
    {
      id: "like-7",
      kind: "like",
      title: "小明点赞了你的消息",
      body: "日常交通 · 点击查看",
      channelId: 3,
      messageId: 42,
      notificationId: 7
    }
  );
});

test("favorite notifications use the same clickable message notice shape", () => {
  assert.deepEqual(
    favoriteNotificationToTopNotice(
      { id: 9, channelId: 3, messageId: 42, senderName: "我", favoriterName: "小红", createdAt: "2026-07-11T00:00:00.000Z" },
      "日常交通"
    ),
    {
      id: "favorite-9",
      kind: "favorite",
      title: "小红收藏了你的消息",
      body: "日常交通 · 点击查看",
      channelId: 3,
      messageId: 42,
      notificationId: 9
    }
  );
});
