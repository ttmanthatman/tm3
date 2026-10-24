import assert from "node:assert/strict";
import test from "node:test";
import type { MessageDTO } from "@shared/types";
import type { ZoomSettings } from "@shared/zoom";
import { zoomAnnouncementEnded } from "./zoomAnnouncementState";

const url = "https://zoom.us/j/123456789";
const createdAt = "2026-10-24T10:00:01.000Z";
function notice(id: number, status: "active" | "inactive", channelId = 1) {
  return { id, channelId, type: "system", createdAt, payload: { kind: "zoom_meeting", status, ...(status === "active" ? { url } : {}) } } as MessageDTO;
}
const start = notice(10, "active");
const active: ZoomSettings = { url, meeting: null, live: { status: "active", updatedAt: "2026-10-24T10:00:00.000Z" } };

test("a current Zoom start remains joinable only after status loads", () => {
  assert.equal(zoomAnnouncementEnded(start, [start], active), false);
  assert.equal(zoomAnnouncementEnded(start, [start], null), true);
  assert.equal(zoomAnnouncementEnded(start, [start], { ...active, live: { status: "unknown" } }), true);
});

test("later Zoom ends or starts expire earlier notices without waiting for polling", () => {
  assert.equal(zoomAnnouncementEnded(start, [start, notice(11, "inactive")], active), true);
  assert.equal(zoomAnnouncementEnded(start, [notice(12, "active"), start], active), true);
  assert.equal(zoomAnnouncementEnded(start, [notice(9, "inactive"), notice(11, "inactive", 2)], active), false);
  assert.equal(zoomAnnouncementEnded(start, [{ ...notice(11, "inactive"), type: "text" }], active), false);
});

test("current server state covers ends and newer meetings outside loaded history", () => {
  assert.equal(zoomAnnouncementEnded(start, [start], { ...active, live: { status: "inactive" } }), true);
  assert.equal(zoomAnnouncementEnded(start, [start], { ...active, live: { status: "active", updatedAt: "2026-10-25T10:00:00.000Z" } }), true);
  assert.equal(zoomAnnouncementEnded(start, [start], { ...active, url: "https://zoom.us/j/987654321" }), true);
  assert.equal(zoomAnnouncementEnded(start, [start], { url, meeting: { endsAt: createdAt, timeZone: "Asia/Shanghai" } }, Date.parse(createdAt)), true);
});

test("ended notices and unrelated system messages do not become start actions", () => {
  assert.equal(zoomAnnouncementEnded(notice(11, "inactive"), [], active), false);
  assert.equal(zoomAnnouncementEnded({ ...start, payload: null }, [], active), false);
});
