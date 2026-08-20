import assert from "node:assert/strict";
import test from "node:test";
import { normalizeReceptionCode, receptionCodeHash } from "./reception.js";

test("reception codes accept simple words and six digit numbers", () => {
  assert.equal(normalizeReceptionCode(" Grace "), "grace");
  assert.equal(normalizeReceptionCode("平安"), "平安");
  assert.equal(normalizeReceptionCode("123456"), "123456");
});

test("reception codes reject short or ambiguous input", () => {
  assert.throws(() => normalizeReceptionCode("a"), /至少需要 2 个字/);
  assert.throws(() => normalizeReceptionCode("12345"), /至少需要 6 位/);
  assert.throws(() => normalizeReceptionCode("hello-world"), /文字或数字/);
});

test("reception codes are stored as stable keyed hashes", () => {
  const hash = receptionCodeHash("Grace", "secret-a");
  assert.equal(hash, receptionCodeHash(" grace ", "secret-a"));
  assert.notEqual(hash, receptionCodeHash("grace", "secret-b"));
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hash.includes("grace"), false);
});
