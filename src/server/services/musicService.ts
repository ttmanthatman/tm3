import type { Message, MusicLyrics, MusicScorePage, PrismaClient } from "@prisma/client";
import type { MusicPlaybackStateDTO, MusicPlaylistDTO, MusicTrackDTO } from "../../shared/types.js";
import { canManageMusicRole, isMusicFileName, musicTrackTitle } from "../music.js";
import { parseLyrics } from "../srt.js";

type MusicTrackRecord = Pick<Message, "id" | "fileName" | "fileSize" | "createdAt" | "musicOrder"> & {
  sender?: { accountId: number | null };
  musicScorePages?: Array<Pick<MusicScorePage, "id" | "pageIndex" | "fileName" | "fileSize" | "width" | "height">>;
  musicLyrics?: Pick<MusicLyrics, "fileName" | "content"> | null;
  _count?: { musicPlays: number };
};

type MusicPlaybackStateRecord = {
  sourceKind: string;
  playlistId: number | null;
  trackId: number | null;
  progressMs: number;
  playbackMode: string;
  updatedAt: Date;
};

export type MusicService = {
  serializeTrack(message: MusicTrackRecord, fallbackOrder?: number, favorited?: boolean, canManage?: boolean): MusicTrackDTO;
  playlistDto(playlistId: number, viewerAccountId: number): Promise<MusicPlaylistDTO | null>;
  canAccessPlaylist(accountId: number, playlistId: number): Promise<boolean>;
  canManageAccount(accountId: number): Promise<boolean>;
  cleanPlaybackState(row: MusicPlaybackStateRecord): MusicPlaybackStateDTO;
};

export function createMusicService(deps: {
  prisma: PrismaClient;
  canAccessChannel(accountId: number, channelId: number): Promise<boolean>;
}): MusicService {
  const { prisma, canAccessChannel } = deps;

  function serializeTrack(
    message: MusicTrackRecord,
    fallbackOrder = 0,
    favorited?: boolean,
    canManage = false
  ): MusicTrackDTO {
    const fileName = message.fileName || "未命名歌曲.mp3";
    return {
      id: message.id,
      canManage,
      title: musicTrackTitle(fileName),
      fileName,
      fileSize: message.fileSize || 0,
      createdAt: message.createdAt.toISOString(),
      heat: message._count?.musicPlays || 0,
      manualOrder: message.musicOrder ?? fallbackOrder,
      ...(favorited === undefined ? {} : { favorited }),
      scorePages: (message.musicScorePages || []).map((page) => ({
        id: page.id,
        pageIndex: page.pageIndex,
        fileName: page.fileName,
        fileSize: page.fileSize,
        width: page.width,
        height: page.height
      })),
      lyrics: message.musicLyrics
        ? { fileName: message.musicLyrics.fileName, cues: parseLyrics(message.musicLyrics.content, message.musicLyrics.fileName) }
        : null
    };
  }

  async function canManageAccount(accountId: number) {
    const account = await prisma.account.findUnique({ where: { id: accountId }, select: { role: true, canPinMessages: true } });
    return !!account && canManageMusicRole({ isAdmin: account.role === "admin", canPinMessages: account.canPinMessages });
  }

  async function playlistDto(playlistId: number, viewerAccountId: number): Promise<MusicPlaylistDTO | null> {
    const playlist = await prisma.musicPlaylist.findUnique({
      where: { id: playlistId },
      include: {
        account: { select: { displayName: true } },
        tracks: {
          orderBy: { position: "asc" },
          include: {
            track: {
              include: {
                sender: { select: { accountId: true } },
                musicScorePages: { orderBy: { pageIndex: "asc" } },
                musicLyrics: true,
                _count: { select: { musicPlays: true } }
              }
            }
          }
        }
      }
    });
    if (!playlist) return null;
    const favorites = await prisma.musicFavorite.findMany({
      where: { accountId: viewerAccountId, trackId: { in: playlist.tracks.map((item) => item.trackId) } },
      select: { trackId: true }
    });
    const favoriteIds = new Set(favorites.map((favorite) => favorite.trackId));
    const viewerCanManageAll = await canManageAccount(viewerAccountId);
    const tracks = playlist.tracks
      .filter((item) => item.track.channelId && item.track.type === "file" && isMusicFileName(item.track.fileName))
      .map((item, index) =>
        serializeTrack(item.track, index, favoriteIds.has(item.trackId), viewerCanManageAll || item.track.sender.accountId === viewerAccountId)
      );
    return {
      id: playlist.id,
      name: playlist.name,
      ownerAccountId: playlist.accountId,
      ownerName: playlist.account.displayName,
      isOwner: playlist.accountId === viewerAccountId,
      trackCount: tracks.length,
      tracks,
      createdAt: playlist.createdAt.toISOString(),
      updatedAt: playlist.updatedAt.toISOString()
    };
  }

  async function canAccessPlaylist(accountId: number, playlistId: number) {
    const playlist = await prisma.musicPlaylist.findUnique({
      where: { id: playlistId },
      select: { accountId: true, shares: { select: { message: { select: { channelId: true } } } } }
    });
    if (!playlist) return false;
    if (playlist.accountId === accountId) return true;
    for (const share of playlist.shares) {
      if (await canAccessChannel(accountId, share.message.channelId)) return true;
    }
    return false;
  }

  function cleanPlaybackState(row: MusicPlaybackStateRecord): MusicPlaybackStateDTO {
    return {
      sourceKind: row.sourceKind === "favorites" || row.sourceKind === "playlist" ? row.sourceKind : "library",
      playlistId: row.playlistId,
      trackId: row.trackId,
      progressMs: Math.max(0, row.progressMs),
      playbackMode: row.playbackMode === "single" || row.playbackMode === "playlist" ? row.playbackMode : "shuffle",
      updatedAt: row.updatedAt.toISOString()
    };
  }

  return {
    serializeTrack,
    playlistDto,
    canAccessPlaylist,
    canManageAccount,
    cleanPlaybackState
  };
}
