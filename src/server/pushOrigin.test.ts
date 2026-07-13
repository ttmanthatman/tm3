import assert from "node:assert/strict";
import test from "node:test";
import { normalizePushOrigin, pushOriginFromHeaders } from "./pushOrigin.js";

test("normalizes push origins to scheme and host only", () => {
  assert.equal(normalizePushOrigin("https://demo.example.com/chat?x=1"), "https://demo.example.com");
  assert.equal(normalizePushOrigin("ftp://demo.example.com"), "");
  assert.equal(normalizePushOrigin("not a url"), "");
});

test("reads origin header before proxy host headers", () => {
  assert.equal(
    pushOriginFromHeaders({
      origin: "https://chat.example.com",
      host: "internal:3000",
      "x-forwarded-host": "demo.example.com",
      "x-forwarded-proto": "https"
    }),
    "https://chat.example.com"
  );
});

test("derives an origin from forwarded host headers", () => {
  assert.equal(
    pushOriginFromHeaders({
      host: "internal:3000",
      "x-forwarded-host": "demo.example.com",
      "x-forwarded-proto": "https"
    }),
    "https://demo.example.com"
  );
});

test("uses http for localhost fallback origins", () => {
  assert.equal(pushOriginFromHeaders({ host: "localhost:3003" }), "http://localhost:3003");
});
