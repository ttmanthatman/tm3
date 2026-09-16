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

test("dismissing a favorite notification removes it locally and syncs the dismissal to the server", async () => {
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, String(value)),
      removeItem: (key: string) => void storage.delete(key),
      clear: () => storage.clear()
    }
  });
  Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
  storage.set("team-chat-token", "token-1");

  const requests: { url: string; method?: string }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), method: init?.method });
    return {
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ success: true }),
      text: async () => "{}"
    } as unknown as Response;
  }) as typeof fetch;

  const { createPinia, setActivePinia } = await import("pinia");
  const { ref } = await import("vue");
  const { useChatStore } = await import("./store");
  const { useMessageActions } = await import("./features/messages/useMessageActions");

  setActivePinia(createPinia());
  const store = useChatStore();
  store.favoriteNotifications = [
    { id: 1, channelId: 3, messageId: 42, senderName: "我", favoriterName: "小红", createdAt: "2026-07-11T00:00:00.000Z" },
    { id: 2, channelId: 3, messageId: 43, senderName: "我", favoriterName: "小明", createdAt: "2026-07-11T00:01:00.000Z" }
  ];

  const actions = useMessageActions({
    scroller: ref(null),
    showFavorites: ref(false),
    oopsActiveMessageIds: ref(new Set<number>()),
    messageEffect: () => null,
    requestDeviceOrientationPermissionOnce: () => undefined,
    stirWaterMessage: () => undefined,
    settleWaterMessage: () => undefined,
    positionPromptNearEvent: () => ({ x: 0, y: 0 }),
    suppressNextTap: () => undefined,
    openFavoriteMessage: async () => undefined,
    openFavorites: async () => undefined,
    openEditChannelEditor: () => undefined,
    pickReply: () => undefined,
    closeCompetingPrompts: () => undefined
  });

  await actions.dismissFavoriteNotification(1);
  assert.deepEqual(store.favoriteNotifications.map((item) => item.id), [2]);
  assert.deepEqual(requests, [{ url: "/api/favorite-notifications/1/dismiss", method: "PATCH" }]);
});

test("favorite notification dismissal keeps the local removal when the sync fails", async () => {
  globalThis.fetch = (async () => {
    return {
      ok: false,
      status: 500,
      headers: { get: () => "application/json" },
      json: async () => ({ success: false, message: "err" }),
      text: async () => "{}"
    } as unknown as Response;
  }) as typeof fetch;

  const { createPinia, setActivePinia } = await import("pinia");
  const { ref } = await import("vue");
  const { useChatStore } = await import("./store");
  const { useMessageActions } = await import("./features/messages/useMessageActions");

  setActivePinia(createPinia());
  const store = useChatStore();
  store.favoriteNotifications = [
    { id: 5, channelId: 3, messageId: 42, senderName: "我", favoriterName: "小红", createdAt: "2026-07-11T00:00:00.000Z" }
  ];

  const actions = useMessageActions({
    scroller: ref(null),
    showFavorites: ref(false),
    oopsActiveMessageIds: ref(new Set<number>()),
    messageEffect: () => null,
    requestDeviceOrientationPermissionOnce: () => undefined,
    stirWaterMessage: () => undefined,
    settleWaterMessage: () => undefined,
    positionPromptNearEvent: () => ({ x: 0, y: 0 }),
    suppressNextTap: () => undefined,
    openFavoriteMessage: async () => undefined,
    openFavorites: async () => undefined,
    openEditChannelEditor: () => undefined,
    pickReply: () => undefined,
    closeCompetingPrompts: () => undefined
  });

  await actions.dismissFavoriteNotification(5);
  assert.deepEqual(store.favoriteNotifications, []);
});
