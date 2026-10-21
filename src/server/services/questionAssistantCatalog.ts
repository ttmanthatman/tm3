import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { canManageMusicRole, isMusicFileName, isMusicScoreFileName, musicTrackInfo, musicTrackTitle } from "../music.js";
import { parseLyrics } from "../srt.js";
import type { MusicScoreLibraryRow } from "./musicScoreLibrary.js";

export type QuestionAssistantCatalogAuth = { accountId: number; isAdmin: boolean; canPinMessages: boolean };
export type QuestionAssistantTrack = {
  id: number;
  title: string;
  lyricsPreview: string;
  backgroundPreview: string;
  scores: Array<{ id: number; title: string }>;
};
export type QuestionAssistantScore = { id: number; title: string; trackId: number | null; trackTitle: string };
export type QuestionAssistantCatalogSearch = { query?: string; kind?: "all" | "tracks" | "scores"; limit?: number; offset?: number };

const trackMetadataSelect = {
  id: true, channelId: true, type: true, fileName: true, filePath: true, payload: true,
  channel: { select: { kind: true, isPrivate: true } },
  musicLyrics: { select: { fileName: true, content: true } }
} satisfies Prisma.MessageSelect;
const trackSelect = {
  ...trackMetadataSelect,
  musicScores: {
    where: { pages: { some: {} } }, orderBy: { id: "asc" as const },
    select: { id: true, title: true, pages: { select: { fileName: true, filePath: true } } }
  }
} satisfies Prisma.MessageSelect;
const scoreInclude = {
  pages: { orderBy: { pageIndex: "asc" as const } },
  track: { select: trackMetadataSelect }
} satisfies Prisma.MusicScoreInclude;
type TrackMetadata = Prisma.MessageGetPayload<{ select: typeof trackMetadataSelect }>;
type TrackRow = Prisma.MessageGetPayload<{ select: typeof trackSelect }>;
type ScoreRow = Prisma.MusicScoreGetPayload<{ include: typeof scoreInclude }>;
type ScorePages = { pages: Array<{ fileName: string; filePath: string }> };

const searchSchema = z.object({
  query: z.string().trim().max(200).default(""),
  kind: z.enum(["all", "tracks", "scores"]).default("all"),
  limit: z.number().int().min(1).max(20).default(20),
  offset: z.number().int().nonnegative().safe().default(0)
}).strict();

const publicTrackWhere = {
  type: "file", channel: { kind: "music", isPrivate: false }, fileName: { not: null }, filePath: { not: null }
} satisfies Prisma.MessageWhereInput;
const QUERY_BATCH_SIZE = 100;

function isPublicTrack(track: TrackMetadata) {
  return track.type === "file" && track.channel.kind === "music" && !track.channel.isPrivate
    && !!track.filePath?.trim() && isMusicFileName(track.fileName);
}

function hasShareablePages(score: ScorePages) {
  return score.pages.length > 0 && score.pages.every((page) => !!page.filePath.trim() && isMusicScoreFileName(page.fileName));
}

function trackTexts(track: TrackMetadata) {
  const info = musicTrackInfo(track.payload);
  const lyrics = info.lyricsText || (track.musicLyrics
    ? parseLyrics(track.musicLyrics.content, track.musicLyrics.fileName).map((cue) => cue.text).join("\n") || track.musicLyrics.content
    : "");
  // fileName is the uploaded/display filename; filePath is the UUID used on disk.
  // Always use the same title helper as the music UI and never expose either filename to the model.
  return { title: musicTrackTitle(track.fileName), lyrics, background: info.background || "" };
}

function normalize(value: string) { return value.toLocaleLowerCase().normalize("NFKC"); }
function matches(query: string, fields: string[]) {
  const haystack = normalize(fields.join("\n"));
  return query.split(/\s+/u).filter(Boolean).every((term) => haystack.includes(normalize(term)));
}

function preview(value: string, query: string, limit: number) {
  const clean = value.replace(/\s+/gu, " ").trim();
  const terms = query.split(/\s+/u).filter(Boolean);
  const positions = terms.map((term) => normalize(clean).indexOf(normalize(term))).filter((index) => index >= 0);
  const start = positions.length ? Math.max(0, Math.min(...positions) - 60) : 0;
  return `${start ? "…" : ""}${clean.slice(start, start + limit)}${clean.length > start + limit ? "…" : ""}`;
}

function trackSearchWhere(query: string): Prisma.MessageWhereInput[] {
  return query.split(/\s+/u).filter(Boolean).map((term) => ({ OR: [
    { fileName: { contains: term } },
    { payload: { path: "$.background", string_contains: term } },
    { payload: { path: "$.lyricsText", string_contains: term } },
    { musicLyrics: { content: { contains: term } } },
    { musicScores: { some: { title: { contains: term }, pages: { some: {} } } } }
  ] }));
}

