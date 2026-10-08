import { test, expect, type APIRequestContext, type Locator, type Page, webkit } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
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
async function login(page: Page, username = E2E_ADMIN.username as string, password = E2E_ADMIN.password as string) {
  await page.goto("/");
  await page.getByPlaceholder("用户名").fill(username);
  await page.getByPlaceholder("密码").fill(password);
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

async function swipe(target: Locator, direction: "left" | "right") {
  await target.evaluate((element, sign) => {
    // WebKit does not expose a constructible Touch. Supply the same touch lists
    // to DOM events so both engines exercise the real bubbling handlers.
    function dispatch(type: string, x: number, ending: boolean) {
      const touch = { identifier: 1, target: element, clientX: x, clientY: 200 };
      const event = new Event(type, { bubbles: true });
      Object.defineProperties(event, {
        touches: { value: ending ? [] : [touch] },
        changedTouches: { value: [touch] }
      });
      element.dispatchEvent(event);
    }
    dispatch("touchstart", 160, false);
    dispatch("touchend", 160 + sign * 100, true);
  }, direction === "right" ? 1 : -1);
}

test("admin swipe switches persist and protect copywork dragging and writing in both browsers", async ({ page, request }) => {
  test.setTimeout(120000);
  const headers = { Authorization: `Bearer ${await token(request)}` };
  const id = randomUUID();
  const passage = { translation: "cmn-cu89s", bookCode: "JHN", chapter: 11, verseStart: 35, verseEnd: 35 };
  const sourceResponse = await request.post("/api/bible/copyworks/source", { headers, data: passage });
  expect(sourceResponse.ok()).toBeTruthy();
  const { source } = await sourceResponse.json();
  expect((await request.post("/api/bible/copyworks", { headers, data: { id, spacing: "normal", ...passage } })).ok()).toBeTruthy();
  const length = Array.from(source.text as string).filter((character) => !/\s/u.test(character)).length;
  for (let index = 0; index < length; index++) {
    expect((await request.put(`/api/bible/copyworks/${id}/glyphs/${index}`, { headers, data: glyph })).ok()).toBeTruthy();
  }
  expect((await request.post(`/api/bible/copyworks/${id}/complete`, { headers })).ok()).toBeTruthy();
  const channels = (await (await request.get("/api/channels", { headers })).json()).channels as Array<{ id: number; name: string }>;
  const channel = channels.find((item) => item.name === E2E_CHANNELS.default)!;
  expect((await request.post(`/api/bible/copyworks/${id}/share`, { headers, data: { channelId: channel.id, clientRequestId: randomUUID() } })).ok()).toBeTruthy();

  async function scenario(current: Page, engine: string) {
    const pageErrors: string[] = [];
    current.on("pageerror", (error) => pageErrors.push(error.message));
    await login(current);
    let bible = current.locator(".bible-workspace");
    let chat = current.locator(".chat-pane");
    async function settings(enabled: boolean, protectedInteractions: boolean, inspect = false) {
      await current.getByRole("button", { name: "更多管理功能", exact: true }).click();
      await current.getByRole("menuitem", { name: "系统设置", exact: true }).click();
      const admin = current.getByRole("dialog", { name: "管理面板", exact: true });
      await admin.getByRole("button", { name: /外观与体验/ }).click();
      await admin.getByRole("button", { name: /聊天室外观/ }).click();
      const master = admin.getByRole("switch", { name: "左右滑动切换聊天室与圣经", exact: true });
      const protection = admin.getByRole("switch", { name: "书写、拖动进度时屏蔽滑动切换", exact: true });
      if (inspect) {
        await expect(master).toBeChecked();
        await expect(protection).toBeChecked();
        for (const width of [360, 390, 1280]) {
          await current.setViewportSize({ width, height: 844 });
          await master.scrollIntoViewIfNeeded();
          await expect(protection).toBeVisible();
          expect(await admin.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBeTruthy();
          await current.screenshot({ path: `output/e2e/bible-swipe-settings-${engine}-${width}.png`, fullPage: true });
        }
        await current.setViewportSize({ width: 390, height: 844 });
      }
      await master.check();
      await protection.setChecked(protectedInteractions);
      await master.setChecked(enabled);
      if (!enabled) await expect(protection).toBeDisabled();
      await admin.getByRole("button", { name: "保存外观", exact: false }).click();
      await expect(admin.getByText("所有外观设置都已保存。", { exact: true })).toBeVisible();
      await admin.getByRole("button", { name: "关闭管理", exact: true }).click();
    }
    await settings(false, true, true);
    expect(pageErrors).toEqual([]);
    // Keep this swipe scenario independent of in-flight reader GETs on reload.
    current = await current.context().newPage();
    current.on("pageerror", (error) => pageErrors.push(error.message));
    await current.setViewportSize({ width: 390, height: 844 });
    await current.goto("/");
    bible = current.locator(".bible-workspace");
    chat = current.locator(".chat-pane");
    await expect(chat).toBeVisible();
    await swipe(chat, "right");
    await expect(bible).toBeHidden();
    await current.getByRole("button", { name: "打开圣经" }).click();
    await expect(bible).toBeVisible();
    await swipe(bible, "left");
    await expect(bible).toBeVisible();
    await bible.getByRole("button", { name: "聊天", exact: true }).click();
    await settings(true, true);
    await swipe(chat, "right");
    await expect(bible).toBeVisible();
    await swipe(bible, "left");
    await expect(chat).toBeVisible();
    const paper = current.locator(".copywork-card.message .copywork-paper").last();
    await expect(paper).toBeVisible();
    await swipe(paper, "right");
    await expect(chat).toBeVisible();
    const box = (await paper.boundingBox())!;
    const point = { pointerId: 10, pointerType: "touch", isPrimary: true, clientX: box.x + box.width * 0.7, clientY: box.y + box.height * 0.5, button: 0 };
    await paper.dispatchEvent("pointerdown", { ...point, buttons: 1 });
    await paper.dispatchEvent("pointermove", { ...point, clientX: box.x + box.width * 0.3, buttons: 1 });
    await paper.dispatchEvent("pointerup", { ...point, clientX: box.x + box.width * 0.3, buttons: 0 });
    expect(Number(await paper.getAttribute("data-progress"))).toBeLessThan(0.7);
    await expect(chat).toBeVisible();
    await openVerse(current);
    const composer = current.getByRole("dialog", { name: "经文抄写", exact: true });
    await stroke(current);
    await swipe(current.getByLabel("经文抄写手写板"), "left");
    await expect(composer).toBeVisible();
    await expect(bible).toBeVisible();
    await composer.getByRole("button", { name: "下次继续写", exact: true }).click();
    await swipe(bible, "left");
    await expect(chat).toBeVisible();
    await settings(true, false);
    await swipe(paper, "right");
    await expect(bible).toBeVisible();
    await swipe(bible, "left");
    await expect(chat).toBeVisible();
    await settings(true, true);
    expect(pageErrors).toEqual([]);
  }
  await scenario(page, "chromium");
  const browser = await webkit.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, baseURL: "http://127.0.0.1:4173" });
  try { await scenario(await context.newPage(), "webkit"); }
  finally { await context.close(); await browser.close(); }
});

