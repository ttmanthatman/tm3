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
    const hostname = new URL(route.request().url()).hostname;
    if (hostname === "127.0.0.1" || hostname === "localhost") await route.continue();
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

test("iPhone 点按可恢复控制栏并弹出同页 EPUB 脚注", async ({ browser, request }) => {
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

    // 先模拟一次拖动留下点击抑制，再立刻执行真实触摸点按；新触摸必须清掉旧窗口。
    await frame.locator("#tap-target").evaluate((target) => {
      const touch = (clientY: number) => new Touch({ identifier: 1, target, clientX: 120, clientY });
      target.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, touches: [touch(320)] }));
      target.dispatchEvent(new TouchEvent("touchmove", { bubbles: true, cancelable: true, touches: [touch(260)] }));
      target.dispatchEvent(new TouchEvent("touchend", { bubbles: true, changedTouches: [touch(260)] }));
    });
    const paragraphBox = await frame.locator("#tap-target").boundingBox();
    if (!paragraphBox) throw new Error("正文点按区域不可见");
    await page.touchscreen.tap(paragraphBox.x + paragraphBox.width / 2, paragraphBox.y + paragraphBox.height / 2);
    await expect(topBar).not.toHaveClass(/bar-hidden/);
    await expect(page.locator(".book-bottom")).not.toHaveClass(/bar-hidden/);

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
