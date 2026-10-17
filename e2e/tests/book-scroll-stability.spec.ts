import { expect, test, webkit, type Page } from "@playwright/test";
import type { ContinuousBookReader } from "../../src/client/books/reader";

type FixtureWindow = Window & {
  bookScrollFixture: { reader: ContinuousBookReader; releasePrevious(): void; previousRequested: boolean; unloaded: number[] };
};

async function openFixture(page: Page, withIllustration = false, withProse = false) {
  await page.goto("/src/client/books/reader.ts");
  await page.setContent('<style>html,body{margin:0;height:100%;overflow:hidden}.book-continuous-scroll{position:absolute;inset:0;overflow-y:auto;overscroll-behavior:contain}.book-continuous-section{width:100%;min-height:1px}.book-continuous-frame{display:block;width:100%;min-height:1px;border:0}</style>');
  await page.evaluate(async ({ withIllustration, withProse }) => {
    const source = "/src/client/books/reader.ts";
    const { ContinuousBookReader: Reader, DEFAULT_READER_STYLE } = await import(source) as typeof import("../../src/client/books/reader");
    let release!: () => void;
    const previous = new Promise<void>((resolve) => { release = resolve; });
    const fixture = { reader: null as unknown as ContinuousBookReader, releasePrevious: release, previousRequested: false, unloaded: [] as number[] };
    const sections = Array.from({ length: 3 }, (_, index) => ({ size: 1000, async load() {
      if (index === 0) { fixture.previousRequested = true; await previous; }
      const html = `<!doctype html><html><head><style>p{margin:0;${withProse ? "font:inherit" : "height:100px;font:20px/1.5 serif"}}</style></head><body>${Array.from({ length: 35 }, (_, n) => `<p id="p-${n}">${withProse && n === 10 ? '<img id="late-image" style="display:block;width:100%;height:0" />' : ""}Section ${index} paragraph ${n}${withProse ? " 阅读时要记住这一句，在字体变大以后仍然能看到同一段文字。".repeat(5) : ""}</p>`).join("")}${withIllustration ? '<div style="position:absolute;top:3600px;height:300px;width:100px">Illustration</div>' : ""}</body></html>`;
      return URL.createObjectURL(new Blob([html], { type: "text/html" }));
    }, unload() { fixture.unloaded.push(index); } }));
    fixture.reader = new Reader({ sections }, [0, 1 / 3, 2 / 3, 1], { style: DEFAULT_READER_STYLE });
    (window as FixtureWindow).bookScrollFixture = fixture;
    document.body.append(fixture.reader.element);
    await fixture.reader.open(.4);
  }, { withIllustration, withProse });
  await expect.poll(() => page.evaluate(() => (window as FixtureWindow).bookScrollFixture.previousRequested)).toBe(true);
  await page.waitForTimeout(100);
}

