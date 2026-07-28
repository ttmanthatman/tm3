import assert from "node:assert/strict";
import test from "node:test";
import { ref, type Ref } from "vue";
import type { MusicPlaylistDTO, MusicResourcePoolDTO, MusicTrackDTO } from "../../../shared/types.js";
import {
  filterMusicTracksByQuery,
  mergeTrackIds,
  musicUploadAckMessage,
  pruneSelection,
  resolveMusicManagerFocus,
  toggleIdInSet,
  useMusicLibrary
} from "./useMusicLibrary.js";

function track(id: number, overrides: Partial<MusicTrackDTO> = {}): MusicTrackDTO {
  return {
    id,
    canManage: true,
    title: `歌曲${id}`,
    uploadedByName: null,
    fileName: `track-${id}.mp3`,
    fileSize: 1_000,
    createdAt: "2026-01-01T00:00:00.000Z",
    heat: 0,
    manualOrder: id,
    favorited: false,
    scores: [],
    lyrics: null,
    background: null,
    lyricsText: null,
    ...overrides
  };
}

function playlist(id: number, trackIds: number[], overrides: Partial<MusicPlaylistDTO> = {}): MusicPlaylistDTO {
  return {
    id,
    name: `歌单${id}`,
    ownerAccountId: 1,
    ownerName: "测试",
    isOwner: true,
    trackCount: trackIds.length,
    tracks: trackIds.map((trackId) => track(trackId)),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

function createHarness(input?: {
  tracks?: MusicTrackDTO[];
  playlists?: MusicPlaylistDTO[];
  pool?: MusicResourcePoolDTO;
  initialFocus?: { kind: "track" | "playlist" | "resources"; id?: number } | null;
}) {
  const calls: Array<{ path: string; options?: RequestInit }> = [];
  const pool = input?.pool || { lyrics: [], scores: [] };
  const request = async <T>(path: string, options?: RequestInit): Promise<T> => {
    calls.push({ path, options });
    if (path === "/api/music/resources") return pool as T;
    return { success: true } as T;
  };
  const library = useMusicLibrary({
    tracks: ref(input?.tracks || []),
    playlists: ref(input?.playlists || []),
    request,
    initialFocus: input?.initialFocus ?? null
  });
  return { library, calls };
}

test("query filter matches title and file name case-insensitively and trims input", () => {
  const tracks = [
    track(1, { title: "晨星", fileName: "Morning Star.mp3" }),
    track(2, { title: "恩典之路", fileName: "grace.mp3" })
  ];
  assert.deepEqual(filterMusicTracksByQuery(tracks, "").map((t) => t.id), [1, 2]);
  assert.deepEqual(filterMusicTracksByQuery(tracks, "  晨 ").map((t) => t.id), [1]);
  assert.deepEqual(filterMusicTracksByQuery(tracks, "MORNING").map((t) => t.id), [1]);
  assert.deepEqual(filterMusicTracksByQuery(tracks, "grace.MP3").map((t) => t.id), [2]);
  assert.deepEqual(filterMusicTracksByQuery(tracks, "不存在"), []);
});

test("query filter treats 祢/你 and 祂/他 as equivalent variants", () => {
  const tracks = [
    track(1, { title: "祢的爱不离弃", fileName: "祢的爱不离弃.mp3" }),
    track(2, { title: "祂爱我", fileName: "祂爱我.mp3" }),
    track(3, { title: "恩典之路", fileName: "grace.mp3" })
  ];
  assert.deepEqual(filterMusicTracksByQuery(tracks, "你的爱").map((t) => t.id), [1]);
  assert.deepEqual(filterMusicTracksByQuery(tracks, "祢的爱").map((t) => t.id), [1]);
  assert.deepEqual(filterMusicTracksByQuery(tracks, "他爱我").map((t) => t.id), [2]);
  assert.deepEqual(filterMusicTracksByQuery(tracks, "祂爱我").map((t) => t.id), [2]);
  assert.deepEqual(filterMusicTracksByQuery(tracks, "你").map((t) => t.id), [1]);
});

test("focus resolution maps kinds to nav, playlist and track selection", () => {
  assert.deepEqual(resolveMusicManagerFocus(null), { nav: "library", playlistId: null, trackId: null });
  assert.deepEqual(resolveMusicManagerFocus({ kind: "track", id: 7 }), { nav: "library", playlistId: null, trackId: 7 });
  assert.deepEqual(resolveMusicManagerFocus({ kind: "playlist", id: 3 }), { nav: "playlist", playlistId: 3, trackId: null });
  assert.deepEqual(resolveMusicManagerFocus({ kind: "resources" }), { nav: "resources", playlistId: null, trackId: null });
});

test("selection set helpers toggle, prune and merge ids", () => {
  assert.deepEqual([...toggleIdInSet(new Set([1]), 2)].sort(), [1, 2]);
  assert.deepEqual([...toggleIdInSet(new Set([1, 2]), 2)], [1]);
  assert.deepEqual([...pruneSelection(new Set([1, 2, 9]), [1, 3])], [1]);
  assert.deepEqual(mergeTrackIds([1, 2], [2, 3, 1]), [1, 2, 3]);
  assert.deepEqual(mergeTrackIds([], []), []);
});

test("upload ack message explains auto-bind, candidates, conflict and unbound cases", () => {
  const titleById = (id: number) => (id === 5 ? "晨星" : undefined);
  assert.equal(musicUploadAckMessage({ success: true, autoBound: true, boundTrackId: 5 }, titleById), "已自动绑定《晨星》");
  assert.equal(
    musicUploadAckMessage({ success: true, boundTrackId: null, candidateTrackIds: [1, 2, 3] }, titleById),
    "有 3 首同名歌曲，请到“待绑定资源”中手动绑定"
  );
  assert.equal(
    musicUploadAckMessage({ success: true, boundTrackId: null, bindConflict: "lyrics-exists" }, titleById),
    "同名歌曲已有歌词，资源已放入“待绑定资源”"
  );
  assert.equal(musicUploadAckMessage({ success: true, boundTrackId: null }, titleById), "已上传到“待绑定资源”");
  assert.equal(musicUploadAckMessage({ success: true, boundTrackId: 5 }, titleById), "");
});

test("favorites nav filters tracks and visible tracks honor query and manual sort", () => {
  const { library } = createHarness({
    tracks: [
      track(1, { favorited: true, manualOrder: 2 }),
      track(2, { favorited: false, manualOrder: 1 }),
      track(3, { favorited: true, manualOrder: 0 })
    ]
  });
  library.selectNav("favorites");
  assert.deepEqual(library.visibleTracks.value.map((t) => t.id), [3, 1]);
  library.query.value = "歌曲1";
  assert.deepEqual(library.visibleTracks.value.map((t) => t.id), [1]);
  library.selectNav("library");
  library.sort.value = "heat";
  library.query.value = "";
  // equal heat falls back to newest id first
  assert.deepEqual(library.visibleTracks.value.map((t) => t.id), [3, 2, 1]);
});

test("playlist nav shows active playlist tracks and resets when the playlist disappears", () => {
  const playlists = ref([playlist(4, [2, 1])]);
  const tracks = ref([track(1), track(2)]);
  const { library } = useMusicLibraryHarness(tracks, playlists);
  library.openFocus({ kind: "playlist", id: 4 });
  assert.equal(library.nav.value, "playlist");
  // manual sort inside a playlist preserves the playlist's own order
  assert.deepEqual(library.visibleTracks.value.map((t) => t.id), [2, 1]);
  library.sort.value = "heat";
  assert.deepEqual(library.visibleTracks.value.map((t) => t.id), [2, 1]);
  playlists.value = [];
  assert.equal(library.activePlaylistId.value, null);
  assert.equal(library.nav.value, "library");
});

test("openFocus loads the resource pool only for the resources nav", async () => {
  const { library, calls } = createHarness({
    pool: { lyrics: [{ id: 9, fileName: "a.lrc", cueCount: 3, createdAt: "2026-01-01T00:00:00.000Z", uploadedByAccountId: 1, uploadedByName: "甲" }], scores: [] }
  });
  assert.equal(calls.length, 0);
  library.openFocus({ kind: "resources" });
  await Promise.resolve();
  assert.deepEqual(calls.map((call) => call.path), ["/api/music/resources"]);
  assert.equal(library.unboundResourceCount.value, 1);
  library.openFocus({ kind: "track", id: 1 });
  assert.equal(library.selectedTrackId.value, 1);
  assert.equal(library.nav.value, "library");
});

test("initial focus selects the track detail on creation", () => {
  const { library } = createHarness({ tracks: [track(8)], initialFocus: { kind: "track", id: 8 } });
  assert.equal(library.selectedTrack.value?.id, 8);
});

test("selection prunes removed tracks and detail closes when its track disappears", () => {
  const tracks = ref([track(1), track(2, { canManage: false })]);
  const { library } = useMusicLibraryHarness(tracks, ref([]));
  library.toggleSelectionMode();
  library.toggleTrackSelected(1);
  library.toggleTrackSelected(2);
  assert.deepEqual(library.selectedManageableIds.value, [1]);
  library.openTrackDetail(1);
  tracks.value = [track(2, { canManage: false })];
  assert.deepEqual([...library.selectedTrackIds.value], [2]);
  assert.equal(library.selectedTrackId.value, null);
});

test("resource bind, unbind and delete actions hit the api and reload the pool", async () => {
  const { library, calls } = createHarness();
  await library.bindLyrics(11, 22);
  await library.unbindLyrics(11);
  await library.bindScore(12, 22);
  await library.unbindScore(12);
  await library.deleteLyricsResource(11);
  await library.deleteScoreResource(12);
  assert.deepEqual(
    calls.map((call) => `${call.options?.method || "GET"} ${call.path}`),
    [
      "POST /api/music/lyrics/11/bind",
      "GET /api/music/resources",
      "POST /api/music/lyrics/11/unbind",
      "GET /api/music/resources",
      "POST /api/music/scores/12/bind",
      "GET /api/music/resources",
      "POST /api/music/scores/12/unbind",
      "GET /api/music/resources",
      "DELETE /api/music/resources/lyrics/11",
      "GET /api/music/resources",
      "DELETE /api/music/resources/scores/12",
      "GET /api/music/resources"
    ]
  );
  const bindCall = calls[0];
  assert.equal(bindCall.options?.body, JSON.stringify({ trackId: 22 }));
});

test("resource load failure surfaces a chinese error message", async () => {
  const tracks = ref<MusicTrackDTO[]>([]);
  const playlists = ref<MusicPlaylistDTO[]>([]);
  const library = useMusicLibrary({
    tracks,
    playlists,
    request: async () => {
      throw new Error("网络连接失败");
    }
  });
  await library.loadResources(true);
  assert.equal(library.resourcesError.value, "网络连接失败");
});

function useMusicLibraryHarness(tracks: Ref<MusicTrackDTO[]>, playlists: Ref<MusicPlaylistDTO[]>) {
  const calls: Array<{ path: string; options?: RequestInit }> = [];
  const request = async <T>(path: string, options?: RequestInit): Promise<T> => {
    calls.push({ path, options });
    return { lyrics: [], scores: [] } as T;
  };
  const library = useMusicLibrary({ tracks, playlists, request });
  return { library, calls };
}
