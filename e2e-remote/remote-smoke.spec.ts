import { expect, test, type Page } from "@playwright/test";
import { waitForChatSocket } from "./chat-state.js";
import { isApprovedRemoteRequest, remoteE2EEnvironment } from "./safety.js";

const remote = remoteE2EEnvironment();

// The dedicated channel is private, so its sidebar button is announced as
// 「私密频道 远程冒烟测试」; match by suffix so the privacy prefix cannot break
// the locator while still refusing longer look-alike names.
function dedicatedChannelButton(page: Page) {
  return page.getByRole("button", { name: new RegExp(`${remote.channel}$`) });
}

// Current builds auto-open the desktop Bible split on every session restore
// (useBibleDisplayLayout account watch), and it goes fullscreen below 760px.
// Close it whenever chat chrome must be reachable.
async function closeBibleIfOpen(page: Page) {
  const closeBible = page.getByRole("button", { name: "关闭圣经" });
  if (await closeBible.isVisible()) await closeBible.click();
}

// On mobile the shared channel pane slides in via its `open` class; a closed
// pane still exposes its rows off-viewport, so decide on the pane state itself.
async function openMobileChannelListAndSelect(page: Page) {
  await closeBibleIfOpen(page);
  const paneOpen = page.locator("aside.channel-pane.open");
  if (!(await paneOpen.count())) {
    await page.getByRole("button", { name: "频道", exact: true }).click();
    await expect(paneOpen).toBeVisible();
  }
  await dedicatedChannelButton(page).click();
}

interface BrowserSignals {
  consoleErrors: number;
  pageErrors: number;
  requestFailures: number;
  cancelledRequests: number;
  serverErrors: number;
  staticResourceFailures: number;
  failedRequestUrls: string[];
  consoleErrorTexts: string[];
}

async function monitorRemoteBrowser(page: Page): Promise<BrowserSignals> {
  const signals: BrowserSignals = {
    consoleErrors: 0,
    pageErrors: 0,
    requestFailures: 0,
    cancelledRequests: 0,
    serverErrors: 0,
    staticResourceFailures: 0,
    failedRequestUrls: [],
    consoleErrorTexts: []
  };
  await page.route("**/*", async (route) => {
    if (isApprovedRemoteRequest(route.request().url())) return route.continue();
    return route.abort("blockedbyclient");
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    // Aborted preloads make the browser log "Failed to load resource" lines;
    // they mirror client-side cancellations already counted separately.
    if (message.text().includes("net::ERR_ABORTED")) { signals.cancelledRequests += 1; return; }
    signals.consoleErrors += 1;
    signals.consoleErrorTexts.push(message.text());
  });
  page.on("pageerror", () => { signals.pageErrors += 1; });
  page.on("requestfailed", (request) => {
    if (!isApprovedRemoteRequest(request.url())) return;
    const errorText = request.failure()?.errorText;
    const pathname = new URL(request.url()).pathname;
    // ERR_ABORTED is a client-side cancellation — on slower approved sites the
    // idle preload is still warming assets when a later reload aborts it; real
    // server or transport problems surface as 5xx/4xx responses or other errors.
    const cancelledByBrowser = errorText === "net::ERR_ABORTED"
      || (errorText === "net::ERR_FAILED" && request.resourceType() === "media" && /^\/api\/music\/tracks\/\d+\/stream$/.test(pathname));
    if (cancelledByBrowser) signals.cancelledRequests += 1;
    else {
      signals.requestFailures += 1;
      signals.failedRequestUrls.push(`${request.url()} :: ${errorText}`);
    }
  });
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
  // Some approved sites enable the desktop Bible auto-split at login (it opens
  // with the shell and hides the channel sidebar); whichever surface appears
  // first, end in plain chat before looking for the dedicated channel.
  const closeBible = page.getByRole("button", { name: "关闭圣经" });
  const testChannel = dedicatedChannelButton(page);
  await expect(closeBible.or(testChannel)).toBeVisible();
  await closeBibleIfOpen(page);
  // Some approved sites pin a notice in the default channel and its viewer
  // auto-expands over the sidebar; acknowledge it once so the channel list is
  // clickable (the dismissal persists for the dedicated account).
  const pinnedAck = page.getByRole("dialog", { name: "置顶消息" }).getByRole("button", { name: "朕知道了" });
  if (await pinnedAck.isVisible()) await pinnedAck.click();
  // Some approved sites default to a collapsed desktop channel sidebar; expand
  // it when present so the dedicated channel row is clickable.
  const expandChannels = page.getByRole("button", { name: "展开频道" });
  if (await expandChannels.isVisible()) await expandChannels.click();
  await expect(testChannel).toBeVisible();
  await testChannel.click();
  await expect(page.getByTestId("active-channel-name")).toHaveText(remote.channel);
  await waitForChatSocket(page);
}

