import { expect, test, type Browser, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { E2E_ADMIN, E2E_CHANNELS, E2E_PERF } from "../seed-data.js";

// 性能基线不是门禁：只记录采样结果，不设阈值断言（阈值会随机器漂移，见 e2e/README.md）。
// 轮数可用 E2E_PERF_ROUNDS 调整，默认 5。
const ROUNDS = Math.max(1, Number(process.env.E2E_PERF_ROUNDS || 5) || 5);
const SCROLL_STEPS = 8;

const outputDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../output/e2e");
const runStamp = new Date().toISOString().replace(/[:.]/g, "-");

type Condition = "normal" | "throttled";

interface RoundSample {
  condition: Condition;
  round: number;
  firstEntryMs: number;
  perfChannelSwitchMs: number;
  switchBackMs: number;
  scrollLongtaskCount: number;
  scrollLongtaskTotalMs: number;
  scrollLongtaskMaxMs: number;
  scrollDomRows: number;
  cls: number;
  apiRequestCount: number;
  linkPreviewRequestCount: number;
  linkPreviewRequestsAtSwitchSettled: number;
  heapUsedMB: number | null;
  hiddenTabSupported: boolean;
  hiddenTabDelivered: boolean | null;
}

const samples: RoundSample[] = [];

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

async function installPerfObservers(page: Page) {
  await page.addInitScript(() => {
    const sink = { longtasks: [] as number[], cls: 0 };
    (window as unknown as { __perf: typeof sink }).__perf = sink;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) sink.longtasks.push(entry.duration);
      }).observe({ type: "longtask", buffered: true });
    } catch {
      // longtask 仅在 Chromium 可用；不支持时保持空数组。
    }
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
          if (!shift.hadRecentInput) sink.cls += shift.value || 0;
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      // layout-shift 不可用时保持 0。
    }
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
          channels?: Array<{ id: number; name: string }>;
          messages?: Array<{ channelId: number }>;
          currentChannelId?: number;
          loadingInitialMessages?: boolean;
        }
      | undefined;
    if (!store) return { found: false as const };
    return {
      found: true as const,
      channels: store.channels || [],
      currentChannelId: store.currentChannelId ?? 0,
      messageCount: store.messages?.length ?? 0,
      settled: store.loadingInitialMessages === false
    };
  });
}

async function waitStoreSettled(page: Page, channelId: number, timeout: number) {
  await expect
    .poll(
      async () => {
        const state = await readChatStoreState(page);
        return state.found && state.currentChannelId === channelId && state.settled;
      },
      { timeout }
    )
    .toBe(true);
}

