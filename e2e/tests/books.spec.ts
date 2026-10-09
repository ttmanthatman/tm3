import { devices, expect, test, type Frame, type Page } from "@playwright/test";
import JSZip from "jszip";
import { randomUUID } from "node:crypto";
import { io } from "socket.io-client";
import { E2E_ADMIN, E2E_CHANNELS } from "../seed-data.js";

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

const OPF = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:e2e:mobile-reader</dc:identifier>
    <dc:title>移动阅读回归</dc:title>
    <dc:creator>测试作者</dc:creator>
    <dc:language>zh</dc:language>
  </metadata>
  <manifest><item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/><item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/></manifest>
  <spine><itemref idref="ch1"/></spine>
</package>`;

const CHAPTER = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>第一章</title></head>
  <body>
    <h1>第一章</h1>
    <p id="tap-target">这是用于验证手机点按控制栏的正文。</p>
    <p>这里有一个脚注<a id="fnref" epub:type="noteref" href="#fn1">1</a>。</p>
    <div style="height: 1800px"></div>
    <aside id="fn1" epub:type="footnote"><p>《大离婚》同类 EPUB 脚注内容。</p><a epub:type="backlink" href="#fnref">返回</a></aside>
  </body>
</html>`;

async function buildEpub(title = "移动阅读回归") {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file("META-INF/container.xml", CONTAINER);
  zip.file("OEBPS/content.opf", OPF.replace("<dc:title>移动阅读回归</dc:title>", `<dc:title>${title}</dc:title>`));
  zip.file("OEBPS/cover.png", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII=", "base64"));
  zip.file("OEBPS/ch1.xhtml", CHAPTER);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

async function blockPublicNetwork(page: Page) {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === "blob:" || url.protocol === "data:" || url.hostname === "127.0.0.1" || url.hostname === "localhost") await route.continue();
    else await route.abort("blockedbyclient");
  });
}

async function login(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("用户名").fill(E2E_ADMIN.username);
  await page.getByPlaceholder("密码").fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
}