/** Each result kind has its own bounded page, so an "all" search cannot hide scores behind songs. */
async function collectPage<Row extends { id: number }, Item>(
  fetchRows: (beforeId: number | null) => Promise<Row[]>,
  itemFromRow: (row: Row) => Item | null,
  offset: number,
  limit: number
) {
  const items: Item[] = [];
  let beforeId: number | null = null;
  let skipped = 0;
  for (;;) {
    const rows = await fetchRows(beforeId);
    for (const row of rows) {
      const item = itemFromRow(row);
      if (!item) continue;
      if (skipped < offset) { skipped += 1; continue; }
      if (items.length === limit) return { items, hasMore: true };
      items.push(item);
    }
    if (rows.length < QUERY_BATCH_SIZE) return { items, hasMore: false };
    beforeId = rows[rows.length - 1].id;
  }
}

/** Reads the live library on every call; catalog content is never cached in the assistant prompt. */
export function createQuestionAssistantCatalog(deps: {
  prisma: Pick<PrismaClient, "message" | "musicScore">;
  auth: QuestionAssistantCatalogAuth;
}) {
  const { prisma, auth } = deps;
  function canReadScore(score: ScoreRow) {
    if (!hasShareablePages(score)) return false;
    if (score.track) return isPublicTrack(score.track);
    return score.trackId === null && (score.uploadedByAccountId === auth.accountId || canManageMusicRole(auth));
  }

  function trackSummary(row: TrackRow, query: string): QuestionAssistantTrack | null {
    if (!isPublicTrack(row)) return null;
    const info = trackTexts(row);
    const scores = row.musicScores.filter(hasShareablePages).map(({ id, title }) => ({ id, title }));
    if (!matches(query, [info.title, info.lyrics, info.background, ...scores.map((score) => score.title)])) return null;
    return { id: row.id, title: info.title, lyricsPreview: preview(info.lyrics, query, 480), backgroundPreview: preview(info.background, query, 240), scores: scores.slice(0, 20) };
  }

  function scoreSummary(row: ScoreRow, query: string): QuestionAssistantScore | null {
    if (!canReadScore(row)) return null;
    const info = row.track ? trackTexts(row.track) : null;
    if (!matches(query, [row.title, info?.title || "", info?.lyrics || "", info?.background || ""])) return null;
    return { id: row.id, title: row.title, trackId: row.trackId, trackTitle: info?.title || "" };
  }

  async function search(input: QuestionAssistantCatalogSearch = {}) {
    const { query, kind, limit, offset } = searchSchema.parse(input);
    const trackQuery = trackSearchWhere(query);
    const tracks = kind === "scores" ? { items: [] as QuestionAssistantTrack[], hasMore: false } : await collectPage(
      (beforeId) => prisma.message.findMany({
        where: { ...publicTrackWhere, AND: [...trackQuery, ...(beforeId === null ? [] : [{ id: { lt: beforeId } }])] },
        select: trackSelect, orderBy: { id: "desc" }, take: QUERY_BATCH_SIZE
      }),
      (row) => trackSummary(row, query), offset, limit
    );
    const visibleScores: Prisma.MusicScoreWhereInput = { OR: [
      { track: { is: publicTrackWhere } },
      { trackId: null, ...(canManageMusicRole(auth) ? {} : { uploadedByAccountId: auth.accountId }) }
    ] };
    const scores = kind === "tracks" ? { items: [] as QuestionAssistantScore[], hasMore: false } : await collectPage(
      (beforeId) => prisma.musicScore.findMany({
        where: { AND: [
          visibleScores, { pages: { some: {} } },
          ...query.split(/\s+/u).filter(Boolean).map((term): Prisma.MusicScoreWhereInput => ({ OR: [
            { title: { contains: term } }, { track: { is: { OR: trackSearchWhere(term) } } }
          ] })),
          ...(beforeId === null ? [] : [{ id: { lt: beforeId } }])
        ] },
        include: scoreInclude, orderBy: { id: "desc" }, take: QUERY_BATCH_SIZE
      }),
      (row) => scoreSummary(row, query), offset, limit
    );
    const hasMore = tracks.hasMore || scores.hasMore;
    return { tracks: tracks.items, scores: scores.items, hasMore, nextOffset: hasMore ? offset + limit : null };
  }

  async function getTrack(id: number): Promise<QuestionAssistantTrack | null> {
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    const track = await prisma.message.findUnique({ where: { id }, select: trackSelect });
    return track ? trackSummary(track, "") : null;
  }

  async function getScore(id: number): Promise<MusicScoreLibraryRow | null> {
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    const score = await prisma.musicScore.findUnique({ where: { id }, include: scoreInclude });
    return score && canReadScore(score) ? score : null;
  }

  return { search, getTrack, getScore };
}
