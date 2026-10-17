import { expect, test, webkit, type Page } from "@playwright/test";
import JSZip from "jszip";
import { E2E_ADMIN, E2E_CHANNELS } from "../seed-data.js";

async function epub() {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file("META-INF/container.xml", '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file("book.opf", '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">typography</dc:identifier><dc:title>排版设置回归</dc:title><dc:language>zh</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>');
  zip.file("chapter.xhtml", `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>排版</title><style>#prose p{font-size:11px!important;line-height:1.1!important}h1{font-size:22px}</style></head><body id="prose"><h1>保留标题层级</h1>${Array.from({ length: 90 }, (_, i) => `<p id="p-${i}" style="font-size:11px!important;line-height:1.1!important">第${i}段。${"这是应当保留的原文，字号行距和边距改变以后仍能继续阅读。".repeat(5)}</p>`).join("")}</body></html>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

async function frameRange(page: Page) {
  return page.locator('iframe[title="电子书第 1 节"]').evaluate(el => {
    const doc = (el as HTMLIFrameElement).contentDocument!, p = doc.querySelector("#p-45")!;
    const range = doc.createRange(); range.setStart(p.firstChild!, 0); range.setEnd(p.firstChild!, 1);
    const css = doc.defaultView!.getComputedStyle(p);
    return { y: el.getBoundingClientRect().top + range.getBoundingClientRect().top, font: parseFloat(css.fontSize), spacing: parseFloat(css.lineHeight), width: p.getBoundingClientRect().width };
  });
}

for (const profile of [{ engine: "chromium", width: 360 }, { engine: "chromium", width: 390 }, { engine: "chromium", width: 1280 }, { engine: "webkit", width: 390 }] as const) {
  test(`reader Aa controls override author CSS and keep source text: ${profile.engine} ${profile.width}`, async ({ browser, request, baseURL }, info) => {
    test.setTimeout(90_000);
    const auth = await request.post("/api/auth/login", { data: E2E_ADMIN });
    const headers = { Authorization: `Bearer ${(await auth.json()).token}` };
    const uploaded = await request.post("/api/admin/books", { headers, multipart: { file: { name: "typography.epub", mimeType: "application/epub+zip", buffer: await epub() } } });
    expect(uploaded.ok()).toBe(true);
    const { book } = await uploaded.json() as { book: { id: number } };
    const webkitBrowser = profile.engine === "webkit" ? await webkit.launch() : null;
    const context = await (webkitBrowser ?? browser).newContext({ baseURL, viewport: { width: profile.width, height: 844 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.route("**/*", route => {
        const url = new URL(route.request().url());
        return ["blob:", "data:"].includes(url.protocol) || url.hostname === "127.0.0.1" ? route.continue() : route.abort();
      });
      await page.goto("/");
      await page.getByPlaceholder("用户名").fill(E2E_ADMIN.username); await page.getByPlaceholder("密码").fill(E2E_ADMIN.password);
      await page.getByRole("button", { name: "登录", exact: true }).click();
      await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
      headers.Authorization = `Bearer ${await page.evaluate(() => localStorage.getItem("team-chat-token"))}`;
      await page.getByRole("button", { name: "打开图书室" }).click();
      const started = Date.now();
      // The first click reads immediately; no complete-file download or second click.
      await page.locator(`[data-book-id="${book.id}"]`).getByRole("button", { name: "阅读《排版设置回归》", exact: true }).click();
      const frame = page.frameLocator('iframe[title="电子书第 1 节"]');
      await expect(frame.locator("#p-45")).toBeAttached();
      await expect(page.getByText("正在打开…", { exact: true })).toHaveCount(0);
      await expect(frame.locator("#p-0")).toBeInViewport();
      const firstTextMs = Date.now() - started;
      await page.locator('[data-continuous-reader]').evaluate(async element => {
        const doc = element.querySelector<HTMLIFrameElement>("iframe")!.contentDocument!;
        const range = doc.createRange(); range.setStart(doc.querySelector("#p-45")!.firstChild!, 0); range.setEnd(doc.querySelector("#p-45")!.firstChild!, 1);
        element.scrollTop = range.getBoundingClientRect().top - element.clientHeight / 3;
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      });
      await frame.locator("#p-45").click({ position: { x: 10, y: 8 } });
      await page.getByRole("button", { name: "Aa 阅读设置" }).click();
      const before = await frameRange(page);
      expect(before.font).toBeCloseTo(16, 1);
      const samples = [];
      for (let i = 0; i < 10; i++) {
        const time = Date.now();
        await page.getByRole("button", { name: "放大字号" }).click();
        await expect.poll(async () => (await frameRange(page)).font).toBeCloseTo(16 * (1.1 + i / 10), 1);
        samples.push(Date.now() - time);
        await expect(page.getByRole("dialog", { name: "阅读设置", exact: true })).toBeVisible();
      }
      const afterFont = await frameRange(page);
      expect(Math.abs(afterFont.y - before.y), JSON.stringify({ before, afterFont })).toBeLessThan(afterFont.spacing + 2);
      for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "增大行距" }).click();
      await expect.poll(async () => (await frameRange(page)).spacing).toBeCloseTo(32 * 2.4, 1);
      await page.getByRole("button", { name: "增大边距" }).click();
      await expect.poll(async () => (await frameRange(page)).width).toBeLessThan(afterFont.width);
      const panel = page.getByRole("dialog", { name: "阅读设置", exact: true });
      const box = (await panel.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(844);
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(profile.width);
      await page.setViewportSize({ width: 844, height: 390 });
      await expect(page.getByRole("button", { name: "关闭阅读设置" })).toBeInViewport();
      await page.setViewportSize({ width: profile.width, height: 844 });
      await expect(frame.locator("#p-45")).toBeInViewport();
      await page.getByRole("button", { name: "关闭阅读设置" }).click();
      await expect(panel).toHaveCount(0);
      await page.getByRole("button", { name: "Aa 阅读设置" }).click();
      await page.getByRole("button", { name: "分页", exact: true }).click();
      await expect(page.locator("foliate-view")).toHaveCount(1);
      await expect(page.getByText("正在打开…", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("status").filter({ hasText: "版本不一致" })).toHaveCount(0);
      await expect(page.getByRole("dialog", { name: "阅读设置", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "滚动", exact: true }).click();
      await expect(page.locator('[data-continuous-reader]')).toHaveCount(1);
      await expect(page.getByText("正在打开…", { exact: true })).toHaveCount(0);
      await expect(frame.locator("#p-45")).toBeInViewport();
      await page.keyboard.press("Escape"); await expect(panel).toHaveCount(0);
      expect(errors).toEqual([]);
      await info.attach("reading-timings", { body: JSON.stringify({ firstTextMs, aaFeedbackMs: samples, viewport: profile }), contentType: "application/json" });
    } finally { await context.close(); await webkitBrowser?.close(); await request.delete(`/api/admin/books/${book.id}`, { headers }); }
  });
}
