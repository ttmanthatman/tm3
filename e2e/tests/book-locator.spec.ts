import { expect, test, webkit, type Page } from "@playwright/test";

async function locatorScenario(page: Page) {
  await page.goto("/src/client/features/books/bookLocator.ts");
  return page.evaluate(async () => {
    const textSource = "/src/client/features/books/bookTextModel.ts";
    const locatorSource = "/src/client/features/books/bookLocator.ts";
    const cfiSource = "/src/client/features/books/bookCfi.ts";
    const { createBookTextModel, bookTextModel, bookTextSubrange } = await import(textSource) as typeof import("../../src/client/features/books/bookTextModel");
    const { createBookLocator, resolveBookLocator } = await import(locatorSource) as typeof import("../../src/client/features/books/bookLocator");
    const { bookRangeCfi } = await import(cfiSource) as typeof import("../../src/client/features/books/bookCfi");
    const CFI = await import("/node_modules/foliate-js/epubcfi.js") as { parse(value: string): { parent?: unknown[]; shift(): unknown }; toRange(doc: Document, parts: unknown): Range };
    const frame = document.createElement("iframe"); document.body.replaceChildren(frame);
    await new Promise<void>(resolve => { frame.onload = () => resolve(); frame.srcdoc = `<html><body>
      <p id="source">开头　<em>跨标签</em>文字。👨‍👩‍👧‍👦 é <ruby>汉<rt>hàn</rt></ruby>字。</p>
      <p>重复句。</p><p>中间。</p><p>重复句。</p><aside style="display:none">脚注原文。</aside>
      <p id="hidden" hidden>语义原文。</p><div data-book-decoration>控件文字</div><script>"不索引"</script>
    </body></html>`; });
    const doc = frame.contentDocument!, model = bookTextModel(doc);
    const source = doc.createRange(); source.selectNodeContents(doc.querySelector("#source")!);
    const publication = { bookId: 12, publicationRevision: "sha256:fixture" };
    const locator = createBookLocator(publication, "OEBPS/./chapter.xhtml#id", doc, source)!;
    const exact = resolveBookLocator(publication, "OEBPS/chapter.xhtml", doc, locator);
    const selected = model.offsets(source)!;
    const roundTrip = model.range(selected.start, selected.end)!;
    const emoji = model.text.text.indexOf("👨");
    const invalid = [model.range(emoji + 1, emoji + 2), model.range(-1, 2), model.range(0, model.text.text.length + 1), bookTextSubrange(model, selected, 1, 99999)];
    const sentences = ["跨标签文字。", "汉字。"].map(sentence => {
      const start = model.text.text.indexOf(sentence, selected.start) - selected.start;
      return bookTextSubrange(model, selected, start, start + sentence.length)?.toString() ?? null;
    });
    const cfi = bookRangeCfi("epubcfi(/6/2[chapter])", roundTrip)!;
    const parts = CFI.parse(cfi);
    (parts.parent ?? parts).shift(); // Foliate strips the publication indirection before DOM resolution.
    const cfiText = CFI.toRange(doc, parts).toString();
    doc.documentElement.style.fontSize = "30px";
    (doc.querySelector("#hidden") as HTMLElement).hidden = false;
    const unchanged = createBookTextModel(doc).text.text === model.text.text;
    const repeat = { ...locator, start: -1, end: -1, quote: { exact: "重复句。", prefix: "", suffix: "", length: 4 } };
    const ambiguous = resolveBookLocator(publication, "OEBPS/chapter.xhtml", doc, repeat);
    const recovery = resolveBookLocator(publication, "OEBPS/chapter.xhtml", doc, { ...locator, start: 900, end: 999 });
    const mismatch = resolveBookLocator({ ...publication, publicationRevision: "other-file" }, "OEBPS/chapter.xhtml", doc, locator);
    const unverified = { ...locator, publicationRevision: null, sessionId: "a" };
    const wrongSession = resolveBookLocator({ ...publication, publicationRevision: null, sessionId: "b" }, "OEBPS/chapter.xhtml", doc, unverified);
    return { selected, text: model.text.text, roundTrip: roundTrip.toString(), original: source.toString(), exact: exact.status, recovery: recovery.status,
      ambiguous: ambiguous.status, mismatch: mismatch.status, wrongSession: wrongSession.status, invalid: invalid.every(value => value === null), sentences, unchanged, cfiText };
  });
}

for (const engine of ["chromium", "webkit"] as const) {
  test(`source locators: ${engine} preserves semantics, CFI, graphemes and sentence ranges`, async ({ page, baseURL }) => {
    const browser = engine === "webkit" ? await webkit.launch() : null;
    try {
      const result = await locatorScenario(browser ? await browser.newPage({ baseURL }) : page);
      expect(result.text).toContain("跨标签文字。👨‍👩‍👧‍👦 é 汉字。");
      expect(result.text).toContain("脚注原文。");
      expect(result.text).toContain("语义原文。");
      expect(result.text).not.toContain("控件文字");
      expect(result.text).not.toContain("不索引");
      expect(result.roundTrip).toBe(result.original);
      expect(result.cfiText).toBe(result.original);
      expect(result.sentences, JSON.stringify({ selected: result.selected, text: result.text })).toEqual(["跨标签文字。", "汉hàn字。"]);
      expect(result.exact).toBe("exact"); expect(result.recovery).toBe("recovered");
      expect(result.ambiguous).toBe("ambiguous"); expect(result.mismatch).toBe("revision-mismatch");
      expect(result.wrongSession).toBe("revision-mismatch"); expect(result.invalid).toBe(true); expect(result.unchanged).toBe(true);
    } finally { await browser?.close(); }
  });
}
