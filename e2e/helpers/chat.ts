import { expect, type Page } from "@playwright/test";

// 2026-10 起桌面/iPad 登录后默认「圣经+聊天」分屏且频道列表折叠（见 bible-split 布局）。
// 9 月前写下的聊天优先用例（smoke、弹窗、频道切换等）登录后调用 focusChat
// 回到聊天为主的状态：先关掉默认打开的圣经工作区，再展开折叠的频道列表。
// 移动端窄屏不自动开圣经，频道抽屉是否打开由各用例自己决定，这里不做处理。

export async function closeBibleWorkspace(page: Page) {
  const bible = page.locator("#bible-workspace.bible-workspace.open");
  const close = page.getByRole("button", { name: "关闭圣经", exact: true });
  const closed = page.locator('.bible-header-trigger[aria-pressed="false"]');
  // The header exposes the closed state immediately; an opening workspace
  // exposes its close button once its async component is ready.
  await expect(closed.or(close).filter({ visible: true }).first()).toBeVisible();
  if (await closed.isVisible()) return;
  await close.click();
  await expect(bible).toBeHidden();
}

/** 登录后回到聊天为主：关闭默认打开的圣经分屏，展开桌面折叠态的频道列表 */
export async function focusChat(page: Page) {
  await closeBibleWorkspace(page);
  const expand = page.getByRole("button", { name: "展开频道", exact: true });
  if (await expand.isVisible()) {
    await expand.click();
    await expect(expand).toBeHidden();
    await expect(page.locator(".channel-pane")).toBeVisible();
  }
}
