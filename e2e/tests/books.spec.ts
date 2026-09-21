import { devices, expect, test, type Page } from "@playwright/test";
import JSZip from "jszip";
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
  <manifest><item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest>
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

async function buildEpub() {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file("META-INF/container.xml", CONTAINER);
  zip.file("OEBPS/content.opf", OPF);
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
    await page.getByRole("button", { name: "增大边距" }).click();
    await expect(marginValue).toHaveText("32");
    await expect.poll(() => frame.locator("html").evaluate((element) => getComputedStyle(element).paddingLeft)).toBe("32px");
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
