import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import type { FastifyRequest } from "fastify";
import { createRateLimitKeyGenerator, isRateLimitExempt } from "./rateLimitPolicy.js";

test("rate limit exemption covers immutable static and media GETs", () => {
  const exempt: Array<[string, string]> = [
    ["GET", "/assets/index-D2XdHBax.css"],
    ["HEAD", "/assets/index-D2XdHBax.css"],
    ["GET", "/socket.io/?EIO=4&transport=polling"],
    ["POST", "/socket.io/?EIO=4&transport=polling"],
    ["GET", "/avatars/u1.png"],
    ["GET", "/backgrounds/wall.webp"],
    ["GET", "/api/files/123"],
    ["GET", "/api/files/123?item=2"],
    ["GET", "/api/friend/media?url=https%3A%2F%2Fexample.com%2Fa.m4a"],
    ["GET", "/api/parallax/kit1/layer.png"],
    ["GET", "/api/music/tracks/7/stream"],
    ["GET", "/api/music/scores/3/pages/9"],
    ["GET", "/api/channels/5/pinned/files/report.pdf"]
  ];
  for (const [method, url] of exempt) {
    assert.equal(isRateLimitExempt(method, url), true, `${method} ${url}`);
  }
});

test("rate limit exemption keeps API data and mutations counted", () => {
  const counted: Array<[string, string]> = [
    ["GET", "/api/messages?channelId=1"],
    ["GET", "/api/channels"],
    ["GET", "/api/music/tracks"],
    ["GET", "/api/bible/chapter?book=JHN&chapter=3"],
    ["GET", "/api/health"],
    ["POST", "/api/messages"],
    ["POST", "/api/files/123"],
    ["DELETE", "/api/files/123"],
    ["POST", "/api/auth/login"],
    ["GET", "/"],
    ["GET", "/index.html"]
  ];
  for (const [method, url] of counted) {
    assert.equal(isRateLimitExempt(method, url), false, `${method} ${url}`);
  }
});

function fakeRequest(ip: string, authorization?: string): FastifyRequest {
  return { ip, headers: authorization ? { authorization } : {} } as unknown as FastifyRequest;
}

test("rate limit key uses the account for valid bearer tokens", () => {
  const keyOf = createRateLimitKeyGenerator("test-secret");
  const token = jwt.sign({ accountId: 42, sessionId: "s1" }, "test-secret");
  assert.equal(keyOf(fakeRequest("1.2.3.4", `Bearer ${token}`)), "account:42");
});

test("rate limit key falls back to IP for missing or invalid tokens", () => {
  const keyOf = createRateLimitKeyGenerator("test-secret");
  assert.equal(keyOf(fakeRequest("1.2.3.4")), "ip:1.2.3.4");
  assert.equal(keyOf(fakeRequest("1.2.3.4", "Bearer garbage")), "ip:1.2.3.4");
  const wrongSecret = jwt.sign({ accountId: 42 }, "other-secret");
  assert.equal(keyOf(fakeRequest("1.2.3.4", `Bearer ${wrongSecret}`)), "ip:1.2.3.4");
  const expired = jwt.sign({ accountId: 42 }, "test-secret", { expiresIn: -10 });
  assert.equal(keyOf(fakeRequest("1.2.3.4", `Bearer ${expired}`)), "ip:1.2.3.4");
  const noAccount = jwt.sign({ sessionId: "s1" }, "test-secret");
  assert.equal(keyOf(fakeRequest("1.2.3.4", `Bearer ${noAccount}`)), "ip:1.2.3.4");
});
