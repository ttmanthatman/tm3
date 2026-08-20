import { expect, test, type Page } from "@playwright/test";
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

async function loginAsAdmin(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("用户名").fill(E2E_ADMIN.username);
  await page.getByPlaceholder("密码").fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
  await waitForChatSocket(page);
}

async function readChatSocket(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector("#app") as HTMLElement & { __vue_app__?: { _context?: { provides?: Record<PropertyKey, unknown> } } };
    const provides = root?.__vue_app__?._context?.provides;
    const pinia = Reflect.ownKeys(provides || {}).map((key) => provides?.[key]).find((value) => value && typeof value === "object" && "_s" in value) as
      | { _s?: Map<string, Record<string, unknown>> }
      | undefined;
    const store = [...(pinia?._s?.values() || [])].find((candidate) => "connectionState" in candidate && "socket" in candidate);
    const socket = store?.socket as { connected?: boolean } | undefined;
    return { socketFound: Boolean(socket), connected: socket?.connected === true };
  });
}

async function waitForChatSocket(page: Page, connected = true) {
  await expect.poll(() => readChatSocket(page).then((state) => state.connected)).toBe(connected);
}

async function setChatSocketConnection(page: Page, connected: boolean) {
  await page.evaluate((shouldConnect) => {
    const root = document.querySelector("#app") as HTMLElement & { __vue_app__?: { _context?: { provides?: Record<PropertyKey, unknown> } } };
    const provides = root?.__vue_app__?._context?.provides;
    const pinia = Reflect.ownKeys(provides || {}).map((key) => provides?.[key]).find((value) => value && typeof value === "object" && "_s" in value) as
      | { _s?: Map<string, Record<string, unknown>> }
      | undefined;
    const store = [...(pinia?._s?.values() || [])].find((candidate) => "connectionState" in candidate && "socket" in candidate);
    const socket = store?.socket as { connect: () => unknown; disconnect: () => unknown } | undefined;
    if (!socket) throw new Error("chat socket was not found");
    if (shouldConnect) socket.connect();
    else socket.disconnect();
  }, connected);
  await waitForChatSocket(page, connected);
}

async function openAccountsAdmin(page: Page) {
  await page.getByRole("button", { name: "管理", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "管理面板" })).toBeVisible();
  await page.getByRole("button", { name: /用户与权限/ }).click();
  await expect(page.getByText("新增用户", { exact: true })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await blockPublicNetwork(page);
});

test("管理员登录并进入默认频道", async ({ page }) => {
  await loginAsAdmin(page);
  await expect(page.getByRole("button", { name: "退出", exact: true })).toBeVisible();
});

test("创建会客厅后，来访者只进入该房间", async ({ page }) => {
  test.setTimeout(60_000);
  const roomName = "浏览器验收会客厅";
  const code = "平安测试";
  const message = "来访者的会客厅消息";
  await loginAsAdmin(page);

  await page.getByRole("button", { name: "会客厅", exact: true }).click();
  const manager = page.getByRole("dialog", { name: "会客厅管理" });
  await expect(manager).toBeVisible();
  await manager.getByLabel("名称").fill(roomName);
  await manager.getByLabel("来访口令").fill(code);
  await manager.getByLabel("有效期").selectOption("1");
  await manager.getByRole("button", { name: "创建会客厅", exact: true }).click();
  await expect(manager.getByText(roomName, { exact: true })).toBeVisible();
  await manager.getByRole("button", { name: "关闭", exact: true }).click();

  await page.getByRole("button", { name: "退出", exact: true }).click();
  await page.getByRole("button", { name: "持来访口令进入", exact: true }).click();
  await page.getByPlaceholder("来访口令").fill(code);
  await page.getByPlaceholder("你的称呼").fill("浏览器来访者");
  await page.getByRole("button", { name: "进入会客厅", exact: true }).click();

  await expect(page.getByTestId("active-channel-name")).toHaveText(roomName);
  await expect(page.locator(".channel-list").getByText(roomName, { exact: true })).toBeVisible();
  await expect(page.locator(".channel-list").getByText(E2E_CHANNELS.default, { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "打开圣经" })).toBeVisible();
  await page.locator(".composer-main textarea").fill(message);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator("[data-message-id]").filter({ hasText: message })).toHaveCount(1);

  await page.getByRole("button", { name: "退出", exact: true }).click();
  await page.getByRole("button", { name: "正式成员登录", exact: true }).click();
  await page.getByPlaceholder("用户名").fill(E2E_ADMIN.username);
  await page.getByPlaceholder("密码").fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByTestId("active-channel-name")).toHaveText(roomName);
  await page.getByRole("button", { name: "会客厅", exact: true }).click();
  const roomCard = page.locator(".room-card").filter({ hasText: roomName });
  page.once("dialog", (dialog) => dialog.accept());
  await roomCard.getByRole("button", { name: "回收", exact: true }).click();
  await expect(roomCard).toHaveCount(0);
});

test("文字消息刷新后仍然存在", async ({ page }) => {
  const message = "浏览器冒烟消息：刷新后仍然存在";
  await loginAsAdmin(page);

  await page.locator(".composer-main textarea").fill(message);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator("[data-message-id]").filter({ hasText: message })).toHaveCount(1);

  await page.reload();
  await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
  await expect(page.locator("[data-message-id]").filter({ hasText: message })).toHaveCount(1);
});

