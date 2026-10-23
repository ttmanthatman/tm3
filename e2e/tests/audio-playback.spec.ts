import { expect, test, chromium, webkit } from "@playwright/test";

// A real two-channel source: distinct tones on the left and right.
function stereoWave(seconds: number) {
  const sampleRate = 8000;
  const frames = sampleRate * seconds;
  const wav = Buffer.alloc(44 + frames * 4);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 4, 28);
  wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36);
  wav.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) {
    wav.writeInt16LE(Math.round(1200 * Math.sin(i * 2 * Math.PI * 440 / sampleRate)), 44 + i * 4);
    wav.writeInt16LE(Math.round(1200 * Math.sin(i * 2 * Math.PI * 660 / sampleRate)), 46 + i * 4);
  }
  return wav;
}

for (const [name, engine] of [["chromium", chromium], ["webkit", webkit]] as const) {
  test(`${name}: native audio is exclusive, preserves stereo, and advances without a paused Media Session`, async () => {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage({ baseURL: "http://127.0.0.1:4173", serviceWorkers: "block" });
      await page.route("**/audio-playback-harness", route => route.fulfill({
        contentType: "text/html", body: '<!doctype html><meta charset="utf-8"><button id="music">Music</button><button id="bible">Bible</button><button id="next">Near end</button><output></output>'
      }));
      await page.route("**/audio-playback-source-*.wav", route => route.fulfill({ contentType: "audio/wav", body: stereoWave(2) }));
      await page.route("**/api/bible-audio/test/**", route => route.fulfill({ contentType: "audio/wav", body: stereoWave(20) }));
      await page.goto("/audio-playback-harness");
      await page.evaluate(async () => {
        const musicPath = "/src/client/features/music/useMusicPlayer.ts";
        const biblePath = "/src/client/features/bible/useBibleAudioPlayer.ts";
        const source = await (await fetch(musicPath)).text();
        const vuePath = /from ["']([^"']*\/vue\.js[^"']*)["']/.exec(source)?.[1];
        if (!vuePath) throw new Error("missing Vue runtime");
        const { computed, ref } = await import(vuePath) as typeof import("vue");
        const { useMusicPlayer } = await import(musicPath) as typeof import("../../src/client/features/music/useMusicPlayer");
        const { useBibleAudioPlayer } = await import(biblePath) as typeof import("../../src/client/features/bible/useBibleAudioPlayer");
        // Both players use their production browser runtime and shared coordinator.
        const tracks = ref([1, 2].map(id => ({ id, title: `Stereo ${id}`, favorited: false, scores: [] }))) as unknown as Parameters<typeof useMusicPlayer>[0]["tracks"];
        const music = useMusicPlayer({
          tracks, libraryTracks: computed(() => tracks.value), favoriteTracks: computed(() => []),
          playlists: ref([]), selectedSourceKind: ref("library"), selectedPlaylistId: ref(null), scoreOpen: ref(false),
          streamUrl: track => `/audio-playback-source-${track.id}.wav`,
          request: async <T>() => ({} as T)
        });
        const bible = useBibleAudioPlayer({
          accountId: () => 1, books: () => [{ code: "JUD", name: "犹大书", chapterCount: 1 }],
          version: () => ({ versionId: "test", name: "Test", language: "zh", dialect: "zh", style: "drama", translation: "cmn-cu89s", copyright: "", bookCount: 1, chapterCount: 1, totalBytes: 0, completed: false, chapters: [{ book: "JUD", chapter: 1, durationMs: 20000, verses: [{ verse: 1, startMs: 0, endMs: 20000 }] }] })
        });
        music.controls.mount();
        music.controls.setPlaybackMode("playlist");
        const output = document.querySelector("output")!;
        const update = () => { output.textContent = JSON.stringify({ music: music.state.playing.value, bible: bible.playing.value, track: music.state.currentTrackId.value, session: navigator.mediaSession?.playbackState }); };
        const nativePlay = HTMLMediaElement.prototype.play;
        const elements = new Set<HTMLMediaElement>();
        const observations: Array<{ overlap: boolean; pausedSession: boolean }> = [];
        HTMLMediaElement.prototype.play = function () {
          elements.add(this);
          observations.push({ overlap: [...elements].some(element => element !== this && !element.paused && !element.ended), pausedSession: navigator.mediaSession?.playbackState === "paused" });
          return nativePlay.call(this);
        };
        document.querySelector("#music")!.addEventListener("click", () => music.controls.selectTrack(tracks.value[0]));
        document.querySelector("#bible")!.addEventListener("click", () => bible.startFromChapter("JUD", 1));
        document.querySelector("#next")!.addEventListener("click", () => {
          observations.length = 0;
          const audio = [...elements].find(element => element.src.includes("audio-playback-source"))!;
          audio.currentTime = audio.duration - 0.15;
        });
        setInterval(update, 50);
        Object.assign(window, { audioObservations: observations });
      });
      const output = page.locator("output");
      await page.locator("#music").click();
      await expect(output).toContainText('"music":true');
      await page.locator("#bible").click();
      await expect(output).toContainText('"bible":true');
      await expect(output).toContainText('"music":false');
      await page.locator("#music").click();
      await expect(output).toContainText('"music":true');
      await expect(output).toContainText('"bible":false');
      const overlap = await page.evaluate(() => (window as unknown as { audioObservations: Array<{ overlap: boolean }> }).audioObservations.some(item => item.overlap));
      expect(overlap).toBe(false);
      await page.locator("#next").click();
      await expect(output).toContainText('"track":2');
      await expect(output).toContainText('"music":true');
      const transitions = await page.evaluate(() => (window as unknown as { audioObservations: Array<{ pausedSession: boolean }> }).audioObservations);
      expect(transitions.length).toBeGreaterThan(0);
      expect(transitions.some(item => item.pausedSession)).toBe(false);
      const channels = await page.evaluate(async () => {
        const context = new OfflineAudioContext(2, 16000, 8000);
        const buffer = await context.decodeAudioData(await (await fetch("/audio-playback-source-1.wav")).arrayBuffer());
        return { count: buffer.numberOfChannels, different: buffer.getChannelData(0).some((sample, index) => Math.abs(sample - buffer.getChannelData(1)[index]) > 0.01) };
      });
      expect(channels).toEqual({ count: 2, different: true });
    } finally { await browser.close(); }
  });
}
