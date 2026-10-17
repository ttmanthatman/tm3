import { expect, test, webkit, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { E2E_ADMIN, E2E_CHANNELS, E2E_PERF } from "../seed-data.js";

test.use({ serviceWorkers: "block" });
test.setTimeout(60_000);

async function login(page: Page) {
  const admin = await page.request.post("/api/auth/login", { data: E2E_ADMIN });
  const { token } = await admin.json() as { token: string };
  const username = `split-${randomUUID().slice(0, 8)}`;
  const password = "BibleSplit123!";
  const created = await page.request.post("/api/admin/accounts", {
    headers: { Authorization: `Bearer ${token}` }, data: { username, password, displayName: "分屏阅读测试" }
  });
  expect(created.ok()).toBeTruthy();
  await page.goto("/");
  await page.getByPlaceholder("用户名").fill(username);
  await page.getByPlaceholder("密码").fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
  return { adminToken: token };
}

async function chatState(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector("#app") as HTMLElement & { __vue_app__?: { _context?: { provides?: Record<PropertyKey, unknown> } } };
    const provides = root?.__vue_app__?._context?.provides;
    const pinia = Reflect.ownKeys(provides || {}).map((key) => provides?.[key]).find((value) => value && typeof value === "object" && "_s" in value) as { _s?: Map<string, Record<string, unknown>> } | undefined;
    const store = [...(pinia?._s?.values() || [])].find((candidate) => "connectionState" in candidate && "messages" in candidate);
    if (!store || typeof store.currentChannelId !== "number" || !Array.isArray(store.messages)) throw new Error("chat state missing");
    return { channelId: store.currentChannelId, contents: (store.messages as { content: string }[]).map((message) => message.content) };
  });
}

async function expectRatio(page: Page, ratio: number) {
  await expect.poll(async () => {
    const bible = (await page.locator(".bible-workspace").boundingBox())!;
    return Math.abs(bible.width / (page.viewportSize()!.width - 12) - ratio);
  }).toBeLessThan(0.005);
  const bible = (await page.locator(".bible-workspace").boundingBox())!;
  const chat = (await page.locator(".chat-pane").boundingBox())!;
  expect(chat.x).toBeCloseTo(bible.width + 12, 0);
  expect(chat.width).toBeGreaterThanOrEqual(359);
}

async function openReading(page: Page) {
  await page.getByRole("button", { name: /^诗篇/ }).click();
  await page.getByRole("button", { name: "66", exact: true }).click();
  await expect(page.locator('[data-verse-key="PSA-66-1"]')).toBeVisible();
}

async function expectTopSwapAlignment(page: Page) {
  const swap = (await page.getByRole("button", { name: "左右交换圣经和聊天", exact: true }).boundingBox())!;
  const separator = (await page.locator(".bible-chat-separator").boundingBox())!;
  const toolbar = (await page.locator(".bible-topbar").boundingBox())!;
  expect(swap.x).toBeCloseTo(separator.x, 0);
  expect(swap.width).toBeCloseTo(separator.width, 0);
  expect(swap.y).toBeCloseTo(toolbar.y, 0);
  expect(swap.y + swap.height).toBeCloseTo(toolbar.y + toolbar.height, 0);
}

