import { expect, test, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { E2E_ADMIN, E2E_CHANNELS } from "../seed-data.js";

type Harness = {
  draws: number[];
  setActive: (active: boolean) => void;
  setOffscreen: (offscreen: boolean) => void;
  setDocumentVisible: (visible: boolean) => void;
  replacePayload: () => void;
  unmount: () => void;
};

async function mountHarness(page: Page, active: boolean, characters: number) {
  await page.route("**/handwriting-perf-harness", (route) => route.fulfill({
    contentType: "text/html",
    body: '<!doctype html><html><body style="margin:0"><main id="handwriting-perf-host" style="position:absolute;top:0;left:0"></main></body></html>'
  }));
  await page.goto("/handwriting-perf-harness");
  await page.evaluate(async ({ active, characters }) => {
    const componentPath = "/src/client/features/handwriting/HandwritingMessage.vue";
    const source = await (await fetch(componentPath)).text();
    const vuePath = /from ["']([^"']*\/vue\.js[^"']*)["']/.exec(source)?.[1];
    if (!vuePath) throw new Error("Vue runtime import is missing from the compiled component");
    const { createApp, h, ref, shallowRef } = await import(vuePath) as typeof import("vue");
    const { default: HandwritingMessage } = await import(componentPath);
    const makePayload = (offset = 0) => ({
      kind: "handwriting", version: 1,
      characters: Array.from({ length: characters }, () => ({ strokes: [{
        color: "#268cff",
        brush: { size: 45, sensitivity: 9, lag: 100 },
        points: Array.from({ length: 16 }, (_, i) => [2000 + i * 250 + offset, Math.round(5000 + Math.sin(i) * 1000), i * 60])
      }] }))
    });
    const message = shallowRef({
      id: 1, channelId: 1, type: "handwriting", content: "",
      sender: { id: 1, kind: "human", username: "harness", displayName: "harness" },
      createdAt: "2026-01-01T00:00:00.000Z", payload: makePayload()
    });
    const surfaceActive = ref(active);
    const host = document.querySelector<HTMLElement>("#handwriting-perf-host")!;
    const draws = Array.from({ length: characters }, () => 0);
    const originalClear = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      const index = [...host.querySelectorAll("canvas")].indexOf(this.canvas as HTMLCanvasElement);
      if (index >= 0) draws[index]++;
      return originalClear.apply(this, args);
    };
    let documentVisible = true;
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => documentVisible ? "visible" : "hidden" });
    const app = createApp({ render: () => h(HandwritingMessage, {
      message: message.value, variant: "timeline", surfaceActive: surfaceActive.value
    }) });
    app.mount(host);
    (window as unknown as { handwritingHarness: Harness }).handwritingHarness = {
      draws,
      setActive: (value) => { surfaceActive.value = value; },
      setOffscreen: (value) => { host.style.top = value ? "3000px" : "0px"; },
      setDocumentVisible: (value) => { documentVisible = value; document.dispatchEvent(new Event("visibilitychange")); },
      replacePayload: () => { message.value = { ...message.value, payload: makePayload(10) }; },
      unmount: () => { app.unmount(); CanvasRenderingContext2D.prototype.clearRect = originalClear; }
    };
  }, { active, characters });
  await expect(page.locator("canvas")).toHaveCount(characters);
}

function readDraws(page: Page) {
  return page.evaluate(() => (window as unknown as { handwritingHarness: Harness }).handwritingHarness.draws);
}

async function expectInkReady(page: Page) {
  await expect.poll(() => page.evaluate(() => [...document.querySelectorAll<HTMLCanvasElement>("canvas")].every((canvas) => {
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] >= 30 && pixels[i] <= 45 && pixels[i + 1] >= 130 && pixels[i + 1] <= 150 && pixels[i + 2] >= 250 && pixels[i + 3] > 200) return true;
    }
    return false;
  }))).toBe(true);
}

