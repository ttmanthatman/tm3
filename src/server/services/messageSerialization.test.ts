import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import type { Actor, Message, MusicLyrics, MusicScore, MusicScorePage, PrismaClient } from "@prisma/client";
import type { AiSettingsDTO, AiSuggestionDTO, MusicPlaylistDTO, PrayerStatus } from "../../shared/types.js";
import { plainTextFromHtml, stripMarkdownSyntax } from "../textUtils.js";
import { createMessageSerializationService, type MessageSerializationDependencies } from "./messageSerialization.js";

function must<T>(value: T | undefined): T {
  assert.ok(value !== undefined);
  return value;
}

const VIEWER = 99;
const CHANNEL_ID = 7;

function makeActor(overrides: Partial<Actor> = {}): Actor {
  return {
    id: 1,
    kind: "user",
    username: "alice",
    displayName: "Alice",
    avatarPath: null,
    accountId: 11,
    status: "active",
    ...overrides
  } as unknown as Actor;
}

function makeMessage(overrides: Partial<Message> & { id: number; sender?: Actor }): Message & { sender: Actor } {
  const { sender, ...rest } = overrides;
  return {
    channelId: CHANNEL_ID,
    senderActorId: 1,
    type: "text",
    content: null,
    payload: null,
    fileName: null,
    filePath: null,
    fileSize: null,
    replyToId: null,
    chainRootId: null,
    chainVersion: 0,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    ...rest,
    sender: sender ?? makeActor()
  } as unknown as Message & { sender: Actor };
}

type PrayerActionRow = {
  messageId: number;
  accountId: number;
  prayedAt: Date;
  account: { displayName: string; avatarPath: string | null };
};

type AiSuggestionRow = {
  id: number;
  messageId: number;
  kind: string;
  status: string;
  references: unknown;
  responseText: string | null;
  createdAt: Date;
  model: string | null;
  createdBy: { displayName: string } | null;
};

