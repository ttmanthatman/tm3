import assert from "node:assert/strict";
import test from "node:test";
import { createMessageSendIdempotency, messageSendRequestHash } from "./messageSendIdempotency.js";

const hash = messageSendRequestHash({ channelId: 1, content: "平安", type: "text", payload: {}, replyToId: null });

test("a lost ACK replays the original message and concurrent requests create only once", async () => {
  const rows = new Map<string, { id: number; clientRequestHash: string }>();
  let creates = 0;
  const service = createMessageSendIdempotency({
    find: async (actorId, id) => rows.get(`${actorId}:${id}`) ?? null,
    isUniqueConflict: (error) => error instanceof Error && error.message === "unique"
  });
  const input = {
    actorId: 3,
    clientRequestId: "one",
    hash,
    create: async () => {
      creates += 1;
      await Promise.resolve();
      const row = { id: 42, clientRequestHash: hash };
      rows.set("3:one", row);
      return row;
    }
  };
  assert.deepEqual(await Promise.all([service.send(input), service.send(input)]), [
    { state: "created", messageId: 42 },
    { state: "replayed", messageId: 42 }
  ]);
  assert.deepEqual(await service.send(input), { state: "replayed", messageId: 42 });
  assert.equal(creates, 1);
  assert.deepEqual(await service.send({ ...input, hash: "different" }), { state: "conflict" });
});

test("a database uniqueness race returns the committed row", async () => {
  let row: { id: number; clientRequestHash: string } | null = null;
  const service = createMessageSendIdempotency({
    find: async () => row,
    isUniqueConflict: (error) => error instanceof Error && error.message === "unique"
  });
  const result = await service.send({
    actorId: 3,
    clientRequestId: "two",
    hash,
    create: async () => {
      row = { id: 43, clientRequestHash: hash };
      throw new Error("unique");
    }
  });
  assert.deepEqual(result, { state: "replayed", messageId: 43 });
});

test("request hash ignores object key order but detects changed content", () => {
  const base = { channelId: 1, content: "平安", type: "text", payload: { a: 1, b: 2 }, replyToId: null };
  assert.equal(messageSendRequestHash(base), messageSendRequestHash({ ...base, payload: { b: 2, a: 1 } }));
  assert.notEqual(messageSendRequestHash(base), messageSendRequestHash({ ...base, content: "平安！" }));
});