async function runRound(browser: Browser, condition: Condition, round: number): Promise<RoundSample> {
  // 每轮使用全新浏览器上下文，保证冷启动条件一致。
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const expectTimeout = condition === "throttled" ? 45_000 : 20_000;
  try {
    await blockPublicNetwork(page);
    await installPerfObservers(page);
    let apiRequestCount = 0;
    let linkPreviewRequestCount = 0;
    page.on("request", (request) => {
      try {
        const pathname = new URL(request.url()).pathname;
        if (pathname.startsWith("/api/")) apiRequestCount += 1;
        if (pathname === "/api/link-preview") linkPreviewRequestCount += 1;
      } catch {
        // 忽略无法解析的 URL。
      }
    });

    if (condition === "throttled") {
      // 仅 Chromium 支持 CDP 节流；playwright.config 已固定 Desktop Chrome。
      const session = await context.newCDPSession(page);
      await session.send("Network.enable");
      await session.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 400,
        downloadThroughput: 204_800,
        uploadThroughput: 93_750
      });
      await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    }

    // ① 首次进入：打开应用到默认频道首屏加载完成。
    const entryStart = Date.now();
    await page.goto("/");
    await page.getByPlaceholder("用户名").fill(E2E_ADMIN.username);
    await page.getByPlaceholder("密码").fill(E2E_ADMIN.password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default, { timeout: expectTimeout });
    const initialState = await readChatStoreState(page);
    if (!initialState.found) throw new Error("chat store was not found");
    const defaultChannel = initialState.channels.find((channel) => channel.name === E2E_CHANNELS.default);
    const perfChannel = initialState.channels.find((channel) => channel.name === E2E_PERF.channel);
    if (!defaultChannel || !perfChannel) throw new Error("seeded channels were not found");
    await waitStoreSettled(page, defaultChannel.id, expectTimeout);
    const firstEntryMs = Date.now() - entryStart;

    // ② 切到 300 条消息的性能频道，到首条消息渲染且加载落定。
    const perfSwitchStart = Date.now();
    await page.getByRole("button", { name: new RegExp(`${E2E_PERF.channel}$`) }).click();
    await expect(page.locator("[data-message-id]").first()).toBeVisible({ timeout: expectTimeout });
    await waitStoreSettled(page, perfChannel.id, expectTimeout);
    const perfChannelSwitchMs = Date.now() - perfSwitchStart;
    // 切频道落定瞬间的预览请求数：预取只应覆盖可见窗口，不应扫整个已加载消息窗。
    const linkPreviewRequestsAtSwitchSettled = linkPreviewRequestCount;

    // ③ 连续向上滚动，记录滚动窗口内的 longtask 与消息行数。
    await page.evaluate(() => {
      (window as unknown as { __perf: { longtasks: number[] } }).__perf.longtasks.length = 0;
    });
    const scroller = page.locator(".messages-scroll");
    for (let step = 0; step < SCROLL_STEPS; step += 1) {
      await scroller.evaluate((element) => {
        element.scrollTop = Math.max(0, element.scrollTop - element.clientHeight);
      });
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(600);
    const scrollStats = await page.evaluate(() => {
      const perf = (window as unknown as { __perf: { longtasks: number[]; cls: number } }).__perf;
      return {
        longtasks: [...perf.longtasks],
        cls: perf.cls,
        domRows: document.querySelectorAll("[data-message-id]").length
      };
    });

    // ④ 切回默认频道。
    const switchBackStart = Date.now();
    await page.getByRole("button", { name: new RegExp(`${E2E_CHANNELS.default}$`) }).click();
    await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default, { timeout: expectTimeout });
    const switchBackMs = Date.now() - switchBackStart;

    // ⑤ 后台停留：切到同上下文的第二个页面使聊天页 hidden，期间经 API 发一条消息，
    //    回到前台后该消息必须渲染（socket 推送或聚焦刷新任一路径均可）。
    const backgroundPage = await context.newPage();
    await backgroundPage.goto("about:blank");
    await page.waitForTimeout(400);
    const visibility = await page.evaluate(() => document.visibilityState);
    const hiddenTabSupported = visibility === "hidden";
    let hiddenTabDelivered: boolean | null = null;
    if (hiddenTabSupported) {
      const hiddenMessage = `后台停留消息 ${condition} ${round} ${Date.now()}`;
      const posted = await page.request.post("/api/messages", {
        data: { channelId: defaultChannel.id, content: hiddenMessage, type: "text" }
      });
      if (!posted.ok()) throw new Error(`后台消息发送失败: ${posted.status()}`);
      await page.waitForTimeout(1_500);
      await page.bringToFront();
      await expect(page.locator("[data-message-id]").filter({ hasText: hiddenMessage })).toHaveCount(1, { timeout: 15_000 });
      hiddenTabDelivered = true;
    }
    await backgroundPage.close().catch(() => undefined);

    const heapUsedBytes = await page.evaluate(() => {
      const memory = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory;
      return typeof memory?.usedJSHeapSize === "number" ? memory.usedJSHeapSize : null;
    });

    return {
      condition,
      round,
      firstEntryMs,
      perfChannelSwitchMs,
      switchBackMs,
      scrollLongtaskCount: scrollStats.longtasks.length,
      scrollLongtaskTotalMs: Math.round(scrollStats.longtasks.reduce((total, duration) => total + duration, 0)),
      scrollLongtaskMaxMs: Math.round(scrollStats.longtasks.reduce((max, duration) => Math.max(max, duration), 0)),
      scrollDomRows: scrollStats.domRows,
      cls: Math.round(scrollStats.cls * 1000) / 1000,
      apiRequestCount,
      linkPreviewRequestCount,
      linkPreviewRequestsAtSwitchSettled,
      heapUsedMB: heapUsedBytes === null ? null : Math.round(heapUsedBytes / 1024 / 1024),
      hiddenTabSupported,
      hiddenTabDelivered
    };
  } finally {
    await context.close().catch(() => undefined);
  }
}

