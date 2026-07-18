import { expect, test, type Page } from "@playwright/test";
import { isApprovedRemoteRequest, remoteE2EEnvironment } from "./safety.js";

const remote = remoteE2EEnvironment();

interface BrowserSignals {
  consoleErrors: number;
  pageErrors: number;
  requestFailures: number;
  serverErrors: number;
  staticResourceFailures: number;
}

async function monitorRemoteBrowser(page: Page): Promise<BrowserSignals> {
  const signals: BrowserSignals = { consoleErrors: 0, pageErrors: 0, requestFailures: 0, serverErrors: 0, staticResourceFailures: 0 };
  await page.route("**/*", async (route) => {
    if (isApprovedRemoteRequest(route.request().url())) return route.continue();
    return route.abort("blockedbyclient");
  });
  page.on("console", (message) => { if (message.type() === "error") signals.consoleErrors += 1; });
  page.on("pageerror", () => { signals.pageErrors += 1; });
  page.on("requestfailed", (request) => { if (isApprovedRemoteRequest(request.url())) signals.requestFailures += 1; });
  page.on("response", (response) => {
    if (!isApprovedRemoteRequest(response.url())) return;
    if (response.status() >= 500) signals.serverErrors += 1;
    if (["script", "stylesheet", "font", "image"].includes(response.request().resourceType()) && response.status() >= 400) signals.staticResourceFailures += 1;
  });
  return signals;
}

async function loginToTestChannel(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("用户名").fill(remote.username);
  await page.getByPlaceholder("密码").fill(remote.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  const testChannel = page.getByRole("button", { name: remote.channel, exact: true });
  await expect(testChannel).toBeVisible();
  await testChannel.click();
  await expect(page.getByTestId("active-channel-name")).toHaveText(remote.channel);
}

async function expectHealthyBrowser(page: Page, signals: BrowserSignals) {
  await expect(page.getByRole("status", { name: /连接/ })).toHaveCount(0);
  await expect.poll(() => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return Boolean(registration?.active || navigator.serviceWorker.controller);
  })).toBe(true);
  expect(signals.consoleErrors).toBe(0);
  expect(signals.pageErrors).toBe(0);
  expect(signals.requestFailures).toBe(0);
  expect(signals.serverErrors).toBe(0);
  expect(signals.staticResourceFailures).toBe(0);
}

test("专用账号的关键远程浏览器冒烟流程", async ({ page }) => {
  const signals = await monitorRemoteBrowser(page);
  await test.step("登录、进入专用频道并确认 Socket、静态资源和 Service Worker", async () => {
    await loginToTestChannel(page);
    await expect(page.getByRole("button", { name: "退出", exact: true })).toBeVisible();
    await expectHealthyBrowser(page, signals);
  });
  await test.step("发送唯一前缀消息并确认刷新后存在", async () => {
    const message = `[REMOTE-E2E-${Date.now()}] remote browser smoke`;
    await page.getByPlaceholder("输入消息").fill(message);
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.getByPlaceholder("输入消息")).toHaveValue("");
    await page.reload();
    await expect(page.getByTestId("active-channel-name")).toHaveText(remote.channel);
    await expect(page.locator("[data-message-id]").filter({ hasText: message })).toHaveCount(1);
  });
  await test.step("390px 视口通过频道列表进入专用频道", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "频道", exact: true }).click();
    await page.getByRole("button", { name: remote.channel, exact: true }).click();
    await expect(page.getByTestId("active-channel-name")).toHaveText(remote.channel);
    await expect(page.getByPlaceholder("输入消息")).toBeEnabled();
    await expect(page.getByRole("button", { name: "发送", exact: true })).toBeEnabled();
  });
  await test.step("圣经阅读区跳转到指定书卷章节和经节", async () => {
    await page.getByRole("button", { name: "打开圣经" }).click();
    await page.getByRole("button", { name: /^创世记/ }).click();
    await page.getByRole("button", { name: "1", exact: true }).click();
    await page.getByLabel("选择圣经书卷").selectOption("JHN");
    await page.getByLabel("选择章节").selectOption("3");
    await page.getByLabel("选择经节").selectOption("16");
    await expect(page.locator('[data-verse-key="JHN-3-16"]')).toBeVisible();
  });
  await expectHealthyBrowser(page, signals);
});
