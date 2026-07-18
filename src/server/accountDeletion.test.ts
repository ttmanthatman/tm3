import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import Fastify, {
  type FastifyReply,
  type FastifyRequest
} from "fastify";
import {
  registerAdminAccountRoutes,
  type AdminAccountRouteDependencies
} from "./routes/adminAccounts.js";
import {
  deleteAccount,
  type AccountDeletionDependencies,
  type AccountDeletionTransaction
} from "./services/accountDeletion.js";

type FakeAccount = {
  id: number;
  displayName: string;
  role: "admin" | "user";
  actorId: number | null;
};

type FakeActor = {
  id: number;
  accountId: number | null;
  username: string;
  displayName: string;
  avatarPath: string | null;
  status: string;
};

type FakeState = {
  accounts: FakeAccount[];
  actors: FakeActor[];
  sessions: Array<{ id: string; accountId: number }>;
  memberships: Array<{ accountId: number; channelId: number }>;
  messages: Array<{ id: number; senderActorId: number; content: string }>;
};

function cloneState(state: FakeState): FakeState {
  return structuredClone(state);
}

function createDeletionStore(
  initialState: FakeState,
  options: { failAccountDelete?: boolean } = {}
) {
  let state = cloneState(initialState);
  let transactionCalls = 0;

  const deps: AccountDeletionDependencies = {
    async runTransaction<T>(
      operation: (tx: AccountDeletionTransaction) => Promise<T>
    ) {
      transactionCalls += 1;
      const draft = cloneState(state);
      const tx: AccountDeletionTransaction = {
        account: {
          async findUnique(args) {
            const account = draft.accounts.find(
              (candidate) => candidate.id === args.where.id
            );
            if (!account) return null;
            return {
              id: account.id,
              displayName: account.displayName,
              role: account.role,
              actor: account.actorId ? { id: account.actorId } : null,
              sessions: draft.sessions
                .filter((session) => session.accountId === account.id)
                .map((session) => ({ id: session.id })),
              memberships: draft.memberships
                .filter((membership) => membership.accountId === account.id)
                .map((membership) => ({
                  channelId: membership.channelId
                }))
            };
          },
          async count(args) {
            return draft.accounts.filter(
              (account) =>
                account.role === args.where.role &&
                account.id !== args.where.id.not
            ).length;
          },
          async delete(args) {
            if (options.failAccountDelete) {
              throw new Error("injected account delete failure");
            }
            draft.accounts = draft.accounts.filter(
              (account) => account.id !== args.where.id
            );
            draft.sessions = draft.sessions.filter(
              (session) => session.accountId !== args.where.id
            );
            draft.memberships = draft.memberships.filter(
              (membership) => membership.accountId !== args.where.id
            );
          }
        },
        actor: {
          async update(args) {
            const actor = draft.actors.find(
              (candidate) => candidate.id === args.where.id
            );
            if (!actor) throw new Error("actor not found");
            Object.assign(actor, args.data);
          }
        }
      };

      const result = await operation(tx);
      state = draft;
      return result;
    }
  };

  return {
    deps,
    getState: () => cloneState(state),
    getTransactionCalls: () => transactionCalls
  };
}

function defaultState(): FakeState {
  return {
    accounts: [
      { id: 1, displayName: "管理员", role: "admin", actorId: 101 },
      { id: 2, displayName: "普通用户", role: "user", actorId: 102 }
    ],
    actors: [
      {
        id: 101,
        accountId: 1,
        username: "admin",
        displayName: "管理员",
        avatarPath: null,
        status: "active"
      },
      {
        id: 102,
        accountId: 2,
        username: "member",
        displayName: "普通用户",
        avatarPath: "member.png",
        status: "active"
      }
    ],
    sessions: [
      { id: "admin-session", accountId: 1 },
      { id: "member-session", accountId: 2 }
    ],
    memberships: [
      { accountId: 1, channelId: 10 },
      { accountId: 2, channelId: 10 },
      { accountId: 2, channelId: 20 }
    ],
    messages: [
      { id: 1001, senderActorId: 102, content: "历史消息" }
    ]
  };
}

