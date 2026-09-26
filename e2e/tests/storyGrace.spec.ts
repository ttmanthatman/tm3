import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { E2E_ADMIN, E2E_CHANNELS } from "../seed-data.js";
import type { ChannelDTO, GracePayload, MessageDTO } from "../../src/shared/types.js";
import type { StoryDTO, StoryPageDTO } from "../../src/shared/stories.js";

test("我的故事原样转发、重试去重、独立媒体与恩典卡片交互", async ({ page, request }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.goto("/");
  await page.getByPlaceholder("用户名").fill(E2E_ADMIN.username);
  await page.getByPlaceholder("密码").fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByTestId("active-channel-name")).toBeVisible();
  const token = await page.evaluate(() => localStorage.getItem("team-chat-token"));
  const headers = { Authorization: `Bearer ${token}` };
  const me = (await (await request.get("/api/auth/me", { headers })).json()).account;
  const channels = (await (await request.get("/api/channels", { headers })).json()).channels as ChannelDTO[];
  const current = channels.find((channel) => channel.name === E2E_CHANNELS.default)!;
  const target = channels.find((channel) => channel.name === E2E_CHANNELS.secondary)!;
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "story-grace-e2e-"));
  const prisma = new PrismaClient();
  try {
    const audioPath = path.join(scratch, "voice.m4a");
    await promisify(execFile)("ffmpeg", ["-nostdin", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=5", "-c:a", "aac", audioPath], { timeout: 30_000 });
    const audio = await fs.readFile(audioPath);
    const image = await fs.readFile("public/images/stories/story-banner.png");
    async function publish(text: string, photos: number, voice: boolean): Promise<StoryDTO> {
      const form = new FormData();
      form.append("requestId", crypto.randomUUID());
      form.append("text", text);
      for (let index = 0; index < photos; index++) form.append("image", new File([image], `photo-${index}.png`, { type: "image/png" }));
      if (voice) form.append("voice", new File([audio], "voice.m4a", { type: "audio/mp4" }));
      const response = await request.post("/api/stories", { headers, multipart: form });
      expect(response.ok(), await response.text()).toBeTruthy();
      return (await response.json()).story;
    }
    const mixed = await publish("转发回归 & <日常>\n恩典第二行", 9, true);
    const photoOnly = await publish("", 1, false);
    const voiceOnly = await publish("", 0, true);
    const stories = async () => (await (await request.get(`/api/stories?actorId=${me.actorId}`, { headers })).json()) as StoryPageDTO;
    const before = await stories();
    await page.locator(".story-header-trigger").click();
    await page.getByRole("button", { name: "我们的故事，点击切换" }).click();
    const own = page.getByRole("dialog", { name: "我的故事", exact: true });
    const row = own.locator(".story-moment").filter({ hasText: "转发回归 & <日常>" });
    const dialog = page.getByRole("dialog", { name: "转发为恩典卡片", exact: true });
    for (const width of [360, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await row.getByRole("button", { name: "转发为恩典卡片", exact: true }).click();
      await expect(dialog.getByLabel("转发到聊天室")).toHaveValue(String(current.id));
      await expect(dialog.locator(".story-grace-preview-photos img")).toHaveCount(9);
      await expect(dialog.getByRole("button", { name: "关闭故事转发" })).toBeVisible();
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBeTruthy();
      await expect(dialog.locator("textarea")).toHaveCount(0);
      await page.screenshot({ path: `output/e2e/story-grace-${width}.png` });
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(own).toBeVisible();
    }
    await row.getByRole("button", { name: "转发为恩典卡片", exact: true }).click();
    await dialog.getByLabel("转发到聊天室").selectOption(String(target.id));
    const ids: string[] = [];
    const forwardUrl = `**/api/stories/${mixed.id}/forward-grace`;
    await page.route(forwardUrl, async (route) => {
      ids.push(route.request().postDataJSON().clientRequestId);
      if (ids.length === 1) { const response = await route.fetch(); expect(response.ok()).toBeTruthy(); await route.abort("failed"); }
      else await route.continue();
    });
    await dialog.getByRole("button", { name: "确认转发" }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(dialog.getByLabel("转发到聊天室")).toHaveValue(String(target.id));
    const forwardedResponse = page.waitForResponse((response) => response.url().endsWith(`/api/stories/${mixed.id}/forward-grace`) && response.ok());
    await dialog.getByRole("button", { name: "确认转发" }).click();
    const card = (await (await forwardedResponse).json()).message as MessageDTO;
    await expect(dialog.getByRole("status")).toContainText(target.name);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
    await page.unroute(forwardUrl);
    expect((await stories()).stories.map((story) => story.id)).toEqual(before.stories.map((story) => story.id));
    const targetMessages = (await (await request.get(`/api/messages?channelId=${target.id}`, { headers })).json()).messages as MessageDTO[];
    expect(targetMessages.filter((message) => message.type === "grace" && (message.payload as GracePayload).sourceStoryId === mixed.id)).toHaveLength(1);
    expect(targetMessages.filter((message) => message.type === "image" || message.type === "file")).toHaveLength(0);
    await dialog.getByRole("button", { name: "查看卡片" }).click();
    await expect(own).toBeHidden();
    await expect(page.getByTestId("active-channel-name")).toHaveText(target.name);
    const rendered = page.locator(`[data-message-id="${card.id}"] .grace-card`);
    await expect(rendered.locator(".grace-photo-grid img")).toHaveCount(9);
    await expect(rendered.locator(".grace-card-text").first()).toHaveText("转发回归 & <日常>恩典第二行");
    for (const width of [360, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await rendered.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBeTruthy();
      await expect(rendered.getByRole("button", { name: "播放恩典语音" })).toBeVisible();
    }
    await rendered.getByRole("button", { name: "播放恩典语音" }).click();
    await expect.poll(() => rendered.locator("audio").evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(0);
    await rendered.getByRole("button", { name: "暂停恩典语音" }).click();
    await rendered.getByRole("button", { name: "为此感恩" }).click();
    expect((await request.put(`/api/messages/${card.id}/favorite`, { headers, data: { favorited: true } })).ok()).toBeTruthy();
    const favorites = await (await request.get("/api/grace/favorites", { headers })).json();
    expect(JSON.stringify(favorites)).toContain(`"id":${card.id}`);
    const payload = card.payload as GracePayload;
    const imageUrl = `/api/grace/${card.id}/images/${payload.images![0].fileName}`;
    const voiceUrl = `/api/grace/${card.id}/voice`;
    expect((await request.get(voiceUrl)).status()).toBe(401);
    expect((await request.delete(`/api/stories/${mixed.id}`, { headers })).ok()).toBeTruthy();
    expect((await request.get(imageUrl, { headers })).status()).toBe(200);
    expect((await request.get(voiceUrl, { headers, maxRedirects: 0 })).status()).toBe(200);
    await page.reload();
    await expect(rendered.getByRole("button", { name: "播放恩典语音" })).toBeVisible();
    await rendered.getByRole("button", { name: "编辑卡片" }).click();
    const editor = page.getByRole("dialog", { name: "编辑恩典卡片", exact: true });
    await expect(editor.getByLabel("恩典内容")).toHaveValue("转发回归 & <日常>\n恩典第二行");
    await editor.getByLabel("恩典内容").fill("转发回归 & <日常>\n恩典第二行\n新恩典");
    const updateResponse = page.waitForResponse((response) => response.url().endsWith(`/api/messages/${card.id}/grace-update`) && response.ok());
    await editor.getByRole("button", { name: "保存并同步故事" }).click();
    const updated = (await (await updateResponse).json()).message as MessageDTO;
    expect((updated.payload as GracePayload).nativeVoice).toEqual(payload.nativeVoice);
    expect((await stories()).stories[0].text).toContain("新恩典");

    // The source snapshots are independent in both directions, including blank media-only stories.
    for (const source of [photoOnly, voiceOnly]) {
      const response = await request.post(`/api/stories/${source.id}/forward-grace`, { headers, data: { channelId: target.id, clientRequestId: crypto.randomUUID() } });
      expect(response.ok()).toBeTruthy();
      const forwarded = (await response.json()).message as MessageDTO;
      expect(forwarded.content).toBe("");
      const edit = await request.post(`/api/messages/${forwarded.id}/grace-update`, { headers, data: { content: "媒体见证" } });
      expect(edit.ok()).toBeTruthy();
      expect((await request.delete(`/api/messages/${forwarded.id}/grace`, { headers })).ok()).toBeTruthy();
      expect((await request.get(`/api/stories/media/${source.media[0].id}`, { headers })).status()).toBe(200);
    }
    await prisma.channel.update({ where: { id: target.id }, data: { isPrivate: true } });
    await prisma.channelMember.upsert({ where: { channelId_accountId: { channelId: target.id, accountId: me.id } }, create: { channelId: target.id, accountId: me.id }, update: {} });
    const username = `forward-reader-${Date.now()}`;
    expect((await request.post("/api/admin/accounts", { headers, data: { username, displayName: "转发读者", password: "StoryTest123!" } })).ok()).toBeTruthy();
    const reader = await (await request.post("/api/auth/login", { data: { username, password: "StoryTest123!" } })).json();
    const readerHeaders = { Authorization: `Bearer ${reader.token}` };
    expect((await request.get(voiceUrl, { headers: readerHeaders })).status()).toBe(403);
    expect((await request.get(imageUrl, { headers: readerHeaders })).status()).toBe(403);
    expect((await request.post(`/api/stories/${photoOnly.id}/forward-grace`, { headers: readerHeaders, data: { channelId: current.id, clientRequestId: crypto.randomUUID() } })).status()).toBe(404);
    await page.evaluate((readerToken: string) => localStorage.setItem("team-chat-token", readerToken), reader.token);
    await page.reload();
    await page.locator(".story-header-trigger").click();
    const feed = page.getByRole("dialog", { name: "我们的故事", exact: true });
    await expect(feed.locator(".story-moment").first()).toBeVisible();
    await expect(feed.getByRole("button", { name: "转发为恩典卡片", exact: true })).toHaveCount(0);
    await feed.locator(".story-caption").first().click();
    await expect(page.getByRole("dialog", { name: "故事详情", exact: true }).getByRole("button", { name: "转发为恩典卡片", exact: true })).toHaveCount(0);
    await prisma.channelMember.upsert({ where: { channelId_accountId: { channelId: target.id, accountId: me.id } }, create: { channelId: target.id, accountId: me.id, role: "viewer" }, update: { role: "viewer" } });
    expect((await request.post(`/api/stories/${photoOnly.id}/forward-grace`, { headers, data: { channelId: target.id, clientRequestId: crypto.randomUUID() } })).status()).toBe(403);
    await prisma.channelMember.update({ where: { channelId_accountId: { channelId: target.id, accountId: me.id } }, data: { role: "member" } });
    expect((await request.delete(`/api/messages/${card.id}/grace`, { headers })).ok()).toBeTruthy();
    expect((await request.get(imageUrl, { headers })).status()).toBe(404);
    expect((await request.get(voiceUrl, { headers })).status()).toBe(404);
    expect(errors).toEqual([]);
  } finally {
    await prisma.$disconnect();
    await fs.rm(scratch, { recursive: true, force: true });
  }
});
