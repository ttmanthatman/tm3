import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import { createZoomSettingsStore, registerZoomRoutes } from "./zoom.js";

test("Zoom links and meeting status require admin, persist independently and expire in absolute time", async () => {
  const rows = new Map<string, string>();
  let now = Date.parse("2026-10-23T10:00:00Z");
  const prisma = { setting: {
    findMany: async () => [...rows].map(([key, value]) => ({ key, value })),
    upsert: async ({ where, update }: { where: { key: string }; update: { value: string } }) => rows.set(where.key, update.value)
  } } as unknown as PrismaClient;
  const settings = createZoomSettingsStore(prisma, () => now);
  const app = Fastify();
  registerZoomRoutes(app, {
    settings,
    requireAuth: async (request, reply) => { if (!request.headers.authorization) return reply.code(401).send({ success: false }); },
    requireAdmin: async (request, reply) => { if (request.headers.authorization !== "admin") return reply.code(403).send({ success: false }); }
  });
  const put = (part: string, payload: object, authorization = "admin") => app.inject({ method: "PUT", url: `/api/admin/zoom/${part}`, headers: { authorization }, payload });
  const get = () => app.inject({ method: "GET", url: "/api/zoom", headers: { authorization: "member" } });
  try {
    assert.equal((await app.inject("/api/zoom")).statusCode, 401);
    assert.deepEqual((await get()).json(), { url: "", meeting: null });
    assert.equal((await put("link", { url: "https://zoom.us/j/123" }, "member")).statusCode, 403);
    assert.equal((await put("meeting", { active: true, durationMinutes: 60, timeZone: "Asia/Shanghai" }, "member")).statusCode, 403);
    for (const url of ["javascript:alert(1)", "//zoom.us/j/123", "zoommtg://zoom.us/join", "https://user:password@zoom.us/j/123", "invalid"]) {
      assert.equal((await put("link", { url })).statusCode, 400);
    }
    assert.equal((await put("link", { url: "  https://zoom.us/j/123?pwd=example  " })).statusCode, 200);
    for (const input of [
      { active: true, durationMinutes: 0, timeZone: "Asia/Shanghai" },
      { active: true, durationMinutes: 1.5, timeZone: "Asia/Shanghai" },
      { active: true, durationMinutes: 10081, timeZone: "Asia/Shanghai" },
      { active: true, durationMinutes: 60, timeZone: "Beijing" },
      { active: "true", durationMinutes: 60, timeZone: "Asia/Shanghai" }
    ]) assert.equal((await put("meeting", input)).statusCode, 400);
    const saved = await put("meeting", { active: true, durationMinutes: 60, timeZone: "America/New_York" });
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.json().meeting.endsAt, "2026-10-23T11:00:00.000Z");
    assert.equal(saved.json().meeting.timeZone, "America/New_York");
    assert.equal(saved.json().url, "https://zoom.us/j/123?pwd=example");
    await put("link", { url: "https://zoom.us/j/456" });
    assert.deepEqual((await get()).json().meeting, saved.json().meeting);
    assert.deepEqual(await createZoomSettingsStore(prisma, () => now).load(), (await get()).json());
    now += 3_600_000;
    assert.equal((await get()).json().meeting, null);
    await put("meeting", { active: true, durationMinutes: 30, timeZone: "Asia/Shanghai" });
    await put("meeting", { active: false, durationMinutes: 30, timeZone: "Asia/Shanghai" });
    assert.equal((await get()).json().meeting, null);
    assert.equal((await get()).json().url, "https://zoom.us/j/456");
    await put("link", { url: "" });
    assert.equal((await get()).json().url, "");
  } finally { await app.close(); }
});