test("书架共读按钮对齐、邀请包含已有进度、读者名称和头像显示在阅读栏下", async ({ page, request }) => {
  const auth = await request.post("/api/auth/login", { data: E2E_ADMIN });
  const headers = { Authorization: `Bearer ${(await auth.json()).token}` };
  const books: Array<{ id: number; title: string }> = [];
  const username = `book-reader-${randomUUID().slice(0, 8)}`;
  let readerId = 0;
  const socket = io("http://127.0.0.1:3003", { autoConnect: false });
  try {
    for (const title of ["短书名", "用于验证多行图书名称以及邀请按钮行内对齐的较长书名"]) {
      const upload = await request.post("/api/admin/books", { headers, multipart: { file: { name: "shelf.epub", mimeType: "application/epub+zip", buffer: await buildEpub(title) } } });
      expect(upload.ok()).toBe(true); books.push((await upload.json()).book);
    }
    await request.put(`/api/books/${books[0].id}/progress`, { headers, data: { fraction: .61 } });
    const created = await request.post("/api/admin/accounts", { headers, data: { username, password: "BookReaderTest123!", displayName: "同读的朋友" } });
    expect(created.ok()).toBe(true);
    const readerAuth = await request.post("/api/auth/login", { data: { username, password: "BookReaderTest123!" } });
    const reader = await readerAuth.json() as { token: string; account: { id: number } };
    readerId = reader.account.id;
    socket.auth = { token: reader.token };
    await new Promise<void>((resolve, reject) => { socket.once("session:ready", resolve); socket.once("connect_error", reject); socket.connect(); });
    socket.emit("book:reading", { active: true, bookTitle: books[0].title });
    await blockPublicNetwork(page);
    await login(page);
    headers.Authorization = `Bearer ${await page.evaluate(() => localStorage.getItem("team-chat-token"))}`;
    await page.getByRole("button", { name: "打开图书室" }).click();
    await expect(page.locator(".book-shelf-invite")).toHaveCount(2);
    for (const width of [360, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const buttons = await page.locator(".book-shelf-invite").evaluateAll((items) => items.map((item) => item.getBoundingClientRect().top));
      expect(Math.abs(buttons[0] - buttons[1])).toBeLessThan(1);
    }
    await page.getByRole("button", { name: "邀请共读《短书名》" }).click();
    const invitation = page.getByRole("dialog", { name: "邀请大家一起读" });
    await expect(invitation).toContainText("61%");
    await invitation.getByRole("button", { name: "关闭" }).click();
    await page.getByRole("button", { name: "下载《短书名》" }).click();
    await page.getByRole("button", { name: "阅读《短书名》" }).click();
    const frame = await readingFrame(page);
    await expect(frame.locator("#tap-target")).toBeVisible();
    await expect(page.getByText("正在打开…", { exact: true })).toHaveCount(0);
    const continuous = page.locator("[data-continuous-reader]");
    await expect.poll(() => continuous.evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
    // Restoring 61% opens mid-chapter; scrolling back to the first paragraph shows the reading bar.
    await frame.locator("#tap-target").scrollIntoViewIfNeeded();
    await expect(page.locator(".book-top")).not.toHaveClass(/bar-hidden/);
    await expect(page.getByLabel("正在共读")).toContainText("同读的朋友");
    await expect(page.locator(".book-reader-avatar")).toBeVisible();
  } finally {
    socket.disconnect();
    for (const book of books) await request.delete(`/api/admin/books/${book.id}`, { headers });
    if (readerId) await request.delete(`/api/admin/accounts/${readerId}`, { headers });
  }
});


test("iPhone 滚动控制栏、滚动边距和同页 EPUB 脚注可用", async ({ browser, request }) => {
  test.setTimeout(60_000);
  const loginResponse = await request.post("/api/auth/login", { data: E2E_ADMIN });
  expect(loginResponse.ok()).toBe(true);
  const { token } = await loginResponse.json() as { token: string };
  const uploadResponse = await request.post("/api/admin/books", {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      file: {
        name: "mobile-reader.epub",
        mimeType: "application/epub+zip",
        buffer: await buildEpub()
      }
    }
  });
  expect(uploadResponse.ok()).toBe(true);
  const { book } = await uploadResponse.json() as { book: { id: number } };

  const context = await browser.newContext({
    ...devices["iPhone 13"],
    serviceWorkers: "allow"
  });
  const page = await context.newPage();
  await blockPublicNetwork(page);
  try {
    await login(page);
    await page.getByRole("button", { name: "打开图书室" }).click();
    const download = page.getByRole("button", { name: "下载《移动阅读回归》" });
    await expect(download).toBeVisible();
    await download.click();
    const read = page.getByRole("button", { name: "阅读《移动阅读回归》" });
    await expect(read).toBeVisible();
    await read.click();

    const frame = page.frameLocator('iframe[title="电子书第 1 节"]');
    await expect(frame.locator("#tap-target")).toBeVisible();
    await expect(page.getByText("正在打开…", { exact: true })).toHaveCount(0);
    const topBar = page.locator(".book-top");
    await expect(topBar).toHaveClass(/bar-hidden/);

    // 真机 Safari 的可靠信号是外层原生滚动容器的 scrollTop，而不是 iframe
    // 文档里人工派发的 touchmove。先向下滚，再向上滚，后者必须显示控制栏。
    const continuous = page.locator("[data-continuous-reader]");
    const scrollTo = (top: number) => continuous.evaluate(async (element, nextTop) => {
      element.scrollTop = nextTop;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    }, top);
    await expect.poll(() => continuous.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    await scrollTo(240);
    await expect.poll(() => continuous.evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
    await scrollTo(80);
    await expect.poll(() => continuous.evaluate((element) => element.scrollTop)).toBeLessThan(100);
    await expect(topBar).not.toHaveClass(/bar-hidden/);
    await expect(page.locator(".book-bottom")).not.toHaveClass(/bar-hidden/);

    await page.getByRole("button", { name: "Aa 阅读设置" }).click();
    const marginValue = page.locator(".book-settings .book-font-pct").nth(2);
    await expect(marginValue).toHaveText("16");
    await expect.poll(() => frame.locator("html").evaluate((element) => getComputedStyle(element).paddingLeft)).toBe("16px");
    const initialTextX = (await frame.locator("#tap-target").boundingBox())?.x;
    expect(initialTextX).toBeDefined();
    await page.getByRole("button", { name: "增大边距" }).click();
    await expect(marginValue).toHaveText("32");
    await expect.poll(() => frame.locator("html").evaluate((element) => getComputedStyle(element).paddingLeft)).toBe("32px");
    await expect.poll(async () => (await frame.locator("#tap-target").boundingBox())?.x ?? 0).toBeGreaterThan(initialTextX! + 12);
    await page.getByRole("button", { name: "Aa 阅读设置" }).click();

    const footnoteBox = await frame.locator("#fnref").boundingBox();
    if (!footnoteBox) throw new Error("脚注链接不可见");
    await page.touchscreen.tap(footnoteBox.x + footnoteBox.width / 2, footnoteBox.y + footnoteBox.height / 2);
    const footnote = page.getByRole("dialog", { name: "脚注" });
    await expect(footnote).toContainText("《大离婚》同类 EPUB 脚注内容。");
    await expect(footnote).not.toContainText("返回");
  } finally {
    await context.close();
    await request.delete(`/api/admin/books/${book.id}`, { headers: { Authorization: `Bearer ${token}` } });
  }
});

test("桌面滚动模式的边距改变正文实际位置", async ({ browser, request }) => {
  const loginResponse = await request.post("/api/auth/login", { data: E2E_ADMIN });
  expect(loginResponse.ok()).toBe(true);
  const { token } = await loginResponse.json() as { token: string };
  const uploadResponse = await request.post("/api/admin/books", {
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      file: {
        name: "desktop-reader-margin.epub",
        mimeType: "application/epub+zip",
        buffer: await buildEpub()
      }
    }
  });
  expect(uploadResponse.ok()).toBe(true);
  const { book } = await uploadResponse.json() as { book: { id: number } };

  const context = await browser.newContext({ viewport: { width: 1037, height: 895 } });
  const page = await context.newPage();
  await blockPublicNetwork(page);
  try {
    await login(page);
    await page.getByRole("button", { name: "打开图书室" }).click();
    await page.getByRole("button", { name: "下载《移动阅读回归》" }).click();
    await page.getByRole("button", { name: "阅读《移动阅读回归》" }).click();
    const frame = page.frameLocator('iframe[title="电子书第 1 节"]');
    const text = frame.locator("#tap-target");
    await expect(text).toBeVisible();
    const initialTextX = (await text.boundingBox())?.x;
    expect(initialTextX).toBeDefined();
    await expect(page.getByText("正在打开…", { exact: true })).toHaveCount(0);
    await text.click(); // 滚动模式默认隐藏控制条，先点正文显示。
    await expect(page.locator(".book-top")).not.toHaveClass(/bar-hidden/);

    await page.getByRole("button", { name: "Aa 阅读设置" }).click();
    await expect(page.locator(".book-settings .book-font-pct").nth(2)).toHaveText("16");
    await page.getByRole("button", { name: "增大边距" }).click();
    await expect(page.locator(".book-settings .book-font-pct").nth(2)).toHaveText("32");
    await expect.poll(async () => (await text.boundingBox())?.x ?? 0).toBeGreaterThan(initialTextX! + 12);
  } finally {
    await context.close();
    await request.delete(`/api/admin/books/${book.id}`, { headers: { Authorization: `Bearer ${token}` } });
  }
});

async function readingFrame(page: Page): Promise<Frame> {
  let match: Frame | undefined;
  await expect.poll(async () => {
    for (const candidate of page.frames()) {
      if (await candidate.locator("#tap-target").count()) { match = candidate; return true; }
    }
    return false;
  }).toBe(true);
  return match!;
}


for (const flow of ["scrolled", "paginated"] as const) {
  test(`阅读摘录笔记、聊天室、故事与共读邀请（${flow}）`, async ({ browser, request }) => {
    test.setTimeout(90_000);
    const auth = await request.post("/api/auth/login", { data: E2E_ADMIN });
    const { token, account } = await auth.json() as { token: string; account: { actorId: number } };
    const headers = { Authorization: `Bearer ${token}` };
    const upload = await request.post("/api/admin/books", { headers, multipart: { file: { name: `reading-actions-${flow}.epub`, mimeType: "application/epub+zip", buffer: await buildEpub() } } });
    expect(upload.ok()).toBe(true);
    const { book } = await upload.json() as { book: { id: number } };
    const context = await browser.newContext(flow === "scrolled" ? { ...devices["iPhone 13"] } : { viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(12_000);
    await blockPublicNetwork(page);
    await page.addInitScript((mode) => localStorage.setItem("book-reader-style", JSON.stringify({ flow: mode })), flow);
    let noteId = "";
    let storyId = 0;
    try {
      await login(page);
      headers.Authorization = `Bearer ${await page.evaluate(() => localStorage.getItem("team-chat-token"))}`;
      await page.getByRole("button", { name: "打开图书室" }).click();
      await page.locator(`[data-book-id="${book.id}"]`).getByRole("button", { name: "邀请共读《移动阅读回归》" }).click();
      const invitation = page.getByRole("dialog", { name: "邀请大家一起读" });
      await expect(invitation).toBeVisible();
      await invitation.getByRole("button", { name: "发送到聊天室", exact: true }).click();
      await expect(invitation).toHaveCount(0);
      await page.locator(".book-topbar").getByRole("button", { name: "关闭" }).click();
      const link = page.locator(`.message-row a[href*="bookId=${book.id}&"]`).last();
      await expect(link).toBeVisible();
      await expect(link.locator('img[alt="《移动阅读回归》封面"]')).toBeVisible();
      await expect(link).toContainText("邀请人已读");
      await link.click();
      await expect(page.locator(".book-invitation-notice")).toContainText("共读邀请");
      await page.locator(`[data-book-id="${book.id}"]`).getByRole("button", { name: "下载《移动阅读回归》" }).click();
      await page.locator(`[data-book-id="${book.id}"]`).getByRole("button", { name: "阅读《移动阅读回归》" }).click();
      let frame = await readingFrame(page);
      await expect(frame.locator("#tap-target")).toBeVisible();
      await expect(page.getByText("正在打开…", { exact: true })).toHaveCount(0);
      if (flow === "paginated") {
        await page.evaluate(() => {
          document.documentElement.style.setProperty("--safe-top", "44px");
          document.documentElement.style.setProperty("--safe-bottom", "34px");
        });
        for (const width of [360, 390, 414, 1280]) {
          await page.setViewportSize({ width, height: 900 });
          const stage = await page.locator(".book-stage").boundingBox();
          expect(stage!.y).toBe(44);
          expect(stage!.y + stage!.height).toBe(866);
          await expect.poll(async () => (await frame.locator("#tap-target").boundingBox())?.y ?? 0).toBeGreaterThanOrEqual(44);
        }
        await page.evaluate(() => {
          document.documentElement.style.removeProperty("--safe-top");
          document.documentElement.style.removeProperty("--safe-bottom");
        });
      }
      const selectText = () => frame.locator("#tap-target").evaluate((element) => {
        const doc = element.ownerDocument;
        const range = doc.createRange(); range.selectNodeContents(element);
        doc.getSelection()?.removeAllRanges(); doc.getSelection()?.addRange(range);
        doc.dispatchEvent(new Event("selectionchange"));
      });
      await selectText();
      const toolbar = page.getByRole("complementary", { name: "摘录操作" });
      await expect(toolbar).toBeVisible();
      expect(await toolbar.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(73, 59, 46)");
      if (flow === "scrolled") {
        for (const width of [360, 390]) {
          await page.setViewportSize({ width, height: 844 });
          const fits = await toolbar.locator("button").evaluateAll((buttons) => buttons.every((button) => {
            const bounds = button.getBoundingClientRect();
            return bounds.left >= 0 && bounds.right <= window.innerWidth && button.scrollWidth <= button.clientWidth;
          }));
          expect(fits).toBe(true);
        }
      }
      await page.screenshot({ path: `output/playwright/book-selection-${flow}.png` });
      await toolbar.getByRole("button", { name: "做笔记" }).click();
      const editor = page.getByRole("dialog", { name: "阅读笔记", exact: true });
      await editor.getByLabel("笔记内容").fill(`摘录笔记 ${flow}`);
      await editor.getByRole("button", { name: "保存笔记" }).click();
      await expect(editor).toHaveCount(0);
      await expect(page.getByText("笔记已保存到我的账号", { exact: true })).toHaveCount(0);
      const response = await request.get(`/api/books/${book.id}/notes`, { headers });
      expect(response.ok()).toBe(true);
      const { notes } = await response.json() as { notes: Array<{ id: string; text: string; quote: string }> };
      expect(notes).toHaveLength(1); noteId = notes[0].id;
      expect(notes[0].text).toBe(`摘录笔记 ${flow}`);
      expect(notes[0].quote).toBe("这是用于验证手机点按控制栏的正文。");
      if (flow === "paginated") await page.setViewportSize({ width: 390, height: 844 });
      await expect(frame.locator(`[data-book-note-id="${noteId}"]`)).toBeVisible();
      await frame.locator(`[data-book-note-id="${noteId}"]`).click();
      await expect(editor.getByLabel("笔记内容")).toHaveValue(`摘录笔记 ${flow}`);
      await editor.getByRole("button", { name: "关闭" }).click();
      if (flow === "paginated") await page.setViewportSize({ width: 1280, height: 900 });
      await selectText();
      await toolbar.getByRole("button", { name: "聊天室", exact: true }).click();
      const share = page.getByRole("dialog", { name: "分享阅读摘录" });
      await expect(share).toContainText(notes[0].quote);
      await share.getByRole("button", { name: "发送到聊天室", exact: true }).click();
      await expect(share).toHaveCount(0);
      await expect(page.getByRole("status").filter({ hasText: "已发送到" })).toHaveCount(0);
      await selectText();
      await toolbar.getByRole("button", { name: "我的故事" }).click();
      const story = page.getByRole("dialog", { name: "留下一段故事" });
      await expect(story.locator(".story-draft-image img")).toBeVisible();
      const publish = page.waitForResponse((res) => res.url().endsWith("/api/stories") && res.request().method() === "POST");
      await story.getByRole("button", { name: "发布故事" }).click();
      const published = await publish;
      expect(published.ok()).toBe(true);
      storyId = (await published.json() as { story: { id: number } }).story.id;
      await expect(story).toHaveCount(0);
      await expect(page.getByRole("status").filter({ hasText: "摘录已发布到我的故事" })).toBeVisible();
      await page.reload();
      await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
      await page.getByRole("button", { name: "打开图书室" }).click();
      frame = await readingFrame(page);
      await expect(frame.locator("#tap-target")).toBeVisible();
      await expect(page.getByText("正在打开…", { exact: true })).toHaveCount(0);
      if (flow === "scrolled") {
        const scroll = page.locator("[data-continuous-reader]");
        for (const top of [120, 20]) {
          await scroll.evaluate(async (el, value) => {
            el.scrollTop = value;
            await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
          }, top);
        }
        await expect(page.locator(".book-bottom")).not.toHaveClass(/bar-hidden/);
      }
      await page.getByRole("button", { name: "我的阅读笔记", exact: true }).click();
      const library = page.getByRole("dialog", { name: "我的阅读笔记" });
      await expect(library).toContainText(`摘录笔记 ${flow}`);
      await page.screenshot({ path: `output/playwright/book-notes-${flow}.png` });
      await library.getByRole("button", { name: "编辑", exact: true }).click();
      await editor.getByLabel("笔记内容").fill(`已修改 ${flow}`);
      await editor.getByRole("button", { name: "保存笔记" }).click();
      await expect(library).toContainText(`已修改 ${flow}`);
      const downloadEvent = page.waitForEvent("download");
      await library.getByRole("button", { name: "导出笔记" }).click();
      const download = await downloadEvent;
      const backupPath = await download.path();
      expect(backupPath).toBeTruthy();
      await request.delete(`/api/books/${book.id}/notes/${noteId}`, { headers });
      await library.locator('input[type="file"]').setInputFiles(backupPath!);
      const importDialog = page.getByRole("dialog", { name: "导入电子书笔记" });
      await importDialog.getByRole("button", { name: "开始导入" }).click();
      await expect(importDialog).toContainText("本次导入 1 条");
      await importDialog.getByRole("button", { name: "完成", exact: true }).click();
      const restored = await (await request.get(`/api/books/${book.id}/notes`, { headers })).json() as { notes: Array<{ id: string; text: string; quote: string }> };
      expect(restored.notes).toHaveLength(1);
      noteId = restored.notes[0].id;
      expect(restored.notes[0].text).toBe(`已修改 ${flow}`);
      await expect(frame.locator(`[data-book-note-id="${noteId}"]`)).toBeVisible();
      await library.getByRole("button", { name: "回到原文" }).click();
      await expect(library).toHaveCount(0);
      const sharedFraction = Number(await page.getByRole("slider", { name: "阅读进度" }).inputValue());
      await page.getByRole("button", { name: "从这里邀请共读" }).click();
      await expect(invitation).toContainText(`${Math.round(sharedFraction * 100)}%`);
      await invitation.getByRole("button", { name: "发送到聊天室", exact: true }).click();
      await expect(invitation).toHaveCount(0);
      await page.locator(".book-top").getByRole("button", { name: "聊天室", exact: true }).click();
      const currentLink = page.locator(`.message-row a[href*="bookId=${book.id}&"]`).last();
      await expect(currentLink).toBeVisible();
      const sharedUrl = new URL((await currentLink.getAttribute("href"))!);
      expect(Number(sharedUrl.searchParams.get("bookFraction"))).toBeCloseTo(sharedFraction, 2);
      await request.put(`/api/books/${book.id}/progress`, { headers, data: { fraction: .9 } });
      await currentLink.click();
      await readingFrame(page);
      await expect(page.getByText("正在打开…", { exact: true })).toHaveCount(0);
      await expect.poll(async () => Math.abs(Number(await page.getByRole("slider", { name: "阅读进度" }).inputValue()) - sharedFraction)).toBeLessThan(.04);
      await page.goto(sharedUrl.href);
      await readingFrame(page);
      await expect(page.getByText("正在打开…", { exact: true })).toHaveCount(0);
      await expect.poll(async () => Math.abs(Number(await page.getByRole("slider", { name: "阅读进度" }).inputValue()) - sharedFraction)).toBeLessThan(.04);
      const ownStories = await request.get(`/api/stories?actorId=${account.actorId}`, { headers });
      expect(await ownStories.text()).toContain(String(storyId));
    } finally {
      if (noteId) await request.delete(`/api/books/${book.id}/notes/${noteId}`, { headers });
      if (storyId) await request.delete(`/api/stories/${storyId}`, { headers });
      await context.close();
      await request.delete(`/api/admin/books/${book.id}`, { headers });
    }
  });
}
