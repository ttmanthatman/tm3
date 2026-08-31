/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import {
  canEditChannel,
  canLeaveChannel,
  canManageChannelMembers,
  canOpenChannelSettings,
  canSubmitChannelDraft,
  createChannelDraft,
  normalizeChannelDraft
} from "./channelManagement";

test("createChannelDraft starts new channels as private without a custom list color", () => {
  assert.deepEqual(createChannelDraft(), { name: "", description: "", isPrivate: true, listColor: "#e8f4ec", useListColor: false });
});

test("canEditChannel excludes protected system channels", () => {
  assert.equal(canEditChannel({ canManage: true, kind: "standard" }), true);
  assert.equal(canEditChannel({ canManage: true, kind: "direct" }), true);
  assert.equal(canEditChannel({ canManage: true, kind: "aiLounge" }), false);
  assert.equal(canEditChannel({ canManage: true, kind: "music" }), false);
  assert.equal(canEditChannel({ canManage: false, kind: "standard" }), false);
  assert.equal(canEditChannel(null), false);
});

test("canManageChannelMembers only allows private manageable channels", () => {
  assert.equal(canManageChannelMembers({ canManage: true, kind: "standard", isPrivate: true }), true);
  assert.equal(canManageChannelMembers({ canManage: true, kind: "direct", isPrivate: true }), true);
  assert.equal(canManageChannelMembers({ canManage: true, kind: "standard", isPrivate: false }), false);
  assert.equal(canManageChannelMembers({ canManage: false, kind: "standard", isPrivate: true }), false);
  assert.equal(canManageChannelMembers({ canManage: true, kind: "aiLounge", isPrivate: true }), false);
  assert.equal(canManageChannelMembers({ canManage: true, kind: "music", isPrivate: true }), false);
});

test("every member can open settings and leave an ordinary private channel", () => {
  const memberChannel = {
    canManage: false,
    kind: "standard",
    isPrivate: true,
    isDefault: false,
    directKey: null
  };
  assert.equal(canEditChannel(memberChannel), false);
  assert.equal(canLeaveChannel(memberChannel), true);
  assert.equal(canOpenChannelSettings(memberChannel), true);
});

test("protected, public, default, and direct channels do not expose the membership leave action", () => {
  assert.equal(canLeaveChannel({ kind: "standard", isPrivate: false, isDefault: false, directKey: null }), false);
  assert.equal(canLeaveChannel({ kind: "standard", isPrivate: true, isDefault: true, directKey: null }), false);
  assert.equal(canLeaveChannel({ kind: "standard", isPrivate: true, isDefault: false, directKey: "1:2" }), false);
  assert.equal(canLeaveChannel({ kind: "aiLounge", isPrivate: true, isDefault: false, directKey: null }), false);
  assert.equal(canLeaveChannel({ kind: "music", isPrivate: true, isDefault: false, directKey: null }), false);
});

test("normalizeChannelDraft trims submitted fields but keeps privacy choice", () => {
  assert.deepEqual(
    normalizeChannelDraft({
      name: "  小组交通  ",
      description: "  周中安排  ",
      isPrivate: false,
      listColor: "#AABBCC",
      useListColor: true
    }),
    { name: "小组交通", description: "周中安排", isPrivate: false, listColor: "#aabbcc" }
  );
});

test("canSubmitChannelDraft requires a non-empty name and idle editor", () => {
  const draft = { name: "交通", description: "", isPrivate: true, listColor: "#e8f4ec", useListColor: false };
  assert.equal(canSubmitChannelDraft({ ...draft, name: "  " }), false);
  assert.equal(canSubmitChannelDraft(draft, true), false);
  assert.equal(canSubmitChannelDraft(draft), true);
});
