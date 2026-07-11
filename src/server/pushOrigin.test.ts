import assert from "node:assert/strict";
import test from "node:test";
import { normalizePushOrigin, pushOriginFromHeaders } from "./pushOrigin.js";

test("normalizes push origins to scheme and host only", () => {
  assert.equal(normalizePushOrigin("https://demo.xiaogushi.us/chat?x=1"), "https://demo.xiaogushi.us");
  assert.equal(normalizePushOrigin("ftp://demo.xiaogushi.us"), "");
  assert.equal(normalizePushOrigin("not a url"), "");
});

test("reads origin header before proxy host headers", () => {
  assert.equal(
    pushOriginFromHeaders({
      origin: "https://liao.xiaogushi.us",
      host: "internal:3000",
      "x-forwarded-host": "demo.xiaogushi.us",
      "x-forwarded-proto": "https"
    }),
    "https://liao.xiaogushi.us"
  );
});

test("derives an origin from forwarded host headers", () => {
  assert.equal(
    pushOriginFromHeaders({
      host: "internal:3000",
      "x-forwarded-host": "demo.xiaogushi.us",
      "x-forwarded-proto": "https"
    }),
    "https://demo.xiaogushi.us"
  );
});

test("uses http for localhost fallback origins", () => {
  assert.equal(pushOriginFromHeaders({ host: "localhost:3003" }), "http://localhost:3003");
});
