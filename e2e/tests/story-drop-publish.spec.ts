import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { E2E_ADMIN } from "../seed-data.js";
import { focusChat } from "../helpers/chat.js";

test.use({ serviceWorkers: "block" });

async function login(page: Page) {
  await page.route("**/*", (route) => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.goto("/");
  await page.getByPlaceholder("用户名").fill(E2E_ADMIN.username);
  await page.getByPlaceholder("密码").fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByTestId("active-channel-name")).toBeVisible();
  // 登录后默认「圣经+聊天」分屏会遮挡拖放落点（CI 失败快照实锤）；先回到聊天为主。
  await focusChat(page);
}

type DragFile = { name: string; base64: string; mime: string };

async function dispatchDrag(page: Page, selector: string, type: "dragenter" | "drop", file: DragFile | null) {
  await page.locator(selector).first().evaluate((element, payload) => {
    const dataTransfer = new DataTransfer();
    if (payload.file) {
      const bytes = Uint8Array.from(atob(payload.file.base64), (ch) => ch.charCodeAt(0));
      dataTransfer.items.add(new File([bytes], payload.file.name, { type: payload.file.mime }));
    } else {
      dataTransfer.setData("text/plain", "只是拖动文字");
    }
    element.dispatchEvent(new DragEvent(payload.type, { bubbles: true, cancelable: true, dataTransfer }));
  }, { type, file });
}

test("把照片拖进故事窗口直接开始发布，发布窗内还能继续拖入照片", async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page);
  const heic: DragFile = { name: `拖入故事-${randomUUID()}.heic`, base64: (await fs.readFile("e2e/fixtures/story-sample.heic")).toString("base64"), mime: "image/heic" };
  const png: DragFile = { name: `拖入发布窗-${randomUUID()}.png`, base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", mime: "image/png" };

  await page.locator(".story-header-trigger").click();
  await expect(page.getByRole("dialog", { name: "我们的故事" })).toBeVisible();
  // dispatchDrag 走 evaluate 不做可点性检查，先确认拖放目标已在打开的对话框里。
  await expect(page.locator(".story-scroll").first()).toBeVisible();

  await dispatchDrag(page, ".story-scroll", "dragenter", null);
  await expect(page.locator(".story-drop-mask")).toBeHidden();

  await dispatchDrag(page, ".story-scroll", "dragenter", heic);
  await expect(page.locator(".story-drop-mask")).toContainText("丢到这里，留下一段故事");
  await dispatchDrag(page, ".story-scroll", "drop", heic);

  const composer = page.getByRole("dialog", { name: "留下一段故事" });
  await expect(composer).toBeVisible();
  await expect(composer.locator(".story-draft-image")).toHaveCount(1);
  await expect.poll(async () => {
    const img = composer.locator(".story-draft-image img").first();
    return img.evaluate((el) => el.complete && el.naturalWidth > 0);
  }).toBe(true);

  await dispatchDrag(page, ".story-composer-body", "dragenter", png);
  await expect(composer.locator(".story-drop-mask")).toContainText("丢进来，加进这段故事");
  await dispatchDrag(page, ".story-composer-body", "drop", png);
  await expect(composer.locator(".story-draft-image")).toHaveCount(2);

  await composer.getByLabel("这一刻，想说些什么", { exact: false }).fill("拖进来的一段生活片段。");
  await composer.getByRole("button", { name: "发布故事", exact: true }).click();
  await expect(composer).toBeHidden();
  await expect(page.locator(".story-photos img").first()).toBeVisible();
  expect(errors).toEqual([]);
});
