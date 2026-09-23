import assert from "node:assert/strict";
import test from "node:test";
import type { MessageDTO } from "@shared/types";
import {
  HANDWRITING_PLAYBACK_QUEUE_LIMIT,
  HANDWRITING_PLAYBACK_TTL_MS,
  createHandwritingPlaybackRegistry
} from "./handwritingPlaybackRegistry.js";

function message(id: number, channelId = 3, senderId = 9): MessageDTO {
  return {
    id,
    channelId,
    type: "handwriting",
    content: "[手写消息]",
    payload: { kind: "handwriting", version: 1, characters: [{ strokes: [{ points: [[1, 2, 0]] }] }] },
    sender: { id: senderId, kind: "human", username: `user-${senderId}`, displayName: `User ${senderId}` },
    createdAt: "2026-09-23T00:00:00.000Z"
  };
}

function claim(registry: ReturnType<typeof createHandwritingPlaybackRegistry>, messageId: number, overrides = {}) {
  return registry.claim({ accountId: 1, channelId: 3, messageId, currentChannelId: 3, visible: true, documentVisible: true, reducedMotion: false, ...overrides });
}

test("each real-time event is queued independently and can be consumed only once", () => {
  const registry = createHandwritingPlaybackRegistry();
  assert.equal(registry.receive(message(10), 1), true);
  assert.equal(registry.receive(message(11), 1), true);
  assert.equal(registry.size, 2);
  assert.equal(claim(registry, 10), true);
  assert.equal(claim(registry, 10), false);
  assert.equal(claim(registry, 11), true);
});

test("history-like duplicate/old events and damaged payloads never gain eligibility", () => {
  const registry = createHandwritingPlaybackRegistry();
  assert.equal(registry.receive(message(10), 1), true);
  assert.equal(registry.receive(message(10), 1), false);
  assert.equal(registry.receive(message(9), 1), false);
  assert.equal(registry.receive(message(11, 3, 2), 1), true);
  const broken = message(12);
  broken.payload = { kind: "handwriting", version: 2 };
  assert.equal(registry.receive(broken, 1), false);
});

test("visibility, current view and reduced-motion checks gate consumption", () => {
  const registry = createHandwritingPlaybackRegistry();
  registry.receive(message(20), 1);
  assert.equal(claim(registry, 20, { visible: false }), false);
  assert.equal(claim(registry, 20, { currentChannelId: 8 }), false);
  assert.equal(claim(registry, 20, { reducedMotion: true }), false);
  assert.equal(claim(registry, 20), false);
  registry.receive(message(21), 1);
  assert.equal(claim(registry, 21), true);
});

test("expired and over-capacity events stay static instead of building a backlog", () => {
  let time = 100;
  const registry = createHandwritingPlaybackRegistry({ now: () => time });
  for (let id = 1; id <= HANDWRITING_PLAYBACK_QUEUE_LIMIT; id += 1) assert.equal(registry.receive(message(id), 1), true);
  assert.equal(registry.receive(message(100), 1), false);
  time += HANDWRITING_PLAYBACK_TTL_MS + 1;
  assert.equal(registry.size, 0);
});

test("logout clears queue and seen watermarks for that account", () => {
  const registry = createHandwritingPlaybackRegistry();
  registry.receive(message(10), 1);
  registry.receive(message(10), 2);
  registry.clearAccount(1);
  assert.equal(claim(registry, 10), false);
  assert.equal(registry.receive(message(10), 1), true);
  assert.equal(registry.size, 2);
});