function createHarness() {
  const queries: string[] = [];
  const playlistCalls: Array<{ id: number; viewerAccountId: number }> = [];
  const findUniqueIncludes: Array<Record<string, unknown>> = [];
  let loadAiSettingsCalls = 0;
  const state = {
    voiceListens: [] as Array<{ messageId: number; accountId: number }>,
    likes: new Map<number, Array<{ accountId: number; account: { displayName: string; avatarPath: string | null } }>>(),
    favorites: new Map<number, Array<{ accountId: number }>>(),
    scores: [] as Array<MusicScore & { pages: MusicScorePage[] }>,
    lyrics: new Map<number, MusicLyrics>(),
    prayerActions: [] as PrayerActionRow[],
    aiSuggestions: [] as AiSuggestionRow[],
    messagesById: new Map<number, Message>(),
    playlists: new Map<number, unknown>()
  };
  function counted<TArgs extends unknown[], TResult>(name: string, impl: (...args: TArgs) => TResult) {
    return (...args: TArgs): TResult => {
      queries.push(name);
      return impl(...args);
    };
  }
  function idFilter(input: number | { in: number[] }) {
    return typeof input === "object" ? input.in : [input];
  }
  const prisma = {
    voiceListen: {
      findUnique: counted("voiceListen.findUnique", async ({ where }: { where: { messageId_accountId: { messageId: number; accountId: number } } }) =>
        state.voiceListens.find((row) => row.messageId === where.messageId_accountId.messageId && row.accountId === where.messageId_accountId.accountId) ?? null),
      findMany: counted("voiceListen.findMany", async ({ where }: { where: { accountId: number; messageId: { in: number[] } } }) =>
        state.voiceListens.filter((row) => row.accountId === where.accountId && where.messageId.in.includes(row.messageId)).map((row) => ({ messageId: row.messageId })))
    },
    messageLike: {
      findMany: counted("messageLike.findMany", async ({ where }: { where: { messageId: number } }) => state.likes.get(where.messageId) ?? [])
    },
    messageFavorite: {
      findMany: counted("messageFavorite.findMany", async ({ where }: { where: { messageId: number } }) => state.favorites.get(where.messageId) ?? [])
    },
    musicScore: {
      findMany: counted("musicScore.findMany", async ({ where }: { where: { trackId: number | { in: number[] } } }) => {
        const ids = idFilter(where.trackId);
        return state.scores.filter((row) => row.trackId !== null && ids.includes(row.trackId));
      })
    },
    musicLyrics: {
      findUnique: counted("musicLyrics.findUnique", async ({ where }: { where: { trackId: number } }) => state.lyrics.get(where.trackId) ?? null),
      findMany: counted("musicLyrics.findMany", async ({ where }: { where: { trackId: { in: number[] } } }) =>
        [...state.lyrics.values()].filter((row) => row.trackId !== null && where.trackId.in.includes(row.trackId)))
    },
    message: {
      findFirst: counted("message.findFirst", async ({ where }: { where: { id: number; channelId: number; type: string } }) => {
        const row = state.messagesById.get(where.id);
        return row && row.channelId === where.channelId && row.type === where.type ? row : null;
      }),
      findMany: counted("message.findMany", async ({ where }: { where: { id: { in: number[] }; channelId: number; type: string } }) =>
        where.id.in
          .map((id) => state.messagesById.get(id))
          .filter((row): row is Message => !!row && row.channelId === where.channelId && row.type === where.type)),
      findUnique: counted("message.findUnique", async ({ where, include }: { where: { id: number }; include?: Record<string, unknown> }) => {
        if (include) findUniqueIncludes.push(include);
        return state.messagesById.get(where.id) ?? null;
      })
    },
    prayerAction: {
      findMany: counted("prayerAction.findMany", async ({ where }: { where: { messageId: number | { in: number[] } } }) => {
        const ids = idFilter(where.messageId);
        return state.prayerActions.filter((row) => ids.includes(row.messageId)).sort((a, b) => b.prayedAt.getTime() - a.prayedAt.getTime());
      })
    },
    messageAiSuggestion: {
      findMany: counted(
        "messageAiSuggestion.findMany",
        async ({ where, take }: { where: { messageId: number | { in: number[] }; kind: string; status: string }; take?: number }) => {
          const ids = idFilter(where.messageId);
          const rows = state.aiSuggestions
            .filter((row) => ids.includes(row.messageId) && row.kind === where.kind && row.status === where.status)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          return take ? rows.slice(0, take) : rows;
        }
      ),
      count: counted("messageAiSuggestion.count", async ({ where }: { where: { messageId: number; kind: string; status: string } }) =>
        state.aiSuggestions.filter((row) => row.messageId === where.messageId && row.kind === where.kind && row.status === where.status).length)
    }
  } as unknown as PrismaClient;
  const aiSettings: AiSettingsDTO = {
    enabled: true,
    apiKeyConfigured: false,
    baseUrl: "",
    model: "test-model",
    promptCommand: "",
    cardCooldownSeconds: 0,
    userLimitPerMinute: 0,
    maxSuccessPerMessage: 3
  };
  const deps: MessageSerializationDependencies = {
    prisma,
    musicService: {
      playlistDto: async (id: number, viewerAccountId: number) => {
        playlistCalls.push({ id, viewerAccountId });
        return (state.playlists.get(id) ?? null) as Awaited<ReturnType<MessageSerializationDependencies["musicService"]["playlistDto"]>>;
      }
    },
    loadAiSettings: async () => {
      loadAiSettingsCalls += 1;
      return { value: aiSettings, encryptedApiKey: "", loadedAt: 0 };
    },
    serializeAiSuggestion: (row): AiSuggestionDTO => ({
      id: row.id,
      kind: "prayer_related_verses",
      status: row.status === "failed" ? "failed" : "success",
      references: Array.isArray(row.references) ? row.references.map(String).filter(Boolean).slice(0, 3) : [],
      responseText: row.responseText || "",
      createdByName: row.createdBy?.displayName || null,
      createdAt: row.createdAt.toISOString(),
      model: row.model
    }),
    plainTextFromHtml,
    stripMarkdownSyntax,
    prayerPayloadRaw: (input) => (input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {}),
    sourcePrayerMessageId: (input, fallback) => {
      const raw = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
      const sourceId = Number(raw.sourcePrayerMessageId || 0);
      return Number.isFinite(sourceId) && sourceId > 0 ? sourceId : fallback;
    },
    cleanPrayerStatus: (input): PrayerStatus => (input === "closed" || input === "answered" ? input : "active"),
    isVoiceMessage: (message) => {
      const payload = message.payload as { kind?: unknown } | null;
      return message.type === "file" && payload?.kind === "voice" && deps.isAudioFileName(message.fileName);
    },
    isAudioFileName: (name) => /\.(webm|mp3|m4a|wav|ogg|aac|mp4)$/i.test(name || "")
  };
  return {
    state,
    queries,
    playlistCalls,
    findUniqueIncludes,
    loadAiSettingsCallCount: () => loadAiSettingsCalls,
    service: createMessageSerializationService(deps)
  };
}

