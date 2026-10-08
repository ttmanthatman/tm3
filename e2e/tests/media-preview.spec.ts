import { readFileSync } from "node:fs";
import { expect, test, webkit, type Page } from "@playwright/test";

// A small generated blue portrait stream exercises the real intrinsic size.
const portraitVideo = readFileSync(new URL("../fixtures/portrait.mp4", import.meta.url));

async function mountPreview(page: Page) {
  await page.route("**/media-preview-harness", (route) => route.fulfill({
    contentType: "text/html",
    body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0"><main id="host"></main></body></html>'
  }));
  await page.route("**/portrait.mp4", (route) => route.fulfill({ contentType: "video/mp4", body: portraitVideo }));
  await page.goto("/media-preview-harness");
  await page.evaluate(async () => {
    const componentPath = "/src/client/features/messages/MediaPreviewModal.vue";
    const source = await (await fetch(componentPath)).text();
    const vuePath = /from ["']([^"']*\/vue\.js[^"']*)["']/.exec(source)?.[1];
    if (!vuePath) throw new Error("missing Vue runtime");
    const { createApp, h, ref } = await import(vuePath) as typeof import("vue");
    const { default: MediaPreviewModal } = await import(componentPath);
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "/src/client/styles.css";
    const stylesReady = new Promise<void>((resolve, reject) => {
      css.onload = () => resolve();
      css.onerror = () => reject(new Error("media preview styles failed to load"));
    });
    document.head.append(css);
    await stylesReady;
    const message = {
      id: 1, channelId: 1, type: "file", content: "", fileName: "抄写经文的功能.mp4",
      createdAt: "2026-01-01T00:00:00.000Z",
      sender: { id: 1, kind: "human", username: "harness", displayName: "harness" }
    };
    const events = { closes: 0, downloads: 0, cancels: 0 };
    const transferring = ref(false);
    createApp({ render: () => h(MediaPreviewModal, {
      message, pinnedImage: null, scoreTrack: null, scoreEntry: null, scorePages: [], scorePageIndex: 0,
      fileUrl: () => "/portrait.mp4", imagePreviewTransform: () => ({ transform: "none" }),
      previewImageSrc: () => "/portrait.mp4",
      transfer: transferring.value ? { kind: "preview", label: "正在下载预览", loaded: 128, total: 256, percent: 50 } : null,
      isVideoMessage: () => true, isPdfMessage: () => false,
      imageTouchStart: () => {}, imageTouchMove: () => {}, imageTouchEnd: () => {},
      imagePointerDown: () => {}, imagePointerMove: () => {}, imageWheel: () => {},
      onClose: () => { events.closes++; }, onDownloadFile: () => { events.downloads++; },
      onCancelTransfer: () => { events.cancels++; transferring.value = false; }
    }) }).mount(document.getElementById("host")!);
    Object.assign(window, { mediaPreviewEvents: events, startTransfer: () => { transferring.value = true; } });
  });
  await expect.poll(() => page.locator("video").evaluate((video: HTMLVideoElement) => video.videoHeight)).toBe(780);
}

async function assertPortraitFit(page: Page) {
  await mountPreview(page);
  for (const viewport of [
    { width: 360, height: 780 }, { width: 390, height: 844 },
    { width: 776, height: 1057 }, { width: 1280, height: 800 }
  ]) {
    await page.setViewportSize(viewport);
    for (const safeArea of [false, true]) {
      await page.evaluate((safeArea) => {
        document.documentElement.style.setProperty("--safe-top", safeArea ? "47px" : "0px");
        document.documentElement.style.setProperty("--safe-bottom", safeArea ? "34px" : "0px");
        document.documentElement.style.setProperty("--safe-right", safeArea ? "20px" : "0px");
      }, safeArea);
      const rects = await page.evaluate(() => {
        const rect = (selector: string) => {
          const { top, bottom, left, right, width, height } = document.querySelector(selector)!.getBoundingClientRect();
          return { top, bottom, left, right, width, height };
        };
        return { modal: rect(".media-preview-modal"), title: rect(".modal-head strong"), body: rect(".media-preview-body"),
          video: rect("video"), close: rect(".preview-close"), download: rect(".preview-download") };
      });
      expect(rects.video.top).toBeGreaterThanOrEqual(rects.body.top + 9);
      expect(rects.video.bottom).toBeLessThanOrEqual(rects.body.bottom - 9);
      expect(rects.video.left).toBeGreaterThanOrEqual(rects.body.left + 9);
      expect(rects.video.right).toBeLessThanOrEqual(rects.body.right - 9);
      expect(rects.video.height).toBeGreaterThan(200);
      expect(rects.modal.bottom).toBeLessThanOrEqual(viewport.height - (safeArea ? 34 : 0));
      expect(rects.modal.top).toBeGreaterThanOrEqual(safeArea ? 47 : 0);
      expect(rects.download.top).toBe(rects.close.top);
      expect(rects.close.left - rects.download.right).toBe(10);
      expect(rects.close.right).toBeLessThanOrEqual(viewport.width - (safeArea ? 20 : 0));
      expect(rects.download.top).toBeGreaterThanOrEqual(safeArea ? 47 : 0);
      expect(rects.title.right).toBeLessThanOrEqual(rects.download.left);
      expect(await page.locator("video").evaluate((video) => getComputedStyle(video).objectFit)).toBe("contain");
      if (viewport.width === 776 && !safeArea) {
        await page.screenshot({ path: `output/e2e/media-preview-${page.context().browser()!.browserType().name()}-776.png` });
      }
    }
  }
  await page.getByRole("button", { name: "下载", exact: true }).click();
  await page.evaluate(() => (window as unknown as { startTransfer: () => void }).startTransfer());
  await expect(page.locator(".media-transfer-overlay")).toBeVisible();
  await expect(page.getByRole("button", { name: "下载", exact: true })).toBeDisabled();
  const transferRects = await page.locator(".media-preview-body").evaluate((body) => {
    const rect = body.getBoundingClientRect();
    const overlay = body.querySelector(".media-transfer-overlay")!.getBoundingClientRect();
    return { body: { top: rect.top, bottom: rect.bottom }, overlay: { top: overlay.top, bottom: overlay.bottom } };
  });
  expect(transferRects.overlay).toEqual(transferRects.body);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.locator("video")).toBeVisible();
  await page.getByRole("button", { name: "关闭预览" }).click();
  expect(await page.evaluate(() => (window as unknown as { mediaPreviewEvents: { closes: number; downloads: number; cancels: number } }).mediaPreviewEvents))
    .toEqual({ closes: 1, downloads: 1, cancels: 1 });
}

test("portrait videos fit the preview body and download sits beside close at every viewport", async ({ page }) => {
  await assertPortraitFit(page);
});

test("WebKit keeps portrait video and preview controls within the viewport", async ({ baseURL }) => {
  const browser = await webkit.launch();
  try {
    const context = await browser.newContext({ baseURL, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    const supportsMp4 = await page.evaluate(() => document.createElement("video").canPlayType('video/mp4; codecs="avc1.42E01E"') !== "");
    test.skip(!supportsMp4, "This WebKit runtime does not support H.264 MP4");
    await assertPortraitFit(page);
  } finally {
    await browser.close();
  }
});
