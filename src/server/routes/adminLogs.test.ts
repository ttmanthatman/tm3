import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { AdminLoginLogDTO } from "../../shared/types.js";
import { registerAdminLogRoutes } from "./adminLogs.js";

function createHarness() {
  const database = new Database(":memory:");
  database.function("JSON_UNQUOTE", (value: unknown) => (value === null || value === undefined) ? null : String(value));
  database.function("regexp", (pattern: unknown, value: unknown) => (value === null || value === undefined) ? 0 : Number(new RegExp(String(pattern)).test(String(value))));
  database.exec(`
    CREATE TABLE accounts (id INTEGER PRIMARY KEY, username TEXT, display_name TEXT, is_guest BOOLEAN);
    CREATE TABLE actors (id INTEGER PRIMARY KEY, kind TEXT, account_id INTEGER, username TEXT, display_name TEXT);
    CREATE TABLE channels (id INTEGER PRIMARY KEY, name TEXT, kind TEXT, is_private BOOLEAN);
    CREATE TABLE messages (id INTEGER PRIMARY KEY, channel_id INTEGER, sender_actor_id INTEGER, content TEXT, type TEXT, payload JSON, file_name TEXT, reply_to_id INTEGER, created_at TEXT);
    CREATE TABLE account_login_logs (id INTEGER PRIMARY KEY, kind TEXT, account_id INTEGER, device_kind TEXT, device_name TEXT, ip_address TEXT, user_agent TEXT, session_id TEXT, created_at TEXT);
    CREATE TABLE account_activity_logs (
      id INTEGER PRIMARY KEY, kind TEXT, account_id INTEGER, device_kind TEXT, device_name TEXT, ip_address TEXT,
      user_agent TEXT, session_id TEXT, channel_id INTEGER, track_id INTEGER, playback_id TEXT, app_version TEXT,
      latest_version TEXT, is_latest_version BOOLEAN, event_state TEXT, progress_ms INTEGER, listened_ms INTEGER,
      duration_ms INTEGER, created_at TEXT
    );
    INSERT INTO accounts VALUES (1, 'alice', '提问者', FALSE), (2, 'bob', '另一位用户', FALSE), (3, 'guest', '来访者', TRUE);
    INSERT INTO actors VALUES (1, 'human', 1, 'alice', '提问者'), (2, 'virtual', NULL, 'ai_slmm', '所罗没门'), (3, 'human', 2, 'bob', '另一位用户'), (4, 'human', 3, 'guest', '来访者');
    INSERT INTO channels VALUES (10, '聊天室', 'standard', FALSE), (11, '私聊：提问者、所罗没门', 'direct', TRUE), (12, '私密小组', 'standard', TRUE), (13, '会客厅', 'reception', TRUE);
  `);
  const queries: string[] = [];
  const prisma = {
    $queryRaw: async (parts: TemplateStringsArray, ...values: unknown[]) => {
      const sql = parts.join("?");
      queries.push(sql);
      const rows = database.prepare(sql).all(...values) as Array<Record<string, unknown>>;
      return rows.map((row) => ({ ...row, createdAt: new Date(String(row.createdAt)) }));
    }
  } as unknown as PrismaClient;
  const app = Fastify();
  registerAdminLogRoutes(app, {
    prisma,
    requireAdmin: async (request, reply) => {
      if (request.headers["x-test-admin"] !== "yes") return reply.code(403).send({ success: false, message: "仅管理员可查看日志" });
    }
  });
  const addMessage = (input: {
    id: number; channelId?: number; senderId?: number; content?: string; type?: string;
    payload?: Record<string, unknown>; fileName?: string; replyToId?: number;
  }) => database.prepare("INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    input.id, input.channelId ?? 10, input.senderId ?? 1, input.content ?? "我的问题", input.type ?? "text",
    input.payload ? JSON.stringify(input.payload) : null, input.fileName ?? null, input.replyToId ?? null,
    new Date(Date.UTC(2026, 9, 22, 1, 0, input.id)).toISOString()
  );
  const request = (url = "/api/admin/activity-logs?category=ai") => app.inject({ method: "GET", url, headers: { "x-test-admin": "yes" } });
  return { app, database, queries, addMessage, request, close: async () => { await app.close(); database.close(); } };
}

test("admin logs show the full human question and virtual answer with their message IDs", async () => {
  const h = createHarness();
  try {
    h.addMessage({ id: 1, content: "@所罗没门 为什么要彼此相爱？" });
    h.addMessage({ id: 2, senderId: 2, content: "因为神先爱我们。<script>unsafe()</script>", replyToId: 1 });
    const response = await h.request();
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().logs, [{
      id: "ai-2", kind: "ai_exchange", category: "ai", accountId: 1, username: "alice", displayName: "提问者",
      channelId: 10, channelName: "聊天室", aiRoleUsername: "ai_slmm", aiRoleName: "所罗没门", isPrivateConversation: false,
      questionMessageId: 1, answerMessageId: 2, questionText: "@所罗没门 为什么要彼此相爱？",
      answerText: "因为神先爱我们。<script>unsafe()</script>", createdAt: "2026-10-22T01:00:02.000Z"
    }]);
    const legacyAlias = await h.request("/api/admin/login-logs?category=ai");
    assert.deepEqual(legacyAlias.json(), response.json());
  } finally { await h.close(); }
});

