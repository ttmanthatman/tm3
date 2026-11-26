import { expect, test, type Page } from "@playwright/test";
import type { mountBookNoteLibrary } from "../fixtures/book-note-library";

// Keep fixture API routes observable when WebKit activates the app service worker.
test.use({ serviceWorkers: "block" });

type LibraryWindow = Window & { bookLibraryFixture: Awaited<ReturnType<typeof mountBookNoteLibrary>> };

async function mountFixture(page: Page) {
  await page.goto("/");
  await page.evaluate(() => {
    const root = document.querySelector("#app") as (HTMLElement & { __vue_app__?: { unmount(): void } }) | null;
    root?.__vue_app__?.unmount();
    const host = document.createElement("div");
    host.id = "book-library-fixture";
    document.body.replaceChildren(host);
  });
  await page.evaluate(async () => {
    const path = "/e2e/fixtures/book-note-library.ts";
    const { mountBookNoteLibrary } = await import(path) as typeof import("../fixtures/book-note-library");
    (window as LibraryWindow).bookLibraryFixture = await mountBookNoteLibrary(document.querySelector<HTMLElement>("#book-library-fixture")!);
  });
}

test("out-of-order pre-import note reads cannot replace the refreshed library or show stale errors", async ({ page }) => {
  await mountFixture(page);
  try {
    await page.evaluate(() => { const fixture = (window as LibraryWindow).bookLibraryFixture; fixture.open(); fixture.open(); fixture.pending[1].resolve({ notes: [fixture.note] }); });
    await expect(page.getByText("导入的笔记", { exact: true })).toBeVisible();
    await page.evaluate(() => (window as LibraryWindow).bookLibraryFixture.pending[0].resolve({ notes: [] }));
    await expect(page.getByText("导入的笔记", { exact: true })).toBeVisible();
    await page.evaluate(() => { const fixture = (window as LibraryWindow).bookLibraryFixture; fixture.open(); fixture.open(); fixture.pending[3].resolve({ notes: [fixture.note] }); });
    await expect(page.getByText("导入的笔记", { exact: true })).toBeVisible();
    await page.evaluate(() => (window as LibraryWindow).bookLibraryFixture.pending[2].reject(new Error("延迟的旧错误")));
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByText("导入的笔记", { exact: true })).toBeVisible();
  } finally { await page.evaluate(() => (window as LibraryWindow).bookLibraryFixture.destroy()); }
});

