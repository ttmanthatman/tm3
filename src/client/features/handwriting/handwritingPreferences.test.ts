import assert from "node:assert/strict";
import test from "node:test";
import { HANDWRITING_DEFAULT_BRUSH_ALGORITHM, HANDWRITING_DEFAULT_PREFERENCES, normalizeHandwritingPreferences, type HandwritingPreferencesDTO } from "@shared/handwriting";
import type { AccountDTO } from "@shared/types";
import { createHandwritingPreferences } from "./handwritingPreferences";

function account(id: number) {
  return { id, handwritingPreferences: structuredClone(HANDWRITING_DEFAULT_PREFERENCES) } as AccountDTO;
}
const slanted = normalizeHandwritingPreferences({ pen: "brush", brush: { size: 50, sensitivity: 80, lag: 20, algorithm: "slanted" } });

test("personal saves coalesce rapid changes and retain confirmed values on failure", async () => {
  const store = { account: account(1) };
  const saved: HandwritingPreferencesDTO[] = [];
  let fail = false;
  const writer = createHandwritingPreferences(store, async (preferences) => {
    if (fail) throw new Error("offline");
    saved.push(preferences);
    return { account: { ...account(1), handwritingPreferences: preferences } };
  });
  writer.save(HANDWRITING_DEFAULT_PREFERENCES);
  await writer.save(slanted);
  assert.deepEqual(saved, [slanted]);
  assert.deepEqual(store.account.handwritingPreferences, slanted);
  fail = true;
  await writer.save(HANDWRITING_DEFAULT_PREFERENCES);
  assert.deepEqual(store.account.handwritingPreferences, slanted);
  assert.match(writer.error.value, /保存失败/);
  fail = false;
  await writer.save(HANDWRITING_DEFAULT_PREFERENCES);
  assert.equal(writer.error.value, "");
});

test("a completed save cannot overwrite the next signed-in account", async () => {
  const store = { account: account(1) };
  let complete!: (result: { account: AccountDTO }) => void;
  const writer = createHandwritingPreferences(store, () => new Promise((resolve) => { complete = resolve; }));
  const saving = writer.save(slanted);
  await Promise.resolve();
  store.account = account(2);
  complete({ account: { ...account(1), handwritingPreferences: slanted } });
  await saving;
  assert.equal(store.account.id, 2);
  assert.deepEqual(store.account.handwritingPreferences, HANDWRITING_DEFAULT_PREFERENCES);
});

test("switching back to follow and resetting defaults explicitly save the selected algorithm", async () => {
  const store = { account: { ...account(1), handwritingPreferences: slanted } };
  const saved: HandwritingPreferencesDTO[] = [];
  const writer = createHandwritingPreferences(store, async (preferences) => {
    saved.push(preferences);
    return { account: { ...account(1), handwritingPreferences: normalizeHandwritingPreferences(preferences) } };
  });
  const follow = { ...slanted, brush: { ...slanted.brush, algorithm: "follow" as const } };
  await writer.save(follow);
  assert.equal(saved[0].brush.algorithm, "follow");
  assert.deepEqual(store.account.handwritingPreferences, normalizeHandwritingPreferences(follow));
  await writer.save(slanted);
  await writer.save(HANDWRITING_DEFAULT_PREFERENCES);
  assert.equal(saved[2].brush.algorithm, HANDWRITING_DEFAULT_BRUSH_ALGORITHM);
  assert.deepEqual(store.account.handwritingPreferences, HANDWRITING_DEFAULT_PREFERENCES);
  assert.equal(writer.error.value, "");
});

test("an in-flight slanted save cannot undo a newer follow selection", async () => {
  const store = { account: account(1) };
  const saved: HandwritingPreferencesDTO[] = [];
  let complete!: (result: { account: AccountDTO }) => void;
  const writer = createHandwritingPreferences(store, (preferences) => {
    saved.push(preferences);
    return new Promise((resolve) => { complete = resolve; });
  });
  const first = writer.save(slanted);
  await Promise.resolve();
  const follow = normalizeHandwritingPreferences({ ...slanted, brush: { ...slanted.brush, algorithm: "follow" } });
  const last = writer.save(follow);
  complete({ account: { ...account(1), handwritingPreferences: slanted } });
  await first;
  assert.deepEqual(store.account.handwritingPreferences, follow);
  assert.equal(saved[1].brush.algorithm, "follow");
  complete({ account: { ...account(1), handwritingPreferences: follow } });
  await last;
  assert.deepEqual(store.account.handwritingPreferences, follow);
});
