import assert from "node:assert/strict";
import test from "node:test";
import { fallbackDirectChatNames, isAutomaticDirectChatName, parseDirectChatNameSuggestions } from "./directChatNames.js";

test("fallback direct chat names always provide seven unique choices", () => {
  const names = fallbackDirectChatNames(["admin", "游乐园司机", "小明"]);
  assert.equal(names.length, 7);
  assert.equal(new Set(names).size, 7);
  assert.ok(names.every((name) => name.length > 0 && name.length <= 80));
});

test("AI direct chat names are cleaned and completed to seven choices", () => {
  const names = parseDirectChatNameSuggestions(
    '```json\n["星光碰头会", "快乐施工队", "星光碰头会"]\n```',
    ["admin", "游乐园司机", "小明"]
  );
  assert.equal(names.length, 7);
  assert.deepEqual(names.slice(0, 2), ["星光碰头会", "快乐施工队"]);
  assert.equal(new Set(names).size, 7);
});

test("legacy direct chat names are recognized as automatic", () => {
  assert.equal(isAutomaticDirectChatName("私聊：admin、游乐园司机"), true);
  assert.equal(isAutomaticDirectChatName("脑洞联络站"), false);
});