function summarize(values: Array<number | null>) {
  const numbers = values.filter((value): value is number => typeof value === "number").sort((a, b) => a - b);
  if (!numbers.length) return "-";
  const mid = Math.floor(numbers.length / 2);
  const median = numbers.length % 2 ? numbers[mid] : (numbers[mid - 1] + numbers[mid]) / 2;
  return `${Math.round(median)}（${numbers[0]}–${numbers[numbers.length - 1]}）`;
}

test("性能基线采样：正常网络", async ({ browser }) => {
  test.setTimeout(600_000);
  for (let round = 1; round <= ROUNDS; round += 1) {
    samples.push(await runRound(browser, "normal", round));
  }
});

test("性能基线采样：弱网节流（400ms 延迟 + 4x CPU）", async ({ browser }) => {
  test.setTimeout(600_000);
  for (let round = 1; round <= ROUNDS; round += 1) {
    samples.push(await runRound(browser, "throttled", round));
  }
});

test.afterAll(() => {
  if (!samples.length) return;
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(path.join(outputDir, `perf-baseline-${runStamp}.json`), JSON.stringify({ runStamp, rounds: ROUNDS, samples }, null, 2));

  const metrics: Array<[string, (sample: RoundSample) => number | null]> = [
    ["首次进入 ms", (sample) => sample.firstEntryMs],
    ["切入性能频道 ms", (sample) => sample.perfChannelSwitchMs],
    ["切回默认频道 ms", (sample) => sample.switchBackMs],
    ["滚动 longtask 次数", (sample) => sample.scrollLongtaskCount],
    ["滚动 longtask 总时长 ms", (sample) => sample.scrollLongtaskTotalMs],
    ["滚动 longtask 最长 ms", (sample) => sample.scrollLongtaskMaxMs],
    ["滚动后消息 DOM 行数", (sample) => sample.scrollDomRows],
    ["CLS", (sample) => sample.cls],
    ["/api 请求数", (sample) => sample.apiRequestCount],
    ["链接预览请求数", (sample) => sample.linkPreviewRequestCount],
    ["切频道落定瞬间预览请求数", (sample) => sample.linkPreviewRequestsAtSwitchSettled],
    ["JS 堆内存 MB", (sample) => sample.heapUsedMB]
  ];
  const conditions: Array<[Condition, string]> = [
    ["normal", "正常网络"],
    ["throttled", "弱网节流（400ms 延迟 + 4x CPU）"]
  ];
  const lines = ["# 性能基线采样", "", `- 运行时间：${runStamp}`, `- 每条件轮数：${ROUNDS}`, "", "| 指标 | 正常网络 中位数（范围） | 弱网节流 中位数（范围） |", "| --- | --- | --- |"];
  for (const [label, pick] of metrics) {
    const cells = conditions.map(([condition]) => summarize(samples.filter((sample) => sample.condition === condition).map(pick)));
    lines.push(`| ${label} | ${cells[0]} | ${cells[1]} |`);
  }
  for (const [condition, label] of conditions) {
    const group = samples.filter((sample) => sample.condition === condition);
    const unsupported = group.filter((sample) => !sample.hiddenTabSupported).length;
    const failed = group.filter((sample) => sample.hiddenTabDelivered === false).length;
    lines.push("", `- ${label} 后台停留投递：${group.length - unsupported - failed}/${group.length} 轮验证通过${unsupported ? `，${unsupported} 轮环境不支持 hidden` : ""}`);
  }
  writeFileSync(path.join(outputDir, "perf-baseline-latest.md"), `${lines.join("\n")}\n`);
  console.log(`性能基线报告已写入 ${outputDir}`);
});
