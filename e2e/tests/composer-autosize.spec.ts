import { expect, test, webkit, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { E2E_ADMIN, E2E_CHANNELS } from "../seed-data.js";

test.use({ serviceWorkers: "block" });
test.setTimeout(60_000);

async function checkComposer(page: Page, width: number) {
  const resizeErrors: string[] = [];
  page.on("pageerror", (error) => { if (error.message.includes("ResizeObserver")) resizeErrors.push(error.message); });
  await page.setViewportSize({ width, height: 844 });
  await page.route("**/*", (route) => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  const admin = await page.request.post("/api/auth/login", { data: E2E_ADMIN });
  const { token } = await admin.json() as { token: string };
  const username = `composer-${randomUUID().slice(0, 8)}`;
  const password = "ComposerTest123!";
  expect((await page.request.post("/api/admin/accounts", {
    headers: { Authorization: `Bearer ${token}` }, data: { username, password, displayName: "输入框测试" }
  })).ok()).toBeTruthy();
  await page.goto("/");
  await page.getByPlaceholder("用户名").fill(username);
  await page.getByPlaceholder("密码").fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
  // Keep the desktop split reader, matching the reported layout. New accounts
  // avoid inherited reader preferences hiding the chat on narrow screens.
  const input = page.locator(".composer textarea");
  await expect(input).toBeVisible();
  const marker = `输入稳定性 ${randomUUID()}`;
  await input.fill(`${marker}\n${"用于填满消息区的历史内容\n".repeat(45)}`);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const message = page.locator(".message-row.mine").filter({ hasText: marker });
  await expect(message).toBeVisible();
  await expect.poll(() => message.evaluate((element) => element.getBoundingClientRect().bottom - document.querySelector(".messages-scroll")!.getBoundingClientRect().bottom)).toBeLessThanOrEqual(1);
  for (const prefix of ["第一行\n第二行\n第三行\n", "长输入\n".repeat(30)]) {
    await input.fill(prefix);
    await page.locator(".messages-scroll").evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect.poll(() => input.evaluate((element) => element.style.height)).not.toBe("auto");
    await expect.poll(() => message.evaluate((element) => element.getBoundingClientRect().bottom - document.querySelector(".messages-scroll")!.getBoundingClientRect().bottom)).toBeLessThanOrEqual(1);
    // Sample actual rendered geometry every frame while characters are added
    // without another wrap. Both ordinary multiline and capped input must stay put.
    await page.evaluate(() => {
      const samples: number[][] = [];
      const state = { samples, running: true, styleChanges: 0 };
      const observer = new MutationObserver((records) => { state.styleChanges += records.length; });
      observer.observe(document.querySelector(".composer textarea")!, { attributes: true, attributeFilter: ["style"] });
      Object.assign(window, { composerSamples: state });
      const sample = () => {
        const row = document.querySelector(".message-row.mine")!;
        const input = document.querySelector(".composer textarea")!;
        samples.push([row.getBoundingClientRect().bottom, input.getBoundingClientRect().height]);
        if (state.running) requestAnimationFrame(sample);
        else observer.disconnect();
      };
      requestAnimationFrame(() => requestAnimationFrame(sample));
    });
    await input.pressSequentially("abcdefgh", { delay: 60 });
    const samples = await page.evaluate(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const state = (window as unknown as { composerSamples: { samples: number[][]; running: boolean; styleChanges: number } }).composerSamples;
      state.running = false;
      return state;
    });
    expect(samples.styleChanges, "Typing without wrapping must not collapse/re-expand the live textarea").toBe(0);
    expect(samples.samples.length).toBeGreaterThan(5);
    for (const axis of [0, 1]) {
      const positions = samples.samples.map((sample) => sample[axis]!);
      expect(Math.max(...positions) - Math.min(...positions), JSON.stringify(samples)).toBeLessThanOrEqual(1);
    }
    expect(await input.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThanOrEqual(280);
    if (prefix.startsWith("长输入")) {
      expect(await input.evaluate((element) => element.scrollHeight > element.clientHeight && getComputedStyle(element).overflowY === "auto")).toBe(true);
    }
  }
  if (width === 390) await page.screenshot({ path: `output/playwright/composer-stable-${page.context().browser()!.browserType().name()}.png` });
  await input.fill("删回一行");
  await expect.poll(() => input.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(65);
  await input.fill("变窄时自动折行".repeat(12));
  const wideHeight = await input.evaluate((element) => element.getBoundingClientRect().height);
  await input.evaluate((element) => { element.parentElement!.style.maxWidth = "180px"; });
  await expect.poll(() => input.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(wideHeight);
  expect(resizeErrors).toEqual([]);
}

for (const width of [360, 390, 1280]) {
  test(`多行输入保持消息位置稳定 ${width}px`, async ({ page }) => checkComposer(page, width));
}

test("iPhone WebKit 多行输入保持消息位置稳定", async () => {
  const browser = await webkit.launch();
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:4173", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  try { await checkComposer(await context.newPage(), 390); }
  finally { await browser.close(); }
});