test("stale reads preserve the latest loading state and closing or changing accounts invalidates pending reads", async ({ page }) => {
  await mountFixture(page);
  try {
    await page.evaluate(() => { const fixture = (window as LibraryWindow).bookLibraryFixture; fixture.open(); fixture.open(); fixture.pending[0].resolve({ notes: [] }); });
    await expect(page.getByRole("status")).toHaveText("正在读取笔记…");
    await page.evaluate(() => { const fixture = (window as LibraryWindow).bookLibraryFixture; fixture.pending[1].resolve({ notes: [fixture.note] }); });
    await expect(page.getByText("导入的笔记", { exact: true })).toBeVisible();
    await page.evaluate(() => (window as LibraryWindow).bookLibraryFixture.open());
    await page.getByRole("dialog", { name: "我的阅读笔记" }).getByRole("button", { name: "关闭", exact: true }).click();
    await page.evaluate(() => (window as LibraryWindow).bookLibraryFixture.pending[2].reject(new Error("已关闭请求的错误")));
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.evaluate(() => { const fixture = (window as LibraryWindow).bookLibraryFixture; fixture.open(); fixture.changeAccount(); });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.evaluate(() => { const fixture = (window as LibraryWindow).bookLibraryFixture; fixture.pending[3].resolve({ notes: [fixture.note] }); });
    await expect(page.getByText("导入的笔记", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.evaluate(() => (window as LibraryWindow).bookLibraryFixture.open());
    await expect(page.getByRole("dialog", { name: "我的阅读笔记" })).toBeVisible();
    await page.evaluate(() => { const fixture = (window as LibraryWindow).bookLibraryFixture; fixture.destroy(); fixture.pending[4].resolve({ notes: [fixture.note] }); });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("导入的笔记", { exact: true })).toHaveCount(0);
  } finally { await page.evaluate(() => (window as LibraryWindow).bookLibraryFixture.destroy()); }
});


for (const workspaceLayer of [5, 80]) {
  test(`book editor stays above split dividers and fullscreen readers (layer ${workspaceLayer})`, async ({ page }) => {
    await mountFixture(page);
    await page.evaluate(layer => {
      document.querySelector<HTMLElement>("#book-library-fixture")!.style.cssText = `position:fixed;inset:0;z-index:${layer};background:#f4f1ea`;
      const divider = document.createElement("div");
      divider.style.cssText = "position:fixed;top:0;bottom:0;left:calc(50% - 6px);width:12px;z-index:90;background:white";
      document.body.append(divider);
    }, workspaceLayer);
    try {
      for (const width of [360, 390, 1280]) {
        await page.setViewportSize({ width, height: 702 });
        await page.evaluate(() => (window as LibraryWindow).bookLibraryFixture.edit());
        const editor = page.getByRole("dialog", { name: "阅读笔记", exact: true });
        await expect(editor).toBeVisible();
        expect(await editor.locator(".book-action-dialog").evaluate(el => getComputedStyle(el).backgroundImage)).toContain("linear-gradient");
        const overlap = await editor.evaluate(el => {
          const quote = el.querySelector("blockquote")!.getBoundingClientRect();
          const topmost = document.elementFromPoint(innerWidth / 2, quote.top + quote.height / 2);
          return el.contains(topmost);
        });
        expect(overlap).toBe(true);
        await editor.getByLabel("笔记内容").fill("较长的感言。".repeat(400));
        await editor.locator(".book-action-dialog").evaluate(el => { el.scrollTop = el.scrollHeight; });
        const close = editor.getByRole("button", { name: "关闭", exact: true });
        await expect(close).toBeInViewport();
        expect(await editor.locator(".book-action-dialog").evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        // Restore unchanged content so closing cannot write fixture data.
        await editor.getByLabel("笔记内容").fill("导入的笔记");
        await editor.press("Escape");
        await expect(editor).toHaveCount(0);
      }
    } finally { await page.evaluate(() => (window as LibraryWindow).bookLibraryFixture.destroy()); }
  });
}

test("book colors are a preview until explicit collection, with accessible cancellation and deletion", async ({ page }) => {
  const writes: Array<{ color?: string; text: string }> = [];
  let deletes = 0;
  await page.route("**/api/books/1/notes/v2/*", async route => {
    const input = route.request().postDataJSON();
    writes.push(input);
    await route.fulfill({ json: { note: { ...input, id: route.request().url().split("/").at(-1), bookId: 1, bookTitle: "示例图书", createdAt: "2026-11-26T00:00:00Z", updatedAt: "2026-11-26T00:00:00Z" } } });
  });
  await page.route("**/api/books/1/notes/*", async route => { deletes++; await route.fulfill({ json: { success: true } }); });
  await mountFixture(page);
  try {
    await page.evaluate(() => (window as LibraryWindow).bookLibraryFixture.select());
    const toolbar = page.getByRole("complementary", { name: "摘录操作" });
    await toolbar.getByRole("button", { name: "绿色高亮", exact: true }).click();
    await expect(toolbar.getByRole("button", { name: "绿色高亮", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(writes).toHaveLength(0);
    await toolbar.getByRole("button", { name: "收藏摘录", exact: true }).click();
    await page.evaluate(() => (window as LibraryWindow).bookLibraryFixture.pending[0].resolve({ notes: [] }));
    await expect(toolbar).toHaveCount(0);
    expect(writes).toHaveLength(1);
    expect(writes[0].color).toBe("#34a853");
    await page.evaluate(() => { const fixture = (window as LibraryWindow).bookLibraryFixture; fixture.edit({ ...fixture.note, color: "#34a853" }); });
    const editor = page.getByRole("dialog", { name: "阅读笔记", exact: true });
    await editor.getByRole("button", { name: "取消收藏", exact: true }).click();
    await expect(editor).toHaveCount(0);
    expect(writes).toHaveLength(2);
    expect(writes[1].color).toBeUndefined();
    expect(writes[1].text).toBe("导入的笔记");
    expect(deletes).toBe(0);
    await page.evaluate(() => (window as LibraryWindow).bookLibraryFixture.edit());
    await editor.getByRole("button", { name: "删除笔记", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "删除这条阅读笔记？", exact: true });
    await confirmation.getByRole("button", { name: "取消", exact: true }).click();
    await expect(editor).toBeVisible();
    expect(deletes).toBe(0);
    await editor.getByRole("button", { name: "删除笔记", exact: true }).click();
    await confirmation.getByRole("button", { name: "删除", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(confirmation).toHaveCount(0);
    expect(deletes).toBe(1);
    expect(await page.evaluate(() => (window as LibraryWindow).bookLibraryFixture.changed)).toEqual([1, 1, 1]);
  } finally { await page.evaluate(() => (window as LibraryWindow).bookLibraryFixture.destroy()); }
});
