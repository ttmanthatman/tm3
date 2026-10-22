import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, type ChannelKind, type MessageType, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { createQuestionAssistantCatalog, type QuestionAssistantCatalogAuth } from "./questionAssistantCatalog.js";
import type { MusicScoreLibraryRow } from "./musicScoreLibrary.js";

type Track = {
  id: number; channelId: number; type: MessageType; fileName: string | null; filePath: string | null; payload: Prisma.JsonValue;
  channel: { kind: ChannelKind; isPrivate: boolean };
  musicLyrics: { fileName: string; content: string } | null;
  musicScores: Array<{ id: number; title: string; pages: Array<{ fileName: string; filePath: string }> }>;
};
type Score = MusicScoreLibraryRow & { track: Track | null };
const viewer = { accountId: 10, isAdmin: false, canPinMessages: false };

function track(id: number, changes: Partial<Track> = {}): Track {
  return {
    id, channelId: 4, type: "file", fileName: `歌曲${id}.mp3`, filePath: `physical-uuid-${id}.mp3`, payload: {},
    channel: { kind: "music", isPrivate: false }, musicLyrics: null, musicScores: [], ...changes
  };
}

function score(id: number, linkedTrack: Track | null, changes: Partial<Score> = {}): Score {
  return {
    id, trackId: linkedTrack?.id ?? null, title: `合唱歌谱${id}`, uploadedByAccountId: 10,
    createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z"),
    track: linkedTrack,
    pages: [{
      id: id * 10, scoreId: id, pageIndex: 0, fileName: "显示谱名.pdf", filePath: `score-uuid-${id}.pdf`,
      fileSize: 100, width: 0, height: 0, createdAt: new Date("2026-01-01T00:00:00Z")
    }],
    ...changes
  };
}

function beforeId(where: Prisma.MessageWhereInput | Prisma.MusicScoreWhereInput | undefined): number {
  if (!where) return Infinity;
  if (where.id && typeof where.id === "object" && typeof where.id.lt === "number") return where.id.lt;
  const conditions = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
  return Math.min(Infinity, ...conditions.map(beforeId));
}

function harness(auth: QuestionAssistantCatalogAuth = viewer, publicOnly = false) {
  const tracks: Track[] = [];
  const scores: Score[] = [];
  const trackQueries: Prisma.MessageFindManyArgs[] = [];
  const scoreQueries: Prisma.MusicScoreFindManyArgs[] = [];
  const scoreLookups: Prisma.MusicScoreFindUniqueArgs[] = [];
  const failures = { tracks: false };
  // Return all candidate rows to exercise the service's final access/format checks as well as cursor scanning.
  const prisma = {
    message: {
      findMany: async (args: Prisma.MessageFindManyArgs) => {
        if (failures.tracks) throw new Error("database unavailable");
        trackQueries.push(args);
        return tracks.filter((row) => row.id < beforeId(args.where)).sort((a, b) => b.id - a.id).slice(0, args.take ?? Infinity);
      },
      findUnique: async ({ where }: { where: { id: number } }) => tracks.find((row) => row.id === where.id) ?? null
    },
    musicScore: {
      findMany: async (args: Prisma.MusicScoreFindManyArgs) => {
        scoreQueries.push(args);
        return scores.filter((row) => row.id < beforeId(args.where)).sort((a, b) => b.id - a.id).slice(0, args.take ?? Infinity);
      },
      findUnique: async (args: Prisma.MusicScoreFindUniqueArgs) => {
        scoreLookups.push(args);
        return scores.find((row) => row.id === args.where.id) ?? null;
      }
    }
  } as unknown as PrismaClient;
  return { tracks, scores, trackQueries, scoreQueries, scoreLookups, failures, prisma, catalog: createQuestionAssistantCatalog({ prisma, auth, publicOnly }) };
}