test("a dense legacy brush drawing renders without blocking the channel for seconds", async ({ page }) => {
  await page.goto("/");
  const elapsed = await page.evaluate(async () => {
    const rendererPath = "/src/client/features/handwriting/handwritingRenderer.ts";
    const { drawHandwritingCharacter } = await import(rendererPath) as typeof import("../../src/client/features/handwriting/handwritingRenderer");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 54;
    const stroke = {
      brush: { size: 45, sensitivity: 9, lag: 100 },
      points: Array.from({ length: 300 }, (_, index) => [
        5000 + Math.sin(index * 0.6) * 3000,
        5000 + Math.cos(index * 0.4) * 3000,
        index * 16
      ] as [number, number, number])
    };
    const start = performance.now();
    drawHandwritingCharacter(canvas, { strokes: [stroke] }, {
      maxDevicePixelRatio: 1,
      glow: { color: "#ffffff", density: 50, width: 50 }
    });
    // Include rasterization as well as vector path construction.
    canvas.getContext("2d")!.getImageData(0, 0, 54, 54);
    return performance.now() - start;
  });
  expect(elapsed).toBeLessThan(1000);
});

test("implicit brush closure preserves pixels and glow opacity for legacy and current nibs", async ({ page }) => {
  await page.goto("/");
  const results = await page.evaluate(async () => {
    const rendererPath = "/src/client/features/handwriting/handwritingRenderer.ts";
    const { drawHandwritingCharacter, drawHandwritingCharacterSteps } = await import(rendererPath) as typeof import("../../src/client/features/handwriting/handwritingRenderer");
    const results = [];
    for (const version of [undefined, 2] as const) for (const algorithm of ["follow", "slanted"] as const) {
      const stroke = {
        color: "#268cff" as const,
        brush: { size: 45, sensitivity: 9, lag: 100, algorithm, ...(version ? { version } : {}) },
        points: Array.from({ length: 16 }, (_, index) => [
          5000 + Math.sin(index * 0.6) * 3000,
          5000 + Math.cos(index * 0.4) * 3000,
          index * 16
        ] as [number, number, number])
      };
      for (const width of [54, 200]) {
        const canvas = () => {
          const element = document.createElement("canvas");
          element.width = element.height = width;
          return element;
        };
        const reference = canvas();
        const context = reference.getContext("2d")!;
        // Independently restore explicit closure at each contour boundary.
        const closedContext = new Proxy(context, {
          get(target, property) {
            if (property === "moveTo") return (x: number, y: number) => {
              target.closePath();
              target.moveTo(x, y);
            };
            const value: unknown = Reflect.get(target, property, target);
            return typeof value === "function" ? value.bind(target) : value;
          },
          set(target, property, value: unknown) { return Reflect.set(target, property, value, target); }
        });
        const options = { maxDevicePixelRatio: 1, glow: { color: "#ffffff" as const, density: 50, width: 50 } };
        drawHandwritingCharacter({ width, height: width, getContext: () => closedContext }, { strokes: [stroke] }, options);
        const actual = canvas();
        drawHandwritingCharacter(actual, { strokes: [stroke] }, options);
        const expectedPixels = context.getImageData(0, 0, width, width).data;
        const actualPixels = actual.getContext("2d")!.getImageData(0, 0, width, width).data;
        const stepped = canvas();
        const drawing = drawHandwritingCharacterSteps(stepped, { strokes: [stroke] }, options);
        while (!drawing.next().done) { /* Verify identical pixels across yield boundaries. */ }
        const steppedPixels = stepped.getContext("2d")!.getImageData(0, 0, width, width).data;
        let differences = 0;
        let painted = 0;
        for (let index = 0; index < expectedPixels.length; index++) {
          if (expectedPixels[index] !== actualPixels[index] || expectedPixels[index] !== steppedPixels[index]) differences++;
          if (index % 4 === 3 && actualPixels[index]) painted++;
        }
        results.push({ version: version || "legacy", algorithm, width, differences, painted });
      }
    }
    return results;
  });
  for (const result of results) {
    expect(result.differences, JSON.stringify(result)).toBe(0);
    expect(result.painted, JSON.stringify(result)).toBeGreaterThan(100);
  }
});