for (const engine of ["chromium", "webkit"] as const) {
  test(`split panels swap without losing widths, reading or drafts (${engine})`, async ({ browser, baseURL }) => {
    const owned = engine === "webkit" ? await webkit.launch() : null;
    const context = await (owned || browser).newContext({ baseURL, viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
    try {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await login(page);
      await openReading(page);
      const input = page.locator(".composer textarea");
      await input.fill("左右交换保留草稿");
      const separator = page.getByRole("separator", { name: "调整圣经和聊天宽度" });
      const swap = page.getByRole("button", { name: "左右交换圣经和聊天", exact: true });
      await separator.focus();
      await separator.press("ArrowLeft");
      await expectRatio(page, 0.48);
      await input.focus();
      await page.mouse.move(100, 100);
      await expect(swap).toBeVisible();
      await expectTopSwapAlignment(page);
      await expect(swap).toHaveCSS("border-radius", "0px");
      await expect(swap.locator("svg")).toHaveCount(0);
      await page.screenshot({ path: `output/e2e/bible-swap-top-${engine}.png` });
      const bible = page.locator(".bible-workspace");
      const chat = page.locator(".chat-pane");
      const width = (await bible.boundingBox())!.width;
      const scroll = page.locator(".bible-pane-scroll");
      const scrollTop = await scroll.evaluate((element) => element.scrollTop);
      await swap.click();
      expect((await chat.boundingBox())!.x).toBe(0);
      expect((await bible.boundingBox())!.width).toBeCloseTo(width, 0);
      expect((await bible.boundingBox())!.x).toBeCloseTo((await chat.boundingBox())!.width + 12, 0);
      await expect(input).toHaveValue("左右交换保留草稿");
      await expect(page.locator('[data-verse-key="PSA-66-1"]')).toBeVisible();
      expect(await scroll.evaluate((element) => element.scrollTop)).toBeCloseTo(scrollTop, 0);
      // Enter belongs to the swap button, not the separator's equal-width shortcut.
      await swap.press("Enter");
      await expectRatio(page, 0.48);
      await separator.focus();
      await separator.press("Tab");
      await expect(swap).toBeFocused();
      await swap.press("Space");
      await separator.focus();
      await separator.press("ArrowRight");
      await expect(separator).toHaveAttribute("aria-valuenow", "46");
      await separator.press("Home");
      expect((await chat.boundingBox())!.width).toBeCloseTo(360, 0);
      await separator.press("End");
      expect((await bible.boundingBox())!.width).toBeCloseTo(320, 0);
      const box = (await separator.boundingBox())!;
      await page.mouse.move(box.x + 6, 200);
      await page.mouse.down();
      await page.mouse.move((1280 - 12) * 0.6 + 6, 200, { steps: 8 });
      await page.mouse.up();
      await expect(separator).toHaveAttribute("aria-valuenow", "40");
      await page.getByRole("button", { name: "展开频道", exact: true }).click();
      expect((await page.locator(".channel-pane").boundingBox())!.x).toBe(0);
      expect((await page.locator(".scrim").boundingBox())!.width).toBeCloseTo((await chat.boundingBox())!.width, 0);
      await page.locator(".scrim").click({ position: { x: 500, y: 250 } });
      await page.getByRole("button", { name: "更多管理功能", exact: true }).click();
      await page.getByRole("menuitem", { name: "成员列表", exact: true }).click();
      const members = (await page.locator(".member-pane").boundingBox())!;
      expect(members.x + members.width).toBeCloseTo((await chat.boundingBox())!.width, 0);
      await page.getByRole("button", { name: "收起成员", exact: true }).click();
      await page.getByRole("button", { name: "圣经全屏", exact: true }).click();
      await expect(separator).toHaveCount(0);
      await page.getByRole("button", { name: "缩小圣经，恢复分屏", exact: true }).click();
      expect((await chat.boundingBox())!.x).toBe(0);
      await expect(separator).toHaveAttribute("aria-valuenow", "40");
      await page.setViewportSize({ width: 1063, height: 804 });
      await expectTopSwapAlignment(page);
      expect((await bible.boundingBox())!.width).toBeGreaterThanOrEqual(320);
      expect((await chat.boundingBox())!.width).toBeGreaterThanOrEqual(360);
      await separator.hover({ position: { x: 6, y: 200 } });
      await page.screenshot({ path: `output/e2e/bible-swap-reversed-${engine}.png` });
      await swap.click();
      await expectRatio(page, 0.4);
      expect(errors).toEqual([]);
    } finally { await context.close(); await owned?.close(); }
  });
}

test("desktop split supports snapping, keyboard, drawers, fullscreen and drafts", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await login(page);
  await expectRatio(page, 0.5);
  const toggle = page.locator(".bible-header-trigger");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(toggle.locator("svg")).toHaveAttribute("data-bible-icon", "open");
  await toggle.click();
  await expect(page.locator(".bible-workspace")).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-label", "打开圣经");
  await expect(toggle.locator("svg")).toHaveAttribute("data-bible-icon", "closed");
  await toggle.click();
  await expectRatio(page, 0.5);
  await expect(page.locator(".app-shell")).toHaveClass(/channels-collapsed/);
  await expect(page.locator(".app-shell")).toHaveClass(/members-collapsed/);
  await openReading(page);
  // Let the reader's adjacent chapter preload settle before measuring reflow.
  await page.waitForTimeout(700);
  await page.locator(".bible-pane-scroll").evaluate((element) => { element.scrollTop = 500; });
  const anchor = await page.locator(".bible-pane-scroll").evaluate((element) => {
    const top = element.getBoundingClientRect().top;
    const verse = [...element.querySelectorAll<HTMLElement>("[data-scroll-anchor][data-anchor-verse]")].find((node) => node.getBoundingClientRect().bottom > top + 44)!;
    return { chapter: verse.dataset.anchorChapter!, verse: verse.dataset.anchorVerse!, offset: verse.getBoundingClientRect().top - top };
  });
  const expectReadingPosition = async () => {
    const verse = page.locator(`[data-anchor-chapter="${anchor.chapter}"][data-anchor-verse="${anchor.verse}"]`);
    await expect.poll(async () => {
      const top = await page.locator(".bible-pane-scroll").evaluate((element) => element.getBoundingClientRect().top);
      return Math.abs(await verse.evaluate((element) => element.getBoundingClientRect().top) - top - anchor.offset);
    }).toBeLessThan(3);
  };
  const input = page.locator(".composer textarea");
  await input.fill("分屏切换保留草稿");
  const separator = page.getByRole("separator", { name: "调整圣经和聊天宽度" });
  for (const ratio of [0.25, 0.75, 0.5]) {
    const box = (await separator.boundingBox())!;
    await page.mouse.move(box.x + 6, box.y + 100);
    await page.mouse.down();
    await page.mouse.move((1600 - 12) * ratio + 10, box.y + 100, { steps: 10 });
    await page.mouse.up();
    await expectRatio(page, ratio);
    await expectReadingPosition();
  }
  await separator.hover({ position: { x: 6, y: 200 } });
  const swap = page.getByRole("button", { name: "左右交换圣经和聊天", exact: true });
  await swap.click();
  await expectReadingPosition();
  await expect(input).toHaveValue("分屏切换保留草稿");
  await swap.click();
  await expectReadingPosition();
  await separator.focus();
  await separator.press("ArrowRight");
  await expectRatio(page, 0.52);
  await page.getByRole("button", { name: "圣经全屏", exact: true }).click();
  await expect(page.locator(".chat-pane")).toHaveCount(0);
  await expect(page.locator(".messages-scroll, .handwriting-message, .drip-layer, .drip-gooey-layer")).toHaveCount(0);
  expect((await page.locator(".bible-workspace").boundingBox())!.width).toBe(1600);
  await page.getByRole("button", { name: "缩小圣经，恢复分屏", exact: true }).click();
  await expectRatio(page, 0.52);
  await expect(input).toHaveValue("分屏切换保留草稿");
  await expectReadingPosition();
  await page.getByRole("button", { name: "关闭圣经", exact: true }).click();
  expect((await page.locator(".chat-pane").boundingBox())!.width).toBe(1600);
  await page.getByRole("button", { name: "打开圣经", exact: true }).click();
  await expectRatio(page, 0.52);
  await page.getByRole("button", { name: "展开频道", exact: true }).click();
  await expect(page.locator(".channel-pane")).toBeVisible();
  await expectRatio(page, 0.52);
  await page.locator(".scrim").click({ position: { x: 500, y: 250 } });
  await expect(page.locator(".channel-pane")).toBeHidden();
  await page.getByRole("button", { name: "更多管理功能", exact: true }).click();
  await page.getByRole("menuitem", { name: "成员列表", exact: true }).click();
  await expect(page.locator(".member-pane")).toBeVisible();
  await expectRatio(page, 0.52);
  await page.getByRole("button", { name: "收起成员", exact: true }).click();
  await expect(page.locator(".member-pane")).toBeHidden();
  await page.screenshot({ path: "output/e2e/bible-split-desktop.png" });
  await page.reload();
  await expectRatio(page, 0.5);
});

test("split Bible sends a verse to the newly selected chat channel", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page);
  await openReading(page);
  await page.getByRole("button", { name: "展开频道", exact: true }).click();
  await page.locator(".channel-row").filter({ hasText: E2E_CHANNELS.secondary }).first().click();
  await page.getByRole("button", { name: "收起频道", exact: true }).click();
  await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.secondary);
  await page.locator('[data-verse-key="PSA-66-1"]').click();
  await page.locator(".bible-pane-verse-action").getByRole("button", { name: "发送", exact: true }).click();
  const share = page.getByRole("dialog", { name: "分享经文", exact: true });
  await expect(share.getByLabel("显示版本信息")).not.toBeChecked();
  await share.getByRole("button", { name: "发送到聊天室", exact: true }).click();
  const cards = page.locator(".messages-scroll .bible-passage-share-card");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("诗篇 66:1");
  await expect(cards.first().locator(".reading-share-meta")).toHaveCount(0);
  await expect(page.locator(".bible-toast")).toContainText(E2E_CHANNELS.secondary);
  await page.locator(".bible-pane-verse-action").getByRole("button", { name: "发送", exact: true }).click();
  await share.getByLabel("显示版本信息").check();
  await expect(share.locator(".passage-share-preview small")).toContainText("和合本");
  await share.getByRole("button", { name: "发送到聊天室", exact: true }).click();
  await expect(cards).toHaveCount(2);
  await expect(cards.last().locator(".reading-share-meta")).toContainText("和合本");
  await page.locator(".bible-pane-verse-action").getByRole("button", { name: "发送", exact: true }).click();
  await expect(share.getByLabel("显示版本信息")).not.toBeChecked();
  await share.press("Escape");
  await expect(share).toHaveCount(0);
  await page.reload();
  await expect(cards).toHaveCount(2);
  await expect(cards.first().locator(".reading-share-meta")).toHaveCount(0);
  await expect(cards.last().locator(".reading-share-meta")).toContainText("和合本");
});

