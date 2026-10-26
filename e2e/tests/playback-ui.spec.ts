import { expect, test, webkit, type Page } from "@playwright/test";
import fs from "node:fs/promises";

async function harness(page: Page) {
  await page.route("**/playback-ui-harness", (route) => route.fulfill({
    contentType: "text/html",
    body: '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><main id="host"></main></body></html>'
  }));
  await page.goto("/playback-ui-harness");
  await page.evaluate(async () => {
    const tickerPath = "/src/client/components/ActivityTicker.vue";
    const copyworkPath = "/src/client/features/bible/copywork/CopyworkPage.vue";
    const source = await (await fetch(tickerPath)).text();
    const vuePath = /from ["']([^"']*\/vue\.js[^"']*)["']/.exec(source)?.[1];
    if (!vuePath) throw new Error("missing Vue runtime");
    const { createApp, h, ref, markRaw } = await import(vuePath) as typeof import("vue");
    const { default: Ticker } = await import(tickerPath);
    const { default: Copywork } = await import(copyworkPath);
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "/src/client/styles.css";
    const stylesReady = new Promise<void>((resolve, reject) => {
      css.onload = () => resolve();
      css.onerror = () => reject(new Error("playback harness styles failed to load"));
    });
    document.head.append(css);
    await stylesReady;
    const items = ref(["小羊正在输入…"]);
    const active = ref(true);
    const glyphs = markRaw(Array.from({ length: 31 }, (_, index) => ({
      index, bounds: { left: 500, top: 500, right: 9500, bottom: 9500 },
      character: { strokes: [{ color: "#268cff", brush: { size: 45, sensitivity: 65, lag: 35 },
        points: Array.from({ length: 1500 }, (_, i) => [1000 + i * 5, 5000 + Math.sin(i / 45) * 3000, i * 8]) }] }
    })));
    const placements = markRaw(glyphs.map((glyph) => ({ index: glyph.index, x: 68 + (glyph.index % 7) * 82, y: 90 + Math.floor(glyph.index / 7) * 100 })));
    const sourceData = { translation: "cmn-cu89s", translationName: "和合本", copyright: "", bookCode: "JHN", chapter: 3, verseStart: 16, verseEnd: 16, reference: "约翰福音 3:16", text: "经".repeat(31) };
    let fills = 0;
    const fill = CanvasRenderingContext2D.prototype.fill;
    CanvasRenderingContext2D.prototype.fill = function (...args: Parameters<typeof fill>) {
      fills++;
      return fill.apply(this, args);
    };
    const app = createApp({ render: () => h("div", {}, [
      h("div", { class: "chat-activity-ticker", style: "width:100%;height:28px" }, [h(Ticker, { items: items.value })]),
      h("div", { class: "message-row", style: "width:280px;margin:40px auto" }, [h(Copywork, { glyphs, placements, source: sourceData, compact: true, interactive: true, active: active.value })])
    ]) });
    app.mount(document.getElementById("host")!);
    Object.assign(window, { playbackHarness: {
      items: (next: string[]) => { items.value = next; },
      active: (next: boolean) => { active.value = next; },
      fills: () => fills,
      unmount: () => app.unmount()
    } });
  });
}

