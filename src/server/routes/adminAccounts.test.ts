/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, type PrismaClient } from "@prisma/client";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import type { AccountDTO } from "../../shared/types.js";
import {
  registerAdminAccountRoutes,
  type AdminAccountRouteDependencies
} from "./adminAccounts.js";

type StoredAccount = {
  id: number;
  username: string;
  displayName: string;
  passwordHash: string;
  role: "admin" | "user";
  canPinMessages: boolean;
  actor: {
    id: number;
    username: string;
    displayName: string;
  };
};

function accountDto(account: StoredAccount): AccountDTO {
  return {
    id: account.id,
    username: account.username,
    displayName: account.displayName,
    avatarPath: null,
    isAdmin: account.role === "admin",
    canPinMessages: account.canPinMessages,
    actorId: account.actor.id,
    theme: "wechat",
    biblePreferences: {
      outputFormat: "referenceVerseLines",
      referenceLabelMode: "normalizedFull",
      combinedPassageMode: "compactEllipsis",
      quotationStyle: "fullWidth"
    }
  };
}

function createAccountRouteHarness(options: {
  accountCreateError?: Error;
  membershipCreateError?: Error;
} = {}) {
  const state = {
    accounts: [] as StoredAccount[],
    memberships: [] as Array<{ channelId: number; accountId: number; role: "member" }>,
    transactionCalls: 0
  };
  const publicChannels = [{ id: 10 }, { id: 20 }];
  const prisma = {
    $transaction: async (operation: (transaction: unknown) => Promise<StoredAccount>) => {
      state.transactionCalls += 1;
      const draftAccounts = [...state.accounts];
      const draftMemberships = [...state.memberships];
      const transaction = {
        account: {
          create: async ({ data }: {
            data: {
              username: string;
              displayName: string;
              passwordHash: string;
              role: "admin" | "user";
              canPinMessages: boolean;
            };
          }) => {
            if (options.accountCreateError) throw options.accountCreateError;
            const created: StoredAccount = {
              id: 3,
              username: data.username,
              displayName: data.displayName,
              passwordHash: data.passwordHash,
              role: data.role,
              canPinMessages: data.canPinMessages,
              actor: {
                id: 103,
                username: data.username,
                displayName: data.displayName
              }
            };
            draftAccounts.push(created);
            return created;
          }
        },
        channel: {
          findMany: async () => publicChannels
        },
        channelMember: {
          createMany: async ({ data }: {
            data: Array<{ channelId: number; accountId: number; role: "member" }>;
          }) => {
            if (options.membershipCreateError) throw options.membershipCreateError;
            draftMemberships.push(...data);
            return { count: data.length };
          }
        }
      };
      const result = await operation(transaction);
      state.accounts = draftAccounts;
      state.memberships = draftMemberships;
      return result;
    }
  };
  const app = Fastify();
  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    return reply.code(500).send({ success: false, message: "internal server error" });
  });
  const requireAdmin = async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = request.headers["x-test-auth"];
    if (!auth) {
      reply.code(401).send({ success: false, message: "认证失败" });
      return;
    }
    if (auth === "user") {
      reply.code(403).send({ success: false, message: "需要管理员权限" });
      return;
    }
    (
      request as FastifyRequest & {
        auth: { accountId: number; sessionId: string };
      }
    ).auth = { accountId: 1, sessionId: "admin-session" };
  };
  registerAdminAccountRoutes(app, {
    prisma: prisma as unknown as PrismaClient,
    requireAdmin,
    toAccountDto: (account) => accountDto(account as unknown as StoredAccount),
    updateAccountAvatarFromUpload: async () => undefined,
    writeLoginLog: async () => undefined,
    disconnectSessions: () => undefined,
    refreshAccountConnections: () => undefined,
    deleteAccount: async () => ({ deleted: false, reason: "account-not-found" }),
    emitAccountDeleted: () => undefined
  } satisfies AdminAccountRouteDependencies);
  return { app, state };
}

const validPayload = {
  username: "new-reader",
  displayName: "新读者",
  password: "StrongPass123",
  isAdmin: false,
  canPinMessages: true
};

test("admin creation returns the account and joins every public channel atomically", async (context) => {
  const { app, state } = createAccountRouteHarness();
  context.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/api/admin/accounts",
    headers: { "x-test-auth": "admin" },
    payload: validPayload
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().account.username, validPayload.username);
  assert.equal(state.transactionCalls, 1);
  assert.deepEqual(state.memberships, [
    { channelId: 10, accountId: 3, role: "member" },
    { channelId: 20, accountId: 3, role: "member" }
  ]);
});

test("membership failure rolls back account creation instead of leaving partial data", async (context) => {
  const { app, state } = createAccountRouteHarness({
    membershipCreateError: new Error("injected membership failure")
  });
  context.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/api/admin/accounts",
    headers: { "x-test-auth": "admin" },
    payload: validPayload
  });

  assert.equal(response.statusCode, 500);
  assert.deepEqual(state.accounts, []);
  assert.deepEqual(state.memberships, []);
});

test("only unique constraint failures become username conflicts", async (context) => {
  const duplicate = new Prisma.PrismaClientKnownRequestError("duplicate", {
    code: "P2002",
    clientVersion: "test",
    meta: { target: ["username"] }
  });
  const duplicateHarness = createAccountRouteHarness({ accountCreateError: duplicate });
  const databaseHarness = createAccountRouteHarness({
    accountCreateError: new Error("database unavailable")
  });
  context.after(() => Promise.all([
    duplicateHarness.app.close(),
    databaseHarness.app.close()
  ]));

  const duplicateResponse = await duplicateHarness.app.inject({
    method: "POST",
    url: "/api/admin/accounts",
    headers: { "x-test-auth": "admin" },
    payload: validPayload
  });
  assert.equal(duplicateResponse.statusCode, 409);
  assert.deepEqual(duplicateResponse.json(), {
    success: false,
    message: "用户名已存在"
  });

  const databaseResponse = await databaseHarness.app.inject({
    method: "POST",
    url: "/api/admin/accounts",
    headers: { "x-test-auth": "admin" },
    payload: validPayload
  });
  assert.equal(databaseResponse.statusCode, 500);
  assert.equal(databaseResponse.json().message, "internal server error");
});

test("invalid creation payloads return a clear 400 without starting a transaction", async (context) => {
  const { app, state } = createAccountRouteHarness();
  context.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/api/admin/accounts",
    headers: { "x-test-auth": "admin" },
    payload: {
      username: "不合规",
      displayName: "",
      password: "short"
    }
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().message, /用户名|显示名|密码/);
  assert.equal(state.transactionCalls, 0);
});

test("non-admin requests cannot create, modify, or delete accounts", async (context) => {
  const { app, state } = createAccountRouteHarness();
  context.after(() => app.close());

  const createResponse = await app.inject({
    method: "POST",
    url: "/api/admin/accounts",
    headers: { "x-test-auth": "user" },
    payload: validPayload
  });
  const updateResponse = await app.inject({
    method: "PATCH",
    url: "/api/admin/accounts/3",
    headers: { "x-test-auth": "user" },
    payload: { displayName: "无权限修改" }
  });
  const deleteResponse = await app.inject({
    method: "DELETE",
    url: "/api/admin/accounts/3",
    headers: { "x-test-auth": "user" }
  });

  assert.equal(createResponse.statusCode, 403);
  assert.equal(updateResponse.statusCode, 403);
  assert.equal(deleteResponse.statusCode, 403);
  assert.equal(state.transactionCalls, 0);
});