test("WebKit reload keeps music state writes alive without interface errors", async () => {
  const browser = await webkit.launch();
  const page = await browser.newPage({ baseURL: "http://127.0.0.1:4173" });
  const musicErrors: string[] = [];
  let stateWrites = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/music/playback-state") && request.method() === "PUT") stateWrites++;
  });
  page.on("pageerror", (error) => {
    if (error.message.includes("/api/music/")) musicErrors.push(error.message);
  });
  try {
    await login(page);
    for (let i = 0; i < 3; i++) {
      await page.waitForLoadState("networkidle");
      // The mounted player's pagehide and visibility handlers save even when
      // no track is selected; exercise real navigation, not synthetic events.
      await page.reload();
      await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
    }
    expect(stateWrites).toBeGreaterThanOrEqual(3);
    expect(musicErrors).toEqual([]);
  } finally { await browser.close(); }
});

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
  for (const width of [360, 390, 642, 1280]) {
    const height = width === 642 ? 1057 : 844;
    await page.setViewportSize({ width, height });
    const box = await dialog.getByRole("button", { name: "下次继续写" }).boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(height);
    const brushButton = await dialog.getByRole("button", { name: "毛笔", exact: true }).boundingBox();
    const settings = await dialog.locator(".handwriting-brush-settings > summary").boundingBox();
    expect(settings!.x).toBeGreaterThanOrEqual(brushButton!.x + brushButton!.width);
    expect(Math.abs(settings!.y + settings!.height / 2 - brushButton!.y - brushButton!.height / 2)).toBeLessThan(2);
    const writingColumn = await dialog.locator(".writing-column").boundingBox();
    const writingPad = await dialog.locator(".handwriting-pad").boundingBox();
    expect(Math.abs(writingPad!.width - writingColumn!.width)).toBeLessThan(2);
    expect(
      await dialog
        .locator(".copywork-composer-body")
        .evaluate((el) => el.scrollWidth <= el.clientWidth)
    ).toBeTruthy();
    await expect(dialog.getByLabel("毛笔算法")).toBeVisible();
    await page.screenshot({ path: `output/e2e/copywork-pen-controls-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog.getByRole("button", { name: "笔与纸", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "墨色与辅助线", exact: true }).click();
  await expect(dialog.getByLabel("墨色", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("辅助线", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "墨色与辅助线", exact: true }).click();
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
  for (let i = 1; i < 4; i++) {
    await stroke(page);
    await dialog.getByRole("button", { name: "写好了" }).click();
  }
  await dialog.getByRole("button", { name: "跳过此字", exact: true }).click();
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
  let exportedPageReads = 0;
  page.on("request", (request) => { if (/\/api\/bible\/copyworks\/[^/]+\/pages\/\d+$/.test(request.url())) exportedPageReads++; });
  await viewer.getByRole("button", { name: "作品操作", exact: true }).click();
  const firstDownload = page.waitForEvent("download");
  await viewer.getByRole("button", { name: "下载透明 PNG", exact: true }).click();
  const download = await firstDownload;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  const png = sharp(await readFile((await download.path())!));
  expect((await png.metadata()).hasAlpha).toBeTruthy();
  const { data: pixels } = await png.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alpha = pixels.filter((_, index) => index % 4 === 3);
  expect(alpha.some((value) => value === 0)).toBeTruthy();
  expect(alpha.some((value) => value > 0)).toBeTruthy();
  expect(exportedPageReads).toBeGreaterThan(0);
  const readsAfterFirstDownload = exportedPageReads;
  await viewer.getByRole("button", { name: "作品操作", exact: true }).click();
  const nextDownload = page.waitForEvent("download");
  await viewer.getByRole("button", { name: "下载透明 PNG", exact: true }).click();
  await nextDownload;
  expect(exportedPageReads).toBe(readsAfterFirstDownload);
  await viewer.getByRole("button", { name: "作品操作", exact: true }).click();
  await viewer.getByRole("button", { name: "分享到我的故事", exact: true }).click();
  const storyComposer = page.getByRole("dialog", { name: "留下一段故事", exact: true });
  await expect(storyComposer.locator(".story-draft-images img")).toBeVisible();
  await expect(storyComposer.locator(".story-draft-images img")).toHaveJSProperty("complete", true);
  await expect(storyComposer.getByLabel("这一刻，想说些什么")).toHaveValue("约翰福音 11:35");
  for (const width of [360, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await storyComposer.locator(".story-composer-body").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBeTruthy();
    await expect(storyComposer.getByRole("button", { name: "关闭", exact: true })).toBeVisible();
    await page.screenshot({ path: `output/e2e/copywork-story-${width}.png`, fullPage: true });
  }
  await storyComposer.getByRole("button", { name: "发布故事", exact: true }).click();
  await expect(viewer.getByText("已分享到我的故事。", { exact: true })).toBeVisible();
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
  await expect(viewer.locator(".viewer-heading, .folio-caption, details")).toHaveCount(0);
  await viewer.getByRole("button", { name: "作品操作", exact: true }).click();
  await viewer.getByRole("button", { name: "公开到经文下" }).click();
  await viewer.getByRole("button", { name: "确认公开" }).click();
  await viewer.getByRole("button", { name: "作品操作", exact: true }).click();
  await expect(viewer.getByRole("button", { name: "取消公开" })).toBeVisible();
  await viewer.getByRole("button", { name: "作品操作", exact: true }).click();
  await viewer.locator(".copywork-paper").focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("Space");
  await viewer.getByRole("button", { name: "作品操作", exact: true }).click();
  await viewer.getByRole("button", { name: "分享到聊天室", exact: true }).click();
  await viewer.getByRole("button", { name: "发送作品", exact: true }).click();
  await viewer.getByRole("button", { name: "前往聊天室", exact: true }).click();
  const card = page.locator(".copywork-card.message").last();
  await expect(card).toBeVisible();
  await expect(card.locator(".folio-caption, strong, small")).toHaveCount(0);
  await card.locator(".copywork-paper").click();
  await expect(card.locator(".copywork-paper")).toHaveAttribute("data-playing", "true");
  await card.getByRole("button", { name: "在圣经中阅读：约翰福音 11:35", exact: true }).click();
  await expect(page.locator('[data-verse-key="JHN-11-35"]')).toBeVisible();
  const marker = page
    .locator('[data-verse-key="JHN-11-35"]')
    .locator("xpath=following-sibling::button[1]");
  await expect(marker).toHaveAttribute("aria-label", "查看此节经文的抄写");
  await marker.click();
  await expect(page.getByRole("dialog", { name: "经文下的抄写", exact: true })).toHaveCount(0);
  const directViewer = page.getByRole("dialog", { name: "抄写册页", exact: true });
  await expect(directViewer.locator(".copywork-paper")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "打开圣经", exact: true }).click();
  await expect(marker).toBeVisible();
  await marker.click();
  await expect(directViewer.locator(".copywork-paper")).toBeVisible();
  await expect(directViewer.locator(".folio-scroll")).toHaveAttribute("aria-busy", "false");
  const readsBeforeCachedDownload = exportedPageReads;
  await directViewer.getByRole("button", { name: "作品操作", exact: true }).click();
  const cachedDownload = page.waitForEvent("download");
  await directViewer.getByRole("button", { name: "下载透明 PNG", exact: true }).click();
  await cachedDownload;
  expect(exportedPageReads).toBe(readsBeforeCachedDownload);
  await expect(directViewer.getByRole("button", { name: "作品详情", exact: true })).toHaveCount(0);
  const paperBeforeMenu = await directViewer.locator(".copywork-paper").boundingBox();
  await directViewer.getByRole("button", { name: "作品操作", exact: true }).click();
  expect((await directViewer.locator(".copywork-paper").boundingBox())!.y).toBe(paperBeforeMenu!.y);
  await directViewer.getByRole("button", { name: "作品详情", exact: true }).click();
  await expect(directViewer.locator(".viewer-details")).toContainText("约翰福音 11:35");
  await directViewer.getByRole("button", { name: "选择其他抄写", exact: true }).click();
  await expect(directViewer.getByRole("button", { name: "公开作品", exact: true })).toBeVisible();
  await expect(directViewer.locator(".viewer-choice")).not.toHaveCount(0);
  await expect(directViewer.locator(".viewer-choice").first()).not.toContainText("约翰福音 11:35");
  await directViewer.getByRole("button", { name: "我的抄写", exact: true }).click();
  await expect(directViewer.locator(".viewer-choice")).not.toHaveCount(0);
  for (const width of [360, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await directViewer.locator(".viewer-body").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBeTruthy();
    await expect(directViewer.getByRole("button", { name: "关闭", exact: true })).toBeInViewport();
    const popover = await directViewer.locator("#copywork-tools").boundingBox();
    expect(popover!.y + popover!.height).toBeLessThanOrEqual(844);
    await directViewer.getByRole("button", { name: "删除作品", exact: true }).scrollIntoViewIfNeeded();
    await expect(directViewer.getByRole("button", { name: "关闭", exact: true })).toBeInViewport();
    await directViewer.getByRole("button", { name: "作品详情", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `output/e2e/copywork-direct-menu-${width}.png`, fullPage: true });
  }
  await directViewer.locator(".viewer-choice").last().click();
  await expect(directViewer.locator(".copywork-paper")).toBeVisible();
  await expect(directViewer.locator("#copywork-tools")).toHaveCount(0);
  for (const width of [360, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(directViewer.getByRole("button", { name: "关闭", exact: true })).toBeVisible();
    expect(await directViewer.locator(".viewer-body").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBeTruthy();
    await page.screenshot({ path: `output/e2e/copywork-direct-viewer-${width}.png`, fullPage: true });
  }
  await directViewer.getByRole("button", { name: "在圣经中阅读：约翰福音 11:35", exact: true }).click();
  await expect(directViewer).toHaveCount(0);
  await expect(page.locator('[data-verse-key="JHN-11-35"]')).toBeVisible();
  await page.route("**/api/bible/copyworks?**", (route) => route.fulfill({ json: { works: [], hasMore: false } }));
  await marker.click();
  await expect(directViewer.getByText("此节经文暂无可查看的抄写。", { exact: true })).toBeVisible();
  await directViewer.getByRole("button", { name: "关闭", exact: true }).click();
  await page.unroute("**/api/bible/copyworks?**");
  expect(pageErrors).toEqual([]);
});
test("multi-page copywork downloads reuse a transparent PNG and seed a cancellable story", async ({ page, request }) => {
  test.setTimeout(60000);
  const headers = { Authorization: `Bearer ${await token(request)}` };
  const id = randomUUID();
  const passage = { translation: "cmn-cu89s", bookCode: "JOS", chapter: 1, verseStart: 9, verseEnd: 10 };
  const { source } = await (await request.post("/api/bible/copyworks/source", { headers, data: passage })).json();
  expect((await request.post("/api/bible/copyworks", { headers, data: { id, spacing: "loose", ...passage } })).ok()).toBeTruthy();
  const characters = Array.from(source.text as string).filter((character) => !/\s/u.test(character));
  for (let index = 0; index < characters.length; index++)
    expect((await request.put(`/api/bible/copyworks/${id}/glyphs/${index}`, { headers, data: index === 1
      ? { skipped: true, character: { strokes: [] }, bounds: { left: 0, top: 0, right: 10000, bottom: 10000 } }
      : glyph })).ok()).toBeTruthy();
  const completed = await request.post(`/api/bible/copyworks/${id}/complete`, { headers });
  expect(completed.ok()).toBeTruthy();
  const { work } = await completed.json();
  expect(work.pageCount).toBeGreaterThan(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.getByRole("button", { name: "打开圣经", exact: true }).click();
  if (await page.getByRole("button", { name: "目录", exact: true }).isVisible())
    await page.getByRole("button", { name: "目录", exact: true }).click();
  await page.getByRole("tab", { name: "我的抄写", exact: true }).click();
  await page.getByRole("button", { name: `查看抄写：${source.reference}`, exact: true }).first().click();
  const viewer = page.getByRole("dialog", { name: "抄写册页", exact: true });
  await expect(viewer.locator(".folio-scroll")).toHaveAttribute("aria-busy", "false");
  let pageReads = 0;
  page.on("request", (request) => { if (request.url().includes(`/api/bible/copyworks/${id}/pages/`)) pageReads++; });
  for (let attempt = 0; attempt < 2; attempt++) {
    await viewer.getByRole("button", { name: "作品操作", exact: true }).click();
    const downloaded = page.waitForEvent("download");
    await viewer.getByRole("button", { name: "下载透明 PNG", exact: true }).click();
    const file = await downloaded;
    const metadata = await sharp(await readFile((await file.path())!)).metadata();
    expect(metadata.hasAlpha).toBeTruthy();
    expect(metadata.height!).toBeGreaterThan(metadata.width!);
    expect(pageReads).toBe(work.pageCount);
  }
  await viewer.getByRole("button", { name: "作品操作", exact: true }).click();
  await viewer.getByRole("button", { name: "分享到我的故事", exact: true }).click();
  const story = page.getByRole("dialog", { name: "留下一段故事", exact: true });
  await expect(story.getByLabel("这一刻，想说些什么")).toHaveValue(source.reference);
  await expect(story.locator(".story-copywork-image")).toHaveJSProperty("complete", true);
  expect(pageReads).toBe(work.pageCount);
  await story.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "放弃", exact: true }).click();
  await expect(story).toHaveCount(0);
  await expect(viewer.getByRole("button", { name: "作品操作", exact: true })).toBeVisible();
});
test("skipped slots survive draft reload and can be filled before completion", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await openVerse(page);
  const dialog = page.getByRole("dialog", { name: "经文抄写", exact: true });
  await expect(dialog.getByRole("button", { name: "写好了", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "跳过此字", exact: true }).click();
  await expect(dialog.locator(".writing-heading")).toContainText("2 / 5");
  await dialog.getByRole("button", { name: "下次继续写", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "打开圣经", exact: true }).click();
  await page.getByRole("button", { name: "目录", exact: true }).click();
  await page.getByRole("tab", { name: "我的抄写", exact: true }).click();
  await page.getByRole("button", { name: /本机草稿/ }).first().click();
  await expect(dialog.locator(".writing-heading")).toContainText("2 / 5");
  await dialog.getByRole("button", { name: /重写第 1 字/ }).click();
  await expect(dialog.getByRole("button", { name: "写好了", exact: true })).toBeDisabled();
  await stroke(page);
  await dialog.getByRole("button", { name: "写好了", exact: true }).click();
  await expect(dialog.locator(".writing-heading")).toContainText("2 / 5");
  for (let index = 1; index < 5; index++)
    await dialog.getByRole("button", { name: "跳过此字", exact: true }).click();
  await dialog.getByRole("button", { name: "存入我的圣经", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "抄写册页", exact: true }).locator(".copywork-paper")).toBeVisible();
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
    await page.getByRole("button", { name: "跳过此字", exact: true }).click();
    await expect(page.locator(".writing-heading")).toContainText("3 / 5");
    await expect(page.getByRole("button", { name: /重写第 2 字/ })).toBeVisible();
    await page.getByRole("button", { name: "下次继续写" }).click();
  } finally {
    await context.close();
    await browser.close();
  }
});

test("minimal copywork bubbles replay in place, link context, and turn only at viewer edges", async ({ page, request }) => {
  test.setTimeout(120000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const headers = { Authorization: `Bearer ${await token(request)}` };
  const id = randomUUID();
  const passage = { translation: "cmn-cu89s", bookCode: "JOS", chapter: 1, verseStart: 9, verseEnd: 10 };
  const sourceResponse = await request.post("/api/bible/copyworks/source", { headers, data: passage });
  expect(sourceResponse.ok()).toBeTruthy();
  const { source } = await sourceResponse.json();
  expect((await request.post("/api/bible/copyworks", { headers, data: { id, spacing: "loose", ...passage } })).ok()).toBeTruthy();
  const length = Array.from(source.text as string).filter((character) => !/\s/u.test(character)).length;
  for (let index = 0; index < length; index++) {
    expect((await request.put(`/api/bible/copyworks/${id}/glyphs/${index}`, { headers, data: glyph })).ok()).toBeTruthy();
  }
  const completed = await request.post(`/api/bible/copyworks/${id}/complete`, { headers });
  expect(completed.ok()).toBeTruthy();
  const completeData = await request.get(`/api/bible/copyworks/${id}`, { headers });
  const work = (await completeData.json()).work;
  expect(work.pageCount).toBeGreaterThan(1);
  const channelResponse = await request.get("/api/channels", { headers });
  const channels = (await channelResponse.json()).channels as Array<{ id: number; name: string }>;
  const channel = channels.find((item) => item.name === E2E_CHANNELS.default)!;
  expect((await request.post(`/api/bible/copyworks/${id}/share`, { headers, data: { channelId: channel.id, clientRequestId: randomUUID() } })).ok()).toBeTruthy();
  await login(page);
  const card = page.locator(".copywork-card.message").last();
  const paper = card.locator(".copywork-paper");
  await expect(paper).toBeVisible();
  await expect(card.locator(".folio-caption, strong, small")).toHaveCount(0);
  for (const width of [360, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    const cardBox = (await card.boundingBox())!;
    expect(cardBox.width).toBeGreaterThan(220);
    const wrap = card.locator("xpath=ancestor::div[contains(@class, 'bubble-wrap')]");
    const rowWidth = await card.evaluate((el) => el.closest(".message-row")!.getBoundingClientRect().width);
    const maximum = width <= 768 ? width - 94 : Math.min(620, rowWidth * 0.72);
    expect((await wrap.boundingBox())!.width).toBeCloseTo(maximum, 0);
    expect(cardBox.width).toBeCloseTo(maximum - 28, 0);
    expect(await card.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBeTruthy();
    await page.screenshot({ path: `output/e2e/copywork-own-${width}.png`, fullPage: true });
  }
  const bubble = card.locator("xpath=..");
  const outgoing = await bubble.evaluate((el) => ({
    actual: getComputedStyle(el).backgroundColor,
    theme: getComputedStyle(el).getPropertyValue("--bubble-mine").trim()
  }));
  expect(outgoing.actual).toBe("rgb(149, 236, 105)");
  expect(outgoing.theme).toBe("#95ec69");
  await bubble.evaluate((el) => (el as HTMLElement).style.setProperty("--bubble-mine", "#bfead8"));
  expect(await bubble.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(191, 234, 216)");
  await bubble.evaluate((el) => (el as HTMLElement).style.removeProperty("--bubble-mine"));
  await paper.click();
  await expect(paper).toHaveAttribute("data-playing", "true");
  await paper.click();
  await expect(paper).toHaveAttribute("data-playing", "false");
  const pausedProgress = Number(await paper.getAttribute("data-progress"));
  await paper.dblclick();
  await expect(paper).toHaveAttribute("data-playing", "true");
  expect(Number(await paper.getAttribute("data-progress"))).toBeLessThan(pausedProgress);
  await paper.click();
  await expect(paper).toHaveAttribute("data-playing", "false");
  const box = (await paper.boundingBox())!;
  const beforeDrag = Number(await paper.getAttribute("data-progress"));
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5, { steps: 5 });
  await page.mouse.up();
  expect(Number(await paper.getAttribute("data-progress"))).toBeGreaterThan(beforeDrag + 0.3);
  await expect(paper).toHaveAttribute("data-playing", "false");
  await expect(page.getByRole("dialog", { name: "抄写册页", exact: true })).toHaveCount(0);
  await card.getByRole("button", { name: `在圣经中阅读：${source.reference}`, exact: true }).click();
  await expect(page.locator('[data-verse-key="JOS-1-9"]')).toBeVisible();
  await expect(page.getByLabel("选择经节")).toHaveValue("9");
  await expect(paper).toHaveCount(0);
  await page.locator('[data-verse-key="JOS-1-9"]').locator("xpath=following-sibling::button[1]").click();
  const privateViewer = page.getByRole("dialog", { name: "抄写册页", exact: true });
  await expect(privateViewer.locator(".copywork-paper")).toBeVisible();
  await privateViewer.getByRole("button", { name: "作品操作", exact: true }).click();
  await privateViewer.getByRole("button", { name: "作品详情", exact: true }).click();
  await expect(privateViewer.locator(".viewer-details")).toContainText("私人保存");
  await privateViewer.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "目录", exact: true }).click();
  await page.getByRole("tab", { name: "我的抄写", exact: true }).click();
  await page.locator(`.copywork-card[data-copywork-id="${id}"]`).getByRole("button", { name: `查看抄写：${source.reference}`, exact: true }).click();
  const viewer = page.getByRole("dialog", { name: "抄写册页", exact: true });
  const viewerPaper = viewer.locator(".copywork-paper");
  await expect(viewerPaper).toBeVisible();
  await expect(viewer.locator(".viewer-heading, .folio-caption, details, .viewer-actions")).toHaveCount(0);
  const viewerBox = (await viewerPaper.boundingBox())!;
  // The right half replays; only the actual edge turns a page.
  await viewerPaper.click({ position: { x: viewerBox.width * 0.75, y: viewerBox.height * 0.5 } });
  await expect(viewerPaper).toHaveAttribute("data-playing", "true");
  await expect(viewer.locator(".folio-size")).toHaveAttribute("data-page-index", "0");
  await viewerPaper.click({ position: { x: viewerBox.width - 2, y: viewerBox.height * 0.5 } });
  await expect(viewer.locator(".folio-size")).toHaveAttribute("data-page-index", "1");
  await expect(viewerPaper).toHaveAttribute("aria-disabled", "false");
  const nextBox = (await viewerPaper.boundingBox())!;
  await viewerPaper.click({ position: { x: 2, y: nextBox.height * 0.5 } });
  await expect(viewer.locator(".folio-size")).toHaveAttribute("data-page-index", "0");
  await viewer.getByRole("button", { name: "抄写操作提示", exact: true }).click();
  await expect(viewer.getByText("右边缘：下一页", { exact: false })).toBeVisible();
  await expect(viewer.getByText("抄写来源", { exact: true })).toHaveCount(0);
  await viewer.getByRole("button", { name: "抄写操作提示", exact: true }).click();
  for (const width of [360, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(viewer.getByRole("button", { name: "关闭", exact: true })).toBeVisible();
    expect(await viewer.locator(".viewer-body").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBeTruthy();
    await page.screenshot({ path: `output/e2e/copywork-minimal-${width}.png`, fullPage: true });
  }
  await viewer.getByRole("button", { name: "关闭", exact: true }).click();
  expect(pageErrors).toEqual([]);

  // Receive the same message in WebKit, using real touch taps and pointer drags.
  const username = `cw-reader-${Date.now()}`;
  const password = "CopyworkReader123!";
  const adminHeaders = { Authorization: `Bearer ${await token(request)}` };
  const readerAccount = await request.post("/api/admin/accounts", { headers: adminHeaders, data: { username, password, displayName: "抄写读者" } });
  expect(readerAccount.ok(), await readerAccount.text()).toBeTruthy();
  const browser = await webkit.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, baseURL: "http://127.0.0.1:4173" });
  const receiver = await context.newPage();
  receiver.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await login(receiver, username, password);
    const receivedCard = receiver.locator(".copywork-card.message").last();
    const receivedPaper = receivedCard.locator(".copywork-paper");
    await expect(receivedPaper).toBeVisible();
    expect(await receivedCard.locator("xpath=..").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 250, 240)");
    expect((await receivedCard.boundingBox())!.width).toBeGreaterThan(220);
    await receiver.screenshot({ path: "output/e2e/copywork-received-static-webkit-390.png", fullPage: true });
    await receivedPaper.tap();
    await expect(receivedPaper).toHaveAttribute("data-playing", "true");
    await receivedPaper.tap();
    await expect(receivedPaper).toHaveAttribute("data-playing", "false");
    const touchBox = (await receivedPaper.boundingBox())!;
    const point = { pointerId: 12, pointerType: "touch", isPrimary: true, clientX: touchBox.x + touchBox.width * 0.2, clientY: touchBox.y + touchBox.height * 0.5, button: 0 };
    await receivedPaper.dispatchEvent("pointerdown", { ...point, buttons: 1 });
    await receivedPaper.dispatchEvent("pointermove", { ...point, clientX: touchBox.x + touchBox.width * 0.7, buttons: 1 });
    await receivedPaper.dispatchEvent("pointerup", { ...point, clientX: touchBox.x + touchBox.width * 0.7, buttons: 0 });
    const scrubbed = Number(await receivedPaper.getAttribute("data-progress"));
    expect(scrubbed).toBeGreaterThan(0.4);
    await expect(receivedPaper).toHaveAttribute("data-playing", "false");
    await receiver.screenshot({ path: "output/e2e/copywork-received-webkit-390.png", fullPage: true });
    await receivedPaper.tap();
    await receivedPaper.tap();
    await expect(receivedPaper).toHaveAttribute("data-playing", "true");
    expect(Number(await receivedPaper.getAttribute("data-progress"))).toBeLessThan(scrubbed);
    await receivedCard.getByRole("button", { name: `在圣经中阅读：${source.reference}`, exact: true }).click();
    await expect(receiver.locator('[data-verse-key="JOS-1-9"]')).toBeVisible();
    await receiver.getByRole("button", { name: "目录", exact: true }).click();
    await receiver.getByRole("tab", { name: "经卷目录", exact: true }).click();
    await receiver.getByRole("button", { name: /^约翰福音/ }).click();
    await receiver.getByRole("button", { name: "11", exact: true }).click();
    await receiver.getByLabel("选择经节").selectOption("35");
    await receiver.locator('[data-verse-key="JHN-11-35"]').locator("xpath=following-sibling::button[1]").click();
    const receivedViewer = receiver.getByRole("dialog", { name: "抄写册页", exact: true });
    await expect(receivedViewer.locator(".copywork-paper")).toBeVisible();
    await receivedViewer.getByRole("button", { name: "作品操作", exact: true }).click();
    await expect(receivedViewer.getByRole("button", { name: "作品详情", exact: true })).toBeVisible();
    await expect(receivedViewer.getByRole("button", { name: "分享到聊天室", exact: true })).toHaveCount(0);
    await expect(receivedViewer.getByRole("button", { name: "删除作品", exact: true })).toHaveCount(0);
    await receivedViewer.getByRole("button", { name: "作品详情", exact: true }).click();
    await expect(receivedViewer.locator(".viewer-details")).toContainText("已公开 · 站内可见");
    expect(pageErrors).toEqual([]);
  } finally { await context.close(); await browser.close(); }
});