test("assistant catalog uses the library display title and never exposes physical filenames", async () => {
  const h = harness();
  const song = track(7, {
    fileName: "恩典之路.m4a", filePath: "a1bd4d96-uuid.m4a",
    payload: { lyricsText: "祢的恩典够我用，带我走过每一步", background: "关于在困境中信靠的诗歌", musicTrackTitle: "忽略过期提及标题" },
    musicScores: [{ id: 20, title: "恩典之路四部合唱谱", pages: [{ fileName: "song.pdf", filePath: "score-private-uuid.pdf" }] }]
  });
  h.tracks.push(song);
  h.scores.push(score(20, song, { title: "恩典之路四部合唱谱" }));
  const result = await h.catalog.search({ query: "恩典" });
  assert.equal(result.tracks[0].title, "恩典之路");
  assert.equal(result.scores[0].trackTitle, "恩典之路");
  assert.deepEqual(result.tracks[0].scores, [{ id: 20, title: "恩典之路四部合唱谱" }]);
  assert.ok(result.tracks[0].lyricsPreview.includes("祢的恩典够我用"));
  assert.equal(/uuid|\.m4a|filePath|fileName|过期提及标题/.test(JSON.stringify(result)), false);
  assert.equal((await h.catalog.getTrack(7))?.title, "恩典之路");
  assert.equal((await h.catalog.getScore(20))?.pages[0].filePath, "score-uuid-20.pdf");
});

test("assistant catalog observes additions, renames, deletion and changed access on every call", async () => {
  const h = harness();
  h.tracks.push(track(1, { fileName: "昨日诗歌.mp3" }));
  assert.deepEqual((await h.catalog.search({ kind: "tracks" })).tracks.map((item) => item.title), ["昨日诗歌"]);
  h.tracks[0].fileName = "今日诗歌.mp3";
  h.tracks.push(track(2, { fileName: "新歌.mp3" }));
  assert.deepEqual((await h.catalog.search({ kind: "tracks" })).tracks.map((item) => item.title), ["新歌", "今日诗歌"]);
  h.tracks[1].channel.isPrivate = true;
  assert.equal(await h.catalog.getTrack(2), null);
  h.tracks.splice(0, 1);
  assert.deepEqual((await h.catalog.search()).tracks, []);
  assert.equal(await h.catalog.getTrack(1), null);
  const independent = score(3, null);
  h.scores.push(independent);
  assert.ok(await h.catalog.getScore(3));
  independent.uploadedByAccountId = 20;
  assert.equal(await h.catalog.getScore(3), null);
});

test("catalog enforces public music sources and independent score ownership for search and by-id lookups", async () => {
  const h = harness();
  const publicSong = track(1);
  const privateSong = track(2, { channel: { kind: "music", isPrivate: true } });
  const chatSong = track(3, { channel: { kind: "standard", isPrivate: false } });
  const directSong = track(4, { channel: { kind: "direct", isPrivate: true } });
  const document = track(5, { fileName: "私密资料.txt" });
  const missingAudio = track(6, { filePath: null });
  const text = track(7, { type: "text" });
  h.tracks.push(publicSong, privateSong, chatSong, directSong, document, missingAudio, text);
  h.scores.push(
    score(1, publicSong), score(2, privateSong), score(3, chatSong), score(4, directSong),
    score(5, document), score(6, missingAudio), score(7, null), score(8, null, { uploadedByAccountId: 20 }),
    score(9, null, { pages: [] }), score(10, null, { trackId: 99 })
  );
  const invalidPage = score(11, publicSong);
  invalidPage.pages[0].fileName = "secret.txt";
  h.scores.push(invalidPage);
  const result = await h.catalog.search();
  assert.deepEqual(result.tracks.map((item) => item.id), [1]);
  assert.deepEqual(result.scores.map((item) => item.id), [7, 1]);
  for (const id of [2, 3, 4, 5, 6, 7]) assert.equal(await h.catalog.getTrack(id), null);
  for (const id of [2, 3, 4, 5, 6, 8, 9, 10, 11]) assert.equal(await h.catalog.getScore(id), null);
  assert.ok(h.trackQueries[0].where?.channel);
  assert.match(JSON.stringify(h.trackQueries[0].where), /"isPrivate":false/);
  assert.match(JSON.stringify(h.scoreQueries[0].where), /"uploadedByAccountId":10/);

  for (const managerAuth of [{ ...viewer, isAdmin: true }, { ...viewer, canPinMessages: true }]) {
    const manager = createQuestionAssistantCatalog({ prisma: h.prisma, auth: managerAuth });
    assert.ok(await manager.getScore(8));
    assert.equal(await manager.getScore(2), null);
    assert.equal(await manager.getScore(3), null);
  }
});

