import assert from "node:assert/strict";
import test from "node:test";
import { readMapSheet, revealPoint } from "./xmind";

test("XMind summaries keep their source range and relationship lines wait for both ends", () => {
  const leaf = (id: string) => ({ id, title: id });
  const map = readMapSheet({ rootTopic: { ...leaf("root"),
    children: { attached: [leaf("A"), leaf("B"), leaf("C")], summary: [leaf("S")] },
    summaries: [{ topicId: "S", range: "(0,1)" }] }, relationships: [{end1Id:"C",end2Id:"S",title:"关联"}] });
  const focus = revealPoint(map, [], 1);
  assert.deepEqual(focus.nodes.map(n=>n.title), ["root","A"]);
  assert.deepEqual(revealPoint(map, [], 4).nodes.map(n => n.title), ["root", "S"]);
  const summary = revealPoint(map, [0,1,2], 4);
  assert.deepEqual(summary.nodes.at(-1)?.parents,[1,2]);
  assert.equal(summary.links.length,0);
  assert.equal(revealPoint(map,summary.nodes.map(n=>n.id),3).links[0].label,"关联");
});
