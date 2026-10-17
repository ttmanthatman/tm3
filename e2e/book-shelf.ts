import { expect, type Page } from "@playwright/test";

export async function bookShelfAction(page: Page, title: string, action: string, bookId?: number) {
  const shelf = bookId ? page.locator(`[data-book-id="${bookId}"]`) : page;
  await shelf.getByRole("button", { name: `阅读《${title}》`, exact: true }).click({ button: "right" });
  const menu = page.getByRole("menu", { name: `《${title}》操作`, exact: true });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: action, exact: true }).click();
}
