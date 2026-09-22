import type { Actor, Account, Message, MessageAiSuggestion, MusicLyrics, MusicScore, MusicScorePage, PrayerAction, PrismaClient } from "@prisma/client";
import type { AiSettingsDTO, AiSuggestionDTO, MessageDTO, PrayerStatus, VoicePayload } from "../../shared/types.js";
import { AI_RELATED_VERSES_KIND } from "../aiSettings.js";
import { parseLyrics } from "../srt.js";
import type { MusicService } from "./musicService.js";

type AiSettingsCache = { value: AiSettingsDTO; encryptedApiKey: string; loadedAt: number };

type SerializeAiSuggestionRow = {
  id: number;
  kind: string;
  status: string;
  references: unknown;
  responseText?: string | null;
  createdAt: Date;
  model?: string | null;
  createdBy?: { displayName: string } | null;
};

export type MessageSerializationDependencies = {
  prisma: PrismaClient;
  musicService: Pick<MusicService, "playlistDto">;
  loadAiSettings(): Promise<AiSettingsCache>;
  serializeAiSuggestion(row: SerializeAiSuggestionRow): AiSuggestionDTO;
  plainTextFromHtml(input?: string | null, maxLength?: number): string;
  stripMarkdownSyntax(input?: string | null): string;
  prayerPayloadRaw(input: unknown): Record<string, unknown>;
  sourcePrayerMessageId(input: unknown, fallback: number): number;
  cleanPrayerStatus(input: unknown): PrayerStatus;
  isVoiceMessage(message: Pick<Message, "type" | "fileName" | "payload">): boolean;
  isAudioFileName(name?: string | null): boolean;
};

// Optional prefetched context for list serialization. Endpoints that render a
// page of messages build this once so per-type relations (voice listens,
// prayer actions/AI suggestions, shared playlists) cost a constant number of
// queries instead of scaling with the page size. Single-message callers
// (socket emits, mutations) omit it and keep the per-message lookups.
export type MessageSerializeBatch = {
  voiceListenedMessageIds?: Set<number>;
  chainOwnerActorIds?: Map<number, number>;
  prayer?: {
    aiSettings: Awaited<ReturnType<MessageSerializationDependencies["loadAiSettings"]>>;
    sourceMessages: Map<number, Message | null>;
    actionsByMessageId: Map<number, Array<PrayerAction & { account: Pick<Account, "displayName" | "avatarPath"> }>>;
    aiSuggestionsByMessageId: Map<number, Array<MessageAiSuggestion & { createdBy: Pick<Account, "displayName"> | null }>>;
    aiSuggestionCountsByMessageId: Map<number, number>;
  };
  grace?: {
    voiceSourceMessages: Map<number, Message | null>;
    sourceMessages: Map<number, Message | null>;
    actionsByMessageId: Map<number, Array<PrayerAction & { account: Pick<Account, "displayName" | "avatarPath"> }>>;
    aiSuggestionsByMessageId: Map<number, Array<MessageAiSuggestion & { createdBy: Pick<Account, "displayName"> | null }>>;
    aiSuggestionCountsByMessageId: Map<number, number>;
    aiSettings: Awaited<ReturnType<MessageSerializationDependencies["loadAiSettings"]>>;
  };
  playlists?: Map<number, Awaited<ReturnType<MusicService["playlistDto"]>>>;
};

export type MessageSerializationService = {
  serializeMessage(
    message: Message & { sender: Actor; replyTo?: (Message & { sender: Actor }) | null },
    viewerAccountId?: number,
    batch?: MessageSerializeBatch
  ): Promise<MessageDTO>;
  hydrateMessage(id: number, viewerAccountId?: number): Promise<MessageDTO | null>;
  buildMessageSerializeBatch(rows: Array<Message & { sender: Actor }>, channelId: number, viewerAccountId: number): Promise<MessageSerializeBatch>;
};

