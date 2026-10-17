import { expect, test, webkit, type Page } from "@playwright/test";

async function mountCards(page: Page) {
  await page.route("**/api/bible/notes/share-card-note", route => route.fulfill({ json: { note: { id: "share-card-note", author: "不应显示的作者", text: "祂与我们一同流泪。" } } }));
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
    const notePath = "/src/client/features/books/BookNoteShareCard.vue";
    const bibleNotePath = "/src/client/features/bible/notes/NoteCard.vue";
    const { default: BookNote } = await import(notePath);
    const { default: BibleNote } = await import(bibleNotePath);
    const css = document.createElement("link"); css.rel = "stylesheet"; css.href = "/src/client/styles.css";
    document.head.append(css);
    await new Promise<void>((resolve, reject) => { css.onload = () => resolve(); css.onerror = () => reject(new Error("styles failed")); });
    document.body.style.cssText = "margin:0;overflow:auto;background:#e9eff4";
    const short = "耶和华是我的牧者，我必不致缺乏。";
    const long = "你们若有彼此相爱的心，众人因此就认出你们是我的门徒了。".repeat(35);
    const openPassage = async () => { document.body.dataset.jumped = "yes"; };
    const row = (id: string, card: ReturnType<typeof h>) => h("div", { id, class: "message-row mine", style: "margin:24px 14px;gap:9px" }, [h("div", { style: "width:32px;flex-shrink:0" }), h("div", { class: "bubble-wrap" }, [h("div", { class: "bubble" }, [card])])]);
    createApp({ render: () => h("div", {}, [
      row("short", h(Passage, { passage: { reference: "诗篇 23:1", text: short, translation: "" }, openPassage })),
      row("long", h(Passage, { passage: { reference: "约翰福音 13:35", text: long, translation: "和合本" }, openPassage })),
      row("book", h(Book, { paperSeed: "c", context: { bookId: 999999, title: "大离婚", chapter: "2", fraction: .15, quote: "真要有危险，一所想象出来的房子又能给你什么保护？" }, comment: "这句话一直留在我心里。" })),
      row("book-note", h(BookNote, { paperSeed: "a", note: { id: "fixture", bookId: 999999, bookTitle: "魔鬼家书：地狱来鸿", chapter: "第20封信", fraction: .55, quote: "我亲爱的私酷鬼", text: "停下来，认真想想这封信。", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" } })),
      row("fern", h(Book, { paperSeed: "b", context: { bookId: 999999, title: "返璞归真", chapter: "1", fraction: .2, quote: "每一个新的清晨，都是一个新的开始。" } })),
      row("bible-note", h(BibleNote, { id: "share-card-note", reference: "约翰福音 11:35" }))
    ]) }).mount(document.getElementById("host")!);
  });
  await expect(page.locator(".reading-share-card")).toHaveCount(6);
  await page.locator(".reading-share-card").evaluateAll(async cards => {
    await Promise.all(cards.map(card => {
      const url = /url\(["']?(.*?)["']?\)/.exec(getComputedStyle(card, "::before").borderImageSource)?.[1];
      if (!url) throw new Error("missing card paper image");
      const paper = new Image(); paper.src = url;
      return paper.decode().catch(() => { throw new Error(`paper image failed: ${url}`); });
    }));
  });
  await expect(page.locator("#short .reading-share-meta")).toHaveCount(0);
  await expect(page.locator("#long .reading-share-meta")).toHaveCount(0);
  await expect(page.locator(".bible-passage-share-card .reading-share-label, .bible-passage-share-card .reading-share-action")).toHaveCount(0);
  await expect(page.locator("#long .bible-passage-share-card")).not.toContainText("和合本");
  await expect(page.locator("#bible-note")).toContainText("祂与我们一同流泪。");
  await expect(page.locator("#bible-note")).not.toContainText("不应显示的作者");
  await expect(page.locator("#bible-note")).not.toContainText("点击查看笔记");
  for (const [id, plant] of [["book", "daisy"], ["book-note", "lavender"], ["fern", "fern"], ["short", "olive"]]) {
    await expect(page.locator(`#${id} .reading-share-card`)).toHaveAttribute("data-plant", plant);
  }
}

async function responsiveCards(page: Page) {
  await mountCards(page);
  for (const width of [360, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const short = (await page.locator("#short .reading-share-card").boundingBox())!;
    const long = (await page.locator("#long .reading-share-card").boundingBox())!;
    expect(long.height).toBeGreaterThan(short.height);
    expect(long.width).toBeCloseTo(short.width, 0);
    for (const card of await page.locator(".reading-share-card").all()) {
      const box = (await card.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(await card.evaluate(el => getComputedStyle(el, "::before").transform)).toBe("none");
      expect(await card.locator(".reading-share-card-content").evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      expect(await card.locator("..").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
      expect(await card.locator(".reading-share-plant").evaluate(el => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0)).toBe(true);
    }
    const cover = await page.locator("#book .book-share-cover").boundingBox();
    expect(cover!.width).toBeGreaterThanOrEqual(width === 1280 ? 96 : 76);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    await expect(page.locator("#long blockquote")).toHaveText("你们若有彼此相爱的心，众人因此就认出你们是我的门徒了。".repeat(35));
    await expect(page.locator("#book blockquote")).not.toContainText("这句话一直留在我心里");
    await page.locator("#book").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `output/e2e/share-cards-${page.context().browser()!.browserType().name()}-${width}.png`, fullPage: true });
    if (width === 1280) {
      await page.locator("#short .reading-share-card").screenshot({ path: "output/e2e/share-card-bible.png" });
      await page.locator("#book .reading-share-card").screenshot({ path: "output/e2e/share-card-book.png" });
      await page.locator("#book-note .reading-share-card").screenshot({ path: "output/e2e/share-card-book-note.png" });
      await page.locator("#fern .reading-share-card").screenshot({ path: "output/e2e/share-card-fern.png" });
    }
  }
}

test("all twelve plants in each sharing collection load and stay fixed after rerender", async ({ page }) => {
  await mountCards(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(async () => {
    const path = "/src/client/features/reading-shares/ReadingShareCard.vue";
    document.getElementById("host")?.remove();
    document.documentElement.style.cssText = "height:auto;overflow:visible";
    document.body.style.cssText = "margin:0;height:auto;overflow:visible;background:#e9eff4";
    const source = await (await fetch(path)).text();
    const vuePath = /from ["']([^"']*\/vue\.js[^"']*)["']/.exec(source)?.[1];
    if (!vuePath) throw new Error("missing Vue runtime");
    const { createApp, h, ref, nextTick } = await import(vuePath) as typeof import("vue");
    const { default: Card } = await import(path);
    const layoutPath = "/src/client/features/reading-shares/readingShareLayout.ts";
    const { readingSharePlant } = await import(layoutPath) as typeof import("../../src/client/features/reading-shares/readingShareLayout");
    const rows: { kind: "book" | "bible"; seed: number; plant: string }[] = [];
    for (const kind of ["book", "bible"] as const) {
      const seen = new Set<string>();
      for (let seed = 0; seen.size < 12; seed++) {
        const plant = readingSharePlant(seed, kind);
        if (seen.has(plant)) continue;
        seen.add(plant); rows.push({ kind, seed, plant });
      }
    }
    const host = document.createElement("div"); host.id = "plant-gallery"; host.style.cssText = "display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px;padding:24px"; document.body.append(host);
    const rerender = ref(0);
    createApp({ render: () => rows.map(row => h(Card, { kind: row.kind, paperSeed: row.seed, key: `${row.kind}-${row.plant}`, "data-render": rerender.value }, () => h("div", { style: "min-height:100px;padding-right:28px" }, row.plant))) }).mount(host);
    const before = [...host.querySelectorAll<HTMLImageElement>(".reading-share-plant")].map(img => img.src);
    await Promise.all([...host.querySelectorAll<HTMLImageElement>(".reading-share-plant")].map(img => img.decode()));
    rerender.value++; await nextTick();
    if (before.some((url, index) => url !== host.querySelectorAll<HTMLImageElement>(".reading-share-plant")[index]!.src)) throw new Error("plant changed on render");
  });
  await expect(page.locator("#plant-gallery .reading-share-book")).toHaveCount(12);
  await expect(page.locator("#plant-gallery .reading-share-bible")).toHaveCount(12);
  await page.locator("#plant-gallery").screenshot({ path: "output/e2e/share-plants-gallery.png" });
});

test("Bible shares keep equal widths, hide legacy versions and link references to passages", async ({ page }) => {
  await responsiveCards(page);
  await page.route("**/api/bible/lookup?**", (route) => route.fulfill({ json: { success: false, message: "暂时无法读取" } }));
  const jump = page.locator("#short").getByRole("link", { name: "诗篇 23:1", exact: true });
  await jump.focus();
  await jump.press("Enter");
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
      withoutVersion: parseBiblePassageShare("以赛亚书 30:10<br>“第一行<br>第二行”"),
      ordinary: parseBiblePassageShare("今天读到以赛亚书 30:10<br>“请听真实的话。”<br>——和合本"),
      link: parseBiblePassageShare('<a href="/">以赛亚书 30:10</a><br>“正文”<br>——和合本'),
      legacy: readingNoteComment("阅读笔记 · 《大离婚》", "大离婚"),
      comment: readingNoteComment("感言 &lt;script&gt;<br>第二行", "大离婚")
    };
  });
  expect(result.passage).toEqual({ reference: "以赛亚书 30:10", text: "请听真实的话。<script>", translation: "和合本" });
  expect(result.withoutVersion).toEqual({ reference: "以赛亚书 30:10", text: "第一行\n第二行", translation: "" });
  expect(result.ordinary).toBeNull(); expect(result.link).toBeNull();
  expect(result.legacy).toBe(""); expect(result.comment).toBe("感言 <script>\n第二行");
});


async function passageOptions(page: Page) {
  await mountCards(page);
  await page.evaluate(async () => {
    const path = "/src/client/features/bible/BiblePassageShareDialog.vue";
    const source = await (await fetch(path)).text();
    const vuePath = /from ["']([^"']*\/vue\.js[^"']*)["']/.exec(source)?.[1];
    if (!vuePath) throw new Error("missing Vue runtime");
    const { createApp, h, ref } = await import(vuePath) as typeof import("vue");
    const { default: Dialog } = await import(path);
    const messagePath = "/src/client/features/reading-shares/readingShareMessage.ts";
    const { biblePassageShareContent } = await import(messagePath) as typeof import("../../src/client/features/reading-shares/readingShareMessage");
    const dialog = ref<{ open: (lookups: unknown[]) => void } | null>(null);
    const passages = ["诗篇 23:1", "诗篇 23:3"].map((reference, i) => ({ reference, normalizedReference: reference, translation: "和合本", verses: [{ text: i ? "第二段经文。" : "很长的经文。".repeat(300) }] }));
    let fail = true;
    const sent: string[] = [];
    const host = document.createElement("section"); document.body.prepend(host);
    createApp({ render: () => h("div", {}, [
      h("button", { onClick: () => dialog.value?.open(passages) }, "测试分享选项"),
      h(Dialog, { ref: dialog, channelName: "综合频道", sendPassage: async (lookup: Parameters<typeof biblePassageShareContent>[0], include: boolean) => {
        if (lookup.normalizedReference === "诗篇 23:3" && fail) { fail = false; throw new Error("网络暂时中断"); }
        sent.push(biblePassageShareContent(lookup, include)); document.body.dataset.sent = JSON.stringify(sent);
      } })
    ]) }).mount(host);
  });
  const open = page.getByRole("button", { name: "测试分享选项" });
  const dialog = page.getByRole("dialog", { name: "分享经文", exact: true });
  await open.click();
  await expect(dialog.getByLabel("显示版本信息")).not.toBeChecked();
  await expect(dialog.locator(".passage-share-preview small")).toHaveCount(0);
  await dialog.getByLabel("显示版本信息").check();
  await expect(dialog.locator(".passage-share-preview small")).toHaveCount(2);
  for (const width of [360, 390, 1280]) {
    await page.setViewportSize({ width, height: 700 });
    const panel = (await dialog.locator(".bible-passage-share-dialog").boundingBox())!;
    const send = (await dialog.getByRole("button", { name: "发送到聊天室" }).boundingBox())!;
    const close = (await dialog.getByRole("button", { name: "关闭", exact: true }).boundingBox())!;
    expect(panel.x).toBeGreaterThanOrEqual(0); expect(panel.x + panel.width).toBeLessThanOrEqual(width);
    expect(close.y).toBeGreaterThanOrEqual(0); expect(send.y + send.height).toBeLessThanOrEqual(700);
    expect(await dialog.locator(".passage-share-preview").evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  }
  await dialog.getByRole("button", { name: "发送到聊天室" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("网络暂时中断");
  await expect(dialog.getByLabel("显示版本信息")).toBeChecked();
  await dialog.getByRole("button", { name: "发送到聊天室" }).click();
  await expect(dialog).toHaveCount(0);
  const sent = JSON.parse((await page.locator("body").getAttribute("data-sent"))!) as string[];
  expect(sent).toHaveLength(2);
  expect(sent.every(content => content.endsWith("<br><em>——和合本</em>"))).toBe(true);
  await open.click();
  await expect(dialog.getByLabel("显示版本信息")).not.toBeChecked();
  await dialog.press("Escape");
  await expect(dialog).toHaveCount(0);
}

test("passage share options default off, fit narrow screens and preserve unfinished sends", async ({ page }) => {
  await passageOptions(page);
});

test("passage share options remain accessible in WebKit", async () => {
  const browser = await webkit.launch();
  const page = await browser.newPage({ baseURL: "http://127.0.0.1:4173" });
  try { await passageOptions(page); }
  finally { await browser.close(); }
});