for (const width of [360, 390, 1280]) test(`static handwriting at ${width}px draws once and defers hidden updates`, async ({ page }) => {
  await page.setViewportSize({ width, height: 800 });
  await mountHarness(page, false, 16);
  await page.waitForTimeout(100);
  expect(await readDraws(page)).toEqual(Array(16).fill(0));
  await page.evaluate(() => (window as unknown as { handwritingHarness: Harness }).handwritingHarness.setActive(true));
  await expect.poll(() => readDraws(page)).toEqual(Array(16).fill(1));
  await expectInkReady(page);
  await page.evaluate(() => (window as unknown as { handwritingHarness: Harness }).handwritingHarness.setOffscreen(true));
  await page.waitForTimeout(100);
  await page.evaluate(() => (window as unknown as { handwritingHarness: Harness }).handwritingHarness.replacePayload());
  await page.waitForTimeout(100);
  expect(await readDraws(page)).toEqual(Array(16).fill(1));
  await page.evaluate(() => (window as unknown as { handwritingHarness: Harness }).handwritingHarness.setOffscreen(false));
  await expect.poll(() => readDraws(page)).toEqual(Array(16).fill(2));
  await expectInkReady(page);
  // Re-entering the viewport without an update must reuse the finished ink.
  await page.evaluate(() => (window as unknown as { handwritingHarness: Harness }).handwritingHarness.setOffscreen(true));
  await page.waitForTimeout(100);
  await page.evaluate(() => (window as unknown as { handwritingHarness: Harness }).handwritingHarness.setOffscreen(false));
  await page.waitForTimeout(100);
  expect(await readDraws(page)).toEqual(Array(16).fill(2));
  await page.evaluate(() => {
    const harness = (window as unknown as { handwritingHarness: Harness }).handwritingHarness;
    harness.setDocumentVisible(false);
    harness.replacePayload();
  });
  await page.waitForTimeout(100);
  expect(await readDraws(page)).toEqual(Array(16).fill(2));
  await page.evaluate(() => (window as unknown as { handwritingHarness: Harness }).handwritingHarness.setDocumentVisible(true));
  await expect.poll(() => readDraws(page)).toEqual(Array(16).fill(3));
  await expectInkReady(page);
  await page.evaluate(() => {
    const harness = (window as unknown as { handwritingHarness: Harness }).handwritingHarness;
    harness.replacePayload();
    harness.unmount();
  });
  await page.waitForTimeout(100);
  expect(await readDraws(page)).toEqual(Array(16).fill(3));
});

test("replay redraws only changing characters and pauses when the message leaves the viewport", async ({ page }) => {
  await mountHarness(page, true, 4);
  await expect.poll(() => readDraws(page)).toEqual([1, 1, 1, 1]);
  await expectInkReady(page);
  await page.getByRole("button", { name: "手写消息，共 4 字，点击重新播放" }).click();
  await page.waitForTimeout(250);
  const playing = await readDraws(page);
  expect(playing[0]).toBeGreaterThan(3);
  expect(playing.slice(1)).toEqual([2, 2, 2]);
  await page.evaluate(() => (window as unknown as { handwritingHarness: Harness }).handwritingHarness.setOffscreen(true));
  await page.waitForTimeout(100);
  const paused = await readDraws(page);
  await page.waitForTimeout(150);
  expect(await readDraws(page)).toEqual(paused);
  await page.evaluate(() => (window as unknown as { handwritingHarness: Harness }).handwritingHarness.setOffscreen(false));
  await expect.poll(async () => (await readDraws(page))[0]).toBeGreaterThan(paused[0]);
  await page.evaluate(() => (window as unknown as { handwritingHarness: Harness }).handwritingHarness.unmount());
});

test("restarting replay cancels partial static ink without reusing the previous frame cache", async ({ page }) => {
  await mountHarness(page, true, 1);
  await expectInkReady(page);
  await page.waitForTimeout(100);
  const result = await page.evaluate(async () => {
    const queuePath = "/src/client/features/handwriting/handwritingRenderQueue.ts";
    const { handwritingRenderQueue: queue } = await import(queuePath) as typeof import("../../src/client/features/handwriting/handwritingRenderQueue");
    const jobs = new Map<object, () => void>();
    queue.enqueue = (key, draw) => { jobs.set(key, draw); };
    queue.cancel = (key) => { jobs.delete(key); };
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    let time = 0;
    window.requestAnimationFrame = (callback) => { frames.set(++frameId, callback); return frameId; };
    window.cancelAnimationFrame = (handle) => { frames.delete(handle); };
    performance.now = () => time;
    const canvas = document.querySelector<HTMLCanvasElement>("canvas")!;
    const painted = () => canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data
      .filter((value, index) => index % 4 === 3 && value > 0).length;
    const flushDrawing = () => {
      const next = jobs.entries().next().value;
      if (!next) return false;
      jobs.delete(next[0]);
      next[1]();
      return true;
    };
    const replay = document.querySelector<HTMLButtonElement>("[role=button]")!;
    replay.click();
    flushDrawing();
    const blank = painted();
    time = 1;
    for (const [id, callback] of [...frames]) {
      frames.delete(id);
      callback(time);
    }
    flushDrawing();
    const firstFrame = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    time = 10000;
    for (const [id, callback] of [...frames]) {
      frames.delete(id);
      callback(time);
    }
    // Stop as soon as the stepped renderer paints, before its completion is cached.
    do { if (!flushDrawing()) break; } while (!painted());
    const partial = painted();
    replay.click();
    flushDrawing();
    const restarted = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    return { blank, partial, differences: restarted.filter((value, index) => value !== firstFrame[index]).length };
  });
  expect(result.blank).toBe(0);
  expect(result.partial).toBeGreaterThan(0);
  expect(result.differences).toBe(0);
});

