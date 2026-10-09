import { ensureBibleOpen } from "../helpers/bible.js";
import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { E2E_ADMIN } from "../seed-data.js";
import type { BibleNoteDTO } from "../../src/shared/bibleNotes.js";
// Keep injected transport failures in the page context; a service worker can
// handle fetches before Playwright's page routes on WebKit.
test.use({ serviceWorkers: "block" });

test("自己的圣经笔记可以下载、导入为私密笔记并跳过重复内容", async ({ page, request }) => {
  const headers = await login(page);
  const text = `备份领受 ${randomUUID()}`;
  const response = await request.post("/api/bible/notes", { headers, data: {
    id: randomUUID(), translation: "cmn-cu89s", bookCode: "JHN", chapter: 11, verse: 35, text, public: true
  } });
  expect(response.ok()).toBeTruthy();
  let note = (await response.json()).note as BibleNoteDTO;
  try {
    await ensureBibleOpen(page);
    const home = page.getByRole("button", { name: "目录", exact: true });
    if (await home.isVisible()) await home.click();
    await page.getByRole("tab", { name: "我的笔记", exact: true }).click();
    const library = page.getByRole("region", { name: "经文笔记列表" });
    await expect(library).toContainText(text);
    const downloaded = page.waitForEvent("download");
    await library.getByRole("button", { name: "导出笔记" }).click();
    const file = await downloaded;
    const path = (await file.path())!;
    const backup = JSON.parse(await fs.readFile(path, "utf8")) as { domain: string; notes: Array<{ text: string }> };
    expect(backup.domain).toBe("bible");
    expect(backup.notes.some((item) => item.text === text)).toBe(true);
    await request.delete(`/api/bible/notes/${note.id}`, { headers });
    await library.locator('input[type="file"]').setInputFiles(path);
    const dialog = page.getByRole("dialog", { name: "导入圣经笔记" });
    await dialog.getByRole("button", { name: "开始导入" }).click();
    await expect(dialog).toContainText("本次导入 1 条");
    await dialog.getByRole("button", { name: "完成", exact: true }).click();
    const own = await (await request.get("/api/bible/notes?scope=mine", { headers })).json() as { notes: BibleNoteDTO[] };
    note = own.notes.find((item) => item.text === text)!;
    expect(note).toBeTruthy(); expect(note.publishedAt).toBeNull();
    await expect(library).toContainText(text);
    await library.locator('input[type="file"]').setInputFiles(path);
    await dialog.getByRole("button", { name: "开始导入" }).click();
    await expect(dialog).toContainText("本次导入 0 条");
  } finally { await request.delete(`/api/bible/notes/${note.id}`, { headers }); }
});

