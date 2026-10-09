import assert from "node:assert/strict";
import test from "node:test";
import { rememberVersionTimelineNotice, versionTimelineInsertions, versionTimelineStorageKey } from "./versionTimelineNotices";

test("version notices survive reloads and later upgrades without moving or duplicating", () => {
  const first = rememberVersionTimelineNotice(null, "2.7.0", 2000);
  const reload = rememberVersionTimelineNotice(JSON.stringify(first), "2.7.0", 4000);
  assert.deepEqual(reload, first);
  const upgrade = rememberVersionTimelineNotice(JSON.stringify(reload), "2.8.0", 5000);
  assert.deepEqual(upgrade, [{ version: "2.7.0", createdAt: 2000 }, { version: "2.8.0", createdAt: 5000 }]);
  assert.notEqual(versionTimelineStorageKey(1), versionTimelineStorageKey(2));
});

test("new messages and history prepends leave the notice between the same messages", () => {
  const notices = [{ version: "2.7.0", createdAt: 2000 }];
  const message = (time: number) => ({ createdAt: new Date(time).toISOString() });
  assert.deepEqual([...versionTimelineInsertions(notices, [message(1000)], false, false)], [[1, notices]]);
  assert.deepEqual([...versionTimelineInsertions(notices, [message(1000), message(3000)], false, false)], [[1, notices]]);
  assert.deepEqual([...versionTimelineInsertions(notices, [message(500), message(1000), message(3000)], false, false)], [[2, notices]]);
  assert.deepEqual([...versionTimelineInsertions(notices, [message(2000), message(3000)], false, false)], [[1, notices]]);
});

test("notices outside a partial message window stay outside it", () => {
  const notices = [{ version: "2.7.0", createdAt: 2000 }];
  const message = (time: number) => ({ createdAt: new Date(time).toISOString() });
  assert.equal(versionTimelineInsertions(notices, [message(1000)], false, true).size, 0);
  assert.equal(versionTimelineInsertions(notices, [message(3000)], true, false).size, 0);
  assert.deepEqual([...versionTimelineInsertions(notices, [], false, false)], [[0, notices]]);
});

test("invalid stored notices are discarded without losing valid version history", () => {
  assert.deepEqual(rememberVersionTimelineNotice("invalid json", "2.7.0", 2000), [{ version: "2.7.0", createdAt: 2000 }]);
  const raw = JSON.stringify([null, { version: "invalid", createdAt: 1000 }, { version: "2.6.0", createdAt: 1000 }, { version: "2.6.0", createdAt: 1200 }, { version: "2.5.0", createdAt: "bad" }]);
  assert.deepEqual(rememberVersionTimelineNotice(raw, "2.7.0", 2000), [{ version: "2.6.0", createdAt: 1000 }, { version: "2.7.0", createdAt: 2000 }]);
});
