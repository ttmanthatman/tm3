import { expect, test, webkit } from "@playwright/test";
import { E2E_ADMIN, E2E_CHANNELS } from "../seed-data.js";

for (const scenario of [
  { width: 360, height: 780, browserName: "chromium" as const },
  { width: 390, height: 844, browserName: "chromium" as const },
  { width: 1280, height: 900, browserName: "chromium" as const },
  { width: 390, height: 844, browserName: "webkit" as const }
]) {
  test(`${scenario.browserName} ${scenario.width}px: emoji selection, dismissal and persisted rendering`, async ({ browser }) => {
    const ownedBrowser = scenario.browserName === "webkit" ? await webkit.launch() : null;
    const context = await (ownedBrowser || browser).newContext({
      viewport: { width: scenario.width, height: scenario.height }, baseURL: "http://127.0.0.1:4173"
    });
    const page = await context.newPage();
    try {
      await page.route("**/*", async (route) => {
        const host = new URL(route.request().url()).hostname;
        if (["127.0.0.1", "localhost"].includes(host)) await route.continue();
        else await route.abort("blockedbyclient");
      });
      await page.goto("/");
      await page.getByPlaceholder("用户名").fill(E2E_ADMIN.username);
      await page.getByPlaceholder("密码").fill(E2E_ADMIN.password);
      await page.getByRole("button", { name: "登录", exact: true }).click();
      await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
      const textarea = page.locator(".composer textarea");
      const prefix = `表情验收${scenario.browserName}${scenario.width}-${Date.now()}`;
      await textarea.fill(`${prefix}选中尾巴`);
      await textarea.evaluate((element, start) => element.setSelectionRange(start, start + 2), prefix.length);
      const trigger = page.getByRole("button", { name: "表情", exact: true });
      await trigger.click();
      const picker = page.getByRole("dialog", { name: "微信表情" });
      await expect(picker).toBeVisible();
      await expect(picker.locator(".emoji-picker-grid button")).toHaveCount(109);
      const rect = await picker.boundingBox();
      expect(rect).not.toBeNull();
      expect(rect!.x).toBeGreaterThanOrEqual(0);
      expect(rect!.y).toBeGreaterThanOrEqual(0);
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(scenario.width);
      expect(rect!.y + rect!.height).toBeLessThanOrEqual(scenario.height);
      await picker.getByRole("searchbox", { name: "搜索表情" }).fill("微笑");
      await expect(picker.locator(".emoji-picker-grid button")).toHaveCount(1);
      await expect.poll(() => picker.locator("img").evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
      await page.screenshot({ path: `output/e2e/chat-emoji-${scenario.browserName}-${scenario.width}.png` });
      await picker.getByRole("button", { name: "微笑", exact: true }).click();
      await expect(picker).toBeHidden();
      await expect(textarea).toHaveValue(`${prefix}[微笑]尾巴`);
      await expect(textarea).toBeFocused();
      expect(await textarea.evaluate((element) => element.selectionStart)).toBe(prefix.length + 4);

      await trigger.click();
      await picker.getByRole("searchbox").fill("不存在的表情");
      await expect(picker.getByRole("status")).toHaveText("没有找到表情");
      await page.keyboard.press("Escape");
      await expect(picker).toBeHidden();
      await expect(trigger).toBeFocused();
      await trigger.click();
      await page.getByTestId("active-channel-name").click();
      await expect(picker).toBeHidden();

      await page.getByRole("button", { name: "发送", exact: true }).click();
      const row = page.locator(".message-row").filter({ hasText: prefix });
      await expect(row).toBeVisible();
      await expect(row.locator("img.wechat-emoji")).toHaveAttribute("alt", "[微笑]");
      await expect.poll(() => row.locator("img.wechat-emoji").evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
      await page.reload();
      await expect(row.locator("img.wechat-emoji")).toBeVisible();
      await expect(textarea).toHaveValue("");

      const rendered = await page.evaluate(async () => {
        const modulePath = "/src/client/features/messages/wechatEmojiHtml.ts";
        const { renderWechatEmojiHtml } = await import(modulePath);
        const root = document.createElement("div");
        root.innerHTML = renderWechatEmojiHtml('<strong>[微笑][合十]</strong><code>[微笑]</code><pre>[微笑]</pre><a href="https://example.com/[微笑]">[微笑]</a><span title="[微笑]">[未知]&lt;script&gt;</span>');
        return {
          images: root.querySelectorAll("img").length,
          code: root.querySelector("code")?.textContent,
          pre: root.querySelector("pre")?.textContent,
          link: root.querySelector("a")?.outerHTML,
          span: root.querySelector("span")?.outerHTML,
          scripts: root.querySelectorAll("script").length
        };
      });
      expect(rendered.images).toBe(2);
      expect(rendered.code).toBe("[微笑]");
      expect(rendered.pre).toBe("[微笑]");
      expect(rendered.link).toContain('href="https://example.com/[微笑]"');
      expect(rendered.link).toContain(">[微笑]</a>");
      expect(rendered.span).toContain('[未知]&lt;script&gt;');
      expect(rendered.scripts).toBe(0);
    } finally {
      await context.close();
      await ownedBrowser?.close();
    }
  });
}
