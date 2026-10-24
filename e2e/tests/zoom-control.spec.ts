import { expect, test, type Page } from "@playwright/test";
import type { ZoomLiveStatus } from "../../src/shared/zoom.js";

const meetingUrl = "https://zoom.us/j/123456789?pwd=test";
test.use({ hasTouch: true });

async function mountZoom(page: Page, options: { admin?: boolean; active?: boolean; url?: string; failed?: boolean; live?: ZoomLiveStatus } = {}) {
  await page.route("**/api/zoom", route => route.fulfill({
    status: options.failed ? 503 : 200,
    contentType: "application/json",
    body: JSON.stringify(options.failed ? { message: "会议状态加载失败" } : {
      url: options.url ?? meetingUrl,
      meeting: options.active ? { endsAt: new Date(Date.now() + 3_600_000).toISOString(), timeZone: "Asia/Shanghai" } : null,
      ...(options.live ? { live: options.live } : {})
    })
  }));
  // Keep every external navigation inside the fixture; never join a real meeting.
  await page.context().route("https://zoom.us/**", route => route.fulfill({ contentType: "text/html", body: "Zoom fixture" }));
  await page.route("**/zoom-control-harness", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><meta charset="utf-8"><div id="host"></div>' }));
  await page.goto("/zoom-control-harness");
  const loaded = page.waitForResponse(response => response.url().endsWith("/api/zoom"));
  await page.evaluate(async admin => {
    const path = "/src/client/features/zoom/ZoomControl.vue";
    const source = await (await fetch(path)).text();
    const vuePath = /from ["']([^"']*\/vue\.js[^"']*)["']/.exec(source)?.[1];
    if (!vuePath) throw new Error("missing Vue runtime");
    const { createApp, h } = await import(vuePath) as typeof import("vue");
    const { default: Control } = await import(path);
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "/src/client/styles.css";
    document.head.append(css);
    await new Promise<void>((resolve, reject) => { css.onload = () => resolve(); css.onerror = () => reject(new Error("styles failed")); });
    createApp({ render: () => h(Control, { isAdmin: admin }) }).mount(document.getElementById("host")!);
  }, options.admin ?? false);
  await loaded;
  await expect(page.locator(".zoom-header-trigger")).toBeVisible();
  if (options.failed) await expect(page.locator(".zoom-header-trigger")).toHaveAttribute("title", /无法确认/);
  else await expect.poll(() => page.locator(".zoom-header-trigger").getAttribute("title")).not.toContain("加载中");
}

test("automatic status waits for the first event and keeps manual controls out of the admin dialog", async ({ page }) => {
  await mountZoom(page, { admin: true, live: { status: "unknown" } });
  await page.locator(".zoom-header-trigger").click();
  await expect(page.getByRole("dialog", { name: "前往 Zoom", exact: true })).toContainText("暂时无法确认会议状态");
  await expect(page.getByRole("dialog")).not.toContainText("目前还没有会议");
  await page.keyboard.press("Escape");
  await holdZoom(page);
  const settings = page.getByRole("dialog", { name: "Zoom 会议状态", exact: true });
  await expect(settings).toContainText("正在等待 Zoom 的开会或结束通知");
  await expect(settings.getByRole("combobox")).toHaveCount(0);
  await expect(settings.getByRole("button", { name: "确认切换", exact: true })).toHaveCount(0);
});

test("a Zoom start event changes the header and joins directly without a manual deadline", async ({ page }) => {
  await mountZoom(page, { live: { status: "inactive" } });
  await page.locator(".zoom-header-trigger").click();
  await expect(page.getByRole("dialog")).toContainText("目前还没有会议");
  await page.keyboard.press("Escape");
  await page.route("**/api/zoom", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ url: meetingUrl, meeting: null, live: { status: "active", updatedAt: new Date().toISOString() } }) }));
  await page.evaluate(() => window.dispatchEvent(new Event("zoom-settings-changed")));
  await expect(page.locator(".zoom-header-trigger")).toHaveClass(/meeting-active/);
  const popupPromise = page.waitForEvent("popup");
  await page.locator(".zoom-header-trigger").click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(meetingUrl);
  await popup.close();
});

async function holdZoom(page: Page) {
  const box = await page.locator(".zoom-header-trigger").boundingBox();
  if (!box) throw new Error("missing Zoom trigger");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
}

