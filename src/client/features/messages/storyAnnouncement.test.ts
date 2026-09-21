import assert from "node:assert/strict";
import test from "node:test";
import type { MessageDTO } from "@shared/types";
import { storyAnnouncementLetters } from "./storyAnnouncement";

function announcement(id: number, content = "麦田发了个故事"): MessageDTO {
  return { id, channelId: 1, sender: {} as MessageDTO["sender"], type: "system", payload: { kind: "story_announcement", storyId: 1 }, content, createdAt: "2026-09-21T00:00:00.000Z" };
}

test("only story announcements receive stable, individually colored letters", () => {
  const first = storyAnnouncementLetters(announcement(23));
  assert.ok(first);
  assert.equal(first.map((letter) => letter.text).join(""), "麦田发了个故事");
  assert.equal(new Set(first.map((letter) => letter.color)).size, first.length);
  assert.deepEqual(first, storyAnnouncementLetters(announcement(23)));
  assert.notDeepEqual(first, storyAnnouncementLetters(announcement(24)));
  assert.equal(storyAnnouncementLetters({ ...announcement(23), payload: { kind: "other" } }), null);
  assert.equal(storyAnnouncementLetters({ ...announcement(23), type: "text" }), null);
});
