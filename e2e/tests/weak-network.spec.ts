import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMIN, E2E_CHANNELS } from "../seed-data.js";

async function blockPublicNetwork(page: Page) {
  await page.route("**/*", async (route) => {
    const hostname = new URL(route.request().url()).hostname;
    if (hostname === "127.0.0.1" || hostname === "localhost") {
      await route.continue();
      return;
    }
    await route.abort("blockedbyclient");
  });
}

async function loginAsAdmin(page: Page) {
  await page.goto("/");
  await page.getByPlaceholder("用户名").fill(E2E_ADMIN.username);
  await page.getByPlaceholder("密码").fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
}

// 只拦截消息列表 GET；同前缀的 /api/messages/unread-counts 等接口必须放行。
async function interceptMessageListGet(page: Page, handler: "hang" | "fail" | "delay") {
  await page.route("**/api/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname !== "/api/messages" || request.method() !== "GET") {
      await route.continue();
      return;
    }
    if (handler === "hang") {
      // 模拟挂起的连接：服务器长时间不返回任何字节。
      // Playwright 无法滴灌"先返回响应头再卡住 body"的部分响应，这里以整体挂起代替。
      await new Promise((resolve) => setTimeout(resolve, 90_000));
      await route.abort("timedout").catch(() => undefined);
      return;
    }
    if (handler === "fail") {
      await route.abort("failed");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.continue();
  });
}

async function readChatStoreState(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector("#app") as HTMLElement & { __vue_app__?: { _context?: { provides?: Record<PropertyKey, unknown> } } };
    const provides = root?.__vue_app__?._context?.provides;
    const pinia = Reflect.ownKeys(provides || {}).map((key) => provides?.[key]).find((value) => value && typeof value === "object" && "_s" in value) as
      | { _s?: Map<string, Record<string, unknown>> }
      | undefined;
    const store = [...(pinia?._s?.values() || [])].find((candidate) => "connectionState" in candidate && "messages" in candidate) as
      | {
          messages?: Array<{ channelId: number }>;
          currentChannelId?: number;
          loadingInitialMessages?: boolean;
          messageLoadError?: string;
        }
      | undefined;
    if (!store || !Array.isArray(store.messages)) return { found: false as const };
    return {
      found: true as const,
      currentChannelId: store.currentChannelId ?? 0,
      messageCount: store.messages.length,
      allMessagesInCurrentChannel: store.messages.every((message) => message.channelId === store.currentChannelId),
      settled: store.loadingInitialMessages === false,
      messageLoadError: store.messageLoadError || ""
    };
  });
}

test.beforeEach(async ({ page }) => {
  await blockPublicNetwork(page);
});

test("挂起的消息请求在 GET 超时预算内失败并给出可重试错误横幅", async ({ page }) => {
  test.setTimeout(150_000);
  await loginAsAdmin(page);
  await interceptMessageListGet(page, "hang");

  const startedAt = Date.now();
  await page.getByRole("button", { name: new RegExp(`${E2E_CHANNELS.secondary}$`) }).click();

  // 切换频道先清空消息再加载，期间必须出现加载中横幅而不是白屏。
  await expect(page.locator(".message-load-banner.message-load-loading")).toHaveText("正在加载最近消息...");

  // GET 预算为每次 20s 超时 + 一次 400ms 间隔的重试，最坏约 40.4s 后必须报错，不能无限挂起。
  const errorBanner = page.locator(".message-load-banner.message-load-error");
  await expect(errorBanner).toContainText("请求超时，请检查网络后重试", { timeout: 60_000 });
  const elapsedMs = Date.now() - startedAt;
  expect(elapsedMs).toBeGreaterThan(39_000);
  expect(elapsedMs).toBeLessThan(55_000);
});

test("弱网延迟下快速往返切换频道，消息窗口始终属于当前频道", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await loginAsAdmin(page);

  const marker = `弱网往返标记 ${Date.now()}`;
  await page.locator(".composer-main textarea").fill(marker);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator("[data-message-id]").filter({ hasText: marker })).toHaveCount(1);

  // 统一给消息列表请求加 600ms 延迟；B 的响应会晚于再次切回 A 的点击到达，
  // 过期响应必须被丢弃（S2 消息请求代际隔离）。
  await interceptMessageListGet(page, "delay");
  await page.getByRole("button", { name: new RegExp(`${E2E_CHANNELS.secondary}$`) }).click();
  await page.getByRole("button", { name: new RegExp(`${E2E_CHANNELS.default}$`) }).click();

  await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
  await expect(page.locator("[data-message-id]").filter({ hasText: marker })).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator(".message-load-banner.message-load-error")).toHaveCount(0);
  await expect
    .poll(
      async () => {
        const state = await readChatStoreState(page);
        return state.found && state.settled && state.messageCount > 0 && state.allMessagesInCurrentChannel;
      },
      { timeout: 15_000 }
    )
    .toBe(true);
});

test("消息加载失败后可点按错误横幅手动重试并恢复", async ({ page }) => {
  test.setTimeout(60_000);
  await loginAsAdmin(page);

  // 先在第二频道放一条消息，重试成功后必须能看到它。
  const recoveryMessage = `弱网重试恢复消息 ${Date.now()}`;
  const setup = await page.evaluate(async ({ channelName, content }) => {
    const root = document.querySelector("#app") as HTMLElement & { __vue_app__?: { _context?: { provides?: Record<PropertyKey, unknown> } } };
    const provides = root?.__vue_app__?._context?.provides;
    const pinia = Reflect.ownKeys(provides || {}).map((key) => provides?.[key]).find((value) => value && typeof value === "object" && "_s" in value) as
      | { _s?: Map<string, Record<string, unknown>> }
      | undefined;
    const store = [...(pinia?._s?.values() || [])].find((candidate) => "connectionState" in candidate && "channels" in candidate) as
      | { channels?: Array<{ id: number; name: string }> }
      | undefined;
    const channel = store?.channels?.find((entry) => entry.name === channelName);
    if (!channel) return { ok: false as const, reason: "channel-not-found" };
    const response = await fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("team-chat-token") || ""}` },
      body: JSON.stringify({ channelId: channel.id, content, type: "text" })
    });
    return { ok: response.ok, status: response.status };
  }, { channelName: E2E_CHANNELS.secondary, content: recoveryMessage });
  expect(setup).toMatchObject({ ok: true });

  // 快速失败（连接被拒）：GET 重试一次后仍失败，必须出现错误横幅。
  await interceptMessageListGet(page, "fail");
  await page.getByRole("button", { name: new RegExp(`${E2E_CHANNELS.secondary}$`) }).click();
  const errorBanner = page.locator(".message-load-banner.message-load-error");
  await expect(errorBanner).toBeVisible({ timeout: 15_000 });

  // 恢复网络后点按横幅重试：横幅消失、目标频道的消息渲染出来。
  await page.unroute("**/api/*");
  await errorBanner.click();
  await expect(page.locator("[data-message-id]").filter({ hasText: recoveryMessage })).toHaveCount(1, { timeout: 15_000 });
  await expect(errorBanner).toHaveCount(0);
  // 第二频道只有一条消息，加载落定后应出现"已到最早消息"的完成横幅。
  await expect(page.locator(".message-load-banner.message-load-done")).toHaveText("已到最早消息");
  await expect
    .poll(async () => {
      const state = await readChatStoreState(page);
      return state.found && state.settled && state.messageLoadError === "";
    })
    .toBe(true);
});
