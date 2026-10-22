import assert from "node:assert/strict";
import test from "node:test";
import { assistantActivationPayload, assistantActivationSuppressed, hasAssistantOptOutSuffix } from "./assistantActivation.js";

test("visible trailing spaces survive HTML editor wrappers and NBSP encoding", () => {
  for (const content of ["@所罗没门 为什么？ ", "谢谢  ", "<p>@ai_slmm 为什么？ </p>", "<div>为什么？&nbsp;</div>", "<p>为什么？&#160;</p>", "<b>为什么？&#xA0;</b>", "为什么？\u00a0"])
    assert.equal(hasAssistantOptOutSuffix(content), true, content);
  for (const content of [undefined, null, "为什么？", " 为什么？", "为什么？\t", "为什么？ \n", "<p>为什么？ </p><br>", "<p>为什么？&amp;nbsp;</p>", '<a title=" ">为什么？</a>'])
    assert.equal(hasAssistantOptOutSuffix(content), false, String(content));
});

test("server policy is derived from raw text and cannot be spoofed by payload values", () => {
  assert.deepEqual(assistantActivationPayload("为什么？ ", { effect: "shine", aiActivationSuppressed: false }), { effect: "shine", aiActivationSuppressed: true });
  assert.deepEqual(assistantActivationPayload("为什么？", { effect: "shine", aiActivationSuppressed: true }), { effect: "shine" });
  assert.equal(assistantActivationPayload("为什么？", { aiActivationSuppressed: true }), undefined);
  assert.deepEqual(assistantActivationPayload("<p>为什么？&nbsp;</p>"), { aiActivationSuppressed: true });
});

test("persisted server markers and untrimmed historic content retain their opt-out", () => {
  assert.equal(assistantActivationSuppressed({ content: "为什么？", payload: { aiActivationSuppressed: true } }), true);
  assert.equal(assistantActivationSuppressed({ content: "为什么？ ", payload: { aiActivationSuppressed: false } }), true);
  for (const payload of [undefined, null, false, [], { aiActivationSuppressed: false }, { aiActivationSuppressed: "true" }])
    assert.equal(assistantActivationSuppressed({ content: "为什么？", payload }), false);
});
