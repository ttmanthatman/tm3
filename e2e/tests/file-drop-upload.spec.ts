import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { E2E_ADMIN, E2E_CHANNELS } from "../seed-data.js";

test.use({ serviceWorkers: "block" });

async function login(page: Page) {
  await page.route("**/*", (route) => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.goto("/");
  await page.getByPlaceholder("用户名").fill(E2E_ADMIN.username);
  await page.getByPlaceholder("密码").fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
}

async function dispatchDrag(page: Page, type: "dragenter" | "dragleave" | "drop", fileName?: string) {
  await page.locator(".messages-viewport").first().evaluate((element, payload) => {
    const dataTransfer = new DataTransfer();
    if (payload.fileName) dataTransfer.items.add(new File(["拖放上传的文件内容"], payload.fileName, { type: "text/plain" }));
    else dataTransfer.setData("text/plain", "只是拖动文字");
    element.dispatchEvent(new DragEvent(payload.type, { bubbles: true, cancelable: true, dataTransfer }));
  }, { type, fileName: fileName ?? null });
}

test("把文件拖进聊天室出现丢到聊天室蒙版，松手后上传并持久保存", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 844 });
  await login(page);
  await expect(page.locator(".chat-drop-mask")).toBeHidden();

  await dispatchDrag(page, "dragenter");
  await expect(page.locator(".chat-drop-mask")).toBeHidden();

  const fileName = `拖入笔记-${randomUUID()}.txt`;
  await dispatchDrag(page, "dragenter", fileName);
  await expect(page.locator(".chat-drop-mask")).toBeVisible();
  await expect(page.locator(".chat-drop-mask")).toContainText("丢到聊天室");

  await dispatchDrag(page, "dragleave", fileName);
  await expect(page.locator(".chat-drop-mask")).toBeHidden();

  await dispatchDrag(page, "dragenter", fileName);
  await expect(page.locator(".chat-drop-mask")).toBeVisible();
  await dispatchDrag(page, "drop", fileName);
  await expect(page.locator(".chat-drop-mask")).toBeHidden();

  const fileMessage = page.locator(".message-row.mine").filter({ hasText: fileName });
  await expect(fileMessage).toBeVisible();
  await expect(fileMessage.locator(".file-card")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
  await expect(page.locator(".message-row.mine").filter({ hasText: fileName }).locator(".file-card")).toBeVisible();
});

test("把 HEIC 照片拖进聊天室会转成可显示的图片消息", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 844 });
  await login(page);
  const name = `iPhone照片-${randomUUID()}.heic`;
  const base64 = (await fs.readFile("e2e/fixtures/story-sample.heic")).toString("base64");

  await page.locator(".messages-viewport").first().evaluate((element, payload) => {
    const bytes = Uint8Array.from(atob(payload.base64), (ch) => ch.charCodeAt(0));
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File([bytes], payload.name, { type: "image/heic" }));
    element.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer }));
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
  }, { base64, name });

  const image = page.locator(".message-row.mine .chat-image").first();
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((el) => el.complete && el.naturalWidth > 0)).toBe(true);
});
