import { expect, test } from "@playwright/test";
import type { BookNoteDTO } from "../../src/shared/bookNotes";
import type { BookNoteHighlights, renderBookNoteHighlights } from "../../src/client/features/books/bookNoteHighlights";

type FixtureWindow = Window & {
  noteFixture: {
    doc: Document;
    notes: BookNoteDTO[];
    handle: BookNoteHighlights;
    render: typeof renderBookNoteHighlights;
    before: { text: string | null; width: number; height: number; nodes: Node[] };
  };
};

for (const fallback of [false, true]) {
  test(`ebook note marks preserve selection, links and layout (${fallback ? "WebKit fallback" : "native highlight"})`, async ({ page }) => {
    await page.goto("/");
    await page.setContent('<iframe id="note-fixture" style="width:390px;height:500px;border:0"></iframe>');
    const initial = await page.evaluate(async (useFallback) => {
      const source = "/src/client/features/books/bookNoteHighlights.ts";
      const { renderBookNoteHighlights: render } = await import(source) as typeof import("../../src/client/features/books/bookNoteHighlights");
      const frame = document.querySelector<HTMLIFrameElement>("#note-fixture")!;
      await new Promise<void>((resolve) => {
        frame.onload = () => resolve();
        const html = '<html><head><style>body{margin:16px;font:20px/1.6 serif}p{margin:0 0 20px}a{color:blue}</style></head><body><p id="first">第一段有<strong>跨节点</strong>文字。</p><p id="second">第二段文字。<a id="original-link" href="#first">原来的链接</a></p><p id="last">最后一段。</p><aside hidden>不能匹配的内容</aside></body></html>';
        frame.src = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      });
      const doc = frame.contentDocument!;
      const view = doc.defaultView!;
      if (useFallback) Object.defineProperty(view, "Highlight", { value: undefined });
      const baseline = { id: "one", bookId: 1, bookTitle: "测试书", quote: "跨节点文字。\n\n第二段文字。", text: "我的笔记", chapter: "第一章", fraction: .1, createdAt: "2026-10-09T00:00:00Z", updatedAt: "2026-10-09T00:00:00Z" };
      const notes = [baseline, { ...baseline, id: "two", quote: "第二段文字。" }, { ...baseline, id: "wrong-section", fraction: .8, quote: "最后一段。" }];
      const before = { text: doc.body.textContent, width: doc.body.scrollWidth, height: doc.body.scrollHeight, nodes: Array.from(doc.body.querySelectorAll("p")).flatMap((p) => Array.from(p.childNodes)) };
      const onOpen = (note: BookNoteDTO) => { frame.dataset.opened = note.id; };
      const handle = render(doc, notes, { startFraction: 0, endFraction: .5, onOpen });
      (window as FixtureWindow).noteFixture = { doc, notes, handle, render, before };
      return { iconCount: doc.querySelectorAll("[data-book-note-id]").length, fallbackCount: doc.querySelectorAll("[data-book-note-overlay] > span").length, text: doc.body.textContent, before: before.text, width: doc.body.scrollWidth, beforeWidth: before.width, height: doc.body.scrollHeight, beforeHeight: before.height };
    }, fallback);
    expect(initial.iconCount).toBe(2);
    expect(initial.text).toBe(initial.before);
    expect(initial.width).toBe(initial.beforeWidth);
    expect(initial.height).toBe(initial.beforeHeight);
    expect(initial.fallbackCount > 0).toBe(fallback);
    const frame = page.frameLocator("#note-fixture");
    await frame.locator('[data-book-note-id="two"]').click();
    await expect(page.locator("#note-fixture")).toHaveAttribute("data-opened", "two");
    const refreshed = await page.evaluate(async () => {
      const fixture = (window as FixtureWindow).noteFixture;
      const { doc, render, before } = fixture;
      const nodes = Array.from(doc.body.querySelectorAll("p")).flatMap((p) => Array.from(p.childNodes));
      const unchangedNodes = nodes.every((node, index) => node === before.nodes[index]);
      const selection = doc.getSelection()!;
      const range = doc.createRange();
      range.selectNodeContents(doc.querySelector("#first")!);
      selection.addRange(range);
      const selectedText = selection.toString();
      fixture.handle.refresh();
      await new Promise<void>((resolve) => doc.defaultView!.requestAnimationFrame(() => resolve()));
      const selectionAfterRefresh = selection.toString();
      fixture.handle = render(doc, [fixture.notes[0]!], { startFraction: 0, endFraction: .5, onOpen() {} });
      return { unchangedNodes, selectedText, selectionAfterRefresh, overlayCount: doc.querySelectorAll("[data-book-note-overlay]").length, iconCount: doc.querySelectorAll("[data-book-note-id]").length };
    });
    expect(refreshed.unchangedNodes).toBe(true);
    expect(refreshed.selectionAfterRefresh).toBe(refreshed.selectedText);
    expect(refreshed.overlayCount).toBe(1);
    expect(refreshed.iconCount).toBe(1);
    expect(await page.evaluate(async () => {
      const { doc, handle } = (window as FixtureWindow).noteFixture;
      const icon = doc.querySelector<HTMLButtonElement>("[data-book-note-id]")!;
      icon.focus();
      handle.refresh();
      await new Promise<void>((resolve) => doc.defaultView!.requestAnimationFrame(() => resolve()));
      return doc.activeElement === icon;
    })).toBe(true);
    const paginated = await page.evaluate(async () => {
      const { doc, handle } = (window as FixtureWindow).noteFixture;
      // Foliate paginates the root element; marks must not add content to its columns.
      const longText = doc.createElement("p");
      longText.textContent = "用于验证分页布局和笔记图标不会改变页数。".repeat(120);
      doc.body.append(longText);
      doc.documentElement.style.cssText = "height:220px;column-width:350px;column-gap:32px;column-fill:auto;overflow:hidden";
      const width = doc.documentElement.scrollWidth;
      const height = doc.body.scrollHeight;
      handle.refresh();
      await new Promise<void>((resolve) => doc.defaultView!.requestAnimationFrame(() => resolve()));
      const icon = doc.querySelector<HTMLElement>("[data-book-note-id]")!;
      const end = doc.createRange();
      end.selectNodeContents(doc.querySelector("#second")!.firstChild!);
      const rect = Array.from(end.getClientRects()).at(-1)!;
      return { beforeWidth: width, width: doc.documentElement.scrollWidth, beforeHeight: height, height: doc.body.scrollHeight, iconTop: icon.getBoundingClientRect().top, quoteTop: rect.top };
    });
    expect(paginated.width).toBe(paginated.beforeWidth);
    expect(paginated.height).toBe(paginated.beforeHeight);
    expect(Math.abs(paginated.iconTop - paginated.quoteTop)).toBeLessThan(10);
    await page.evaluate(() => (window as FixtureWindow).noteFixture.doc.getSelection()?.removeAllRanges());
    await frame.locator("#original-link").click();
    expect(await frame.locator("#original-link").getAttribute("href")).toBe("#first");
    await expect.poll(() => page.evaluate(() => (window as FixtureWindow).noteFixture.doc.defaultView!.location.hash)).toBe("#first");
    const destroyed = await page.evaluate(() => {
      const fixture = (window as FixtureWindow).noteFixture;
      fixture.handle.destroy();
      fixture.handle.refresh();
      URL.revokeObjectURL(document.querySelector<HTMLIFrameElement>("#note-fixture")!.src);
      return { overlayCount: fixture.doc.querySelectorAll("[data-book-note-overlay]").length, styleCount: fixture.doc.querySelectorAll("[data-book-note-style]").length, originalNodes: fixture.before.nodes.every((node) => node.isConnected) };
    });
    expect(destroyed.overlayCount).toBe(0);
    expect(destroyed.styleCount).toBe(0);
    expect(destroyed.originalNodes).toBe(true);
  });
}

