/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import { canEditChannel, canManageChannelMembers, canSubmitChannelDraft, createChannelDraft, normalizeChannelDraft } from "./channelManagement";

test("createChannelDraft starts new channels as private", () => {
  assert.deepEqual(createChannelDraft(), { name: "", description: "", isPrivate: true });
});

test("canEditChannel only allows manageable non-AI channels", () => {
  assert.equal(canEditChannel({ canManage: true, kind: "standard" }), true);
  assert.equal(canEditChannel({ canManage: true, kind: "direct" }), true);
  assert.equal(canEditChannel({ canManage: true, kind: "aiLounge" }), false);
  assert.equal(canEditChannel({ canManage: false, kind: "standard" }), false);
  assert.equal(canEditChannel(null), false);
});

test("canManageChannelMembers only allows private manageable channels", () => {
  assert.equal(canManageChannelMembers({ canManage: true, kind: "standard", isPrivate: true }), true);
  assert.equal(canManageChannelMembers({ canManage: true, kind: "direct", isPrivate: true }), true);
  assert.equal(canManageChannelMembers({ canManage: true, kind: "standard", isPrivate: false }), false);
  assert.equal(canManageChannelMembers({ canManage: false, kind: "standard", isPrivate: true }), false);
  assert.equal(canManageChannelMembers({ canManage: true, kind: "aiLounge", isPrivate: true }), false);
});

test("normalizeChannelDraft trims submitted fields but keeps privacy choice", () => {
  assert.deepEqual(
    normalizeChannelDraft({
      name: "  小组交通  ",
      description: "  周中安排  ",
      isPrivate: false
    }),
    { name: "小组交通", description: "周中安排", isPrivate: false }
  );
});

test("canSubmitChannelDraft requires a non-empty name and idle editor", () => {
  assert.equal(canSubmitChannelDraft({ name: "  ", description: "", isPrivate: true }), false);
  assert.equal(canSubmitChannelDraft({ name: "交通", description: "", isPrivate: true }, true), false);
  assert.equal(canSubmitChannelDraft({ name: "交通", description: "", isPrivate: true }), true);
});
