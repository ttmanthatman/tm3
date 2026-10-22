import assert from "node:assert/strict";
import test from "node:test";
import { loginLogKindLabel, loginLogTone } from "./adminFormat.js";

test("virtual character exchanges have a readable label and use the existing usage badge", () => {
  assert.equal(loginLogKindLabel("ai_exchange"), "虚拟角色问答");
  assert.equal(loginLogTone("ai_exchange"), "usage");
});