test("direct conversations include every answer and safely label file, image, and music responses", async () => {
  const h = createHarness();
  try {
    h.addMessage({ id: 10, channelId: 11, content: "给我一首诗歌和歌谱" });
    h.addMessage({ id: 11, channelId: 11, senderId: 2, content: "找到以下资料", payload: { triggerMessageId: 10, hiddenKey: "must-stay-private" } });
    h.addMessage({ id: 12, channelId: 11, senderId: 2, type: "file", content: "歌谱", fileName: "/private/storage/恩典.pdf", replyToId: 10 });
    h.addMessage({ id: 13, channelId: 11, senderId: 2, type: "image", content: "第二页", fileName: "uploads\\恩典.jpg", replyToId: 10 });
    h.addMessage({ id: 14, channelId: 11, senderId: 2, type: "music_playlist", content: "恩典之路", replyToId: 10 });
    const response = await h.request();
    assert.equal(response.statusCode, 200);
    const logs: AdminLoginLogDTO[] = response.json().logs;
    assert.deepEqual(logs.map((log) => log.answerMessageId), [14, 13, 12, 11]);
    assert.ok(logs.every((log) => log.isPrivateConversation && log.questionMessageId === 10 && log.questionText === "给我一首诗歌和歌谱"));
    assert.deepEqual(logs.map((log) => log.answerText), ["[歌单]\n恩典之路", "[图片：恩典.jpg]\n第二页", "[文件：恩典.pdf]\n歌谱", "找到以下资料"]);
    assert.doesNotMatch(response.body, /must-stay-private|private\/storage|uploads/);
  } finally { await h.close(); }
});

test("logs exclude human conversations, cross-channel references, unlinked answers, virtual questions, guests, and reception", async () => {
  const h = createHarness();
  try {
    h.addMessage({ id: 1, channelId: 11 });
    h.addMessage({ id: 2, channelId: 11, senderId: 3, content: "human private content", replyToId: 1 });
    h.addMessage({ id: 3, senderId: 2, content: "cross-channel answer", replyToId: 1 });
    h.addMessage({ id: 4, channelId: 11, senderId: 2, content: "unlinked answer" });
    h.addMessage({ id: 5, channelId: 11, senderId: 2, payload: { triggerMessageId: "1oops" } });
    h.addMessage({ id: 6, channelId: 11, senderId: 2, replyToId: 4 });
    h.addMessage({ id: 7, channelId: 13 });
    h.addMessage({ id: 8, channelId: 13, senderId: 2, replyToId: 7 });
    h.addMessage({ id: 9, senderId: 4 });
    h.addMessage({ id: 10, senderId: 2, replyToId: 9 });
    const response = await h.request();
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().logs, []);
  } finally { await h.close(); }
});

test("non-admin requests cannot access regular or private exchange logs", async () => {
  const h = createHarness();
  try {
    for (const url of ["/api/admin/activity-logs", "/api/admin/login-logs?category=ai"]) {
      const response = await h.app.inject({ method: "GET", url });
      assert.equal(response.statusCode, 403);
      assert.equal(response.json().success, false);
    }
    assert.equal(h.queries.length, 0);
  } finally { await h.close(); }
});

test("invalid limits and categories are rejected before reading log content", async () => {
  const h = createHarness();
  try {
    for (const query of ["limit=no", "limit=0", "limit=501", "limit=1.5", "category=private"]) {
      const response = await h.request(`/api/admin/activity-logs?${query}`);
      assert.equal(response.statusCode, 400);
      assert.deepEqual(response.json(), { success: false, message: "日志参数无效" });
    }
    assert.equal(h.queries.length, 0);
  } finally { await h.close(); }
});

test("existing categories avoid AI queries and all logs retain ordering and limits", async () => {
  const h = createHarness();
  try {
    h.addMessage({ id: 1 });
    h.addMessage({ id: 2, senderId: 2, replyToId: 1 });
    h.addMessage({ id: 3, channelId: 12 });
    h.addMessage({ id: 4, channelId: 12, senderId: 2, replyToId: 3 });
    h.database.prepare("INSERT INTO account_activity_logs (id, kind, account_id, channel_id, created_at) VALUES (1, 'message_sent', 1, 10, ?)").run("2026-10-22T01:00:03.000Z");
    h.database.prepare("INSERT INTO account_login_logs (id, kind, account_id, created_at) VALUES (1, 'auth_login', 1, ?)").run("2026-10-22T01:00:01.000Z");
    for (const category of ["session", "music", "usage"]) {
      h.queries.length = 0;
      const response = await h.request(`/api/admin/activity-logs?category=${category}`);
      assert.equal(response.statusCode, 200);
      assert.ok(response.json().logs.every((log: AdminLoginLogDTO) => log.category === category));
      assert.ok(h.queries.every((sql) => !sql.includes("FROM messages answer")));
    }
    const response = await h.request("/api/admin/activity-logs?category=all&limit=3");
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().logs.map((log: AdminLoginLogDTO) => log.id), ["ai-4", "activity-1", "ai-2"]);
    assert.equal(response.json().logs[0].isPrivateConversation, true);
  } finally { await h.close(); }
});

test("exchange text is bounded while retaining long questions and answers", async () => {
  const h = createHarness();
  try {
    h.addMessage({ id: 1, content: "问".repeat(70_000) });
    h.addMessage({ id: 2, senderId: 2, content: "答".repeat(70_000), replyToId: 1 });
    const response = await h.request();
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().logs[0].questionText.length, 65_535);
    assert.equal(response.json().logs[0].answerText.length, 65_535);
  } finally { await h.close(); }
});