export function createMessageSerializationService(deps: MessageSerializationDependencies): MessageSerializationService {
  const {
    prisma,
    musicService,
    loadAiSettings,
    serializeAiSuggestion,
    plainTextFromHtml,
    stripMarkdownSyntax,
    prayerPayloadRaw,
    sourcePrayerMessageId,
    cleanPrayerStatus,
    isVoiceMessage,
    isAudioFileName
  } = deps;

  function plainTextPreview(input?: string | null, maxLength = 80) {
    const text = stripMarkdownSyntax(plainTextFromHtml(input, 4000));
    return text.slice(0, maxLength);
  }

  function gracePayloadRaw(input: unknown) {
    return input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  }

  function sourceGraceMessageId(input: unknown, fallback: number) {
    const sourceId = Number(gracePayloadRaw(input).sourceGraceMessageId || 0);
    return Number.isFinite(sourceId) && sourceId > 0 ? sourceId : fallback;
  }

  async function serializeMessage(
    message: Message & { sender: Actor; replyTo?: (Message & { sender: Actor }) | null },
    viewerAccountId?: number,
    batch?: MessageSerializeBatch
  ): Promise<MessageDTO> {
    let voiceListened: boolean | undefined;
    if (isVoiceMessage(message)) {
      voiceListened = message.sender.accountId === viewerAccountId;
      if (!voiceListened && viewerAccountId) {
        const attachedListens = (message as typeof message & { voiceListens?: Array<{ id: number }> }).voiceListens;
        if (batch?.voiceListenedMessageIds) {
          voiceListened = batch.voiceListenedMessageIds.has(message.id);
        } else if (attachedListens) {
          voiceListened = attachedListens.length > 0;
        } else {
          const listened = await prisma.voiceListen.findUnique({ where: { messageId_accountId: { messageId: message.id, accountId: viewerAccountId } } });
          voiceListened = !!listened;
        }
      }
    }
    let payload: unknown = message.payload || undefined;
    const loadedReactions = message as typeof message & {
      likes?: Array<{ accountId: number; account: Pick<Account, "displayName" | "avatarPath"> }>;
      favorites?: Array<{ accountId: number }>;
    };
    const [likes, favorites] = await Promise.all([
      loadedReactions.likes
        ? Promise.resolve(loadedReactions.likes)
        : prisma.messageLike.findMany({
            where: { messageId: message.id },
            include: { account: { select: { displayName: true, avatarPath: true } } },
            orderBy: { createdAt: "asc" }
          }),
      loadedReactions.favorites
        ? Promise.resolve(loadedReactions.favorites)
        : prisma.messageFavorite.findMany({ where: { messageId: message.id }, select: { accountId: true } })
    ]);
    const loadedAudioRelations = message as typeof message & {
      musicScores?: Array<MusicScore & { pages: MusicScorePage[] }>;
      musicLyrics?: MusicLyrics | null;
    };
    const isAudio = message.type === "file" && isAudioFileName(message.fileName);
    const [musicScores, musicLyrics] = isAudio
      ? await Promise.all([
          loadedAudioRelations.musicScores ||
            prisma.musicScore.findMany({
              where: { trackId: message.id },
              orderBy: { id: "asc" },
              include: { pages: { orderBy: { pageIndex: "asc" } } }
            }),
          loadedAudioRelations.musicLyrics !== undefined
            ? Promise.resolve(loadedAudioRelations.musicLyrics)
            : prisma.musicLyrics.findUnique({ where: { trackId: message.id } })
        ])
      : [[], null];
    if (message.type === "prayer") {
      const aiSettings = batch?.prayer ? batch.prayer.aiSettings : await loadAiSettings();
      const raw = prayerPayloadRaw(message.payload);
      const sourceId = sourcePrayerMessageId(message.payload, message.id);
      const sourceMessage =
        sourceId !== message.id
          ? batch?.prayer
            ? (batch.prayer.sourceMessages.get(sourceId) ?? null)
            : await prisma.message.findFirst({ where: { id: sourceId, channelId: message.channelId, type: "prayer" } })
          : null;
      const actionMessageId = sourceMessage?.id || message.id;
      const sourceRaw = prayerPayloadRaw(sourceMessage?.payload);
      const displayRaw = sourceMessage ? { ...raw, ...sourceRaw, sourcePrayerMessageId: sourceMessage.id, latestUpdateAt: raw.latestUpdateAt, latestUpdateBy: raw.latestUpdateBy } : raw;
      const [actions, aiSuggestionRows, aiSuggestionSuccessCount] = batch?.prayer
        ? [
            batch.prayer.actionsByMessageId.get(actionMessageId) ?? [],
            batch.prayer.aiSuggestionsByMessageId.get(actionMessageId) ?? [],
            batch.prayer.aiSuggestionCountsByMessageId.get(actionMessageId) ?? 0
          ]
        : await Promise.all([
            prisma.prayerAction.findMany({
              where: { messageId: actionMessageId },
              include: { account: { select: { displayName: true, avatarPath: true } } },
              orderBy: { prayedAt: "desc" }
            }),
            prisma.messageAiSuggestion.findMany({
              where: { messageId: actionMessageId, kind: AI_RELATED_VERSES_KIND, status: "success" },
              include: { createdBy: { select: { displayName: true } } },
              orderBy: { createdAt: "desc" },
              take: 3
            }),
            prisma.messageAiSuggestion.count({ where: { messageId: actionMessageId, kind: AI_RELATED_VERSES_KIND, status: "success" } })
          ]);
      const byAccount = new Map<number, { accountId: number; displayName: string; avatarPath?: string | null; latestPrayedAt: string; times: number }>();
      for (const action of actions) {
        const current = byAccount.get(action.accountId);
        if (current) {
          current.times += 1;
        } else {
          byAccount.set(action.accountId, {
            accountId: action.accountId,
            displayName: action.account.displayName,
            avatarPath: action.account.avatarPath,
            latestPrayedAt: action.prayedAt.toISOString(),
            times: 1
          });
        }
      }
      payload = {
        ...displayRaw,
        kind: "prayer",
        status: cleanPrayerStatus(displayRaw.status),
        prayerCount: byAccount.size,
        prayerActionCount: actions.length,
        currentUserPrayed: viewerAccountId ? byAccount.has(viewerAccountId) : false,
        prayedBy: [...byAccount.values()],
        aiSuggestions: aiSuggestionRows.map(serializeAiSuggestion),
        aiSuggestionSuccessCount,
        aiSuggestionMaxSuccess: aiSettings.value.maxSuccessPerMessage
      };
    }
    if (message.type === "grace") {
      const aiSettings = batch?.grace ? batch.grace.aiSettings : await loadAiSettings();
      const raw = gracePayloadRaw(message.payload);
      const sourceId = sourceGraceMessageId(message.payload, message.id);
      const sourceMessage =
        sourceId !== message.id
          ? batch?.grace
            ? (batch.grace.sourceMessages.get(sourceId) ?? null)
            : await prisma.message.findFirst({ where: { id: sourceId, channelId: message.channelId, type: "grace" } })
          : null;
      const actionMessageId = sourceMessage?.id || message.id;
      const sourceRaw = gracePayloadRaw(sourceMessage?.payload);
      const displayRaw = sourceMessage
        ? { ...raw, ...sourceRaw, sourceGraceMessageId: sourceMessage.id, latestUpdateAt: raw.latestUpdateAt, latestUpdateBy: raw.latestUpdateBy }
        : raw;
      const [actions, aiSuggestionRows, aiSuggestionSuccessCount] = batch?.grace
        ? [
            batch.grace.actionsByMessageId.get(actionMessageId) ?? [],
            batch.grace.aiSuggestionsByMessageId.get(actionMessageId) ?? [],
            batch.grace.aiSuggestionCountsByMessageId.get(actionMessageId) ?? 0
          ]
        : await Promise.all([
            prisma.prayerAction.findMany({
              where: { messageId: actionMessageId },
              include: { account: { select: { displayName: true, avatarPath: true } } },
              orderBy: { prayedAt: "desc" }
            }),
            prisma.messageAiSuggestion.findMany({
              where: { messageId: actionMessageId, kind: AI_RELATED_VERSES_KIND, status: "success" },
              include: { createdBy: { select: { displayName: true } } },
              orderBy: { createdAt: "desc" },
              take: 3
            }),
            prisma.messageAiSuggestion.count({ where: { messageId: actionMessageId, kind: AI_RELATED_VERSES_KIND, status: "success" } })
          ]);
      const byAccount = new Map<number, { accountId: number; displayName: string; avatarPath?: string | null; latestGratefulAt: string; times: number }>();
      for (const action of actions) {
        const current = byAccount.get(action.accountId);
        if (current) current.times += 1;
        else {
          byAccount.set(action.accountId, {
            accountId: action.accountId,
            displayName: action.account.displayName,
            avatarPath: action.account.avatarPath,
            latestGratefulAt: action.prayedAt.toISOString(),
            times: 1
          });
        }
      }
      const voiceMessageId = Number(displayRaw.voiceMessageId || 0);
      let voice: VoicePayload | null = null;
      if (Number.isInteger(voiceMessageId) && voiceMessageId > 0) {
        const source = batch?.grace
          ? (batch.grace.voiceSourceMessages.get(voiceMessageId) ?? null)
          : await prisma.message.findFirst({ where: { id: voiceMessageId, channelId: message.channelId, type: "file" } });
        if (source && isVoiceMessage(source)) {
          const sourcePayload =
            source.payload && typeof source.payload === "object" && !Array.isArray(source.payload) ? (source.payload as Record<string, unknown>) : {};
          voice = {
            kind: "voice",
            ...(typeof sourcePayload.durationMs === "number" ? { durationMs: sourcePayload.durationMs } : {}),
            ...(Array.isArray(sourcePayload.waveform) ? { waveform: sourcePayload.waveform as number[] } : {}),
            ...(typeof sourcePayload.mimeType === "string" ? { mimeType: sourcePayload.mimeType } : {}),
            ...(typeof sourcePayload.transcript === "string" ? { transcript: sourcePayload.transcript } : {})
          };
        }
      }
      payload = {
        ...displayRaw,
        kind: "grace",
        voice,
        gratitudeCount: byAccount.size,
        gratitudeActionCount: actions.length,
        currentUserGrateful: viewerAccountId ? byAccount.has(viewerAccountId) : false,
        gratefulBy: [...byAccount.values()],
        aiSuggestions: aiSuggestionRows.map(serializeAiSuggestion),
        aiSuggestionSuccessCount,
        aiSuggestionMaxSuccess: aiSettings.value.maxSuccessPerMessage
      };
    }
    const playlistId = message.type === "music_playlist" && payload && typeof payload === "object"
      ? Number((payload as { playlistId?: unknown }).playlistId || 0)
      : 0;
    const sharedMusicPlaylist = playlistId
      ? batch?.playlists
        ? (batch.playlists.get(playlistId) ?? null)
        : await musicService.playlistDto(playlistId, viewerAccountId || 0)
      : undefined;
    let chainOwnerActorId: number | null | undefined;
    if (message.type === "chain") {
      const rootId = message.chainRootId || message.id;
      if (batch?.chainOwnerActorIds) {
        chainOwnerActorId = batch.chainOwnerActorIds.get(rootId) ?? null;
      } else if (rootId === message.id) {
        chainOwnerActorId = message.senderActorId;
      } else {
        const root = await prisma.message.findFirst({
          where: { id: rootId, channelId: message.channelId, type: "chain" },
          select: { senderActorId: true }
        });
        chainOwnerActorId = root?.senderActorId ?? null;
      }
    }
    return {
      id: message.id,
      channelId: message.channelId,
      clientRequestId: message.clientRequestId,
      sender: {
        id: message.sender.id,
        kind: message.sender.kind,
        username: message.sender.username,
        displayName: message.sender.displayName,
        avatarPath: message.sender.avatarPath
      },
      content: message.content || "",
      type: message.type,
      payload,
      fileName: message.fileName,
      fileSize: message.fileSize,
      scores: musicScores.map((score) => {
        const kind = score.pages[0]?.fileName?.toLowerCase().endsWith(".pdf") ? "pdf" : "image";
        return {
          id: score.id,
          title: score.title,
          kind,
          pages: score.pages.map((page) => ({
            id: page.id,
            scoreId: score.id,
            pageIndex: page.pageIndex,
            fileName: page.fileName,
            fileSize: page.fileSize,
            width: page.width,
            height: page.height
          }))
        };
      }),
      lyrics: musicLyrics ? { id: musicLyrics.id, fileName: musicLyrics.fileName, cues: parseLyrics(musicLyrics.content, musicLyrics.fileName) } : null,
      voiceListened,
      replyTo: message.replyTo
        ? {
            id: message.replyTo.id,
            content: plainTextPreview(message.replyTo.content || message.replyTo.fileName || "", 140),
            type: message.replyTo.type,
            senderName: message.replyTo.sender.displayName
          }
        : null,
      chainRootId: message.chainRootId,
      chainVersion: message.chainVersion,
      ...(message.type === "chain" ? { chainOwnerActorId } : {}),
      createdAt: message.createdAt.toISOString(),
      reactions: {
        likeCount: likes.length,
        likedBy: likes.map((like) => ({
          accountId: like.accountId,
          displayName: like.account.displayName,
          avatarPath: like.account.avatarPath
        })),
        favoriteCount: favorites.length,
        currentUserLiked: !!viewerAccountId && likes.some((like) => like.accountId === viewerAccountId),
        currentUserFavorited: !!viewerAccountId && favorites.some((favorite) => favorite.accountId === viewerAccountId)
      },
      ...(message.type === "music_playlist" ? { musicPlaylist: sharedMusicPlaylist || null } : {})
    };
  }

  async function hydrateMessage(id: number, viewerAccountId?: number) {
    const message = await prisma.message.findUnique({
      where: { id },
      include: {
        sender: true,
        replyTo: { include: { sender: true } },
        // Preloaded relations are picked up by serializeMessage's preloaded
        // branches, keeping single-message hydration to one round of queries.
        likes: { include: { account: { select: { displayName: true, avatarPath: true } } }, orderBy: { createdAt: "asc" } },
        favorites: { select: { accountId: true } },
        musicScores: { orderBy: { id: "asc" }, include: { pages: { orderBy: { pageIndex: "asc" } } } },
        musicLyrics: true,
        ...(viewerAccountId ? { voiceListens: { where: { accountId: viewerAccountId }, select: { id: true } } } : {})
      }
    });
    return message ? serializeMessage(message, viewerAccountId) : null;
  }

  async function buildMessageSerializeBatch(rows: Array<Message & { sender: Actor }>, channelId: number, viewerAccountId: number): Promise<MessageSerializeBatch> {
    const batch: MessageSerializeBatch = {};
    let sharedAiSettings: Awaited<ReturnType<MessageSerializationDependencies["loadAiSettings"]>> | null = null;
    const batchAiSettings = async () => {
      sharedAiSettings ||= await loadAiSettings();
      return sharedAiSettings;
    };
    const voiceIds = rows.filter((message) => isVoiceMessage(message) && message.sender.accountId !== viewerAccountId).map((message) => message.id);
    const audioRows = rows.filter((message) => message.type === "file" && isAudioFileName(message.fileName));
    const audioIds = audioRows.map((message) => message.id);
    const prayerRows = rows.filter((message) => message.type === "prayer");
    const chainRootIds = [
      ...new Set(rows.filter((message) => message.type === "chain").map((message) => message.chainRootId || message.id))
    ];
    const playlistIds = [
      ...new Set(
        rows
          .map((message) =>
            message.type === "music_playlist" && message.payload && typeof message.payload === "object"
              ? Number((message.payload as { playlistId?: unknown }).playlistId || 0)
              : 0
          )
          .filter((id) => id > 0)
      )
    ];

    const [listenedRows, scoreRows, lyricRows, chainRootRows] = await Promise.all([
      voiceIds.length
        ? prisma.voiceListen.findMany({ where: { accountId: viewerAccountId, messageId: { in: voiceIds } }, select: { messageId: true } })
        : Promise.resolve([]),
      audioIds.length
        ? prisma.musicScore.findMany({ where: { trackId: { in: audioIds } }, orderBy: { id: "asc" }, include: { pages: { orderBy: { pageIndex: "asc" } } } })
        : Promise.resolve([]),
      audioIds.length ? prisma.musicLyrics.findMany({ where: { trackId: { in: audioIds } } }) : Promise.resolve([]),
      chainRootIds.length
        ? prisma.message.findMany({ where: { id: { in: chainRootIds }, channelId, type: "chain" }, select: { id: true, senderActorId: true } })
        : Promise.resolve([])
    ]);
    batch.voiceListenedMessageIds = new Set(listenedRows.map((row) => row.messageId));
    batch.chainOwnerActorIds = new Map(chainRootRows.map((row) => [row.id, row.senderActorId]));

    // Attach audio relations so serializeMessage's preloaded-relation branches
    // pick them up instead of querying per message.
    const scoresByTrackId = new Map<number, Array<(typeof scoreRows)[number]>>();
    for (const score of scoreRows) {
      if (score.trackId === null) continue;
      const list = scoresByTrackId.get(score.trackId) || [];
      list.push(score);
      scoresByTrackId.set(score.trackId, list);
    }
    const lyricsByTrackId = new Map(lyricRows.map((row) => [row.trackId, row]));
    for (const message of audioRows) {
      const loaded = message as typeof message & {
        musicScores?: Array<MusicScore & { pages: MusicScorePage[] }>;
        musicLyrics?: MusicLyrics | null;
      };
      loaded.musicScores = scoresByTrackId.get(message.id) ?? [];
      loaded.musicLyrics = lyricsByTrackId.get(message.id) ?? null;
    }

    if (prayerRows.length) {
      const aiSettings = await batchAiSettings();
      const sourceIds = [
        ...new Set(
          prayerRows
            .map((message) => ({ sourceId: sourcePrayerMessageId(message.payload, message.id), messageId: message.id }))
            .filter((entry) => entry.sourceId !== entry.messageId)
            .map((entry) => entry.sourceId)
        )
      ];
      const sourceRows = sourceIds.length ? await prisma.message.findMany({ where: { id: { in: sourceIds }, channelId, type: "prayer" } }) : [];
      const sourceMessages = new Map<number, Message | null>();
      for (const sourceId of sourceIds) sourceMessages.set(sourceId, sourceRows.find((row) => row.id === sourceId) ?? null);
      const actionMessageIds = [
        ...new Set(
          prayerRows.map((message) => {
            const sourceId = sourcePrayerMessageId(message.payload, message.id);
            return (sourceId !== message.id ? sourceMessages.get(sourceId)?.id : undefined) || message.id;
          })
        )
      ];
      const [actionRows, suggestionRows] = await Promise.all([
        prisma.prayerAction.findMany({
          where: { messageId: { in: actionMessageIds } },
          include: { account: { select: { displayName: true, avatarPath: true } } },
          orderBy: { prayedAt: "desc" }
        }),
        prisma.messageAiSuggestion.findMany({
          where: { messageId: { in: actionMessageIds }, kind: AI_RELATED_VERSES_KIND, status: "success" },
          include: { createdBy: { select: { displayName: true } } },
          orderBy: { createdAt: "desc" }
        })
      ]);
      const actionsByMessageId = new Map<number, typeof actionRows>();
      for (const action of actionRows) {
        const list = actionsByMessageId.get(action.messageId) || [];
        list.push(action);
        actionsByMessageId.set(action.messageId, list);
      }
      const suggestionsByMessageId = new Map<number, typeof suggestionRows>();
      for (const suggestion of suggestionRows) {
        const list = suggestionsByMessageId.get(suggestion.messageId) || [];
        list.push(suggestion);
        suggestionsByMessageId.set(suggestion.messageId, list);
      }
      const aiSuggestionsByMessageId = new Map<number, typeof suggestionRows>();
      const aiSuggestionCountsByMessageId = new Map<number, number>();
      for (const [messageId, list] of suggestionsByMessageId) {
        aiSuggestionsByMessageId.set(messageId, list.slice(0, 3));
        aiSuggestionCountsByMessageId.set(messageId, list.length);
      }
      batch.prayer = { aiSettings, sourceMessages, actionsByMessageId, aiSuggestionsByMessageId, aiSuggestionCountsByMessageId };
    }

    const graceRows = rows.filter((message) => message.type === "grace");
    const graceVoiceSourceIds = [
      ...new Set(
        rows
          .filter((message) => message.type === "grace")
          .map((message) => {
            const raw = message.payload && typeof message.payload === "object" && !Array.isArray(message.payload) ? (message.payload as Record<string, unknown>) : {};
            return Number(raw.voiceMessageId || 0);
          })
          .filter((id) => Number.isInteger(id) && id > 0)
      )
    ];
    if (graceRows.length) {
      const aiSettings = await batchAiSettings();
      const sourceIds = [
        ...new Set(
          graceRows
            .map((message) => ({ sourceId: sourceGraceMessageId(message.payload, message.id), messageId: message.id }))
            .filter((entry) => entry.sourceId !== entry.messageId)
            .map((entry) => entry.sourceId)
        )
      ];
      const [voiceSourceRows, sourceRows] = await Promise.all([
        graceVoiceSourceIds.length
          ? prisma.message.findMany({ where: { id: { in: graceVoiceSourceIds }, channelId, type: "file" } })
          : Promise.resolve([]),
        sourceIds.length ? prisma.message.findMany({ where: { id: { in: sourceIds }, channelId, type: "grace" } }) : Promise.resolve([])
      ]);
      const voiceSourceMessages = new Map<number, Message | null>();
      for (const sourceId of graceVoiceSourceIds) voiceSourceMessages.set(sourceId, voiceSourceRows.find((row) => row.id === sourceId) ?? null);
      const sourceMessages = new Map<number, Message | null>();
      for (const sourceId of sourceIds) sourceMessages.set(sourceId, sourceRows.find((row) => row.id === sourceId) ?? null);
      const actionMessageIds = [
        ...new Set(
          graceRows.map((message) => {
            const sourceId = sourceGraceMessageId(message.payload, message.id);
            return (sourceId !== message.id ? sourceMessages.get(sourceId)?.id : undefined) || message.id;
          })
        )
      ];
      const [actionRows, suggestionRows] = await Promise.all([
        prisma.prayerAction.findMany({
          where: { messageId: { in: actionMessageIds } },
          include: { account: { select: { displayName: true, avatarPath: true } } },
          orderBy: { prayedAt: "desc" }
        }),
        prisma.messageAiSuggestion.findMany({
          where: { messageId: { in: actionMessageIds }, kind: AI_RELATED_VERSES_KIND, status: "success" },
          include: { createdBy: { select: { displayName: true } } },
          orderBy: { createdAt: "desc" }
        })
      ]);
      const actionsByMessageId = new Map<number, typeof actionRows>();
      for (const action of actionRows) {
        const list = actionsByMessageId.get(action.messageId) || [];
        list.push(action);
        actionsByMessageId.set(action.messageId, list);
      }
      const suggestionsByMessageId = new Map<number, typeof suggestionRows>();
      for (const suggestion of suggestionRows) {
        const list = suggestionsByMessageId.get(suggestion.messageId) || [];
        list.push(suggestion);
        suggestionsByMessageId.set(suggestion.messageId, list);
      }
      const aiSuggestionsByMessageId = new Map<number, typeof suggestionRows>();
      const aiSuggestionCountsByMessageId = new Map<number, number>();
      for (const [messageId, list] of suggestionsByMessageId) {
        aiSuggestionsByMessageId.set(messageId, list.slice(0, 3));
        aiSuggestionCountsByMessageId.set(messageId, list.length);
      }
      batch.grace = {
        voiceSourceMessages,
        sourceMessages,
        actionsByMessageId,
        aiSuggestionsByMessageId,
        aiSuggestionCountsByMessageId,
        aiSettings
      };
    }

    if (playlistIds.length) {
      batch.playlists = new Map(await Promise.all(playlistIds.map(async (id) => [id, await musicService.playlistDto(id, viewerAccountId)] as const)));
    }
    return batch;
  }

  return { serializeMessage, hydrateMessage, buildMessageSerializeBatch };
}
