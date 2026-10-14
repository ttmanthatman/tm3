import { randomUUID } from "node:crypto";
import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { E2E_ADMIN, E2E_CHANNELS } from "../seed-data.js";

async function device(browser: Browser, baseURL: string | undefined, token: string, channelId: number, delayReads?: Promise<void>) {
  const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  await context.addInitScript(({ token, channelId }) => {
    localStorage.setItem("team-chat-token", token);
    localStorage.setItem("team-chat-current-channel", String(channelId));
  }, { token, channelId });
  const page = await context.newPage();
  if (delayReads) await page.route("**/api/notifications/mentions/read", async (route) => {
    if (route.request().method() === "GET") await delayReads;
    await route.continue();
  });
  await page.goto("/");
  await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
  // Wait for session:ready so live dismissal broadcasts are observed.
  await expect(page.locator(".connection-banner")).toHaveCount(0);
  return { context, page };
}

async function accountAndChannel(page: Page) {
  const adminLogin = await page.request.post("/api/auth/login", { data: E2E_ADMIN });
  expect(adminLogin.ok()).toBeTruthy();
  const { token: adminToken } = await adminLogin.json() as { token: string };
  const adminHeaders = { Authorization: `Bearer ${adminToken}` };
  const username = `notice-${randomUUID().slice(0, 8)}`;
  const password = "NoticeRead123!";
  const created = await page.request.post("/api/admin/accounts", { headers: adminHeaders, data: { username, displayName: username, password } });
  expect(created.ok()).toBeTruthy();
  const login = await page.request.post("/api/auth/login", { data: { username, password } });
  expect(login.ok()).toBeTruthy();
  const { token } = await login.json() as { token: string };
  const headers = { Authorization: `Bearer ${token}` };
  const channels = await page.request.get("/api/channels", { headers });
  const { channels: rows } = await channels.json() as { channels: { id: number; name: string }[] };
  const channelId = rows.find((row) => row.name === E2E_CHANNELS.default)!.id;
  return { token, headers, adminHeaders, channelId, username };
}

const notices = (page: Page) => page.locator(".message-notice-bar");

test("mention, favorite and like reads sync live and remain read on a fresh device", async ({ page, browser, baseURL }) => {
  test.setTimeout(60_000);
  const setup = await accountAndChannel(page);
  const contexts: BrowserContext[] = [];
  try {
    const first = await device(browser, baseURL, setup.token, setup.channelId);
    const second = await device(browser, baseURL, setup.token, setup.channelId);
    contexts.push(first.context, second.context);
    const mention = await page.request.post("/api/messages", { headers: setup.adminHeaders, data: { channelId: setup.channelId, type: "text", content: `@${setup.username} 跨设备已读测试` } });
    expect(mention.ok()).toBeTruthy();
    const { message: mentionMessage } = await mention.json() as { message: { id: number } };
    await expect(notices(first.page)).toContainText("@了你");
    await expect(notices(second.page)).toContainText("@了你");
    await notices(first.page).getByRole("button").click();
    await expect(notices(first.page)).toHaveCount(0);
    await expect(notices(second.page)).toHaveCount(0);
    const reads = await page.request.get("/api/notifications/mentions/read", { headers: setup.headers });
    expect((await reads.json()).ids).toContain(mentionMessage.id);
    const otherReads = await page.request.get("/api/notifications/mentions/read", { headers: setup.adminHeaders });
    expect((await otherReads.json()).ids).not.toContain(mentionMessage.id);

    const own = await page.request.post("/api/messages", { headers: setup.headers, data: { channelId: setup.channelId, type: "text", content: "点赞收藏已读同步" } });
    expect(own.ok()).toBeTruthy();
    const { message } = await own.json() as { message: { id: number } };
    for (const kind of ["like", "favorite"] as const) {
      const reacted = await page.request.put(`/api/messages/${message.id}/${kind}`, { headers: setup.adminHeaders, data: kind === "like" ? { liked: true } : { favorited: true } });
      expect(reacted.ok()).toBeTruthy();
      const { notification } = await reacted.json() as { notification: { id: number } };
      const forbidden = await page.request.patch(`/api/${kind}-notifications/${notification.id}/dismiss`, { headers: setup.adminHeaders, data: {} });
      expect(forbidden.status()).toBe(404);
      await expect(notices(first.page)).toContainText(kind === "like" ? "点赞" : "收藏");
      await expect(notices(second.page)).toContainText(kind === "like" ? "点赞" : "收藏");
      await notices(first.page).getByRole("button").click();
      await expect(notices(second.page)).toHaveCount(0);
      // Repeated "liked: true" requests must not clear dismissedAt.
      const repeated = await page.request.put(`/api/messages/${message.id}/${kind}`, { headers: setup.adminHeaders, data: kind === "like" ? { liked: true } : { favorited: true } });
      expect(repeated.ok()).toBeTruthy();
    }
    let releaseReads!: () => void;
    const delayedReads = new Promise<void>((resolve) => { releaseReads = resolve; });
    const cold = await device(browser, baseURL, setup.token, setup.channelId, delayedReads);
    contexts.push(cold.context);
    await expect(cold.page.locator(`[data-message-id="${mentionMessage.id}"]`).first()).toBeAttached();
    // A slow acknowledgement snapshot must not flash an old mention first.
    await expect(notices(cold.page)).toHaveCount(0);
    releaseReads();
    await expect(notices(cold.page)).toHaveCount(0);
    await cold.page.reload();
    await expect(cold.page.getByTestId("active-channel-name")).toBeVisible();
    await expect(notices(cold.page)).toHaveCount(0);
    const snapshot = await page.request.get("/api/like-notifications", { headers: setup.headers });
    expect(await snapshot.json()).toEqual({ notifications: [], favoriteNotifications: [] });
  } finally { await Promise.all(contexts.map((context) => context.close())); }
});

test("a failed dismissal retries after reload and reaches the other device", async ({ page, browser, baseURL }) => {
  test.setTimeout(60_000);
  const setup = await accountAndChannel(page);
  const first = await device(browser, baseURL, setup.token, setup.channelId);
  const second = await device(browser, baseURL, setup.token, setup.channelId);
  try {
    const own = await page.request.post("/api/messages", { headers: setup.headers, data: { channelId: setup.channelId, type: "text", content: "断线已读重试" } });
    const { message } = await own.json() as { message: { id: number } };
    const reacted = await page.request.put(`/api/messages/${message.id}/favorite`, { headers: setup.adminHeaders, data: { favorited: true } });
    expect(reacted.ok()).toBeTruthy();
    await expect(notices(first.page)).toContainText("收藏");
    await expect(notices(second.page)).toContainText("收藏");
    await first.page.route("**/api/favorite-notifications/*/dismiss", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "模拟断线" }) }));
    await notices(first.page).getByRole("button").click();
    await expect(notices(first.page)).toHaveCount(0);
    await expect(first.page.getByRole("status")).toContainText("重试");
    await expect(notices(second.page)).toContainText("收藏");
    await first.page.unroute("**/api/favorite-notifications/*/dismiss");
    await first.page.reload();
    await expect(first.page.getByTestId("active-channel-name")).toBeVisible();
    await expect(notices(first.page)).toHaveCount(0);
    await expect(notices(second.page)).toHaveCount(0);
  } finally { await first.context.close(); await second.context.close(); }
});
