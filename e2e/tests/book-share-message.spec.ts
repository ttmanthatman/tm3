import { expect, test } from "@playwright/test";

test("book share parser preserves current percentage quotes and legacy positions", async ({ page }) => {
  await page.goto("/");
  const parsed = await page.evaluate(async () => {
    const readingPath = "/src/client/features/books/bookReading.ts";
    const messagePath = "/src/client/features/books/bookShareMessage.ts";
    const { bookShareContent } = await import(readingPath) as typeof import("../../src/client/features/books/bookReading");
    const { parseBookShareMessage } = await import(messagePath) as typeof import("../../src/client/features/books/bookShareMessage");
    const origin = window.location.origin;
    const context = { bookId: 2, fraction: .15, title: "图书 <&> “题目”", chapter: "2", quote: "第一行记录了15%\n第二行内容。" };
    const current = parseBookShareMessage(bookShareContent(context, origin), origin);
    const invitation = parseBookShareMessage(bookShareContent({ ...context, quote: "" }, origin), origin);
    const legacy = `摘录自《旧图书》<br>2 · 15%<br>“第一行记录了15%<br>第二行内容。”<br><a href="${origin}/?bookId=2&amp;bookFraction=0.15">打开书中位置</a>`;
    const legacyInvitation = `邀请你一起读《旧图书》<br>2 · 15%<br><a href="${origin}/?bookId=2&amp;bookFraction=0.15">从这里一起读</a>`;
    return {
      current, invitation,
      legacy: parseBookShareMessage(legacy, origin),
      legacyInvitation: parseBookShareMessage(legacyInvitation, origin),
      external: parseBookShareMessage(bookShareContent(context, "https://other.example.test"), origin)
    };
  });
  expect(parsed.current).toEqual({ bookId: 2, fraction: .15, title: "图书 <&> “题目”", chapter: "第2章", quote: "第一行记录了15%\n第二行内容。" });
  expect(parsed.invitation).toEqual({ ...parsed.current, quote: "" });
  expect(parsed.legacy).toEqual({ bookId: 2, fraction: .15, title: "旧图书", chapter: "2", quote: "第一行记录了15%\n第二行内容。" });
  expect(parsed.legacyInvitation).toEqual({ ...parsed.legacy, quote: "" });
  expect(parsed.external).toBeNull();
});
