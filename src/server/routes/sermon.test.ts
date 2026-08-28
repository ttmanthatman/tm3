import assert from "node:assert/strict";
import test from "node:test";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { MessageDTO } from "../../shared/types.js";
import { SERMON_PERMANENT_UNTIL } from "../sermon/permissions.js";
import { registerSermonRoutes } from "./sermon.js";

type AccountStub = {
  id: number;
  role: string;
  displayName: string;
  sermonPresenterUntil: Date | null;
};

type MessageStub = {
  id: number;
  channelId: number;
  type: string;
  payload: unknown;
  sender: { id: number; accountId: number | null; displayName: string };
};

function createHarness(options: { isAdmin?: boolean; authed?: boolean } = {}) {
  const isAdmin = options.isAdmin ?? true;
  const authed = options.authed ?? true;
  const authAccountId = isAdmin ? 1 : 3;
  const accounts = new Map<number, AccountStub>([
    [1, { id: 1, role: "admin", displayName: "管理员", sermonPresenterUntil: null }],
    [3, { id: 3, role: "user", displayName: "申请人", sermonPresenterUntil: null }]
  ]);
  const message: MessageStub = {
    id: 42,
    channelId: 7,
    type: "sermon_request",
    payload: { kind: "sermon_request", status: "pending", note: "周日想试讲" },
    sender: { id: 3, accountId: 3, displayName: "申请人" }
  };
  const accountUpdates: Array<{ id: number; until: Date | null }> = [];
  const prisma = {
    account: {
      findUnique: async ({ where }: { where: { id: number } }) => accounts.get(where.id) || null,
      update: async ({ where, data }: { where: { id: number }; data: { sermonPresenterUntil: Date | null } }) => {
        const account = accounts.get(where.id);
        if (!account) throw new Error("account not found");
        account.sermonPresenterUntil = data.sermonPresenterUntil;
        accountUpdates.push({ id: where.id, until: data.sermonPresenterUntil });
        return account;
      }
    },
    message: {
      findUnique: async ({ where }: { where: { id: number } }) => (where.id === message.id ? message : null),
      update: async ({ where, data }: { where: { id: number }; data: { payload: unknown } }) => {
        if (where.id !== message.id) throw new Error("message not found");
        message.payload = data.payload;
        return message;
      }
    }
  } as unknown as PrismaClient;

  const emissions: Array<{ room: string; event: string; payload: unknown }> = [];
  const io = {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => {
        emissions.push({ room, event, payload });
      }
    })
  };

  const setAuth = (request: FastifyRequest) => {
    (request as FastifyRequest & { auth: { accountId: number } }).auth = { accountId: authAccountId };
  };
  const requireAuth = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!authed) {
      reply.code(401).send({ success: false, message: "认证失败" });
      return;
    }
    setAuth(request);
  };
  const requireAdmin = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!authed) {
      reply.code(401).send({ success: false, message: "认证失败" });
      return;
    }
    if (!isAdmin) {
      reply.code(403).send({ success: false, message: "需要管理员权限" });
      return;
    }
    setAuth(request);
  };

  const app = Fastify();
  registerSermonRoutes(app, {
    prisma,
    io,
    requireAuth,
    requireAdmin,
    hydrateMessage: async (id) => ({ id, channelId: 7 }) as MessageDTO
  });
  return { app, accounts, message, accountUpdates, emissions };
}

