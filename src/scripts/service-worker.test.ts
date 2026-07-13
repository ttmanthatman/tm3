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
