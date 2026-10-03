import assert from "node:assert/strict";
import test from "node:test";
import { HANDWRITING_DEFAULT_PREFERENCES, normalizeHandwritingPreferences, type HandwritingPreferencesDTO } from "@shared/handwriting";
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