test("activity ticker clears both viewport edges for short and long status and pauses offscreen", async ({ page }) => {
  await harness(page);
  for (const width of [360, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    for (const items of [["小羊正在输入…"], ["小羊正在读《约翰福音》", "某位用户正在听《一首很长名字的歌曲》", "小羊、另一位用户正在输入"]]) {
      await page.evaluate((items) => (window as unknown as { playbackHarness: { items: (value: string[]) => void } }).playbackHarness.items(items), items);
      await expect.poll(() => page.locator(".chat-activity-track").evaluate((el) => el.getAnimations().length)).toBe(1);
      const edges = await page.locator(".chat-activity-track").evaluate((el) => {
        const animation = el.getAnimations()[0];
        animation.pause();
        const duration = Number(animation.effect!.getTiming().duration);
        const viewport = el.parentElement!.getBoundingClientRect();
        animation.currentTime = 0;
        const start = el.getBoundingClientRect().left;
        animation.currentTime = duration - 0.01;
        const end = el.getBoundingClientRect().right;
        animation.play();
        return { start, end, left: viewport.left, right: viewport.right };
      });
      expect(edges.start).toBeGreaterThanOrEqual(edges.right - 1);
      expect(edges.end).toBeLessThanOrEqual(edges.left + 1);
    }
    await page.screenshot({ path: `output/e2e/playback-${width}.png` });
  }
  await page.evaluate(() => { document.getElementById("host")!.style.transform = "translateY(2000px)"; });
  await expect(page.locator(".chat-activity-viewport")).toHaveClass(/paused/);
  await page.evaluate(() => { document.getElementById("host")!.style.transform = ""; });
  await expect(page.locator(".chat-activity-viewport")).not.toHaveClass(/paused/);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => page.locator(".chat-activity-track").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
});

test("dense folio seeking coalesces renders, reuses completed ink and retains pointer capture outside", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await harness(page);
  const paper = page.locator(".copywork-paper");
  const fills = () => page.evaluate(() => (window as unknown as { playbackHarness: { fills: () => number } }).playbackHarness.fills());
  await expect.poll(fills).toBe(31);
  const box = (await paper.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 20, box.y + box.height / 2, { steps: 20 });
  await expect.poll(() => paper.getAttribute("data-progress")).not.toBe("1");
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(paper).toHaveAttribute("data-playing", "false");
  const before = await fills();
  await paper.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const base = { bubbles: true, pointerId: 99, pointerType: "touch", isPrimary: true, button: 0, clientY: rect.y + rect.height / 2 };
    el.dispatchEvent(new PointerEvent("pointerdown", { ...base, clientX: rect.x + rect.width / 2 }));
    for (let i = 0; i < 60; i++) el.dispatchEvent(new PointerEvent("pointermove", { ...base, clientX: rect.x + rect.width * (i % 2 ? 0.8 : 0.2) }));
    el.dispatchEvent(new PointerEvent("pointerup", { ...base, clientX: rect.x + rect.width * 0.8 }));
  });
  await expect.poll(() => paper.getAttribute("data-progress")).not.toBe("0");
  await page.waitForTimeout(200);
  expect(await fills() - before).toBeLessThan(5);
  await paper.press("Enter");
  await expect(paper).toHaveAttribute("data-playing", "true");
  await page.evaluate(() => (window as unknown as { playbackHarness: { active: (value: boolean) => void } }).playbackHarness.active(false));
  await expect(paper).toHaveAttribute("data-playing", "false");
  const paused = await fills();
  await page.waitForTimeout(100);
  expect(await fills()).toBe(paused);
});

