import { expect, type Page } from "@playwright/test";

export async function ensureBibleOpen(page: Page) {
  const workspace = page.locator(".bible-workspace");
  if (!await workspace.isVisible()) {
    const toggle = page.locator(".bible-header-trigger");
    await expect(toggle).toBeVisible();
    if (await toggle.getAttribute("aria-pressed") === "false") await toggle.click();
  }
  await expect(workspace).toBeVisible();
}

export async function openBibleHome(page: Page) {
  await ensureBibleOpen(page);
  await expect(page.locator(".bible-home-pane.active, .bible-reader-pane.active")).toBeVisible();
  const reader = page.locator(".bible-reader-pane.active");
  if (await reader.isVisible()) {
    const expand = reader.getByRole("button", { name: /^展开 .* 窗格导航$/ });
    if (await expand.isVisible()) await expand.click();
    await reader.getByRole("button", { name: /窗格目录$/ }).click();
  }
  await expect(page.locator(".bible-home-pane.active")).toBeVisible();
}