async function precedingLoadScenario(page: Page) {
  await openFixture(page);
  const scroller = page.locator("[data-continuous-reader]");
  const anchor = page.locator('[data-section-index="1"]');
  await scroller.hover();
  await page.mouse.wheel(0, 80);
  await page.waitForTimeout(120);
  const before = await anchor.evaluate((el) => el.getBoundingClientRect().top);
  const movement = anchor.evaluate(async (el) => {
    const tops: number[] = [];
    const end = performance.now() + 700;
    while (performance.now() < end) {
      tops.push(el.getBoundingClientRect().top);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    return tops;
  });
  await page.evaluate(() => (window as FixtureWindow).bookScrollFixture.releasePrevious());
  const tops = await movement;
  const deviation = Math.max(...tops.map((top) => Math.abs(top - before)));
  expect(deviation).toBeLessThan(3);
  const top = await anchor.evaluate((el) => el.getBoundingClientRect().top);
  await page.mouse.wheel(0, 24);
  await expect.poll(() => anchor.evaluate((el) => el.getBoundingClientRect().top)).toBeLessThan(top - 10);
}

for (const engine of ["chromium", "webkit"] as const) {
  for (const width of [engine === "webkit" ? 360 : 390, 1280]) {
    test(`EPUB ${engine} at ${width}px: delayed preceding section preserves native wheel position`, async ({ page, baseURL }) => {
      if (engine === "chromium") {
        await page.setViewportSize({ width, height: 844 });
        await precedingLoadScenario(page);
        return;
      }
      const browser = await webkit.launch();
      try {
        // Desktop WebKit supports real native wheel input at a phone viewport.
        const context = await browser.newContext({ baseURL, viewport: { width, height: 780 }, hasTouch: true });
        await precedingLoadScenario(await context.newPage());
      } finally { await browser.close(); }
    });
  }
}

test("EPUB held touch keeps its native scroll origin during a preceding-section load", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage();
    await openFixture(page);
    const scroller = page.locator("[data-continuous-reader]");
    const anchor = page.locator('[data-section-index="1"]');
    const box = (await scroller.boundingBox())!;
    const input = await context.newCDPSession(page);
    const x = box.x + box.width * .7, y = box.y + box.height * .5;
    const points = (clientY: number) => [{ x, y: clientY, id: 1 }];
    await input.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(y) });
    await input.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(y - 30) });
    await page.waitForTimeout(100);
    const before = await anchor.evaluate((el) => el.getBoundingClientRect().top);
    await page.evaluate(() => (window as FixtureWindow).bookScrollFixture.releasePrevious());
    await page.waitForTimeout(250);
    expect(Math.abs(await anchor.evaluate((el) => el.getBoundingClientRect().top) - before)).toBeLessThan(3);
    await expect(page.locator('[data-section-index="0"] iframe')).toBeHidden();
    await input.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(y - 54) });
    await expect.poll(() => anchor.evaluate((el) => el.getBoundingClientRect().top)).toBeLessThan(before - 10);
    await input.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(page.locator('[data-section-index="0"] iframe')).toBeVisible();
  } finally { await context.close(); }
});

test("EPUB frame height can shrink after a text reflow", async ({ page }) => {
  await openFixture(page);
  const frame = page.locator('[data-section-index="1"] iframe');
  const before = await frame.evaluate((el) => el.getBoundingClientRect().height);
  await frame.evaluate((el) => {
    const doc = (el as HTMLIFrameElement).contentDocument!;
    for (const paragraph of doc.querySelectorAll("p")) (paragraph as HTMLElement).style.height = "40px";
  });
  await expect.poll(() => frame.evaluate((el) => el.getBoundingClientRect().height)).toBeLessThan(before - 1000);

});

test("EPUB late preceding load preserves a newer exact range navigation", async ({ page }) => {
  await openFixture(page);
  await page.evaluate(async () => {
    const { reader } = (window as FixtureWindow).bookScrollFixture;
    await reader.goToFraction(.85);
    const frame = reader.element.querySelector<HTMLIFrameElement>('[data-section-index="2"] iframe')!;
    const range = frame.contentDocument!.createRange();
    range.selectNodeContents(frame.contentDocument!.querySelector("#p-20")!);
    reader.goToRange(frame.contentDocument!, range);
  });
  const target = page.frameLocator('[data-section-index="2"] iframe').locator("#p-20");
  const before = (await target.boundingBox())!.y;
  const rangeTop = await page.locator('[data-section-index="2"] iframe').evaluate((el) => {
    const doc = (el as HTMLIFrameElement).contentDocument!;
    const range = doc.createRange();
    range.selectNodeContents(doc.querySelector("#p-20")!);
    return el.getBoundingClientRect().top + range.getBoundingClientRect().top;
  });
  expect(Math.abs(rangeTop - page.viewportSize()!.height / 3)).toBeLessThan(2);
  await page.evaluate(() => (window as FixtureWindow).bookScrollFixture.releasePrevious());
  await expect(page.locator('[data-section-index="0"] iframe')).toBeVisible();
  expect(Math.abs((await target.boundingBox())!.y - before)).toBeLessThan(3);
});