function makeScore(trackId: number, pageFileName: string): MusicScore & { pages: MusicScorePage[] } {
  return {
    id: trackId * 10,
    trackId,
    title: "赞美诗",
    pages: [
      {
        id: trackId * 100,
        scoreId: trackId * 10,
        pageIndex: 0,
        fileName: pageFileName,
        filePath: pageFileName,
        fileSize: 123,
        width: 800,
        height: 600
      } as unknown as MusicScorePage
    ]
  } as unknown as MusicScore & { pages: MusicScorePage[] };
}

function makeLyrics(trackId: number): MusicLyrics {
  return { id: trackId * 10, trackId, fileName: "song.lrc", content: "[00:01.00]第一句歌词" } as unknown as MusicLyrics;
}

function voiceMessage(id: number, senderAccountId: number) {
  return makeMessage({
    id,
    type: "file",
    fileName: "voice.webm",
    payload: { kind: "voice" },
    sender: makeActor({ id: id + 1000, accountId: senderAccountId, displayName: `用户${senderAccountId}` })
  });
}

test("serializes a plain text message with empty reactions and no optional fields", async () => {
  const harness = createHarness();
  const message = makeMessage({ id: 1, content: "你好" });
  const dto = await harness.service.serializeMessage(message, VIEWER);
  assert.equal(dto.id, 1);
  assert.equal(dto.channelId, CHANNEL_ID);
  assert.equal(dto.content, "你好");
  assert.deepEqual(dto.sender, { id: 1, kind: "user", username: "alice", displayName: "Alice", avatarPath: null });
  assert.equal(dto.voiceListened, undefined);
  assert.equal(dto.replyTo, null);
  assert.deepEqual(must(dto.scores), []);
  assert.equal(dto.lyrics, null);
  assert.deepEqual(dto.reactions, { likeCount: 0, likedBy: [], favoriteCount: 0, currentUserLiked: false, currentUserFavorited: false });
  assert.ok(!("musicPlaylist" in dto));
  assert.equal(dto.createdAt, "2026-09-01T00:00:00.000Z");
  assert.deepEqual(harness.queries, ["messageLike.findMany", "messageFavorite.findMany"]);
});

test("renders the reply preview as capped plain text with the sender name", async () => {
  const harness = createHarness();
  const replyTarget = makeMessage({
    id: 2,
    content: `<p>**加粗** ${"长".repeat(200)}</p>`,
    sender: makeActor({ id: 2, displayName: "Bob" })
  });
  const message = makeMessage({ id: 3, content: "回复", replyToId: 2 });
  (message as Message & { sender: Actor; replyTo?: Message & { sender: Actor } }).replyTo = replyTarget;
  const dto = await harness.service.serializeMessage(message, VIEWER);
  assert.ok(dto.replyTo);
  assert.equal(dto.replyTo.id, 2);
  assert.equal(dto.replyTo.senderName, "Bob");
  assert.equal(dto.replyTo.type, "text");
  assert.ok(dto.replyTo.content.length <= 140);
  assert.ok(!dto.replyTo.content.includes("<p>") && !dto.replyTo.content.includes("**"));
});

