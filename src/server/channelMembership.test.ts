import assert from "node:assert/strict";
import test from "node:test";
import {
  channelNeedsExplicitMembership,
  channelNotificationAudienceWhere,
  virtualCharacterConfigForChannel,
  virtualCharacterVisibleInChannel
} from "./channelMembership.js";

test("private and direct channels require an explicit human membership", () => {
  assert.equal(channelNeedsExplicitMembership({ isPrivate: true, directKey: null }), true);
  assert.equal(channelNeedsExplicitMembership({ isPrivate: false, directKey: "1:2" }), true);
  assert.equal(channelNeedsExplicitMembership({ isPrivate: false, directKey: null }), false);
});

test("private channel notifications are restricted to current memberships", () => {
  assert.deepEqual(channelNotificationAudienceWhere(7, { isPrivate: true, directKey: null }), {
    memberships: { some: { channelId: 7 } }
  });
  assert.deepEqual(channelNotificationAudienceWhere(7, { isPrivate: false, directKey: null }), {});
});

test("virtual characters stay out of private channels unless configured there", () => {
  const privateChannel = { id: 8, isPrivate: true, directKey: null };
  assert.equal(virtualCharacterVisibleInChannel(privateChannel, { username: "ai_slmm", config: { channels: [] } }), false);
  assert.equal(virtualCharacterVisibleInChannel(privateChannel, { username: "ai_slmm", config: { channels: [8] } }), true);
  assert.equal(virtualCharacterVisibleInChannel({ ...privateChannel, isPrivate: false }, { username: "ai_slmm", config: { channels: [] } }), true);
});

test("opening a dedicated virtual direct channel counts as inviting that character", () => {
  const channel = { id: 12, isPrivate: true, directKey: "virtual:3:why_assistant" };
  assert.equal(virtualCharacterVisibleInChannel(channel, { username: "why_assistant", config: { channels: [] } }), true);
  assert.equal(virtualCharacterVisibleInChannel(channel, { username: "ai_slmm", config: { channels: [] } }), false);
});

test("virtual invitations update channel configuration without losing character settings", () => {
  const invited = virtualCharacterConfigForChannel({ profile: { persona: "保留" }, channels: [2] }, 8, true);
  assert.deepEqual(invited, { profile: { persona: "保留" }, channels: [2, 8] });
  assert.deepEqual(virtualCharacterConfigForChannel(invited, 2, false), { profile: { persona: "保留" }, channels: [8] });
});
