import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { E2E_ADMIN, E2E_CHANNELS } from "../seed-data.js";

// Optional private fixtures stay outside Git and are uploaded only to the isolated local test server.
const directory = process.env.E2E_BOOK_COMPAT_DIR;
const files = directory ? fs.readdirSync(directory).filter(name => name.endsWith(".epub")).sort() : [];
for (const [index, name] of files.entries()) {
  test(`existing EPUB ${index + 1}: scrolling passes opening pages and TOC reaches another chapter`, async ({ page, request }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width: 557, height: 1073 });
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      return ["blob:", "data:"].includes(url.protocol) || url.hostname === "127.0.0.1" ? route.continue() : route.abort();
    });
    const login = await request.post("/api/auth/login", { data: E2E_ADMIN });
    const token = (await login.json()).token, headers = { Authorization: `Bearer ${token}` };
    const uploaded = await request.post("/api/admin/books", { headers, multipart: { file: { name: "compat.epub", mimeType: "application/epub+zip", buffer: fs.readFileSync(path.join(directory!, name)) } } });
    expect(uploaded.status()).toBe(201);
    const { book } = await uploaded.json();
    try {
      await page.goto("/");
      await page.getByPlaceholder("用户名").fill(E2E_ADMIN.username); await page.getByPlaceholder("密码").fill(E2E_ADMIN.password);
      await page.getByRole("button", { name: "登录", exact: true }).click();
      await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
      await page.getByRole("button", { name: "打开图书室" }).click();
      await page.locator(`[data-book-id="${book.id}"] .book-card`).click();
      await expect(page.getByText("正在打开…", { exact: true })).toHaveCount(0);
      const scroller = page.locator("[data-continuous-reader]");
      await expect(scroller).toBeVisible();
      const parsed = await page.evaluate(async (id) => {
        const source = "/src/client/books/reader.ts";
        const { createEpubBook, createStreamingLoader } = await import(source) as typeof import("../../src/client/books/reader");
        const publication = await createEpubBook(await createStreamingLoader(`/api/books/${id}/file`));
        let count = 0;
        try {
          for (const section of publication.sections) {
            const url = await section.load();
            if (!url) throw new Error(`Section ${count} has no document`);
            const response = await fetch(url);
            if (!response.ok) throw new Error(`Section ${count} cannot be read`);
            const document = new DOMParser().parseFromString(await response.text(), "text/html");
            if (!document.body || document.querySelector("parsererror")) throw new Error(`Section ${count} cannot be parsed`);
            section.unload?.(); count++;
          }
        } finally { publication.destroy?.(); }
        return count;
      }, book.id);
      expect(parsed).toBe(await scroller.locator("[data-section-index]").count());
      await scroller.hover();
      for (let step = 0; step < 8; step++) { await page.mouse.wheel(0, 700); await page.waitForTimeout(150); }
      if (parsed > 1) await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(1500);
      else expect(await scroller.evaluate(element => element.scrollHeight <= element.clientHeight || element.scrollTop > 0)).toBe(true);
      if (parsed === 1) return;
      await page.mouse.wheel(0, -24);
      await page.getByRole("button", { name: "目录", exact: true }).click();
      const last = page.locator(".book-toc button").last();
      await expect(last).toBeVisible();
      const before = await scroller.evaluate(element => element.scrollTop);
      await last.click();
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).not.toBe(before);
      await expect.poll(() => page.locator('[data-section-index] iframe').evaluateAll(frames => frames.some(frame => Number(frame.parentElement?.dataset.sectionIndex) > 2 && frame.getBoundingClientRect().bottom > 0))).toBe(true);

    } finally { await request.delete(`/api/admin/books/${book.id}`, { headers }); }
  });
}
