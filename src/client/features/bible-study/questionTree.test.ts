/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import type { BibleStudyQuestion } from "@shared/bibleStudy";
import { studyQuestionAncestors, studyQuestionTree } from "./questionTree";

function question(id: number, parentId?: number): BibleStudyQuestion {
  return { id, parentId, stage: "observe", relation: parentId ? "deepen" : "opening", text: `问题${id}`, purpose: "观察", evidence: [] };
}
test("historical branch stays a sibling while numbering follows creation order", () => {
  const questions = [question(100), question(200, 100), question(300, 200), question(400, 100)];
  const tree = studyQuestionTree(questions);
  assert.deepEqual(tree.rows.map(row => [row.question.id, row.label, row.parentLabel, row.depth]), [
    [100, "Q1", undefined, 0], [200, "q2", "Q1", 1], [300, "q3", "q2", 2], [400, "q4", "Q1", 1]
  ]);
  assert.deepEqual(studyQuestionAncestors(questions, 400).map(q => q.id), [100]);
});
test("deep questions keep short labels and at most two indentations without losing ancestors", () => {
  const questions = Array.from({ length: 100 }, (_, i) => question(i + 1, i || undefined));
  const tree = studyQuestionTree(questions);
  assert.equal(tree.rows.length, 100);
  assert.equal(tree.rows[99].label, "q100");
  assert.equal(tree.rows[99].parentLabel, "q99");
  assert.equal(Math.max(...tree.rows.map(row => row.depth)), 2);
  assert.equal(studyQuestionAncestors(questions, 100).length, 99);
});
test("new main question is uppercase and malformed legacy relationships remain navigable", () => {
  const questions = [question(1, 2), question(2, 1), question(3, 99), question(4)];
  assert.equal(studyQuestionTree(questions).rows.length, 4);
  assert.equal(studyQuestionTree(questions).labels.get(4), "Q4");
  assert.ok(studyQuestionAncestors(questions, 1).length <= questions.length);
});
