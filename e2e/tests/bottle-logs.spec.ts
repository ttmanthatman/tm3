import { expect, test } from "@playwright/test";
import { E2E_ADMIN, E2E_MEMBER, E2E_CHANNELS } from "../seed-data.js";

for (const width of [1280, 360, 390]) {
  test(`administrator bottle log at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 850 });
    await page.goto("/");
    await page.getByPlaceholder("用户名").fill(E2E_ADMIN.username);
    await page.getByPlaceholder("密码").fill(E2E_ADMIN.password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
    const token = await page.evaluate(() => localStorage.getItem("team-chat-token"));
    const headers = { Authorization: `Bearer ${token}` };
    const member = { ...E2E_MEMBER, username: `${E2E_MEMBER.username}-bottle-${width}` };
    const account = await request.post("/api/admin/accounts", { headers, data: member });
    expect(account.ok(), await account.text()).toBeTruthy();
    const memberLogin = await request.post("/api/auth/login", { data: member });
    expect(memberLogin.ok(), await memberLogin.text()).toBeTruthy();
    const memberHeaders = { Authorization: `Bearer ${(await memberLogin.json()).token}` };
    expect((await request.get("/api/admin/bottle-logs", { headers: memberHeaders })).status()).toBe(403);
    expect((await request.get("/api/admin/bottle-logs")).status()).toBe(401);
    const { channels } = await (await request.get("/api/channels", { headers })).json();
    const channelId = channels.find((channel: { name: string }) => channel.name === E2E_CHANNELS.default).id;
    const text = `漂流记录 ${width} <script>window.bottleLeak=true</script>\n${"长内容".repeat(450)}`;
    const created = await request.post(`/api/channels/${channelId}/bottles`, { headers, data: { text } });
    expect(created.ok()).toBeTruthy();
    const { id } = await created.json();
    const listing = await request.get(`/api/channels/${channelId}/bottles`, { headers: memberHeaders });
    expect((await listing.json()).bottles.find((bottle: { id: string }) => bottle.id === id)).toEqual({ id, style: (await created.json()).style });
    await page.goto("/log");
    await page.getByRole("button", { name: "漂流瓶", exact: true }).click();
    const row = page.locator(".bottle-log-row").filter({ hasText: id });
    await expect(row).toContainText(E2E_ADMIN.displayName);
    await expect(row).toContainText("待拾取");
    const opened = await request.post(`/api/channels/${channelId}/bottles/${id}/open`, { headers: memberHeaders });
    expect(opened.ok()).toBeTruthy();
    expect(await opened.json()).toEqual({ id, style: (await created.json()).style, text });
    expect((await request.post(`/api/channels/${channelId}/bottles/${id}/open`, { headers })).status()).toBe(410);
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await expect(row).toContainText(E2E_MEMBER.displayName);
    await expect(row).toContainText("已捡起");
    await expect(row.locator(".bottle-log-text")).toHaveText(text);
    expect((await page.getByRole("button", { name: "回到聊天", exact: true }).boundingBox())!.height).toBeLessThan(50);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    expect(await row.locator("script").count()).toBe(0);
    await page.screenshot({ path: `output/e2e/bottle-log-${width}.png` });
  });
}