test("brush strokes fill exactly once per stroke, only after cross-frame construction", async ({ page }) => {
  // 管线笔画几何在独立 Path2D 上跨帧构造：构造中不得出现部分填充（fill 计数
  // 恒 0、画布无墨），完成后恰好一次 fill 且立即出墨。密集路径下 512 stamps
  // 的分帧 yield 保留——用真实 rAF 调度驱动而非一次性 drain。
  await harness(page);
  // The harness app shares the handwriting render queue; let it finish its own
  // initial drawing first so no real rAF handle is pending when we take over.
  await expect.poll(() => page.evaluate(() => (window as unknown as { playbackHarness: { fills: () => number } }).playbackHarness.fills())).toBe(31);
  const result = await page.evaluate(async () => {
    const path = "/src/client/features/bible/copywork/copyworkPlaybackRenderer.ts";
    const { createCopyworkPlaybackRenderer } = await import(path);
    const canvas = document.createElement("canvas");
    canvas.style.width = "280px";
    document.body.append(canvas);
    const glyph = { index: 0, bounds: { left: 0, top: 0, right: 10000, bottom: 10000 }, character: { strokes: [
      { color: "#182522", brush: { size: 45, sensitivity: 65, lag: 35 }, points: Array.from({ length: 1500 }, (_, i) => [1000 + i * 5, 5000 + Math.sin(i / 45) * 3000, i * 8] as [number, number, number]) }
    ] } };
    const frames = new Map<number, FrameRequestCallback>();
    const originalFrame = window.requestAnimationFrame;
    const originalCancel = window.cancelAnimationFrame;
    const originalNow = performance.now.bind(performance);
    let serial = 0;
    let tick = 0;
    window.requestAnimationFrame = (callback) => { frames.set(++serial, callback); return serial; };
    window.cancelAnimationFrame = (id) => { frames.delete(id); };
    // 每个队列任务在队列预算口径下都超时（9ms > 8ms），强制一次 flush 只推进
    // 一个 yield——密集笔画的跨帧构造在快机上也被真实拉长。
    performance.now = () => ++tick * 9;
    let fills = 0;
    const originalFill = CanvasRenderingContext2D.prototype.fill;
    CanvasRenderingContext2D.prototype.fill = function (...args: Parameters<typeof originalFill>) {
      fills += 1;
      return originalFill.apply(this, args);
    };
    const renderer = createCopyworkPlaybackRenderer({ canvas: () => canvas,
      viewport: () => ({ x: 0, y: 0, width: 704, height: 320 }),
      glyphs: () => [glyph], placements: () => [{ index: 0, x: 68, y: 90 }], active: () => true });
    const step = () => { const batch = [...frames.entries()]; frames.clear(); for (const [, callback] of batch) callback(performance.now()); };
    const visibleAlpha = () => { const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data; return [...data].some((v, i) => i % 4 === 3 && v > 0); };
    try {
      window.requestAnimationFrame(() => {});
      const hookSanity = frames.size;
      renderer.draw(new Map([[0, [1500]]]));
      // 跨帧构造中：连续推进数帧，期间不得有任何 fill 或可见墨迹。
      const observedSteps = 4;
      for (let i = 0; i < observedSteps; i += 1) step();
      const fillsMidConstruction = fills;
      const inkMidConstruction = visibleAlpha();
      for (let i = 0; frames.size && i < 400; i += 1) step();
      return { observedSteps, fillsMidConstruction, inkMidConstruction, totalFills: fills, finalInk: visibleAlpha() };
    } finally {
      renderer.destroy();
      canvas.remove();
      window.requestAnimationFrame = originalFrame;
      window.cancelAnimationFrame = originalCancel;
      performance.now = originalNow;
      CanvasRenderingContext2D.prototype.fill = originalFill;
    }
  });
  expect(result.fillsMidConstruction).toBe(0);
  expect(result.inkMidConstruction).toBe(false);
  expect(result.totalFills).toBe(1);
  expect(result.finalInk).toBe(true);
});

test("cached folio ink matches direct drawing at fractional placements and screen scales (chromium)", async ({ page }, testInfo) => {
  await cachedInkScenario(page, "chromium", testInfo);
});

test("cached folio ink matches direct drawing at fractional placements and screen scales (webkit)", async ({ page }, testInfo) => {
  const browser = await webkit.launch();
  try { await cachedInkScenario(await browser.newPage({ baseURL: "http://127.0.0.1:4173" }), "webkit", testInfo); }
  finally { await browser.close(); }
});