test("only an administrator's long press opens settings and never also joins", async ({ page }) => {
  await mountZoom(page, { admin: true });
  await holdZoom(page);
  await expect(page.getByRole("dialog", { name: "Zoom 会议状态", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  expect(page.context().pages()).toHaveLength(1);
  await page.keyboard.press("Escape");
  await expect(page.locator(".zoom-header-trigger")).toBeFocused();
});

test("a member's long press, context menu and settings keyboard shortcut cannot open settings", async ({ page }) => {
  await mountZoom(page);
  await holdZoom(page);
  await expect(page.getByRole("dialog", { name: "Zoom 会议状态", exact: true })).toHaveCount(0);
  if (await page.getByRole("dialog").count()) await page.keyboard.press("Escape");
  await page.locator(".zoom-header-trigger").click({ button: "right" });
  await page.locator(".zoom-header-trigger").focus();
  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("dialog", { name: "Zoom 会议状态", exact: true })).toHaveCount(0);
});

for (const width of [360, 390, 1280]) {
  test(`inactive meeting asks before opening Zoom at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await mountZoom(page, { admin: true });
    await page.locator(".zoom-header-trigger").click();
    const dialog = page.getByRole("dialog", { name: "前往 Zoom", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("目前还没有会议，但你可以进去开始一个会议，是否确定？");
    expect(page.context().pages()).toHaveLength(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 360 || width === 1280) await dialog.screenshot({ path: test.info().outputPath("zoom-confirmation.png") });
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".zoom-header-trigger")).toBeFocused();
    await page.keyboard.press("Space");
    const popupPromise = page.waitForEvent("popup");
    await page.getByRole("dialog").getByRole("button", { name: "确定", exact: true }).click();
    const popup = await popupPromise;
    await expect(popup).toHaveURL(meetingUrl);
    await popup.close();
  });
}

test("an active meeting opens directly, including keyboard activation", async ({ page }) => {
  await mountZoom(page, { active: true });
  await expect(page.locator(".zoom-header-trigger")).toHaveClass(/meeting-active/);
  await page.locator(".zoom-header-trigger").focus();
  const popupPromise = page.waitForEvent("popup");
  await page.keyboard.press("Enter");
  const popup = await popupPromise;
  await expect(popup).toHaveURL(meetingUrl);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await popup.close();
});

test("a missing link shows a notice without exposing settings to a member", async ({ page }) => {
  await mountZoom(page, { url: "" });
  await page.locator(".zoom-header-trigger").click();
  await expect(page.getByRole("dialog")).toContainText("管理员尚未设置会议链接");
  await expect(page.getByRole("dialog").getByRole("combobox")).toHaveCount(0);
  await page.keyboard.press("Escape");
  expect(page.context().pages()).toHaveLength(1);
});

test("a failed refresh warns about unknown state rather than claiming no meeting", async ({ page }) => {
  await mountZoom(page, { active: true });
  await page.route("**/api/zoom", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "会议状态加载失败" }) }));
  await page.evaluate(() => window.dispatchEvent(new Event("zoom-settings-changed")));
  await expect(page.locator(".zoom-header-trigger")).toHaveAttribute("title", /无法确认/);
  await page.locator(".zoom-header-trigger").click();
  const dialog = page.getByRole("dialog", { name: "前往 Zoom", exact: true });
  await expect(dialog).toContainText("暂时无法确认会议状态，是否仍要前往 Zoom？");
  await expect(dialog).not.toContainText("目前还没有会议");
  expect(page.context().pages()).toHaveLength(1);
});

test("an initial load failure shows a retry notice without exposing settings", async ({ page }) => {
  await mountZoom(page, { failed: true });
  await page.locator(".zoom-header-trigger").click();
  await expect(page.getByRole("dialog")).toContainText("会议链接暂时无法加载，请稍后重试。");
  await expect(page.getByRole("dialog").getByRole("combobox")).toHaveCount(0);
});

test("a touch tap uses the same confirmation action as a short click", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mountZoom(page, { admin: true });
  await page.locator(".zoom-header-trigger").tap();
  await expect(page.getByRole("dialog", { name: "前往 Zoom", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("combobox")).toHaveCount(0);
});

test("moving and page exit cancel a pending administrator long press", async ({ page }) => {
  await mountZoom(page, { admin: true });
  const box = await page.locator(".zoom-header-trigger").boundingBox();
  if (!box) throw new Error("missing Zoom trigger");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width + 15, box.y + box.height / 2);
  await page.waitForTimeout(650);
  await page.mouse.up();
  await expect(page.getByRole("dialog", { name: "Zoom 会议状态", exact: true })).toHaveCount(0);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await page.waitForTimeout(650);
  await page.mouse.up();
  await expect(page.getByRole("dialog", { name: "Zoom 会议状态", exact: true })).toHaveCount(0);
});

test("an administrator can use the settings keyboard equivalent then join with Space", async ({ page }) => {
  await mountZoom(page, { admin: true });
  await page.locator(".zoom-header-trigger").focus();
  await page.keyboard.press("Shift+F10");
  await expect(page.getByRole("dialog", { name: "Zoom 会议状态", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Space");
  await expect(page.getByRole("dialog", { name: "前往 Zoom", exact: true })).toBeVisible();
});

for (const admin of [true, false]) {
  test(`native touch long press ${admin ? 'opens settings for an admin' : 'cannot open settings for a member'}`, async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "CDP touch input is Chromium-specific; WebKit covers taps and pointer holds separately.");
    await mountZoom(page, { admin });
    const box = await page.locator(".zoom-header-trigger").boundingBox();
    if (!box) throw new Error("missing Zoom trigger");
    const session = await page.context().newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
    await page.waitForTimeout(650);
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    if (admin) {
      await expect(page.getByRole("dialog", { name: "Zoom 会议状态", exact: true })).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(1);
    } else await expect(page.getByRole("dialog", { name: "Zoom 会议状态", exact: true })).toHaveCount(0);
    expect(page.context().pages()).toHaveLength(1);
    await session.detach();
  });
}
