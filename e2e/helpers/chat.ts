import { expect, type Page } from "@playwright/test";

// 2026-10 起桌面/iPad 登录后默认「圣经+聊天」分屏且频道列表折叠（见 bible-split 布局）。
// 9 月前写下的聊天优先用例（smoke、弹窗、频道切换等）登录后调用 focusChat
// 回到聊天为主的状态：先关掉默认打开的圣经工作区，再展开折叠的频道列表。
// 移动端窄屏不自动开圣经，频道抽屉是否打开由各用例自己决定，这里不做处理。

export async function closeBibleWorkspace(page: Page) {
  const bible = page.locator("#bible-workspace.bible-workspace.open");
  // reload/登录后工作区可能晚一拍才挂载；等一小段时间再判定，避免 isVisible 抢跑漏关。
  await bible.waitFor({ state: "visible", timeout: 3000 }).catch(() => undefined);
  if (!await bible.isVisible()) return;
  await page.getByRole("button", { name: "关闭圣经", exact: true }).click();
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
