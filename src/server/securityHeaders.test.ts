import assert from "node:assert/strict";
import test from "node:test";
import { CONTENT_SECURITY_POLICY } from "./securityHeaders.js";

test("HTTPS article images remain allowed while active content stays same-origin", () => {
  assert.match(CONTENT_SECURITY_POLICY, /img-src 'self' https: data: blob:/);
  assert.match(CONTENT_SECURITY_POLICY, /script-src 'self'/);
  assert.doesNotMatch(CONTENT_SECURITY_POLICY, /script-src[^;]*https:/);
});
