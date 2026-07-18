import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

async function importAppModuleWithoutListening() {
  const originalListen = net.Server.prototype.listen;
  const originalSetInterval = globalThis.setInterval;
  const sigintListeners = process.listenerCount("SIGINT");
  const sigtermListeners = process.listenerCount("SIGTERM");
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tm3-fastify-app-"));
  const previousStorageRoot = process.env.STORAGE_ROOT;
  let listenCalls = 0;
  let intervalCalls = 0;

  net.Server.prototype.listen = function (this: net.Server) {
    listenCalls += 1;
    return this;
  } as typeof net.Server.prototype.listen;
  globalThis.setInterval = (() => {
    intervalCalls += 1;
    throw new Error("application imports must not start intervals");
  }) as typeof globalThis.setInterval;
  process.env.STORAGE_ROOT = storageRoot;

  try {
    const appModule = await import("./index.js");
    assert.equal(listenCalls, 0);
    assert.equal(intervalCalls, 0);
    assert.equal(process.listenerCount("SIGINT"), sigintListeners);
    assert.equal(process.listenerCount("SIGTERM"), sigtermListeners);
    return { appModule, storageRoot };
  } finally {
    net.Server.prototype.listen = originalListen;
    globalThis.setInterval = originalSetInterval;
    if (previousStorageRoot === undefined) delete process.env.STORAGE_ROOT;
    else process.env.STORAGE_ROOT = previousStorageRoot;
  }
}

const appModulePromise = importAppModuleWithoutListening();

test("importing the Fastify application module does not listen or register signal handlers", async () => {
  await appModulePromise;
});

test("Fastify application supports inject and closes all owned resources", async (context) => {
  const { appModule: { buildApp }, storageRoot } = await appModulePromise;
  context.after(() => fs.rmSync(storageRoot, { recursive: true, force: true }));
  const app = await buildApp({ runStartupTasks: false });
  let closed = false;
  context.after(async () => {
    if (!closed) await app.close();
  });

  const health = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().ok, true);
  assert.equal(health.json().name, "team-chat");

  const unauthorized = await app.inject({ method: "GET", url: "/api/auth/me" });
  assert.equal(unauthorized.statusCode, 401);
  assert.deepEqual(unauthorized.json(), { success: false, message: "认证失败" });

  await app.close();
  closed = true;
});