test("public-only catalogs keep standalone and private scores out of group answers for owners and managers", async () => {
  for (const auth of [viewer, { ...viewer, isAdmin: true }, { ...viewer, canPinMessages: true }]) {
    const h = harness(auth, true);
    const publicSong = track(1);
    const privateSong = track(2, { channel: { kind: "music", isPrivate: true } });
    h.tracks.push(publicSong, privateSong);
    h.scores.push(
      score(1, publicSong), score(2, null), score(3, null, { uploadedByAccountId: 20 }),
      score(4, privateSong), score(5, null, { trackId: 99 })
    );

    const results = await h.catalog.search();
    assert.deepEqual(results.tracks.map(item => item.id), [1]);
    assert.deepEqual(results.scores.map(item => item.id), [1]);
    assert.ok(await h.catalog.getScore(1));
    for (const id of [2, 3, 4, 5]) assert.equal(await h.catalog.getScore(id), null);
    const conditions = h.scoreQueries[0].where?.AND;
    assert.ok(Array.isArray(conditions));
    assert.deepEqual(conditions[0], { track: { is: {
      type: "file", channel: { kind: "music", isPrivate: false }, fileName: { not: null }, filePath: { not: null }
    } } });
    assert.deepEqual(h.scoreLookups[0].where, { id: 1, ...conditions[0] });

    // The same user's private conversation retains the library permissions.
    const privateCatalog = createQuestionAssistantCatalog({ prisma: h.prisma, auth, publicOnly: false });
    assert.ok(await privateCatalog.getScore(2));
    assert.equal(Boolean(await privateCatalog.getScore(3)), auth.isAdmin || auth.canPinMessages);
    assert.equal(await privateCatalog.getScore(4), null);
    const privateResults = await privateCatalog.search({ kind: "scores" });
    assert.deepEqual(privateResults.scores.map(item => item.id), auth.isAdmin || auth.canPinMessages ? [3, 2, 1] : [2, 1]);
  }
});

test("kind combines with title, lyrics, background and score queries, including timed lyrics", async () => {
  const h = harness();
  const song = track(5, {
    fileName: "祢的爱.mp3", payload: { background: "写给忧伤中寻找盼望的人" },
    musicLyrics: { fileName: "a.lrc", content: "[00:01.00]风雨之中赐我平安\n[00:05.00]祢的慈爱永远长存" },
    musicScores: [{ id: 8, title: "婚礼合唱版", pages: [{ fileName: "score.png", filePath: "score-uuid.png" }] }]
  });
  h.tracks.push(song);
  h.scores.push(score(8, song, { title: "婚礼合唱版" }));
  assert.equal((await h.catalog.search({ query: "平安", kind: "tracks" })).tracks[0].title, "祢的爱");
  assert.equal(h.scoreQueries.length, 0);
  assert.equal((await h.catalog.search({ query: "盼望", kind: "scores" })).scores[0].id, 8);
  assert.equal(h.trackQueries.length, 1);
  assert.equal((await h.catalog.search({ query: "祢的爱 平安", kind: "all" })).tracks.length, 1);
  assert.equal((await h.catalog.search({ query: "婚礼", kind: "tracks" })).tracks.length, 1);
  assert.equal((await h.catalog.search({ query: "祢的爱 不存在", kind: "all" })).tracks.length, 0);
  assert.equal((await h.catalog.search({ query: "physical-uuid", kind: "all" })).tracks.length, 0);
  const query = JSON.stringify(h.trackQueries[0].where);
  assert.match(query, /"path":"\$\.lyricsText"/);
  assert.match(query, /"path":"\$\.background"/);
  assert.match(query, /"content":\{"contains":"平安"\}/);
});

