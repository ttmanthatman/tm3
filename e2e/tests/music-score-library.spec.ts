import { readFile } from "node:fs/promises";
import { expect, test, webkit, type Locator, type Page } from "@playwright/test";
import JSZip from "jszip";
import sharp from "sharp";
import type { MusicScoreDTO } from "../../src/shared/types.js";

test.use({ serviceWorkers: "block" });
test.setTimeout(60_000);

// Keep these fixtures local to this suite: no shared accounts, music seed or external network.
const png = sharp({ create: { width: 800, height: 1120, channels: 3, background: "#f4efdd" } }).png().toBuffer();
function twoPagePdf() {
  const stream = (text: string) => `BT /F1 24 Tf 48 760 Td (${text}) Tj ET\n48 720 m 550 720 l S\n`;
  const first = stream("Score fixture page one");
  const second = stream("Score fixture page two");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [4 0 R 6 0 R] /Count 2 >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 840] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>",
    `<< /Length ${Buffer.byteLength(first)} >>\nstream\n${first}endstream`,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 840] /Resources << /Font << /F1 3 0 R >> >> /Contents 7 0 R >>",
    `<< /Length ${Buffer.byteLength(second)} >>\nstream\n${second}endstream`
  ];
  let text = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(text));
    text += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(text);
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  text += offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(text);
}
const pdf = twoPagePdf();
const scores: (MusicScoreDTO & { trackId: number | null; trackTitle: string })[] = [
  { id: 501, title: "Screenshot_20260817_191825", kind: "image", trackId: 51, trackTitle: "平安之歌", pages: [
    { id: 5011, scoreId: 501, pageIndex: 0, fileName: "平安第1页.png", fileSize: 1200, width: 800, height: 1120 },
    { id: 5012, scoreId: 501, pageIndex: 1, fileName: "平安第2页.png", fileSize: 1200, width: 800, height: 1120 }
  ] },
  { id: 502, title: "盼望 · 钢琴谱", kind: "pdf", trackId: null, trackTitle: "", pages: [
    { id: 5021, scoreId: 502, pageIndex: 0, fileName: "盼望钢琴谱.pdf", fileSize: pdf.length, width: 0, height: 0 }
  ] },
  { id: 503, title: "恩典 · 单页简谱", kind: "image", trackId: 53, trackTitle: "奇异恩典", pages: [
    { id: 5031, scoreId: 503, pageIndex: 0, fileName: "恩典单页.png", fileSize: 1200, width: 800, height: 1120 }
  ] }
];

