import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { createMusicService } from "./musicService.js";

test("music list summaries omit full lyrics while a single-track detail keeps them", () => {
  const service = createMusicService({ prisma: {} as PrismaClient, canAccessChannel: async () => true });
  const lyrics = Array.from({ length: 100 }, (_, index) => `[00:${String(index % 60).padStart(2, "0")}.00]平安喜乐第${index}句`).join("\n");
  const track = {
    id: 7,
    fileName: "平安.mp3",
    fileSize: 1000,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    musicOrder: 0,
    payload: { lyricsText: lyrics },
    sender: { accountId: 1, displayName: "甲" },
    musicScores: [],
    musicLyrics: { id: 8, fileName: "平安.lrc", content: lyrics },
    _count: { musicPlays: 0 }
  };
  const list = service.serializeTrack(track, 0, false, true, false);
  const detail = service.serializeTrack(track, 0, false, true, true);
  assert.equal(list.lyrics?.fileName, "平安.lrc");
  assert.equal(list.lyrics?.cues, undefined);
  assert.equal(list.lyricsText, null);
  assert.ok(detail.lyrics?.cues?.length);
  assert.equal(detail.lyricsText, lyrics);
  assert.ok(JSON.stringify(list).length < JSON.stringify(detail).length / 4);
});
