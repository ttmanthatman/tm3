import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

function fetchHandler() {
  const handlers = new Map<string, (event: { request: Request; respondWith: () => void }) => void>();
  const source = fs.readFileSync(path.join(process.cwd(), "public/sw.js"), "utf8");
  vm.runInNewContext(source, {
    URL,
    fetch: () => Promise.resolve(),
    self: {
      location: { origin: "https://chat.example" },
      addEventListener(type: string, handler: (event: { request: Request; respondWith: () => void }) => void) {
        handlers.set(type, handler);
      }
    }
  });
  const handler = handlers.get("fetch");
  assert.ok(handler, "service worker registers a fetch handler");
  return handler;
}

function serviceWorkerSource() {
  return fs.readFileSync(path.join(process.cwd(), "public/sw.js"), "utf8");
}

test("service worker does not intercept external link preview images", () => {
  const handler = fetchHandler();
  let intercepted = false;
  handler({
    request: new Request("https://i0.wp.com/example.com/preview.png"),
    respondWith() {
      intercepted = true;
    }
  });
  assert.equal(intercepted, false);
});

test("service worker separates versioned app caches from persistent session content", () => {
  const source = serviceWorkerSource();
  assert.match(source, /APP_CACHE = `\$\{APP_CACHE_PREFIX\}\$\{APP_VERSION\}`/);
  assert.match(source, /CONTENT_CACHE_PREFIX = "team-chat-content-"/);
  assert.match(source, /key\.startsWith\(APP_CACHE_PREFIX\) && key !== APP_CACHE/);
  assert.doesNotMatch(source, /key\.startsWith\(CONTENT_CACHE_PREFIX\).*caches\.delete/);
});

test("service worker caches authenticated media and Bible reads but bypasses realtime APIs", () => {
  const source = serviceWorkerSource();
  assert.match(source, /api\\\/music\\\/tracks/);
  assert.match(source, /api\\\/parallax/);
  assert.match(source, /api\\\/files/);
  assert.match(source, /api\\\/bible/);
  assert.match(source, /url\.pathname === "\/api\/version"/);
  assert.match(source, /url\.pathname\.startsWith\("\/socket\.io\/"\)/);
  assert.match(source, /if \(url\.pathname\.startsWith\("\/api\/"\)\) return/);
});

test("service worker serves cached full songs as byte ranges and revalidates content", () => {
  const source = serviceWorkerSource();
  assert.match(source, /status: 206/);
  assert.match(source, /Content-Range/);
  assert.match(source, /blob\.slice\(start, end \+ 1/);
  assert.match(source, /If-None-Match/);
  assert.match(source, /response\.status === 304/);
});
