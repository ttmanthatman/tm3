import assert from "node:assert/strict";
import test from "node:test";
import { canManageMusicAsset, canManageMusicRole, isMusicFileHeader, isMusicFileName, isMusicScoreImageName, musicTrackInfo, musicTrackTitle } from "./music.js";

test("music management is limited to admins and treasury officers", () => {
  assert.equal(canManageMusicRole({ isAdmin: true, canPinMessages: false }), true);
  assert.equal(canManageMusicRole({ isAdmin: false, canPinMessages: true }), true);
  assert.equal(canManageMusicRole({ isAdmin: false, canPinMessages: false }), false);
});

test("regular users manage only music assets they uploaded", () => {
  assert.equal(canManageMusicAsset({ accountId: 1, isAdmin: true, canPinMessages: false }, 2), true);
  assert.equal(canManageMusicAsset({ accountId: 1, isAdmin: false, canPinMessages: true }, 2), true);
  assert.equal(canManageMusicAsset({ accountId: 1, isAdmin: false, canPinMessages: false }, 1), true);
  assert.equal(canManageMusicAsset({ accountId: 1, isAdmin: false, canPinMessages: false }, 2), false);
  assert.equal(canManageMusicAsset({ accountId: 1, isAdmin: false, canPinMessages: false }, null), false);
});

test("music files accept only mp3 and m4a names", () => {
  assert.equal(isMusicFileName("song.MP3"), true);
  assert.equal(isMusicFileName("song.m4a"), true);
  assert.equal(isMusicFileName("voice.wav"), false);
  assert.equal(isMusicFileName("fake.mp3.exe"), false);
});

test("music score pages accept safe browser and phone image formats", () => {
  for (const fileName of ["page.png", "page.JPG", "page.jpeg", "page.webp", "page.heic", "page.HEIF"]) {
    assert.equal(isMusicScoreImageName(fileName), true);
  }
  for (const fileName of ["page.gif", "page.svg", "page.pdf", "page.heic.exe"]) {
    assert.equal(isMusicScoreImageName(fileName), false);
  }
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

test("music track info reads only string fields from object payloads", () => {
  assert.deepEqual(musicTrackInfo({ background: "背景", lyricsText: "歌词", playlistId: 7 }), { background: "背景", lyricsText: "歌词" });
  assert.deepEqual(musicTrackInfo({ playlistId: 7 }), { background: null, lyricsText: null });
  assert.deepEqual(musicTrackInfo({ background: 42, lyricsText: ["不是字符串"] }), { background: null, lyricsText: null });
  assert.deepEqual(musicTrackInfo(null), { background: null, lyricsText: null });
  assert.deepEqual(musicTrackInfo(["背景"]), { background: null, lyricsText: null });
  assert.deepEqual(musicTrackInfo("背景"), { background: null, lyricsText: null });
});