test("fullscreen Bible suspends chat visuals, receives messages and preserves the history position", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const { adminToken } = await login(page);
  await page.getByRole("button", { name: "展开频道", exact: true }).click();
  await page.locator(".channel-row").filter({ hasText: E2E_PERF.channel }).first().click();
  await page.getByRole("button", { name: "收起频道", exact: true }).click();
  await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_PERF.channel);
  const scroller = page.locator(".messages-scroll");
  await expect(scroller).toContainText(E2E_PERF.messagePrefix);
  await scroller.hover();
  await page.mouse.wheel(0, -800);
  await expect(page.getByRole("button", { name: "跳到最新消息", exact: true })).toBeVisible();
  await page.waitForTimeout(250);
  const anchor = await scroller.evaluate((element) => {
    const top = element.getBoundingClientRect().top;
    const message = [...element.querySelectorAll<HTMLElement>("[data-message-id]")].find((node) => node.getBoundingClientRect().bottom > top)!;
    return { id: message.dataset.messageId!, offset: message.getBoundingClientRect().top - top };
  });
  await page.getByRole("button", { name: "圣经全屏", exact: true }).click();
  await expect(scroller).toHaveCount(0);
  const { channelId } = await chatState(page);
  const hiddenMessage = `全屏时接收消息 ${randomUUID()}`;
  const sent = await page.request.post("/api/messages", {
    headers: { Authorization: `Bearer ${adminToken}` },
    data: { channelId, content: hiddenMessage, type: "text", payload: { effect: "drip" } }
  });
  expect(sent.ok()).toBeTruthy();
  await expect.poll(async () => (await chatState(page)).contents.some((content) => content.includes(hiddenMessage))).toBe(true);
  // Pending scroll-idle work and incoming effects must not reattach chat visuals.
  await page.waitForTimeout(700);
  await expect(page.locator(".chat-pane, .messages-scroll, .handwriting-message, .drip-layer, .drip-gooey-layer")).toHaveCount(0);
  await page.getByRole("button", { name: "缩小圣经，恢复分屏", exact: true }).click();
  await expect.poll(async () => {
    const top = await scroller.evaluate((element) => element.getBoundingClientRect().top);
    const message = page.locator(`[data-message-id="${anchor.id}"]`).first();
    return Math.abs(await message.evaluate((element) => element.getBoundingClientRect().top) - top - anchor.offset);
  }).toBeLessThan(4);
  await page.getByRole("button", { name: "跳到最新消息", exact: true }).click();
  await expect(scroller).toContainText(hiddenMessage);
});