test("voice listen state covers own messages, lookup, attached, and batch paths", async () => {
  const harness = createHarness();
  harness.state.voiceListens.push({ messageId: 12, accountId: VIEWER });

  const own = await harness.service.serializeMessage(voiceMessage(10, VIEWER), VIEWER);
  assert.equal(own.voiceListened, true);
  assert.deepEqual(harness.queries, ["messageLike.findMany", "messageFavorite.findMany", "musicScore.findMany", "musicLyrics.findUnique"]);

  harness.queries.length = 0;
  const unheard = await harness.service.serializeMessage(voiceMessage(11, 42), VIEWER);
  assert.equal(unheard.voiceListened, false);
  assert.ok(harness.queries.includes("voiceListen.findUnique"));

  harness.queries.length = 0;
  const attached = voiceMessage(12, 42) as Message & { sender: Actor; voiceListens?: Array<{ id: number }> };
  attached.voiceListens = [{ id: 1 }];
  const attachedDto = await harness.service.serializeMessage(attached, VIEWER);
  assert.equal(attachedDto.voiceListened, true);
  assert.ok(!harness.queries.includes("voiceListen.findUnique"));

  harness.queries.length = 0;
  const batch = { voiceListenedMessageIds: new Set([12]) };
  const batched = await harness.service.serializeMessage(voiceMessage(12, 42), VIEWER, batch);
  assert.equal(batched.voiceListened, true);
  const batchedOut = await harness.service.serializeMessage(voiceMessage(13, 42), VIEWER, batch);
  assert.equal(batchedOut.voiceListened, false);
  assert.ok(!harness.queries.includes("voiceListen.findUnique"));

  const noViewer = await harness.service.serializeMessage(voiceMessage(14, 42));
  assert.equal(noViewer.voiceListened, false);
});

test("music track messages expose scores and parsed lyrics", async () => {
  const harness = createHarness();
  harness.state.scores.push(makeScore(20, "page-1.png"), makeScore(21, "page-1.pdf"));
  harness.state.lyrics.set(20, makeLyrics(20));
  const withScore = makeMessage({ id: 20, type: "file", fileName: "song.mp3" });
  const dto = await harness.service.serializeMessage(withScore, VIEWER);
  assert.deepEqual(harness.queries, ["messageLike.findMany", "messageFavorite.findMany", "musicScore.findMany", "musicLyrics.findUnique"]);
  assert.equal(must(dto.scores).length, 1);
  assert.equal(must(dto.scores)[0]?.kind, "image");
  assert.equal(must(dto.scores)[0]?.pages[0]?.fileName, "page-1.png");
  assert.ok(dto.lyrics);
  assert.equal(dto.lyrics.fileName, "song.lrc");
  assert.equal(dto.lyrics.cues.length, 1);
  assert.equal(dto.lyrics.cues[0]?.text, "第一句歌词");

  const pdfScore = await harness.service.serializeMessage(makeMessage({ id: 21, type: "file", fileName: "other.m4a" }), VIEWER);
  assert.equal(must(pdfScore.scores)[0]?.kind, "pdf");
  assert.equal(pdfScore.lyrics, null);

  const imageMessage = await harness.service.serializeMessage(makeMessage({ id: 22, type: "image", fileName: "photo.png" }), VIEWER);
  assert.deepEqual(imageMessage.scores, []);
  assert.equal(imageMessage.lyrics, null);
});

