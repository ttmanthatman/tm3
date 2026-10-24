import assert from "node:assert/strict";
import test from "node:test";
import { zoomMeetingStatus, type ZoomSettings } from "./zoom.js";

test("live Zoom status overrides manual deadlines without treating an unknown status as no meeting", () => {
  const now = Date.now();
  const settings: ZoomSettings = { url: "", meeting: { endsAt: new Date(now + 60_000).toISOString(), timeZone: "Asia/Shanghai" } };
  assert.equal(zoomMeetingStatus(settings, now), "active");
  assert.equal(zoomMeetingStatus(settings, now + 60_000), "inactive");
  for (const status of ["unknown", "active", "inactive"] as const) assert.equal(zoomMeetingStatus({ ...settings, live: { status } }, now), status);
});
