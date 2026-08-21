import assert from "node:assert/strict";
import test from "node:test";
import type { ChannelDTO } from "../shared/types";
import { noteChannelMessage, orderChannels } from "./channelOrdering";

function channel(id: number, options: Partial<ChannelDTO> = {}) {
  return { id, name: `Channel ${id}`, description: "", icon: "", listColor: null, kind: "standard", isPrivate: false, isDefault: false, memberCount: 1, lastMessageId: null, ...options } as ChannelDTO;
}

test("default channel stays first while other channels follow latest activity", () => {
  const ordered = orderChannels([
    channel(3, { lastMessageId: 30 }),
    channel(1, { isDefault: true, lastMessageId: 10 }),
    channel(2, { lastMessageId: 50 })
  ]);
  assert.deepEqual(ordered.map((row) => row.id), [1, 2, 3]);
});

test("a new message moves its channel directly below the default channel", () => {
  const channels = orderChannels([channel(1, { isDefault: true }), channel(2, { lastMessageId: 20 }), channel(3, { lastMessageId: 10 })]);
  const ordered = noteChannelMessage(channels, 3, 21);
  assert.deepEqual(ordered.map((row) => row.id), [1, 3, 2]);
  assert.equal(ordered.find((row) => row.id === 3)?.lastMessageId, 21);
});
