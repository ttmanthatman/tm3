import { expect, test, webkit, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { E2E_ADMIN, E2E_CHANNELS } from "../seed-data.js";

test.use({ serviceWorkers: "block" });
test.setTimeout(90_000);

async function newAccount(page: Page) {
  const logged = await page.request.post("/api/auth/login", { data: E2E_ADMIN });
  const { token } = await logged.json();
  const account = { username: `bsearch-${randomUUID().slice(0, 8)}`, password: "BibleSearch123!" };
  const created = await page.request.post("/api/admin/accounts", { headers: { Authorization: `Bearer ${token}` }, data: { ...account, displayName: "圣经检索测试" } });
  expect(created.ok()).toBeTruthy();
  return account;
}
async function login(page: Page, credentials: { username: string; password: string }) {
  await page.goto("/");
  await page.getByPlaceholder("用户名").fill(credentials.username);
  await page.getByPlaceholder("密码").fill(credentials.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
  const open = page.getByRole("button", { name: "打开圣经", exact: true });
  if (await open.isVisible()) await open.click();
  await expect(page.locator(".bible-home-pane")).toBeVisible();
  const expand = page.getByRole("button", { name: "圣经全屏", exact: true });
  if (await expand.isVisible()) await expand.click();
}
async function textSearch(page: Page) {
  const home = page.locator(".bible-home-pane").first();
  await home.getByRole("tab", { name: "经文检索", exact: true }).click();
  await home.getByRole("button", { name: "文本检索", exact: true }).click();
  await home.getByPlaceholder("例如：神爱世人，或输入多个关键词").fill("起初");
  await home.getByRole("button", { name: "检索", exact: true }).click();
  await expect(home.locator(".bible-result-card").first()).toBeVisible();
  return home;
}

async function chooseTranslation(page: Page, label: string, name: string) {
  await page.getByRole("button", { name: label, exact: true }).click();
  const menu = page.getByRole("menu", { name: label, exact: true });
  await expect(menu).toHaveClass(/app-menu/);
  await menu.getByRole("menuitemradio", { name, exact: true }).click();
  await expect(menu).toBeHidden();
}

for (const engine of ["chromium", "webkit"] as const) {
  test(`Bible account history, preferences, batch copy/send and context preserve search (${engine})`, async ({ browser, baseURL }) => {
    const owned = engine === "webkit" ? await webkit.launch() : null;
    const context = await (owned || browser).newContext({ baseURL, viewport: { width: 1280, height: 960 }, serviceWorkers: "block" });
    const issues: string[] = [];
    try {
      await context.addInitScript(() => {
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { (window as unknown as { copied: string }).copied = text; } } });
      });
      const page = await context.newPage();
      page.on("pageerror", error => issues.push(error.message));
      const deliveries: string[] = [];
      page.on("websocket", socket => socket.on("framesent", frame => {
        const payload = String(frame.payload);
        if (payload.includes('"message:send"')) deliveries.push(payload);
      }));

      const credentials = await newAccount(page);
      await login(page, credentials);
      const home = await textSearch(page);
      await expect(home.getByText("直接查找经文原文", { exact: true })).toHaveCount(0);
      await expect(home.getByRole("button", { name: /接收所有经文链接/ })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "当前窗格译本", exact: true })).toHaveCount(0);
      await expect(home.getByRole("tablist", { name: "书房功能", exact: true }).locator("svg")).toHaveCount(0);
      await home.getByRole("button", { name: "主题检索", exact: true }).click();
      const tabFontBeforeSearch = await home.getByRole("tab", { name: "经文检索", exact: true }).evaluate(el => getComputedStyle(el).fontFamily);
      await expect(home.getByText("想查看关于什么的经文？", { exact: true })).toHaveCSS("font-family", tabFontBeforeSearch);
      await home.getByRole("button", { name: "文本检索", exact: true }).click();
      await expect(home.getByText("先匹配连续原文；没有结果时自动尝试所有关键词同时包含。", { exact: true })).toHaveCount(0);
      await chooseTranslation(page, "检索译本", "当代译本");
      await expect(home.getByRole("button", { name: "检索译本", exact: true })).toHaveText("当代译本");
      await chooseTranslation(page, "检索译本", "和合本");
      await expect(home.getByRole("button", { name: "检索译本", exact: true })).toHaveText("和合本");
      const cards = home.locator(".bible-result-card");
      expect(await cards.count()).toBeGreaterThan(1);
      const refs = await cards.locator("h3").allTextContents();
      const checkbox = await cards.first().getByRole("checkbox").boundingBox();
      const heading = await cards.first().locator("h3").boundingBox();
      expect(Math.abs(checkbox!.y + checkbox!.height / 2 - heading!.y - heading!.height / 2)).toBeLessThan(1);
      const tabFont = await home.getByRole("tab", { name: "经文检索", exact: true }).evaluate(el => getComputedStyle(el).fontFamily);
      await expect(cards.first().locator("h3")).toHaveCSS("font-family", tabFont);
      await expect(cards.first().locator("h3")).toHaveCSS("font-weight", "800");
      await expect(home.locator(".home-pane-toolbar")).toHaveCount(0);
      await expect(page.locator(".bible-topbar-button.home")).toHaveCount(0);
      await cards.nth(0).getByRole("checkbox").check();
      await cards.nth(1).getByRole("checkbox").check();
      await home.getByRole("button", { name: "复制所选", exact: true }).click();
      const copied = await page.evaluate(() => (window as unknown as { copied: string }).copied);
      expect(copied).toContain(refs[0]); expect(copied).toContain(refs[1]);
      if (refs[2]) expect(copied).not.toContain(refs[2]);
      // A slow account refresh must finish before edits can be overwritten by its response.
      await page.route("**/api/auth/me", async route => {
        await new Promise(resolve => setTimeout(resolve, 500));
        await route.continue();
      }, { times: 1 });
      await page.getByRole("button", { name: "圣经偏好设置", exact: true }).click();
      const settings = page.getByRole("dialog", { name: "圣经偏好设置", exact: true });
      await settings.getByLabel("发送经文时显示版本信息").check();
      await settings.getByLabel("发送经文前显示确认窗口").uncheck();
      await settings.getByRole("radio", { name: "文本检索" }).check();
      const fontSize = settings.getByLabel("经文字号");
      await expect(fontSize).toHaveValue("20");
      for (let step = 0; step < 3; step += 1) await settings.getByRole("button", { name: "增大字号" }).click();
      await expect(fontSize).toHaveValue("23");
      await settings.getByRole("button", { name: "保存偏好", exact: true }).click();
      await expect(settings).toBeHidden();
      await home.getByRole("switch", { name: "只复制出处", exact: true }).check();
      await expect(home.getByRole("button", { name: "发送所选", exact: true })).toBeVisible();
      await home.getByRole("button", { name: "发送所选", exact: true }).click();
      await expect.poll(() => deliveries.length).toBe(1);
      for (const reference of refs.slice(0, 2)) expect(deliveries[0]).toContain(reference);
      expect(deliveries[0]).toContain('"kind":"bible_passage"');
      expect(deliveries[0]).toContain('"sourceId":"cmn-cu89s"');
      expect(deliveries[0]).toContain('"showTranslation":true');
      expect(deliveries[0]).toContain("新标点和合本");
      await expect(page.getByRole("dialog", { name: "分享经文", exact: true })).toBeHidden();
      await cards.nth(2).getByRole("checkbox").check();
      await home.getByRole("button", { name: "发送所选", exact: true }).click();
      await expect.poll(() => deliveries.length).toBe(2);
      await expect(page.getByRole("dialog", { name: "分享经文", exact: true })).toBeHidden();
      await cards.nth(3).getByRole("checkbox").check();
      await home.getByRole("button", { name: "发送所选", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "分享经文", exact: true })).toBeHidden();
      await expect.poll(() => deliveries.length).toBe(3);
      for (const reference of refs.slice(0, 4)) expect(deliveries[2]).toContain(reference);
      expect(deliveries[2]).toContain('"kind":"bible_passage"');
      expect(deliveries[2]).toContain('"clientRequestId"');
      // A copy preference changes the clipboard only; sending still includes complete scripture.
      expect(deliveries[2]).toContain("起初");
      await cards.first().getByRole("button", { name: "阅读上下文", exact: true }).click();
      await expect(page.locator(".bible-home-pane")).toHaveCount(1);
      await expect(page.locator(".bible-reader-pane")).toHaveCount(1);
      await expect(page.getByRole("button", { name: "清除经文高亮", exact: true }).locator("svg")).toHaveClass(/lucide-eraser-icon/);
      await expect(home.locator(".bible-result-card").first()).toBeVisible();
      await expect(page.locator(".bible-pane-scroll")).toHaveCSS("scrollbar-width", "none");
      await expect.poll(async () => {
        const token = await page.evaluate(() => localStorage.getItem("team-chat-token"));
        const me = await page.request.get("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } });
        return (await me.json()).account.biblePreferences.workspace?.panes.length;
      }).toBe(2);
      const reader = page.locator(".bible-reader-pane");
      await expect(reader.getByRole("button", { name: /^返回(跳转前的阅读点)?$/ })).toBeDisabled();
      const verseKey = await reader.locator(".bible-reader-verse.target[data-verse-key]").first().getAttribute("data-verse-key");
      const previousScrollTop = await reader.locator(".bible-pane-scroll").evaluate(element => { element.scrollTop = 360; return element.scrollTop; });
      expect(previousScrollTop).toBeGreaterThan(0);
      await reader.getByRole("button", { name: "B 窗格目录", exact: true }).click();
      await expect(page.locator(".bible-home-pane")).toHaveCount(2);
      await page.locator(".bible-home-pane").nth(1).getByRole("button", { name: /^返回(跳转前的阅读点)?$/ }).click();
      await expect(reader.locator(`[data-verse-key="${verseKey}"]`)).toBeAttached();
      await expect.poll(() => reader.locator(".bible-pane-scroll").evaluate(element => element.scrollTop)).toBeCloseTo(previousScrollTop, 0);
      await expect(reader.getByRole("button", { name: /^返回(跳转前的阅读点)?$/ })).toBeDisabled();
      await chooseTranslation(page, "选择圣经译本", "当代译本");
      await expect(page.getByRole("button", { name: "选择圣经译本", exact: true })).toHaveText("当代译本");
      await expect(page.locator(".bible-pane-scroll")).toContainText("上帝");
      await chooseTranslation(page, "选择圣经译本", "和合本");
      await expect(home.getByRole("button", { name: "检索译本", exact: true })).toHaveText("和合本");
      // Another browser context has no local storage and must restore the same account data.
      const remote = await (owned || browser).newContext({ baseURL, viewport: { width: 1280, height: 960 }, serviceWorkers: "block",
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
      });
      try {
        const second = await remote.newPage();
        await login(second, credentials);
        await second.locator(".bible-home-pane").getByRole("tab", { name: "经文检索", exact: true }).click();
        await expect(second.locator(".bible-history-list")).toHaveCount(0);
        await second.getByRole("button", { name: "搜索历史", exact: true }).click();
        await expect(second.locator(".bible-history-list")).toContainText("起初");
        await second.keyboard.press("Escape");
        await expect(second.locator(".bible-history-list")).toHaveCount(0);
        await second.getByRole("button", { name: "圣经偏好设置", exact: true }).click();
        const synced = second.getByRole("dialog", { name: "圣经偏好设置", exact: true });
        await expect(synced.getByLabel("发送经文时显示版本信息")).toBeChecked();
        await expect(synced.getByLabel("发送经文前显示确认窗口")).not.toBeChecked();
        await expect(synced.getByLabel("经文字号")).toHaveValue("23");
        await synced.getByRole("button", { name: "关闭", exact: true }).click();
        await second.getByRole("button", { name: "搜索历史", exact: true }).click();
        await second.locator(".bible-history-list button").filter({ hasText: "起初" }).click();
        await expect(second.locator(".bible-result-card").first()).toBeVisible();
        await expect(second.locator(".bible-history-list")).toHaveCount(0);
        await second.getByRole("button", { name: "搜索历史", exact: true }).click();
        await second.locator(".bible-search-history").getByRole("button", { name: "清空", exact: true }).click();
        await expect(second.locator(".bible-history-list")).toHaveCount(0);
      } finally { await remote.close(); }
      await home.getByRole("button", { name: "检索", exact: true }).click();
      for (const width of [360, 390, 1280]) {
        await page.setViewportSize({ width, height: 960 });
        await page.getByRole("button", { name: "圣经偏好设置", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "圣经偏好设置", exact: true });
        await expect(dialog).toBeVisible();
        const panel = await dialog.locator(".bible-preferences-dialog").boundingBox();
        expect(panel!.x).toBeGreaterThanOrEqual(0); expect(panel!.x + panel!.width).toBeLessThanOrEqual(width);
        await dialog.getByRole("button", { name: "关闭", exact: true }).click();
        const bounds = await page.locator(".bible-topbar").boundingBox();
        const actions = await page.locator(".bible-topbar-actions").boundingBox();
        expect(actions!.x).toBeGreaterThanOrEqual(bounds!.x);
        expect(actions!.x + actions!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1);
        const close = await page.getByRole("button", { name: "关闭圣经", exact: true }).boundingBox();
        expect(close!.x + close!.width).toBeLessThanOrEqual(actions!.x + 1);
        await home.getByRole("button", { name: "搜索历史", exact: true }).click();
        const history = home.locator(".bible-search-history");
        await expect(history).toHaveCSS("background-color", "rgb(233, 223, 207)");
        await expect(history).toBeVisible();
        const menu = await history.boundingBox();
        expect(menu!.x).toBeGreaterThanOrEqual(0);
        expect(menu!.x + menu!.width).toBeLessThanOrEqual(width);
        await page.screenshot({ path: `output/e2e/bible-search-${engine}-${width}.png` });
        await home.getByPlaceholder("例如：神爱世人，或输入多个关键词").click();
        await expect(history).toHaveCount(0);
      }
      expect(issues).toEqual([]);
    } finally { await context.close(); await owned?.close(); }
  });
}

