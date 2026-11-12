import { expect, test, webkit } from "@playwright/test";
import { E2E_ADMIN, E2E_CHANNELS } from "../seed-data.js";

for (const scenario of [
  { width: 360, height: 780, webkit: false },
  { width: 390, height: 844, webkit: false },
  { width: 1280, height: 900, webkit: false },
  { width: 390, height: 844, webkit: true }
]) {
  test(`PWA viewport ${scenario.webkit ? "WebKit" : "Chromium"} ${scenario.width}: full height and keyboard recovery`, async ({ browser }) => {
    const ownedBrowser = scenario.webkit ? await webkit.launch() : null;
    const context = await (ownedBrowser || browser).newContext({
      viewport: { width: scenario.width, height: scenario.height },
      baseURL: "http://127.0.0.1:4173", serviceWorkers: "block"
    });
    try {
      // Desktop engines cannot reproduce iOS's system chrome. Replay its
      // reported geometry at the real app entry point instead.
      await context.addInitScript(() => {
        Object.defineProperty(navigator, "standalone", { value: true });
        if (!window.visualViewport) throw new Error("visualViewport unavailable");
        Object.defineProperty(window.visualViewport, "height", {
          configurable: true, get: () => window.innerHeight - 47
        });
        Object.defineProperty(window.visualViewport, "offsetTop", { configurable: true, value: 0 });
      });
      const page = await context.newPage();
      await page.goto("/");
      await expect(page.locator('meta[name="apple-mobile-web-app-status-bar-style"]')).toHaveAttribute("content", "default");
      await page.getByPlaceholder("用户名").fill(E2E_ADMIN.username);
      await page.getByPlaceholder("密码").fill(E2E_ADMIN.password);
      await page.getByRole("button", { name: "登录", exact: true }).click();
      await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
      const appHeight = () => page.locator(".app-shell").evaluate(element => element.getBoundingClientRect().height);
      await expect.poll(appHeight).toBe(scenario.height);
      const input = page.locator(".composer textarea");
      await input.focus();
      await expect.poll(appHeight).toBe(scenario.height);
      await page.evaluate(() => {
        Object.defineProperty(window.visualViewport!, "height", { configurable: true, value: window.innerHeight - 300 });
        window.visualViewport!.dispatchEvent(new Event("resize"));
      });
      await expect.poll(appHeight).toBe(scenario.height - 300);
      const inputBox = (await input.boundingBox())!;
      expect(inputBox.y).toBeGreaterThanOrEqual(0);
      expect(inputBox.y + inputBox.height).toBeLessThanOrEqual(scenario.height - 300);
      // Closing the keyboard must restore the app even if the editor stays focused.
      await page.evaluate(() => {
        Object.defineProperty(window.visualViewport!, "height", { configurable: true, value: window.innerHeight - 47 });
        window.visualViewport!.dispatchEvent(new Event("resize"));
      });
      await expect.poll(appHeight).toBe(scenario.height);
      const composer = (await page.locator(".composer").boundingBox())!;
      expect(composer.y + composer.height).toBeCloseTo(scenario.height, 0);
      await page.screenshot({ path: test.info().outputPath("pwa-viewport.png") });
    } finally {
      await context.close();
      await ownedBrowser?.close();
    }
  });
}
