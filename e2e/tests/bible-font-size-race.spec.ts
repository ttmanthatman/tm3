import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { E2E_ADMIN, E2E_CHANNELS } from "../seed-data.js";

test.use({ serviceWorkers: "block" });

async function newAccount(page: Page) {
  const logged = await page.request.post("/api/auth/login", { data: E2E_ADMIN });
  const { token } = await logged.json();
  const account = { username: `bfont-${randomUUID().slice(0, 8)}`, password: "BibleFont123!" };
  const created = await page.request.post("/api/admin/accounts", { headers: { Authorization: `Bearer ${token}` }, data: { ...account, displayName: "字号竞态测试" } });
  expect(created.ok()).toBeTruthy();
  return account;
}

async function login(page: Page, credentials: { username: string; password: string }) {
  await page.goto("/");
  await page.getByPlaceholder("用户名").fill(credentials.username);
  await page.getByPlaceholder("密码").fill(credentials.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
}

// 回归：慢机上三次增大字号的点击间隔可超过 500ms 合并窗口，第一次防抖保存
//（值 21）真的发出；若其响应在第二次点击后返回，不得把本地已到 22 的编辑
// 打回 21，否则第三次点击只能得到 22。最终值必须 23 且刷新后仍为 23。
test("迟到的字号保存响应不得覆盖更新的本地编辑", async ({ page }) => {
  test.setTimeout(90_000);
  const credentials = await newAccount(page);
  await login(page, credentials);

  let held = false;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/me/preferences", async route => {
    if (route.request().method() === "PATCH" && !held) {
      held = true;
      await gate;
    }
    await route.continue();
  });

  await page.getByRole("button", { name: "圣经偏好设置", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "圣经偏好设置", exact: true });
  const fontSize = settings.getByLabel("经文字号");
  await expect(fontSize).toHaveValue("20");

  await settings.getByRole("button", { name: "增大字号", exact: true }).click();
  await expect(fontSize).toHaveValue("21");
  await page.waitForTimeout(650);
  await settings.getByRole("button", { name: "增大字号", exact: true }).click();
  await expect(fontSize).toHaveValue("22");
  expect(held).toBe(true);

  release();
  await page.waitForTimeout(400);
  await settings.getByRole("button", { name: "增大字号", exact: true }).click();
  await expect(fontSize).toHaveValue("23");

  await settings.getByRole("button", { name: "保存偏好", exact: true }).click();
  await expect(settings).toBeHidden();
  // 刷新后会话自动恢复（无登录表单），直接核对新会话读到的持久化字号。
  await page.reload();
  await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
  await page.getByRole("button", { name: "圣经偏好设置", exact: true }).click();
  const reopened = page.getByRole("dialog", { name: "圣经偏好设置", exact: true });
  await expect(reopened.getByLabel("经文字号")).toHaveValue("23");
});
