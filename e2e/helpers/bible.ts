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