test("prayer payload aggregates actions, AI suggestions, and viewer state", async () => {
  const harness = createHarness();
  const prayedAt = new Date("2026-09-02T08:00:00.000Z");
  harness.state.prayerActions.push(
    { messageId: 30, accountId: 42, prayedAt, account: { displayName: "王刚", avatarPath: "a.webp" } },
    { messageId: 30, accountId: 42, prayedAt: new Date("2026-09-03T08:00:00.000Z"), account: { displayName: "王刚", avatarPath: "a.webp" } },
    { messageId: 30, accountId: VIEWER, prayedAt: new Date("2026-09-01T08:00:00.000Z"), account: { displayName: "访客", avatarPath: null } }
  );
  for (let index = 0; index < 5; index += 1) {
    harness.state.aiSuggestions.push({
      id: index + 1,
      messageId: 30,
      kind: "prayer_related_verses",
      status: "success",
      references: [`约翰福音 3:${16 + index}`],
      responseText: null,
      createdAt: new Date(`2026-09-0${index + 1}T00:00:00.000Z`),
      model: "test-model",
      createdBy: { displayName: "助手" }
    });
  }
  const prayer = makeMessage({ id: 30, type: "prayer", content: "为家人祷告", payload: { kind: "prayer", status: "unknown-value" } });
  const dto = await harness.service.serializeMessage(prayer, VIEWER);
  const payload = dto.payload as Record<string, unknown>;
  assert.equal(payload.kind, "prayer");
  assert.equal(payload.status, "active");
  assert.equal(payload.prayerCount, 2);
  assert.equal(payload.prayerActionCount, 3);
  assert.equal(payload.currentUserPrayed, true);
  const prayedBy = payload.prayedBy as Array<{ accountId: number; times: number; latestPrayedAt: string }>;
  assert.equal(prayedBy.find((entry) => entry.accountId === 42)?.times, 2);
  assert.equal(prayedBy.find((entry) => entry.accountId === 42)?.latestPrayedAt, "2026-09-03T08:00:00.000Z");
  const suggestions = payload.aiSuggestions as AiSuggestionDTO[];
  assert.equal(suggestions.length, 3);
  assert.equal(suggestions[0]?.createdByName, "助手");
  assert.equal(payload.aiSuggestionSuccessCount, 5);
  assert.equal(payload.aiSuggestionMaxSuccess, 3);

  const otherViewer = await harness.service.serializeMessage(prayer, 12345);
  assert.equal((otherViewer.payload as Record<string, unknown>).currentUserPrayed, false);
});

test("prayer updates merge the source message and fall back when the source is gone", async () => {
  const harness = createHarness();
  const source = makeMessage({
    id: 40,
    type: "prayer",
    content: "原祷告",
    payload: { kind: "prayer", status: "answered" }
  });
  harness.state.messagesById.set(40, source);
  harness.state.prayerActions.push({ messageId: 40, accountId: 42, prayedAt: new Date("2026-09-02T00:00:00.000Z"), account: { displayName: "王刚", avatarPath: null } });
  const update = makeMessage({
    id: 41,
    type: "prayer",
    content: "更新",
    payload: { kind: "prayer", status: "active", sourcePrayerMessageId: 40, latestUpdateAt: "2026-09-04T00:00:00.000Z", latestUpdateBy: "Alice" }
  });
  const dto = await harness.service.serializeMessage(update, VIEWER);
  const payload = dto.payload as Record<string, unknown>;
  assert.equal(payload.status, "answered");
  assert.equal(payload.sourcePrayerMessageId, 40);
  assert.equal(payload.latestUpdateAt, "2026-09-04T00:00:00.000Z");
  assert.equal(payload.latestUpdateBy, "Alice");
  assert.equal(payload.prayerActionCount, 1);
  assert.ok(harness.queries.includes("message.findFirst"));

  harness.queries.length = 0;
  const orphan = makeMessage({ id: 42, type: "prayer", payload: { kind: "prayer", sourcePrayerMessageId: 999 } });
  const orphanDto = await harness.service.serializeMessage(orphan, VIEWER);
  const orphanPayload = orphanDto.payload as Record<string, unknown>;
  assert.equal(orphanPayload.sourcePrayerMessageId, 999);
  assert.equal(orphanPayload.prayerActionCount, 0);
});

test("shared playlists resolve through the music service for the current viewer", async () => {
  const harness = createHarness();
  const playlist = { id: 55, name: "敬拜歌单", tracks: [] } as unknown as MusicPlaylistDTO;
  harness.state.playlists.set(55, playlist);
  const message = makeMessage({ id: 50, type: "music_playlist", payload: { playlistId: 55 } });
  const dto = await harness.service.serializeMessage(message, VIEWER);
  assert.deepEqual(dto.musicPlaylist, playlist);
  assert.deepEqual(harness.playlistCalls, [{ id: 55, viewerAccountId: VIEWER }]);

  const missing = await harness.service.serializeMessage(makeMessage({ id: 51, type: "music_playlist", payload: { playlistId: 77 } }), VIEWER);
  assert.equal(missing.musicPlaylist, null);

  const withBatch = await harness.service.serializeMessage(message, VIEWER, { playlists: new Map([[55, playlist]]) });
  assert.equal(withBatch.musicPlaylist, playlist);
  assert.equal(harness.playlistCalls.length, 2);
});

