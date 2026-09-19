import test from "node:test";
import assert from "node:assert/strict";
import { storyGender, storyTitle, validStoryMedia } from "./stories.js";

test("story titles use explicit gender only, with a self label", () => {
  assert.equal(storyTitle("female"), "她的故事");
  assert.equal(storyTitle("male"), "他的故事");
  for (const gender of [null, undefined, "", "unspecified", "unexpected"]) {
    assert.equal(storyTitle(gender), "TA的故事");
    assert.equal(storyGender(gender), "unspecified");
  }
  assert.equal(storyTitle("female", true), "我的故事");
});

test("stories need media and enforce independent photo and voice limits", () => {
  assert.equal(validStoryMedia([]), false);
  assert.equal(validStoryMedia(["text"]), false);
  assert.equal(validStoryMedia(["video"]), false);
  assert.equal(validStoryMedia(["voice"]), true);
  assert.equal(validStoryMedia(["image"]), true);
  assert.equal(validStoryMedia([...Array<string>(9).fill("image"), "voice"]), true);
  assert.equal(validStoryMedia(Array<string>(10).fill("image")), false);
  assert.equal(validStoryMedia(["voice", "voice"]), false);
});
