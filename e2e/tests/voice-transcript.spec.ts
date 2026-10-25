import { expect, test, chromium, webkit, type Page, type APIRequestContext, type Locator } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { E2E_ADMIN, E2E_MEMBER, E2E_CHANNELS } from "../seed-data.js";
import type { ChannelDTO, MessageDTO } from "../../src/shared/types.js";

async function login(page: Page, account: { username: string; password: string } = E2E_ADMIN) {
  await page.route("**/*", (route) => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await page.goto("/");
  await page.getByPlaceholder("用户名").fill(account.username);
  await page.getByPlaceholder("密码").fill(account.password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByTestId("active-channel-name")).toHaveText(E2E_CHANNELS.default);
}

async function createReader(request: APIRequestContext, headers: Record<string, string>, suffix: string) {
  const account = { ...E2E_MEMBER, username: `asr-reader-${suffix}` };
  expect((await request.post("/api/admin/accounts", { headers, data: account })).ok()).toBe(true);
  const response = await request.post("/api/auth/login", { data: { username: account.username, password: account.password } });
  expect(response.ok()).toBe(true);
  return { account, token: (await response.json()).token as string };
}

async function observeAudio(page: Page) {
  await page.addInitScript(() => {
    const NativeAudio = window.Audio;
    window.Audio = class extends NativeAudio {
      constructor(src?: string) {
        super(src);
        (window as Window & { subtitleAudio?: HTMLAudioElement }).subtitleAudio = this;
      }
    };
  });
}

async function expectSubtitleSeek(page: Page, bubble: Locator, text: string, seconds: number, keyboard = false) {
  const word = bubble.getByRole("button", { name: `从“${text}”开始播放`, exact: true });
  if (keyboard) {
    await word.focus();
    await word.press("Enter");
  } else await word.click();
  await expect(word).toHaveClass(/voice-transcript-current/);
  await expect(word).toHaveCSS("color", "rgb(255, 106, 0)");
  await expect(word).toHaveCSS("font-weight", "700");
  await expect.poll(() => page.evaluate((seconds) => {
    const audio = (window as Window & { subtitleAudio?: HTMLAudioElement }).subtitleAudio;
    return !!audio && !audio.paused && audio.currentTime >= seconds && audio.currentTime < seconds + 1;
  }, seconds)).toBe(true);
}

test("管理员切换识别服务并保留独立密钥，普通用户无权修改", async ({ page, request }) => {
  await login(page);
  const headers = { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem("team-chat-token"))}` };
  await page.goto("/ai-settings");
  await page.getByRole("button", { name: /语音识别.*语音消息转文字/ }).click();
  const panel = page.locator(".ai-settings-subsection").filter({ hasText: "启用语音转文字" });
  await panel.getByRole("checkbox", { name: "启用语音转文字" }).check();
  await panel.locator("select").first().selectOption("mimo");
  await panel.locator('input[type="password"]').fill("fake-e2e-mimo-key");
  async function save() {
    const response = page.waitForResponse((response) => response.url().endsWith("/api/admin/ai-settings") && response.request().method() === "POST");
    await page.getByRole("button", { name: "保存 AI 设置", exact: true }).click();
    expect((await response).ok()).toBe(true);
    await expect(page.getByText("AI 设置已保存", { exact: true })).toBeVisible();
  }
  await save();
  await panel.locator("select").first().selectOption("paraformer");
  await panel.locator('input[type="password"]').fill("fake-e2e-paraformer-key");
  await save();
  await expect(panel.locator('input[type="password"]')).toHaveValue("");
  await expect(panel.locator('input[type="password"]')).toHaveAttribute("placeholder", "已设置，留空不改");
  const settings = await (await request.get("/api/admin/ai-settings", { headers })).json();
  expect(settings.asr.provider).toBe("paraformer");
  expect(settings.asr.apiKeyConfigured).toBe(true);
  expect(settings.asr.paraformer.apiKeyConfigured).toBe(true);
  expect(JSON.stringify(settings)).not.toContain("fake-e2e-");
  await panel.locator("select").first().selectOption("mimo");
  await save();
  await page.reload();
  await page.getByRole("button", { name: /语音识别.*语音消息转文字/ }).click();
  await expect(panel.locator("select").first()).toHaveValue("mimo");
  await expect(panel.locator('input[type="password"]')).toHaveAttribute("placeholder", "已设置，留空不改");
  await panel.locator("select").first().selectOption("paraformer");
  await expect(panel.locator('input[type="password"]')).toHaveAttribute("placeholder", "已设置，留空不改");
  const member = await createReader(request, headers, "settings");
  const denied = await request.post("/api/admin/ai-settings", { headers: { Authorization: `Bearer ${member.token}` }, data: { asr: { provider: "paraformer" } } });
  expect(denied.status()).toBe(403);
});

for (const browserName of ["chromium", "webkit"] as const) {
  test(`${browserName}：共享字幕随播放、暂停、跳转和重播显示，全文可折叠`, async ({ request }) => {
    test.setTimeout(90_000);
    const browser = await (browserName === "webkit" ? webkit : chromium).launch();
    const context = await browser.newContext({ baseURL: "http://127.0.0.1:4173", viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await observeAudio(page);
    const prisma = new PrismaClient();
    const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "voice-transcript-e2e-"));
    try {
      await login(page);
      const headers = { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem("team-chat-token"))}` };
      const channels = (await (await request.get("/api/channels", { headers })).json()).channels as ChannelDTO[];
      const channel = channels.find((row) => row.name === E2E_CHANNELS.default)!;
      const audioPath = path.join(scratch, "subtitle.wav");
      await promisify(execFile)("ffmpeg", ["-nostdin", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-ac", "1", "-ar", "16000", audioPath], { timeout: 30_000 });
      const uploaded = await request.post("/api/files/upload", { headers, multipart: {
        channelId: String(channel.id), voice: "1", durationMs: "6000",
        file: { name: `字幕验收-${browserName}.wav`, mimeType: "audio/wav", buffer: await fs.readFile(audioPath) }
      } });
      expect(uploaded.ok()).toBe(true);
      const message = (await uploaded.json()).message as MessageDTO;
      const words = [
        { text: "第一句，", beginMs: 500, endMs: 1600 },
        { text: "第二句，", beginMs: 2500, endMs: 3400 },
        { text: "最后一句。", beginMs: 4500, endMs: 5400 }
      ];
      // Synthetic ASR output at the external-service boundary; no cloud keys/calls.
      await prisma.message.update({ where: { id: message.id }, data: { payload: {
        ...(message.payload as object), kind: "voice", transcript: "第一句，第二句，最后一句。",
        transcriptWords: words, transcriptProvider: "paraformer", transcriptAt: new Date().toISOString()
      } } });
      await page.reload();
      const row = page.locator(`.message-row[data-message-id="${message.id}"]`);
      const bubble = row.locator(".voice-transcript-bubble");
      await expect(bubble).toHaveText("播放语音，文字会随进度显示");
      await row.getByRole("button", { name: "播放语音", exact: true }).click();
      await expect(bubble).toHaveText("第一句，");
      await row.getByRole("button", { name: "暂停语音", exact: true }).click();
      const paused = await bubble.textContent();
      await page.waitForTimeout(600);
      expect(await bubble.textContent()).toBe(paused);
      const waveform = row.getByRole("button", { name: "音频进度，点击跳转" });
      const box = (await waveform.boundingBox())!;
      await waveform.click({ position: { x: box.width * 0.6, y: box.height / 2 } });
      await expect(bubble).toHaveText("第一句，第二句，");
      await row.getByRole("button", { name: "暂停语音", exact: true }).click();
      await waveform.click({ position: { x: box.width * 0.01, y: box.height / 2 } });
      await expect(bubble).toHaveText("播放语音，文字会随进度显示");
      await expect(bubble).toHaveText("第一句，");
      await expect(row.getByRole("button", { name: "播放语音", exact: true })).toBeVisible();
      await expect(bubble).toHaveText("第一句，第二句，最后一句。");
      await row.getByRole("button", { name: "播放语音", exact: true }).click();
      await expect(bubble).toHaveText("播放语音，文字会随进度显示");
      await row.getByRole("button", { name: "暂停语音", exact: true }).click();
      await row.getByRole("button", { name: "查看全文", exact: true }).click();
      await expect(bubble).toHaveText("第一句，第二句，最后一句。");
      for (const width of [390, 360, 1280]) {
        await page.setViewportSize({ width, height: 844 });
        await expectSubtitleSeek(page, bubble, "第二句，", 2.5, width === 1280);
        await row.getByRole("button", { name: "暂停语音", exact: true }).click();
        await expect(bubble.locator(".voice-transcript-current")).toHaveCount(0);
        await expect(bubble).toHaveText("第一句，第二句，最后一句。");
        await expectSubtitleSeek(page, bubble, "第一句，", 0.5);
        await row.getByRole("button", { name: "暂停语音", exact: true }).click();
        await row.getByRole("button", { name: "收起文字", exact: true }).click();
        await expect(bubble).toBeHidden();
        await row.getByRole("button", { name: "展开文字", exact: true }).click();
        await expect(bubble).toBeVisible();
        expect(await row.locator(".voice-transcript-row").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
        expect(await bubble.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      }
      // Clicking a word after natural completion must seek rather than restart at zero.
      await expectSubtitleSeek(page, bubble, "最后一句。", 4.5);
      await expect(row.getByRole("button", { name: "播放语音", exact: true })).toBeVisible();
      await expect(bubble.locator(".voice-transcript-current")).toHaveCount(0);
      await expectSubtitleSeek(page, bubble, "第二句，", 2.5);
      await row.getByRole("button", { name: "暂停语音", exact: true }).click();
      const member = await createReader(request, headers, browserName);
      const reused = await request.post(`/api/messages/${message.id}/transcribe`, { headers: { Authorization: `Bearer ${member.token}` }, data: { timestamps: true } });
      expect(reused.ok()).toBe(true);
      expect(await reused.json()).toMatchObject({ cached: true, transcriptWords: words });
      // A separate browser context verifies another user's persisted message view.
      const memberContext = await browser.newContext({ baseURL: "http://127.0.0.1:4173", viewport: { width: 390, height: 844 } });
      try {
        const memberPage = await memberContext.newPage();
        await observeAudio(memberPage);
        await login(memberPage, member.account);
        const memberRow = memberPage.locator(`.message-row[data-message-id="${message.id}"]`);
        await memberRow.getByRole("button", { name: "查看全文", exact: true }).click();
        await expect(memberRow.locator(".voice-transcript-bubble")).toHaveText("第一句，第二句，最后一句。");
        await expectSubtitleSeek(memberPage, memberRow.locator(".voice-transcript-bubble"), "最后一句。", 4.5);
        // Seeking updates the UI before audio.play() resolves. Let real playback
        // acknowledge listening before pausing, especially on Linux WebKit.
        await expect(memberRow.locator(".voice-unread-dot")).toHaveCount(0);
        await memberRow.getByRole("button", { name: "暂停语音", exact: true }).click();
        await memberPage.reload();
        await memberRow.getByRole("button", { name: "查看全文", exact: true }).click();
        await expect(memberRow.locator(".voice-transcript-word")).toHaveCount(3);
      } finally { await memberContext.close(); }
    } finally {
      await prisma.$disconnect();
      await browser.close();
      await fs.rm(scratch, { recursive: true, force: true });
    }
  });
}
