import { expect, test, type Locator, type Page } from "@playwright/test";
import { E2E_ADMIN, E2E_CHANNELS } from "../seed-data.js";

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

async function loginAsAdmin(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("用户名").fill(E2E_ADMIN.username);
  await page.getByPlaceholder("密码").fill(E2E_ADMIN.password);
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

test.beforeEach(async ({ page }) => {
  await blockPublicNetwork(page);
});

// 真实应用里转发弹窗（AppModal）是焦点陷阱的关键消费方；这里在三种视口下验证同一矩阵。
// 双层叠放与焦点归还触发元素的语义由 app-modal-harness.spec.ts 的离线宿主页覆盖，不在此重复。
test("转发弹窗在 1280px、390px、360px 下均保持焦点进入、Tab 约束与 Escape 关闭", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await loginAsAdmin(page);

  const stamp = Date.now();
  const first = `键盘验收转发：第一条 ${stamp}`;
  const second = `键盘验收转发：第二条 ${stamp}`;
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

  for (const width of [1280, 390, 360]) {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 800 });

    await selectionBar.getByRole("button", { name: "转发", exact: true }).click();
    await page.locator(".forward-action-sheet").getByRole("button", { name: "合并转发", exact: true }).click();
    const forwardModal = page.locator(".forward-message-modal");
    await expect(forwardModal).toBeVisible();

    await expectFocusInside(forwardModal);
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press("Tab");
      await expectFocusInside(forwardModal);
    }
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press("Shift+Tab");
      await expectFocusInside(forwardModal);
    }

    // 触发按钮（动作面板里的"合并转发"）随弹窗关闭一并卸载，焦点应回退到安全位置而非悬空。
    await page.keyboard.press("Escape");
    await expect(forwardModal).toHaveCount(0);
    await expectFocusSafelyOutsideModals(page);
    await expect(selectionBar).toContainText("已选择 2 条");
  }
});
