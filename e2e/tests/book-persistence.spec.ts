import { test, expect } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import JSZip from "jszip";
import { E2E_ADMIN, E2E_CHANNELS, E2E_MEMBER } from "../seed-data.js";
import { bookNoteSchema, bookNoteShareSchema } from "../../src/shared/bookNotes.js";
import type { BookProgressSnapshot } from "../../src/shared/bookLocator.js";

async function publication() {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file("META-INF/container.xml", '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file("book.opf", '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">persistence</dc:identifier><dc:title>精确进度回归</dc:title><dc:language>zh</dc:language></metadata><manifest><item id="ch" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="ch"/></spine></package>');
  zip.file("chapter.xhtml", `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>原文</title></head><body>${Array.from({ length: 80 }, (_, index) => `<p id="p-${index}">第${index}段。${"这段原文在换设备和重排以后仍可准确找到。".repeat(10)}</p>`).join("")}</body></html>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

test("v2 progress uses real database CAS, idempotency, legacy invalidation and private note projections", async ({ request }) => {
  const login = await request.post("/api/auth/login", { data: E2E_ADMIN }), headers = { Authorization: `Bearer ${(await login.json()).token}` };
  const buffer = await publication();
  const uploaded = await request.post("/api/admin/books", { headers, multipart: { file: { name: "progress.epub", mimeType: "application/epub+zip", buffer } } });
  expect(uploaded.status()).toBe(201);
  const { book } = await uploaded.json();
  const url = `/api/books/${book.id}/progress/v2`;
  try {
    expect((await request.get(url)).status()).toBe(401);
    const read = async () => (await (await request.get(url, { headers })).json()).progress as BookProgressSnapshot;
    const initial = await read();
    expect(initial.publicationRevision).toBe(createHash("sha256").update(buffer).digest("hex")); expect(initial.revision).toBe(0);
    const locator = { version: 1, bookId: book.id, publicationRevision: initial.publicationRevision, textRevision: "epub-text-v1", sectionHref: "chapter.xhtml", start: 0, end: 4, quote: { exact: "第0段。", prefix: "", suffix: "这", length: 4 } };
    const write = { fraction: .2, locator, baseRevision: 0, mutationId: randomUUID() };
    const otherWrite = { ...write, fraction: .8, mutationId: randomUUID() };
    const results = await Promise.all([request.put(url, { headers, data: write }), request.put(url, { headers, data: otherWrite })]);
    expect(results.map(result => result.status()).sort()).toEqual([200, 409]);
    const winner = results.find(result => result.status() === 200)!;
    const saved = (await winner.json()).progress as BookProgressSnapshot; expect(saved.revision).toBe(1); expect(saved.locatorRevision).toBe(1);
    // Retry the winner's original mutation without a new revision or duplicate write.
    const winningWrite = results[0].status() === 200 ? write : otherWrite;
    const retried = await request.put(url, { headers, data: winningWrite }); expect(retried.status()).toBe(200); expect((await retried.json()).progress.revision).toBe(1);
    const legacy = await request.put(`/api/books/${book.id}/progress`, { headers, data: { fraction: .05 } }); expect(legacy.status()).toBe(200);
    expect(await read()).toMatchObject({ fraction: .05, locator: null, revision: 2, locatorRevision: null });
    expect((await request.put(url, { headers, data: write })).status()).toBe(409);
    expect((await request.put(url, { headers, data: { ...write, baseRevision: 2, locator: { ...locator, publicationRevision: "f".repeat(64) }, mutationId: randomUUID() } })).status()).toBe(422);
    expect((await request.put(url, { headers, data: { ...write, baseRevision: 2, locator: { ...locator, sectionHref: "../escape" } } })).status()).toBe(400);
    const noteId = randomUUID(), note = { quote: "第0段。", text: "私密想法", chapter: "第一章", fraction: .2, locator };
    const created = await request.put(`/api/books/${book.id}/notes/v2/${noteId}`, { headers, data: note }); expect(created.status()).toBe(200);
    expect((await created.json()).note.locator).toEqual(locator);
    const v1Notes = (await (await request.get(`/api/books/${book.id}/notes`, { headers })).json()).notes;
    expect(bookNoteSchema.safeParse(v1Notes[0]).success).toBe(true); expect(v1Notes[0].locator).toBeUndefined();
    expect(bookNoteShareSchema.safeParse({ kind: "book_note", note: v1Notes[0] }).success).toBe(true);
    expect((await request.get(`/api/books/${book.id}/notes/v2`)).status()).toBe(401);
    const username = `epub-${randomUUID().slice(0, 8)}`;
    const registered = await request.post("/api/admin/accounts", { headers, data: { ...E2E_MEMBER, username } });
    expect(registered.ok()).toBe(true);
    const member = await request.post("/api/auth/login", { data: { username, password: E2E_MEMBER.password } });
    expect(member.ok()).toBe(true);
    const memberHeaders = { Authorization: `Bearer ${(await member.json()).token}` };
    expect((await (await request.get(`/api/books/${book.id}/notes/v2`, { headers: memberHeaders })).json()).notes).toEqual([]);
    expect((await (await request.get(url, { headers: memberHeaders })).json()).progress).toMatchObject({ fraction: null, locator: null, revision: 0 });
  } finally { await request.delete(`/api/admin/books/${book.id}`, { headers }); }
});

test("reader reopens exact text and offers an explicit choice after another device writes", async ({ page, request }) => {
  test.setTimeout(90000);
  await page.goto("/"); await page.getByPlaceholder("用户名").fill(E2E_ADMIN.username); await page.getByPlaceholder("密码").fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "登录", exact: true }).click(); await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
  const headers = { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem("team-chat-token"))}` };
  const uploaded = await request.post("/api/admin/books", { headers, multipart: { file: { name: "precise.epub", mimeType: "application/epub+zip", buffer: await publication() } } });
  const { book } = await uploaded.json(), url = `/api/books/${book.id}/progress/v2`;
  const read = async () => (await (await request.get(url, { headers })).json()).progress as BookProgressSnapshot;
  try {
    await page.getByRole("button", { name: "打开图书室" }).click();
    const open = async () => { await page.locator(`[data-book-id="${book.id}"]`).getByRole("button", { name: "阅读《精确进度回归》", exact: true }).click(); await expect(page.getByText("正在打开…", { exact: true })).toHaveCount(0); };
    await open();
    const scrollToParagraph = async (index: number) => page.locator("[data-continuous-reader]").evaluate((element, index) => {
      const frame = element.querySelector<HTMLIFrameElement>("iframe")!, doc = frame.contentDocument!, range = doc.createRange();
      range.setStart(doc.querySelector(`#p-${index}`)!.firstChild!, 0); range.setEnd(doc.querySelector(`#p-${index}`)!.firstChild!, 1);
      element.scrollTop += frame.getBoundingClientRect().top + range.getBoundingClientRect().top - element.getBoundingClientRect().top - element.clientHeight / 3;
    }, index);
    await scrollToParagraph(30);
    await expect.poll(async () => (await read()).locator?.quote.exact).toBe("第");
    const saved = await read(); expect(saved.locator).toBeTruthy();
    await page.keyboard.press("Escape"); await open();
    await expect(page.frameLocator('iframe[title="电子书第 1 节"]').locator("#p-30")).toBeInViewport();
    // A second device advances the server without moving this open reader.
    expect((await request.put(url, { headers, data: { fraction: .9, locator: null, baseRevision: saved.revision, mutationId: randomUUID() } })).status()).toBe(200);
    await scrollToParagraph(15);
    await expect(page.getByRole("button", { name: "保留本机位置" })).toBeVisible();
    const beforeChoice = await read(); expect(beforeChoice.fraction).toBe(.9);
    await page.getByRole("button", { name: "保留本机位置" }).click();
    await expect.poll(async () => (await read()).revision).toBe(beforeChoice.revision + 1);
    expect((await read()).fraction!).toBeLessThan(.9);
    // A failed PUT keeps an account-scoped pending locator through close/reopen.
    await page.route(`**${url}`, route => route.request().method() === "PUT" ? route.abort("internetdisconnected") : route.continue());
    await scrollToParagraph(10);
    await expect(page.getByRole("status").filter({ hasText: "联网后重试" })).toBeVisible();
    await page.keyboard.press("Escape"); await open();
    await expect(page.frameLocator('iframe[title="电子书第 1 节"]').locator("#p-10")).toBeInViewport();
    await page.unroute(`**${url}`);
    await page.getByRole("button", { name: "重试同步", exact: true }).click();
    await expect(page.getByRole("button", { name: "重试同步", exact: true })).toHaveCount(0);
    expect((await read()).locator).toBeTruthy();
    await page.keyboard.press("Escape");
  } finally { await request.delete(`/api/admin/books/${book.id}`, { headers }); }
});
