/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";
import { bookClickAction, privateContentCacheName } from "./cache.js";

test("an uncached shelf click downloads before a later click opens", () => {
  assert.equal(bookClickAction("needed"), "download");
  assert.equal(bookClickAction("error"), "download");
  assert.equal(bookClickAction("downloading"), "wait");
  assert.equal(bookClickAction("checking"), "wait");
  assert.equal(bookClickAction("ready"), "open");
});

test("book cache uses the same session-scoped name as the service worker", () => {
  const payload = Buffer.from(JSON.stringify({ sessionId: "reader-session_42" })).toString("base64url");
  assert.equal(privateContentCacheName(`header.${payload}.signature`), "team-chat-content-reader-session_42");
  assert.equal(privateContentCacheName("invalid"), "");
});
