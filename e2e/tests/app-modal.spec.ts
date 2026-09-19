import { expect, test, type APIRequestContext, type Browser, type Locator, type Page } from "@playwright/test";
import { E2E_ADMIN, E2E_CHANNELS, E2E_MEMBER } from "../seed-data.js";

async function blockPublicNetwork(page: Page) {
  await page.route("**/*", async (route) => {
    const hostname = new URL(route.request().url()).hostname;
    if (hostname === "127.0.0.1" || hostname === "localhost") {
      await route.continue();
      return;
    }
    await route.abort("blockedbyclient");
  });
}

async function loginAs(page: Page, account: { username: string; password: string }) {
  await page.goto("/");
  await page.getByPlaceholder("用户名").fill(account.username);
  await page.getByPlaceholder("密码").fill(account.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
}

async function expectFocusInside(root: Locator) {
  await expect
    .poll(() => root.evaluate((el) => el.contains(document.activeElement)))
    .toBe(true);
}

async function expectFocusSafelyOutsideModals(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        return !active || active === document.body || !active.closest(".modal-shell");
      })
    )
    .toBe(true);
}

// 管理员创建私密频道并把普通成员拉进来；退出频道的 ConfirmDialog 只对非负责人出现。
async function createPrivateChannelWithMember(adminPage: Page, name: string) {
  await adminPage.getByRole("button", { name: "创建频道", exact: true }).click();
  const editor = adminPage.locator(".channel-editor-modal");
  await expect(editor).toBeVisible();
  await editor.getByPlaceholder("频道名").fill(name);
  await editor.getByLabel("私密频道").check();
  await editor.getByRole("button", { name: "创建", exact: true }).click();
  await expect(editor).toHaveCount(0);

  // 创建成功后应用会接着打开“添加成员”选择器，把普通成员加进来。
  const picker = adminPage.locator(".member-picker-modal");
  await expect(picker).toBeVisible();
  const memberRow = picker.locator(".member-picker-row").filter({ hasText: E2E_MEMBER.displayName });
  await expect(memberRow).toBeVisible();
  await memberRow.click();
  await picker.getByRole("button", { name: /^添加/ }).click();
  await expect(picker).toHaveCount(0);
  await expect(adminPage.locator(".channel-row").filter({ hasText: name })).toBeVisible();
}

async function openMemberPage(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await blockPublicNetwork(page);
  await loginAs(page, E2E_MEMBER);
  return {
    context,
    page,
    // 测试超时后浏览器可能已被回收，关闭上下文不允许再抛错。
    async close() {
      await context.close().catch(() => {});
    }
  };
}

async function openChannelListOnMobile(page: Page) {
  const pane = page.locator(".channel-pane.open");
  if (await pane.isVisible()) return;
  const trigger = page.locator(".channel-mobile-trigger");
  // 布局断点由 CSS 决定；若触发器不可见说明频道列表已常驻展示。
  if (await trigger.isVisible()) {
    await trigger.click();
    await expect(pane).toBeVisible();
  }
}

async function openLeaveConfirm(page: Page, channelName: string, mobile: boolean) {
  if (mobile) await openChannelListOnMobile(page);
  await page
    .locator(".channel-row-wrap")
    .filter({ hasText: channelName })
    .getByLabel("频道设置")
    .click();
  // 移动端频道抽屉留在编辑器下层即可，modal-shell 会盖在它上面。
  const editor = page.locator(".channel-editor-modal");
  await expect(editor).toBeVisible();
  // 点击退出后频道设置会先关闭，确认弹窗单独出现（触发按钮随之卸载）。
  await editor.getByRole("button", { name: /退出频道/ }).click();
  const confirmDialog = page.getByRole("dialog", { name: "退出频道" });
  await expect(confirmDialog).toBeVisible();
  await expect(editor).toHaveCount(0);
  return { confirmDialog };
}

test.beforeEach(async ({ page }) => {
  await blockPublicNetwork(page);
});

// smoke.spec 的管理员账号用例与 sermon.spec 都会各自创建并删除 e2e-member；
// 本文件单独运行时需要先兜底创建，跑完再按“谁创建谁删除”还原。
let memberCreatedByUs = false;

async function adminApiToken(request: APIRequestContext) {
  const login = await request.post("/api/auth/login", {
    data: { username: E2E_ADMIN.username, password: E2E_ADMIN.password }
  });
  if (!login.ok()) throw new Error("管理员登录失败");
  const { token } = (await login.json()) as { token: string };
  return token;
}

test.beforeAll(async ({ request }) => {
  const token = await adminApiToken(request);
  const created = await request.post("/api/admin/accounts", {
    headers: { Authorization: `Bearer ${token}` },
    data: { username: E2E_MEMBER.username, password: E2E_MEMBER.password, displayName: E2E_MEMBER.displayName }
  });
  if (created.ok()) {
    memberCreatedByUs = true;
    return;
  }
  if (created.status() !== 409) {
    throw new Error(`创建成员账号失败: ${created.status()} ${await created.text()}`);
  }
});

