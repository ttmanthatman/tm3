import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// The static plugin globs dist/client and registers one route per file at
// import time, so the probe fixtures must exist before the app module loads.
const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tm3-compress-"));
process.env.STORAGE_ROOT = storageRoot;

const distClient = path.join(process.cwd(), "dist/client");
const distExisted = fs.existsSync(distClient);
const assetsDir = path.join(distClient, "assets");
const probeName = "compress-probe.js";
const probePath = path.join(assetsDir, probeName);
const indexPath = path.join(distClient, "index.html");
const createdIndex = !fs.existsSync(indexPath);

fs.mkdirSync(assetsDir, { recursive: true });
if (createdIndex) fs.writeFileSync(indexPath, "<!doctype html><html><body>probe</body></html>\n");
fs.writeFileSync(probePath, `// compression probe\nconst padding = "${"x".repeat(4096)}";\n`);

const originalListen = net.Server.prototype.listen;
net.Server.prototype.listen = function (this: net.Server) {
  return this;
} as typeof net.Server.prototype.listen;
const { buildApp } = await import("./index.js");
net.Server.prototype.listen = originalListen;

function cleanup() {
  fs.rmSync(probePath, { force: true });
  if (createdIndex) fs.rmSync(indexPath, { force: true });
  if (!distExisted) fs.rmSync(distClient, { recursive: true, force: true });
  fs.rmSync(storageRoot, { recursive: true, force: true });
}

test("static assets are compressed on demand and hashed assets are immutable", async (context) => {
  const app = await buildApp({ runStartupTasks: false });
  context.after(async () => {
    await app.close();
    cleanup();
  });

  const plain = await app.inject({ method: "GET", url: `/assets/${probeName}` });
  assert.equal(plain.statusCode, 200);
  assert.equal(plain.headers["cache-control"], "public, max-age=31536000, immutable");
  assert.equal(plain.headers["content-encoding"], undefined);

  const gzipped = await app.inject({ method: "GET", url: `/assets/${probeName}`, headers: { "accept-encoding": "gzip" } });
  assert.equal(gzipped.statusCode, 200);
  assert.equal(gzipped.headers["content-encoding"], "gzip");
  assert.equal(gzipped.rawPayload.length < plain.rawPayload.length, true);

  const home = await app.inject({ method: "GET", url: "/" });
  assert.equal(home.statusCode, 200);
  assert.equal(home.headers["cache-control"], "public, max-age=0");

  const api = await app.inject({ method: "GET", url: "/api/health", headers: { "accept-encoding": "gzip" } });
  assert.equal(api.statusCode, 200);
  assert.equal(api.json().ok, true);
});
