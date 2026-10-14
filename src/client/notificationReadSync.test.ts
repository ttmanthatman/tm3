import assert from "node:assert/strict";
import test from "node:test";
import { createPinia, setActivePinia } from "pinia";
import type { AccountDTO } from "../shared/types";
import { HANDWRITING_DEFAULT_PREFERENCES } from "../shared/handwriting";
import { pendingNotificationReads } from "./features/messages/notificationReadQueue";

const values = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key)
} });
Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
const { useChatStore } = await import("./store");
const account: AccountDTO = { id: 1, username: "reader", displayName: "Reader", avatarPath: null, isAdmin: false, canPinMessages: false, actorId: 1, theme: "default", handwritingPreferences: HANDWRITING_DEFAULT_PREFERENCES, biblePreferences: { outputFormat: "referenceVerseLines", referenceLabelMode: "normalizedFull", combinedPassageMode: "compactEllipsis", quotationStyle: "fullWidth" } };
const favorite = { id: 2, channelId: 3, messageId: 42, senderName: "Reader", favoriterName: "Friend", createdAt: "2026-10-14T00:00:00Z" };

function response(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }); }

test("a stale notification response cannot resurrect a read arriving from another device", async () => {
  values.clear();
  setActivePinia(createPinia());
  const store = useChatStore();
  store.account = account;
  let release!: (value: Response) => void;
  const pending = new Promise<Response>((resolve) => { release = resolve; });
  globalThis.fetch = async (url) => String(url).includes("like-notifications") ? pending : response({ ids: [] });
  const loading = store.loadLikeNotifications();
  assert.equal(store.notificationReadsReady, false);
  store.applyNotificationRead({ kind: "favorite", id: 2 });
  store.applyNotificationRead({ kind: "mention", id: 100 });
  release(response({ notifications: [], favoriteNotifications: [favorite] }));
  await loading;
  assert.deepEqual(store.favoriteNotifications, []);
  assert.deepEqual(store.acknowledgedMentionIds, [100]);
  assert.equal(store.notificationReadsReady, true);
});

test("failed reads survive a new store and retry, including old browser-only mentions", async () => {
  values.clear();
  setActivePinia(createPinia());
  let store = useChatStore();
  store.account = account;
  globalThis.fetch = async () => response({ message: "offline" }, 503);
  await assert.rejects(store.acknowledgeNotification({ kind: "favorite", id: 2 }));
  assert.equal(pendingNotificationReads(1).length, 1);
  assert.match(store.notificationReadError, /重试/);
  values.set("team-chat-mention-acknowledged-1", "[100]");
  setActivePinia(createPinia());
  store = useChatStore();
  store.account = account;
  const writes: string[] = [];
  globalThis.fetch = async (url, init) => {
    if (init?.method === "PATCH") { writes.push(String(url)); return response({ success: true }); }
    if (String(url).includes("mentions/read")) return response({ ids: [200] });
    return response({ notifications: [], favoriteNotifications: [favorite] });
  };
  await store.loadLikeNotifications();
  assert.equal(writes.length, 2);
  assert.deepEqual(pendingNotificationReads(1), []);
  assert.deepEqual(store.favoriteNotifications, []);
  assert.deepEqual(store.acknowledgedMentionIds, [100, 200]);
  assert.equal(values.has("team-chat-mention-acknowledged-1"), false);
});


test("legacy migration batches all 500 old mention reads into one write", async () => {
  values.clear();
  values.set("team-chat-mention-acknowledged-1", JSON.stringify(Array.from({ length: 500 }, (_, index) => index + 1)));
  setActivePinia(createPinia());
  const store = useChatStore();
  store.account = account;
  const batches: number[][] = [];
  globalThis.fetch = async (url, init) => {
    if (init?.method === "PATCH") { batches.push(JSON.parse(String(init.body)).ids); return response({ success: true }); }
    if (String(url).includes("mentions/read")) return response({ ids: [] });
    return response({ notifications: [] });
  };
  await store.loadLikeNotifications();
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 500);
  assert.equal(store.acknowledgedMentionIds.length, 500);
  assert.deepEqual(pendingNotificationReads(1), []);
});


test("a deleted reaction retires its pending read without blocking the next one", async () => {
  values.clear();
  setActivePinia(createPinia());
  const store = useChatStore();
  store.account = account;
  globalThis.fetch = async () => response({ message: "offline" }, 503);
  await assert.rejects(store.acknowledgeNotification({ kind: "favorite", id: 2 }));
  await assert.rejects(store.acknowledgeNotification({ kind: "like", id: 3 }));
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("favorite-notifications")) return response({ message: "提醒不存在" }, 404);
    if (init?.method === "PATCH") return response({ success: true });
    return String(url).includes("mentions/read") ? response({ ids: [] }) : response({ notifications: [] });
  };
  await store.loadLikeNotifications();
  assert.deepEqual(pendingNotificationReads(1), []);
  assert.equal(store.notificationReadError, "");
});
