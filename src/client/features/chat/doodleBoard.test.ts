import assert from "node:assert/strict";
import test from "node:test";
import { doodlePoint, parseDoodleDraft, renderDoodle, type DoodleDraft } from "./doodleBoard.js";

const draft: DoodleDraft = { version: 1, width: 900, height: 1200, marks: [
  { kind: "stroke", color: "#40344e", width: 5, erase: false, points: [{ x: 10, y: 20 }, { x: 90, y: 60 }] },
  { kind: "text", color: "#3181d1", size: 24, text: "随手画", x: 20, y: 100 }
] };

test("doodle coordinates preserve board coordinates after responsive scaling and clamp captured pointers", () => {
  assert.deepEqual(doodlePoint(160, 220, { left: 10, top: 20, width: 300, height: 400 }, 900, 1200), { x: 450, y: 600 });
  assert.deepEqual(doodlePoint(-100, 2000, { left: 10, top: 20, width: 300, height: 400 }, 900, 1200), { x: 0, y: 1200 });
});

test("doodle drafts preserve colored ink, text, erasure and undoable clearing across reload", () => {
  const value: DoodleDraft = { ...draft, marks: [...draft.marks, { kind: "stroke", color: "#ffffff", width: 20, erase: true, points: [{ x: 10, y: 20 }] }, { kind: "clear" }] };
  assert.deepEqual(parseDoodleDraft(JSON.stringify(value)), value);
});

test("doodle drafts reject invalid or oversized local data before rendering", () => {
  for (const value of [null, { ...draft, version: 2 }, { ...draft, width: 0 }, { ...draft, marks: [{ ...draft.marks[0], color: "url(bad)" }] }, { ...draft, marks: [{ ...draft.marks[0], points: [{ x: -1, y: 0 }] }] }, { ...draft, marks: [{ ...draft.marks[0], points: new Array(80001).fill({ x: 0, y: 0 }) }] }, { ...draft, marks: [{ ...draft.marks[1], text: "x".repeat(121) }] }]) {
    assert.throws(() => parseDoodleDraft(JSON.stringify(value)));
  }
  assert.throws(() => parseDoodleDraft(" ".repeat(3_000_001)));
});

test("doodle replay erases transparent ink and clears earlier marks without painting over the paper", () => {
  const operations: string[] = [];
  const ctx = {
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, arc() {},
    clearRect() { operations.push("clear"); },
    fill() { operations.push(`dot:${this.globalCompositeOperation}`); },
    stroke() { operations.push(`line:${this.globalCompositeOperation}`); },
    fillText(value: string) { operations.push(`text:${value}`); },
    globalCompositeOperation: "source-over"
  };
  renderDoodle(ctx as unknown as CanvasRenderingContext2D, { ...draft, marks: [...draft.marks, { kind: "stroke", color: "#ffffff", width: 20, erase: true, points: [{ x: 10, y: 20 }] }, { kind: "clear" }] });
  assert.deepEqual(operations, ["clear", "dot:source-over", "line:source-over", "text:随手画", "dot:destination-out", "clear"]);
});
