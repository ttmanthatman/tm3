import { expect, test, type APIRequestContext, type Browser, type Locator, type Page } from "@playwright/test";
import { E2E_ADMIN, E2E_CHANNELS, E2E_MEMBER } from "../seed-data.js";

type Account = { username: string; password: string };

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

async function connectionState(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector("#app") as HTMLElement & { __vue_app__?: { _context?: { provides?: Record<PropertyKey, unknown> } } };
    const provides = root?.__vue_app__?._context?.provides;
    const pinia = Reflect.ownKeys(provides || {}).map((key) => provides?.[key]).find((value) => value && typeof value === "object" && "_s" in value) as
      | { _s?: Map<string, Record<string, unknown>> }
      | undefined;
    const store = [...(pinia?._s?.values() || [])].find((candidate) => "connectionState" in candidate && "socket" in candidate);
    return store?.connectionState;
  });
}

async function login(page: Page, account: Account) {
  await page.goto("/");
  await page.getByPlaceholder("用户名").fill(account.username);
  await page.getByPlaceholder("密码").fill(account.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
  await expect.poll(() => connectionState(page)).toBe("connected");
}

async function adminToken(request: APIRequestContext) {
  const response = await request.post("/api/auth/login", {
    data: { username: E2E_ADMIN.username, password: E2E_ADMIN.password, deviceName: "handwriting-e2e-setup" }
  });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { token: string }).token;
}

let memberCreatedByUs = false;

test.beforeAll(async ({ request }) => {
  const token = await adminToken(request);
  const created = await request.post("/api/admin/accounts", {
    headers: { Authorization: `Bearer ${token}` },
    data: { username: E2E_MEMBER.username, password: E2E_MEMBER.password, displayName: E2E_MEMBER.displayName }
  });
  if (created.ok()) {
    memberCreatedByUs = true;
    return;
  }
  expect(created.status()).toBe(409);
});

test.afterAll(async ({ request }) => {
  if (!memberCreatedByUs) return;
  const token = await adminToken(request);
  const headers = { Authorization: `Bearer ${token}` };
  const response = await request.get("/api/admin/accounts", { headers });
  const body = (await response.json()) as { accounts: Array<{ id: number; username: string }> };
  const member = body.accounts.find((account) => account.username === E2E_MEMBER.username);
  if (member) await request.delete(`/api/admin/accounts/${member.id}`, { headers });
});

async function openHandwritingComposer(page: Page) {
  await page.getByRole("button", { name: "更多功能", exact: true }).click();
  await page.getByRole("button", { name: "手写", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "逐字手写" });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function drawStroke(page: Page, canvas: Locator, points: Array<[number, number]>) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error("手写画板不可见");
  const [first, ...rest] = points;
  await page.mouse.move(box.x + box.width * first[0], box.y + box.height * first[1]);
  await page.mouse.down();
  for (const [x, y] of rest) {
    await page.mouse.move(box.x + box.width * x, box.y + box.height * y, { steps: 3 });
  }
  await page.mouse.up();
}

async function drawTouchStroke(canvas: Locator, points: Array<[number, number]>) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error("手写画板不可见");
  const eventPoint = (point: [number, number]) => ({
    clientX: box.x + box.width * point[0],
    clientY: box.y + box.height * point[1]
  });
  const [first, ...rest] = points;
  await canvas.dispatchEvent("pointerdown", {
    pointerId: 17,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    ...eventPoint(first)
  });
  for (const point of rest) {
    await canvas.dispatchEvent("pointermove", {
      pointerId: 17,
      pointerType: "touch",
      isPrimary: true,
      button: 0,
      ...eventPoint(point)
    });
  }
  await canvas.dispatchEvent("pointerup", {
    pointerId: 17,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    ...eventPoint(points.at(-1)!)
  });
}

async function setNativeColor(dialog: Locator, label: string, color: string) {
  const input = dialog.locator(`input[aria-label="${label}"]`);
  await input.evaluate((element, value) => {
    const field = element as HTMLInputElement;
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }, color);
}

async function longPressColorButton(dialog: Locator, label: string) {
  const button = dialog.getByRole("button", { name: label, exact: true });
  await button.dispatchEvent("pointerdown", { pointerId: 1, pointerType: "mouse", button: 0 });
  await dialog.page().waitForTimeout(500);
  await button.dispatchEvent("pointerup", { pointerId: 1, pointerType: "mouse", button: 0 });
}

