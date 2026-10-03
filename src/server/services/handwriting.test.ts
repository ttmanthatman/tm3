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

test("new brush versions survive server storage and invalid versions cannot be sent", () => {
  const brush = { size: 84, sensitivity: 50, lag: 100, version: 2 };
  const input = { ...payload, characters: [{ strokes: [{ ...payload.characters[0].strokes[0], brush }] }] };
  const prepared = prepareHandwritingMessage(input, "123e4567-e89b-42d3-a456-426614174000");
  assert.deepEqual(prepared.payload.characters[0].strokes[0].brush, brush);
  assert.deepEqual(normalizeHandwritingForStorage("handwriting", prepared.payload), prepared.payload);
  assert.throws(() => prepareHandwritingMessage({ ...input, characters: [{ strokes: [{ ...input.characters[0].strokes[0], brush: { ...brush, version: 3 } }] }] }, "request"), /版本/);
});
