import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import type { DemoSnapshot } from "../../shared/demoMode.js";
import { createDemoModeService } from "./service.js";

const databaseUrl = process.env.DEMO_RESET_TEST_DATABASE_URL;

test("rebuilds the same demo state repeatedly while preserving operator and secrets", { skip: !databaseUrl }, async () => {
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "tm3-demo-reset-"));
  const sourceDir = path.join(temporaryDir, "source");
  const bundlePath = path.join(temporaryDir, "demo-bundle.tar.gz");
  const storageDirs = {
    upload: path.join(temporaryDir, "storage", "uploads"),
    avatar: path.join(temporaryDir, "storage", "avatars"),
    background: path.join(temporaryDir, "storage", "backgrounds"),
    parallax: path.join(temporaryDir, "storage", "parallax"),
    "music-score": path.join(temporaryDir, "storage", "music-scores")
  } as const;
  fs.mkdirSync(path.join(sourceDir, "assets", "background"), { recursive: true });
  const wallpaper = Buffer.from("demo-wallpaper");
  const wallpaperPath = path.join(sourceDir, "assets", "background", "wallpaper.webp");
  fs.writeFileSync(wallpaperPath, wallpaper);
  const wallpaperHash = createHash("sha256").update(wallpaper).digest("hex");
  const passwordHash = await bcrypt.hash("demo-password", 4);
  const snapshot: DemoSnapshot = {
    formatVersion: 1,
    datasetVersion: "integration.1",
    generatedAt: "2026-08-17T00:00:00.000Z",
    assets: [{ key: "wallpaper", kind: "background", fileName: "wallpaper.webp", archivePath: "assets/background/wallpaper.webp", sha256: wallpaperHash, size: wallpaper.length }],
    accounts: [{ key: "account-demo", username: "demo_user", passwordHash, displayName: "演示用户" }],
    channels: [{ key: "channel-general", name: "演示大厅", isDefault: true }],
    memberships: [{ accountKey: "account-demo", channelKey: "channel-general", role: "member" }],
    messages: [{ key: "message-welcome", channelKey: "channel-general", senderKey: "account-demo", content: "欢迎体验", type: "text" }],
    settings: { wallpaperPath: "wallpaper.webp", loginBackgroundPath: "wallpaper.webp" }
  };
  fs.writeFileSync(path.join(sourceDir, "snapshot.json"), JSON.stringify(snapshot));
  execFileSync("tar", ["-czf", bundlePath, "--directory", sourceDir, "snapshot.json", "assets"]);
  const bundle = fs.readFileSync(bundlePath);
  const bundleHash = createHash("sha256").update(bundle).digest("hex");
  const manifest = {
    formatVersion: 1,
    datasetVersion: "integration.1",
    compatibleApp: { min: "1.9.4", maxExclusive: "2.0.0" },
    bundleUrl: "https://github.com/example/team-chat/releases/download/demo-data/demo-bundle.tar.gz",
    bundleSha256: bundleHash,
    bundleSize: bundle.length,
    summary: { accounts: 1, channels: 1, messages: 1, assets: 1 }
  };
  let backups = 0;
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    return url.endsWith("demo-manifest.json")
      ? new Response(JSON.stringify(manifest), { status: 200, headers: { "content-type": "application/json" } })
      : new Response(bundle, { status: 200, headers: { "content-length": String(bundle.length) } });
  };

  try {
    await prisma.$transaction([
      prisma.setting.deleteMany(),
      prisma.account.deleteMany(),
      prisma.actor.deleteMany(),
      prisma.channel.deleteMany()
    ]);
    const operator = await prisma.account.create({
      data: {
        username: "demo_operator",
        displayName: "演示运维",
        passwordHash,
        role: "admin",
        actor: { create: { kind: "human", username: "demo_operator", displayName: "演示运维" } }
      }
    });
    await prisma.setting.create({ data: { key: "aiDeepSeekApiKeyEncrypted", value: "keep-local-secret" } });
    const service = createDemoModeService({
      prisma,
      manifestUrl: "https://github.com/example/team-chat/releases/download/demo-data/demo-manifest.json",
      statePath: path.join(temporaryDir, "state.json"),
      cacheDir: path.join(temporaryDir, "cache"),
      storageDirs,
      gate: { busy: false },
      createBackup: async () => { backups += 1; },
      afterReset: async () => undefined,
      fetchImpl
    });

    await service.reset({ accountId: operator.id, username: operator.username });
    await prisma.message.create({
      data: {
        channelId: (await prisma.channel.findFirstOrThrow()).id,
        senderActorId: (await prisma.account.findUniqueOrThrow({ where: { username: "demo_user" }, include: { actor: true } })).actor!.id,
        content: "演示期间产生的数据"
      }
    });
    await service.reset({ accountId: operator.id, username: operator.username });

    assert.equal(await prisma.account.count(), 2);
    assert.equal(await prisma.channel.count(), 1);
    assert.equal(await prisma.message.count(), 1);
    assert.equal((await prisma.setting.findUniqueOrThrow({ where: { key: "wallpaperPath" } })).value, "wallpaper.webp");
    assert.equal((await prisma.setting.findUniqueOrThrow({ where: { key: "aiDeepSeekApiKeyEncrypted" } })).value, "keep-local-secret");
    assert.equal(backups, 1);
    assert.equal(fs.readFileSync(path.join(storageDirs.background, "wallpaper.webp"), "utf8"), "demo-wallpaper");
  } finally {
    await prisma.$disconnect();
    fs.rmSync(temporaryDir, { recursive: true, force: true });
  }
});
