import { test, expect, type APIRequestContext, type Page, webkit } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { unzipArchive } from "../../src/server/zipArchive.js";
import { E2E_ADMIN, E2E_CHANNELS } from "../seed-data.js";
const selection = {
  translation: "cmn-cu89s",
  bookCode: "1TH",
  chapter: 5,
  verseStart: 16,
  verseEnd: 16
};
const glyph = {
  character: {
    strokes: [
      {
        points: [
          [2000, 2000, 0],
          [5000, 8000, 100],
          [8000, 2000, 200]
        ],
        color: "#263b33",
        brush: { size: 45, sensitivity: 65, lag: 35 }
      }
    ]
  },
  bounds: { left: 1400, right: 8600, top: 1400, bottom: 8600 }
};
async function token(
  request: APIRequestContext,
  username = E2E_ADMIN.username as string,
  password = E2E_ADMIN.password as string
) {
  const response = await request.post("/api/auth/login", { data: { username, password } });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).token as string;
}
async function login(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("用户名").fill(E2E_ADMIN.username);
  await page.getByPlaceholder("密码").fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
}
async function openVerse(page: Page) {
  await page.getByRole("button", { name: "打开圣经" }).click();
  if (await page.getByRole("button", { name: "目录", exact: true }).isVisible())
    await page.getByRole("button", { name: "目录", exact: true }).click();
  await page.getByRole("tab", { name: "经卷目录", exact: true }).click();
  await page.getByRole("button", { name: /^约翰福音/ }).click();
  await page.getByRole("button", { name: "11", exact: true }).click();
  await page.getByLabel("选择经节").selectOption("35");
  const verse = page.locator('[data-verse-key="JHN-11-35"]');
  await expect(verse).toBeVisible();
  await verse.click();
  await page.getByRole("button", { name: "抄写", exact: true }).click();
  await page.getByRole("button", { name: "开始抄写", exact: true }).click();
}
async function stroke(page: Page) {
  const canvas = page.getByLabel("经文抄写手写板");
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("missing handwriting canvas");
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.8, { steps: 10 });
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.3, { steps: 10 });
  await page.mouse.up();
}
test("copywork lifecycle isolates private ink, retries saves and shares, publishes and recalls", async ({
  request
}) => {
  const headers = { Authorization: `Bearer ${await token(request)}` };
  const username = `copy-${Date.now()}`;
  const password = "CopyworkTest123!";
  const created = await request.post("/api/admin/accounts", {
    headers,
    data: { username, password, displayName: "抄写测试读者" }
  });
  expect(created.ok()).toBeTruthy();
  const readerHeaders = { Authorization: `Bearer ${await token(request, username, password)}` };
  const badPreferences = await request.patch("/api/me/preferences", {
    headers: readerHeaders,
    data: { handwritingPreferences: { brush: { size: 45, sensitivity: 65, lag: 35, algorithm: "unknown" } } }
  });
  expect(badPreferences.status()).toBe(400);
  const id = randomUUID();
  const path = `/api/bible/copyworks/${id}`;
  const sourceResponse = await request.post("/api/bible/copyworks/source", {
    headers,
    data: selection
  });
  expect(sourceResponse.ok()).toBeTruthy();
  const { source } = await sourceResponse.json();
  expect(
    (
      await request.post("/api/bible/copyworks", {
        headers,
        data: { id, spacing: "normal", ...selection }
      })
    ).ok()
  ).toBeTruthy();
  expect((await request.get(path, { headers })).status()).toBe(404);
  expect((await request.post(`${path}/complete`, { headers })).status()).toBe(400);
  for (let i = 0; i < Array.from(source.text as string).filter((c) => !/\s/.test(c)).length; i++)
    expect((await request.put(`${path}/glyphs/${i}`, { headers, data: glyph })).ok()).toBeTruthy();
  const [first, second] = await Promise.all([
    request.post(`${path}/complete`, { headers }),
    request.post(`${path}/complete`, { headers })
  ]);
  expect(first.ok()).toBeTruthy();
  expect(second.ok()).toBeTruthy();
  expect((await request.get(`${path}/pages/0`, { headers: readerHeaders })).status()).toBe(404);
  const markers = "/api/bible/copyworks/markers?translation=cmn-cu89s&bookCode=1TH&chapter=5";
  expect(
    (await (await request.get(markers, { headers: readerHeaders })).json()).verses
  ).not.toContain(16);
  expect(
    (await request.patch(path, { headers: readerHeaders, data: { published: true } })).status()
  ).toBe(404);
  expect((await request.patch(path, { headers, data: { published: true } })).ok()).toBeTruthy();
  expect((await (await request.get(markers, { headers: readerHeaders })).json()).verses).toContain(
    16
  );
  expect((await request.get(`${path}/pages/0`, { headers: readerHeaders })).ok()).toBeTruthy();
  expect((await request.patch(path, { headers, data: { published: false } })).ok()).toBeTruthy();
  const { channels } = await (await request.get("/api/channels", { headers })).json();
  const channelId = channels.find((c: { name: string }) => c.name === E2E_CHANNELS.default).id;
  const shareBody = { channelId, clientRequestId: randomUUID() };
  const sent = await request.post(`${path}/share`, { headers, data: shareBody });
  expect(sent.ok()).toBeTruthy();
  const message = await sent.json();
  const retried = await (await request.post(`${path}/share`, { headers, data: shareBody })).json();
  expect(retried.messageId).toBe(message.messageId);
  expect((await request.get(`${path}/pages/0`, { headers: readerHeaders })).ok()).toBeTruthy();
  expect(
    (
      await request.post(`${path}/share`, {
        headers: readerHeaders,
        data: { ...shareBody, clientRequestId: randomUUID() }
      })
    ).status()
  ).toBe(403);
  expect(
    (await request.post(`/api/messages/${message.messageId}/recall`, { headers })).ok()
  ).toBeTruthy();
  expect((await request.get(`${path}/pages/0`, { headers: readerHeaders })).status()).toBe(404);
  const exported = await request.get("/api/admin/export/chat", { headers });
  expect(exported.ok()).toBeTruthy();
  const backup = JSON.parse(
    unzipArchive(await exported.body())
      .find((entry) => entry.name === "chat.json")!
      .data.toString()
  );
  const archived = backup.copyworks.find((w: { id: string }) => w.id === id);
  expect(archived.glyphs.length).toBe(
    Array.from(source.text as string).filter((c) => !/\s/.test(c)).length
  );
  expect((await request.delete(path, { headers })).ok()).toBeTruthy();
  expect((await request.get(path, { headers })).status()).toBe(404);
  const restored = await request.post("/api/admin/import/chat", {
    headers,
    multipart: {
      file: {
        name: "chat.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify({ copyworks: [archived] }))
      }
    }
  });
  expect(restored.ok(), await restored.text()).toBeTruthy();
  expect((await request.get(`${path}/pages/0`, { headers })).ok()).toBeTruthy();
  await request.delete(path, { headers });
  const { accounts } = await (await request.get("/api/admin/accounts", { headers })).json();
  const account = accounts.find((a: { username: string }) => a.username === username);
  if (account) await request.delete(`/api/admin/accounts/${account.id}`, { headers });
});
test("guided copywork writes, resumes an unfinished glyph, frames, saves and marks the verse", async ({
  page, request
}) => {
  test.setTimeout(90000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const preferencesResponse = await request.patch("/api/me/preferences", {
    headers: { Authorization: `Bearer ${await token(request)}` },
    data: { handwritingPreferences: { brush: { size: 45, sensitivity: 65, lag: 35, algorithm: "follow" } } }
  });
  expect(preferencesResponse.ok()).toBeTruthy();
  await login(page);
  await openVerse(page);
  const dialog = page.getByRole("dialog", { name: "经文抄写", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "毛笔", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByRole("button", { name: "硬笔", exact: true })).toBeVisible();
  await dialog.getByText("毛笔参数", { exact: true }).click();
  await expect(dialog.getByLabel("毛笔算法")).toHaveValue("slanted");
  for (const width of [360, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    const box = await dialog.getByRole("button", { name: "下次继续写" }).boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(844);
    expect(
      await dialog
        .locator(".copywork-composer-body")
        .evaluate((el) => el.scrollWidth <= el.clientWidth)
    ).toBeTruthy();
    await expect(dialog.getByLabel("毛笔算法")).toBeVisible();
    await page.screenshot({ path: `output/e2e/copywork-pen-controls-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.getByRole("button", { name: "硬笔", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "硬笔", exact: true })).toHaveAttribute("aria-pressed", "true");
  await stroke(page);
  await dialog.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "写好了", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "毛笔", exact: true }).click();
  await dialog.getByText("毛笔参数", { exact: true }).click();
  await expect(dialog.getByLabel("毛笔算法")).toHaveValue("slanted");
  await dialog.getByLabel("毛笔算法").selectOption("follow");
  await expect(dialog.getByRole("slider", { name: "毛笔旋转滞后" })).toBeVisible();
  await dialog.getByLabel("毛笔算法").selectOption("slanted");
  await dialog.getByRole("slider", { name: "毛笔速度响应" }).fill("70");
  await dialog.getByText("毛笔参数", { exact: true }).click();
  await stroke(page);
  await dialog.getByRole("button", { name: "下次继续写" }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await page.getByRole("button", { name: "打开圣经" }).click();
  await page.getByRole("button", { name: "目录", exact: true }).click();
  await page.getByRole("tab", { name: "我的抄写", exact: true }).click();
  await page
    .getByRole("button", { name: /本机草稿/ })
    .first()
    .click();
  await expect(dialog.getByRole("button", { name: "写好了" })).toBeEnabled();
  await dialog.getByText("毛笔参数", { exact: true }).click();
  await expect(dialog.getByLabel("毛笔算法")).toHaveValue("slanted");
  await expect(dialog.getByRole("slider", { name: "毛笔速度响应" })).toHaveValue("70");
  await dialog.getByText("毛笔参数", { exact: true }).click();
  await page.screenshot({ path: "output/e2e/copywork-writing-390.png", fullPage: true });
  await dialog.getByRole("button", { name: "写好了" }).click();
  await stroke(page);
  await dialog.getByRole("button", { name: /重写第 1 字/ }).click();
  await dialog.getByRole("button", { name: "写好了" }).click();
  await expect(dialog.locator(".writing-heading")).toContainText("2 / 5");
  await expect(dialog.getByRole("button", { name: "写好了" })).toBeEnabled();
  for (let i = 1; i < 5; i++) {
    await stroke(page);
    await dialog.getByRole("button", { name: "写好了" }).click();
  }
  await expect(dialog.getByRole("button", { name: "存入我的圣经" })).toBeVisible();
  await page.screenshot({ path: "output/e2e/copywork-finished-390.png", fullPage: true });
  let loseCompleteResponse = true;
  await page.route("**/api/bible/copyworks/*/complete", async (route) => {
    if (loseCompleteResponse) {
      loseCompleteResponse = false;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await dialog.getByRole("button", { name: "存入我的圣经" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByRole("button", { name: "存入我的圣经" }).click();
  const viewer = page.getByRole("dialog", { name: "抄写册页", exact: true });
  await expect(viewer).toBeVisible();
  for (const width of [360, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(() => document.documentElement.style.setProperty("--safe-top", "47px"));
    const close = viewer.getByRole("button", { name: "关闭", exact: true });
    const closeBox = await close.boundingBox();
    expect(closeBox!.y).toBeGreaterThanOrEqual(47);
    if (width < 700) {
      expect(closeBox!.width).toBeGreaterThanOrEqual(44);
      expect(closeBox!.height).toBeGreaterThanOrEqual(44);
    }
    const paper = await viewer.locator(".copywork-paper").boundingBox();
    expect(paper!.height / paper!.width).toBeLessThan(1);
    expect(await viewer.locator(".viewer-body").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBeTruthy();
    await page.screenshot({ path: `output/e2e/copywork-viewer-${width}.png`, fullPage: true });
  }
  await page.evaluate(() => document.documentElement.style.removeProperty("--safe-top"));
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(viewer.getByText(/已保存/)).toBeVisible();
  await viewer.getByRole("button", { name: "公开到经文下" }).click();
  await viewer.getByRole("button", { name: "确认公开" }).click();
  await expect(viewer.getByRole("button", { name: "取消公开" })).toBeVisible();
  await viewer.getByRole("button", { name: "回放本页" }).click();
  await viewer.getByRole("button", { name: "停止回放" }).click();
  await viewer.getByRole("button", { name: "分享到聊天室", exact: true }).click();
  await viewer.getByRole("button", { name: "发送作品", exact: true }).click();
  await viewer.getByRole("button", { name: "前往聊天室", exact: true }).click();
  const card = page.getByRole("button", { name: "查看抄写：约翰福音 11:35", exact: true }).last();
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.getByRole("dialog", { name: "抄写册页", exact: true })).toBeVisible();
  await page.screenshot({ path: "output/e2e/copywork-viewer-390.png", fullPage: true });
  await page
    .getByRole("dialog", { name: "抄写册页", exact: true })
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await page.getByRole("button", { name: "打开圣经" }).click();
  await page.getByRole("tab", { name: "经卷目录", exact: true }).click();
  await page.getByRole("button", { name: /^约翰福音/ }).click();
  await page.getByRole("button", { name: "11", exact: true }).click();
  await page.getByLabel("选择经节").selectOption("35");
  const marker = page
    .locator('[data-verse-key="JHN-11-35"]')
    .locator("xpath=following-sibling::button[1]");
  await expect(marker).toHaveAttribute("aria-label", "查看此节经文的抄写");
  await marker.click();
  await expect(page.getByRole("dialog", { name: "经文下的抄写", exact: true })).toBeVisible();
  expect(pageErrors).toEqual([]);
});
test("WebKit touch input retains unfinished ink and shows natural narrow glyph bounds", async () => {
  test.setTimeout(60000);
  const browser = await webkit.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    baseURL: "http://127.0.0.1:4173"
  });
  const page = await context.newPage();
  try {
    await login(page);
    await openVerse(page);
    const canvas = page.getByLabel("经文抄写手写板");
    await canvas.dispatchEvent("pointerdown", {
      pointerId: 7,
      pointerType: "touch",
      isPrimary: true,
      clientX: 160,
      clientY: 300,
      buttons: 1
    });
    await canvas.dispatchEvent("pointermove", {
      pointerId: 7,
      pointerType: "touch",
      isPrimary: true,
      clientX: 180,
      clientY: 380,
      buttons: 1
    });
    await canvas.dispatchEvent("pointerup", {
      pointerId: 7,
      pointerType: "touch",
      isPrimary: true,
      clientX: 185,
      clientY: 390,
      buttons: 0
    });
    await expect(page.getByRole("button", { name: "写好了" })).toBeEnabled();
    await page.getByRole("button", { name: "写好了" }).click();
    await expect(page.getByRole("button", { name: /重写第 1 字/ })).toBeVisible();
    await page.getByRole("button", { name: "下次继续写" }).click();
  } finally {
    await context.close();
    await browser.close();
  }
});