test("GET presenter-status：管理员恒可讲", async () => {
  const { app } = createHarness();
  await app.ready();
  try {
    const response = await app.inject({ method: "GET", url: "/api/sermon/presenter-status" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { canPresent: true, until: null });
  } finally {
    await app.close();
  }
});

test("GET presenter-status：有效期内/过期/永久", async () => {
  const { app, accounts } = createHarness({ isAdmin: false });
  await app.ready();
  try {
    const applicant = accounts.get(3) as AccountStub;
    applicant.sermonPresenterUntil = new Date(Date.now() + 60_000);
    const active = await app.inject({ method: "GET", url: "/api/sermon/presenter-status" });
    assert.equal(active.json().canPresent, true);
    assert.equal(active.json().until, applicant.sermonPresenterUntil.toISOString());

    applicant.sermonPresenterUntil = new Date(Date.now() - 60_000);
    const expired = await app.inject({ method: "GET", url: "/api/sermon/presenter-status" });
    assert.deepEqual(expired.json(), { canPresent: false, until: expired.json().until });

    applicant.sermonPresenterUntil = null;
    const never = await app.inject({ method: "GET", url: "/api/sermon/presenter-status" });
    assert.deepEqual(never.json(), { canPresent: false, until: null });

    applicant.sermonPresenterUntil = SERMON_PERMANENT_UNTIL;
    const permanent = await app.inject({ method: "GET", url: "/api/sermon/presenter-status" });
    assert.deepEqual(permanent.json(), { canPresent: true, until: null });
  } finally {
    await app.close();
  }
});

test("GET presenter-status：未登录 401", async () => {
  const { app } = createHarness({ authed: false });
  await app.ready();
  try {
    const response = await app.inject({ method: "GET", url: "/api/sermon/presenter-status" });
    assert.equal(response.statusCode, 401);
  } finally {
    await app.close();
  }
});

test("decide 批准：写权限、更新卡片、广播与通知", async () => {
  const { app, accounts, message, emissions } = createHarness();
  await app.ready();
  try {
    const before = Date.now();
    const response = await app.inject({
      method: "POST",
      url: "/api/messages/42/sermon-request/decide",
      payload: { approve: true, duration: "24h" }
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().success, true);

    const applicant = accounts.get(3) as AccountStub;
    assert.ok(applicant.sermonPresenterUntil);
    const untilMs = applicant.sermonPresenterUntil.getTime();
    assert.ok(untilMs >= before + 24 * 60 * 60 * 1000 && untilMs <= Date.now() + 24 * 60 * 60 * 1000);

    const payload = message.payload as Record<string, unknown>;
    assert.equal(payload.status, "approved");
    assert.equal(payload.decidedById, 1);
    assert.equal(payload.decidedByName, "管理员");
    assert.equal(payload.grantedUntil, applicant.sermonPresenterUntil.toISOString());
    assert.equal(payload.note, "周日想试讲");
    assert.ok(typeof payload.decidedAt === "string");

    assert.ok(emissions.some((entry) => entry.room === "ch:7" && entry.event === "message:updated"));
    const notice = emissions.find((entry) => entry.room === "acct:3" && entry.event === "sermon:request:decided");
    assert.ok(notice);
    assert.deepEqual(notice.payload, {
      messageId: 42,
      approve: true,
      until: applicant.sermonPresenterUntil.toISOString()
    });
  } finally {
    await app.close();
  }
});

test("decide 批准默认时长与永久档", async () => {
  const { app, accounts, message } = createHarness();
  await app.ready();
  try {
    const defaults = await app.inject({
      method: "POST",
      url: "/api/messages/42/sermon-request/decide",
      payload: { approve: true }
    });
    assert.equal(defaults.statusCode, 200);
    const applicant = accounts.get(3) as AccountStub;
    const granted = applicant.sermonPresenterUntil as Date;
    assert.ok(granted.getTime() > Date.now() + 6 * 24 * 60 * 60 * 1000);
    assert.ok(granted.getTime() < Date.now() + 8 * 24 * 60 * 60 * 1000);

    message.payload = { kind: "sermon_request", status: "pending", note: "" };
    const permanent = await app.inject({
      method: "POST",
      url: "/api/messages/42/sermon-request/decide",
      payload: { approve: true, duration: "permanent" }
    });
    assert.equal(permanent.statusCode, 200);
    assert.equal(applicant.sermonPresenterUntil?.getTime(), SERMON_PERMANENT_UNTIL.getTime());
    assert.equal((message.payload as Record<string, unknown>).grantedUntil, null);
  } finally {
    await app.close();
  }
});

test("decide 拒绝：不授权、卡片标记 rejected、通知申请人", async () => {
  const { app, message, accountUpdates, emissions } = createHarness();
  await app.ready();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/messages/42/sermon-request/decide",
      payload: { approve: false }
    });
    assert.equal(response.statusCode, 200);
    assert.equal(accountUpdates.length, 0);
    const payload = message.payload as Record<string, unknown>;
    assert.equal(payload.status, "rejected");
    assert.equal(payload.grantedUntil, null);
    const notice = emissions.find((entry) => entry.event === "sermon:request:decided");
    assert.deepEqual(notice?.payload, { messageId: 42, approve: false, until: null });
  } finally {
    await app.close();
  }
});

test("decide 重复处理返回 409", async () => {
  const { app } = createHarness();
  await app.ready();
  try {
    await app.inject({ method: "POST", url: "/api/messages/42/sermon-request/decide", payload: { approve: false } });
    const again = await app.inject({
      method: "POST",
      url: "/api/messages/42/sermon-request/decide",
      payload: { approve: true, duration: "7d" }
    });
    assert.equal(again.statusCode, 409);
  } finally {
    await app.close();
  }
});

test("decide 消息缺失/类型不符/编号与参数非法", async () => {
  const { app, message } = createHarness();
  await app.ready();
  try {
    const missing = await app.inject({
      method: "POST",
      url: "/api/messages/999/sermon-request/decide",
      payload: { approve: true }
    });
    assert.equal(missing.statusCode, 404);

    message.type = "prayer";
    const wrongType = await app.inject({
      method: "POST",
      url: "/api/messages/42/sermon-request/decide",
      payload: { approve: true }
    });
    assert.equal(wrongType.statusCode, 404);
    message.type = "sermon_request";

    const badId = await app.inject({
      method: "POST",
      url: "/api/messages/abc/sermon-request/decide",
      payload: { approve: true }
    });
    assert.equal(badId.statusCode, 400);

    const badBody = await app.inject({
      method: "POST",
      url: "/api/messages/42/sermon-request/decide",
      payload: { approve: "yes" }
    });
    assert.equal(badBody.statusCode, 400);

    const badDuration = await app.inject({
      method: "POST",
      url: "/api/messages/42/sermon-request/decide",
      payload: { approve: true, duration: "1y" }
    });
    assert.equal(badDuration.statusCode, 400);
  } finally {
    await app.close();
  }
});

test("decide 非管理员 403", async () => {
  const { app } = createHarness({ isAdmin: false });
  await app.ready();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/messages/42/sermon-request/decide",
      payload: { approve: true }
    });
    assert.equal(response.statusCode, 403);
  } finally {
    await app.close();
  }
});
