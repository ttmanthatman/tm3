import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import { createZoomSettingsStore, registerZoomRoutes } from "./zoom.js";
import { registerZoomWebhookRoutes } from "./zoomWebhook.js";
import { createZoomWebhookStore, ZOOM_WEBHOOK_SETTING } from "../services/zoomWebhook.js";
import { zoomMeetingId } from "../../shared/zoom.js";

const secret = "test-only-webhook-secret";
const meetingId = "7123456789";

function fixture(enabled = true) {
  let now = Date.parse("2026-10-24T04:00:00Z");
  let conflicts = 0;
  const rows = new Map([["zoom.link", `https://us06web.zoom.us/j/${meetingId}?pwd=test`]]);
  const prisma: PrismaClient = { $transaction: async (run: (tx: PrismaClient) => Promise<unknown>) => run(prisma),
    channel: { findMany: async () => [] }, message: { findMany: async () => [] }, setting: {
    findMany: async () => [...rows].map(([key, value]) => ({ key, value })),
    upsert: async ({ where, create, update }: { where: { key: string }; create: { value: string }; update: { value?: string } }) => {
      if (!rows.has(where.key)) rows.set(where.key, create.value);
      else if (update.value !== undefined) rows.set(where.key, update.value);
    },
    updateMany: async ({ where, data }: { where: { key: string; value: string }; data: { value: string } }) => {
      if (conflicts > 0) { conflicts--; return { count: 0 }; }
      if (rows.get(where.key) !== where.value) return { count: 0 };
      rows.set(where.key, data.value);
      return { count: 1 };
    }
  } } as unknown as PrismaClient;
  const webhook = createZoomWebhookStore(prisma, () => now);
  const settings = createZoomSettingsStore(prisma, () => now, enabled ? webhook : undefined);
  const app = Fastify();
  registerZoomRoutes(app, {
    settings,
    requireAuth: async (request, reply) => { if (!request.headers.authorization) return reply.code(401).send(); },
    requireAdmin: async (request, reply) => { if (request.headers.authorization !== "admin") return reply.code(403).send(); }
  });
  registerZoomWebhookRoutes(app, { secretToken: enabled ? secret : "", accept: webhook.accept, now: () => now });
  const event = (type: "meeting.started" | "meeting.ended", timestamp = now, uuid = "instance-a", id: string | number = meetingId) => ({
    event: type, event_ts: timestamp, payload: { account_id: "fixture-account", object: { id, uuid } }
  });
  const post = (body: unknown, options: { timestamp?: string; signature?: string; signingSecret?: string } = {}) => {
    const raw = typeof body === "string" ? body : JSON.stringify(body);
    const timestamp = options.timestamp ?? String(now / 1000);
    const signature = options.signature ?? `v0=${createHmac("sha256", options.signingSecret ?? secret).update(`v0:${timestamp}:${raw}`).digest("hex")}`;
    return app.inject({ method: "POST", url: "/api/zoom/webhook", headers: { "content-type": "application/json", "x-zm-request-timestamp": timestamp, "x-zm-signature": signature }, payload: raw });
  };
  return { app, rows, settings, event, post, now: () => now, advance: (ms: number) => { now += ms; }, conflict: (count: number) => { conflicts = count; } };
}

test("Zoom URL verification signs the challenge, verifies original JSON bytes and keeps other JSON parsers intact", async () => {
  const f = fixture();
  try {
    const raw = '{ "event": "endpoint.url_validation", "payload": {"plainToken":"fixture-challenge"} }';
    const response = await f.post(raw);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { plainToken: "fixture-challenge", encryptedToken: createHmac("sha256", secret).update("fixture-challenge").digest("hex") });
    assert.equal(f.rows.has(ZOOM_WEBHOOK_SETTING), false);
    const link = await f.app.inject({ method: "PUT", url: "/api/admin/zoom/link", headers: { authorization: "admin" }, payload: { url: "https://zoom.us/j/123456789" } });
    assert.equal(link.statusCode, 200);
    assert.equal(link.json().url, "https://zoom.us/j/123456789");
  } finally { await f.app.close(); }
});

test("Zoom rejects forged, missing, stale and malformed signatures before applying any state", async () => {
  const f = fixture();
  try {
    for (const options of [
      { signature: "" }, { signature: "v0=" + "0".repeat(64) }, { signature: "v0=short" },
      { signingSecret: "wrong-secret" }, { timestamp: String(f.now() / 1000 - 301) },
      { timestamp: String(f.now() / 1000 + 301) }, { timestamp: "invalid" }
    ]) assert.equal((await f.post(f.event("meeting.started"), options)).statusCode, 401);
    const unsigned = await f.app.inject({ method: "POST", url: "/api/zoom/webhook", payload: f.event("meeting.started") });
    assert.equal(unsigned.statusCode, 401);
    assert.equal((await f.post("{")).statusCode, 400);
    assert.equal((await f.post({ event: "endpoint.url_validation", payload: { plainToken: "" } })).statusCode, 400);
    assert.equal((await f.post({ event: "meeting.started", payload: {} })).statusCode, 400);
    assert.equal((await f.post(f.event("meeting.started", f.now() + 300_001))).statusCode, 400);
    assert.equal(f.rows.has(ZOOM_WEBHOOK_SETTING), false);
    assert.equal((await f.post({ event: "ignored", padding: "x".repeat(70_000) })).statusCode, 413);
  } finally { await f.app.close(); }
});