// 取证版用例：同一组合先跑未插桩基线（与生产行为一致），再跑带 drawImage 探针的
// 插桩通道，按 D(直接)/R(整页 raster)/C(裁剪缓存)/F(最终画布) 分阶段比对。断言与
// 参数不变（全部宽度×DPR×点数，alpha<=2）；证据附件在销毁 canvas 前生成。
async function cachedInkScenario(page: Page, engine: string, testInfo: import("@playwright/test").TestInfo) {
  const declaredPlaywright = JSON.parse(await fs.readFile("package.json", "utf8")).devDependencies["@playwright/test"];
  const browserVersion = page.context().browser()?.version() ?? "unknown";
  const environment = { engine, browserVersion, playwright: declaredPlaywright, os: process.platform, arch: process.arch };
  await harness(page);
  for (const width of [360, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    const evidence = await page.evaluate(async ({ width, environment }) => {
      const rendererPath = "/src/client/features/bible/copywork/copyworkPlaybackRenderer.ts";
      const inkPath = "/src/client/features/handwriting/handwritingRenderer.ts";
      const { createCopyworkPlaybackRenderer } = await import(rendererPath);
      const { drawHandwritingInk } = await import(inkPath);
      const shared = await import("/src/shared/bibleCopywork.ts");
      const COPYWORK_PAGE = shared.COPYWORK_PAGE;
      const glyph = { index: 0, bounds: { left: 0, top: 0, right: 10000, bottom: 10000 }, character: { strokes: [{
        color: "#268cff", brush: { size: 45, sensitivity: 65, lag: 35 },
        points: Array.from({ length: 300 }, (_, i) => [1000 + i * 25, 5000 + Math.sin(i / 15) * 3000, i * 8])
      }] } };
      const placement = { index: 0, x: 77.35, y: 100.65 };
      const view = { x: 13.7, y: 29.2, width: 704, height: 320 };
      const originalRatio = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
      const combos: unknown[] = [];

      const alphaOf = (data: Uint8ClampedArray) => { const out = new Uint8Array(data.length / 4); for (let i = 3, j = 0; i < data.length; i += 4, j += 1) out[j] = data[i]; return out; };
      const metrics = (a: Uint8Array, b: Uint8Array, w: number, h: number) => {
        const histogram = new Map<number, number>();
        let maxDiff = 0, countOver = 0;
        let minX = w, minY = h, maxX = -1, maxY = -1;
        const worst: Array<{ diff: number; x: number; y: number; a: number; b: number }> = [];
        for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
          const index = y * w + x;
          const diff = Math.abs(a[index] - b[index]);
          histogram.set(diff, (histogram.get(diff) || 0) + 1);
          if (diff > maxDiff) maxDiff = diff;
          if (diff > 2) {
            countOver += 1;
            if (x < minX) minX = x; if (y < minY) minY = y;
            if (x > maxX) maxX = x; if (y > maxY) maxY = y;
          }
          if (diff > 0) worst.push({ diff, x, y, a: a[index], b: b[index] });
        }
        worst.sort((p, q) => q.diff - p.diff);
        return { maxDiff, countOver2: countOver, bbox: countOver ? { minX, minY, maxX, maxY } : null,
          histogram: [...histogram.entries()].sort((p, q) => p[0] - q[0]),
          topPixels: worst.slice(0, 50) };
      };
      const snapshot = (canvas: HTMLCanvasElement) => {
        const ctx = canvas.getContext("2d")!;
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        return { width: canvas.width, height: canvas.height, alpha: alphaOf(image.data), rgba: new Uint8ClampedArray(image.data),
          state: { transform: ctx.getTransform().toString(), globalAlpha: ctx.globalAlpha, composite: ctx.globalCompositeOperation,
            filter: ctx.filter, smoothingEnabled: ctx.imageSmoothingEnabled, smoothingQuality: ctx.imageSmoothingQuality,
            attributes: (ctx as CanvasRenderingContext2D & { getContextAttributes?: () => unknown }).getContextAttributes?.() ?? null } };
      };
      const renderCached = async (count: number) => {
        const cached = document.createElement("canvas");
        cached.style.width = `${width - 40.25}px`;
        document.body.append(cached);
        const renderer = createCopyworkPlaybackRenderer({ canvas: () => cached, viewport: () => view,
          glyphs: () => [glyph], placements: () => [placement], active: () => true });
        // 预算观测：记录每次 rAF 回调（渲染队列任务在其中执行）的耗时，
        // 取最大单次与总次数——只测时不改渲染路径。
        let rafCount = 0, rafMaxMs = 0, rafTotalMs = 0;
        const originalFrame = window.requestAnimationFrame;
        window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
          return originalFrame.call(window, (time) => {
            const started = performance.now();
            try { callback(time); } finally {
              const spent = performance.now() - started;
              rafCount += 1; rafTotalMs += spent; if (spent > rafMaxMs) rafMaxMs = spent;
            }
          });
        }) as typeof requestAnimationFrame;
        renderer.draw(new Map([[0, [count]]]));
        const ctx = cached.getContext("2d")!;
        let settleReads = 0;
        const deadline = performance.now() + 5000;
        try {
          while (!ctx.getImageData(0, 0, cached.width, cached.height).data.some((value) => value > 0)) {
            if (performance.now() > deadline) throw new Error("cached ink did not finish drawing");
            settleReads += 1;
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          }
        } finally {
          window.requestAnimationFrame = originalFrame;
        }
        return { cached, renderer, settleReads, budget: { rafCount, rafMaxMs: Math.round(rafMaxMs * 100) / 100, rafTotalMs: Math.round(rafTotalMs * 100) / 100 } };
      };
      const renderDirect = (w: number, h: number, count: number) => {
        const direct = document.createElement("canvas");
        direct.width = w; direct.height = h;
        const reference = direct.getContext("2d")!;
        const scale = direct.width / view.width;
        reference.scale(scale, scale);
        reference.translate(-view.x, -view.y);
        reference.translate(placement.x, placement.y);
        reference.scale(COPYWORK_PAGE.font / 10000, COPYWORK_PAGE.font / 10000);
        drawHandwritingInk(reference, glyph.character, [count]);
        return { direct, snapshot: snapshot(direct) };
      };

      try {
        for (const ratio of [1, 2]) {
          Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: ratio });
          for (const count of [300, 137]) {
            const base = await renderCached(count);
            const baseFinal = snapshot(base.cached);
            const reference = renderDirect(base.cached.width, base.cached.height, count);
            const baseline = metrics(reference.snapshot.alpha, baseFinal.alpha, base.cached.width, base.cached.height);
            // 重复渲染探针：同输入各再渲染一次直接图与完整管线，量化 Linux 软件
            // 光栅下的逐次渲染非确定性（D1-D2 应为 0；若非 0 则断言前提本身不成立）。
            const reference2 = renderDirect(base.cached.width, base.cached.height, count);
            const repeatDirect = metrics(reference.snapshot.alpha, reference2.snapshot.alpha, base.cached.width, base.cached.height);
            const base2 = await renderCached(count);
            const base2Final = snapshot(base2.cached);
            const repeatPipeline = metrics(baseFinal.alpha, base2Final.alpha, base.cached.width, base.cached.height);

            // —— 插桩通道：记录窗口内全部画布间 drawImage 的对象身份与快照 ——
            // copy1: buffer.drawImage(raster)（目标=内部缓存画布）；copy2: visible.drawImage(buffer)。
            // copy2 的源就是 C；copy1 的目标与 copy2 的源是同一对象，按身份链分类。
            const calls: Array<{ src: HTMLCanvasElement; dst: HTMLCanvasElement; dx: number; dy: number; snap?: ReturnType<typeof snapshot> }> = [];
            const originalDrawImage = CanvasRenderingContext2D.prototype.drawImage;
            const instrumented = document.createElement("canvas");
            instrumented.style.width = `${width - 40.25}px`;
            document.body.append(instrumented);
            const instrRenderer = createCopyworkPlaybackRenderer({ canvas: () => instrumented, viewport: () => view,
              glyphs: () => [glyph], placements: () => [placement], active: () => true });
            let instrumentedFinal: ReturnType<typeof snapshot> | null = null;
            try {
              let armed = false;
              CanvasRenderingContext2D.prototype.drawImage = function (source: CanvasImageSource, ...rest: number[]) {
                const result = originalDrawImage.apply(this, [source, ...rest] as Parameters<typeof originalDrawImage>);
                if (armed && source instanceof HTMLCanvasElement && this.canvas instanceof HTMLCanvasElement
                  && (this.canvas === instrumented || (source.width === instrumented.width && source.height === instrumented.height))) {
                  const entry = { src: source, dst: this.canvas, dx: rest[0] ?? 0, dy: rest[1] ?? 0 };
                  entry.snap = snapshot(source);
                  calls.push(entry);
                }
                return result;
              } as typeof originalDrawImage;
              armed = true;
              instrRenderer.draw(new Map([[0, [count]]]));
              const instrCtx = instrumented.getContext("2d")!;
              const instrDeadline = performance.now() + 5000;
              while (!instrCtx.getImageData(0, 0, instrumented.width, instrumented.height).data.some((value) => value > 0)) {
                if (performance.now() > instrDeadline) throw new Error("instrumented ink did not finish drawing");
                await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
              }
              await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
              await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
              instrumentedFinal = snapshot(instrumented);
            } finally {
              CanvasRenderingContext2D.prototype.drawImage = originalDrawImage;
            }
            const copy2 = calls.find((call) => call.dst === instrumented);
            const copy1 = copy2 ? [...calls].slice(0, calls.indexOf(copy2)).reverse().find((call) => call.dst === copy2.src) : undefined;
            let staged: Record<string, unknown> = { captured: false };
            if (instrumentedFinal && copy1?.snap && copy2?.snap) {
              const rasterSnap = copy1.snap;
              const cropSnap = copy2.snap;
              const dVersusRaster = metrics(reference.snapshot.alpha, rasterSnap.alpha, rasterSnap.width, rasterSnap.height);
              // C 必须补回 copy2 的目标偏移才能与 D 同帧比较
              const cOnPage = new Uint8Array(reference.snapshot.alpha.length);
              for (let y = 0; y < cropSnap.height; y += 1) {
                for (let x = 0; x < cropSnap.width; x += 1) {
                  const dx2 = copy2.dx + x, dy2 = copy2.dy + y;
                  if (dx2 >= 0 && dy2 >= 0 && dx2 < rasterSnap.width && dy2 < rasterSnap.height) {
                    cOnPage[dy2 * rasterSnap.width + dx2] = cropSnap.alpha[y * cropSnap.width + x];
                  }
                }
              }
              const dVersusCropOnPage = metrics(reference.snapshot.alpha, cOnPage, rasterSnap.width, rasterSnap.height);
              let inkOutsideCrop = 0;
              for (let i = 0; i < rasterSnap.alpha.length; i += 1) {
                if (rasterSnap.alpha[i] > 0 && cOnPage[i] === 0 && reference.snapshot.alpha[i] > 0) inkOutsideCrop += 1;
              }
              staged = { captured: true, drawCallCount: calls.length,
                offsets: { copy1: { dx: copy1.dx, dy: copy1.dy }, copy2: { dx: copy2.dx, dy: copy2.dy } },
                sizes: { raster: { width: rasterSnap.width, height: rasterSnap.height }, crop: { width: cropSnap.width, height: cropSnap.height } },
                dVersusRaster, dVersusCropOnPage, inkOutsideCrop,
                cVersusFinalWithinCrop: metrics(cropSnap.alpha, ((): Uint8Array => {
                  const region = new Uint8Array(cropSnap.alpha.length);
                  for (let y = 0; y < cropSnap.height; y += 1) for (let x = 0; x < cropSnap.width; x += 1) {
                    const fx = copy2.dx + x, fy = copy2.dy + y;
                    if (fx >= 0 && fy >= 0 && fx < instrumentedFinal.width && fy < instrumentedFinal.height) {
                      region[y * cropSnap.width + x] = instrumentedFinal.alpha[fy * instrumentedFinal.width + fx];
                    }
                  }
                  return region;
                })(), cropSnap.width, cropSnap.height),
                observerCheck: metrics(baseFinal.alpha, instrumentedFinal.alpha, base.cached.width, base.cached.height) };
            }
            combos.push({
              environment, cssWidth: width, height: 844, simulatedDpr: ratio,
              dprSimulatedViaDefineProperty: true, originalDprDescriptorExisted: Boolean(originalRatio), points: count,
              backing: { cached: { width: base.cached.width, height: base.cached.height }, direct: { width: reference.direct.width, height: reference.direct.height } },
              view, placement, bounds: glyph.bounds,
              scale: reference.direct.width / view.width,
              inkScale: (reference.direct.width / view.width) * COPYWORK_PAGE.font / 10000,
              contextState: { direct: reference.snapshot.state, cachedFinal: baseFinal.state, capturedSources: calls.map((call) => call.snap?.state ?? null) },
              settlePollReads: base.settleReads,
              budget: base.budget,
              baseline, staged, repeatDirect, repeatPipeline,
              png: baseline.maxDiff > 2 ? { direct: reference.direct.toDataURL("image/png"), cached: base.cached.toDataURL("image/png") } : null,
              alphaDump: baseline.maxDiff > 2
                ? { width: base.cached.width, direct: Array.from(reference.snapshot.alpha), cachedFinal: Array.from(baseFinal.alpha) }
                : null
            });
            reference.direct.remove(); reference2.direct.remove();
            base.renderer.destroy(); base.cached.remove();
            base2.renderer.destroy(); base2.cached.remove();
            instrRenderer.destroy(); instrumented.remove();
          }
        }
      } finally {
        if (originalRatio) Object.defineProperty(window, "devicePixelRatio", originalRatio);
        else delete (window as { devicePixelRatio?: number }).devicePixelRatio;
      }
      return { environment, combos };
    }, { width, environment });
    // 双写：attach 供报告展示，outputPath 落盘保证 CI 工件里一定有文件。
    const jsonPath = testInfo.outputPath(`alpha-evidence-${engine}-${width}.json`);
    await fs.writeFile(jsonPath, JSON.stringify(evidence), "utf8");
    await testInfo.attach(`alpha-evidence-${engine}-${width}.json`, { body: JSON.stringify(evidence), contentType: "application/json" });
    for (const combo of evidence.combos as Array<{
      png: { direct: string; cached: string } | null; simulatedDpr: number; points: number;
      baseline: { maxDiff: number };
    }>) {
      if (combo.png) {
        for (const side of ["direct", "cached"] as const) {
          const buffer = Buffer.from(combo.png[side].split(",")[1], "base64");
          const name = `alpha-${engine}-${width}-dpr${combo.simulatedDpr}-${combo.points}-${side}.png`;
          await fs.writeFile(testInfo.outputPath(name), buffer);
          await testInfo.attach(name, { body: buffer, contentType: "image/png" });
        }
      }
      expect(combo.baseline.maxDiff, `${width}px, DPR ${combo.simulatedDpr}, ${combo.points} points`).toBeLessThanOrEqual(2);
    }
  }
}
test("brush playback retains visible ink while the next frame rasterizes in both browsers", async ({ page }) => {
  async function scenario(current: Page) {
    await harness(current);
    await expect.poll(() => current.evaluate(() => (window as unknown as { playbackHarness: { fills: () => number } }).playbackHarness.fills())).toBe(31);
    const result = await current.evaluate(async () => {
      const path = "/src/client/features/bible/copywork/copyworkPlaybackRenderer.ts";
      const { createCopyworkPlaybackRenderer } = await import(path) as typeof import("../../src/client/features/bible/copywork/copyworkPlaybackRenderer");
      const canvas = document.createElement("canvas");
      canvas.style.width = "280px";
      document.body.append(canvas);
      const glyph = { index: 0, bounds: { left: 0, top: 0, right: 10000, bottom: 10000 }, character: { strokes: [{
        color: "#182522", brush: { size: 45, sensitivity: 65, lag: 35 },
        points: Array.from({ length: 1500 }, (_, i) => [1000 + i * 5, 5000 + Math.sin(i / 45) * 3000, i * 8] as [number, number, number])
      }] } };
      const frames = new Map<number, FrameRequestCallback>();
      const originalFrame = window.requestAnimationFrame;
      const originalCancel = window.cancelAnimationFrame;
      const originalNow = performance.now.bind(performance);
      let serial = 0;
      let tick = 0;
      // One queue job per frame makes the gap between preparing and
      // presenting the ink deterministic, even on fast machines.
      window.requestAnimationFrame = (callback) => { frames.set(++serial, callback); return serial; };
      window.cancelAnimationFrame = (id) => { frames.delete(id); };
      performance.now = () => ++tick * 9;
      const renderer = createCopyworkPlaybackRenderer({ canvas: () => canvas,
        viewport: () => ({ x: 0, y: 0, width: 704, height: 320 }),
        glyphs: () => [glyph], placements: () => [{ index: 0, x: 68, y: 90 }], active: () => true });
      const step = () => {
        const batch = [...frames.values()];
        frames.clear();
        for (const callback of batch) callback(tick * 9);
      };
      const drain = () => {
        for (let i = 0; frames.size && i < 300; i++) step();
        if (frames.size) throw new Error("ink rendering did not settle");
      };
      const visible = () => canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data.some((v, i) => i % 4 === 3 && v > 0);
      try {
        renderer.draw(new Map([[0, [600]]]));
        drain();
        const before = canvas.toDataURL();
        renderer.draw(new Map([[0, [900]]]));
        step();
        const retained = canvas.toDataURL() === before;
        let emptyFrames = 0;
        for (let i = 0; i < 12; i++) {
          renderer.draw(new Map([[0, [910 + i * 10]]]));
          step();
          if (!visible()) emptyFrames++;
        }
        renderer.draw(new Map([[0, [1500]]]));
        drain();
        const finished = visible() && canvas.toDataURL() !== before;
        renderer.draw(new Map());
        drain();
        return { retained, emptyFrames, finished, cleared: !visible() };
      } finally {
        renderer.destroy();
        canvas.remove();
        window.requestAnimationFrame = originalFrame;
        window.cancelAnimationFrame = originalCancel;
        performance.now = originalNow;
      }
    });
    expect(result).toEqual({ retained: true, emptyFrames: 0, finished: true, cleared: true });
  }
  await scenario(page);
  const browser = await webkit.launch();
  try { await scenario(await browser.newPage({ baseURL: "http://127.0.0.1:4173" })); }
  finally { await browser.close(); }
});
