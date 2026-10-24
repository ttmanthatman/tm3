import assert from "node:assert/strict";
import test from "node:test";
import { zoomAnnouncementPayload, zoomMeetingId, zoomMeetingStatus, type ZoomSettings } from "./zoom.js";

test("live Zoom status overrides manual deadlines without treating an unknown status as no meeting", () => {
  const now = Date.now();
  const settings: ZoomSettings = { url: "", meeting: { endsAt: new Date(now + 60_000).toISOString(), timeZone: "Asia/Shanghai" } };
  assert.equal(zoomMeetingStatus(settings, now), "active");
  assert.equal(zoomMeetingStatus(settings, now + 60_000), "inactive");
  for (const status of ["unknown", "active", "inactive"] as const) assert.equal(zoomMeetingStatus({ ...settings, live: { status } }, now), status);
});

test("Zoom announcements accept only trusted HTTPS meeting links and never link ended meetings", () => {
  const url = "https://us06web.zoom.us/j/123456789?pwd=fixture";
  assert.equal(zoomMeetingId(url), "123456789");
  assert.deepEqual(zoomAnnouncementPayload({ kind: "zoom_meeting", status: "active", url }), { kind: "zoom_meeting", status: "active", url });
  assert.deepEqual(zoomAnnouncementPayload({ kind: "zoom_meeting", status: "inactive", url: "javascript:alert(1)" }), { kind: "zoom_meeting", status: "inactive" });
  for (const value of [null, {}, { kind: "other" }, { kind: "zoom_meeting", status: "active" }, ...[
    "javascript:alert(1)", "http://zoom.us/j/123456789", "https://zoom.us.evil.test/j/123456789", "https://user:pass@zoom.us/j/123456789"
  ].map(url => ({ kind: "zoom_meeting", status: "active", url }))]) assert.equal(zoomAnnouncementPayload(value), null);
});