async function composeTwoCharacters(page: Page, dialog: Locator) {
  const canvas = dialog.getByLabel("当前手写字格");
  await dialog.getByRole("button", { name: "选择朱红", exact: true }).click();
  await drawStroke(page, canvas, [[0.2, 0.25], [0.5, 0.2], [0.8, 0.3]]);
  await drawStroke(page, canvas, [[0.5, 0.2], [0.5, 0.75]]);
  await expect(dialog.locator(".handwriting-tip-mirror-frame")).toBeHidden();
  await dialog.screenshot({ path: "output/playwright/handwriting-brush-ink.png" });
  await dialog.getByRole("button", { name: "完成此字", exact: true }).click();
  await expect(dialog.getByText("1 / 30", { exact: true }).first()).toBeVisible();

  await dialog.getByRole("button", { name: "硬笔", exact: true }).click();
  await dialog.getByRole("button", { name: "选择蓝色", exact: true }).click();
  await drawStroke(page, canvas, [[0.22, 0.3], [0.78, 0.3]]);
  await drawStroke(page, canvas, [[0.3, 0.2], [0.7, 0.78]]);
  await expect(dialog.getByText(/发送时会包含尚未点“完成此字”的最后一字。/)).toBeVisible();
}

async function expectComposerInsideViewport(page: Page, dialog: Locator) {
  for (const width of [360, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(async () => {
      const box = await dialog.boundingBox();
      return box ? box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= 844 : false;
    }).toBe(true);
    const panel = await dialog.locator(".handwriting-composer-modal").boundingBox();
    expect(panel!.width).toBe(width);
    // WebKit rounds viewport CSS units to fractional pixels.
    expect(Math.abs(panel!.height - 844)).toBeLessThan(1);
    const pad = await dialog.getByLabel("当前手写字格").boundingBox();
    expect(pad!.width).toBeGreaterThanOrEqual(width < 600 ? width - 12 : 500);
  }
  await page.setViewportSize({ width: 390, height: 844 });
}

async function expectPaperAndGlowShareRow(page: Page, dialog: Locator) {
  for (const width of [360, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    const paperLabel = dialog.locator(".handwriting-paper-toggle");
    const glowLabel = dialog.locator(".handwriting-glow-toggle");
    await expect(paperLabel).toBeVisible();
    await expect(glowLabel).toBeVisible();
    const [paperBox, glowBox] = await Promise.all([paperLabel.boundingBox(), glowLabel.boundingBox()]);
    expect(paperBox).not.toBeNull();
    expect(glowBox).not.toBeNull();
    expect(Math.abs((paperBox!.y + paperBox!.height / 2) - (glowBox!.y + glowBox!.height / 2))).toBeLessThanOrEqual(2);
    expect(paperBox!.x).toBeLessThan(glowBox!.x);
    expect(paperBox!.x + paperBox!.width).toBeLessThanOrEqual(glowBox!.x);
    const toolsBox = await dialog.locator(".handwriting-tools").boundingBox();
    for (const button of await dialog.getByRole("group", { name: "笔画颜色" }).getByRole("button").all()) {
      const box = await button.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(toolsBox!.x);
      expect(box!.x + box!.width).toBeLessThanOrEqual(toolsBox!.x + toolsBox!.width);
    }
    await dialog.screenshot({ path: `output/playwright/handwriting-composer-${width}-dialog.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
}

async function latestHandwriting(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector("#app") as HTMLElement & { __vue_app__?: { _context?: { provides?: Record<PropertyKey, unknown> } } };
    const provides = root?.__vue_app__?._context?.provides;
    const pinia = Reflect.ownKeys(provides || {}).map((key) => provides?.[key]).find((value) => value && typeof value === "object" && "_s" in value) as
      | { _s?: Map<string, Record<string, unknown>> }
      | undefined;
    const store = [...(pinia?._s?.values() || [])].find((candidate) => "connectionState" in candidate && "messages" in candidate);
    const messages = (store?.messages || []) as Array<{ id: number; type: string; content: string; payload: unknown; clientRequestId?: string }>;
    const message = messages.filter((entry) => entry.type === "handwriting").at(-1);
    return message ? JSON.parse(JSON.stringify(message)) as typeof message : null;
  });
}

async function startCanvasSampling(page: Page, key: string, durationMs = 900) {
  await page.evaluate(({ sampleKey, duration }) => {
    const state = window as typeof window & { __handwritingSamples?: Record<string, string[]> };
    state.__handwritingSamples ||= {};
    state.__handwritingSamples[sampleKey] = [];
    const sample = () => {
      const root = [...document.querySelectorAll<HTMLElement>(".handwriting-message")].at(-1);
      const canvases = [...(root?.querySelectorAll<HTMLCanvasElement>("canvas") || [])];
      if (!canvases.length) return;
      let hasInk = false;
      for (const canvas of canvases) {
        const pixels = canvas.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data;
        if (pixels && pixels.some((value, index) => index % 4 === 3 && value > 0)) {
          hasInk = true;
          break;
        }
      }
      if (hasInk) state.__handwritingSamples![sampleKey].push(canvases.map((canvas) => canvas.toDataURL()).join("|"));
    };
    const timer = window.setInterval(sample, 16);
    window.setTimeout(() => window.clearInterval(timer), duration);
  }, { sampleKey: key, duration: durationMs });
}

async function distinctSampleCount(page: Page, key: string) {
  return page.evaluate((sampleKey) => {
    const samples = (window as typeof window & { __handwritingSamples?: Record<string, string[]> }).__handwritingSamples?.[sampleKey] || [];
    return new Set(samples).size;
  }, key);
}

async function canvasSignature(message: Locator) {
  return message.evaluate((element) => [...element.querySelectorAll<HTMLCanvasElement>("canvas")].map((canvas) => canvas.toDataURL()).join("|"));
}

async function newLoggedInPage(browser: Browser, account: Account) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await blockPublicNetwork(page);
  await login(page, account);
  return { context, page };
}

test("触屏毛笔显示固定笔尖镜并在抬笔后隐藏", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 844 });
  await login(page, E2E_MEMBER);
  const dialog = await openHandwritingComposer(page);
  await dialog.getByRole("button", { name: "毛笔", exact: true }).click();
  const canvas = dialog.getByLabel("当前手写字格");
  const mirror = dialog.locator(".handwriting-tip-mirror-frame");
  await drawTouchStroke(canvas, [[0.25, 0.35], [0.5, 0.5], [0.76, 0.32]]);
  await expect(mirror).toBeHidden();

  const box = await canvas.boundingBox();
  if (!box) throw new Error("手写画板不可见");
  await canvas.dispatchEvent("pointerdown", {
    pointerId: 18,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    clientX: box.x + box.width * 0.3,
    clientY: box.y + box.height * 0.3
  });
  await expect(mirror).toBeVisible();
  const mobileMirror = await mirror.boundingBox();
  expect(mobileMirror!.width).toBe(140);
  expect(mobileMirror!.height).toBe(124);
  expect(mobileMirror!.x).toBeGreaterThanOrEqual(box.x);
  expect(mobileMirror!.x + mobileMirror!.width).toBeLessThanOrEqual(box.x + box.width);
  await dialog.screenshot({ path: "output/playwright/handwriting-tip-mirror-touch-mobile.png" });

  await page.setViewportSize({ width: 1280, height: 844 });
  await expect.poll(async () => (await mirror.boundingBox())?.width).toBe(160);
  const desktopMirror = await mirror.boundingBox();
  const desktopCanvas = await canvas.boundingBox();
  expect(desktopMirror!.height).toBe(140);
  expect(desktopMirror!.x).toBeGreaterThanOrEqual(desktopCanvas!.x);
  expect(desktopMirror!.x + desktopMirror!.width).toBeLessThanOrEqual(desktopCanvas!.x + desktopCanvas!.width);
  await dialog.screenshot({ path: "output/playwright/handwriting-tip-mirror-touch-desktop.png" });
  await canvas.dispatchEvent("pointerup", {
    pointerId: 18,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    clientX: desktopCanvas!.x + desktopCanvas!.width * 0.3,
    clientY: desktopCanvas!.y + desktopCanvas!.height * 0.3
  });
  await expect(mirror).toBeHidden();
});

test("两账号真实收发、刷新静态、手动重播、重连与撤回", async ({ browser }) => {
  test.setTimeout(90_000);
  const senderSession = await newLoggedInPage(browser, E2E_ADMIN);
  const receiverSession = await newLoggedInPage(browser, E2E_MEMBER);
  const sender = senderSession.page;
  const receiver = receiverSession.page;

  try {
    const dialog = await openHandwritingComposer(sender);
    await dialog.getByRole("button", { name: "毛笔", exact: true }).click();
    await dialog.getByText("毛笔参数", { exact: true }).click();
    await dialog.getByRole("slider", { name: "毛笔粗细" }).fill("55");
    await dialog.getByRole("slider", { name: "毛笔速度响应" }).fill("75");
    await dialog.getByRole("slider", { name: "毛笔笔头滞后" }).fill("40");
    await dialog.getByText("毛笔参数", { exact: true }).click();
    await expect(dialog.getByText("已完成的字", { exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("group", { name: "笔画颜色", exact: true })).toBeVisible();
    await expect(dialog.getByText("当前字格", { exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "清空当前字", exact: true })).toHaveCount(0);
    await expect(dialog.getByText("小秘密：长按调出调色盘", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "自定义颜色", exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "自定义颜色", exact: true }).click();
    const customPicker = dialog.getByRole("dialog", { name: "调色盘" });
    await expect(customPicker).toBeVisible();
    await expect(customPicker.locator('input[type="color"]')).toBeVisible();
    await setNativeColor(customPicker, "调色盘颜色", "#123456");
    await expect(customPicker).toBeVisible();
    await expect(customPicker.locator('input[aria-label="调色盘颜色"]')).toHaveValue("#123456");
    await customPicker.getByRole("button", { name: "关闭调色盘", exact: true }).click();
    await longPressColorButton(dialog, "选择朱红");
    const slotPicker = dialog.getByRole("dialog", { name: "调色盘" });
    await expect(slotPicker).toBeVisible();
    await expect(slotPicker.locator('input[type="color"]')).toBeVisible();
    await setNativeColor(slotPicker, "调色盘颜色", "#ff2d55");
    await expect(slotPicker).toBeVisible();
    await expect(slotPicker.locator('input[aria-label="调色盘颜色"]')).toHaveValue("#ff2d55");
    await slotPicker.getByRole("button", { name: "关闭调色盘", exact: true }).click();
    await dialog.getByRole("checkbox", { name: "显示纸张" }).check();
    await setNativeColor(dialog, "纸张颜色", "#fff1d6");
    await dialog.getByRole("checkbox", { name: "光晕" }).check();
    await expectPaperAndGlowShareRow(sender, dialog);
    await setNativeColor(dialog, "光晕颜色", "#aabbcc");
    await dialog.getByRole("slider", { name: "光晕密度" }).fill("72");
    await dialog.getByRole("slider", { name: "光晕宽度" }).fill("48");
    await expectComposerInsideViewport(sender, dialog);
    await composeTwoCharacters(sender, dialog);
    await dialog.getByRole("button", { name: "预览播放", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "停止预览", exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "预览播放", exact: true })).toBeVisible();

    await startCanvasSampling(receiver, "realtime");
    await dialog.getByRole("button", { name: "发送", exact: true }).click();
    await expect(dialog).toBeHidden();

    const receiverMessage = receiver.getByRole("button", { name: "手写消息，共 2 字，点击重新播放", exact: true }).last();
    await expect(receiverMessage).toBeVisible();
    expect(await receiverMessage.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(255, 241, 214)");
    await receiver.waitForTimeout(950);
    expect(await distinctSampleCount(receiver, "realtime")).toBeGreaterThan(1);

    const [senderDto, receiverDto] = await Promise.all([latestHandwriting(sender), latestHandwriting(receiver)]);
    expect(senderDto).not.toBeNull();
    expect(receiverDto).toMatchObject({
      id: senderDto!.id,
      content: "[手写消息]",
      type: "handwriting",
      payload: senderDto!.payload
    });
    expect((receiverDto!.payload as { characters: unknown[] }).characters).toHaveLength(2);
    expect(receiverDto!.payload).toMatchObject({
      paper: { color: "#fff1d6" },
      glow: { color: "#aabbcc", density: 72, width: 48 },
      characters: [
        { strokes: [{ color: "#ff2d55", brush: { size: 55, sensitivity: 75, lag: 40 } }, { color: "#ff2d55", brush: { size: 55, sensitivity: 75, lag: 40 } }] },
        { strokes: [{ color: "#268cff" }, { color: "#268cff" }] }
      ]
    });

    await receiver.reload();
    await expect.poll(() => connectionState(receiver)).toBe("connected");
    const historyMessage = receiver.getByRole("button", { name: "手写消息，共 2 字，点击重新播放", exact: true }).last();
    await expect(historyMessage).toBeVisible();
    const staticSignature = await canvasSignature(historyMessage);
    expect(staticSignature).toContain("data:image/png;base64,");

    await startCanvasSampling(receiver, "manual-replay");
    await historyMessage.click();
    await receiver.waitForTimeout(950);
    expect(await distinctSampleCount(receiver, "manual-replay")).toBeGreaterThan(1);
    expect(await canvasSignature(historyMessage)).toBe(staticSignature);

    await receiver.evaluate(() => {
      const root = document.querySelector("#app") as HTMLElement & { __vue_app__?: { _context?: { provides?: Record<PropertyKey, unknown> } } };
      const provides = root?.__vue_app__?._context?.provides;
      const pinia = Reflect.ownKeys(provides || {}).map((key) => provides?.[key]).find((value) => value && typeof value === "object" && "_s" in value) as
        | { _s?: Map<string, Record<string, unknown>> }
        | undefined;
      const store = [...(pinia?._s?.values() || [])].find((candidate) => "connectionState" in candidate && "socket" in candidate);
      const socket = store?.socket as { disconnect(): void; connect(): void } | undefined;
      if (!socket) throw new Error("chat socket was not found");
      socket.disconnect();
      socket.connect();
    });
    await expect.poll(() => connectionState(receiver)).toBe("connected");

    const recall = await sender.evaluate(async (messageId) => {
      const token = localStorage.getItem("team-chat-token");
      const response = await fetch(`/api/messages/${messageId}/recall`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: "{}"
      });
      return { ok: response.ok, status: response.status, body: await response.json() };
    }, senderDto!.id);
    expect(recall).toMatchObject({ ok: true, status: 200, body: { success: true } });
    await expect(receiver.locator(`[data-message-id="${senderDto!.id}"]`)).toContainText("撤回了一条消息");
    await expect(receiverMessage).toHaveCount(0);

    await sender.reload();
    await expect.poll(() => connectionState(sender)).toBe("connected");
    const savedDialog = await openHandwritingComposer(sender);
    await savedDialog.getByRole("button", { name: "自定义颜色", exact: true }).click();
    const savedPicker = savedDialog.getByRole("dialog", { name: "调色盘" });
    await expect(savedPicker.locator('input[aria-label="调色盘颜色"]')).toHaveValue("#123456");
    await savedPicker.getByRole("button", { name: "关闭调色盘", exact: true }).click();
    await expect(savedDialog.getByRole("button", { name: "硬笔", exact: true })).toHaveAttribute("aria-pressed", "true");
    await savedDialog.getByRole("button", { name: "毛笔", exact: true }).click();
    await savedDialog.getByText("毛笔参数", { exact: true }).click();
    await expect(savedDialog.getByRole("slider", { name: "毛笔粗细" })).toHaveValue("55");
    await expect(savedDialog.getByRole("slider", { name: "毛笔速度响应" })).toHaveValue("75");
    await expect(savedDialog.getByRole("slider", { name: "毛笔笔头滞后" })).toHaveValue("40");
    await expect(savedDialog.getByRole("checkbox", { name: "显示纸张" })).toBeChecked();
    await expect(savedDialog.locator('input[aria-label="纸张颜色"]')).toHaveValue("#fff1d6");
    await expect(savedDialog.getByRole("checkbox", { name: "光晕" })).toBeChecked();
    await expect(savedDialog.locator('input[aria-label="光晕颜色"]')).toHaveValue("#aabbcc");
    await expect(savedDialog.getByRole("slider", { name: "光晕密度" })).toHaveValue("72");
    await expect(savedDialog.getByRole("slider", { name: "光晕宽度" })).toHaveValue("48");
    await expect(savedDialog.getByRole("button", { name: "选择蓝色", exact: true })).toHaveAttribute("aria-pressed", "true");
  } finally {
    await Promise.all([senderSession.context.close(), receiverSession.context.close()]);
  }
});

test("服务端已落库但 ACK 丢失时沿用原 UUID 重试且只保留一条", async ({ page }) => {
  test.setTimeout(60_000);
  await blockPublicNetwork(page);
  await login(page, E2E_ADMIN);
  await page.evaluate(() => {
    const root = document.querySelector("#app") as HTMLElement & { __vue_app__?: { _context?: { provides?: Record<PropertyKey, unknown> } } };
    const provides = root?.__vue_app__?._context?.provides;
    const pinia = Reflect.ownKeys(provides || {}).map((key) => provides?.[key]).find((value) => value && typeof value === "object" && "_s" in value) as
      | { _s?: Map<string, Record<string, unknown>> }
      | undefined;
    const store = [...(pinia?._s?.values() || [])].find((candidate) => "connectionState" in candidate && "socket" in candidate);
    const socket = store?.socket as {
      listeners(event: string): Array<(...args: unknown[]) => void>;
      off(event: string, listener: (...args: unknown[]) => void): void;
      emit(...args: unknown[]): unknown;
    } | undefined;
    if (!socket) throw new Error("chat socket was not found");
    for (const listener of socket.listeners("message:new")) socket.off("message:new", listener);
    const originalEmit = socket.emit.bind(socket);
    let intercept = true;
    socket.emit = (...args: unknown[]) => {
      if (args[0] !== "message:send" || !intercept) return originalEmit(...args);
      intercept = false;
      const data = args[1] as { clientRequestId?: string };
      (window as typeof window & { __droppedHandwritingRequestId?: string }).__droppedHandwritingRequestId = data.clientRequestId;
      const ack = args[2] as ((error: Error | null, response?: unknown) => void) | undefined;
      return originalEmit(args[0], args[1], (_error: Error | null, _response?: unknown) => {
        queueMicrotask(() => ack?.(new Error("simulated lost ACK after commit")));
      });
    };
  });

  const dialog = await openHandwritingComposer(page);
  const canvas = dialog.getByLabel("当前手写字格");
  await drawStroke(page, canvas, [[0.2, 0.2], [0.5, 0.5], [0.8, 0.25]]);
  await dialog.getByRole("button", { name: "发送", exact: true }).click();
  await expect(dialog).toBeHidden();
  const pending = page.locator(".composer-unconfirmed-row").filter({ hasText: "未确认 · [手写消息]" });
  await expect(pending).toBeVisible();
  const requestId = await page.evaluate(() => (window as typeof window & { __droppedHandwritingRequestId?: string }).__droppedHandwritingRequestId);
  expect(requestId).toMatch(/^[0-9a-f-]{36}$/);

  await pending.getByRole("button", { name: "重试", exact: true }).click();
  await expect(pending).toHaveCount(0);
  await page.reload();
  await expect.poll(() => connectionState(page)).toBe("connected");
  const persisted = await page.evaluate((clientRequestId) => {
    const root = document.querySelector("#app") as HTMLElement & { __vue_app__?: { _context?: { provides?: Record<PropertyKey, unknown> } } };
    const provides = root?.__vue_app__?._context?.provides;
    const pinia = Reflect.ownKeys(provides || {}).map((key) => provides?.[key]).find((value) => value && typeof value === "object" && "_s" in value) as
      | { _s?: Map<string, Record<string, unknown>> }
      | undefined;
    const store = [...(pinia?._s?.values() || [])].find((candidate) => "connectionState" in candidate && "messages" in candidate);
    const matches = ((store?.messages || []) as Array<{ id: number; clientRequestId?: string }>).filter((message) => message.clientRequestId === clientRequestId);
    return { count: matches.length, messageId: matches[0]?.id };
  }, requestId);
  expect(persisted.count).toBe(1);
  const persistedRow = page.locator(`[data-message-id="${persisted.messageId}"]`);
  await expect(persistedRow.getByRole("button", { name: "手写消息，共 1 字，点击重新播放", exact: true })).toHaveCount(1);
});