test("EPUB a late resize above the viewport preserves the current chapter", async ({ page }) => {
  await openFixture(page);
  await page.evaluate(() => (window as FixtureWindow).bookScrollFixture.releasePrevious());
  await expect(page.locator('[data-section-index="0"] iframe')).toBeVisible();
  await page.evaluate(() => (window as FixtureWindow).bookScrollFixture.reader.goToFraction(.85));
  const anchor = page.locator('[data-section-index="2"]');
  const before = await anchor.evaluate((el) => el.getBoundingClientRect().top);
  await page.locator('[data-section-index="0"] iframe').evaluate((el) => {
    const doc = (el as HTMLIFrameElement).contentDocument!;
    for (const paragraph of doc.querySelectorAll("p")) (paragraph as HTMLElement).style.height = "40px";
  });
  await expect.poll(() => page.locator('[data-section-index="0"] iframe').evaluate((el) => el.getBoundingClientRect().height)).toBeLessThan(2000);
  expect(Math.abs(await anchor.evaluate((el) => el.getBoundingClientRect().top) - before)).toBeLessThan(3);
});

test("EPUB destruction releases a preceding section that is still loading", async ({ page }) => {
  await openFixture(page);
  await page.evaluate(() => {
    const fixture = (window as FixtureWindow).bookScrollFixture;
    fixture.reader.destroy();
    fixture.releasePrevious();
  });
  await expect(page.locator("[data-continuous-reader]")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => [...(window as FixtureWindow).bookScrollFixture.unloaded].sort())).toEqual([0, 1, 2]);
});


