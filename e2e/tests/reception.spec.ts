import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMIN, E2E_CHANNELS } from "../seed-data.js";
import { focusChat } from "../helpers/chat.js";
import type { AccountDTO } from "../../src/shared/types.js";

async function loginOwner(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("用户名").fill(E2E_ADMIN.username);
  await page.getByPlaceholder("密码").fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
  await focusChat(page);
  return { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem("team-chat-token"))}` };
}

test("会客厅表单和管理按钮在窄屏完整显示，邀请附带浏览器打开提示", async ({ page, request }) => {
  test.setTimeout(60_000);
  const headers = await loginOwner(page);
  let roomId = 0;
  try {
    await page.getByRole("button", { name: "会客厅", exact: true }).click();
    const manager = page.getByRole("dialog", { name: "会客厅管理", exact: true });
    const name = "会客厅长名称布局验收".repeat(5);
    await manager.getByLabel("名称", { exact: true }).fill(name);
    await manager.getByLabel("来访口令", { exact: true }).fill("界面验收口令");
    await expect(manager.locator('input[type="color"], input[type="checkbox"]')).toHaveCount(0);
    const created = page.waitForResponse(response => response.url().endsWith("/api/reception/rooms") && response.request().method() === "POST");
    await manager.getByRole("button", { name: "创建会客厅", exact: true }).click();
    roomId = (await (await created).json()).channel.id;
    const room = manager.locator(".room-card").filter({ hasText: name });
    await expect(room).toBeVisible();
    await expect(room.getByLabel("延长有效期")).toHaveValue("24");
    for (const width of [360, 390, 1067, 1280]) {
      await page.setViewportSize({ width, height: 702 });
      await expect.poll(() => manager.locator(".reception-panel").evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      const overflow = await manager.locator("input, select, button").evaluateAll(elements => elements.flatMap(element => {
        const panel = element.closest(".reception-panel")!.getBoundingClientRect();
        const rect = element.getBoundingClientRect();
        return rect.left >= panel.left && rect.right <= panel.right + 1 && (element.tagName === "INPUT" || element.scrollWidth <= element.clientWidth + 1) ? [] : [element.outerHTML.slice(0, 160)];
      }));
      expect(overflow).toEqual([]);
      await room.getByRole("button", { name: "复制邀请链接", exact: true }).scrollIntoViewIfNeeded();
      await expect(manager.getByRole("button", { name: "关闭", exact: true })).toBeInViewport();
      await page.screenshot({ path: `output/e2e/reception-manager-${width}.png` });
    }
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => { document.body.dataset.copiedInvitation = value; } } });
    });
    await room.getByRole("button", { name: "复制邀请链接", exact: true }).click();
    await expect(room.getByRole("button", { name: "已复制", exact: true })).toBeVisible();
    const invitation = await page.locator("body").getAttribute("data-copied-invitation");
    expect(invitation).toMatch(/^https?:\/\/[^\s]+\/visit\/[A-Za-z0-9_-]+\n\n不要在微信直接点击，请复制到浏览器打开。$/);
    await manager.press("Escape");
    await expect(manager).toHaveCount(0);
  } finally {
    if (roomId) expect((await request.delete(`/api/reception/rooms/${roomId}`, { headers })).ok()).toBe(true);
  }
});

test("同口令同昵称的两个浏览器保持独立访客身份，主人可区分发言", async ({ page, browser, request }) => {
  test.setTimeout(90_000);
  const headers = await loginOwner(page);
  const roomName = "独立访客身份验收";
  const code = "共享身份口令";
  const created = await request.post("/api/reception/rooms", { headers, data: { name: roomName, code, durationHours: 1 } });
  expect(created.ok()).toBe(true);
  const roomId = (await created.json()).channel.id as number;
  const contexts = await Promise.all([1, 2].map(() => browser.newContext({ serviceWorkers: "block" })));
  try {
    await page.getByRole("button", { name: "会客厅", exact: true }).click();
    await page.getByRole("dialog", { name: "会客厅管理" }).locator(".room-card").filter({ hasText: roomName }).locator(".room-main").click();
    await expect(page.getByTestId("active-channel-name")).toHaveText(roomName);
    const visitors = await Promise.all(contexts.map(async (context, index) => {
      const guest = await context.newPage();
      await guest.goto("/");
      await guest.getByRole("button", { name: "持来访口令进入", exact: true }).click();
      await guest.getByPlaceholder("来访口令").fill(code);
      await guest.getByPlaceholder("你的称呼").fill("同名访客");
      await guest.getByRole("button", { name: "进入会客厅", exact: true }).click();
      await expect(guest.getByTestId("active-channel-name")).toHaveText(roomName);
      await focusChat(guest);
      const auth = { Authorization: `Bearer ${await guest.evaluate(() => localStorage.getItem("team-chat-token"))}` };
      const response = await request.get("/api/auth/me", { headers: auth });
      expect(response.ok()).toBe(true);
      const account = (await response.json()).account as AccountDTO;
      expect(account.displayName).toBe(`同名访客 · 访客 #${account.id}`);
      const message = `独立访客第 ${index + 1} 条发言`;
      await guest.locator(".composer-main textarea").fill(message);
      await guest.getByRole("button", { name: "发送", exact: true }).click();
      await expect(guest.locator("[data-message-id]").filter({ hasText: message })).toHaveCount(1);
      return { guest, auth, account, message };
    }));
    expect(visitors[0].account.id).not.toBe(visitors[1].account.id);
    expect(visitors[0].account.actorId).not.toBe(visitors[1].account.actorId);
    for (const visitor of visitors) {
      const message = page.locator("[data-message-id]").filter({ hasText: visitor.message });
      await expect(message.locator(".sender-line")).toHaveText(visitor.account.displayName);
    }
    await visitors[0].guest.reload();
    await expect(visitors[0].guest.getByTestId("active-channel-name")).toHaveText(roomName);
    const refreshed = await request.get("/api/auth/me", { headers: visitors[0].auth });
    expect((await refreshed.json()).account.id).toBe(visitors[0].account.id);
    const renamed = await request.patch("/api/me/profile", { headers: visitors[0].auth, data: { displayName: `新称呼 · 访客 #${visitors[1].account.id}` } });
    expect(renamed.ok()).toBe(true);
    expect((await renamed.json()).account.displayName).toBe(`新称呼 · 访客 #${visitors[0].account.id}`);
    const members = await request.get(`/api/channels/${roomId}/members`, { headers });
    expect((await members.json()).members.map((member: { displayName: string }) => member.displayName)).toEqual(expect.arrayContaining([
      `新称呼 · 访客 #${visitors[0].account.id}`, visitors[1].account.displayName
    ]));
    const channels = await request.get("/api/channels", { headers: visitors[0].auth });
    expect((await channels.json()).channels.map((channel: { id: number }) => channel.id)).toEqual([roomId]);
  } finally {
    await Promise.all(contexts.map(context => context.close()));
    expect((await request.delete(`/api/reception/rooms/${roomId}`, { headers })).ok()).toBe(true);
  }
});