test("large catalogs search beyond the first database batch and paginate only usable matches", async () => {
  const h = harness();
  h.tracks.push(...Array.from({ length: 260 }, (_, index) => track(index + 1)));
  h.tracks[0].payload = { lyricsText: "稀有主题：彼此相爱" };
  h.scores.push(...Array.from({ length: 230 }, (_, index) => score(index + 1, null)));
  h.scores[0].title = "彼此相爱四部合唱谱";
  const result = await h.catalog.search({ query: "彼此相爱" });
  assert.deepEqual(result.tracks.map((item) => item.id), [1]);
  assert.deepEqual(result.scores.map((item) => item.id), [1]);
  assert.equal(result.hasMore, false);
  assert.ok(h.trackQueries.length >= 3);
  assert.ok(h.scoreQueries.length >= 3);

  h.tracks[259].filePath = null;
  const first = await h.catalog.search({ kind: "tracks", limit: 2 });
  const second = await h.catalog.search({ kind: "tracks", limit: 2, offset: first.nextOffset! });
  assert.deepEqual(first.tracks.map((item) => item.id), [259, 258]);
  assert.deepEqual(second.tracks.map((item) => item.id), [257, 256]);
  assert.equal(first.hasMore, true);
  assert.equal(first.nextOffset, 2);
});

test("catalog bounds model output and preserves search coverage for lyrics beyond the preview", async () => {
  const h = harness();
  const song = track(1, {
    payload: { lyricsText: `${"很长的歌词".repeat(2000)}末尾的盼望`, background: "背景".repeat(500) },
    musicScores: Array.from({ length: 35 }, (_, index) => ({
      id: index + 1, title: index === 34 ? "末页独唱谱" : `谱${index}`,
      pages: [{ fileName: "score.pdf", filePath: "hidden-uuid.pdf" }]
    }))
  });
  h.tracks.push(song);
  const result = await h.catalog.search({ query: "盼望" });
  assert.ok(result.tracks[0].lyricsPreview.includes("盼望"));
  assert.ok(result.tracks[0].lyricsPreview.length <= 482);
  assert.ok(result.tracks[0].backgroundPreview.length <= 242);
  assert.equal(result.tracks[0].scores.length, 20);
  assert.equal((await h.catalog.search({ query: "末页独唱谱", kind: "tracks" })).tracks[0].id, 1);
  assert.equal(JSON.stringify(result).includes("hidden-uuid"), false);
});

test("catalog validates query options and rejects malformed by-id requests before reading", async () => {
  const h = harness();
  for (const input of [
    { query: "长".repeat(201) }, { limit: 21 }, { limit: 0 }, { offset: -1 }, { offset: 1.5 }, { kind: "private" }, { arbitrary: "x" }
  ]) {
    await assert.rejects(() => h.catalog.search(input as Parameters<typeof h.catalog.search>[0]), z.ZodError);
  }
  for (const id of [0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(await h.catalog.getTrack(id), null);
    assert.equal(await h.catalog.getScore(id), null);
  }
  assert.equal(h.trackQueries.length, 0);
  assert.equal(h.scoreQueries.length, 0);
});

test("catalog propagates database failures instead of presenting an empty library", async () => {
  const h = harness();
  h.failures.tracks = true;
  await assert.rejects(() => h.catalog.search({ kind: "tracks" }), /database unavailable/);
});