test("Bible directories stay in independent panes and context uses the explicit receiver or asks for A–D", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 960 });
  await login(page, await newAccount(page));
  const home = await textSearch(page);
  await page.getByRole("button", { name: "添加圣经阅读窗格", exact: true }).click();
  await expect(page.locator(".bible-home-pane")).toHaveCount(2);
  await home.locator(".bible-result-card").first().getByRole("button", { name: "阅读上下文", exact: true }).click();
  const chooser = page.getByRole("dialog", { name: "发送上下文到哪个窗格？", exact: true });
  await expect(chooser).toBeVisible();
  await chooser.getByRole("button", { name: /^B 窗格/ }).click();
  await expect(page.locator(".bible-reader-pane")).toHaveCount(1);
  await page.getByRole("button", { name: "B 窗格目录", exact: true }).click();
  await expect(page.locator(".bible-home-pane")).toHaveCount(2);
  await expect(home.locator(".bible-result-card").first()).toBeVisible();
  await expect(page.locator(".bible-home-pane").getByRole("button", { name: /接收所有经文链接/ })).toHaveCount(0);
  await home.locator(".bible-result-card").first().getByRole("button", { name: "阅读上下文", exact: true }).click();
  await chooser.getByRole("button", { name: /^B 窗格/ }).click();
  await page.getByRole("button", { name: "指定 B 窗格接收所有经文链接", exact: true }).click();
  await home.locator(".bible-result-card").nth(1).getByRole("button", { name: "阅读上下文", exact: true }).click();
  await expect(chooser).toBeHidden();
  await expect(page.locator(".bible-reader-pane")).toHaveCount(1);
  const back = page.locator(".bible-reader-pane").getByRole("button", { name: "返回", exact: true });
  await expect(back).toBeEnabled();
  await back.click();
  await expect(page.locator(".bible-reader-pane .bible-reader-verse.target[data-verse-key]").first()).toHaveAttribute("data-verse-key", "GEN-1-1");
  await page.getByRole("button", { name: "B 窗格正在接收所有经文链接", exact: true }).click();
  await page.getByRole("button", { name: "添加圣经阅读窗格", exact: true }).click();
  await page.getByRole("button", { name: "添加圣经阅读窗格", exact: true }).click();
  await expect(page.getByRole("button", { name: "已达到四窗格上限", exact: true })).toBeDisabled();
  await home.locator(".bible-result-card").first().getByRole("button", { name: "阅读上下文", exact: true }).click();
  await expect(chooser).toBeVisible();
  for (const label of ["B", "C", "D"]) await expect(chooser.getByRole("button", { name: new RegExp(`^${label} 窗格`) })).toBeVisible();
  await chooser.getByRole("button", { name: /^D 窗格/ }).click();
  await expect(home.locator(".bible-result-card").first()).toBeVisible();
  await expect(page.locator(".bible-reader-pane")).toHaveCount(3);
});