for (const engine of ["chromium", "webkit"] as const) {
  test(`iPad ${engine} keeps usable widths through touch dragging and window changes`, async ({ browser, baseURL }) => {
    const owned = engine === "webkit" ? await webkit.launch() : null;
    const context = await (owned || browser).newContext({ baseURL, viewport: { width: 1024, height: 768 }, screen: { width: 1024, height: 768 }, hasTouch: true, isMobile: true, serviceWorkers: "block" });
    try {
      const page = await context.newPage();
      await login(page);
      await expectRatio(page, 0.5);
      const swap = page.getByRole("button", { name: "左右交换圣经和聊天", exact: true });
      await expectTopSwapAlignment(page);
      await swap.tap();
      expect((await page.locator(".chat-pane").boundingBox())!.x).toBe(0);
      await swap.tap();
      await expect.poll(async () => (await page.locator(".chat-pane").boundingBox())!.x).toBeGreaterThan(0);
      await expectRatio(page, 0.5);
      const separator = page.getByRole("separator", { name: "调整圣经和聊天宽度" });
      const box = (await separator.boundingBox())!;
      if (engine === "chromium") {
        const cdp = await context.newCDPSession(page);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + 6, y: 300, id: 1 }] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 380, y: 300, id: 1 }] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      } else {
        await page.mouse.move(box.x + 6, 300);
        await page.mouse.down();
        await page.mouse.move(380, 300, { steps: 5 });
        await page.mouse.up();
      }
      await expectRatio(page, 374 / 1012);
      await page.setViewportSize({ width: 768, height: 1024 });
      await expectTopSwapAlignment(page);
      await expectRatio(page, 320 / 756);
      await openReading(page);
      await page.screenshot({ path: `output/e2e/bible-split-ipad-${engine}.png` });
      await page.setViewportSize({ width: 600, height: 900 });
      await expect(page.locator(".chat-pane")).toBeHidden();
      await expect(separator).toHaveCount(0);
      await page.setViewportSize({ width: 1024, height: 768 });
      await expectRatio(page, 374 / 1012);
      await expect(page.locator('[data-verse-key="PSA-66-1"]')).toBeVisible();
    } finally { await context.close(); await owned?.close(); }
  });
}

