/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { effectScope, nextTick, ref } from "vue";
import { setImmediate } from "node:timers/promises";
import type { BibleLookupDTO } from "@shared/types";
import { useBibleStudyNavigation, type StudyScriptureSelection } from "./useBibleStudyNavigation";

Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => null } });

const selected = (id: number, evidence: string[], automatic = false): StudyScriptureSelection => ({ questionId: id, reference: "马可福音 14:37-39", evidence, automatic });
const lookup = (reference: string): BibleLookupDTO => ({ reference, normalizedReference: reference, sourceId: "cuv", translation: "和合本", verses: [{ book: "马可福音", chapter: 14, verse: 38, endVerse: 38, reference, text: "总要警醒祷告。" }] });
function harness(desktop = true) {
  const enabled = ref(true);
  const bibleOpen = ref(false);
  const splitAvailable = ref(desktop);
  const calls: Array<{ lookups: BibleLookupDTO[]; highlight: boolean }> = [];
  let clears = 0;
  const scope = effectScope();
  const workspace = ref({ clearStudyContext: () => { clears++; }, openStudyContext: async (lookups: BibleLookupDTO[], highlight: boolean) => { calls.push({ lookups, highlight }); } });
  const navigation = scope.run(() => useBibleStudyNavigation({ enabled: () => enabled.value, workspace, splitAvailable, bibleOpen, openBible: () => { bibleOpen.value = true; }, shrinkBible: () => {} }))!;
  return { ...navigation, enabled, bibleOpen, splitAvailable, calls, clears: () => clears, stop: () => scope.stop() };
}
async function flush() { await nextTick(); await setImmediate(); await nextTick(); }

test("general questions clear previous highlights without inheriting a verse; direct evidence drives navigation", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async input => Response.json({ success: true, result: lookup(new URL(String(input), "http://localhost").searchParams.get("reference")!) });
  const h = harness();
  try {
    h.selectStudyScripture(selected(1, [], true)); await flush();
    assert.equal(h.bibleOpen.value, true);
    assert.equal(h.calls[0].highlight, false);
    h.selectStudyScripture(selected(8, ["马可福音 14:38"])); await flush();
    assert.equal(h.calls[1].highlight, true);
    assert.equal(h.calls[1].lookups[0].reference, "马可福音 14:38");
    const before = h.clears();
    h.selectStudyScripture(selected(9, [])); await flush();
    assert.ok(h.clears() > before);
    assert.equal(h.calls.length, 2);
    h.enabled.value = false; await flush();
    assert.ok(h.clears() > before + 1);
  } finally { h.stop(); globalThis.fetch = original; }
});
test("automatic mobile updates keep the question visible while explicit selection opens the reader", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, result: lookup("马可福音 14:38") });
  const h = harness(false);
  try {
    h.selectStudyScripture(selected(8, ["马可福音 14:38"], true)); await flush();
    assert.equal(h.bibleOpen.value, false); assert.equal(h.calls.length, 0);
    h.selectStudyScripture(selected(8, ["马可福音 14:38"])); await flush();
    assert.equal(h.bibleOpen.value, true); assert.equal(h.calls.length, 1);
  } finally { h.stop(); globalThis.fetch = original; }
});
test("a slow earlier lookup cannot overwrite the latest question or restore cleared highlighting", async () => {
  const original = globalThis.fetch;
  let release!: (response: Response) => void;
  globalThis.fetch = async () => new Promise<Response>(resolve => { release = resolve; });
  const h = harness();
  try {
    h.selectStudyScripture(selected(8, ["马可福音 14:38"])); await flush();
    h.enabled.value = false; await flush();
    release(Response.json({ success: true, result: lookup("马可福音 14:38") })); await flush();
    assert.equal(h.calls.length, 0);
  } finally { h.stop(); globalThis.fetch = original; }
});
test("reader errors remain visible and clicking the question again retries", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: false });
  const h = harness();
  try {
    h.selectStudyScripture(selected(8, ["马可福音 14:38"])); await flush();
    assert.match(h.studyBibleError.value, /无法定位/);
    globalThis.fetch = async () => Response.json({ success: true, result: lookup("马可福音 14:38") });
    h.selectStudyScripture(selected(8, ["马可福音 14:38"])); await flush();
    assert.equal(h.studyBibleError.value, ""); assert.equal(h.calls.length, 1);
  } finally { h.stop(); globalThis.fetch = original; }
});
