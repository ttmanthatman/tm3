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
