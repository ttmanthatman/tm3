import assert from "node:assert/strict";
import test from "node:test";
import { completeBibleStudyTurn, BibleStudyModelError } from "./bibleStudyModel.js";
import { studyQuestionFromMessage } from "./bibleStudyQuestions.js";

const messages = [{ role: "system" as const, content: "观察经文" }, { role: "user" as const, content: "这里的祷告是什么意思？" }];
test("an additional question may receive guidance without inventing another question", async () => {
  const turn = await completeBibleStudyTurn(async () => JSON.stringify({ action: "respond", text: "这里先看耶稣的吩咐。" }), messages, "observe");
  assert.deepEqual(turn, { action: "respond", text: "这里先看耶稣的吩咐。" });
  assert.equal(studyQuestionFromMessage({ id: 2, content: turn.text, payload: { kind: "bible_study_turn", stage: "observe", responseOnly: true } }), undefined);
});
test("plain-text fallback accepts a non-question response and keeps a genuine question", async () => {
  let calls = 0;
  const response = await completeBibleStudyTurn(async (_messages, mode) => {
    calls++;
    return mode === "json" ? "bad JSON" : "这是一段简短的解释。";
  }, messages, "observe");
  assert.equal(calls, 2);
  assert.equal(response.action, "respond");
  const question = await completeBibleStudyTurn(async () => JSON.stringify({ action: "ask", text: "耶稣吩咐了什么？" }), messages, "observe");
  assert.equal(question.action, "ask");
});
test("hints and skip transitions still require a question and cannot advance the stage", async () => {
  await assert.rejects(completeBibleStudyTurn(async () => JSON.stringify({ action: "respond", text: "不提出新的问题。" }), messages, "observe", true), error => error instanceof BibleStudyModelError && error.reason === "format");
});