test("EPUB positioned illustrations retain their full chapter extent", async ({ page }) => {
  await openFixture(page, true);
  await expect.poll(() => page.locator('[data-section-index="1"] iframe').evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(3900);
});

test("EPUB a slow old navigation cannot replace a newer target", async ({ page }) => {
  await openFixture(page);
  await page.evaluate(async () => {
    const fixture = (window as FixtureWindow).bookScrollFixture;
    const old = fixture.reader.goToFraction(.1);
    await fixture.reader.goToFraction(.85);
    fixture.releasePrevious();
    await old;
  });
  const target = page.locator('[data-section-index="2"]');
  const box = (await target.boundingBox())!;
  expect(box.y).toBeLessThan(0);
  expect(box.y + box.height).toBeGreaterThan(400);
});

test("EPUB Aa preserves the same words and does not report a user scroll", async ({ page }) => {
  await openFixture(page, false, true);
  const result = await page.evaluate(async () => {
    const { reader } = (window as FixtureWindow).bookScrollFixture;
    const doc = reader.element.querySelector<HTMLIFrameElement>('[data-section-index="1"] iframe')!.contentDocument!;
    const range = doc.createRange(); range.setStart(doc.querySelector("#p-20")!.firstChild!, 0); range.setEnd(doc.querySelector("#p-20")!.firstChild!, 1);
    reader.goToRange(doc, range);
    const frame = doc.defaultView!.frameElement!;
    const before = frame.getBoundingClientRect().top + range.getBoundingClientRect().top;
    reader.setStyle({ theme: "light", fontPct: 180, spacing: 2.2, margin: 48, flow: "scrolled" });
    await new Promise(resolve => setTimeout(resolve, 200));
    const after = frame.getBoundingClientRect().top + range.getBoundingClientRect().top;
    return { before, after };
  });
  expect(Math.abs(result.after - result.before)).toBeLessThan(40);
});

test("EPUB 100-chapter traversal releases frames and revisits placeholders after reflow", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/src/client/books/reader.ts");
  await page.setContent('<style>body{margin:0}.book-continuous-scroll{position:absolute;inset:0;overflow:auto}.book-continuous-section{min-height:1px}.book-continuous-frame{display:block;width:100%;border:0}</style>');
  const result = await page.evaluate(async () => {
    const module = "/src/client/books/reader.ts";
    const { ContinuousBookReader, DEFAULT_READER_STYLE } = await import(module) as typeof import("../../src/client/books/reader");
    const urls = new Map<number, string>();
    let active = 0, peak = 0, released = 0, peakTasks = 0, tasks = 0;
    const sections = Array.from({ length: 105 }, (_, i) => ({ size: 10000, async load() {
      tasks++; peakTasks = Math.max(peakTasks, tasks);
      await new Promise(resolve => setTimeout(resolve, 1));
      const url = URL.createObjectURL(new Blob([`<html><body>${Array.from({ length: 30 }, (_, j) => `<p>Chapter ${i}, sentence ${j}. ${"A long reading paragraph. ".repeat(10)}</p>`).join("")}</body></html>`], { type: "text/html" }));
      tasks--; urls.set(i, url); active++; peak = Math.max(peak, active); return url;
    }, unload() { const url = urls.get(i); if (url) { URL.revokeObjectURL(url); urls.delete(i); active--; released++; } } }));
    const reader = new ContinuousBookReader({ sections }, Array.from({ length: 106 }, (_, i) => i / 105), { style: DEFAULT_READER_STYLE });
    document.body.append(reader.element);
    let maxFrames = 0;
    for (let i = 0; i < 100; i++) {
      await reader.goToFraction((i + .4) / 105);
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      maxFrames = Math.max(maxFrames, reader.element.querySelectorAll("iframe").length);
    }
    reader.setStyle({ ...DEFAULT_READER_STYLE, fontPct: 180, spacing: 2.2, margin: 48 });
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    for (const index of [10, 90, 5, 95]) await reader.goToFraction((index + .4) / 105);
    const anchor = reader.captureAnchor();
    const text = anchor?.doc.body.textContent;
    reader.destroy();
    await new Promise(resolve => setTimeout(resolve, 100));
    return { maxFrames, peak, peakTasks, released, remaining: active, text };
  });
  expect(result.maxFrames).toBeLessThanOrEqual(9); // Seven committed plus two off-flow preparations.
  expect(result.peakTasks).toBeLessThanOrEqual(2);
  expect(result.peak).toBeLessThanOrEqual(10);
  expect(result.released).toBeGreaterThan(90);
  expect(result.remaining).toBe(0);
  expect(result.text).toContain("Chapter 95");
});

test("EPUB a late image above visible text keeps the same character on screen", async ({ page }) => {
  await openFixture(page, false, true);
  const result = await page.evaluate(async () => {
    const { reader } = (window as FixtureWindow).bookScrollFixture;
    const frame = reader.element.querySelector<HTMLIFrameElement>('[data-section-index="1"] iframe')!;
    const doc = frame.contentDocument!, range = doc.createRange(), node = doc.querySelector("#p-20")!.firstChild!;
    range.setStart(node, 0); range.setEnd(node, 1); reader.goToRange(doc, range);
    const top = () => frame.getBoundingClientRect().top + range.getBoundingClientRect().top;
    const before = top();
    const tops: number[] = [];
    // rAF runs before ResizeObserver delivery. Observe the corrected layout in
    // the same pre-paint delivery, then every subsequent frame, rather than
    // treating the transient, unpainted pre-observer geometry as a visible jump.
    await new Promise<void>(resolve => {
      const observer = new ResizeObserver(() => { tops.push(top()); observer.disconnect(); resolve(); });
      observer.observe(doc.body);
      (doc.querySelector("#late-image") as HTMLElement).style.height = "600px";
    });
    const until = performance.now() + 400;
    while (performance.now() < until) { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); tops.push(top()); }
    return { before, tops };
  });
  expect(Math.max(...result.tops.map(top => Math.abs(top - result.before))), JSON.stringify(result)).toBeLessThanOrEqual(2);
});
