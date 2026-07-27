import assert from "node:assert/strict";
import test from "node:test";
import {
  UNREAD_COUNT_CAP,
  emptyUnreadState,
  formatUnreadCount,
  isOwnMessage,
  loadUnreadState,
  normalizeUnreadState,
  noteUnreadIncoming,
  planChannelSeed,
  recordChannelRead,
  saveUnreadState,
  unreadStorageKey
} from "./unread";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }
}

test("formatUnreadCount caps the badge label at 99+", () => {
  assert.equal(formatUnreadCount(1), "1");
  assert.equal(formatUnreadCount(98), "98");
  assert.equal(formatUnreadCount(99), "99+");
  assert.equal(formatUnreadCount(140), "99+");
  assert.equal(formatUnreadCount(0), "0");
});

test("noteUnreadIncoming increments other-channel messages from other senders", () => {
  const state = emptyUnreadState();
  noteUnreadIncoming(state, { channelId: 7, messageId: 50, own: false, current: false, chatCapable: true });
  noteUnreadIncoming(state, { channelId: 7, messageId: 51, own: false, current: false, chatCapable: true });
  assert.equal(state.counts[7], 2);
  assert.equal(state.lastRead[7], undefined);
});

test("noteUnreadIncoming caps the stored count at 99", () => {
  const state = emptyUnreadState();
  for (let messageId = 1; messageId <= 130; messageId += 1) {
    noteUnreadIncoming(state, { channelId: 3, messageId, own: false, current: false, chatCapable: true });
  }
  assert.equal(state.counts[3], UNREAD_COUNT_CAP);
});

test("noteUnreadIncoming treats current-channel and own messages as read", () => {
  const state = emptyUnreadState();
  state.counts[5] = 4;
  noteUnreadIncoming(state, { channelId: 5, messageId: 90, own: false, current: true, chatCapable: true });
  assert.equal(state.counts[5], 0);
  assert.equal(state.lastRead[5], 90);
  noteUnreadIncoming(state, { channelId: 6, messageId: 42, own: true, current: false, chatCapable: true });
  assert.equal(state.counts[6], 0);
  assert.equal(state.lastRead[6], 42);
});

test("noteUnreadIncoming ignores channels without chat", () => {
  const state = emptyUnreadState();
  noteUnreadIncoming(state, { channelId: 9, messageId: 10, own: false, current: false, chatCapable: false });
  assert.deepEqual(state, emptyUnreadState());
});

test("recordChannelRead zeroes the count and advances the read position", () => {
  const state = emptyUnreadState();
  state.counts[2] = 12;
  recordChannelRead(state, 2, 100);
  assert.equal(state.counts[2], 0);
  assert.equal(state.lastRead[2], 100);
  recordChannelRead(state, 2, 80);
  assert.equal(state.lastRead[2], 100);
});

test("isOwnMessage matches the account actor id or username and tolerates missing data", () => {
  const account = { actorId: 11, username: "peter" };
  assert.equal(isOwnMessage({ id: 11, username: "bot" }, account), true);
  assert.equal(isOwnMessage({ id: 22, username: "peter" }, account), true);
  assert.equal(isOwnMessage({ id: 22, username: "mary" }, account), false);
  assert.equal(isOwnMessage(undefined, account), false);
  assert.equal(isOwnMessage({ id: 11, username: "peter" }, null), false);
});

test("planChannelSeed treats channels without a persisted read position as fully read", () => {
  assert.deepEqual(planChannelSeed(undefined, 77), { action: "treat-as-read", lastMessageId: 77 });
  assert.deepEqual(planChannelSeed(undefined, 0), { action: "none" });
  assert.deepEqual(planChannelSeed(undefined, null), { action: "none" });
});

test("planChannelSeed recounts only when newer messages exist beyond the read position", () => {
  assert.deepEqual(planChannelSeed(50, 50), { action: "none" });
  assert.deepEqual(planChannelSeed(50, 40), { action: "none" });
  assert.deepEqual(planChannelSeed(50, 51), { action: "recount", after: 50 });
});

test("unread state persists per account and survives a reload", () => {
  const storage = new MemoryStorage();
  const state = emptyUnreadState();
  noteUnreadIncoming(state, { channelId: 4, messageId: 30, own: false, current: false, chatCapable: true });
  recordChannelRead(state, 8, 120);
  saveUnreadState(1001, state, storage);

  const restored = loadUnreadState(1001, storage);
  assert.equal(restored.counts[4], 1);
  assert.equal(restored.counts[8], 0);
  assert.equal(restored.lastRead[8], 120);
  assert.deepEqual(loadUnreadState(2002, storage), emptyUnreadState());
  assert.equal(unreadStorageKey(1001), "team-chat-unread-1001");
});

test("loadUnreadState falls back to an empty state for corrupt payloads", () => {
  const storage = new MemoryStorage();
  storage.setItem("team-chat-unread-1", "not json");
  assert.deepEqual(loadUnreadState(1, storage), emptyUnreadState());
  storage.setItem("team-chat-unread-2", JSON.stringify([1, 2, 3]));
  assert.deepEqual(loadUnreadState(2, storage), emptyUnreadState());
});

test("normalizeUnreadState clamps counts and drops invalid entries", () => {
  const normalized = normalizeUnreadState({
    lastRead: { 5: 88, "-3": 10, abc: 5, 6: -2 },
    counts: { 5: 500, 7: "12", 8: Number.NaN }
  });
  assert.deepEqual(normalized.lastRead, { 5: 88 });
  assert.deepEqual(normalized.counts, { 5: UNREAD_COUNT_CAP, 7: 12 });
});
