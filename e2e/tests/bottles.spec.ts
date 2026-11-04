import { expect, test, type Page, type APIRequestContext } from "@playwright/test";
import { E2E_ADMIN, E2E_CHANNELS, E2E_MEMBER } from "../seed-data.js";
import { focusChat } from "../helpers/chat.js";

async function login(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("用户名").fill(E2E_ADMIN.username);
  await page.getByPlaceholder("密码").fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
  const token = await page.evaluate(() => localStorage.getItem("team-chat-token"));
  return { Authorization: `Bearer ${token}` };
}
async function seed(request: APIRequestContext, headers: Record<string, string>, count: number) {
  const { channels } = await (await request.get("/api/channels", { headers })).json();
  const channelId = channels.find((c: { name: string }) => c.name === E2E_CHANNELS.default).id;
  const { bottles } = await (await request.get(`/api/channels/${channelId}/bottles`, { headers })).json();
  for (const bottle of bottles) await request.post(`/api/channels/${channelId}/bottles/${bottle.id}/open`, { headers });
  for (let i = 0; i < count; i++) expect((await request.post(`/api/channels/${channelId}/bottles`, { headers, data: { text: `瓶中信 ${i}` } })).ok()).toBeTruthy();
  return channelId;
}
for (const width of [1280, 360]) {
  test(`four bottles survive first reload and settle inside shore at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 850 });
    const headers = await login(page);
    const channelId = await seed(request, headers, 4);
    await page.reload();
    await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
    await expect(page.locator(".shore-bottle")).toHaveCount(4);
    await expect.poll(() => page.locator(".shore-bottle").evaluateAll((elements) => elements.every((element) => {
      const box = element.getBoundingClientRect(); const shore = element.parentElement!.getBoundingClientRect();
      return Number.isFinite(box.x) && box.bottom <= shore.bottom + 18 && box.top >= shore.top - 18 && box.left >= shore.left - 18 && box.right <= shore.right + 18;
    }))).toBe(true);
    await expect.poll(() => page.locator(".shore-bottle").evaluateAll((elements) => elements.every((element) => element.getBoundingClientRect().bottom > element.parentElement!.getBoundingClientRect().bottom - 95))).toBe(true);
    await expect.poll(() => page.locator(".shore-bottle").evaluateAll((elements) => elements.filter((element) => {
      const angle = /rotate\(([-\d.]+)rad\)/.exec((element as HTMLElement).style.transform);
      return angle && Math.abs(Math.sin(Number(angle[1]))) > .7;
    }).length)).toBeGreaterThanOrEqual(2);
    expect((await (await request.get(`/api/channels/${channelId}/bottles`, { headers })).json()).bottles).toHaveLength(4);
    await page.screenshot({ path: `output/e2e/bottles-fixed-${width}.png` });
  });
}
test("bottle scroll stays readable beside the Bible split workspace", async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  const headers = await login(page);
  await expect(page.locator(".app-shell.bible-split")).toBeVisible();
  await seed(request, headers, 1);
  await page.locator(".shore-bottle").click({ force: true });
  const dialog = page.getByRole("region", { name: "匿名瓶中信" });
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.locator(".bottle-scroll").evaluate((element) => {
    const r = element.getBoundingClientRect();
    return [r.left + 10, r.right - 10].every((x) => element.contains(document.elementFromPoint(x, r.top + r.height / 2)));
  })).toBe(true);
  await page.screenshot({ path: "output/e2e/bottles-fixed-split.png" });
});
test("throwing a bottle requests motion permission in the user gesture", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 850 });
  await page.addInitScript(() => {
    const state = { motion: 0, orientation: 0, active: true };
    Object.assign(window, { __bottlePermissionProbe: state });
    Object.defineProperty(window.DeviceMotionEvent, "requestPermission", { configurable: true, value: () => { state.motion++; state.active = navigator.userActivation.isActive; return Promise.resolve("denied"); } });
    Object.defineProperty(window.DeviceOrientationEvent, "requestPermission", { configurable: true, value: () => { state.orientation++; return Promise.resolve("denied"); } });
  });
  await login(page); await focusChat(page);
  await page.getByRole("button", { name: "更多功能", exact: true }).click();
  await page.getByRole("button", { name: "漂流瓶", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "扔一个漂流瓶" });
  await dialog.getByLabel("匿名瓶中信").fill("权限拒绝仍可自然沉积");
  await dialog.getByRole("button", { name: "扔出去", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as Window & { __bottlePermissionProbe?: { motion: number } }).__bottlePermissionProbe?.motion)).toBe(1);
  const permission = await page.evaluate(() => (window as Window & { __bottlePermissionProbe?: { orientation: number; active: boolean } }).__bottlePermissionProbe);
  expect(permission).toMatchObject({ orientation: 1, active: true });
  await expect(page.locator(".shore-controls")).toHaveCount(0);
});


test("first ready reconciles bottles created during socket initialization", async ({ page, request }) => {
  const headers = await login(page);
  const channelId = await seed(request, headers, 0);
  let ready: (() => void) | undefined;
  let released = false;
  await page.routeWebSocket(/socket\.io\//, (ws) => {
    const server = ws.connectToServer();
    server.onMessage((message) => {
      if (!released && String(message).includes('"session:ready"')) { ready = () => { released = true; ws.send(message); }; return; }
      if (!released && String(message).includes('"social:changed"')) return;
      ws.send(message);
    });
  });
  await page.route(`**/api/channels/${channelId}/bottles`, async (route) => {
    if (!released) await route.fulfill({ json: { bottles: [] } });
    else await route.continue();
  });
  const initial = page.waitForResponse((response) => response.url().endsWith(`/api/channels/${channelId}/bottles`) && response.ok());
  await page.reload(); await initial;
  await expect.poll(() => !!ready).toBe(true);
  for (let i = 0; i < 4; i++) expect((await request.post(`/api/channels/${channelId}/bottles`, { headers, data: { text: `连接期间 ${i}` } })).ok()).toBeTruthy();
  ready!();
  await expect(page.locator(".shore-bottle")).toHaveCount(4);
});

test("another reader removes the bottle while a stale list is still in flight", async ({ page, request }) => {
  const headers = await login(page);
  const channelId = await seed(request, headers, 1);
  await expect(page.locator(".shore-bottle")).toHaveCount(1);
  const { bottles } = await (await request.get(`/api/channels/${channelId}/bottles`, { headers })).json();
  let unblock!: () => void;
  const gate = new Promise<void>((resolve) => { unblock = resolve; });
  let captured = false;
  await page.route(`**/api/channels/${channelId}/bottles`, async (route) => {
    if (captured) { await route.continue(); return; }
    const response = await route.fetch(); captured = true;
    await gate; await route.fulfill({ response });
  });
  try {
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect.poll(() => captured).toBe(true);
    const created = await request.post("/api/admin/accounts", { headers, data: E2E_MEMBER });
    expect(created.ok() || created.status() === 409).toBeTruthy();
    const member = await request.post("/api/auth/login", { data: { username: E2E_MEMBER.username, password: E2E_MEMBER.password } });
    expect(member.ok()).toBeTruthy();
    const memberHeaders = { Authorization: `Bearer ${(await member.json()).token}` };
    const result = await request.post(`/api/channels/${channelId}/bottles/${bottles[0].id}/open`, { headers: memberHeaders });
    expect(result.ok()).toBeTruthy();
    await expect(page.locator(".shore-bottle")).toHaveCount(0);
  } finally { unblock(); }
  const fresh = page.waitForResponse((response) => response.url().endsWith(`/api/channels/${channelId}/bottles`) && response.ok());
  await fresh;
  await expect(page.locator(".shore-bottle")).toHaveCount(0);
});


test("granted sensors wake settled bottles and stopping them preserves natural gravity", async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.addInitScript(() => {
    for (const ctor of [window.DeviceMotionEvent, window.DeviceOrientationEvent]) Object.defineProperty(ctor, "requestPermission", { configurable: true, value: () => Promise.resolve("granted") });
  });
  const headers = await login(page); await focusChat(page);
  await seed(request, headers, 1);
  await expect(page.locator(".shore-bottle")).toHaveCount(1);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "传感器 运动与方向授权" }).click();
  await expect(page.locator(".sensor-settings")).toContainText("已启用");
  await page.getByRole("button", { name: "关闭设置" }).click();
  let previous = ""; let stable = 0;
  await expect.poll(async () => {
    const transform = await page.locator(".shore-bottle").evaluate((element) => (element as HTMLElement).style.transform);
    stable = transform === previous ? stable + 1 : 0; previous = transform; return stable;
  }, { intervals: [100], timeout: 10000 }).toBeGreaterThanOrEqual(5);
  const before = await page.locator(".shore-bottle").evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).m41);
  await page.evaluate(() => {
    window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", { gamma: 40, beta: 45 }));
    window.dispatchEvent(new DeviceMotionEvent("devicemotion", { acceleration: { x: -12, y: 8, z: 0 } }));
  });
  await expect.poll(() => page.locator(".shore-bottle").evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).m41)).toBeGreaterThan(before + 2);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "传感器 运动与方向授权" }).click();
  await page.getByRole("button", { name: "关闭摇晃感应", exact: true }).click();
  await expect(page.locator(".sensor-settings")).toContainText("已关闭");
  await page.getByRole("button", { name: "关闭设置" }).click();
  await seed(request, headers, 0);
});

for (const width of [360, 390]) {
  test(`long bottle scroll fits ${width}px and restores chat on Escape`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 700 });
    const headers = await login(page);
    const channelId = await seed(request, headers, 0);
    const text = "愿平安与你同在。\n".repeat(100);
    const response = await request.post(`/api/channels/${channelId}/bottles`, { headers, data: { text } });
    expect(response.ok()).toBeTruthy();
    const bottle = await response.json();
    await page.locator(".shore-bottle").click({ force: true });
    const letter = page.getByRole("region", { name: "匿名瓶中信" });
    await expect(letter).toBeVisible();
    await expect(letter.getByRole("img", { name: "已打开的漂流瓶" })).toHaveAttribute("data-bottle-style", String(bottle.style));
    await expect.poll(() => letter.evaluate((stage) => {
      const bounds = stage.getBoundingClientRect();
      return [".letter-close", ".letter-finish", ".bottle-letter-copy"].every((selector) => {
        const element = stage.querySelector(selector)!; const r = element.getBoundingClientRect();
        return r.left >= bounds.left && r.right <= bounds.right && r.top >= bounds.top && r.bottom <= bounds.bottom && element.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
      });
    })).toBe(true);
    expect(await letter.locator(".bottle-letter-copy").evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    await page.screenshot({ path: `output/e2e/bottle-scroll-long-${width}.png` });
    await page.keyboard.press("Escape");
    await expect(letter).toHaveCount(0);
    await expect(page.locator(".music-score-chat-cleared")).toHaveCount(0);
    await expect(page.locator(".shore-bottle")).toHaveCount(0);
  });
}

test("ordinary members can grant sensors in settings without bottles", async ({ page, request }) => {
  const headers = await login(page);
  await seed(request, headers, 0);
  const created = await request.post("/api/admin/accounts", { headers, data: E2E_MEMBER });
  expect(created.ok() || created.status() === 409).toBeTruthy();
  await page.addInitScript(() => {
    for (const ctor of [window.DeviceMotionEvent, window.DeviceOrientationEvent]) Object.defineProperty(ctor, "requestPermission", { configurable: true, value: () => Promise.resolve("granted") });
  });
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByPlaceholder("用户名").fill(E2E_MEMBER.username);
  await page.getByPlaceholder("密码").fill(E2E_MEMBER.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
  await focusChat(page);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "传感器 运动与方向授权" }).click();
  await page.getByRole("button", { name: "授权运动传感器", exact: true }).click();
  await expect(page.locator(".sensor-settings")).toContainText("已启用");
  await page.screenshot({ path: "output/e2e/bottle-sensors-member.png" });
  for (const width of [360, 390]) {
    await page.setViewportSize({ width, height: 700 });
    const disable = page.getByRole("button", { name: "关闭摇晃感应", exact: true });
    await expect(disable).toBeInViewport();
    expect(await page.locator(".sensor-settings").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: `output/e2e/bottle-sensors-member-${width}.png` });
  }
});
