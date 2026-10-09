import { ensureBibleOpen } from "../helpers/bible.js";
import { expect, test, webkit, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { E2E_ADMIN, E2E_CHANNELS } from "../seed-data.js";

test.use({ serviceWorkers: "block" });

async function openPsalm66(page: Page) {
  // Reader position is account-synced. Each scenario needs its own account
  // so it cannot change the initial workspace of other E2E tests.
  const admin = await page.request.post("/api/auth/login", { data: E2E_ADMIN });
  expect(admin.ok()).toBeTruthy();
  const { token } = await admin.json() as { token: string };
  const username = `bible-scroll-${randomUUID().slice(0, 8)}`;
  const password = "BibleScroll123!";
  const created = await page.request.post("/api/admin/accounts", {
    headers: { Authorization: `Bearer ${token}` },
    data: { username, password, displayName: "阅读滚动测试" }
  });
  expect(created.ok()).toBeTruthy();
  await page.goto("/");
  await page.getByPlaceholder("用户名").fill(username);
  await page.getByPlaceholder("密码").fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
  await ensureBibleOpen(page);
  if (await page.getByRole("button", { name: "目录", exact: true }).isVisible()) {
    await page.getByRole("button", { name: "目录", exact: true }).click();
  }
  await page.getByRole("tab", { name: "经卷目录", exact: true }).click();
  await page.getByRole("button", { name: /^诗篇/ }).click();
  await page.getByRole("button", { name: "66", exact: true }).click();
  await expect(page.locator('[data-verse-key="PSA-66-1"]')).toBeVisible();
}

async function prependScenario(page: Page, moveWhileLoading: boolean) {
  let releasePrevious!: () => void;
  const previousReady = new Promise<void>((resolve) => { releasePrevious = resolve; });
  let previousRequested = false;
  await page.route("**/api/bible/chapter?**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("book") === "PSA" && url.searchParams.get("chapter") === "65") {
      previousRequested = true;
      await previousReady;
    }
    await route.continue();
  });
  try {
    await openPsalm66(page);
    const scroller = page.locator(".bible-pane-scroll");
    if (!moveWhileLoading) {
      // Also exercise browsers without native scroll anchoring. The reader
      // must perform its own correction without a visible smooth animation.
      await page.addStyleTag({ content: ".bible-pane-scroll { overflow-anchor: none; }" });
    }
    // Let opening positioning finish, then exercise a small first scroll with
    // a deliberately slow preceding chapter, rather than a cached response.
    await page.waitForTimeout(650);
    await scroller.hover();
    await page.mouse.wheel(0, 24);
    await expect.poll(() => previousRequested).toBe(true);
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    if (moveWhileLoading) {
      await page.mouse.wheel(0, 80);
      await page.waitForTimeout(150);
    }
    const anchor = page.locator('[data-reader-chapter="66"]');
    const before = await anchor.evaluate((el) => el.getBoundingClientRect().top);
    // Sample every rendered frame: checking only the final position misses
    // the large jump followed by a smooth programmatic correction.
    const movement = anchor.evaluate(async (el) => {
      const tops: number[] = [];
      const end = performance.now() + 700;
      while (performance.now() < end) {
        tops.push(el.getBoundingClientRect().top);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      return tops;
    });
    releasePrevious();
    await expect(page.locator('[data-reader-chapter="65"]')).toBeAttached();
    const tops = await movement;
    expect(Math.max(...tops.map((top) => Math.abs(top - before)))).toBeLessThan(3);
    // A second small scroll must still work without a compensating movement.
    const top = await anchor.evaluate((el) => el.getBoundingClientRect().top);
    await page.mouse.wheel(0, 24);
    await expect.poll(() => anchor.evaluate((el) => el.getBoundingClientRect().top)).toBeLessThan(top - 10);
  } finally {
    releasePrevious();
  }
}

test("a delayed preceding chapter cannot move a newly selected reading location", async ({ page }) => {
  let releasePrevious!: () => void;
  const pending = new Promise<void>((resolve) => { releasePrevious = resolve; });
  let requested = false;
  await page.route("**/api/bible/chapter?**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("book") === "PSA" && url.searchParams.get("chapter") === "65") {
      requested = true;
      await pending;
    }
    await route.continue();
  });
  try {
    await openPsalm66(page);
    await page.waitForTimeout(650);
    await page.locator(".bible-pane-scroll").hover();
    await page.mouse.wheel(0, 24);
    await expect.poll(() => page.locator(".bible-pane-scroll").evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await expect.poll(() => requested).toBe(true);
    await page.getByLabel("选择章节").selectOption("80");
    await expect(page.locator('[data-reader-chapter="80"]')).toBeVisible();
    releasePrevious();
    await page.waitForTimeout(700);
    await expect(page.locator('[data-reader-chapter="65"]')).toHaveCount(0);
    await expect(page.getByLabel("选择章节")).toHaveValue("80");
    await expect(page.locator('[data-verse-key="PSA-80-1"]')).toBeVisible();
  } finally {
    releasePrevious();
  }
});

test("a held mobile touch keeps following the finger across a chapter insertion", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  let releasePrevious!: () => void;
  const pending = new Promise<void>((resolve) => { releasePrevious = resolve; });
  try {
    const page = await context.newPage();
    await page.route("**/api/bible/chapter?**", async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("book") === "PSA" && url.searchParams.get("chapter") === "65") await pending;
      await route.continue();
    });
    await openPsalm66(page);
    await page.waitForTimeout(650);
    const scroller = page.locator(".bible-pane-scroll");
    const box = (await scroller.boundingBox())!;
    const input = await context.newCDPSession(page);
    const x = box.x + box.width * 0.7;
    const y = box.y + box.height * 0.5;
    const point = (clientY: number) => [{ x, y: clientY, id: 1 }];
    await input.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(y) });
    await input.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point(y - 30) });
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(10);
    const anchor = page.locator('[data-reader-chapter="66"]');
    const before = await anchor.evaluate((el) => el.getBoundingClientRect().top);
    releasePrevious();
    await expect(page.locator('[data-reader-chapter="65"]')).toBeAttached();
    expect(Math.abs(await anchor.evaluate((el) => el.getBoundingClientRect().top) - before)).toBeLessThan(3);
    // Keep the same contact down. A new gesture would hide the user's bug.
    await input.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point(y - 54) });
    await expect.poll(() => anchor.evaluate((el) => el.getBoundingClientRect().top)).toBeLessThan(before - 10);
    await input.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } finally {
    releasePrevious();
    await context.close();
  }
});

for (const engine of ["chromium", "webkit"] as const) {
  for (const moveWhileLoading of [false, true]) {
    test(`Psalm 66 ${engine}: first scroll stays anchored${moveWhileLoading ? " while a slow chapter loads" : ""}`, async ({ page, baseURL }) => {
      if (engine === "chromium") {
        await page.setViewportSize({ width: 390, height: 844 });
        await prependScenario(page, moveWhileLoading);
        return;
      }
      const browser = await webkit.launch();
      // Desktop WebKit at a phone viewport supports real native wheel input;
      // Playwright's mobile WebKit exposes taps but no native drag/wheel API.
      const context = await browser.newContext({ baseURL, viewport: { width: 360, height: 780 }, hasTouch: true, serviceWorkers: "block" });
      try {
        await prependScenario(await context.newPage(), moveWhileLoading);
      } finally {
        await browser.close();
      }
    });
  }
}
