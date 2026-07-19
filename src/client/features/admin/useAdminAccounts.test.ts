/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import type { AccountDTO } from "@shared/types";
import {
  adminAccountDeleteConfirmation,
  canDeleteAdminAccount,
  createAdminAccountEdit,
  createAdminAccountEdits,
  useAdminAccounts
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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function createAccountsHarness(currentAccountId = 1) {
  const messages: string[] = [];
  const manager = useAdminAccounts({
    currentAccountId: () => currentAccountId,
    onCurrentAccountUpdated: () => undefined,
    onMessage: (message) => messages.push(message)
  });
  return { manager, messages };
}

test("valid account creation uses the POST response, selects the account, and prevents duplicate submission", async () => {
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = globalThis.localStorage;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  let finishRequest: ((response: Response) => void) | undefined;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => "", setItem: () => undefined, removeItem: () => undefined }
  });
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    return new Promise<Response>((resolve) => {
      finishRequest = resolve;
    });
  }) as typeof fetch;

  try {
    const { manager, messages } = createAccountsHarness();
    manager.newUser.value = {
      username: "new-reader",
      displayName: "新读者",
      password: "StrongPass123",
      isAdmin: false,
      canPinMessages: true
    };

    const firstSubmission = manager.addUser();
    const secondSubmission = manager.addUser();
    assert.equal(manager.creating.value, true);
    assert.equal(requests.length, 1);

    finishRequest?.(jsonResponse({
      success: true,
      account: account({
        id: 3,
        username: "new-reader",
        displayName: "新读者",
        isAdmin: false,
        canPinMessages: true
      })
    }));
    assert.equal(await firstSubmission, true);
    assert.equal(await secondSubmission, false);
    assert.equal(manager.creating.value, false);
    assert.deepEqual(manager.accounts.value.map((item) => item.username), ["new-reader"]);
    assert.equal(manager.selectedAccountId.value, 3);
    assert.deepEqual(manager.newUser.value, {
      username: "",
      displayName: "",
      password: "",
      isAdmin: false,
      canPinMessages: false
    });
    assert.equal(manager.message.value, "用户已创建");
    assert.equal(messages.at(-1), "用户已创建");
    assert.equal(requests.some((request) => request.init?.method === "GET"), false);
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: originalLocalStorage
    });
  }
});

test("invalid account drafts expose field errors without sending a request", async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = (async () => {
    requestCount += 1;
    return jsonResponse({});
  }) as typeof fetch;

  try {
    const { manager } = createAccountsHarness();
    manager.newUser.value = {
      username: "不合规",
      displayName: "",
      password: "short",
      isAdmin: false,
      canPinMessages: false
    };

    assert.equal(await manager.addUser(), false);
    assert.equal(requestCount, 0);
    assert.deepEqual(manager.createFieldErrors.value, {
      username: "用户名只能包含英文字母、数字、下划线、点和短横线",
      displayName: "显示名不能为空",
      password: "密码长度必须为 10–128 位"
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("empty account fields are rejected before any request is sent", async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = (async () => {
    requestCount += 1;
    return jsonResponse({});
  }) as typeof fetch;

  try {
    const { manager } = createAccountsHarness();
    assert.equal(await manager.addUser(), false);
    assert.equal(requestCount, 0);
    assert.deepEqual(manager.createFieldErrors.value, {
      username: "用户名不能为空",
      displayName: "显示名不能为空",
      password: "密码长度必须为 10–128 位"
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("server and network creation errors remain visible and preserve the draft", async () => {
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => "", setItem: () => undefined, removeItem: () => undefined }
  });

  try {
    const duplicateHarness = createAccountsHarness();
    duplicateHarness.manager.newUser.value = {
      username: "reader",
      displayName: "读者",
      password: "StrongPass123",
      isAdmin: false,
      canPinMessages: false
    };
    globalThis.fetch = (async () => jsonResponse(
      { success: false, message: "用户名已存在" },
      409
    )) as typeof fetch;
    assert.equal(await duplicateHarness.manager.addUser(), false);
    assert.equal(duplicateHarness.manager.createError.value, "用户名已存在");
    assert.equal(duplicateHarness.manager.newUser.value.username, "reader");

    const networkHarness = createAccountsHarness();
    networkHarness.manager.newUser.value = {
      username: "network-reader",
      displayName: "网络读者",
      password: "StrongPass123",
      isAdmin: false,
      canPinMessages: false
    };
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    assert.equal(await networkHarness.manager.addUser(), false);
    assert.equal(networkHarness.manager.createError.value, "网络连接失败，请检查网络后重试");
    assert.equal(networkHarness.manager.newUser.value.username, "network-reader");
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: originalLocalStorage
    });
  }
});

test("saving one selected account preserves another account's unsaved edit", async () => {
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => "", setItem: () => undefined, removeItem: () => undefined }
  });

  try {
    const { manager } = createAccountsHarness();
    const administrator = account();
    const reader = account({
      id: 2,
      username: "reader",
      displayName: "读者",
      isAdmin: false,
      canPinMessages: false
    });
    manager.accounts.value = [administrator, reader];
    manager.accountEdits.value = createAdminAccountEdits([administrator, reader]);
    manager.accountEdits.value[2].displayName = "尚未保存的读者昵称";
    globalThis.fetch = (async () => jsonResponse({
      success: true,
      account: account({ displayName: "管理员已更新" })
    })) as typeof fetch;

    manager.accountEdits.value[1].displayName = "管理员已更新";
    assert.equal(await manager.updateAccount(administrator), true);
    assert.equal(manager.accountEdits.value[1].displayName, "管理员已更新");
    assert.equal(manager.accountEdits.value[2].displayName, "尚未保存的读者昵称");
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: originalLocalStorage
    });
  }
});

test("the sole administrator remains protected even when managed by another account", () => {
  const { manager } = createAccountsHarness(99);
  const soleAdministrator = account();
  manager.accounts.value = [soleAdministrator];

  assert.equal(manager.canDeleteAccount(soleAdministrator), false);
  assert.equal(manager.deleteDisabledReason(soleAdministrator), "不能删除最后一个管理员");
  assert.equal(manager.adminPermissionLocked(soleAdministrator), true);
});
