import { expect, test, webkit, type Page } from "@playwright/test";

async function mountCards(page: Page) {
  await page.route("**/reading-share-harness", (route) => route.fulfill({ contentType: "text/html", body: '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><main id="host"></main>' }));
  await page.goto("/reading-share-harness");
  await page.evaluate(async () => {
    const path = "/src/client/features/bible/BiblePassageShareCard.vue";
    const source = await (await fetch(path)).text();
    const vuePath = /from ["']([^"']*\/vue\.js[^"']*)["']/.exec(source)?.[1];
    if (!vuePath) throw new Error("missing Vue runtime");
    const { createApp, h } = await import(vuePath) as typeof import("vue");
    const { default: Passage } = await import(path);
    const bookPath = "/src/client/features/books/BookShareCard.vue";
    const { default: Book } = await import(bookPath);
    const css = document.createElement("link"); css.rel = "stylesheet"; css.href = "/src/client/styles.css";
    document.head.append(css);
    await new Promise<void>((resolve, reject) => { css.onload = () => resolve(); css.onerror = () => reject(new Error("styles failed")); });
    document.body.style.cssText = "margin:0;overflow:auto;background:#e9eff4";
    const short = "耶和华是我的牧者，我必不致缺乏。";
    const long = "你们若有彼此相爱的心，众人因此就认出你们是我的门徒了。".repeat(35);
    const openPassage = async () => { document.body.dataset.jumped = "yes"; };
    const row = (id: string, card: ReturnType<typeof h>) => h("div", { id, class: "message-row mine", style: "margin:24px 14px;gap:9px" }, [h("div", { style: "width:32px;flex-shrink:0" }), h("div", { class: "bubble-wrap" }, [h("div", { class: "bubble" }, [card])])]);
    createApp({ render: () => h("div", {}, [
      row("short", h(Passage, { passage: { reference: "诗篇 23:1", text: short, translation: "和合本" }, openPassage })),
      row("long", h(Passage, { passage: { reference: "约翰福音 13:35", text: long, translation: "和合本" }, openPassage })),
      row("book", h(Book, { context: { bookId: 999999, title: "大离婚", chapter: "2", fraction: .15, quote: "真要有危险，一所想象出来的房子又能给你什么保护？" }, comment: "这句话一直留在我心里。" }))
    ]) }).mount(document.getElementById("host")!);
  });
  await expect(page.locator(".reading-share-card")).toHaveCount(3);
}

async function responsiveCards(page: Page) {
  await mountCards(page);
  for (const width of [360, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const short = (await page.locator("#short .reading-share-card").boundingBox())!;
    const long = (await page.locator("#long .reading-share-card").boundingBox())!;
    expect(long.height).toBeGreaterThan(short.height);
    if (width === 1280) expect(long.width).toBeGreaterThan(short.width + 80);
    for (const card of await page.locator(".reading-share-card").all()) {
      const box = (await card.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
      // The rotated paper intentionally extends a few pixels beyond its content.
      // Check readable content and the page boundary independently of that art.
      expect(await card.locator(".reading-share-card-content").evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      expect(await card.locator("..").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    await expect(page.locator("#long blockquote")).toHaveText("你们若有彼此相爱的心，众人因此就认出你们是我的门徒了。".repeat(35));
    await expect(page.locator("#book blockquote")).not.toContainText("这句话一直留在我心里");
    await page.locator("#book").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `output/e2e/share-cards-${page.context().browser()!.browserType().name()}-${width}.png`, fullPage: true });
    if (width === 1280) {
      await page.locator("#short").screenshot({ path: "output/e2e/share-card-bible.png" });
      await page.locator("#book").screenshot({ path: "output/e2e/share-card-book.png" });
    }
  }
}

test("share cards adapt to passage length, keep sentiments separate and fit mobile columns", async ({ page }) => {
  await responsiveCards(page);
  await page.route("**/api/bible/lookup?**", (route) => route.fulfill({ json: { success: false, message: "暂时无法读取" } }));
  const jump = page.locator("#short").getByRole("button", { name: "跳转到经文", exact: true });
  await jump.click();
  await expect(page.locator("#short [role=alert]")).toHaveText("暂时无法读取");
  await page.unroute("**/api/bible/lookup?**");
  await page.route("**/api/bible/lookup?**", (route) => route.fulfill({ json: { success: true, result: { reference: "诗篇 23:1", normalizedReference: "诗篇 23:1", translation: "和合本", sourceId: "cmn-cu89s", verses: [{ book: "诗篇", chapter: 23, verse: 1, reference: "诗篇 23:1", text: "耶和华是我的牧者。" }] } } }));
  await jump.click();
  await expect(page.locator("body")).toHaveAttribute("data-jumped", "yes");
  await expect(page.locator("#short [role=alert]")).toHaveCount(0);
});

test("share card paper layout stays readable in WebKit", async () => {
  const browser = await webkit.launch();
  const page = await browser.newPage({ baseURL: "http://127.0.0.1:4173" });
  try { await responsiveCards(page); }
  finally { await browser.close(); }
});

test("Bible share recognition preserves ordinary reference messages and note comments", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const path = "/src/client/features/reading-shares/readingShareMessage.ts";
    const { parseBiblePassageShare, readingNoteComment } = await import(path) as typeof import("../../src/client/features/reading-shares/readingShareMessage");
    return {
      passage: parseBiblePassageShare("以赛亚书 30:10<br>“请听真实的话。&lt;script&gt;”<br>——和合本"),
      ordinary: parseBiblePassageShare("今天读到以赛亚书 30:10<br>“请听真实的话。”<br>——和合本"),
      link: parseBiblePassageShare('<a href="/">以赛亚书 30:10</a><br>“正文”<br>——和合本'),
      legacy: readingNoteComment("阅读笔记 · 《大离婚》", "大离婚"),
      comment: readingNoteComment("感言 &lt;script&gt;<br>第二行", "大离婚")
    };
  });
  expect(result.passage).toEqual({ reference: "以赛亚书 30:10", text: "请听真实的话。<script>", translation: "和合本" });
  expect(result.ordinary).toBeNull(); expect(result.link).toBeNull();
  expect(result.legacy).toBe(""); expect(result.comment).toBe("感言 <script>\n第二行");
});
