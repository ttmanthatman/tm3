import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { createDemoModeService } from "./service.js";

test("local status performs no GitHub request and no database query", async () => {
  const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "tm3-demo-status-"));
  let fetchCalls = 0;
  const service = createDemoModeService({
    prisma: {} as PrismaClient,
    manifestUrl: "https://github.com/example/team-chat/releases/download/demo-data/demo-manifest.json",
    statePath: path.join(temporaryDir, "state.json"),
    cacheDir: path.join(temporaryDir, "cache"),
    storageDirs: {
      upload: path.join(temporaryDir, "uploads"),
      avatar: path.join(temporaryDir, "avatars"),
      background: path.join(temporaryDir, "backgrounds"),
      parallax: path.join(temporaryDir, "parallax"),
      "music-score": path.join(temporaryDir, "music-scores")
    },
    gate: { busy: false },
    createBackup: async () => undefined,
    afterReset: async () => undefined,
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("fetch should not run");
    }
  });
  try {
    const status = await service.status(false);
    assert.equal(status.active, false);
    assert.equal(fetchCalls, 0);
  } finally {
    fs.rmSync(temporaryDir, { recursive: true, force: true });
  }
});