test("reactions reflect likes, favorites, and viewer-specific flags", async () => {
  const harness = createHarness();
  harness.state.likes.set(60, [
    { accountId: 42, account: { displayName: "王刚", avatarPath: null } },
    { accountId: VIEWER, account: { displayName: "访客", avatarPath: "v.webp" } }
  ]);
  harness.state.favorites.set(60, [{ accountId: 42 }]);
  const message = makeMessage({ id: 60, content: "见证" });
  const dto = await harness.service.serializeMessage(message, VIEWER);
  assert.equal(must(dto.reactions).likeCount, 2);
  assert.deepEqual(
    must(dto.reactions).likedBy,
    [
      { accountId: 42, displayName: "王刚", avatarPath: null },
      { accountId: VIEWER, displayName: "访客", avatarPath: "v.webp" }
    ]
  );
  assert.equal(must(dto.reactions).favoriteCount, 1);
  assert.equal(must(dto.reactions).currentUserLiked, true);
  assert.equal(must(dto.reactions).currentUserFavorited, false);

  const otherViewer = await harness.service.serializeMessage(message, 42);
  assert.equal(must(otherViewer.reactions).currentUserLiked, true);
  assert.equal(must(otherViewer.reactions).currentUserFavorited, true);

  const anonymous = await harness.service.serializeMessage(message);
  assert.equal(must(anonymous.reactions).currentUserLiked, false);
  assert.equal(must(anonymous.reactions).currentUserFavorited, false);
});

test("hydrateMessage loads relations in one findUnique and serializes without follow-up queries", async () => {
  const harness = createHarness();
  const stored = voiceMessage(70, 42) as Message & { sender: Actor } & {
    replyTo?: null;
    likes?: unknown[];
    favorites?: unknown[];
    musicScores?: unknown[];
    musicLyrics?: unknown;
    voiceListens?: Array<{ id: number }>;
  };
  // Mirrors the rows Prisma returns with hydrateMessage's include clause.
  stored.replyTo = null;
  stored.likes = [{ accountId: VIEWER, account: { displayName: "访客", avatarPath: null } }];
  stored.favorites = [];
  stored.musicScores = [makeScore(70, "p.png")];
  stored.musicLyrics = makeLyrics(70);
  stored.voiceListens = [{ id: 1 }];
  harness.state.messagesById.set(70, stored);

  const dto = await harness.service.hydrateMessage(70, VIEWER);
  assert.ok(dto);
  assert.equal(dto.voiceListened, true);
  assert.equal(must(dto.reactions).likeCount, 1);
  assert.equal(must(dto.reactions).currentUserLiked, true);
  assert.equal(must(dto.scores).length, 1);
  assert.equal(dto.lyrics?.fileName, "song.lrc");
  assert.deepEqual(harness.queries, ["message.findUnique"]);
  const include = harness.findUniqueIncludes[0];
  assert.ok(include);
  for (const key of ["sender", "replyTo", "likes", "favorites", "musicScores", "musicLyrics", "voiceListens"]) {
    assert.ok(key in include, `missing include: ${key}`);
  }

  harness.findUniqueIncludes.length = 0;
  const anonymous = await harness.service.hydrateMessage(70);
  assert.ok(anonymous);
  assert.ok(!("voiceListens" in (harness.findUniqueIncludes[0] ?? {})));

  const missing = await harness.service.hydrateMessage(404, VIEWER);
  assert.equal(missing, null);
});

