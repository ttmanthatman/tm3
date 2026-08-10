import assert from "node:assert/strict";
import test from "node:test";
import type { ChannelDTO, MessageDTO } from "../shared/types";
import { mergeChannelUpdate, mergeMessageUpdate } from "./messageUpdates";

function message(partial: Partial<MessageDTO>): MessageDTO {
  return { id: 1, channelId: 1, type: "text", content: "hello", ...partial } as MessageDTO;
}

test("mergeMessageUpdate keeps the viewer's own listen and reaction state", () => {
  const existing = message({
    voiceListened: true,
    reactions: { likeCount: 2, likedBy: [], favoriteCount: 1, currentUserLiked: true, currentUserFavorited: false }
  });
  const incoming = message({
    voiceListened: false,
    content: "edited",
    reactions: { likeCount: 3, likedBy: [], favoriteCount: 2, currentUserLiked: false, currentUserFavorited: true }
  });
  const merged = mergeMessageUpdate(existing, incoming);
  assert.equal(merged.voiceListened, true);
  assert.equal(merged.content, "edited");
  assert.equal(merged.reactions?.likeCount, 3);
  assert.equal(merged.reactions?.currentUserLiked, true);
  assert.equal(merged.reactions?.currentUserFavorited, false);
});

test("mergeMessageUpdate keeps the viewer's prayer mark on prayer messages", () => {
  const existing = message({ type: "prayer", payload: { kind: "prayer", currentUserPrayed: true, prayerCount: 2 } });
  const incoming = message({ type: "prayer", payload: { kind: "prayer", currentUserPrayed: false, prayerCount: 3 } });
  const merged = mergeMessageUpdate(existing, incoming);
  assert.equal((merged.payload as { currentUserPrayed: boolean }).currentUserPrayed, true);
  assert.equal((merged.payload as { prayerCount: number }).prayerCount, 3);
});

test("mergeMessageUpdate passes through when there is no existing row", () => {
  const incoming = message({ voiceListened: false });
  assert.equal(mergeMessageUpdate(undefined, incoming), incoming);
});

test("mergeChannelUpdate takes neutral fields but keeps permissions, lastMessageId, and pinned", () => {
  const existing = {
    id: 1,
    name: "Old",
    canManage: false,
    canWrite: true,
    canPin: false,
    lastMessageId: 42,
    pinned: { id: 9 }
  } as unknown as ChannelDTO;
  const incoming = {
    id: 1,
    name: "New name",
    memberCount: 7,
    canManage: true,
    canWrite: false,
    canPin: true,
    lastMessageId: null,
    pinned: null
  } as unknown as ChannelDTO;
  const merged = mergeChannelUpdate(existing, incoming);
  assert.equal(merged.name, "New name");
  assert.equal(merged.memberCount, 7);
  assert.equal(merged.canManage, false);
  assert.equal(merged.canWrite, true);
  assert.equal(merged.canPin, false);
  assert.equal(merged.lastMessageId, 42);
  assert.deepEqual(merged.pinned, { id: 9 });
});
