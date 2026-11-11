import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { createCalendarScheduler } from "./calendar.js";

function harness(mode: string, offset = [0]) {
  const at = new Date("2026-11-12T01:00:00Z");
  const event = {
    id: 1,
    channelId: 2,
    ownerAccountId: 3,
    ownerActorId: 4,
    title: "private title",
    description: "secret",
    timeZone: "Asia/Shanghai",
    allDay: false,
    reminderText: "public body",
    reminderMode: mode,
    reminders: offset,
    startAt: at,
    endAt: at,
    repeat: "none",
    weekdays: [],
    untilAt: null,
    excludedDates: [],
    revision: 1,
    paused: false,
    updatedAt: new Date("2026-11-11"),
    createdAt: new Date("2026-11-11"),
    chainConfig: null
  };
  const deliveries: Array<{
    id: number;
    eventId: number;
    revision: number;
    occurrenceAt: Date;
    reminderIndex: number;
    status: string;
    messageId?: number;
    broadcastedAt?: Date;
  }> = [];
  const messages: Array<{ id: number; content: string; payload?: unknown; type: string }> = [];
  const notices: unknown[] = [],
    published: number[] = [],
    errors: unknown[] = [];
  let access = true,
    failPublish = false;
  const prisma = {
    calendarEvent: { findMany: async () => [event] },
    channel: { findUnique: async () => ({ id: 2, isPrivate: false }) },
    setting: { findUnique: async () => null },
    actor: { upsert: async () => ({ id: 99, kind: "system" }) },
    calendarDelivery: {
      findUnique: async ({
        where
      }: {
        where: {
          eventId_revision_occurrenceAt_reminderIndex: { revision: number; reminderIndex: number };
        };
      }) =>
        deliveries.find(
          (d) =>
            d.revision === where.eventId_revision_occurrenceAt_reminderIndex.revision &&
            d.reminderIndex === where.eventId_revision_occurrenceAt_reminderIndex.reminderIndex
        ),
      findFirst: async () => deliveries.find((d) => d.messageId),
      create: async ({ data }: { data: Omit<(typeof deliveries)[number], "id"> }) => {
        const d = { ...data, id: deliveries.length + 1 };
        deliveries.push(d);
        return d;
      },
      update: async ({
        where,
        data
      }: {
        where: { id: number };
        data: Partial<(typeof deliveries)[number]>;
      }) =>
        Object.assign(
          deliveries.find((d) => d.id === where.id)!,
          data
        ),
      findMany: async () => deliveries.filter((d) => d.messageId && !d.broadcastedAt)
    },
    calendarNotice: { create: async ({ data }: { data: unknown }) => notices.push(data) },
    message: {
      create: async ({ data }: { data: Omit<(typeof messages)[number], "id"> }) => {
        const m = { ...data, id: messages.length + 1 };
        messages.push(m);
        return m;
      },
      update: async () => undefined
    },
    $queryRaw: async () => [{ revision: event.revision, paused: event.paused ? 1 : 0 }],
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)
  } as unknown as PrismaClient;
  const scheduler = createCalendarScheduler({
    prisma,
    canAccessChannel: async () => access,
    canWriteChannel: async () => access,
    publishMessage: async (id) => {
      if (failPublish) throw new Error("offline");
      published.push(id);
    },
    warn: (e) => errors.push(e)
  });
  return {
    scheduler,
    event,
    deliveries,
    messages,
    notices,
    published,
    errors,
    at,
    deny: () => {
      access = false;
    },
    fail: (value: boolean) => {
      failPublish = value;
    }
  };
}
test("private reminder is owner-only, persistent and idempotent", async () => {
  const h = harness("private");
  await Promise.all([h.scheduler.tick(h.at), h.scheduler.tick(h.at)]);
  await h.scheduler.tick(h.at);
  assert.deepEqual(h.notices, [{ deliveryId: 1, accountId: 3 }]);
  assert.equal(h.messages.length, 0);
  assert.equal(h.errors.length, 0);
});
test("group delivery retries the stored outbox; public body excludes private content", async () => {
  const h = harness("text");
  h.fail(true);
  await h.scheduler.tick(h.at);
  assert.equal(h.messages.length, 1);
  assert.match(h.messages[0].content, /public body/);
  assert.doesNotMatch(h.messages[0].content, /secret|private title/);
  h.fail(false);
  await h.scheduler.tick(h.at);
  await h.scheduler.tick(h.at);
  assert.equal(h.messages.length, 1);
  assert.deepEqual(h.published, [1]);
});
test("same occurrence reuses the first chain; expired group reminders and lost access do not send", async () => {
  const h = harness("chain", [10, 0]);
  await h.scheduler.tick(new Date(h.at.getTime() - 600000));
  await h.scheduler.tick(h.at);
  assert.deepEqual(
    h.messages.map((m) => m.type),
    ["chain", "text"]
  );
  const expired = harness("text");
  await expired.scheduler.tick(new Date(expired.at.getTime() + 7200000));
  assert.equal(expired.messages.length, 0);
  assert.equal(expired.deliveries[0].status, "missed");
  const denied = harness("private");
  denied.deny();
  await denied.scheduler.tick(denied.at);
  assert.equal(denied.notices.length, 0);
});
