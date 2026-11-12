import { expect, test, webkit, type Page } from "@playwright/test";
import JSZip from "jszip";
import type { BookProgressSnapshot, BookProgressWrite } from "../../src/shared/bookLocator";

const publicationRevision = "a".repeat(64);
const progressKey = "book-progress.v2.7.1";

async function mountReader(page: Page) {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file("META-INF/container.xml", '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file("content.opf", '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">sync-notice</dc:identifier><dc:title>同步提示测试</dc:title><dc:language>zh</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>');
  zip.file("chapter.xhtml", '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title></head><body><p>阅读位置提示应当能够处理，也能暂时关闭。</p><div style="height:2400px"></div></body></html>');
  const epub = await zip.generateAsync({ type: "nodebuffer" });
  const writes: BookProgressWrite[] = [];
  let remote: BookProgressSnapshot = { bookId: 1, publicationRevision, revision: 3, fraction: .8, locator: null, locatorRevision: null };
  let saveRelease: (() => void) | undefined;
  let holdSave = false;
  await page.route("**/book-progress-harness", route => route.fulfill({ contentType: "text/html", body: '<meta name="viewport" content="width=device-width, initial-scale=1"><main id="host"></main>' }));
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/books") {
      await route.fulfill({ json: { books: [{ id: 1, title: "同步提示测试", author: "测试", language: "zh", fileName: "sync.epub", coverName: null, fileSize: epub.length, createdAt: "2026-01-01T00:00:00Z", progress: .1 }] } });
    } else if (url.pathname === "/api/books/1/file") {
      const range = /bytes=(\d*)-(\d*)/.exec(route.request().headers().range ?? "");
      const start = range ? range[1] ? Number(range[1]) : Math.max(0, epub.length - Number(range[2])) : 0;
      const end = range && range[1] && range[2] ? Math.min(Number(range[2]), epub.length - 1) : epub.length - 1;
      await route.fulfill({ status: range ? 206 : 200, contentType: "application/epub+zip", headers: { "Accept-Ranges": "bytes", ...(range ? { "Content-Range": `bytes ${start}-${end}/${epub.length}` } : {}) }, body: epub.subarray(start, end + 1) });
    } else if (url.pathname === "/api/books/1/progress/v2") {
      if (route.request().method() === "PUT") {
        const input = route.request().postDataJSON() as BookProgressWrite;
        writes.push(input);
        if (holdSave) await new Promise<void>(resolve => { saveRelease = resolve; });
        if (input.baseRevision !== remote.revision) {
          await route.fulfill({ status: 409, json: { progress: remote } }); return;
        }
        remote = { ...remote, revision: remote.revision + 1, fraction: input.fraction };
      }
      await route.fulfill({ json: { progress: remote } });
    } else await route.fulfill({ json: { notes: [] } });
  });
  await page.goto("/book-progress-harness");
  await page.evaluate(async key => {
    localStorage.clear();
    localStorage.setItem(key, JSON.stringify({ revision: 0, conflict: true, pending: { fraction: .1, locator: null, baseRevision: 0, mutationId: crypto.randomUUID() } }));
    const source = "/src/client/components/BookWorkspace.vue";
    const compiled = await (await fetch(source)).text();
    const vuePath = /from ["']([^"']*\/vue\.js[^"']*)["']/.exec(compiled)?.[1];
    const storeSource = "/src/client/store.ts";
    const storeCompiled = await (await fetch(storeSource)).text();
    const piniaPath = /from ["']([^"']*\/pinia\.js[^"']*)["']/.exec(storeCompiled)?.[1];
    if (!vuePath || !piniaPath) throw new Error("missing Vue/Pinia runtime");
    const { createApp } = await import(vuePath) as typeof import("vue");
    const { createPinia } = await import(piniaPath) as typeof import("pinia");
    const { useChatStore } = await import(storeSource) as typeof import("../../src/client/store");
    const { default: BookWorkspace } = await import(source) as typeof import("../../src/client/components/BookWorkspace.vue");
    const pinia = createPinia();
    useChatStore(pinia).$patch({ account: { id: 7, username: "reader", displayName: "读者", isAdmin: false, isGuest: false } });
    createApp(BookWorkspace, { initialLocation: { bookId: 1, fraction: .1 } }).use(pinia).mount("#host");
  }, progressKey);
  await expect(page.locator(".book-loading")).toHaveCount(0);
  await expect(page.locator(".book-continuous-frame")).toHaveCount(1);
  await expect(page.locator(".book-sync-notice")).toContainText("另一设备");
  return { writes, hold: () => { holdSave = true; }, release: () => { holdSave = false; saveRelease?.(); } };
}

test("reader conflict buttons dismiss immediately and remote choice remains usable", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const h = await mountReader(page);
  h.hold();
  await page.getByRole("button", { name: "保留本机位置", exact: true }).click();
  await expect(page.locator(".book-sync-notice")).toHaveCount(0);
  await expect.poll(() => h.writes.length).toBe(1);
  h.release();
  await expect.poll(async () => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).pending, progressKey)).toBeUndefined();

  await page.reload();
  await mountReader(page);
  await page.getByRole("button", { name: "使用另一设备位置", exact: true }).click();
  await expect(page.locator(".book-sync-notice")).toHaveCount(0);
  await expect.poll(async () => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).conflict, progressKey)).toBe(false);
});

test("iPhone reader can defer a conflict without overwriting either reading position", async () => {
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ baseURL: test.info().project.use.baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const h = await mountReader(page);
    for (const width of [360, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const bounds = await page.locator(".book-sync-notice").boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    }
    await page.getByRole("button", { name: "稍后处理", exact: true }).tap();
    await expect(page.locator(".book-sync-notice")).toHaveCount(0);
    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), progressKey);
    expect(saved.conflict).toBe(true);
    expect(saved.pending.fraction).toBe(.1);
    expect(h.writes).toHaveLength(0);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "阅读《同步提示测试》", exact: true }).tap();
    await expect(page.locator(".book-loading")).toHaveCount(0);
    await expect(page.locator(".book-sync-notice")).toContainText("另一设备");
  } finally { await browser.close(); }
});