async function expectHealthyBrowser(page: Page, signals: BrowserSignals) {
  await waitForChatSocket(page);
  await expect.poll(() => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return Boolean(registration?.active || navigator.serviceWorker.controller);
  })).toBe(true);
  console.log(`REMOTE_E2E_BROWSER_SIGNALS ${JSON.stringify(signals)}`);
  expect(signals.consoleErrors).toBe(0);
  expect(signals.pageErrors).toBe(0);
  expect(signals.requestFailures).toBe(0);
  expect(signals.serverErrors).toBe(0);
  expect(signals.staticResourceFailures).toBe(0);
}

test("专用账号的关键远程浏览器冒烟流程", async ({ page }) => {
  // The flow now spans three full page loads (initial, persistence reload, and
  // fresh mobile loads at 360/390) over a wide-area link; 45s is not enough.
  test.setTimeout(150_000);
  const signals = await monitorRemoteBrowser(page);
  await test.step("登录、进入专用频道并确认 Socket、静态资源和 Service Worker", async () => {
    await loginToTestChannel(page);
    await expect(page.getByRole("button", { name: "退出", exact: true })).toBeVisible();
    await expectHealthyBrowser(page, signals);
  });
  await test.step("发送唯一前缀消息并确认刷新后存在", async () => {
    const message = `[REMOTE-E2E-${Date.now()}] remote browser smoke`;
    await page.locator(".composer-main textarea").fill(message);
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.locator(".composer-main textarea")).toHaveValue("");
    await expect(page.locator(".message-row[data-message-id]").filter({ hasText: message })).toHaveCount(1);
    await page.reload();
    await expect(page.getByTestId("active-channel-name")).toHaveText(remote.channel);
    await waitForChatSocket(page);
    await expect(page.locator("[data-message-id]").filter({ hasText: message })).toHaveCount(1);
    // Session restore re-opens the desktop Bible split; close it before the
    // mobile viewport steps where it would go fullscreen over the chat.
    await closeBibleIfOpen(page);
  });
  await test.step("360px 视口通过频道列表进入专用频道", async () => {
    // Load fresh at mobile width instead of resizing the desktop session: the
    // restore path keeps mobile clean (no Bible split below 760px) and avoids
    // mid-session layout transitions.
    await page.setViewportSize({ width: 360, height: 780 });
    await page.reload();
    await waitForChatSocket(page);
    await openMobileChannelListAndSelect(page);
    await expect(page.getByTestId("active-channel-name")).toHaveText(remote.channel);
    const mobileInput = page.locator(".composer-main textarea");
    const draft = `[REMOTE-E2E-MOBILE-360-${Date.now()}]`;
    await expect(mobileInput).toBeEnabled();
    await mobileInput.fill(draft);
    await expect(mobileInput).toHaveValue(draft);
    await expect(page.getByRole("button", { name: "发送", exact: true })).toBeEnabled();
    await mobileInput.fill("");
  });
  await test.step("390px 视口通过频道列表进入专用频道", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await waitForChatSocket(page);
    await openMobileChannelListAndSelect(page);
    await expect(page.getByTestId("active-channel-name")).toHaveText(remote.channel);
    const mobileInput = page.locator(".composer-main textarea");
    const mobileDraft = `[REMOTE-E2E-MOBILE-DRAFT-${Date.now()}]`;
    await expect(mobileInput).toBeEnabled();
    await mobileInput.fill(mobileDraft);
    await expect(mobileInput).toHaveValue(mobileDraft);
    await expect(page.getByRole("button", { name: "发送", exact: true })).toBeEnabled();
    await mobileInput.fill("");
  });
  await test.step("圣经阅读区跳转到指定书卷章节和经节", async () => {
    await page.getByRole("button", { name: "打开圣经" }).click();
    // A fresh account lands on the book catalog; an account with reading state
    // opens the reader pane directly. Both must reach the jump selects.
    const catalogBook = page.getByRole("button", { name: /^创世记/ }).first();
    const expandNav = page.getByRole("button", { name: /^展开.+窗格导航$/ }).first();
    await expect(catalogBook.or(expandNav)).toBeVisible();
    if (await catalogBook.count()) {
      await catalogBook.click();
      await page.getByRole("button", { name: "1", exact: true }).first().click();
    }
    if (await expandNav.count()) await expandNav.click();
    await page.getByLabel("选择圣经书卷").selectOption("JHN");
    await page.getByLabel("选择章节").selectOption("3");
    await page.getByLabel("选择经节").selectOption("16");
    await expect(page.locator('[data-verse-key="JHN-3-16"]')).toBeVisible();
  });
  await expectHealthyBrowser(page, signals);
});
