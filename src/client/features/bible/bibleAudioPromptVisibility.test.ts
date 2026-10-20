import assert from "node:assert/strict";
import test from "node:test";
import { bibleAudioPromptVisible } from "./bibleAudioPromptVisibility";

const chatOnly = { sessionActive: true, bibleOpen: false, sermonWorkspaceOpen: false, bookWorkspaceOpen: false, musicLyricsHeaderVisible: false };

test("the prompter floats over the chat only while a session plays and nothing else owns the screen", () => {
  assert.equal(bibleAudioPromptVisible(chatOnly), true);
  assert.equal(bibleAudioPromptVisible({ ...chatOnly, sessionActive: false }), false);
});

test("the prompter never appears while the Bible workspace is open, split or fullscreen alike", () => {
  // bibleOpen 覆盖分屏与全屏两种布局：分屏时聊天仍可见，提词器也不得出现
  assert.equal(bibleAudioPromptVisible({ ...chatOnly, bibleOpen: true }), false);
});

test("sermon and book workspaces and the music lyrics header also hide the prompter", () => {
  assert.equal(bibleAudioPromptVisible({ ...chatOnly, sermonWorkspaceOpen: true }), false);
  assert.equal(bibleAudioPromptVisible({ ...chatOnly, bookWorkspaceOpen: true }), false);
  assert.equal(bibleAudioPromptVisible({ ...chatOnly, musicLyricsHeaderVisible: true }), false);
});