function createRouteApp(
  deleteAccountImpl: AdminAccountRouteDependencies["deleteAccount"]
) {
  const app = Fastify();
  const disconnectedSessionIds: string[][] = [];
  const emittedEvents: Array<{
    action: "account-deleted";
    accountId: number;
    channelIds: number[];
  }> = [];

  const requireAdmin = async (
    request: FastifyRequest,
    reply: FastifyReply
  ) => {
    const authHeader = request.headers["x-test-auth"];
    if (!authHeader) {
      reply.code(401).send({ success: false, message: "认证失败" });
      return;
    }
    if (authHeader === "user") {
      reply.code(403).send({ success: false, message: "需要管理员权限" });
      return;
    }
    const accountId = Number(String(authHeader).split(":")[1] || 1);
    (
      request as FastifyRequest & {
        auth: { accountId: number; sessionId: string };
      }
    ).auth = { accountId, sessionId: `session-${accountId}` };
  };

  registerAdminAccountRoutes(app, {
    prisma: {} as unknown as PrismaClient,
    requireAdmin,
    toAccountDto: () => {
      throw new Error("not used by deletion route tests");
    },
    updateAccountAvatarFromUpload: async () => {
      throw new Error("not used by deletion route tests");
    },
    writeLoginLog: async () => undefined,
    disconnectSessions: (sessionIds) => {
      disconnectedSessionIds.push(sessionIds);
    },
    refreshAccountConnections: () => undefined,
    deleteAccount: deleteAccountImpl,
    emitAccountDeleted: (payload) => {
      emittedEvents.push(payload);
    }
  });

  return { app, disconnectedSessionIds, emittedEvents };
}

test("admin account deletion route rejects unauthenticated and non-admin requests", async (context) => {
  let serviceCalls = 0;
  const { app } = createRouteApp(async () => {
    serviceCalls += 1;
    return {
      deleted: true,
      accountId: 2,
      sessionIds: [],
      channelIds: []
    };
  });
  context.after(() => app.close());

  const unauthenticated = await app.inject({
    method: "DELETE",
    url: "/api/admin/accounts/2"
  });
  assert.equal(unauthenticated.statusCode, 401);
  assert.deepEqual(unauthenticated.json(), {
    success: false,
    message: "认证失败"
  });

  const nonAdmin = await app.inject({
    method: "DELETE",
    url: "/api/admin/accounts/2",
    headers: { "x-test-auth": "user" }
  });
  assert.equal(nonAdmin.statusCode, 403);
  assert.deepEqual(nonAdmin.json(), {
    success: false,
    message: "需要管理员权限"
  });
  assert.equal(serviceCalls, 0);
});

test("admin account deletion route preserves status codes and JSON responses", async (context) => {
  const failures = new Map<number, "current-account" | "account-not-found" | "last-admin">([
    [1, "current-account"],
    [404, "account-not-found"],
    [9, "last-admin"]
  ]);
  const { app } = createRouteApp(async ({ targetAccountId }) => {
    const reason = failures.get(targetAccountId);
    if (reason) return { deleted: false, reason };
    if (!Number.isInteger(targetAccountId)) {
      return { deleted: false, reason: "invalid-account-id" };
    }
    return {
      deleted: true,
      accountId: targetAccountId,
      sessionIds: ["member-session"],
      channelIds: [10, 20]
    };
  });
  context.after(() => app.close());

  const cases = [
    {
      url: "/api/admin/accounts/not-a-number",
      statusCode: 400,
      body: { success: false, message: "用户编号无效" }
    },
    {
      url: "/api/admin/accounts/1",
      statusCode: 400,
      body: { success: false, message: "不能删除当前登录的管理员账号" }
    },
    {
      url: "/api/admin/accounts/404",
      statusCode: 404,
      body: { success: false, message: "用户不存在" }
    },
    {
      url: "/api/admin/accounts/9",
      statusCode: 400,
      body: { success: false, message: "至少需要保留一个管理员" }
    }
  ];

  for (const fixture of cases) {
    const response = await app.inject({
      method: "DELETE",
      url: fixture.url,
      headers: { "x-test-auth": "admin:1" }
    });
    assert.equal(response.statusCode, fixture.statusCode);
    assert.deepEqual(response.json(), fixture.body);
  }
});