test("saved note locations use rendered geometry with hidden footnotes, large spacers and repeated quotes", async ({ page }) => {
  await page.goto("/src/client/features/books/bookNoteHighlights.ts");
  await page.setContent('<iframe id="geometry-fixture" style="width:390px;height:500px;border:0"></iframe>');
  const result = await page.evaluate(async () => {
    const source = "/src/client/features/books/bookNoteHighlights.ts";
    const composableSource = "/src/client/features/books/useBookNoteHighlights.ts";
    const { renderBookNoteHighlights: render } = await import(source) as typeof import("../../src/client/features/books/bookNoteHighlights");
    const { useBookNoteHighlights } = await import(composableSource) as typeof import("../../src/client/features/books/useBookNoteHighlights");
    const frame = document.querySelector<HTMLIFrameElement>("#geometry-fixture")!;
    const html = '<html><head><style>body{margin:16px;font:20px/1.5 serif}</style></head><body><p id="first">相同的句子。</p><div style="height:1600px"></div><p id="second">相同的句子。</p><aside style="display:none">' + "隐藏的脚注".repeat(2000) + "</aside></body></html>";
    await new Promise<void>((resolve) => { frame.onload = () => resolve(); frame.src = URL.createObjectURL(new Blob([html], { type: "text/html" })); });
    const doc = frame.contentDocument!;
    const controller = useBookNoteHighlights({ bookId: () => 1, accountId: () => 2, sectionFractions: () => [.2, .7], chapter: () => "第二章", openNote() {} });
    controller.bind(doc, 0);
    const range = doc.createRange(); range.selectNodeContents(doc.querySelector("#second")!);
    doc.getSelection()!.addRange(range);
    const context = controller.selectionContext(doc, { bookId: 1, title: "书", chapter: "", fraction: .3, quote: range.toString() });
    const note = { id: "geometry-note", bookId: 1, bookTitle: "书", chapter: context.chapter, fraction: context.fraction, quote: range.toString(), text: "笔记", createdAt: "", updatedAt: "" };
    const handle = render(doc, [note], { startFraction: .2, endFraction: .7, onOpen() {} });
    const iconTop = doc.querySelector("[data-book-note-id]")!.getBoundingClientRect().top;
    const secondTop = doc.querySelector("#second")!.getBoundingClientRect().top;
    const hidden = doc.querySelector("aside")!;
    hidden.textContent = "短脚注";
    const after = controller.selectionContext(doc, { ...context, fraction: 0 });
    handle.destroy(); controller.reset(); URL.revokeObjectURL(frame.src);
    return { fraction: context.fraction, afterFraction: after.fraction, chapter: context.chapter, iconTop, secondTop };
  });
  expect(result.fraction).toBeGreaterThan(.6);
  expect(result.afterFraction).toBe(result.fraction);
  expect(result.chapter).toBe("第二章");
  expect(Math.abs(result.iconTop - result.secondTop)).toBeLessThan(10);
});