async function login(page: Page) {
  await page.route("**/*", (route) => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.goto("/");
  await page.getByPlaceholder("用户名").fill(E2E_ADMIN.username);
  await page.getByPlaceholder("密码").fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByTestId("active-channel-name")).toBeVisible();
  return { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem("team-chat-token"))}` };
}
async function openVerse(page: Page) {
  await ensureBibleOpen(page);
  // Restoring the saved reader after reload is asynchronous.
  await expect(async () => {
    const home = page.getByRole("button", { name: "目录", exact: true });
    if (await home.isVisible()) await home.click();
    await expect(page.getByRole("tab", { name: "经卷目录", exact: true })).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 10_000 });
  await page.getByRole("tab", { name: "经卷目录", exact: true }).click();
  await page.getByRole("button", { name: /^约翰福音/ }).click();
  await page.getByRole("button", { name: "11", exact: true }).click();
  await page.getByLabel("选择经节").selectOption("35");
  const verse = page.locator('[data-verse-key="JHN-11-35"]');
  await expect(verse).toBeVisible();
  await verse.click();
}

test("经文笔记默认公开、失败保留内容、便签展示、私密分享和撤回权限", async ({ page, request }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const headers = await login(page);
  const username = `notes-${Date.now()}`;
  const password = "BibleNotesTest123!";
  expect((await request.post("/api/admin/accounts", { headers, data: { username, password, displayName: "笔记读者" } })).ok()).toBeTruthy();
  const memberLogin = await request.post("/api/auth/login", { data: { username, password } });
  expect(memberLogin.ok()).toBeTruthy();
  const memberHeaders = { Authorization: `Bearer ${(await memberLogin.json()).token}` };
  await request.patch("/api/bible/notes/preferences", { headers, data: { alwaysPublic: false } });
  await openVerse(page);
  const verse = page.locator('[data-verse-key="JHN-11-35"]');
  await page.getByRole("button", { name: "笔记", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "经文笔记", exact: true });
  await expect(editor).toContainText("耶稣哭了");
  const text = `祂与我们一同流泪。${randomUUID()}\n在难过时，也可以来到祂面前。`;
  await editor.getByLabel("笔记内容", { exact: true }).fill(text);
  for (const width of [360, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    const box = (await editor.locator(".bible-note-editor").boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    expect(await editor.locator("textarea").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBeTruthy();
    const finish = (await editor.getByRole("button", { name: "完成笔记" }).boundingBox())!;
    expect(finish.y + finish.height).toBeLessThanOrEqual(844);
  }
  await editor.getByRole("button", { name: "关闭", exact: true }).click();
  const publication = page.getByRole("dialog", { name: "公开这篇笔记？" });
  await expect(publication.getByLabel("公开，分享到圣经", { exact: true })).toBeChecked();
  await publication.getByRole("button", { name: "继续写", exact: true }).click();
  await expect(editor.getByLabel("笔记内容")).toHaveValue(text);
  await editor.press("Escape");
  await expect(publication).toBeVisible();
  let failed = false;
  await page.route("**/api/bible/notes", async (route) => {
    if (!failed && route.request().method() === "POST") { failed = true; await route.fulfill({ status: 503, json: { message: "模拟网络中断，请重试" } }); }
    else await route.continue();
  });
  await publication.getByRole("button", { name: "保存笔记", exact: true }).click();
  await expect(publication.locator("[role=alert]")).toBeVisible();
  await expect(editor.getByLabel("笔记内容")).toHaveValue(text);
  await publication.getByRole("button", { name: "保存笔记", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "经文笔记便签" });
  await expect(sheet.locator(".note-writing")).toHaveText(text);
  await expect(sheet.locator(".note-signature")).toHaveCount(0);
  expect((await sheet.locator(".bible-note-sheet").boundingBox())!.height).toBeLessThan(260);
  const mine: { notes: BibleNoteDTO[] } = await (await request.get("/api/bible/notes?scope=mine", { headers })).json();
  const note = mine.notes.find((item) => item.text === text)!;
  expect(note.publishedAt).toBeTruthy();
  expect((await request.get(`/api/bible/notes/${note.id}`, { headers: memberHeaders })).ok()).toBeTruthy();
  for (const width of [360, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    const box = (await sheet.locator(".bible-note-sheet").boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    expect(await sheet.locator(".note-sheet-body").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBeTruthy();
    await fs.mkdir("output/e2e/notes-qa", { recursive: true });
    await page.screenshot({ path: `output/e2e/notes-qa/note-${width}.png` });
  }
  await sheet.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.getByRole("button", { name: "查看此节经文的笔记" }).first()).toBeVisible();
  await page.getByRole("button", { name: "查看此节经文的笔记" }).first().click();
  await expect(sheet.locator(".note-writing")).toHaveText(text);
  await expect(page.locator(".bible-note-browser")).toHaveCount(0);
  await expect(sheet.getByRole("navigation", { name: "笔记分类" })).toHaveCount(0);
  await sheet.getByRole("button", { name: "更多笔记操作" }).click();
  await sheet.getByRole("button", { name: "取消公开", exact: true }).click();
  await expect(sheet.locator(".note-signature")).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: "更多笔记操作" })).toBeEnabled();
  await sheet.getByRole("button", { name: "更多笔记操作" }).click();
  await expect(sheet).toContainText("仅自己可见");
  await sheet.getByRole("button", { name: "更多笔记操作" }).click();
  expect((await request.get(`/api/bible/notes/${note.id}`, { headers: memberHeaders })).status()).toBe(404);
  await sheet.getByRole("button", { name: "更多笔记操作" }).click();
  await sheet.getByRole("button", { name: "分享到聊天室", exact: true }).click();
  const share = page.getByRole("dialog", { name: "分享笔记到聊天室" });
  await share.getByRole("button", { name: "发送笔记", exact: true }).click();
  await expect(share).toBeHidden();
  await expect(sheet).toContainText("已分享到聊天室");
  const memberRead = await request.get(`/api/bible/notes/${note.id}`, { headers: memberHeaders });
  expect(memberRead.ok()).toBeTruthy();
  await sheet.getByRole("button", { name: "前往查看" }).click();
  await expect(page.getByRole("dialog", { name: "这节经文的笔记" })).toBeHidden();
  const card = page.locator(`[data-note-id="${note.id}"]`);
  await expect(card).toContainText(text);
  await card.click();
  await expect(sheet.locator(".note-writing")).toHaveText(text);
  await sheet.getByRole("button", { name: "关闭", exact: true }).click();
  const messageId = await card.evaluate((element) => Number(element.closest("[data-message-id]")?.getAttribute("data-message-id")));
  expect(messageId).toBeGreaterThan(0);
  expect((await request.post(`/api/messages/${messageId}/recall`, { headers })).ok()).toBeTruthy();
  expect((await request.get(`/api/bible/notes/${note.id}`, { headers: memberHeaders })).status()).toBe(404);
  expect((await request.get(`/api/bible/notes/${note.id}`, { headers })).ok()).toBeTruthy();
  await request.delete(`/api/bible/notes/${note.id}`, { headers });
  const { accounts } = await (await request.get("/api/admin/accounts", { headers })).json();
  const account = accounts.find((item: { username: string }) => item.username === username);
  expect((await request.delete(`/api/admin/accounts/${account.id}`, { headers })).ok()).toBeTruthy();
  expect(errors).toEqual([]);
  // Selection stays usable after writing, browsing and sharing.
  await ensureBibleOpen(page);
  await expect(verse).toBeVisible();
});

test("保存已完成但响应丢失后，修改内容和公开选择再重试仍只有一篇笔记", async ({ page, request }) => {
  const headers = await login(page);
  await request.patch("/api/bible/notes/preferences", { headers, data: { alwaysPublic: false } });
  await openVerse(page);
  await page.getByRole("button", { name: "笔记", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "经文笔记", exact: true });
  const original = `未确认的保存 ${randomUUID()}`;
  await editor.getByLabel("笔记内容").fill(original);
  await editor.getByRole("button", { name: "完成笔记" }).click();
  const publication = page.getByRole("dialog", { name: "公开这篇笔记？" });
  let unconfirmed = true;
  await page.route("**/api/bible/notes/*/recovery", (route) => unconfirmed ? route.fulfill({ status: 503, json: { message: "模拟暂时无法确认保存结果" } }) : route.continue());
  await page.route("**/api/bible/notes", async (route) => {
    if (unconfirmed && route.request().method() === "POST") { expect((await route.fetch()).ok()).toBeTruthy(); await route.fulfill({ status: 503, json: { message: "模拟保存响应丢失" } }); }
    else await route.continue();
  });
  await publication.getByRole("button", { name: "保存笔记" }).click();
  await expect(publication.locator("[role=alert]")).toBeVisible();
  await publication.getByRole("button", { name: "继续写" }).click();
  const revised = `${original}\n修改后留给自己。`;
  await editor.getByLabel("笔记内容").fill(revised);
  await editor.getByRole("button", { name: "完成笔记" }).click();
  await publication.getByLabel("仅自己可见", { exact: true }).check();
  unconfirmed = false;
  await publication.getByRole("button", { name: "保存笔记" }).click();
  await expect(page.getByRole("dialog", { name: "经文笔记便签" }).locator(".note-writing")).toHaveText(revised);
  const mine: { notes: BibleNoteDTO[] } = await (await request.get("/api/bible/notes?scope=mine", { headers })).json();
  const saved = mine.notes.filter((note) => note.text.startsWith(original));
  expect(saved).toHaveLength(1);
  expect(saved[0].publishedAt).toBeNull();
  await request.delete(`/api/bible/notes/${saved[0].id}`, { headers });
});

test("不再提示的公开偏好跨刷新保留，私密笔记可重新分享到圣经", async ({ page, request }) => {
  const headers = await login(page);
  await request.patch("/api/bible/notes/preferences", { headers, data: { alwaysPublic: false } });
  await openVerse(page);
  await page.getByRole("button", { name: "笔记", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "经文笔记", exact: true });
  const text = `记住公开选择 ${randomUUID()}`;
  await editor.getByLabel("笔记内容").fill(text);
  await editor.getByRole("button", { name: "完成笔记" }).click();
  const publication = page.getByRole("dialog", { name: "公开这篇笔记？" });
  await publication.getByLabel("不再提示，以后都公开").check();
  await publication.getByRole("button", { name: "保存笔记" }).click();
  await expect(page.getByRole("dialog", { name: "经文笔记便签" })).toContainText(text);
  expect((await (await request.get("/api/bible/notes/preferences", { headers })).json()).alwaysPublic).toBe(true);
  await page.reload();
  await expect(page.getByTestId("active-channel-name")).toBeVisible();
  await openVerse(page);
  await page.getByRole("button", { name: "笔记", exact: true }).click();
  const nextText = `刷新后仍公开 ${randomUUID()}`;
  await editor.getByLabel("笔记内容").fill(nextText);
  await editor.getByRole("button", { name: "完成笔记" }).click();
  await expect(publication).toBeHidden();
  const sheet = page.getByRole("dialog", { name: "经文笔记便签" });
  await expect(sheet).toContainText(nextText);
  await sheet.getByRole("button", { name: "更多笔记操作" }).click();
  await sheet.getByRole("button", { name: "编辑笔记" }).click();
  await expect(editor.getByLabel("笔记内容")).toHaveValue(nextText);
  await editor.getByLabel("笔记内容").fill(`${nextText}\n修改后只留给自己。`);
  await editor.getByRole("button", { name: "完成笔记" }).click();
  await publication.getByLabel("仅自己可见", { exact: true }).check();
  await publication.getByRole("button", { name: "保存笔记" }).click();
  await expect(sheet.locator(".note-signature")).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: "更多笔记操作" })).toBeEnabled();
  await sheet.getByRole("button", { name: "更多笔记操作" }).click();
  await expect(sheet).toContainText("仅自己可见");
  await sheet.getByRole("button", { name: "更多笔记操作" }).click();
  await sheet.getByRole("button", { name: "更多笔记操作" }).click();
  await sheet.getByRole("button", { name: "分享到圣经", exact: true }).click();
  await expect(sheet.getByRole("button", { name: "更多笔记操作" })).toBeEnabled();
  await sheet.getByRole("button", { name: "更多笔记操作" }).click();
  await expect(sheet).toContainText("已公开");
  const mine: { notes: BibleNoteDTO[] } = await (await request.get("/api/bible/notes?scope=mine", { headers })).json();
  for (const note of mine.notes.filter((item) => item.text.startsWith(text) || item.text.startsWith(nextText))) await request.delete(`/api/bible/notes/${note.id}`, { headers });
  await request.patch("/api/bible/notes/preferences", { headers, data: { alwaysPublic: false } });
});

test("经节直接打开便签，菜单合并私密和公开笔记并支持分页、重试和长文", async ({ page, request }) => {
  const headers = await login(page);
  const username = `note-reader-${randomUUID().slice(0, 8)}`;
  const password = "BibleNotesTest123!";
  expect((await request.post("/api/admin/accounts", { headers, data: { username, password, displayName: "另一位笔记作者" } })).ok()).toBeTruthy();
  const member = await request.post("/api/auth/login", { data: { username, password } });
  const otherHeaders = { Authorization: `Bearer ${(await member.json()).token}` };
  const selection = { translation: "cmn-cu89s", bookCode: "JHN", chapter: 11, verse: 35 };
  async function create(text: string, isPublic: boolean, authorization = headers) {
    const response = await request.post("/api/bible/notes", { headers: authorization, data: { id: randomUUID(), ...selection, text, public: isPublic } });
    expect(response.ok()).toBeTruthy();
    return (await response.json()).note as BibleNoteDTO;
  }
  const privateNote = await create("只留给自己的笔记", false);
  const publicNote = await create("我的公开笔记", true);
  const otherNote = await create("来自另一位作者的领受。\n".repeat(180), true, otherHeaders);
  let fail = true;
  await page.route("**/api/bible/notes?*", (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (!params.has("verse")) return route.continue();
    if (fail) { fail = false; return route.fulfill({ status: 503, json: { message: "笔记暂未加载" } }); }
    const offset = Number(params.get("offset"));
    const items = params.get("scope") === "mine" ? [privateNote, publicNote] : [publicNote, otherNote];
    return route.fulfill({ json: { notes: [items[offset]], nextOffset: offset === 0 ? 1 : null } });
  });
  await openVerse(page);
  await page.getByRole("button", { name: "查看此节经文的笔记" }).first().click();
  const sheet = page.getByRole("dialog", { name: "经文笔记便签" });
  await expect(sheet.getByRole("alert")).toBeVisible();
  await sheet.getByRole("button", { name: "重试", exact: true }).click();
  await expect(sheet.locator(".note-writing")).toHaveText(privateNote.text);
  await expect(sheet.locator(".note-signature")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await sheet.getByRole("button", { name: "更多笔记操作" }).click();
  await sheet.getByRole("button", { name: "切换笔记", exact: true }).click();
  const choices = sheet.locator(".note-choices");
  await choices.getByRole("button", { name: "更多笔记", exact: true }).click();
  await expect(choices.getByRole("button")).toHaveCount(3);
  await choices.getByRole("button", { name: /来自另一位作者/ }).click();
  await expect(sheet.locator(".note-signature")).toContainText("另一位笔记作者");
  await sheet.getByRole("button", { name: "更多笔记操作" }).click();
  await expect(sheet.getByRole("button", { name: "编辑笔记", exact: true })).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: "删除笔记", exact: true })).toHaveCount(0);
  await sheet.getByRole("button", { name: "更多笔记操作" }).click();
  for (const width of [360, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await sheet.locator(".note-sheet-body").evaluate((el) => el.scrollHeight > el.clientHeight && el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
    const close = (await sheet.getByRole("button", { name: "关闭", exact: true }).boundingBox())!;
    expect(close.y).toBeGreaterThanOrEqual(0);
    expect(close.x + close.width).toBeLessThanOrEqual(width);
  }
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await request.delete(`/api/bible/notes/${privateNote.id}`, { headers });
  await request.delete(`/api/bible/notes/${publicNote.id}`, { headers });
  await request.delete(`/api/bible/notes/${otherNote.id}`, { headers: otherHeaders });
});