test("successful deletion route disconnects sessions and emits the existing realtime event", async (context) => {
  const { app, disconnectedSessionIds, emittedEvents } = createRouteApp(
    async () => ({
      deleted: true,
      accountId: 2,
      sessionIds: ["session-a", "session-b"],
      channelIds: [10, 20]
    })
  );
  context.after(() => app.close());

  const response = await app.inject({
    method: "DELETE",
    url: "/api/admin/accounts/2",
    headers: { "x-test-auth": "admin:1" }
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { success: true });
  assert.deepEqual(disconnectedSessionIds, [["session-a", "session-b"]]);
  assert.deepEqual(emittedEvents, [
    {
      action: "account-deleted",
      accountId: 2,
      channelIds: [10, 20]
    }
  ]);
});

test("account deletion service rejects deleting the current administrator", async () => {
  const store = createDeletionStore(defaultState());
  const result = await deleteAccount(store.deps, {
    currentAccountId: 1,
    targetAccountId: 1
  });

  assert.deepEqual(result, { deleted: false, reason: "current-account" });
  assert.equal(store.getTransactionCalls(), 0);
  assert.deepEqual(store.getState(), defaultState());
});

test("account deletion service protects the last administrator", async () => {
  const state = defaultState();
  state.accounts = state.accounts.filter((account) => account.id === 1);
  state.actors = state.actors.filter((actor) => actor.id === 101);
  state.sessions = state.sessions.filter((session) => session.accountId === 1);
  state.memberships = state.memberships.filter(
    (membership) => membership.accountId === 1
  );
  const store = createDeletionStore(state);

  const result = await deleteAccount(store.deps, {
    currentAccountId: 99,
    targetAccountId: 1
  });

  assert.deepEqual(result, { deleted: false, reason: "last-admin" });
  assert.deepEqual(store.getState(), state);
});

test("account deletion preserves historic Actor and messages while revoking access", async () => {
  const store = createDeletionStore(defaultState());

  const result = await deleteAccount(store.deps, {
    currentAccountId: 1,
    targetAccountId: 2
  });

  assert.deepEqual(result, {
    deleted: true,
    accountId: 2,
    sessionIds: ["member-session"],
    channelIds: [10, 20]
  });
  const state = store.getState();
  assert.equal(
    state.accounts.some((account) => account.id === 2),
    false,
    "deleted credentials can no longer be used to log in"
  );
  assert.equal(
    state.sessions.some((session) => session.accountId === 2),
    false,
    "all account sessions are revoked by deletion"
  );
  assert.equal(
    state.memberships.some((membership) => membership.accountId === 2),
    false
  );
  assert.deepEqual(
    state.actors.find((actor) => actor.id === 102),
    {
      id: 102,
      accountId: null,
      username: "deleted-account-2",
      displayName: "普通用户（已删除用户）",
      avatarPath: null,
      status: "deleted"
    }
  );
  assert.deepEqual(state.messages, [
    { id: 1001, senderActorId: 102, content: "历史消息" }
  ]);
});

test("account deletion transaction rolls back Actor changes when account removal fails", async () => {
  const initialState = defaultState();
  const store = createDeletionStore(initialState, { failAccountDelete: true });

  await assert.rejects(
    deleteAccount(store.deps, {
      currentAccountId: 1,
      targetAccountId: 2
    }),
    /injected account delete failure/
  );
  assert.deepEqual(store.getState(), initialState);
});