test("Foliate note anchors restore their exact page without changing paginator dimensions", async ({ page }) => {
  await page.goto("/src/client/features/books/bookNoteHighlights.ts");
  await page.setContent("");
  const results = await page.evaluate(async () => {
    const paginatorSource = "/node_modules/foliate-js/paginator.js";
    const helperSource = "/src/client/features/books/bookNoteHighlights.ts";
    await import(paginatorSource);
    const { bookNoteRangeFraction, renderBookNoteHighlights: render } = await import(helperSource) as typeof import("../../src/client/features/books/bookNoteHighlights");
    type Paginator = HTMLElement & {
      open: (book: unknown) => void;
      goTo: (target: { index: number; anchor: number | Range }) => Promise<void>;
      getContents: () => { doc: Document }[];
      destroy: () => void;
      page: number; pages: number; viewSize: number;
    };
    const rows = [];
    for (const dir of ["ltr", "rtl"]) {
      const renderer = document.createElement("foliate-paginator") as Paginator;
      renderer.style.cssText = "display:block;width:390px;height:500px";
      for (const [name, value] of Object.entries({ flow: "paginated", margin: "16px", gap: "8%", "max-column-count": "1" })) renderer.setAttribute(name, value);
      document.body.append(renderer);
      const html = `<html dir="${dir}"><head><style>body{font:20px/1.6 serif}p{margin:0 0 20px}</style></head><body><p id="first">相同的句子。</p><p id="second">相同的句子。</p>${Array.from({ length: 30 }, (_, i) => `<p>这是用于验证分页定位的文字，包含不同的内容和段落。${i}</p>`).join("")}<p id="last">相同的句子。</p><aside style="display:none">${"隐藏脚注".repeat(1000)}</aside></body></html>`;
      const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      renderer.open({ dir, sections: [{ id: "one", linear: "yes", load: async () => url }] });
      await renderer.goTo({ index: 0, anchor: 0 });
      const doc = renderer.getContents()[0]!.doc;
      await doc.fonts.ready;
      // Foliate's first ResizeObserver expansion may still be pending after load.
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      for (const id of ["second", "last"]) {
        const range = doc.createRange(); range.selectNodeContents(doc.querySelector(`#${id}`)!);
        await renderer.goTo({ index: 0, anchor: range });
        const targetPage = renderer.page;
        const fraction = bookNoteRangeFraction(doc, range)!;
        const beforePages = renderer.pages, beforeSize = renderer.viewSize;
        const note = { id: `note-${id}`, bookId: 1, bookTitle: "书", chapter: "1", fraction, quote: range.toString(), text: "笔记", createdAt: "", updatedAt: "" };
        const handle = render(doc, [note], { startFraction: 0, endFraction: 1, onOpen() {} });
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        const iconTop = doc.querySelector("[data-book-note-id]")!.getBoundingClientRect().top;
        const quoteTop = range.getBoundingClientRect().top;
        const afterPages = renderer.pages, afterSize = renderer.viewSize;
        await renderer.goTo({ index: 0, anchor: 0 });
        await renderer.goTo({ index: 0, anchor: fraction });
        rows.push({ dir, id, targetPage, restoredPage: renderer.page, beforePages, afterPages, beforeSize, afterSize, iconTop, quoteTop });
        handle.destroy();
      }
      renderer.destroy(); renderer.remove(); URL.revokeObjectURL(url);
    }
    return rows;
  });
  for (const row of results) {
    expect(row.restoredPage, `${row.dir} ${row.id}`).toBe(row.targetPage);
    expect(row.afterPages).toBe(row.beforePages);
    expect(row.afterSize).toBe(row.beforeSize);
    expect(Math.abs(row.iconTop - row.quoteTop)).toBeLessThan(10);
  }
});