function buildFeatureRows(harness: ReturnType<typeof createHarness>, groups: number) {
  const rows: Array<Message & { sender: Actor }> = [];
  let id = 100;
  for (let group = 0; group < groups; group += 1) {
    const voice = voiceMessage(id++, 42);
    harness.state.voiceListens.push({ messageId: voice.id, accountId: VIEWER });
    rows.push(voice);

    const track = makeMessage({ id: id++, type: "file", fileName: "song.mp3" });
    harness.state.scores.push(makeScore(track.id, "page.png"));
    harness.state.lyrics.set(track.id, makeLyrics(track.id));
    rows.push(track);

    const source = makeMessage({ id: id++, type: "prayer", content: "原祷告", payload: { kind: "prayer", status: "active" } });
    harness.state.messagesById.set(source.id, source);
    const prayer = makeMessage({ id: id++, type: "prayer", content: "更新", payload: { kind: "prayer", sourcePrayerMessageId: source.id } });
    harness.state.prayerActions.push({
      messageId: source.id,
      accountId: 42,
      prayedAt: new Date("2026-09-02T00:00:00.000Z"),
      account: { displayName: "王刚", avatarPath: null }
    });
    harness.state.aiSuggestions.push({
      id: prayer.id,
      messageId: source.id,
      kind: "prayer_related_verses",
      status: "success",
      references: ["诗篇 23:1"],
      responseText: null,
      createdAt: new Date("2026-09-02T00:00:00.000Z"),
      model: "test-model",
      createdBy: null
    });
    rows.push(prayer);

    const playlist = { id: 500 + group, name: `歌单${group}`, tracks: [] };
    harness.state.playlists.set(playlist.id, playlist);
    rows.push(makeMessage({ id: id++, type: "music_playlist", payload: { playlistId: playlist.id } }));

    const graceVoice = voiceMessage(id++, 42);
    harness.state.messagesById.set(graceVoice.id, graceVoice);
    rows.push(makeMessage({ id: id++, type: "grace", content: "恩典记录", payload: { kind: "grace", voiceMessageId: graceVoice.id } }));
  }
  // The list route preloads reactions; mirror that so serialization stays batched.
  return rows.map((row) => Object.assign(row, { likes: [], favorites: [] }));
}

test("batch and per-message serialization produce identical DTOs", async () => {
  const batchedHarness = createHarness();
  const batchedRows = buildFeatureRows(batchedHarness, 2);
  const batch = await batchedHarness.service.buildMessageSerializeBatch(batchedRows, CHANNEL_ID, VIEWER);
  const batchedDtos = await Promise.all(batchedRows.map((row) => batchedHarness.service.serializeMessage(row, VIEWER, batch)));

  const singleHarness = createHarness();
  const singleRows = buildFeatureRows(singleHarness, 2);
  const singleDtos = await Promise.all(singleRows.map((row) => singleHarness.service.serializeMessage(row, VIEWER)));

  assert.deepEqual(batchedDtos, singleDtos);
});

test("batched page serialization keeps the query count constant as page size grows", async () => {
  async function renderPage(groups: number) {
    const harness = createHarness();
    const rows = buildFeatureRows(harness, groups);
    const batch = await harness.service.buildMessageSerializeBatch(rows, CHANNEL_ID, VIEWER);
    const dtos = await Promise.all(rows.map((row) => harness.service.serializeMessage(row, VIEWER, batch)));
    return { queries: [...harness.queries], dtos, loadAiSettingsCalls: harness.loadAiSettingsCallCount() };
  }
  const small = await renderPage(1);
  const large = await renderPage(4);
  assert.equal(small.dtos.length, 5);
  assert.equal(large.dtos.length, 20);
  assert.deepEqual([...new Set(large.queries)].sort(), [...new Set(small.queries)].sort());
  assert.equal(large.queries.length, small.queries.length);
  for (const banned of ["voiceListen.findUnique", "messageLike.findMany", "messageFavorite.findMany", "message.findFirst", "musicLyrics.findUnique", "messageAiSuggestion.count"]) {
    assert.ok(!large.queries.includes(banned), `per-message query leaked into batch path: ${banned}`);
  }
  assert.equal(large.loadAiSettingsCalls, 1);
});

const indexSource = fs.readFileSync(new URL("../index.ts", import.meta.url), "utf8");

