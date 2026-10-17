import { bookShelfAction } from "../book-shelf.js";
import { expect, test, webkit, type Page } from "@playwright/test";
import JSZip from "jszip";
import { randomUUID } from "node:crypto";
import { E2E_ADMIN, E2E_CHANNELS } from "../seed-data.js";

// Match the reported book: a share in the middle of a multi-section EPUB,
// headings/background before the quote, and whole chapters on either side.
async function sharedEpub() {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file("META-INF/container.xml", '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  const chapters = Array.from({ length: 28 }, (_, index) => {
    const chapter = String(index + 1).padStart(2, "0");
    const quote = `第${chapter}章分享原句`;
    const html = `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第${chapter}章</title><style>p{margin:18px 0;line-height:1.8}</style></head><body><h1>第${chapter}章</h1><h2>背景</h2><p>${"章节背景与定位上下文。".repeat(30)}</p><h2>译文</h2><p id="shared-quote">${quote}</p>${Array.from({ length: 28 }, () => `<p>${"连续阅读内容。".repeat(12)}</p>`).join("")}</body></html>`;
    zip.file(`chapter-${chapter}.xhtml`, html);
    return { chapter, quote, size: Buffer.byteLength(html) };
  });
  zip.file("content.opf", `<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:share-jump</dc:identifier><dc:title>多章节分享定位回归</dc:title><dc:language>zh</dc:language></metadata><manifest>${chapters.map(c => `<item id="c${c.chapter}" href="chapter-${c.chapter}.xhtml" media-type="application/xhtml+xml"/>`).join("")}</manifest><spine>${chapters.map(c => `<itemref idref="c${c.chapter}"/>`).join("")}</spine></package>`);
  const total = chapters.reduce((sum, chapter) => sum + chapter.size, 0);
  const target = chapters[20];
  const fraction = (chapters.slice(0, 20).reduce((sum, chapter) => sum + chapter.size, 0) + target.size * .2) / total;
  return { buffer: await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }), fraction, quote: target.quote };
}

async function quoteY(page: Page) {
  return page.locator('iframe[title="电子书第 21 节"]').evaluate(frame => {
    const doc = (frame as HTMLIFrameElement).contentDocument!;
    return frame.getBoundingClientRect().top + doc.querySelector("#shared-quote")!.getBoundingClientRect().top;
  });
}

async function verifyWheel(page: Page, delta: number) {
  const before = await quoteY(page);
  const box = await page.frameLocator('iframe[title="电子书第 21 节"]').locator("#shared-quote").boundingBox();
  expect(box).not.toBeNull();
  // Wheel on iframe text, not the outer scroller's margin.
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.wheel(0, delta);
  await expect.poll(async () => before - await quoteY(page)).toBeCloseTo(delta, 0);
  await page.waitForTimeout(400); // include deferred neighboring-section commits
  expect(before - await quoteY(page)).toBeCloseTo(delta, 0);
}

for (const profile of [{ engine: "chromium", width: 994 }, { engine: "chromium", width: 1280 }, { engine: "chromium", width: 390 }, { engine: "webkit", width: 360 }] as const) {
  test(`real EPUB shares retain the quote across native iframe wheel input: ${profile.engine} ${profile.width}px`, async ({ browser, request, baseURL }) => {
    test.setTimeout(90_000);
    const fixture = await sharedEpub();
    const auth = await request.post("/api/auth/login", { data: E2E_ADMIN });
    expect(auth.ok()).toBe(true);
    const headers = { Authorization: `Bearer ${(await auth.json()).token}` };
    const uploaded = await request.post("/api/admin/books", { headers, multipart: { file: { name: "share-jump.epub", mimeType: "application/epub+zip", buffer: fixture.buffer } } });
    expect(uploaded.ok()).toBe(true);
    const { book } = await uploaded.json() as { book: { id: number; title: string } };
    const webkitBrowser = profile.engine === "webkit" ? await webkit.launch() : null;
    const context = await (webkitBrowser ?? browser).newContext({ baseURL, viewport: { width: profile.width, height: 844 } });
    const page = await context.newPage();
    try {
      await page.route("**/*", route => {
        const url = new URL(route.request().url());
        return ["blob:", "data:"].includes(url.protocol) || ["127.0.0.1", "localhost"].includes(url.hostname) ? route.continue() : route.abort("blockedbyclient");
      });
      await page.goto("/");
      await page.getByPlaceholder("用户名").fill(E2E_ADMIN.username);
      await page.getByPlaceholder("密码").fill(E2E_ADMIN.password);
      await page.getByRole("button", { name: "登录", exact: true }).click();
      await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
      headers.Authorization = `Bearer ${await page.evaluate(() => localStorage.getItem("team-chat-token"))}`;
      const channelResponse = await request.get("/api/channels", { headers });
      const { channels } = await channelResponse.json() as { channels: Array<{ id: number; name: string }> };
      const channelId = channels.find(channel => channel.name === E2E_CHANNELS.default)!.id;
      const url = `${baseURL}/?bookId=${book.id}&bookFraction=${fixture.fraction}`;
      const now = new Date().toISOString();
      for (const kind of ["note", "excerpt"] as const) {
        const message = await request.post("/api/messages", { headers, data: { channelId, type: "text", content: kind === "note" ? "多章节笔记定位" : `摘录自《${book.title}》<br>“${fixture.quote}”<br><a href="${url}">打开书中的位置：第21章 · 72%</a>`, ...(kind === "note" ? { payload: { kind: "book_note", note: { id: randomUUID(), bookId: book.id, bookTitle: book.title, quote: fixture.quote, text: "原文定位笔记", chapter: "第21章", fraction: fixture.fraction, createdAt: now, updatedAt: now } } } : {}) } });
        expect(message.ok()).toBe(true);
      }
      await page.getByRole("button", { name: "打开图书室" }).click();
      await bookShelfAction(page, book.title, "下载", book.id);
      await expect(page.getByRole("button", { name: `阅读《${book.title}》`, exact: true })).toBeVisible();
      await page.locator(".book-topbar").getByRole("button", { name: "关闭", exact: true }).click();
      for (const kind of ["note", "excerpt"] as const) {
        const card = page.locator(kind === "note" ? ".book-note-share-card" : ".reading-share-book:not(.book-note-share-card)").filter({ hasText: book.title }).last();
        await expect(card).toContainText(fixture.quote);
        await card.getByRole("link", { name: "跳转到原书位置" }).click();
        const target = page.frameLocator('iframe[title="电子书第 21 节"]').locator("#shared-quote");
        await expect(target).toBeInViewport();
        await expect(page.getByText("正在打开…", { exact: true })).toHaveCount(0);
        await expect(page.frameLocator('iframe[title="电子书第 21 节"]').locator("[data-book-quote-highlight]")).toHaveCount(1);
        const firstY = await quoteY(page);
        expect(firstY).toBeGreaterThan(60);
        expect(firstY).toBeLessThan(500);
        // Opening must survive the asynchronously loaded preceding chapter before
        // the first gesture. The old reader could leave the whole target offscreen.
        await expect(page.locator('iframe[title="电子书第 20 节"]')).toBeVisible();
        await page.waitForTimeout(400);
        expect(await quoteY(page)).toBeCloseTo(firstY, 0);
        await verifyWheel(page, 24);
        await verifyWheel(page, -24);
        await page.getByRole("button", { name: "聊天室", exact: true }).click();
        await expect(card).toBeVisible();
      }
    } finally {
      await context.close();
      await webkitBrowser?.close();
      await request.delete(`/api/admin/books/${book.id}`, { headers });
    }
  });
}
