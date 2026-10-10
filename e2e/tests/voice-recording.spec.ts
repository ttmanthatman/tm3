import { test, expect, chromium, webkit } from "@playwright/test";
import { E2E_ADMIN, E2E_CHANNELS } from "../seed-data.js";

for (const browserName of ["chromium", "webkit"] as const) {
  for (const width of [360, 390, 1280]) {
    test(`voice lifecycle and single retained draft ${browserName} ${width}`, async () => {
      const browser = await (browserName === "webkit" ? webkit : chromium).launch();
      const context = await browser.newContext({ viewport: { width, height: 900 }, baseURL: "http://127.0.0.1:4173" });
      const page = await context.newPage();
      try {
        await context.addInitScript(() => {
          let requests = 0;
          const streams: MediaStream[] = [];
          Object.defineProperty(window, "voiceTestState", { value: () => ({ requests, activeTracks: streams.flatMap((stream) => stream.getTracks()).filter((track) => track.readyState === "live").length }) });
          let audio: AudioContext;
          Object.defineProperty(window, "prepareVoiceTestSource", { value: async () => {
            audio = new AudioContext(); await audio.resume();
            // WebKit replaces the early MediaDevices wrapper as the document loads.
            Object.defineProperty(MediaDevices.prototype, "getUserMedia", { configurable: true, value: getTestStream });
          } });
          // Real MediaRecorder and IndexedDB; only the microphone source is synthetic.
          const getTestStream = async () => {
            requests++;
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
        const state = () => page.evaluate(() => (window as Window & { voiceTestState: () => { requests: number; activeTracks: number } }).voiceTestState());
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
        await mic.click();
        await expect(drawer.getByRole("button", { name: "停止录音" })).toBeVisible();
        await outside.click();
        await expect(drawer).toBeVisible();
        await expect.poll(async () => (await state()).activeTracks).toBe(1);
        await expect.poll(() => drawer.locator("small").textContent()).not.toBe("0:00");
        await mic.click();
        await expect(preview).toBeVisible();
        await expect.poll(async () => (await state()).activeTracks).toBe(0);
        expect((await state()).requests).toBe(1);
        await expect.poll(async () => (await savedDrafts()).length).toBe(1);
        await outside.click();
        await expect(preview).toBeVisible();
        await mic.click();
        expect((await state()).requests).toBe(1);
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
        await drawer.getByRole("button", { name: "删除录音" }).click();
        await page.locator(".composer textarea").click();
        await expect(drawer).toBeHidden();
        await expect.poll(async () => (await savedDrafts()).length).toBe(0);
        await page.reload();
        await expect(outside).toBeVisible();
        await expect(drawer).toBeHidden();
      } finally { await context.close(); await browser.close(); }
    });
  }
}
