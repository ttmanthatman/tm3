import { expect, test, type Page } from "@playwright/test";
import type { mountBookNoteLibrary } from "../fixtures/book-note-library";

type LibraryWindow = Window & { bookLibraryFixture: Awaited<ReturnType<typeof mountBookNoteLibrary>> };

async function mountFixture(page: Page) {
  await page.goto("/");
  await page.evaluate(() => {
    const root = document.querySelector("#app") as (HTMLElement & { __vue_app__?: { unmount(): void } }) | null;
    root?.__vue_app__?.unmount();
  });
  await page.setContent('<div id="book-library-fixture"></div>');
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
