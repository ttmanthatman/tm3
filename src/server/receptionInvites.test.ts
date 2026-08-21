import assert from "node:assert/strict";
import test from "node:test";
import {
  createReceptionInviteToken,
  readReceptionInviteToken,
  receptionInviteMatchesRoom,
  receptionInviteUrl,
  receptionWelcomeMessage
} from "./receptionInvites.js";

const secret = "test-secret-that-is-long-enough-for-reception-invites";
const tokenHash = "a".repeat(64);
const expiresAt = Date.parse("2026-08-22T00:00:00.000Z");

test("reception invitation tokens are opaque and round-trip their bound room data", () => {
  const token = createReceptionInviteToken(
    { roomId: 42, expiresAt, tokenHash },
    secret,
    Buffer.from("000102030405060708090a0b", "hex")
  );
  assert.doesNotMatch(token, /42|2026|a{12}/);
  assert.deepEqual(readReceptionInviteToken(token, secret), { roomId: 42, expiresAt, tokenHash });
});

test("reception invitation tokens reject tampering and a different secret", () => {
  const token = createReceptionInviteToken({ roomId: 42, expiresAt, tokenHash }, secret);
  const changedAt = Math.floor(token.length / 2);
  const replacement = token[changedAt] === "A" ? "B" : "A";
  assert.throws(() => readReceptionInviteToken(`${token.slice(0, changedAt)}${replacement}${token.slice(changedAt + 1)}`, secret), /邀请链接无效/);
  assert.throws(() => readReceptionInviteToken(token, `${secret}-wrong`), /邀请链接无效/);
});

test("reception invitation tokens expire with the room and are revoked by a code change", () => {
  const payload = { roomId: 42, expiresAt, tokenHash };
  const room = { id: 42, receptionExpiresAt: new Date(expiresAt), receptionTokenHash: tokenHash };
  assert.equal(receptionInviteMatchesRoom(payload, room, expiresAt - 1), true);
  assert.equal(receptionInviteMatchesRoom(payload, room, expiresAt), false);
  assert.equal(receptionInviteMatchesRoom(payload, { ...room, receptionTokenHash: "b".repeat(64) }, expiresAt - 1), false);
  assert.equal(receptionInviteMatchesRoom(payload, { ...room, receptionExpiresAt: new Date(expiresAt - 10) }, expiresAt - 20), false);
});

test("reception welcome message states duration, encrypted transport, expiry, and destruction", () => {
  const message = receptionWelcomeMessage(72);
  assert.match(message, /有效期为 3 天/);
  assert.match(message, /加密连接/);
  assert.match(message, /令牌会立即失效/);
  assert.match(message, /消息和附件将被自动销毁/);
});

test("configured reception invite origins produce portable HTTPS links", () => {
  assert.equal(receptionInviteUrl("/visit/token", "https://visit.example.com"), "https://visit.example.com/visit/token");
  assert.equal(receptionInviteUrl("/visit/token"), null);
  assert.throws(() => receptionInviteUrl("/visit/token", "http://visit.example.com"), /must use HTTPS/);
  assert.throws(() => receptionInviteUrl("/visit/token", "https://visit.example.com/base"), /must be an origin/);
});
