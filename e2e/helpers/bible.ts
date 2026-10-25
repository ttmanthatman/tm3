import { expect, type Page } from "@playwright/test";

export async function ensureBibleOpen(page: Page) {
  const workspace = page.locator(".bible-workspace");
  const toggle = page.locator('.bible-header-trigger[aria-pressed="false"]');
  // On phones the header disappears before the async workspace mounts.
  // Wait for either settled state instead of committing to a stale isVisible.
  await expect(workspace.or(toggle).filter({ visible: true }).first()).toBeVisible();
  if (!await workspace.isVisible()) {
    await toggle.click();
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