async function mountLibrary(page: Page, options: { failList?: boolean; failShare?: boolean; failScoreId?: number } = {}) {
  const state = { failList: !!options.failList, failShare: !!options.failShare, failScoreId: options.failScoreId, listReads: 0, shares: [] as { scoreId: number; channelId: number; clientRequestId: string }[] };
  await page.route("**/api/music/scores", route => {
    state.listReads++;
    return state.failList
      ? route.fulfill({ status: 400, json: { message: "歌谱列表暂时不可用" } })
      : route.fulfill({ json: { scores } });
  });
  await page.route("**/api/music/scores/*/pages/*", async route => {
    const isPdf = new URL(route.request().url()).pathname.endsWith("/5021");
    await route.fulfill({ contentType: isPdf ? "application/pdf" : "image/png", body: isPdf ? pdf : await png });
  });
  await page.route("**/api/channels", route => route.fulfill({ json: { channels: [
    { id: 11, name: "当前测试频道", kind: "standard", canWrite: true, isPrivate: false, isDefault: true, description: "", icon: "", memberCount: 1, lastMessageId: null },
    { id: 22, name: "诗歌练习频道", kind: "standard", canWrite: true, isPrivate: false, isDefault: false, description: "", icon: "", memberCount: 1, lastMessageId: null },
    { id: 33, name: "只读公告频道", kind: "standard", canWrite: false, isPrivate: false, isDefault: false, description: "", icon: "", memberCount: 1, lastMessageId: null }
  ] } }));
  await page.route("**/api/music/scores/*/share", async route => {
    const body = route.request().postDataJSON() as { channelId: number; clientRequestId: string };
    state.shares.push({ scoreId: Number(new URL(route.request().url()).pathname.split("/").at(-2)), ...body });
    if (state.failShare || state.failScoreId === state.shares.at(-1)?.scoreId) await route.fulfill({ status: 503, json: { message: "分享暂时失败，请重试" } });
    else await route.fulfill({ json: { success: true } });
  });
  await page.route("**/music-score-library-harness", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><main id="host"></main>' }));
  await page.goto("/music-score-library-harness");
  await page.evaluate(async () => {
    const path = "/src/client/features/music/MusicScoreLibrary.vue";
    const source = await (await fetch(path)).text();
    const vuePath = /from ["']([^"']*\/vue\.js[^"']*)["']/.exec(source)?.[1];
    if (!vuePath) throw new Error("missing Vue runtime");
    const { createApp, h, ref } = await import(vuePath) as typeof import("vue");
    const { default: Library } = await import(path);
    const css = document.createElement("link"); css.rel = "stylesheet"; css.href = "/src/client/styles.css";
    const stylesReady = new Promise<void>((resolve, reject) => { css.onload = () => resolve(); css.onerror = () => reject(new Error("score styles failed")); });
    document.head.append(css); await stylesReady;
    localStorage.setItem("team-chat-token", "score-harness-token");
    const open = ref(true);
    createApp({ render: () => h("div", {}, [
      h("button", { onClick: () => { open.value = true; } }, "打开测试歌谱"),
      open.value ? h(Library, { currentChannelId: 11, onClose: () => { open.value = false; } }) : null
    ]) }).mount(document.getElementById("host")!);
  });
  await expect(page.getByRole("dialog", { name: "歌谱", exact: true })).toBeVisible();
  return state;
}

const songTitle = (score: typeof scores[number]) => score.trackTitle || score.title;
const library = (page: Page) => page.getByRole("dialog", { name: "歌谱", exact: true });
const preview = (page: Page, title: string) => page.getByRole("dialog", { name: title, exact: true });
async function openScore(page: Page, index: number) {
  await library(page).getByRole("button", { name: new RegExp(songTitle(scores[index])) }).click();
  const dialog = preview(page, songTitle(scores[index]));
  await expect(dialog.locator(".music-score-preview-stage")).toHaveAttribute("data-scale", "1");
  if (scores[index].kind === "pdf") await expect(dialog.locator(".music-score-preview-canvas")).toBeVisible();
  else await expect.poll(() => dialog.locator(".music-score-preview-image").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(dialog.locator(".music-score-preview-stage")).toHaveAttribute("aria-busy", "false");
  return dialog;
}
async function expectReset(dialog: Locator) {
  const stage = dialog.locator(".music-score-preview-stage");
  await expect(stage).toHaveAttribute("data-scale", "1");
  await expect(stage).toHaveAttribute("data-offset-x", "0");
  await expect(stage).toHaveAttribute("data-offset-y", "0");
}
async function zoomAndPan(page: Page, dialog: Locator) {
  const stage = dialog.locator(".music-score-preview-stage");
  await dialog.getByRole("button", { name: "放大歌谱", exact: true }).click();
  await expect.poll(async () => Number(await stage.getAttribute("data-scale"))).toBeGreaterThan(1);
  const box = (await stage.boundingBox())!;
  await page.mouse.move(box.x + box.width * .4, box.y + box.height * .4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .4 + 40, box.y + box.height * .4 + 50, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Math.abs(Number(await stage.getAttribute("data-offset-x"))) + Math.abs(Number(await stage.getAttribute("data-offset-y")))).toBeGreaterThan(10);
}

async function pinchWithTouch(page: Page, dialog: Locator) {
  // Real Chromium touch input also creates the active pointers required by pointer capture.
  if (page.context().browser()!.browserType().name() !== "chromium") return;
  const stage = dialog.locator(".music-score-preview-stage");
  const box = (await stage.boundingBox())!;
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const before = Number(await stage.getAttribute("data-scale"));
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 2 });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: center.x - 20, y: center.y, id: 1 }, { x: center.x + 20, y: center.y, id: 2 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: center.x - 60, y: center.y, id: 1 }, { x: center.x + 60, y: center.y, id: 2 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(async () => Number(await stage.getAttribute("data-scale"))).toBeGreaterThan(before);
  } finally {
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await cdp.detach();
  }
}