test("390px 手机端断线期间保留草稿并在重连后发送一次", async ({ page }) => {
  const message = "浏览器断线恢复消息：草稿不会丢失";
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsAdmin(page);

  const input = page.locator(".composer-main textarea");
  const send = page.getByRole("button", { name: "发送", exact: true });
  await input.fill(message);
  await setChatSocketConnection(page, false);

  await expect(send).toBeDisabled();
  await expect(page.getByText("连接恢复后再发送", { exact: true })).toBeVisible();
  await send.evaluate((button: HTMLButtonElement) => button.click());
  await input.press("Enter");
  await expect(input).toHaveValue(message);
  await input.press("Shift+Enter");
  await expect(input).toHaveValue(`${message}\n`);
  await input.press("Backspace");
  await expect(input).toHaveValue(message);

  await setChatSocketConnection(page, true);
  await expect(input).toHaveValue(message);
  await expect(send).toBeEnabled();
  await send.click();
  await expect(input).toHaveValue("");
  await expect(page.locator("[data-message-id]").filter({ hasText: message })).toHaveCount(1);
});

test("390px 手机视口打开频道列表并切换频道", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAsAdmin(page);

  await page.getByRole("button", { name: "频道", exact: true }).click();
  await page.getByRole("button", { name: E2E_CHANNELS.secondary, exact: true }).click();

  await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.secondary);
});

test("圣经阅读区跳转到指定书卷章节和经节", async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole("button", { name: "打开圣经" }).click();
  await page.getByRole("button", { name: /^创世记/ }).click();
  await page.getByRole("button", { name: "1", exact: true }).click();

  await page.getByLabel("选择圣经书卷").selectOption("JHN");
  await page.getByLabel("选择章节").selectOption("3");
  await page.getByLabel("选择经节").selectOption("16");

  const targetVerse = page.locator('[data-verse-key="JHN-3-16"]');
  await expect(targetVerse).toBeVisible();
  await expect(targetVerse).toHaveClass(/target/);
});

test("管理员账号显示且当前管理员不可删除", async ({ page }) => {
  await loginAsAdmin(page);
  await openAccountsAdmin(page);

  await expect(page.locator(".admin-account-list-pane")).toBeVisible();
  await expect(page.locator(".admin-account-detail-pane")).toBeVisible();
  const currentAdmin = page.getByTestId("admin-account-row").filter({ hasText: `@${E2E_ADMIN.username}` });
  await expect(currentAdmin).toBeVisible();
  await currentAdmin.click();
  await expect(page.getByRole("button", { name: "删除用户", exact: true })).toBeDisabled();
  await expect(page.getByText("不能删除当前登录账号", { exact: true })).toBeVisible();
});

test("管理员创建用户、修改资料并在刷新后确认持久化", async ({ page }) => {
  await loginAsAdmin(page);
  await openAccountsAdmin(page);

  await page.getByRole("button", { name: "新增用户", exact: true }).click();
  await page.getByPlaceholder("例如 xiaoma").fill(E2E_MEMBER.username);
  await page.getByPlaceholder("用户看到的昵称").fill(E2E_MEMBER.displayName);
  await page.getByPlaceholder("输入初始密码").fill(E2E_MEMBER.password);
  await page.getByRole("button", { name: "创建用户", exact: true }).click();

  const member = page.getByTestId("admin-account-row").filter({ hasText: `@${E2E_MEMBER.username}` });
  await expect(member).toBeVisible();
  await expect(member).toHaveAttribute("aria-current", "true");
  await expect(page.getByText("用户已创建", { exact: true })).toBeVisible();

  const updatedDisplayName = `${E2E_MEMBER.displayName}已更新`;
  await page.getByPlaceholder("昵称").fill(updatedDisplayName);
  await page.getByLabel("频道置顶管理").check();
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(page.getByText("用户资料已更新", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
  await openAccountsAdmin(page);
  const persistedMember = page.getByTestId("admin-account-row").filter({ hasText: `@${E2E_MEMBER.username}` });
  await expect(persistedMember).toContainText(updatedDisplayName);
  await persistedMember.click();
  await expect(page.getByPlaceholder("昵称")).toHaveValue(updatedDisplayName);
  await expect(page.getByLabel("频道置顶管理")).toBeChecked();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "删除用户", exact: true }).click();

  await expect(persistedMember).toHaveCount(0);
  await expect(page.getByText(`用户“${updatedDisplayName}”已删除`, { exact: true })).toBeVisible();
});

test("360px 和 390px 用户管理使用列表到详情的单栏流程", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await loginAsAdmin(page);
  let createRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/admin/accounts")) {
      createRequests += 1;
    }
  });
  await openAccountsAdmin(page);

  const currentAdmin = page.getByTestId("admin-account-row").filter({ hasText: `@${E2E_ADMIN.username}` });
  await expect(currentAdmin).toBeVisible();
  await expect(page.locator(".admin-account-detail-pane")).toBeHidden();
  await currentAdmin.click();
  await expect(page.getByRole("button", { name: "返回用户列表", exact: true })).toBeVisible();
  await expect(page.locator(".admin-account-list-pane")).toBeHidden();
  await page.getByRole("button", { name: "返回用户列表", exact: true }).click();

  await page.getByRole("button", { name: "新增用户", exact: true }).click();
  await page.getByRole("button", { name: "创建用户", exact: true }).click();
  await expect(page.getByText("用户名不能为空", { exact: true })).toBeVisible();
  await expect(page.getByText("显示名不能为空", { exact: true })).toBeVisible();
  await expect(page.getByText("密码长度必须为 10–128 位", { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("例如 xiaoma")).toBeFocused();
  expect(createRequests).toBe(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth
  }))).toEqual({ viewport: 390, documentWidth: 390 });
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.locator(".admin-account-list-pane")).toBeVisible();
});
