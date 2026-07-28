import assert from "node:assert/strict";
import test from "node:test";
import {
  MUSIC_PANEL_FONT_SIZE_DEFAULT,
  MUSIC_PANEL_FONT_SIZE_MAX,
  MUSIC_PANEL_FONT_SIZE_MIN,
  cleanMusicPanelFontSize
} from "./musicPlayback.js";

test("cleans the music panel font size into the supported integer range", () => {
  assert.equal(cleanMusicPanelFontSize(undefined), MUSIC_PANEL_FONT_SIZE_DEFAULT);
  assert.equal(cleanMusicPanelFontSize("not-a-number"), MUSIC_PANEL_FONT_SIZE_DEFAULT);
  assert.equal(cleanMusicPanelFontSize(4), MUSIC_PANEL_FONT_SIZE_MIN);
  assert.equal(cleanMusicPanelFontSize(99), MUSIC_PANEL_FONT_SIZE_MAX);
  assert.equal(cleanMusicPanelFontSize("22"), 22);
  assert.equal(cleanMusicPanelFontSize(18.6), 19);
});
