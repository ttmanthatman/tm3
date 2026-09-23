import assert from "node:assert/strict";
import test from "node:test";
import { HANDWRITING_CONTENT } from "../../shared/handwriting.js";
import { normalizeHandwritingForStorage, prepareHandwritingMessage } from "./handwriting.js";

const payload = {
  kind: "handwriting",
  version: 1,
  characters: [{ strokes: [{ points: [[100, 200, 0], [300, 400, 20]] }] }]
};

test("prepares a normalized handwriting message with a server-controlled label", () => {
  assert.deepEqual(prepareHandwritingMessage(payload, "123e4567-e89b-42d3-a456-426614174000"), {
    content: HANDWRITING_CONTENT,
    payload
  });
});

test("handwriting requires a request id and valid payload before storage", () => {
  assert.throws(() => prepareHandwritingMessage(payload), /请求标识/);
  assert.throws(() => prepareHandwritingMessage({ ...payload, version: 2 }, "request"), /版本/);
  assert.throws(() => normalizeHandwritingForStorage("handwriting", { ...payload, characters: [] }), /不能为空/);
  assert.deepEqual(normalizeHandwritingForStorage("text", { effect: "flash" }), { effect: "flash" });
});