for (const width of [360, 390]) {
  test(`phone ${width} starts with chat and opens Bible as one full panel`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport: { width, height: 844 }, screen: { width, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: "block" });
    try {
      const page = await context.newPage();
      await login(page);
      await expect(page.locator(".bible-workspace")).toBeHidden();
      expect((await page.locator(".chat-pane").boundingBox())!.width).toBe(width);
      await page.getByRole("button", { name: "打开圣经", exact: true }).click();
      await expect(page.locator(".chat-pane")).toBeHidden();
      await expect(page.getByRole("separator", { name: "调整圣经和聊天宽度" })).toHaveCount(0);
      await openReading(page);
      await page.screenshot({ path: `output/e2e/bible-split-phone-${width}.png` });
      await page.getByRole("button", { name: "关闭圣经", exact: true }).click();
      await expect(page.locator(".chat-pane")).toBeVisible();
      await page.setViewportSize({ width: 844, height: width });
      await page.getByRole("button", { name: "打开圣经", exact: true }).click();
      await expect(page.locator(".chat-pane")).toBeHidden();
      await expect(page.getByRole("separator", { name: "调整圣经和聊天宽度" })).toHaveCount(0);
    } finally { await context.close(); }
  });
}

for (const engine of ["chromium", "webkit"] as const) {
  test(`Bible allocated width keeps catalog, chapters and narrow pane controls usable (${engine})`, async ({ browser, baseURL }) => {
    const owned = engine === "webkit" ? await webkit.launch() : null;
    const context = await (owned || browser).newContext({ baseURL, viewport: { width: 1600, height: 1000 }, serviceWorkers: "block" });
    try {
      const page = await context.newPage();
      await login(page);
      const home = page.locator(".bible-home");
      expect(await home.evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft))).toBeLessThanOrEqual(24);
      const tabs = page.getByRole("tablist", { name: "书房功能" });
      expect(await tabs.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBeTruthy();
      for (const width of [1280, 1378, 1600]) {
        await page.setViewportSize({ width, height: 1000 });
        if (width === 1378) await page.screenshot({ path: `output/e2e/bible-catalog-${engine}.png` });
        await page.getByRole("button", { name: /^创世记/ }).click();
        const chapter = page.locator(".bible-chapter-grid button").first();
        expect((await chapter.boundingBox())!.width).toBeGreaterThanOrEqual(40);
        expect(await page.locator(".bible-chapter-picker").evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
        if (width === 1378) await page.screenshot({ path: `output/e2e/bible-chapters-${engine}.png` });
        await page.getByRole("button", { name: "返回经卷目录", exact: true }).click();
      }
      await openReading(page);
      for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "添加圣经阅读窗格", exact: true }).click();
      const pane = page.locator(".bible-reader-pane").first();
      const trigger = pane.getByRole("button", { name: "展开 A 窗格导航" });
      await expect(trigger).toBeVisible();
      await trigger.click();
      const controls = pane.locator(".bible-pane-toolbar select, .bible-pane-toolbar button:visible");
      const boxes = await controls.evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width }; }));
      const bounds = (await pane.boundingBox())!;
      for (const [i, box] of boxes.entries()) {
        expect(box.width).toBeGreaterThanOrEqual(28);
        expect(box.x).toBeGreaterThanOrEqual(bounds.x);
        expect(box.right).toBeLessThanOrEqual(bounds.x + bounds.width + 1);
        for (const other of boxes.slice(i + 1)) expect(box.right <= other.x + 1 || other.right <= box.x + 1 || box.bottom <= other.y + 1 || other.bottom <= box.y + 1).toBeTruthy();
      }
      await pane.getByLabel("选择圣经书卷").selectOption("GEN");
      await pane.getByLabel("选择章节", { exact: true }).selectOption("2");
      await expect(pane.locator('[data-verse-key="GEN-2-1"]')).toBeVisible();
      await page.screenshot({ path: `output/e2e/bible-expanded-navigation-${engine}.png` });
      await pane.getByRole("button", { name: "收起 A 窗格导航" }).click();
      await expect(pane.getByLabel("选择圣经书卷")).toBeHidden();
      await page.screenshot({ path: `output/e2e/bible-narrow-panes-${engine}.png` });
    } finally { await context.close(); await owned?.close(); }
  });
}
