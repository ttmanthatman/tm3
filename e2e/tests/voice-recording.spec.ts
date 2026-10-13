import { test, expect, chromium, webkit } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { E2E_ADMIN, E2E_CHANNELS } from "../seed-data.js";

for (const browserName of ["chromium", "webkit"] as const) {
  for (const width of [360, 390, 1280]) {
    test(`voice lifecycle and single retained draft ${browserName} ${width}`, async () => {
      const browser = await (browserName === "webkit" ? webkit : chromium).launch();
      const context = await browser.newContext({ viewport: { width, height: 900 }, baseURL: "http://127.0.0.1:4173" });
      const page = await context.newPage();
      const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "voice-recording-e2e-"));
      try {
        await context.addInitScript(() => {
          let requests = 0;
          let holdNext = false;
          let releaseHeld: (() => void) | null = null;
          Object.defineProperty(window, "holdVoiceTestSource", { value: () => { holdNext = true; } });
          Object.defineProperty(window, "releaseVoiceTestSource", { value: () => releaseHeld?.() });
          const streams: MediaStream[] = [];
          const clone = MediaStream.prototype.clone;
          MediaStream.prototype.clone = function () {
            const result = clone.call(this);
            streams.push(result);
            return result;
          };
          Object.defineProperty(window, "interruptVoiceTest", { value: () => streams.at(-1)!.getAudioTracks()[0]!.dispatchEvent(new Event("mute")) });
          Object.defineProperty(window, "voiceTestState", { value: () => ({ requests, sources: streams.length,
            activeTracks: streams.flatMap((stream) => stream.getTracks()).filter((track) => track.readyState === "live" && track.enabled).length,
            liveTracks: streams.flatMap((stream) => stream.getTracks()).filter((track) => track.readyState === "live").length
          }) });
          let audio: AudioContext;
          Object.defineProperty(window, "prepareVoiceTestSource", { value: async () => {
            audio = new AudioContext(); await audio.resume();
            // WebKit replaces the early MediaDevices wrapper as the document loads.
            Object.defineProperty(MediaDevices.prototype, "getUserMedia", { configurable: true, value: getTestStream });
          } });
          // Real MediaRecorder and IndexedDB; only the microphone source is synthetic.
          const getTestStream = async () => {
            requests++;
            if (holdNext) { holdNext = false; await new Promise<void>((resolve) => { releaseHeld = resolve; }); }
            const source = audio.createOscillator();
            const destination = audio.createMediaStreamDestination();
            source.connect(destination); source.start();
            streams.push(destination.stream);
            return destination.stream;
          };
        });
        await page.route("**/*", (route) => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
        await page.goto("/");
        await page.getByPlaceholder("用户名").fill(E2E_ADMIN.username);
        await page.getByPlaceholder("密码").fill(E2E_ADMIN.password);
        await page.getByRole("button", { name: "登录", exact: true }).click();
        const outside = page.getByTestId("active-channel-name");
        await expect(outside).toHaveText(E2E_CHANNELS.default);
        const mic = page.getByRole("button", { name: "语音消息", exact: true });
        const drawer = page.locator(".voice-drawer");
        const preview = page.locator(".voice-preview");
        const state = () => page.evaluate(() => (window as Window & { voiceTestState: () => { requests: number; sources: number; activeTracks: number; liveTracks: number } }).voiceTestState());
        const verifyAudio = async () => {
          // Playwright WebKit on macOS cannot decode its AAC via Web Audio.
          // Decode the actual captured bytes using the existing E2E ffmpeg tool.
          const bytes = await preview.locator("audio").evaluate(async (element) =>
            Array.from(new Uint8Array(await fetch((element as HTMLAudioElement).src).then((response) => response.arrayBuffer())))
          );
          const file = path.join(scratch, "recording.audio");
          await fs.writeFile(file, Buffer.from(bytes));
          const { stdout } = await promisify(execFile)("ffmpeg", ["-nostdin", "-v", "error", "-i", file, "-ac", "1", "-ar", "16000", "-f", "f32le", "pipe:1"], { encoding: "buffer", timeout: 10_000 });
          expect(stdout.length).toBeGreaterThan(16000);
          let peak = 0;
          for (let offset = 0; offset + 4 <= stdout.length; offset += 4) peak = Math.max(peak, Math.abs(stdout.readFloatLE(offset)));
          expect(peak).toBeGreaterThan(0.001);
        };
        const savedDrafts = () => page.evaluate(async () => {
          const database = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open("team-chat-voice-drafts", 1);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          const rows = await new Promise<Array<{ bytes: ArrayBuffer; durationMs: number }>>((resolve, reject) => {
            const request = database.transaction("draft").objectStore("draft").getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          database.close();
          return rows.map((row) => ({ size: row.bytes.byteLength, duration: row.durationMs }));
        });

        await page.evaluate(() => (window as Window & { prepareVoiceTestSource: () => Promise<void> }).prepareVoiceTestSource());
        await expect(mic).toBeEnabled();
        await page.evaluate(() => (window as Window & { holdVoiceTestSource: () => void }).holdVoiceTestSource());
        await mic.click();
        await expect(drawer).toContainText("正在申请麦克风");
        await expect(drawer.locator("small")).toHaveText("0:00");
        await expect(drawer.getByRole("button", { name: "停止录音" })).toHaveCount(0);
        await expect(drawer.getByRole("button", { name: "取消录音" })).toBeEnabled();
        await page.screenshot({ path: `output/e2e/voice-waiting-${browserName}-${width}.png` });
        await drawer.getByRole("button", { name: "取消录音" }).click();
        await page.evaluate(() => (window as Window & { releaseVoiceTestSource: () => void }).releaseVoiceTestSource());
        await expect.poll(async () => (await state()).sources).toBe(1);
        await expect.poll(async () => (await state()).liveTracks).toBe(0);
        await expect(mic).toBeEnabled();
        await drawer.getByRole("button", { name: "重新录音" }).click();
        await expect(drawer.getByRole("button", { name: "停止录音" })).toBeVisible();
        await outside.click();
        await expect(drawer).toBeVisible();
        await expect.poll(async () => (await state()).activeTracks).toBe(1);
        await expect.poll(() => drawer.locator("small").textContent()).not.toBe("0:00");
        await mic.click();
        await expect(preview).toBeVisible();
        await verifyAudio();
        await expect.poll(async () => (await state()).activeTracks).toBe(0);
        expect((await state()).liveTracks).toBe(0);
        expect((await state()).requests).toBe(2);
        await expect.poll(async () => (await savedDrafts()).length).toBe(1);
        await outside.click();
        await expect(preview).toBeVisible();
        await mic.click();
        expect((await state()).requests).toBe(2);
        await page.screenshot({ path: `output/e2e/voice-${browserName}-${width}.png` });
        const rect = await drawer.boundingBox();
        expect(rect!.x).toBeGreaterThanOrEqual(0);
        expect(rect!.x + rect!.width).toBeLessThanOrEqual(width);
        expect(rect!.y + rect!.height).toBeLessThanOrEqual(900);
        const saved = await savedDrafts();
        // Re-entry uses the original bytes and starts no microphone or timer.
        await page.reload();
        await expect(preview).toBeVisible();
        expect((await state()).requests).toBe(0);
        expect(await savedDrafts()).toEqual(saved);
        const duration = await preview.locator(".voice-preview-card > span").textContent();
        await page.waitForTimeout(1100);
        expect(await preview.locator(".voice-preview-card > span").textContent()).toBe(duration);
        await outside.click();
        await expect(preview).toBeVisible();

        await drawer.getByRole("button", { name: "删除录音" }).click();
        await expect.poll(async () => (await savedDrafts()).length).toBe(0);
        await mic.click();
        await expect(drawer).toBeHidden();
        expect((await state()).requests).toBe(0);
        await page.evaluate(() => (window as Window & { prepareVoiceTestSource: () => Promise<void> }).prepareVoiceTestSource());
        await mic.click();
        await expect(drawer.getByRole("button", { name: "停止录音" })).toBeVisible();
        await expect.poll(() => drawer.locator("small").textContent()).not.toBe("0:00");
        await drawer.getByRole("button", { name: "停止录音" }).click();
        await expect(preview).toBeVisible();
        // Match the report: send, then record again in the same foreground
        // session. Every recording must request a fresh microphone source.
        await Promise.all([
          page.waitForResponse((response) => response.url().endsWith("/api/files/upload") && response.ok()),
          drawer.getByRole("button", { name: "发送", exact: true }).click()
        ]);
        await expect(drawer).toBeHidden();
        await mic.click();
        await expect(drawer.getByRole("button", { name: "停止录音" })).toBeVisible();
        expect((await state()).requests).toBe(2);
        await expect.poll(async () => (await state()).activeTracks).toBe(1);
        await expect.poll(() => drawer.locator("small").textContent()).not.toBe("0:00");
        await page.evaluate(() => (window as Window & { interruptVoiceTest: () => void }).interruptVoiceTest());
        await expect(drawer.getByRole("button", { name: "停止录音" })).toHaveCount(0);
        await expect(preview).toBeVisible();
        await expect(drawer.locator(".voice-recording-notice")).toContainText("中断");
        await verifyAudio();
        await expect.poll(async () => (await state()).activeTracks).toBe(0);
        expect((await state()).liveTracks).toBe(0);
        await drawer.getByRole("button", { name: "删除录音" }).click();
        await page.locator(".composer textarea").click();
        await expect(drawer).toBeHidden();
        await expect.poll(async () => (await savedDrafts()).length).toBe(0);
        await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
        expect((await state()).liveTracks).toBe(0);
        await page.reload();
        await expect(outside).toBeVisible();
        await expect(drawer).toBeHidden();
      } finally { await context.close(); await browser.close(); await fs.rm(scratch, { recursive: true, force: true }); }
    });
  }
}
