import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, type PrismaClient } from "@prisma/client";
import { createZoomWebhookStore, type ZoomMeetingEvent } from "./zoomWebhook.js";

const url = "https://zoom.us/j/123456789?pwd=fixture";
type Notice = { id: number; channelId: number; senderActorId: number; clientRequestId: string; type: string; content: string; payload: { kind: string; status: string; url?: string } };

function fixture() {
  const settings = new Map([["zoom.link", url]]);
  const messages = new Map<string, Notice>();
  const published: number[] = [];
  let failWrite = false;
  let failPublish = false;
  const transactionErrors: string[] = [];
  const channels = [
    { id: 1, kind: "standard", isPrivate: false }, { id: 2, kind: "standard", isPrivate: false },
    { id: 3, kind: "standard", isPrivate: true }, { id: 4, kind: "direct", isPrivate: false },
    { id: 5, kind: "reception", isPrivate: false }, { id: 6, kind: "music", isPrivate: false }
  ];
  const prisma: PrismaClient = {
    $transaction: async (run: (tx: PrismaClient) => Promise<unknown>) => {
      const code = transactionErrors.shift();
      if (code) throw new Prisma.PrismaClientKnownRequestError("fixture transaction conflict", { code, clientVersion: "fixture" });
      const beforeSettings = new Map(settings), beforeMessages = new Map(messages);
      try { return await run(prisma); }
      catch (error) {
        settings.clear(); messages.clear();
        for (const [key, value] of beforeSettings) settings.set(key, value);
        for (const [key, value] of beforeMessages) messages.set(key, value);
        throw error;
      }
    },
    setting: {
      findMany: async () => [...settings].map(([key, value]) => ({ key, value })),
      upsert: async ({ where, create }: { where: { key: string }; create: { value: string } }) => { if (!settings.has(where.key)) settings.set(where.key, create.value); },
      updateMany: async ({ where, data }: { where: { key: string; value: string }; data: { value: string } }) => {
        if (settings.get(where.key) !== where.value) return { count: 0 };
        settings.set(where.key, data.value); return { count: 1 };
      }
    },
    channel: { findMany: async ({ where }: { where: { kind: string; isPrivate: boolean } }) => channels.filter(row => row.kind === where.kind && row.isPrivate === where.isPrivate) },
    actor: { upsert: async () => ({ id: 9, kind: "system" }) },
    message: {
      upsert: async ({ create }: { create: Omit<Notice, "id"> }) => {
        if (failWrite && create.channelId === 2) throw new Error("fixture message write failed");
        const row = messages.get(create.clientRequestId) || { id: messages.size + 1, ...create };
        messages.set(create.clientRequestId, row); return { id: row.id };
      },
      findMany: async ({ where }: { where: { clientRequestId: { startsWith: string } } }) => [...messages.values()].filter(row => row.clientRequestId.startsWith(where.clientRequestId.startsWith)).map(row => ({ id: row.id }))
    }
  } as unknown as PrismaClient;
  const store = createZoomWebhookStore(prisma, () => 500, async id => {
    assert.ok([...messages.values()].some(row => row.id === id), "only committed rows are broadcast");
    if (failPublish) throw new Error("fixture broadcast failed");
    published.push(id);
  });
  const event = (status: ZoomMeetingEvent["status"], eventTs: number, instanceId = "fixture-a"): ZoomMeetingEvent => ({ meetingId: "123456789", instanceId, status, eventTs });
  return { store, settings, messages, published, event, channels, transactionErrors, failWrite: (value: boolean) => { failWrite = value; }, failPublish: (value: boolean) => { failPublish = value; } };
}

test("initialization and write conflicts retry within a bounded transaction loop", async () => {
  const f = fixture();
  f.transactionErrors.push("P2002", "P2034");
  await f.store.accept(f.event("active", 100));
  assert.equal(f.messages.size, 2); assert.deepEqual(f.published, [1, 2]);
  f.transactionErrors.push(...Array<string>(5).fill("P2002"));
  await assert.rejects(f.store.accept(f.event("inactive", 200)), /conflicted/);
  assert.equal(f.messages.size, 2);
  assert.equal(f.store.status(url, f.settings.get("zoom.webhook")).status, "active");
});

test("Zoom start/end messages fan out only to public standard chats and duplicate events reuse rows", async () => {
  const f = fixture();
  await f.store.accept(f.event("active", 100));
  assert.equal(f.messages.size, 2);
  assert.deepEqual([...f.messages.values()].map(row => row.channelId), [1, 2]);
  for (const row of f.messages.values()) {
    assert.equal(row.type, "system"); assert.equal(row.content, "Zoom会议开始了");
    assert.deepEqual(row.payload, { kind: "zoom_meeting", status: "active", url });
  }
  await f.store.accept(f.event("active", 101));
  assert.equal(f.messages.size, 2);
  await f.store.accept(f.event("inactive", 200));
  await f.store.accept(f.event("inactive", 201));
  await f.store.accept(f.event("active", 202)); // An ended instance stays ended.
  assert.equal(f.messages.size, 4);
  for (const row of [...f.messages.values()].slice(2)) {
    assert.equal(row.content, "Zoom会议结束了");
    assert.deepEqual(row.payload, { kind: "zoom_meeting", status: "inactive" });
  }
  await f.store.accept(f.event("active", 300, "fixture-b"));
  assert.equal(f.messages.size, 6);
});

test("partial fan-out failure rolls back both meeting state and every notification", async () => {
  const f = fixture(); f.failWrite(true);
  await assert.rejects(f.store.accept(f.event("active", 100)), /message write failed/);
  assert.equal(f.messages.size, 0); assert.equal(f.published.length, 0);
  assert.equal(f.store.status(url, f.settings.get("zoom.webhook")).status, "unknown");
  f.failWrite(false);
  await f.store.accept(f.event("active", 100));
  assert.equal(f.messages.size, 2); assert.equal(f.published.length, 2);
});

test("broadcast failure preserves notifications and a webhook retry broadcasts the same message IDs", async () => {
  const f = fixture(); f.failPublish(true);
  await assert.rejects(f.store.accept(f.event("active", 100)), /broadcast failed/);
  assert.equal(f.messages.size, 2);
  assert.equal(f.store.status(url, f.settings.get("zoom.webhook")).status, "active");
  f.failPublish(false);
  await f.store.accept(f.event("active", 100));
  assert.equal(f.messages.size, 2); assert.deepEqual(f.published, [1, 2]);
});

test("old/unrelated events stay silent and an empty public channel set can still synchronize state", async () => {
  const f = fixture();
  await f.store.accept({ ...f.event("active", 100), meetingId: "999999999" });
  assert.equal(f.messages.size, 0);
  await f.store.accept(f.event("active", 100));
  await f.store.accept(f.event("inactive", 90));
  await f.store.accept(f.event("inactive", 110, "other-instance"));
  assert.equal(f.messages.size, 2);
  f.channels.splice(0);
  await f.store.accept(f.event("inactive", 120));
  assert.equal(f.store.status(url, f.settings.get("zoom.webhook")).status, "inactive");
  assert.equal(f.messages.size, 2);
});