async function checkResponsivePreview(page: Page) {
  await mountLibrary(page);
  for (const width of [360, 390, 1280]) {
    const height = 844;
    await page.setViewportSize({ width, height });
    await page.evaluate((height) => {
      document.documentElement.style.setProperty("--app-height", `${height}px`);
      document.documentElement.style.setProperty("--safe-top", "24px");
      document.documentElement.style.setProperty("--safe-bottom", "20px");
    }, height);
    const dialog = await openScore(page, 0);
    const panel = (await dialog.locator(":scope > div").first().boundingBox())!;
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(width + 1);
    expect(panel.y).toBeGreaterThanOrEqual(24);
    expect(panel.y + panel.height).toBeLessThanOrEqual(height - 20 + 1);
    for (const name of ["关闭歌谱预览", "分享歌谱", "下载歌谱", "放大歌谱", "缩小歌谱", "适合窗口"]) {
      const button = dialog.getByRole("button", { name, exact: true });
      await expect(button).toBeVisible();
      const box = (await button.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      expect(box.y).toBeGreaterThanOrEqual(24); expect(box.y + box.height).toBeLessThanOrEqual(height - 20 + 1);
    }
    await expect(dialog.getByTestId("music-score-page-number")).toContainText("1");
    await zoomAndPan(page, dialog);
    if (width === 390) await pinchWithTouch(page, dialog);
    await dialog.getByRole("button", { name: "适合窗口", exact: true }).click();
    await expectReset(dialog);
    await zoomAndPan(page, dialog);
    await dialog.getByRole("button", { name: "下一页歌谱", exact: true }).click();
    await expect(dialog.locator(".music-score-preview-image")).toHaveAttribute("src", /5012|blob:/);
    await expect(dialog.getByTestId("music-score-page-number")).toContainText("2");
    await expectReset(dialog);
    await dialog.getByRole("button", { name: "上一页歌谱", exact: true }).click();
    await expect(dialog.getByTestId("music-score-page-number")).toContainText("1");
    await expectReset(dialog);
    await page.screenshot({ path: `output/e2e/music-scores-${page.context().browser()!.browserType().name()}-${width}.png` });
    await dialog.getByRole("button", { name: "关闭歌谱预览", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(library(page)).toBeVisible();
  }
  const pdfDialog = await openScore(page, 1);
  await expect(pdfDialog.locator(".music-score-preview-canvas")).toHaveCount(1);
  await expect(pdfDialog.getByTestId("music-score-page-number")).toHaveText(/1\s*\/\s*2/);
  const pdfStage = pdfDialog.locator(".music-score-preview-stage");
  await pdfStage.hover();
  await page.mouse.wheel(0, -100);
  await expect.poll(async () => Number(await pdfStage.getAttribute("data-scale"))).toBeGreaterThan(1);
  const wheelScale = Number(await pdfStage.getAttribute("data-scale"));
  await pdfDialog.getByRole("button", { name: "缩小歌谱", exact: true }).click();
  await expect.poll(async () => Number(await pdfStage.getAttribute("data-scale"))).toBeLessThan(wheelScale);
  await zoomAndPan(page, pdfDialog);
  await pdfDialog.getByRole("button", { name: "下一页歌谱", exact: true }).click();
  await expect(pdfDialog.getByTestId("music-score-page-number")).toHaveText(/2\s*\/\s*2/);
  await expectReset(pdfDialog);
  await page.keyboard.press("Escape");
  await expect(pdfDialog).toBeHidden();
  await expect(library(page)).toBeVisible();
}

test("score images and PDF pages share zoom, pan and reset within narrow and desktop safe areas", async ({ page }) => {
  await checkResponsivePreview(page);
});

test("WebKit keeps score controls usable and resets image and PDF transforms when paging", async ({ baseURL }) => {
  const browser = await webkit.launch();
  try {
    const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
    await checkResponsivePreview(await context.newPage());
  } finally { await browser.close(); }
});

test("score search filters locally, distinguishes no matches and recovers from list errors", async ({ page }) => {
  const state = await mountLibrary(page, { failList: true });
  await expect(library(page).getByText("歌谱列表暂时不可用", { exact: false })).toBeVisible();
  state.failList = false;
  await library(page).getByRole("button", { name: "重新加载歌谱", exact: true }).click();
  await expect(library(page).getByRole("button", { name: /平安之歌/ })).toBeVisible();
  const reads = state.listReads;
  const search = library(page).getByRole("searchbox", { name: "搜索歌谱", exact: true });
  await search.fill("奇异恩典");
  await expect(library(page).getByRole("button", { name: /奇异恩典/ })).toBeVisible();
  await expect(library(page).getByRole("button", { name: /平安之歌/ })).toHaveCount(0);
  await search.fill("钢琴");
  await expect(library(page).getByRole("button", { name: /盼望 · 钢琴谱/ })).toBeVisible();
  await search.fill("不存在的歌谱");
  await expect(library(page).getByText(/没有.*歌谱|未找到.*歌谱|暂无.*歌谱/)).toBeVisible();
  await search.fill("");
  for (const score of scores) await expect(library(page).getByRole("button", { name: new RegExp(songTitle(score)) })).toBeVisible();
  expect(state.listReads).toBe(reads);
  await library(page).getByRole("button", { name: "关闭", exact: true }).click();
  await expect(library(page)).toBeHidden();
});

test("sharing chooses a writable channel and retries the same request without closing the preview", async ({ page }) => {
  const state = await mountLibrary(page, { failShare: true });
  const dialog = await openScore(page, 0);
  await dialog.getByRole("button", { name: "分享歌谱", exact: true }).click();
  const share = page.getByRole("dialog", { name: "分享歌谱", exact: true });
  await expect(share).toBeVisible();
  const channel = share.getByRole("combobox", { name: "选择接收歌谱的频道", exact: true });
  await expect(channel).toHaveValue("11");
  await expect(channel.locator('option[value="33"]')).toHaveCount(0);
  await channel.selectOption("22");
  await share.getByRole("button", { name: "分享", exact: true }).click();
  await expect(share.getByText("分享暂时失败，请重试", { exact: false })).toBeVisible();
  expect(state.shares).toHaveLength(1);
  expect(state.shares[0]).toMatchObject({ scoreId: 501, channelId: 22, clientRequestId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  await expect(channel).toBeDisabled();
  state.failShare = false;
  await share.getByRole("button", { name: "重试分享", exact: true }).click();
  await expect(share.getByRole("status")).toHaveText("已分享到“诗歌练习频道”");
  expect(state.shares).toHaveLength(2);
  expect(state.shares[1]).toEqual(state.shares[0]);
  await expect(share.getByRole("button", { name: "已分享", exact: true })).toBeDisabled();
  await share.getByRole("button", { name: "完成", exact: true }).click();
  await expect(share).toBeHidden();
  await expect(dialog).toBeVisible();
});

test("downloads retain the original single image and PDF and package every image page in a ZIP", async ({ page }) => {
  await mountLibrary(page);
  for (const index of [2, 1, 0]) {
    const dialog = await openScore(page, index);
    const event = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "下载歌谱", exact: true }).click();
    const download = await event;
    const path = await download.path();
    expect(path).not.toBeNull();
    const content = await readFile(path!);
    if (index === 0) {
      expect(download.suggestedFilename()).toMatch(/\.zip$/i);
      const zip = await JSZip.loadAsync(content);
      const entries = Object.values(zip.files).filter(entry => !entry.dir);
      expect(entries).toHaveLength(2);
      for (const entry of entries) expect(await entry.async("nodebuffer")).toEqual(await png);
    } else {
      expect(download.suggestedFilename()).toBe(scores[index].pages[0].fileName);
      expect(content).toEqual(index === 1 ? pdf : await png);
    }
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "关闭歌谱预览", exact: true }).click();
  }
});

test("song names replace file titles; selections survive search and share retries skip completed scores", async ({ page }) => {
  await page.setViewportSize({ width: 696, height: 1033 });
  const state = await mountLibrary(page, { failScoreId: 503 });
  await expect(library(page)).not.toContainText("Screenshot_");
  await expect(library(page)).not.toContainText("预览歌谱");
  await expect(library(page).locator(".score-library-item small")).toHaveCount(0);
  await library(page).getByRole("checkbox", { name: "选择《平安之歌》歌谱", exact: true }).check();
  await library(page).getByRole("searchbox").fill("奇异恩典");
  await library(page).getByRole("checkbox", { name: "选择《奇异恩典》歌谱", exact: true }).check();
  await expect(library(page)).toContainText("已选 2 份");
  await library(page).getByRole("button", { name: "分享所选", exact: true }).click();
  const share = page.getByRole("dialog", { name: "分享歌谱", exact: true });
  expect((await share.locator(".small-modal").boundingBox())!.width).toBeLessThanOrEqual(420);
  await share.screenshot({ path: "output/e2e/music-score-share-compact.png" });
  await share.getByRole("button", { name: "分享", exact: true }).click();
  await expect(share.getByRole("status")).toContainText("已分享 1/2 份");
  expect(state.shares.map(item => item.scoreId)).toEqual([501, 503]);
  state.failScoreId = undefined;
  await share.getByRole("button", { name: "重试分享", exact: true }).click();
  await expect(share.getByRole("status")).toHaveText("已分享到“当前测试频道”");
  expect(state.shares.map(item => item.scoreId)).toEqual([501, 503, 503]);
  expect(state.shares[2]).toEqual(state.shares[1]);
  await share.getByRole("button", { name: "完成", exact: true }).click();
  for (const width of [360, 390, 1280]) {
    await page.setViewportSize({ width, height: 700 });
    const panel = (await library(page).locator(".music-score-library").boundingBox())!;
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(width);
    const selection = library(page).locator(".score-library-selection");
    expect(await selection.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await expect(selection.getByRole("button", { name: "分享所选", exact: true })).toBeInViewport();
  }
  const downloadEvent = page.waitForEvent("download");
  await library(page).getByRole("button", { name: "下载所选", exact: true }).click();
  const download = await downloadEvent;
  const zip = await JSZip.loadAsync(await readFile((await download.path())!));
  const files = Object.values(zip.files).filter(entry => !entry.dir);
  expect(files).toHaveLength(3);
  expect(files.filter(entry => entry.name.includes("平安之歌/"))).toHaveLength(2);
  expect(files.filter(entry => entry.name.includes("奇异恩典/"))).toHaveLength(1);
  for (const file of files) expect(await file.async("nodebuffer")).toEqual(await png);
  await library(page).getByRole("searchbox").fill("");
  await library(page).getByRole("button", { name: "取消选择", exact: true }).click();
  await expect(library(page).getByRole("checkbox", { checked: true })).toHaveCount(0);
  await page.screenshot({ path: "output/e2e/music-score-library-song-names.png" });
});

test("the colored score control offers current and other scores with keyboard and outside dismissal", async ({ page }) => {
  await page.route("**/api/music/scores", route => route.fulfill({ json: { scores: [] } }));
  await page.route("**/score-control-harness", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><meta charset="utf-8"><main id="host"></main>' }));
  await page.goto("/score-control-harness");
  await page.evaluate(async () => {
    const path = "/src/client/features/music/MusicScoreControl.vue";
    const source = await (await fetch(path)).text();
    const vuePath = /from ["']([^"']*\/vue\.js[^"']*)["']/.exec(source)![1];
    const { createApp, h, ref } = await import(vuePath) as typeof import("vue");
    const { default: Control } = await import(path);
    const css = document.createElement("link"); css.rel = "stylesheet"; css.href = "/src/client/styles.css"; document.head.append(css);
    const available = ref(true);
    createApp({ render: () => h("div", { style: "padding:40px;display:flex;gap:20px" }, [
      h(Control, { currentScoreAvailable: available.value, currentChannelId: 11, onCurrent: () => { document.body.dataset.currentScore = "opened"; } }),
      h("button", { onClick: () => { available.value = !available.value; } }, "切换歌谱状态")
    ]) }).mount(document.getElementById("host")!);
  });
  const trigger = page.getByRole("button", { name: "打开歌谱菜单", exact: true });
  await expect(trigger).toHaveClass(/has-current-score/);
  await trigger.focus();
  await trigger.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "当前歌谱", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toHaveAttribute("data-current-score", "opened");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await trigger.click();
  await page.locator("body").click({ position: { x: 300, y: 300 } });
  await expect(page.getByRole("menu")).toHaveCount(0);
  await trigger.click();
  await page.getByRole("menuitem", { name: "其他歌谱", exact: true }).click();
  await expect(library(page)).toBeVisible();
  await library(page).getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "切换歌谱状态", exact: true }).click();
  const plain = page.getByRole("button", { name: "打开歌谱库", exact: true });
  await expect(plain).not.toHaveClass(/has-current-score/);
  await plain.click();
  await expect(library(page)).toBeVisible();
});
