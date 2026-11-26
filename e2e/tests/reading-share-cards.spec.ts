import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { Server } from "socket.io";
import sharp from "sharp";
import type { PrismaClient } from "@prisma/client";
import { createAppearanceService } from "../../src/server/routes/appearance";
import { registerReadingFontRoutes } from "../../src/server/routes/readingFont";
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
    const scripturePath = "/src/client/features/bible/BibleScriptureCard.vue";
    const topicPath = "/src/client/features/bible/BibleTopicShareCard.vue";
    const { default: Scripture } = await import(scripturePath);
    const { default: Topic } = await import(topicPath);
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
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { document.body.dataset.copied = text; } } });
    const openPassage = async (lookup: { sourceId: string }) => { document.body.dataset.jumped = "yes"; document.body.dataset.openedSource = lookup.sourceId; };
    const passages = [
      { reference: "诗篇 23:1", text: short },
      { reference: "约翰福音 13:35", text: long },
      { reference: "诗篇 23:3", text: '第三段保留全文。<script>window.injected = true</script><img src=x onerror="window.injected=true">' }
    ];
    const play = (id: string) => async () => { document.body.dataset.played = id; };
    const row = (id: string, card: ReturnType<typeof h>) => h("div", { id, class: "message-row mine", style: "margin:24px 14px;gap:9px" }, [h("div", { style: "width:32px;flex-shrink:0" }), h("div", { class: "bubble-wrap" }, [h("div", { class: "bubble" }, [card])])]);
    createApp({ render: () => h("div", {}, [
      row("short", h(Passage, { passage: { reference: "诗篇 23:1", text: short, translation: "" }, openPassage, play: play("short") })),
      row("long", h(Passage, { passage: { reference: "约翰福音 13:35", text: long, translation: "和合本" }, openPassage, play: play("long") })),
      row("multiple", h(Scripture, { passages, translation: "当代译本（简体）", showTranslation: true, sourceId: "cmncbs", openPassage, play: play("multiple") })),
      row("topic", h(Topic, { topic: { kind: "bible_topic", name: "彼此相爱", translation: "和合本", passages }, openPassage, play: play("topic") })),
      row("book", h(Book, { paperSeed: "c", context: { bookId: 999999, title: "大离婚", chapter: "2", fraction: .15, quote: "福音流畅的人，是按照耶稣基督的位格与作为中所成就的一切，来思考、感受和感知万事的人。福音流畅的人，是按照耶稣基督的位格与作为中所成就的一切，来思考、感受和感知万事的人。福音流畅的人，是按照耶稣基督的位格与作为中所成就的一切，来思考、感受和感知万事的人。" }, comment: "这句话一直留在我心里。" })),
      row("book-note", h(BookNote, { paperSeed: "a", note: { id: "fixture", bookId: 999999, bookTitle: "魔鬼家书：地狱来鸿", chapter: "第20封信", fraction: .55, quote: "我亲爱的私酷鬼", text: "停下来，认真想想这封信。", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" } })),
      row("fern", h(Book, { paperSeed: "b", context: { bookId: 999999, title: "返璞归真", chapter: "1", fraction: .2, quote: "每一个新的清晨，都是一个新的开始。" } })),
      row("bible-note", h(BibleNote, { id: "share-card-note", reference: "约翰福音 11:35" }))
    ]) }).mount(document.getElementById("host")!);
  });
  await expect(page.locator(".reading-share-card")).toHaveCount(8);
  await page.locator(".reading-share-card").evaluateAll(async cards => {
    await Promise.all(cards.map(card => {
      const url = /url\(["']?(.*?)["']?\)/.exec(getComputedStyle(card, "::before").borderImageSource)?.[1];
      if (!url) {
        if (card.classList.contains("reading-share-book")) return Promise.resolve();
        throw new Error("missing card paper image");
      }
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
  await page.addStyleTag({ content: '.reading-share-card::before { border-image-source: url("/src/client/features/reading-shares/assets/bookmark-plain.webp"); }' });
  for (const width of [360, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const short = (await page.locator("#short .reading-share-card").boundingBox())!;
    const long = (await page.locator("#long .reading-share-card").boundingBox())!;
    expect(long.height).toBeGreaterThan(short.height);
    expect(long.width).toBeCloseTo(short.width, 0);
    for (const id of ["short", "long"]) {
      const gaps = await page.locator(`#${id} .bible-scripture-card`).evaluate(card => {
        const heading = card.querySelector(".reading-share-reference")!;
        const action = card.querySelector(".scripture-card-actions button:last-child")!;
        const textRect = (element: Element) => {
          const range = document.createRange();
          const text = [...element.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())!;
          range.selectNodeContents(text);
          return range.getBoundingClientRect();
        };
        return { top: textRect(heading).top - card.getBoundingClientRect().top,
          bottom: card.getBoundingClientRect().bottom - textRect(action).bottom };
      });
      expect(Math.abs(gaps.top - gaps.bottom), JSON.stringify(gaps)).toBeLessThanOrEqual(4);
    }
    for (const id of ["short", "long", "multiple", "topic"]) {
      const scripture = page.locator(`#${id} .bible-scripture-card`);
      expect((await scripture.boundingBox())!.width).toBeCloseTo(short.width, 0);
      await expect(scripture.getByRole("button", { name: "复制经文", exact: true })).toBeVisible();
      await expect(scripture.getByRole("button", { name: "播放经文", exact: true })).toBeVisible();
    }
    for (const id of ["book", "book-note", "fern"]) {
      expect((await page.locator(`#${id} .reading-share-card`).boundingBox())!.width).toBeCloseTo(short.width, 0);
      const paper = await page.locator(`#${id} .reading-share-card`).evaluate(el => {
        const style = getComputedStyle(el, "::before");
        return { source: style.borderImageSource, background: style.backgroundColor, slices: style.borderImageSlice, extra: getComputedStyle(el, "::after").content };
      });
      expect(paper.source).toContain("book-paper-right-ribbon.webp");
      expect(paper.background).toBe("rgba(0, 0, 0, 0)");
      expect(paper.slices).toBe("360 300 100 100 fill");
      expect(paper.extra).toBe("none");
    }
    const fonts = await page.locator("#book").evaluate(el => [".reading-share-comment", ".reading-share-quote"].map(selector => getComputedStyle(el.querySelector(selector)!).fontFamily));
    expect(fonts[0]).not.toBe(fonts[1]);
    const plant = (await page.locator("#short .reading-share-plant").boundingBox())!;
    expect(plant.width).toBe(width <= 480 ? 40 : 50);
    expect(plant.height).toBe(width <= 480 ? 76 : 88);
    for (const card of await page.locator(".reading-share-card").all()) {
      const box = (await card.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(await card.evaluate(el => getComputedStyle(el, "::before").transform)).toBe("none");
      expect(await card.locator(".reading-share-card-content").evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      expect(await card.locator("..").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
      if (await card.locator(".reading-share-plant").count()) expect(await card.locator(".reading-share-plant").evaluate(el => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0)).toBe(true);
    }
    await expect(page.locator("#book .reading-share-plant, #fern .reading-share-plant")).toHaveCount(0);
    await expect(page.locator("#book .book-share-quote-open, #book .book-share-quote-close")).toHaveCount(2);
    const ribbons = [];
    for (const id of ["book", "fern"]) {
      const raster = await sharp(await page.locator(`#${id} .reading-share-card`).screenshot()).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let minX = raster.info.width, minY = raster.info.height, maxX = -1, maxY = -1;
      for (let y = 0; y < Math.min(110, raster.info.height); y++) for (let x = 0; x < raster.info.width; x++) {
        const at = (y * raster.info.width + x) * 4;
        const [r, g, b] = raster.data.subarray(at, at + 3);
        if (r > 130 && g / r < .45 && b / r < .36) {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
      }
      expect(minX).toBeGreaterThan(raster.info.width * .7);
      expect(maxX - minX).toBeGreaterThan(10);
      expect(maxY - minY).toBeGreaterThan(40);
      ribbons.push({ width: maxX - minX, height: maxY - minY });
    }
    expect(ribbons[0]).toEqual(ribbons[1]);
    const jump = page.locator("#book .book-share-inline-link");
    await expect(jump).toHaveAttribute("href", await page.locator("#book .book-share-cover-link").getAttribute("href") as string);
    expect(await jump.textContent()).toBe("");
    const wraps = await page.locator("#book blockquote").evaluate(quote => {
      const cover = quote.closest(".book-share-flow")!.querySelector(".book-share-cover-link")!.getBoundingClientRect();
      const text = [...quote.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent!.trim())!;
      const range = document.createRange(); range.selectNodeContents(text);
      return [...range.getClientRects()].some(rect => rect.top >= cover.bottom && rect.left < cover.left + 2);
    });
    expect(wraps).toBe(true);
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

test("Bible shares use a common card, keep equal widths and link references to passages", async ({ page }) => {
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

test("single, multiple and topic cards share safe text, expansion, copy and playback actions", async ({ page }) => {
  await mountCards(page);
  for (const id of ["long", "multiple", "topic"]) {
    const card = page.locator(`#${id} .bible-scripture-card`);
    const expand = card.getByRole("button", { name: "展开全部经文", exact: true });
    await expect(expand).toHaveAttribute("aria-expanded", "false");
    const before = (await card.boundingBox())!.height;
    await expand.click();
    await expect(card.getByRole("button", { name: "收起经文", exact: true })).toHaveAttribute("aria-expanded", "true");
    expect((await card.boundingBox())!.height).toBeGreaterThan(before);
    if (id !== "long") {
      await expect(card.locator(".scripture-card-passages section")).toHaveCount(3);
      await expect(card.locator("blockquote").last()).toContainText('<script>window.injected = true</script>');
      await expect(card.locator("blockquote script, blockquote img")).toHaveCount(0);
    }
    await card.getByRole("button", { name: "收起经文", exact: true }).click();
  }
  for (const id of ["short", "long", "multiple", "topic"]) {
    const card = page.locator(`#${id} .bible-scripture-card`);
    await card.getByRole("button", { name: "播放经文", exact: true }).click();
    await expect(page.locator("body")).toHaveAttribute("data-played", id);
    await card.getByRole("button", { name: "复制经文", exact: true }).click();
    await expect(card.getByRole("button", { name: "已复制", exact: true })).toBeVisible();
    const copied = await page.locator("body").getAttribute("data-copied");
    expect(copied).toContain(id === "long" ? "约翰福音 13:35" : "诗篇 23:1");
    if (id === "multiple" || id === "topic") expect(copied).toContain("第三段保留全文。");
  }
  expect(await page.evaluate(() => "injected" in window)).toBe(false);
  await page.route("**/api/bible/lookup?**", route => route.fulfill({ json: { success: true, result: { reference: "诗篇 23:1", normalizedReference: "诗篇 23:1", translation: "当代译本（简体）", sourceId: "cmncbs", verses: [{ book: "诗篇", chapter: 23, verse: 1, endVerse: 1, reference: "诗篇 23:1", text: "耶和华是我的牧者。" }] } } }));
  const request = page.waitForRequest(url => url.url().includes("/api/bible/lookup?"));
  await page.locator("#multiple").getByRole("link", { name: "诗篇 23:1", exact: true }).click();
  const query = new URL((await request).url()).searchParams;
  expect(query.get("translation")).toBe("cmncbs");
  await expect(page.locator("body")).toHaveAttribute("data-opened-source", "cmncbs");
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
    const { parseBiblePassageShare, parseLegacyMergedBiblePassages, readingNoteComment } = await import(path) as typeof import("../../src/client/features/reading-shares/readingShareMessage");
    return {
      passage: parseBiblePassageShare("以赛亚书 30:10<br>“请听真实的话。&lt;script&gt;”<br>——和合本"),
      withoutVersion: parseBiblePassageShare("以赛亚书 30:10<br>“第一行<br>第二行”"),
      ordinary: parseBiblePassageShare("今天读到以赛亚书 30:10<br>“请听真实的话。”<br>——和合本"),
      merged: parseLegacyMergedBiblePassages("诗篇 23:1<br>1 耶和华是我的牧者。<br>——和合本<br><br>诗篇 23:3<br>3 他使我的灵魂苏醒。<br>——和合本"),
      mergedComment: parseLegacyMergedBiblePassages("今天读到：<br>诗篇 23:1<br>1 耶和华是我的牧者。"),
      mergedHtml: parseLegacyMergedBiblePassages('诗篇 23:1<br>1 <img src=x onerror="alert(1)">耶和华是我的牧者。'),
      link: parseBiblePassageShare('<a href="/">以赛亚书 30:10</a><br>“正文”<br>——和合本'),
      legacy: readingNoteComment("阅读笔记 · 《大离婚》", "大离婚"),
      comment: readingNoteComment("感言 &lt;script&gt;<br>第二行", "大离婚")
    };
  });
  expect(result.passage).toEqual({ reference: "以赛亚书 30:10", text: "请听真实的话。<script>", translation: "和合本" });
  expect(result.withoutVersion).toEqual({ reference: "以赛亚书 30:10", text: "第一行\n第二行", translation: "" });
  expect(result.ordinary).toBeNull(); expect(result.link).toBeNull();
  expect(result.merged).toEqual({ passages: [
    { reference: "诗篇 23:1", text: "1 耶和华是我的牧者。", translation: "和合本" },
    { reference: "诗篇 23:3", text: "3 他使我的灵魂苏醒。", translation: "和合本" }
  ], translation: "和合本", showTranslation: true });
  expect(result.mergedComment).toBeNull(); expect(result.mergedHtml).toBeNull();
  expect(result.legacy).toBe(""); expect(result.comment).toBe("感言 <script>\n第二行");
});

test("book share comments stay separate in current and legacy messages", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const parserPath = "/src/client/features/books/bookShareMessage.ts";
    const readingPath = "/src/client/features/books/bookReading.ts";
    const { parseBookShareMessage } = await import(parserPath) as typeof import("../../src/client/features/books/bookShareMessage");
    const { bookReadingUrl, bookShareContent } = await import(readingPath) as typeof import("../../src/client/features/books/bookReading");
    const context = { bookId: 2, fraction: .79, title: "魔鬼家书", chapter: "第28封信", quote: "他若现在死了，你就失去他了。\n这是原文第二段。" };
    const origin = location.origin;
    const current = bookShareContent(context, origin, '我的感想：\n“仍有盼望。”');
    const url = bookReadingUrl(context, origin);
    return {
      current: parseBookShareMessage(current, origin),
      plain: parseBookShareMessage(current.replace(/<p>|<\/p>/g, "<br>"), origin),
      legacy: parseBookShareMessage(`摘录自《魔鬼家书》<br>第28封信 · 79%<br>“${context.quote}”<br><a href="${url}">打开书中位置</a><p>第一段</p><p>第二段</p>`, origin),
      inline: parseBookShareMessage(`摘录自《魔鬼家书》<br>“${context.quote}”<br>我的感想：“仍有盼望。”<br><a href="${url}">打开书中的位置：第28封信 · 79%</a>`, origin),
      noComment: parseBookShareMessage(bookShareContent(context, origin), origin),
      invitation: parseBookShareMessage(bookShareContent({ ...context, quote: "" }, origin, "一起来读"), origin)
    };
  });
  for (const card of [result.current, result.plain, result.legacy, result.inline, result.noComment]) {
    expect(card?.quote).toBe("他若现在死了，你就失去他了。\n这是原文第二段。");
  }
  expect(result.current?.comment).toBe('我的感想：\n“仍有盼望。”');
  expect(result.plain?.comment).toBe(result.current?.comment);
  expect(result.legacy?.comment).toBe("第一段\n第二段");
  expect(result.inline?.comment).toBe('我的感想：“仍有盼望。”');
  expect(result.noComment?.comment).toBeUndefined();
  expect(result.invitation?.quote).toBe("");
  expect(result.invitation?.comment).toBe("一起来读");
});

async function mountFontSettings(page: Page) {
  await mountCards(page);
  await page.evaluate(async () => {
    const path = "/src/client/features/admin/HandwritingFontSettings.vue";
    const source = await (await fetch(path)).text();
    const vuePath = /from ["']([^"']*\/vue\.js[^"']*)["']/.exec(source)?.[1];
    if (!vuePath) throw new Error("missing Vue runtime");
    const { createApp, h } = await import(vuePath) as typeof import("vue");
    const { default: Settings } = await import(path);
    const host = document.createElement("section");
    host.id = "font-settings"; host.style.cssText = "max-width:600px;padding:16px";
    document.body.prepend(host);
    const storePath = "/src/client/store.ts";
    const storeSource = await (await fetch(storePath)).text();
    const piniaPath = /from ["']([^"']*\/pinia\.js[^"']*)["']/.exec(storeSource)![1];
    const { createPinia } = await import(piniaPath) as typeof import("pinia");
    const { useChatStore } = await import(storePath) as typeof import("../../src/client/store");
    createApp({ setup() {
      const store = useChatStore();
      store.account = { id: 1, isAdmin: true } as typeof store.account;
      void store.loadAppearance();
      return () => h(Settings);
    } }).use(createPinia()).mount(host);
  });
  await expect(page.getByLabel("上传手写字体", { exact: true })).toBeEnabled();
}

test("handwriting font settings keep the fallback on invalid uploads", async ({ page }) => {
  await page.route("**/api/settings/appearance", route => route.fulfill({ json: { readingFont: null } }));
  await mountFontSettings(page);
  const input = page.getByLabel("上传手写字体", { exact: true });
  await input.setInputFiles({ name: "invalid.ttf", mimeType: "font/ttf", buffer: Buffer.from("broken font") });
  await expect(page.locator("#font-settings [role=alert]")).toContainText("无法读取这个字体");
  await expect(page.locator("#font-settings")).toContainText("未上传");
  await input.setInputFiles({ name: "empty.ttf", mimeType: "font/ttf", buffer: Buffer.alloc(0) });
  await expect(page.locator("#font-settings [role=alert]")).toContainText("不能为空");
  await input.setInputFiles({ name: "script.js", mimeType: "text/javascript", buffer: Buffer.from("alert(1)") });
  await expect(page.locator("#font-settings [role=alert]")).toContainText("请选择 TTF");
  for (const width of [360, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.locator("#font-settings").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
});

test("personal appearance settings no longer expose a font upload", async ({ page }) => {
  await mountCards(page);
  await page.evaluate(async () => {
    const path = "/src/client/features/settings/SettingsPanel.vue";
    const source = await (await fetch(path)).text();
    const vuePath = /from ["']([^"']*\/vue\.js[^"']*)["']/.exec(source)![1];
    const { createApp, h, ref, computed } = await import(vuePath) as typeof import("vue");
    const storeSource = await (await fetch("/src/client/store.ts")).text();
    const piniaPath = /from ["']([^"']*\/pinia\.js[^"']*)["']/.exec(storeSource)![1];
    const { createPinia } = await import(piniaPath) as typeof import("pinia");
    const { default: Settings } = await import(path);
    const host = document.createElement("div"); document.body.append(host);
    const open = ref(true);
    const settings = { settingsTab: ref("appearance"), settingsLoadError: ref(""), themeOptions: computed(() => []), activeTheme: computed(() => ""), themeSwatchStyle: () => ({ background: "" }), avatarText: () => "读", closeSettingsPanel: async () => { open.value = false; } };
    createApp({ render: () => open.value ? h(Settings, { settings }) : null }).use(createPinia()).mount(host);
  });
  await expect(page.getByLabel("上传手写字体", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "个人设置", exact: true })).toHaveCount(0);
});


test("admin chat appearance contains the global font controls on mobile and desktop", async ({ page }) => {
  await mountCards(page);
  await page.evaluate(async () => {
    const path = "/src/client/features/admin/AdminPanel.vue";
    const source = await (await fetch(path)).text();
    const vuePath = /from ["']([^"']*\/vue\.js[^"']*)["']/.exec(source)![1];
    const { createApp, h, ref } = await import(vuePath) as typeof import("vue");
    const storePath = "/src/client/store.ts";
    const storeSource = await (await fetch(storePath)).text();
    const piniaPath = /from ["']([^"']*\/pinia\.js[^"']*)["']/.exec(storeSource)![1];
    const { createPinia } = await import(piniaPath) as typeof import("pinia");
    const { useChatStore } = await import(storePath) as typeof import("../../src/client/store");
    const toolsPath = "/src/client/features/admin/useAdminTools.ts";
    const appearancePath = "/src/client/features/admin/useAppearanceSettings.ts";
    const { useAdminTools } = await import(toolsPath) as typeof import("../../src/client/features/admin/useAdminTools");
    const { defaultPalette } = await import(appearancePath) as typeof import("../../src/client/features/admin/useAppearanceSettings");
    const { default: Admin } = await import(path);
    const host = document.createElement("div"); document.body.append(host);
    createApp({ setup() {
      const store = useChatStore(); store.account = { id: 1, isAdmin: true } as typeof store.account;
      const open = ref(true), noop = () => {}, done = async () => {};
      const tools = useAdminTools({ showAdmin: open, showSettings: ref(false), showChatToolsMenu: ref(false), saveReadPosition: noop, restoreChatSurface: done, checkForUpdates: done, ensureReleaseHistory: done, pinnedNoticeText: () => "", replaceChannelSnapshot: noop, authMode: ref("login"), activePalette: () => defaultPalette, flashEffect: () => store.appearance.flashEffect, flashEffectStep: ref(0), wallpaperUrl: value => value || "", paletteStyle: () => ({}), wallpaperFitStyle: () => ({ size: "cover", repeat: "no-repeat" }), readableTextColor: () => "#000", cleanFlashEffectSettings: () => store.appearance.flashEffect });
      tools.adminPage.value = "appearanceChat"; tools.appearanceSection.value = "chat";
      const release = { serverVersion: ref(null), updateCheck: ref(null), updateStatus: ref(null), updateBusy: ref(false), selectedUpdateBranch: ref("main"), selectedUpdateCommit: ref(""), checkForUpdates: done, startServerUpdate: done, releaseHistory: ref([]), releaseDeveloper: ref("") };
      return () => open.value ? h(Admin, { tools, release, actions: { startMessageSelectionMode: done, openAdminChannelMembers: done, wallpaperUrl: () => "", themeSwatchStyle: () => ({ background: "" }) } }) : null;
    } }).use(createPinia()).mount(host);
  });
  for (const width of [360, 390, 1280]) {
    await page.setViewportSize({ width, height: 702 });
    const upload = page.getByRole("button", { name: "上传手写字体", exact: true });
    await upload.scrollIntoViewIfNeeded();
    await expect(upload).toBeVisible();
    await expect(page.getByRole("button", { name: "关闭管理", exact: true })).toBeVisible();
    expect(await page.locator(".admin-modal").evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.locator(".admin-modal").screenshot({ path: `output/e2e/global-font-admin-${width}.png` });
  }
  const chooser = page.waitForEvent("filechooser");
  const upload = page.getByRole("button", { name: "上传手写字体", exact: true });
  await upload.focus(); await upload.press("Enter");
  await (await chooser).setFiles({ name: "invalid.ttf", mimeType: "font/ttf", buffer: Buffer.from("broken") });
  await expect(page.locator(".handwriting-font-settings [role=alert]")).toContainText("无法读取这个字体");
  await page.getByRole("button", { name: "关闭管理", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "管理面板", exact: true })).toHaveCount(0);
});

async function globalFontApi() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tm3-font-browser-"));
  const settings = new Map<string, string>();
  let failSave = false;
  let broadcasts = 0;
  const prisma = { setting: {
    findMany: async () => [...settings].map(([key, value]) => ({ key, value })),
    upsert: async ({ where, update }: { where: { key: string }; update: { value: string } }) => {
      if (failSave) throw new Error("test save failure");
      settings.set(where.key, update.value);
    }
  } } as unknown as PrismaClient;
  const app = Fastify({ bodyLimit: 35 * 1024 * 1024 });
  await app.register(multipart);
  const sockets = new Server(app.server);
  const appearance = createAppearanceService({ prisma });
  app.get("/api/settings/appearance", () => appearance.appearanceDto());
  registerReadingFontRoutes(app, { appearance, directory, requireAdmin: async () => {}, io: { emit: (event, payload) => { broadcasts++; sockets.emit(event, payload); } } });
  await app.listen({ port: 3003, host: "127.0.0.1" });
  return { failSave: (value: boolean) => { failSave = value; }, broadcasts: () => broadcasts, async close() { await new Promise<void>(resolve => sockets.close(() => resolve())); await app.close(); await fs.rm(directory, { recursive: true, force: true }); } };

}

async function fontPersistence(page: Page, path: string, backend: Awaited<ReturnType<typeof globalFontApi>>) {
  await mountFontSettings(page);
  await page.getByLabel("上传手写字体", { exact: true }).setInputFiles(path);
  await expect(page.locator("#font-settings [role=status]")).toHaveText("全局手写字体已保存，对所有成员生效");
  const assertFont = async () => {
    await expect.poll(() => page.locator("#book .reading-share-comment").evaluate(el => getComputedStyle(el).fontFamily)).toContain("ReadingCommentHandwriting");
    expect(await page.locator("#book .reading-share-quote").evaluate(el => getComputedStyle(el).fontFamily)).not.toContain("ReadingCommentHandwriting");
    await expect.poll(() => page.evaluate(() => document.fonts.check('20px "ReadingCommentHandwriting"', "读书感想"))).toBe(true);
  };
  await assertFont();
  await page.locator("#font-settings").screenshot({ path: `output/e2e/handwriting-font-${page.context().browser()!.browserType().name()}.png` });
  await page.reload();
  await mountFontSettings(page);
  await assertFont();
  await page.getByLabel("上传手写字体", { exact: true }).setInputFiles({ name: "broken.ttf", mimeType: "font/ttf", buffer: Buffer.from("broken") });
  await expect(page.locator("#font-settings [role=alert]")).toContainText("原字体已保留");
  await assertFont();
  // A fresh member/browser has no local font upload and still reads the global font.
  const memberContext = await page.context().browser()!.newContext({ baseURL: "http://127.0.0.1:4173" });
  if (page.context().browser()!.browserType().name() === "chromium") await memberContext.grantPermissions(["local-network-access"]);
  const member = await memberContext.newPage();
  await mountCards(member);
  await member.evaluate(async () => {
    const storePath = "/src/client/store.ts";
    const source = await (await fetch(storePath)).text();
    const piniaPath = /from ["']([^"']*\/pinia\.js[^"']*)["']/.exec(source)![1];
    const { createPinia, setActivePinia } = await import(piniaPath) as typeof import("pinia");
    setActivePinia(createPinia());
    const { useChatStore } = await import(storePath) as typeof import("../../src/client/store");
    await useChatStore().loadAppearance();
    localStorage.setItem("team-chat-token", "font-browser-fixture");
    useChatStore().connectSocket();
  });
  await expect.poll(() => member.evaluate(async () => { const path = "/src/client/store.ts"; const { useChatStore } = await import(path); return useChatStore().socket?.connected; })).toBe(true);
  await expect.poll(() => member.locator("#book .reading-share-comment").evaluate(el => getComputedStyle(el).fontFamily)).toContain("ReadingCommentHandwriting");
  const previousVersion = await member.evaluate(async () => { const path = "/src/client/store.ts"; const { useChatStore } = await import(path); return useChatStore().appearance.readingFont.id; });
  await page.getByLabel("上传手写字体", { exact: true }).setInputFiles(path);
  await expect(page.locator("#font-settings [role=status]")).toContainText("全局手写字体已保存");
  await expect.poll(() => member.evaluate(async () => { const path = "/src/client/store.ts"; const { useChatStore } = await import(path); return useChatStore().appearance.readingFont.id; })).not.toBe(previousVersion);
  backend.failSave(true);
  await page.getByLabel("上传手写字体", { exact: true }).setInputFiles(path);
  await expect(page.locator("#font-settings [role=alert]")).toBeVisible();
  await assertFont();
  backend.failSave(false);
  await page.getByRole("button", { name: "恢复默认字体", exact: true }).click();
  await expect(page.locator("#font-settings [role=status]")).toHaveText("已为所有成员恢复默认字体");
  await expect.poll(() => member.locator("#book .reading-share-comment").evaluate(el => getComputedStyle(el).fontFamily)).not.toContain("ReadingCommentHandwriting");
  await memberContext.close();
  expect(await page.locator("#book .reading-share-comment").evaluate(el => getComputedStyle(el).fontFamily)).not.toContain("ReadingCommentHandwriting");
  await page.reload();
  await mountFontSettings(page);
  await expect(page.locator("#font-settings")).toContainText("未上传");
  expect(await page.evaluate(() => [...document.fonts].some(font => font.family === "ReadingCommentHandwriting"))).toBe(false);
}

test("global font loads for new members, persists and resets in Chromium and WebKit", async ({ page }) => {
  const path = process.env.E2E_HANDWRITING_FONT;
  test.skip(!path, "Set E2E_HANDWRITING_FONT to a local font; font files are never bundled.");
  const backend = await globalFontApi();
  try { await fontPersistence(page, path!, backend); expect(backend.broadcasts()).toBe(3); }
  finally { await backend.close(); }
  const browser = await webkit.launch();
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:4173" });
  const webkitBackend = await globalFontApi();
  try { await fontPersistence(await context.newPage(), path!, webkitBackend); expect(webkitBackend.broadcasts()).toBe(3); }
  finally { await webkitBackend.close(); await browser.close(); }
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
    const dialog = ref<{ open: (lookups: unknown[]) => void } | null>(null);
    const passages = ["诗篇 23:1", "诗篇 23:3"].map((reference, i) => ({ reference, normalizedReference: reference, translation: "和合本", sourceId: "cmn-cu89s", verses: [{ book: "诗篇", chapter: 23, verse: i ? 3 : 1, endVerse: i ? 3 : 1, reference, text: i ? "第二段经文。" : "很长的经文。".repeat(300) }] }));
    let fail = true;
    const attempts: { content: string; requestId: string; payload: unknown }[] = [];
    const host = document.createElement("section"); document.body.prepend(host);
    createApp({ render: () => h("div", {}, [
      h("button", { onClick: () => dialog.value?.open(passages) }, "测试分享选项"),
      h(Dialog, { ref: dialog, channelName: "综合频道", sendText: async (content: string, requestId: string, payload: unknown) => {
        attempts.push({ content, requestId, payload }); document.body.dataset.attempts = JSON.stringify(attempts);
        if (fail) { fail = false; throw new Error("网络暂时中断"); }
      } })
    ]) }).mount(host);
  });
  const open = page.getByRole("button", { name: "测试分享选项" });
  const dialog = page.getByRole("dialog", { name: "分享经文", exact: true });
  await open.click();
  await expect(dialog.getByLabel("显示版本信息")).not.toBeChecked();
  await expect(dialog.getByRole("checkbox")).toHaveCount(1);
  await expect(dialog.getByText("已选 2 段经文，将合成一张经文卡片。", { exact: false })).toBeVisible();
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
  await expect(dialog.getByLabel("显示版本信息")).toBeDisabled();
  await dialog.getByRole("button", { name: "发送到聊天室" }).click();
  await expect(dialog).toHaveCount(0);
  const attempts = JSON.parse((await page.locator("body").getAttribute("data-attempts"))!) as { content: string; requestId: string; payload: unknown }[];
  expect(attempts).toHaveLength(2);
  expect(attempts[0]).toEqual(attempts[1]);
  expect(attempts[0].requestId).toMatch(/^[0-9a-f-]{36}$/);
  expect(attempts[0].content).toContain("诗篇 23:1");
  expect(attempts[0].content).toContain("诗篇 23:3");
  expect(attempts[0].content).toContain("第二段经文。");
  expect(attempts[0].content).toContain("和合本");
  expect(attempts[0].payload).toEqual({ kind: "bible_passage", sourceId: "cmn-cu89s", showTranslation: true, references: ["诗篇 23:1", "诗篇 23:3"] });
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

test("message cards retain playback before audio availability loads and retry through the workspace integration", async ({ page }) => {
  let audioReady = false;
  let manifestReads = 0;
  await page.route("**/api/bible-audio/manifest", route => {
    manifestReads++;
    return audioReady ? route.fulfill({ json: { enabled: true, defaultVersionId: "fixture", versions: [{ versionId: "fixture", chapters: [] }] } })
      : route.fulfill({ status: 503 });
  });
  await page.route("**/api/bible/lookup?**", route => route.fulfill({ json: { success: true, result: { reference: "马可福音 1:1", translation: "和合本", verses: [{ book: "马可福音", chapter: 1, verse: 1, text: "神的儿子，耶稣基督福音的起头。" }] } } }));
  await page.route("**/api/bible/activity", route => route.fulfill({ json: { success: true } }));
  await page.route("**/scripture-message-harness", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><meta charset="utf-8"><main id="host"></main>' }));
  await page.goto("/scripture-message-harness");
  await page.evaluate(async () => {
    const rowPath = "/src/client/features/messages/MessageRow.vue";
    const rowSource = await (await fetch(rowPath)).text();
    const vuePath = /from ["']([^"']*\/vue\.js[^"']*)["']/.exec(rowSource)![1];
    const { createApp, h, ref } = await import(vuePath) as typeof import("vue");
    const storeSource = await (await fetch("/src/client/store.ts")).text();
    const piniaPath = /from ["']([^"']*\/pinia\.js[^"']*)["']/.exec(storeSource)![1];
    const { createPinia } = await import(piniaPath) as typeof import("pinia");
    const { default: Row } = await import(rowPath);
    const integrationPath = "/src/client/features/bible/useBibleWorkspaceIntegration.ts";
    const { useBibleWorkspaceIntegration } = await import(integrationPath) as typeof import("../../src/client/features/bible/useBibleWorkspaceIntegration");
    const defaults = Object.fromEntries(Object.keys(Row.props).map(name => [name, () => false]));
    const message = { id: 801, channelId: 11, type: "text", content: '马可福音 1:1<br>“神的儿子，耶稣基督福音的起头。”', payload: null, sender: { id: 1, kind: "human", username: "reader", displayName: "读者", avatarPath: null }, createdAt: "2026-01-01T00:00:00Z" };
    createApp({ setup() {
      const noop = () => {};
      const integration = useBibleWorkspaceIntegration({ showChannels: ref(false), showMembers: ref(false), channelsCollapsed: ref(true), membersCollapsed: ref(true), sermonWorkspaceOpen: ref(false), bookWorkspaceOpen: ref(false), saveReadPosition: noop, currentChannelId: () => 11, isTapSuppressed: () => false, publishBibleReading: noop, publishBookReading: noop, jumpToMessageInChannel: async () => {} });
      integration.bibleWorkspace.value = { startAudioFromLookups: async lookups => { document.body.dataset.played = lookups.map(lookup => lookup.reference).join(","); return true; } } as import("../../src/client/features/bible/useBibleWorkspaceIntegration").BibleWorkspaceHandle;
      return () => h(Row, { ...defaults, message, variant: "timeline", brokenAttachmentIds: new Set(), canPlayBibleAudio: integration.canPlayBibleAudioFromMessage, playBibleAudio: integration.playBibleAudioFromMessage });
    } }).use(createPinia()).mount(document.getElementById("host")!);
  });
  const play = page.getByRole("button", { name: "播放经文", exact: true });
  await expect(play).toBeVisible();
  expect(manifestReads).toBe(0);
  await play.click();
  await expect(page.getByRole("alert")).toHaveText("有声圣经暂时不可用，请稍后重试");
  await expect(play).toBeEnabled();
  audioReady = true;
  await play.click();
  await expect(page.locator("body")).toHaveAttribute("data-played", "马可福音 1:1");
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(manifestReads).toBe(2);
});
