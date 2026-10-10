import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { E2E_ADMIN, E2E_CHANNELS } from "../seed-data.js";

test.use({ serviceWorkers: "block" });

async function login(page: Page) {
  await page.route("**/*", (route) => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.goto("/");
  await page.getByPlaceholder("用户名").fill(E2E_ADMIN.username);
  await page.getByPlaceholder("密码").fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
  const bible = page.locator(".bible-header-trigger");
  if (await bible.getAttribute("aria-pressed") === "true") await bible.click();
  return { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem("team-chat-token"))}` };
}

test("消息菜单按实际高度留在视口内，缩小视口后所有操作仍可滚动到达", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const headers = await login(page);
  const text = `菜单边界 ${randomUUID()}`;
  await page.locator(".composer textarea").fill(`${text}\n${"屏幕底部菜单检查\n".repeat(35)}`);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const bubble = page.locator(".message-row.mine .bubble").filter({ hasText: text });
  await expect(bubble).toBeVisible();
  await bubble.scrollIntoViewIfNeeded();
  const box = (await bubble.boundingBox())!;
  const scroller = (await page.locator(".messages-scroll").boundingBox())!;
  // Anchor the long press to the visible bottom of this oversized message.
  const pointer = { button: 0, pointerType: "touch", clientX: box.x + box.width / 2, clientY: Math.min(box.y + box.height - 12, scroller.y + scroller.height - 12) };
  await bubble.dispatchEvent("pointerdown", pointer);
  const menu = page.locator("[data-message-actions-popover]");
  await expect(menu).toBeVisible();
  await bubble.dispatchEvent("pointerup", pointer);
  for (const { width, height } of [{ width: 390, height: 844 }, { width: 360, height: 844 }, { width: 839, height: 1151 }, { width: 1280, height: 844 }, { width: 390, height: 240 }]) {
    await page.setViewportSize({ width, height });
    await expect.poll(async () => {
      const bounds = (await menu.boundingBox())!;
      return bounds.x >= 11 && bounds.y >= 11 && bounds.x + bounds.width <= width - 11 && bounds.y + bounds.height <= height - 11;
    }).toBe(true);
    if (width === 839) await page.screenshot({ path: "output/playwright/message-menu.png" });
    const selectText = menu.getByRole("button", { name: "选择文字", exact: true });
    await selectText.scrollIntoViewIfNeeded();
    const last = (await selectText.boundingBox())!;
    expect(last.y + last.height).toBeLessThanOrEqual(height - 11);
  }
  await menu.getByRole("button", { name: "选择文字", exact: true }).click();
  await expect(menu).toBeHidden();
  await expect(bubble).toHaveClass(/text-selectable/);
  const messageId = await bubble.evaluate((element) => element.closest("[data-message-id]")!.getAttribute("data-message-id"));
  expect((await request.post(`/api/messages/${messageId}/recall`, { headers })).ok()).toBeTruthy();
});

test("笔记消息气泡紧贴卡片，在手机和宽屏保持两侧等宽留白", async ({ page, request }) => {
  await page.setViewportSize({ width: 597, height: 1151 });
  const headers = await login(page);
  const channels = (await (await request.get("/api/channels", { headers })).json()).channels as Array<{ id: number; name: string }>;
  const channelId = channels.find((channel) => channel.name === E2E_CHANNELS.default)!.id;
  const id = randomUUID();
  const text = "鸵鸟那么笨都能在旷野生存，号称有智慧的人却不能，可见没有智慧的鸵鸟比有智慧的人还厉害。";
  expect((await request.post("/api/bible/notes", { headers, data: { id, translation: "cmn-cu89s", bookCode: "JOB", chapter: 39, verse: 17, text, public: true } })).ok()).toBeTruthy();
  try {
    expect((await request.post(`/api/bible/notes/${id}/share`, { headers, data: { channelId, clientRequestId: randomUUID() } })).ok()).toBeTruthy();
    const card = page.locator(`.message-row [data-note-id="${id}"]`);
    await expect(card).toContainText(text);
    for (const width of [597, 360, 390, 839, 1280]) {
      await page.setViewportSize({ width, height: 1151 });
      await card.scrollIntoViewIfNeeded();
      await expect.poll(() => card.evaluate((element) => {
        const card = element.getBoundingClientRect();
        const bubble = element.closest(".bubble")!.getBoundingClientRect();
        return Math.abs((card.left - bubble.left) - (bubble.right - card.right));
      })).toBeLessThanOrEqual(1);
      expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      if (width === 597) await page.screenshot({ path: "output/playwright/bible-note-bubble.png" });
    }
  } finally {
    await request.delete(`/api/bible/notes/${id}`, { headers });
  }
});
