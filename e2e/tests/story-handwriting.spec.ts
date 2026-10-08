import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "node:fs/promises";
import type { StoryCommentDTO, StoryDTO } from "../../src/shared/stories.js";
import { E2E_ADMIN } from "../seed-data.js";
test.use({ serviceWorkers: "block" });

async function drawCharacter(page: Page, dialog: Locator) {
  const canvas = dialog.getByLabel("当前手写字格");
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * .2, box.y + box.height * .25);
  await page.mouse.down();
  for (let i = 1; i <= 24; i++) {
    await page.mouse.move(box.x + box.width * (.2 + i * .025), box.y + box.height * (.25 + i * .015));
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
  await dialog.getByRole("button", { name: "完成此字", exact: true }).click();
}

async function signature(ink: Locator) {
  return ink.evaluate((element) => [...element.querySelectorAll<HTMLCanvasElement>("canvas")].map((canvas) => canvas.toDataURL()).join("|"));
}

async function hasInk(ink: Locator) {
  return ink.evaluate((element) => [...element.querySelectorAll<HTMLCanvasElement>("canvas")].some((canvas) => {
    const pixels = canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data;
    return pixels?.some((value, index) => index % 4 === 3 && value > 0) || false;
  }));
}

test("故事手写回复保留草稿、持久化、回复对象与播放手势，并兼容文字评论", async ({ page, request }) => {
  test.setTimeout(120_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/*", (route) => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.setViewportSize({ width: 1280, height: 844 });
  await page.goto("/");
  await page.getByPlaceholder("用户名").fill(E2E_ADMIN.username);
  await page.getByPlaceholder("密码").fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByTestId("active-channel-name")).toBeVisible();
  const token = await page.evaluate(() => localStorage.getItem("team-chat-token"));
  const headers = { Authorization: `Bearer ${token}` };
  const title = `手写回复验收 ${crypto.randomUUID()}`;
  const created = await request.post("/api/stories", {
    headers,
    multipart: {
      requestId: crypto.randomUUID(), text: title,
      image: { name: "story-handwriting.png", mimeType: "image/png", buffer: await fs.readFile("public/images/stories/story-banner.png") }
    }
  });
  expect(created.ok()).toBe(true);
  const { story }: { story: StoryDTO } = await created.json();
  try {
    await page.locator(".story-header-trigger").click();
    await expect(page.getByRole("dialog", { name: "我们的故事" })).toBeVisible();
    const moment = page.locator(".story-moment").filter({ hasText: title });
    await expect(moment).toBeVisible();
    const textComment = "平安与喜乐。".repeat(30);
    await moment.getByLabel("评论内容", { exact: true }).fill(textComment);
    await moment.getByRole("button", { name: "发表评论", exact: true }).click();
    await expect(moment.locator(".story-comment-content p")).toHaveText(textComment);
    await moment.getByRole("button", { name: `回复 ${E2E_ADMIN.displayName} 的评论`, exact: true }).click();
    await moment.getByRole("button", { name: "手写回复", exact: true }).click();
    const writer = page.getByRole("dialog", { name: "逐字手写", exact: true });
    await expect(writer).toBeVisible();
    await expect(writer.locator(".handwriting-composer-footer")).toContainText(`将引用：${E2E_ADMIN.displayName}`);
    await writer.getByRole("button", { name: "硬笔", exact: true }).click();
    for (const width of [360, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await expect.poll(async () => {
        const box = await writer.locator(".handwriting-composer-modal").boundingBox();
        return !!box && box.x >= 0 && box.x + box.width <= width + 1 && box.y >= 0 && box.y + box.height <= 845;
      }).toBe(true);
      const send = await writer.getByRole("button", { name: "发送", exact: true }).boundingBox();
      expect(send!.y + send!.height).toBeLessThanOrEqual(844);
      expect(await writer.locator(".handwriting-composer-modal").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    }
    for (let i = 0; i < 7; i++) await drawCharacter(page, writer);
    await expect(writer.locator(".handwriting-preview-cell")).toHaveCount(7);
    let failNext = true;
    await page.route(`**/api/stories/${story.id}/comments`, async (route) => {
      if (route.request().method() === "POST" && failNext) {
        failNext = false;
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "模拟发送失败，请重试" }) });
      }
      else await route.continue();
    });
    await writer.getByRole("button", { name: "发送", exact: true }).click();
    await expect(writer.locator(".handwriting-status")).toContainText(/失败|fetch|network/i);
    await expect(writer.locator(".handwriting-preview-cell")).toHaveCount(7);
    await writer.getByRole("button", { name: "关闭", exact: true }).click();
    await moment.getByRole("button", { name: "手写回复", exact: true }).click();
    await expect(writer.locator(".handwriting-preview-cell")).toHaveCount(7);
    await writer.getByRole("button", { name: "发送", exact: true }).click();
    await expect(writer).toBeHidden();
    await expect(moment.locator(".story-comment-replying")).toBeHidden();
    const me = (await (await request.get("/api/auth/me", { headers })).json()).account as { actorId: number };
    const comments = async (): Promise<StoryCommentDTO[]> => {
      const result: { stories: StoryDTO[] } = await (await request.get(`/api/stories?actorId=${me.actorId}`, { headers })).json();
      return result.stories.find((row) => row.id === story.id)!.interactions.comments;
    };
    const saved = await comments();
    const typed = saved.find((row) => row.text === textComment)!;
    const handwritten = saved.find((row) => row.handwriting)!;
    expect(handwritten.handwriting!.characters).toHaveLength(7);
    expect(handwritten.replyTo?.id).toBe(typed.id);
    expect(saved).toHaveLength(2);
    await expect(moment.locator(".story-comment-reply-prefix")).toContainText(`回复 ${E2E_ADMIN.displayName}`);
    const ink = moment.locator(".handwriting-message.interactive");
    await ink.scrollIntoViewIfNeeded();
    await expect.poll(() => hasInk(ink)).toBe(true);
    await ink.click();
    await expect(ink).toHaveAttribute("data-playing", "true");
    await page.waitForTimeout(180);
    await ink.click();
    await expect(ink).toHaveAttribute("data-playing", "false");
    await page.waitForTimeout(50);
    const paused = await signature(ink);
    await page.waitForTimeout(120);
    expect(await signature(ink)).toBe(paused);
    await ink.click();
    await expect(ink).toHaveAttribute("data-playing", "true");
    const box = (await ink.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(550);
    await page.mouse.up();
    await expect(ink).toHaveAttribute("data-playing", "true");
    await expect.poll(() => signature(ink)).not.toBe(paused);
    await moment.getByRole("button", { name: "手写回复", exact: true }).click();
    await expect(writer).toBeVisible();
    await expect(ink).toHaveAttribute("data-playing", "false");
    const hidden = await signature(ink);
    await page.waitForTimeout(120);
    expect(await signature(ink)).toBe(hidden);
    await writer.getByRole("button", { name: "关闭", exact: true }).click();
    await page.reload();
    await expect(page.getByTestId("active-channel-name")).toBeVisible();
    await page.locator(".story-header-trigger").click();
    await expect(moment.locator(".handwriting-message canvas")).toHaveCount(7);
    await ink.scrollIntoViewIfNeeded();
    await expect.poll(() => hasInk(ink)).toBe(true);
    for (const width of [360, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await moment.locator(".story-interactions").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    }
    await page.getByRole("button", { name: "我们的故事，点击切换" }).click();
    await expect(page.getByRole("dialog", { name: "我的故事" })).toBeVisible();
    await expect(moment.locator(".handwriting-message canvas")).toHaveCount(7);
    await moment.getByLabel("评论内容", { exact: true }).fill("仍然可以打字回复");
    await moment.getByRole("button", { name: "发表评论", exact: true }).click();
    await expect(moment.locator(".story-comment-content")).toContainText([textComment, `回复 ${E2E_ADMIN.displayName}`, "仍然可以打字回复"]);
    expect((await comments()).filter((row) => row.handwriting)).toHaveLength(1);
    expect(pageErrors).toEqual([]);
  } finally {
    expect((await request.delete(`/api/stories/${story.id}`, { headers })).ok()).toBe(true);
  }
});
