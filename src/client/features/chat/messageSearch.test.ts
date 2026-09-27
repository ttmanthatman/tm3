import assert from "node:assert/strict";
import test from "node:test";
import type { MessageSearchCursorDTO } from "@shared/types";
import {
  highlightMessageSearchText,
  messageSearchPageUrl,
  messageSearchSnippet,
  normalizeMessageSearchQuery
} from "./messageSearch.js";

test("message search trims query input and preserves valid one-character searches", () => {
  assert.equal(normalizeMessageSearchQuery("  祷告  "), "祷告");
  assert.equal(normalizeMessageSearchQuery("  祷  "), "祷");
  assert.equal(normalizeMessageSearchQuery("  "), "");
});

test("message search highlights each case-insensitive match without changing surrounding text", () => {
  assert.deepEqual(highlightMessageSearchText("Hello hello!", "HELLO"), [
    { text: "Hello", match: true },
    { text: " ", match: false },
    { text: "hello", match: true },
    { text: "!", match: false }
  ]);
  assert.deepEqual(highlightMessageSearchText("没有匹配词", "未知"), [{ text: "没有匹配词", match: false }]);
});

test("message search snippets retain the first match and mark omitted context", () => {
  const snippet = messageSearchSnippet("开头内容很多很多很多，目标词后面还有很多很多内容。", "目标词", 12);
  assert.ok(snippet.text.includes("目标词"));
  assert.equal(snippet.startsEarlier, true);
  assert.equal(snippet.endsLater, true);
});

test("message search pagination carries a stable timestamp and message id cursor", () => {
  const cursor: MessageSearchCursorDTO = { id: 42, createdAt: "2026-09-27T02:00:00.000Z" };
  const url = new URL(messageSearchPageUrl("咖啡 房", cursor), "https://example.test");
  assert.equal(url.searchParams.get("query"), "咖啡 房");
  assert.equal(url.searchParams.get("beforeId"), "42");
  assert.equal(url.searchParams.get("beforeCreatedAt"), cursor.createdAt);
});
