import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { createReceptionService } from "./receptionService.js";

test("expired reception cleanup removes room content and temporary guest accounts", async () => {
  const calls: string[] = [];
  const deletedAccounts: number[][] = [];
  const prisma = {
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
    channel: {
      findMany: async () => [{ id: 12 }],
      findFirst: async () => ({ id: 12, members: [{ accountId: 91 }, { accountId: 92 }] })
    },
    message: { findMany: async () => [{ id: 501 }, { id: 502 }] },
    engineEvent: {
      findMany: async () => [{ id: 701 }],
      deleteMany: async () => { calls.push("events"); return { count: 1 }; }
    },
    engineAction: { deleteMany: async () => { calls.push("actions"); return { count: 1 }; } },
    accountActivityLog: { deleteMany: async () => { calls.push("activity"); return { count: 2 }; } },
    accountLoginLog: { deleteMany: async () => { calls.push("login-logs"); return { count: 0 }; } },
    auditLog: { deleteMany: async () => { calls.push("audits"); return { count: 0 }; } },
    account: {
      deleteMany: async ({ where }: { where: { id: { in: number[] } } }) => {
        deletedAccounts.push(where.id.in);
        calls.push("accounts");
        return { count: where.id.in.length };
      }
    }
  } as unknown as PrismaClient;
  const service = createReceptionService({
    prisma,
    notifyRoomClosing: () => calls.push("notify"),
    disconnectAccounts: (ids) => calls.push(`disconnect:${ids.join(",")}`),
    invalidateAccounts: (ids) => calls.push(`invalidate:${ids.join(",")}`),
    deleteChannelWithAttachments: async () => { calls.push("channel"); }
  });

  assert.equal(await service.cleanupExpiredRooms(), 1);
  assert.deepEqual(calls, ["notify", "disconnect:91,92", "invalidate:91,92", "actions", "events", "activity", "login-logs", "audits", "channel", "accounts"]);
  assert.deepEqual(deletedAccounts, [[91, 92]]);
});

test("reception cleanup is idempotent when room has already gone", async () => {
  const prisma = {
    channel: { findFirst: async () => null }
  } as unknown as PrismaClient;
  const service = createReceptionService({
    prisma,
    notifyRoomClosing: () => assert.fail("should not notify"),
    disconnectAccounts: () => assert.fail("should not disconnect"),
    invalidateAccounts: () => assert.fail("should not invalidate"),
    deleteChannelWithAttachments: async () => assert.fail("should not delete")
  });
  assert.equal(await service.deleteRoom(999), false);
});