test("index.ts consumes the shared serialization service as the single implementation", () => {
  assert.match(indexSource, /import \{ createMessageSerializationService \} from "\.\/services\/messageSerialization\.js";/);
  assert.match(indexSource, /const messageSerializationService = createMessageSerializationService\(\{/);
  assert.match(indexSource, /const \{ serializeMessage, hydrateMessage, buildMessageSerializeBatch \} = messageSerializationService;/);
  assert.doesNotMatch(indexSource, /^async function serializeMessage/m);
  assert.doesNotMatch(indexSource, /^async function hydrateMessage/m);
  assert.doesNotMatch(indexSource, /^async function buildMessageSerializeBatch/m);
  assert.doesNotMatch(indexSource, /^type MessageSerializeBatch = \{/m);
});

test("the list route and dependent route modules go through the shared serializer", () => {
  const route = indexSource.match(/app\.get\("\/api\/messages"[\s\S]*?return \{ messages \};/);
  assert.ok(route);
  assert.match(route[0], /await buildMessageSerializeBatch\(orderedRows, channelId, auth\.accountId\)/);
  assert.match(route[0], /serializeMessage\(message, auth\.accountId, batch\)/);
  assert.match(indexSource, /registerMusicRoutes\(app, \{[\s\S]*?serializeMessage,[\s\S]*?hydrateMessage,/);
  assert.match(indexSource, /registerBibleRoutes\(app, \{[\s\S]*?hydrateMessage/);
});

test("grace messages assemble the referenced voice payload including transcript", async () => {
  const harness = createHarness();
  const source = makeMessage({
    id: 301,
    type: "file",
    fileName: "voice.m4a",
    payload: { kind: "voice", durationMs: 1500, waveform: [0.2, 0.8], mimeType: "audio/mp4", transcript: "语音文字", transcriptAt: "2026-09-17T01:00:00.000Z" }
  });
  harness.state.messagesById.set(source.id, source);
  const grace = makeMessage({ id: 302, type: "grace", content: "恩典", payload: { kind: "grace", voiceMessageId: source.id, imageMessageId: 88 } });
  const dto = await harness.service.serializeMessage(grace, VIEWER);
  const payload = dto.payload as Record<string, unknown>;
  assert.equal(payload.kind, "grace");
  assert.equal(payload.voiceMessageId, source.id);
  assert.equal(payload.imageMessageId, 88);
  assert.deepEqual(payload.voice, {
    kind: "voice",
    durationMs: 1500,
    waveform: [0.2, 0.8],
    mimeType: "audio/mp4",
    transcript: "语音文字"
  });
  assert.ok(harness.queries.includes("message.findFirst"));
});

test("grace messages without a voice source serialize voice as null", async () => {
  const harness = createHarness();
  const grace = makeMessage({ id: 303, type: "grace", content: "纯文字恩典", payload: { kind: "grace" } });
  const dto = await harness.service.serializeMessage(grace, VIEWER);
  const payload = dto.payload as Record<string, unknown>;
  assert.equal(payload.kind, "grace");
  assert.equal(payload.voice, null);
});

test("grace voice source lookup stays batched in list serialization", async () => {
  const harness = createHarness();
  const source = makeMessage({ id: 311, type: "file", fileName: "voice.m4a", payload: { kind: "voice", durationMs: 900 } });
  harness.state.messagesById.set(source.id, source);
  const rows = [1, 2].map((offset) =>
    Object.assign(makeMessage({ id: 312 + offset, type: "grace", content: "恩典", payload: { kind: "grace", voiceMessageId: source.id } }), {
      likes: [],
      favorites: []
    })
  );
  const batch = await harness.service.buildMessageSerializeBatch(rows, CHANNEL_ID, VIEWER);
  const dtos = await Promise.all(rows.map((row) => harness.service.serializeMessage(row, VIEWER, batch)));
  for (const dto of dtos) {
    const payload = dto.payload as Record<string, unknown>;
    assert.deepEqual(payload.voice, { kind: "voice", durationMs: 900 });
  }
  assert.ok(harness.queries.includes("message.findMany"));
  assert.ok(!harness.queries.includes("message.findFirst"), "per-message grace lookup leaked into batch path");
});

test("voice message payloads keep transcript fields through serialization", async () => {
  const harness = createHarness();
  const voice = makeMessage({
    id: 321,
    type: "file",
    fileName: "voice.m4a",
    payload: { kind: "voice", durationMs: 700, transcript: "保留的文字", transcriptAt: "2026-09-17T02:00:00.000Z" }
  });
  const dto = await harness.service.serializeMessage(voice, VIEWER);
  const payload = dto.payload as Record<string, unknown>;
  assert.equal(payload.transcript, "保留的文字");
  assert.equal(payload.transcriptAt, "2026-09-17T02:00:00.000Z");
});