test("resizing a multi-row message invalidates the raster cache and rebuilds the grid", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mountHarness(page, true, 16);
  await expectInkReady(page);
  const before = await readDraws(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await expect.poll(() => readDraws(page)).toEqual(before.map((count) => count + 1));
  await expectInkReady(page);
  await page.evaluate(() => (window as unknown as { handwritingHarness: Harness }).handwritingHarness.unmount());
});

for (const width of [390, 1280]) test(`a channel full of dense drawings stays navigable at ${width}px`, async ({ page }) => {
  const databaseUrl = process.env.E2E_DATABASE_URL || "";
  const url = new URL(databaseUrl);
  expect(process.env.E2E_TEST_RUN).toBe("1");
  expect(["127.0.0.1", "localhost"].includes(url.hostname)).toBe(true);
  expect(url.pathname).toBe("/tm3_e2e");
  const database = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const ids: number[] = [];
  try {
    const channel = await database.channel.findFirstOrThrow({ where: { name: E2E_CHANNELS.secondary } });
    const account = await database.account.findUniqueOrThrow({ where: { username: E2E_ADMIN.username }, include: { actor: true } });
    for (let i = 0; i < 12; i++) {
      const message = await database.message.create({ data: {
        channelId: channel.id, senderActorId: account.actor!.id, type: "handwriting",
        clientRequestId: `dense-path-${randomUUID()}`,
        payload: {
          kind: "handwriting", version: 1, glow: { color: "#ffffff", density: 50, width: 50 },
          characters: [{ strokes: [{
            brush: { size: 45, sensitivity: 9, lag: 100 },
            points: Array.from({ length: 300 }, (_, index) => [
              Math.round(5000 + Math.sin(index * 0.6) * 3000),
              Math.round(5000 + Math.cos(index * 0.4) * 3000), index * 16
            ])
          }] }]
        }
      } });
      ids.push(message.id);
    }
    await page.setViewportSize({ width, height: 800 });
    await page.route("**/*", (route) => {
      const hostname = new URL(route.request().url()).hostname;
      return ["127.0.0.1", "localhost"].includes(hostname) ? route.continue() : route.abort();
    });
    await page.goto("/");
    await page.getByPlaceholder("用户名").fill(E2E_ADMIN.username);
    await page.getByPlaceholder("密码").fill(E2E_ADMIN.password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
    if (width < 768) await page.getByRole("button", { name: "频道", exact: true }).click();
    const start = Date.now();
    await page.getByRole("button", { name: E2E_CHANNELS.secondary, exact: true }).click();
    await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.secondary);
    await expect.poll(() => page.evaluate(() => [...document.querySelectorAll<HTMLCanvasElement>(".handwriting-message canvas")].some((canvas) => {
      const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
      return pixels.some((value, index) => index % 4 === 3 && value > 0);
    }))).toBe(true);
    expect(Date.now() - start).toBeLessThan(2500);
    if (width < 768) await page.getByRole("button", { name: "频道", exact: true }).click();
    const returnStart = Date.now();
    await page.getByRole("button", { name: E2E_CHANNELS.default, exact: true }).click();
    await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
    expect(Date.now() - returnStart).toBeLessThan(1500);
  } finally {
    await database.message.deleteMany({ where: { id: { in: ids } } });
    await database.$disconnect();
  }
});
