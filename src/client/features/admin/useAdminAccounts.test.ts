/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import type { AccountDTO } from "@shared/types";
import {
  adminAccountDeleteConfirmation,
  canDeleteAdminAccount,
  createAdminAccountEdit,
  createAdminAccountEdits
} from "./useAdminAccounts";

function account(overrides: Partial<AccountDTO> = {}): AccountDTO {
  return {
    id: 1,
    username: "admin",
    displayName: "管理员",
    avatarPath: null,
    isAdmin: true,
    canPinMessages: true,
    actorId: 11,
    theme: "wechat",
    biblePreferences: {
      outputFormat: "referenceVerseLines",
      referenceLabelMode: "normalizedFull",
      combinedPassageMode: "compactEllipsis",
      quotationStyle: "fullWidth"
    },
    ...overrides
  };
}

test("admin account edits copy editable permissions and always clear password", () => {
  assert.deepEqual(createAdminAccountEdit(account()), {
    displayName: "管理员",
    isAdmin: true,
    canPinMessages: true,
    password: ""
  });

  assert.deepEqual(createAdminAccountEdits([
    account(),
    account({ id: 2, username: "reader", displayName: "读者", isAdmin: false, canPinMessages: false })
  ]), {
    1: { displayName: "管理员", isAdmin: true, canPinMessages: true, password: "" },
    2: { displayName: "读者", isAdmin: false, canPinMessages: false, password: "" }
  });
});

test("the current administrator cannot delete their own account", () => {
  assert.equal(canDeleteAdminAccount(1, 1), false);
  assert.equal(canDeleteAdminAccount(1, 2), true);
  assert.equal(canDeleteAdminAccount(null, 2), true);
});

test("account deletion keeps the destructive confirmation warning stable", () => {
  assert.equal(
    adminAccountDeleteConfirmation(account({ username: "reader", displayName: "普通用户" })),
    "警告：确定删除用户“普通用户”（@reader）吗？\n\n该用户将无法再登录，个人收藏、会话和频道成员关系会被永久删除；历史消息会保留并标记为“已删除用户”。此操作无法撤销。"
  );
});
