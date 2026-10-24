import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { createHmac, randomUUID } from "node:crypto";
import { E2E_ADMIN, E2E_CHANNELS } from "../seed-data.js";
import { focusChat } from "../helpers/chat.js";

test.use({ serviceWorkers: "block" });
const secret = "e2e-only-zoom-announcements";
const meetingUrl = "https://zoom.us/j/123456789?pwd=e2e-fixture";

test("Zoom events create durable centered notices in every public chat, deduplicate retries and link to the meeting", async ({ page, request }) => {
  test.setTimeout(120_000);
  const database = new URL(process.env.DATABASE_URL || "mysql://invalid");
  if (process.env.E2E_TEST_RUN !== "1" || database.pathname !== "/tm3_e2e" || !["127.0.0.1", "localhost"].includes(database.hostname) || process.env.ZOOM_WEBHOOK_SECRET_TOKEN !== secret) {
    throw new Error("Zoom E2E requires the isolated tm3_e2e runner and its test-only signing secret");
  }
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.context().route("https://zoom.us/**", route => route.fulfill({ contentType: "text/html", body: "Zoom E2E fixture" }));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await page.getByPlaceholder("用户名").fill(E2E_ADMIN.username);
  await page.getByPlaceholder("密码").fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
  await focusChat(page);
  const token = await page.evaluate(() => localStorage.getItem("team-chat-token"));
  const headers = { Authorization: `Bearer ${token}` };
  expect((await request.put("/api/admin/zoom/link", { headers, data: { url: meetingUrl } })).ok()).toBe(true);
  const prisma = new PrismaClient();
  try {
    const excluded = await prisma.channel.create({ data: { name: "Zoom E2E private", isPrivate: true } });
    const direct = await prisma.channel.create({ data: { name: "Zoom E2E direct", kind: "direct", isPrivate: true } });
    const publicChannels = await prisma.channel.findMany({ where: { kind: "standard", isPrivate: false }, select: { id: true, name: true } });
    const current = publicChannels.find(channel => channel.name === E2E_CHANNELS.default)!;
    const secondary = publicChannels.find(channel => channel.name === E2E_CHANNELS.secondary)!;
    const uuid = randomUUID();
    const eventTs = Date.now();
    async function notify(event: string, time = eventTs, instance = uuid, signatureSecret = secret) {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const data = JSON.stringify({ event, event_ts: time, payload: { object: { id: "123456789", uuid: instance } } });
      return request.post("/api/zoom/webhook", { data, headers: {
        "content-type": "application/json", "x-zm-request-timestamp": timestamp,
        "x-zm-signature": `v0=${createHmac("sha256", signatureSecret).update(`v0:${timestamp}:${data}`).digest("hex")}`
      } });
    }
    expect((await notify("meeting.started", eventTs, uuid, "forged-secret")).status()).toBe(401);
    const starts = await Promise.all([notify("meeting.started"), notify("meeting.started")]);
    expect(starts.map(response => response.status())).toEqual([204, 204]);
    const start = page.locator(".message-row.system .zoom-meeting-announcement").filter({ hasText: "Zoom会议开始了" });
    await expect(start).toBeVisible(); // Live Socket delivery, without a reload.
    await expect(start).toHaveAttribute("href", meetingUrl);
    await expect(start).toHaveCSS("background-color", "rgb(36, 107, 255)");
    await expect(start).toHaveCSS("color", "rgb(255, 255, 255)");
    const before = await prisma.message.findMany({ where: { sender: { username: "system:zoom" } }, orderBy: { id: "asc" } });
    expect(before.map(message => message.channelId).sort((a, b) => a - b)).toEqual(publicChannels.map(channel => channel.id).sort((a, b) => a - b));
    expect(before.some(message => [excluded.id, direct.id].includes(message.channelId))).toBe(false);
    const retries = await Promise.all([notify("meeting.started"), notify("meeting.started")]);
    expect(retries.map(response => response.status())).toEqual([204, 204]);
    expect(await prisma.message.count({ where: { sender: { username: "system:zoom" } } })).toBe(publicChannels.length);
    await expect(start).toHaveCount(1);
    for (const width of [360, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await start.scrollIntoViewIfNeeded();
      expect(await start.evaluate(element => {
        const notice = element.getBoundingClientRect(), row = element.closest(".message-row")!.getBoundingClientRect();
        return Math.abs((notice.left + notice.right) / 2 - (row.left + row.right) / 2);
      })).toBeLessThan(2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await start.screenshot({ path: test.info().outputPath(`zoom-notice-${width}.png`) });
    }
    await start.focus();
    const popupPromise = page.waitForEvent("popup");
    await page.keyboard.press("Enter");
    const popup = await popupPromise;
    await expect(popup).toHaveURL(meetingUrl);
    await popup.close();
    expect((await notify("meeting.ended", eventTs + 1)).status()).toBe(204);
    const ended = page.locator(".message-row.system .zoom-meeting-announcement").filter({ hasText: "Zoom会议结束了" });
    await expect(ended).toBeVisible();
    await expect(ended).not.toHaveAttribute("href");
    await expect(start).not.toHaveAttribute("href");
    const pageCount = page.context().pages().length;
    await start.click();
    await expect(page.locator(".oops-falling-glyph")).not.toHaveCount(0);
    expect(page.context().pages()).toHaveLength(pageCount);
    await start.click();
    await expect(page.locator(".oops-falling-glyph")).toHaveCount(0);
    await start.press("Space");
    await expect(page.locator(".oops-falling-glyph")).not.toHaveCount(0);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
    await expect(page.locator(".oops-falling-glyph")).toHaveCount(0);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow")));
    expect((await notify("meeting.ended", eventTs + 1)).status()).toBe(204);
    expect(await prisma.message.count({ where: { sender: { username: "system:zoom" } } })).toBe(publicChannels.length * 2);
    // History remains available after reload and when changing to another public channel.
    await page.reload(); await expect(page.getByTestId("active-channel-name")).toBeVisible(); await focusChat(page);
    await expect(start).toHaveCount(1); await expect(ended).toHaveCount(1);
    await page.getByRole("button", { name: new RegExp(`${E2E_CHANNELS.secondary}$`) }).click();
    await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.secondary);
    await expect(start).toBeVisible(); await expect(ended).toBeVisible();
    const history = await request.get(`/api/messages?channelId=${secondary.id}`, { headers });
    expect(history.ok()).toBe(true);
    const currentHistory = await prisma.message.findMany({ where: { channelId: current.id, sender: { username: "system:zoom" } }, orderBy: { id: "asc" } });
    expect(currentHistory.map(message => message.content)).toEqual(["Zoom会议开始了", "Zoom会议结束了"]);
    expect(errors).toEqual([]);
  } finally { await prisma.$disconnect(); }
});
