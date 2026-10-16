import { expect, test, webkit, type Page } from "@playwright/test";

async function verifyQuoteJump(page: Page, fallback: boolean) {
  await page.route("**/quote-harness", route => route.fulfill({ contentType: "text/html", body: '<main id="host"></main>' }));
  await page.goto("/quote-harness");
  const result = await page.evaluate(async (useFallback) => {
    const source = "/src/client/features/books/useBookQuoteNavigation.ts";
    const moduleSource = await (await fetch(source)).text();
    const vuePath = /from ["']([^"']*\/vue\.js[^"']*)["']/.exec(moduleSource)?.[1];
    if (!vuePath) throw new Error("missing Vue runtime");
    const { effectScope } = await import(vuePath) as typeof import("vue");
    const { useBookQuoteNavigation } = await import(source) as typeof import("../../src/client/features/books/useBookQuoteNavigation");
    const scope = effectScope();
    const outer = document.createElement("div");
    outer.style.cssText = "position:relative;height:400px;width:360px;overflow:auto";
    const frame = document.createElement("iframe");
    frame.style.cssText = "width:340px;height:2400px;border:0";
    outer.append(frame); document.getElementById("host")!.append(outer);
    await new Promise<void>(resolve => {
      frame.onload = () => resolve();
      frame.srcdoc = '<html><head><style>body{margin:24px;font:20px/1.6 serif}p{margin:0}</style></head><body><p>我亲爱的私酷鬼</p><div style="height:1200px"></div><p id="target">我亲爱的<strong>私酷鬼</strong></p><p>下一段。</p><div style="height:900px"></div></body></html>';
    });
    const doc = frame.contentDocument!;
    if (useFallback) Object.defineProperty(doc.defaultView!, "Highlight", { value: undefined });
    const before = { text: doc.body.textContent, height: doc.documentElement.scrollHeight, nodes: [...doc.querySelector("#target")!.childNodes] };
    let selectedText = "";
    const navigation = scope.run(() => useBookQuoteNavigation({
      sectionFractions: () => [0, .5, 1],
      navigateFraction: async () => { outer.scrollTop = 100; },
      navigateRange: async (_doc, _index, range) => { selectedText = range.toString(); outer.scrollTop = range.getBoundingClientRect().top - 100; }
    }))!;
    navigation.bind(doc, 1);
    await navigation.jump({ bookId: 1, fraction: .78, quote: "我亲爱的私酷鬼" });
    const targetTop = frame.getBoundingClientRect().top + doc.querySelector("#target")!.getBoundingClientRect().top;
    const marks = doc.querySelectorAll("[data-book-quote-highlight]").length;
    const fallbackMarks = doc.querySelectorAll("[data-book-quote-highlight] > span").length;
    const unchanged = before.text === doc.body.textContent && before.height === doc.documentElement.scrollHeight && before.nodes.every((node, index) => node === doc.querySelector("#target")!.childNodes[index]);
    await navigation.jump({ bookId: 1, fraction: .78, quote: "不存在的原文" });
    const staleMarks = doc.querySelectorAll("[data-book-quote-highlight]").length;
    await navigation.jump({ bookId: 1, fraction: .78, quote: "我亲爱的私酷鬼" });
    scope.stop();
    return { selectedText, targetTop, marks, fallbackMarks, unchanged, staleMarks, remaining: doc.querySelectorAll("[data-book-quote-highlight]").length };
  }, fallback);
  expect(result.selectedText).toBe("我亲爱的私酷鬼");
  expect(result.targetTop).toBeGreaterThan(50);
  expect(result.targetTop).toBeLessThan(300);
  expect(result.marks).toBe(1);
  expect(result.fallbackMarks > 0).toBe(fallback);
  expect(result.unchanged).toBe(true);
  expect(result.staleMarks).toBe(0);
  expect(result.remaining).toBe(0);
}

test("shared quote navigation finds the nearest repeated cross-node quote without reflow", async ({ page }) => {
  await verifyQuoteJump(page, false);
});

test("shared quote highlight has a WebKit overlay fallback and cleans up", async () => {
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ baseURL: "http://127.0.0.1:4173" });
    await verifyQuoteJump(page, true);
  } finally { await browser.close(); }
});
