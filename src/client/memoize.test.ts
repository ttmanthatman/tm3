import assert from "node:assert/strict";
import test from "node:test";
import { memoizeMessage } from "./memoize";

test("memoizeMessage computes once per object identity", () => {
  let calls = 0;
  const parse = memoizeMessage((message: { content: string }) => {
    calls += 1;
    return message.content.toUpperCase();
  });
  const message = { content: "hello" };
  assert.equal(parse(message), "HELLO");
  assert.equal(parse(message), "HELLO");
  assert.equal(calls, 1);
});

test("memoizeMessage treats replaced objects as new inputs", () => {
  let calls = 0;
  const parse = memoizeMessage((message: { content: string }) => {
    calls += 1;
    return message.content.toUpperCase();
  });
  assert.equal(parse({ content: "same" }), "SAME");
  // A replacement object with identical content recomputes; that is what
  // keeps edits from ever serving stale results.
  assert.equal(parse({ content: "same" }), "SAME");
  assert.equal(calls, 2);
});
