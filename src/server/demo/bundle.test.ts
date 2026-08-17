import assert from "node:assert/strict";
import test from "node:test";
import { assertDemoManifest, assertDemoSnapshot, assertGithubDownloadUrl, safeArchiveEntry } from "./bundle.js";

const hash = "a".repeat(64);

test("accepts a compatible GitHub-hosted manifest", () => {
  const manifest = assertDemoManifest(
    {
      formatVersion: 1,
      datasetVersion: "2026.08.1",
      compatibleApp: { min: "1.9.4", maxExclusive: "2.0.0" },
      bundleUrl: "https://github.com/example/team-chat/releases/download/demo-data/demo-bundle.tar.gz",
      bundleSha256: hash,
      bundleSize: 1024,
      summary: { accounts: 20, channels: 8, messages: 160, assets: 30 }
    },
    "1.9.4"
  );
  assert.equal(manifest.datasetVersion, "2026.08.1");
});

test("rejects manifests outside the application version range", () => {
  assert.throws(
    () =>
      assertDemoManifest(
        {
          formatVersion: 1,
          datasetVersion: "2026.08.1",
          compatibleApp: { min: "2.0.0" },
          bundleUrl: "https://github.com/example/team-chat/releases/download/demo-data/demo-bundle.tar.gz",
          bundleSha256: hash,
          bundleSize: 1024,
          summary: { accounts: 20, channels: 8, messages: 160, assets: 30 }
        },
        "1.9.4"
      ),
    /至少为 2\.0\.0/
  );
});

test("restricts manifest and bundle downloads to approved GitHub hosts", () => {
  assert.throws(() => assertGithubDownloadUrl("https://example.com/demo.tar.gz"), /GitHub HTTPS/);
  assert.equal(assertGithubDownloadUrl("https://release-assets.githubusercontent.com/demo.tar.gz").hostname, "release-assets.githubusercontent.com");
});

test("rejects traversal paths in archives", () => {
  assert.equal(safeArchiveEntry("assets/backgrounds/login.webp"), true);
  assert.equal(safeArchiveEntry("../outside"), false);
  assert.equal(safeArchiveEntry("/etc/passwd"), false);
  assert.equal(safeArchiveEntry("assets\\..\\outside"), false);
});

test("accepts only whitelisted public settings in snapshots", () => {
  const base = {
    formatVersion: 1,
    datasetVersion: "2026.08.1",
    generatedAt: "2026-08-17T00:00:00.000Z",
    assets: [],
    accounts: [{ key: "user-a", username: "demo_a", passwordHash: "x".repeat(60), displayName: "演示用户" }],
    channels: [{ key: "general", name: "大厅" }],
    memberships: [],
    messages: [],
    settings: { wallpaperPath: "demo-wallpaper.webp", loginBackgroundPath: "demo-login.webp" }
  };
  assert.equal(assertDemoSnapshot(base, "2026.08.1").settings.wallpaperPath, "demo-wallpaper.webp");
  assert.throws(
    () => assertDemoSnapshot({ ...base, settings: { aiDeepSeekApiKeyEncrypted: "secret" } }, "2026.08.1"),
    /不允许覆盖/
  );
});