test.afterAll(async ({ request }) => {
  if (!memberCreatedByUs) return;
  const token = await adminApiToken(request);
  const headers = { Authorization: `Bearer ${token}` };
  const list = await request.get("/api/admin/accounts", { headers });
  const body = (await list.json()) as { accounts: Array<{ id: number; username: string }> };
  const member = body.accounts.find((entry) => entry.username === E2E_MEMBER.username);
  if (member) await request.delete(`/api/admin/accounts/${member.id}`, { headers });
});

test("退出频道确认弹窗：打开聚焦、Tab 约束在弹窗内、Escape 关闭、焦点安全回退", async ({ page, browser }) => {
  await loginAs(page, E2E_ADMIN);
  await createPrivateChannelWithMember(page, "弹窗焦点验收频道");

  const member = await openMemberPage(browser);
  try {
    const { confirmDialog } = await openLeaveConfirm(member.page, "弹窗焦点验收频道", false);

    await expectFocusInside(confirmDialog);
    for (let i = 0; i < 6; i += 1) {
      await member.page.keyboard.press("Tab");
      await expectFocusInside(confirmDialog);
    }
    for (let i = 0; i < 6; i += 1) {
      await member.page.keyboard.press("Shift+Tab");
      await expectFocusInside(confirmDialog);
    }

    await member.page.keyboard.press("Escape");
    await expect(confirmDialog).toHaveCount(0);
    await expectFocusSafelyOutsideModals(member.page);

    // 显式取消按钮的关闭语义保持不变。
    const again = await openLeaveConfirm(member.page, "弹窗焦点验收频道", false);
    await again.confirmDialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(again.confirmDialog).toHaveCount(0);
  } finally {
    await member.close();
  }
});

test("确认弹窗在 360px 与 390px 宽度下保持焦点进入、Tab 约束与 Escape 关闭", async ({ page, browser }) => {
  test.setTimeout(60_000);
  await loginAs(page, E2E_ADMIN);
  const member = await openMemberPage(browser);
  try {
    for (const width of [360, 390]) {
      const name = `弹窗移动端验收频道${width}`;
      await createPrivateChannelWithMember(page, name);
      await member.page.setViewportSize({ width, height: 844 });
      const { confirmDialog } = await openLeaveConfirm(member.page, name, true);
      await expectFocusInside(confirmDialog);
      await member.page.keyboard.press("Tab");
      await expectFocusInside(confirmDialog);
      await member.page.keyboard.press("Escape");
      await expect(confirmDialog).toHaveCount(0);
      await expectFocusSafelyOutsideModals(member.page);
    }
  } finally {
    await member.close();
  }
});

test("转发选择器：打开聚焦、Tab 约束、Escape 关闭后焦点回退到安全位置", async ({ page }) => {
  await loginAs(page, E2E_ADMIN);
  const first = "弹窗验收转发：第一条";
  const second = "弹窗验收转发：第二条";
  for (const text of [first, second]) {
    await page.locator(".composer-main textarea").fill(text);
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.locator("[data-message-id]").filter({ hasText: text })).toHaveCount(1);
  }

  await page.getByRole("button", { name: "更多管理功能", exact: true }).click();
  await page.getByRole("menuitem", { name: "消息多选", exact: true }).click();
  await page.locator("[data-message-id]").filter({ hasText: first }).locator(".bubble").click();
  await page.locator("[data-message-id]").filter({ hasText: second }).locator(".bubble").click();
  const selectionBar = page.locator(".message-selection-bar");
  await expect(selectionBar).toContainText("已选择 2 条");

  await selectionBar.getByRole("button", { name: "转发", exact: true }).click();
  await page.locator(".forward-action-sheet").getByRole("button", { name: "合并转发", exact: true }).click();

  const forwardModal = page.locator(".forward-message-modal");
  await expect(forwardModal).toBeVisible();
  await expectFocusInside(forwardModal);
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press("Tab");
    await expectFocusInside(forwardModal);
  }

  // 触发按钮（动作面板里的“合并转发”）随弹窗关闭一并卸载，焦点应回退到安全位置而非悬空。
  await page.keyboard.press("Escape");
  await expect(forwardModal).toHaveCount(0);
  await expectFocusSafelyOutsideModals(page);
  await expect(selectionBar).toContainText("已选择 2 条");
});

test("反复开关确认弹窗 10 次：每次焦点都进入弹窗，Escape 都能关闭", async ({ page, browser }) => {
  test.setTimeout(90_000);
  await loginAs(page, E2E_ADMIN);
  await createPrivateChannelWithMember(page, "弹窗反复开关验收频道");

  const member = await openMemberPage(browser);
  try {
    for (let round = 0; round < 10; round += 1) {
      const { confirmDialog } = await openLeaveConfirm(member.page, "弹窗反复开关验收频道", false);
      await expectFocusInside(confirmDialog);
      await member.page.keyboard.press("Escape");
      await expect(confirmDialog).toHaveCount(0);
    }
  } finally {
    await member.close();
  }
});
