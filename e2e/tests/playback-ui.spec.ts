import { expect, test, type Page } from "@playwright/test";

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
    document.head.append(css);
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

test("cached folio ink matches direct drawing at fractional placements and screen scales", async ({ page }) => {
  await harness(page);
  for (const width of [360, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    const results = await page.evaluate(async (width) => {
      const rendererPath = "/src/client/features/bible/copywork/copyworkPlaybackRenderer.ts";
      const inkPath = "/src/client/features/handwriting/handwritingRenderer.ts";
      const sharedPath = "/src/shared/bibleCopywork.ts";
      const { createCopyworkPlaybackRenderer } = await import(rendererPath) as typeof import("../../src/client/features/bible/copywork/copyworkPlaybackRenderer");
      const { drawHandwritingInk } = await import(inkPath) as typeof import("../../src/client/features/handwriting/handwritingRenderer");
      const { COPYWORK_PAGE } = await import(sharedPath) as typeof import("../../src/shared/bibleCopywork");
      const glyph = { index: 0, bounds: { left: 0, top: 0, right: 10000, bottom: 10000 }, character: { strokes: [{
        color: "#268cff", brush: { size: 45, sensitivity: 65, lag: 35 },
        points: Array.from({ length: 300 }, (_, i) => [1000 + i * 25, 5000 + Math.sin(i / 15) * 3000, i * 8] as [number, number, number])
      }] } };
      const placement = { index: 0, x: 77.35, y: 100.65 };
      const view = { x: 13.7, y: 29.2, width: 704, height: 320 };
      const originalRatio = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
      const comparisons = [];
      try {
        for (const ratio of [1, 2]) {
          Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: ratio });
          for (const count of [300, 137]) {
            const cached = document.createElement("canvas");
            cached.style.width = `${width - 40.25}px`;
            document.body.append(cached);
            const renderer = createCopyworkPlaybackRenderer({ canvas: () => cached, viewport: () => view,
              glyphs: () => [glyph], placements: () => [placement], active: () => true });
            renderer.draw(new Map([[0, [count]]]));
            const ctx = cached.getContext("2d")!;
            const deadline = performance.now() + 5000;
            while (!ctx.getImageData(0, 0, cached.width, cached.height).data.some((value) => value > 0)) {
              if (performance.now() > deadline) throw new Error("cached ink did not finish drawing");
              await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            }
            const direct = document.createElement("canvas");
            direct.width = cached.width;
            direct.height = cached.height;
            const reference = direct.getContext("2d")!;
            const scale = direct.width / view.width;
            reference.scale(scale, scale);
            reference.translate(-view.x, -view.y);
            reference.translate(placement.x, placement.y);
            reference.scale(COPYWORK_PAGE.font / 10000, COPYWORK_PAGE.font / 10000);
            drawHandwritingInk(reference, glyph.character, [count]);
            const expected = reference.getImageData(0, 0, direct.width, direct.height).data;
            const actual = ctx.getImageData(0, 0, cached.width, cached.height).data;
            let alphaDifference = 0;
            for (let i = 3; i < actual.length; i += 4) alphaDifference = Math.max(alphaDifference, Math.abs(actual[i] - expected[i]));
            comparisons.push({ ratio, count, alphaDifference });
            renderer.destroy();
            cached.remove();
          }
        }
      } finally {
        if (originalRatio) Object.defineProperty(window, "devicePixelRatio", originalRatio);
      }
      return comparisons;
    }, width);
    for (const result of results) expect(result.alphaDifference, `${width}px, DPR ${result.ratio}, ${result.count} points`).toBeLessThanOrEqual(2);
  }
});
