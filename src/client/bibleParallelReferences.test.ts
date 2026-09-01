import assert from "node:assert/strict";
import test from "node:test";
import { bibleParallelReferenceSegments } from "./bibleParallelReferences";

test("parallel references display colons and half-width range hyphens as individual links", () => {
  const segments = bibleParallelReferenceSegments("（太21·33—46；路20·9—19）");
  assert.deepEqual(segments, [
    { kind: "text", text: "（" },
    { kind: "link", text: "太21:33-46", reference: "太21:33-46" },
    { kind: "text", text: "；" },
    { kind: "link", text: "路20:9-19", reference: "路20:9-19" },
    { kind: "text", text: "）" }
  ]);
});

test("parallel references keep inherited ranges in one server-parseable link", () => {
  assert.deepEqual(bibleParallelReferenceSegments("（可11·12—14，20—24）"), [
    { kind: "text", text: "（" },
    { kind: "link", text: "可11:12-14，20-24", reference: "可11:12-14,20-24" },
    { kind: "text", text: "）" }
  ]);
});

test("unrecognized parallel text remains readable", () => {
  assert.deepEqual(bibleParallelReferenceSegments("（参见相关记载）"), [{ kind: "text", text: "（参见相关记载）" }]);
});
