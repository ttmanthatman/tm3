/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import type { BibleStudyQuestion } from "@shared/bibleStudy";
import { studyQuestionAncestors, studyQuestionTree } from "./questionTree";

function question(id: number, parentId?: number): BibleStudyQuestion {
  return { id, parentId, stage: "observe", relation: parentId ? "deepen" : "opening", text: `问题${id}`, purpose: "观察", evidence: [] };
}
test("follow-ups use sibling ordinals in their complete parent path", () => {
  const questions = [question(100), question(200, 100), question(300, 200), question(400, 100)];
  const tree = studyQuestionTree(questions);
  assert.deepEqual(tree.rows.map(row => [row.question.id, row.label, row.parentLabel, row.depth]), [
    [100, "Q1", undefined, 0], [200, "追问Q1:1", "Q1", 1], [300, "追问Q1:1:1", "追问Q1:1", 2], [400, "追问Q1:2", "Q1", 1]
  ]);
  assert.deepEqual(studyQuestionAncestors(questions, 400).map(q => q.id), [100]);
});
test("deep questions retain the full path and uncapped indentation", () => {
  const questions = Array.from({ length: 100 }, (_, i) => question(i + 1, i || undefined));
  const tree = studyQuestionTree(questions);
  assert.equal(tree.rows.length, 100);
  assert.equal(tree.rows[99].label, "追问Q1" + ":1".repeat(99));
  assert.equal(tree.rows[99].parentLabel, "追问Q1" + ":1".repeat(98));
  assert.equal(Math.max(...tree.rows.map(row => row.depth)), 99);
  assert.equal(studyQuestionAncestors(questions, 100).length, 99);
});
test("new main question is uppercase and malformed legacy relationships remain navigable", () => {
  const questions = [question(1, 2), question(2, 1), question(3, 99), question(4)];
  assert.equal(studyQuestionTree(questions).rows.length, 4);
  assert.equal(studyQuestionTree(questions).labels.get(4), "Q4");
  assert.ok(studyQuestionAncestors(questions, 1).length <= questions.length);
});

test("Q5 remains unchanged while its follow-ups become Q5:1, Q5:1:1 and Q5:2", () => {
  const questions = [question(1), question(2), question(3), question(4), question(5), question(6, 5), question(7, 6), question(8, 5)];
  const labels = studyQuestionTree([...questions].reverse()).labels;
  assert.deepEqual([5, 6, 7, 8].map(id => labels.get(id)), ["Q5", "追问Q5:1", "追问Q5:1:1", "追问Q5:2"]);
  assert.equal(studyQuestionTree([...questions, question(9, 5)]).labels.get(8), "追问Q5:2");
});