test("automatic state starts unknown, follows signed start/end events and survives store recreation", async () => {
  const f = fixture();
  try {
    assert.deepEqual((await f.settings.load()).live, { status: "unknown" });
    assert.equal((await f.post(f.event("meeting.started", f.now(), "instance-a", Number(meetingId)))).statusCode, 204);
    assert.equal((await f.settings.load()).live?.status, "active");
    assert.equal((await f.settings.load()).meeting, null);
    const recreated = createZoomWebhookStore({} as PrismaClient, f.now);
    assert.equal(recreated.status((await f.settings.load()).url, f.rows.get(ZOOM_WEBHOOK_SETTING)).status, "active");
    f.advance(60_000);
    assert.equal((await f.post(f.event("meeting.ended"))).statusCode, 204);
    assert.equal((await f.settings.load()).live?.status, "inactive");
    assert.equal((await f.app.inject("/api/zoom")).statusCode, 401);
    const denied = await f.app.inject({ method: "PUT", url: "/api/admin/zoom/meeting", headers: { authorization: "member" }, payload: {} });
    assert.equal(denied.statusCode, 403);
    const manual = await f.app.inject({ method: "PUT", url: "/api/admin/zoom/meeting", headers: { authorization: "admin" }, payload: {} });
    assert.equal(manual.statusCode, 409);
  } finally { await f.app.close(); }
});

test("unrelated meetings and events are ignored, and changing the configured room invalidates old status", async () => {
  const f = fixture();
  try {
    assert.equal((await f.post(f.event("meeting.started", f.now(), "other", "9999999999"))).statusCode, 204);
    assert.equal((await f.post({ event: "meeting.participant_joined" })).statusCode, 204);
    assert.equal(f.rows.has(ZOOM_WEBHOOK_SETTING), false);
    await f.post(f.event("meeting.started"));
    await f.settings.saveLink("https://zoom.us/j/9999999999");
    assert.equal((await f.settings.load()).live?.status, "unknown");
    await f.settings.saveLink("https://example.com/j/9999999999");
    await f.post(f.event("meeting.started", f.now(), "other", "9999999999"));
    assert.equal((await f.settings.load()).live?.status, "unknown");
  } finally { await f.app.close(); }
});

test("duplicates and out-of-order events cannot reopen an ended meeting or end a newer meeting instance", async () => {
  const f = fixture();
  try {
    const started = f.event("meeting.started");
    await f.post(started);
    const raw = f.rows.get(ZOOM_WEBHOOK_SETTING);
    await f.post(started);
    assert.equal(f.rows.get(ZOOM_WEBHOOK_SETTING), raw);
    f.advance(1000);
    const ended = f.event("meeting.ended");
    await f.post(ended);
    await f.post(started);
    await f.post(f.event("meeting.started"));
    assert.equal((await f.settings.load()).live?.status, "inactive");
    f.advance(1000);
    await f.post(f.event("meeting.started", f.now(), "instance-b"));
    await f.post(ended);
    f.advance(1000);
    await f.post(f.event("meeting.ended", f.now(), "instance-a"));
    assert.equal((await f.settings.load()).live?.status, "active");
    await f.post(f.event("meeting.ended", f.now(), "instance-b"));
    assert.equal((await f.settings.load()).live?.status, "inactive");
  } finally { await f.app.close(); }
});

test("concurrent updates use compare-and-swap, retry conflicts and return failure rather than losing an event", async () => {
  const f = fixture();
  try {
    f.conflict(1);
    const responses = await Promise.all([f.post(f.event("meeting.started")), f.post(f.event("meeting.ended", f.now() + 1))]);
    assert.ok(responses.every(response => response.statusCode === 204));
    assert.equal((await f.settings.load()).live?.status, "inactive");
    f.conflict(5);
    assert.equal((await f.post(f.event("meeting.started", f.now() + 2, "instance-b"))).statusCode, 500);
    assert.equal((await f.settings.load()).live?.status, "inactive");
  } finally { await f.app.close(); }
});

test("an expired active observation becomes unknown rather than inactive; disabled integration preserves manual mode", async () => {
  const f = fixture();
  const disabled = fixture(false);
  try {
    await f.post(f.event("meeting.started"));
    f.advance(24 * 60 * 60 * 1000 + 1);
    assert.equal((await f.settings.load()).live?.status, "unknown");
    assert.equal((await disabled.post(disabled.event("meeting.started"))).statusCode, 503);
    assert.equal((await disabled.settings.load()).live, undefined);
    assert.equal(disabled.rows.has(ZOOM_WEBHOOK_SETTING), false);
  } finally { await f.app.close(); await disabled.app.close(); }
});

test("only expected Zoom HTTPS join URLs supply a meeting ID", () => {
  assert.equal(zoomMeetingId(`https://us06web.zoom.us/j/${meetingId}?pwd=test`), meetingId);
  assert.equal(zoomMeetingId(`https://zoom.us/wc/join/${meetingId}`), meetingId);
  for (const url of [`https://zoom.us.evil.test/j/${meetingId}`, `http://zoom.us/j/${meetingId}`, `https://user:pass@zoom.us/j/${meetingId}`, "invalid", "https://zoom.us/j/123"]) assert.equal(zoomMeetingId(url), null);
});
