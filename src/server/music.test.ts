import assert from "node:assert/strict";
import test from "node:test";
import { canManageMusicRole, isMusicFileHeader, isMusicFileName, musicTrackTitle } from "./music.js";

test("music management is limited to admins and treasury officers", () => {
  assert.equal(canManageMusicRole({ isAdmin: true, canPinMessages: false }), true);
  assert.equal(canManageMusicRole({ isAdmin: false, canPinMessages: true }), true);
  assert.equal(canManageMusicRole({ isAdmin: false, canPinMessages: false }), false);
});

test("music files accept only mp3 and m4a names", () => {
  assert.equal(isMusicFileName("song.MP3"), true);
  assert.equal(isMusicFileName("song.m4a"), true);
  assert.equal(isMusicFileName("voice.wav"), false);
  assert.equal(isMusicFileName("fake.mp3.exe"), false);
});

test("music signatures recognize MP3 and M4A containers", () => {
  assert.equal(isMusicFileHeader(Buffer.from("494433040000", "hex"), ".mp3"), true);
  assert.equal(isMusicFileHeader(Buffer.from("ffe30000", "hex"), ".mp3"), true);
  assert.equal(isMusicFileHeader(Buffer.from("00000018667479704d344120", "hex"), ".m4a"), true);
  assert.equal(isMusicFileHeader(Buffer.from("89504e470d0a1a0a", "hex"), ".mp3"), false);
  assert.equal(isMusicFileHeader(Buffer.from("000000186d6f6f76", "hex"), ".m4a"), false);
});

test("music titles remove the extension and unsafe path", () => {
  assert.equal(musicTrackTitle("晨光.mp3"), "晨光");
  assert.equal(musicTrackTitle("../夜曲.m4a"), "夜曲");
  assert.equal(musicTrackTitle(".mp3"), "未命名歌曲");
});
