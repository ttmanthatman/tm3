import assert from "node:assert/strict";
import test from "node:test";
import { reminderEditor, reminderOffsets } from "./calendarReminderOffsets";

test("day offsets convert to persisted minutes and reopen without changing reminders", () => {
  assert.deepEqual(reminderOffsets("0,1，3", "days"), [0, 1440, 4320]);
  assert.deepEqual(reminderOffsets("0,0.5,30", "days"), [0, 720, 43200]);
  for (const offsets of [[0], [0, 10, 1440], [43200, 4320, 1440, 0]]) {
    const edit = reminderEditor(offsets);
    assert.deepEqual(reminderOffsets(edit.text, edit.unit), offsets);
  }
  assert.equal(reminderEditor([1440, 0]).unit, "days");
  assert.equal(reminderEditor([10, 1440]).unit, "minutes");
  assert.ok(Number.isNaN(reminderOffsets("1,", "days")[1]));
});
