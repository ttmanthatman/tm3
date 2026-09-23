import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";

process.env.DEMO_MODE = "1";
const { registerSystemRoutes } = await import("./system.js");

test("demo handwriting path without a slash serves the static prototype", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "handwriting-route-"));
  const file = path.join(directory, "index.html");
  fs.writeFileSync(file, '<!doctype html><html><head><base href="/handwriting/"></head><body>handwriting prototype</body></html>');
  const app = Fastify();
  registerSystemRoutes(app, file);
  try {
    const response = await app.inject({ method: "GET", url: "/handwriting" });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.match(String(response.headers["content-type"]), /text\/html/);
    assert.match(response.body, /<base href="\/handwriting\/">/);
  } finally {
    await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
