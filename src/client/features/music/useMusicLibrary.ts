import { computed, ref, watch, type Ref } from "vue";
import type { MusicPlaylistDTO, MusicResourcePoolDTO, MusicTrackDTO } from "../../../shared/types.js";
import { sortMusicTracks, type MusicPlaylistSort } from "../../musicPlayer.js";

export type MusicLibraryNav = "library" | "favorites" | "playlist" | "resources";
export type MusicManagerFocusKind = "track" | "playlist" | "resources";

export interface MusicManagerFocus {
  kind: MusicManagerFocusKind;
  id?: number;
}

export type MusicLibraryRequest = <T>(path: string, options?: RequestInit) => Promise<T>;

export interface MusicResourceUploadAck {
  success: boolean;
  boundTrackId?: number | null;
  autoBound?: boolean;
  candidateTrackIds?: number[];
  bindConflict?: string;
}

export function filterMusicTracksByQuery<T extends Pick<MusicTrackDTO, "title" | "fileName">>(tracks: T[], query: string): T[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [...tracks];
  return tracks.filter(
    (track) =>
      track.title.toLocaleLowerCase().includes(normalized) ||
      track.fileName.toLocaleLowerCase().includes(normalized)
  );
}

export function resolveMusicManagerFocus(focus: MusicManagerFocus | null | undefined): {
  nav: MusicLibraryNav;
  playlistId: number | null;
  trackId: number | null;
} {
  if (!focus) return { nav: "library", playlistId: null, trackId: null };
  if (focus.kind === "playlist") return { nav: "playlist", playlistId: focus.id ?? null, trackId: null };
  if (focus.kind === "resources") return { nav: "resources", playlistId: null, trackId: null };
  return { nav: "library", playlistId: null, trackId: focus.id ?? null };
}

export function toggleIdInSet(set: ReadonlySet<number>, id: number): Set<number> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function pruneSelection(selected: ReadonlySet<number>, validIds: Iterable<number>): Set<number> {
  const valid = new Set(validIds);
  const next = new Set<number>();
  for (const id of selected) if (valid.has(id)) next.add(id);
  return next;
}

export function mergeTrackIds(existing: number[], added: number[]): number[] {
  const seen = new Set(existing);
  const next = [...existing];
  for (const id of added) {
    if (seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  return next;
}

export function musicUploadAckMessage(ack: MusicResourceUploadAck, trackTitleById: (id: number) => string | undefined): string {
  if (ack.autoBound && ack.boundTrackId) return `已自动绑定《${trackTitleById(ack.boundTrackId) || "目标歌曲"}》`;
  if (ack.candidateTrackIds?.length) return `有 ${ack.candidateTrackIds.length} 首同名歌曲，请到“待绑定资源”中手动绑定`;
  if (ack.bindConflict === "lyrics-exists") return "同名歌曲已有歌词，资源已放入“待绑定资源”";
  if (!ack.boundTrackId) return "已上传到“待绑定资源”";
  return "";
}

export function useMusicLibrary(options: {
  tracks: Ref<MusicTrackDTO[]>;
  playlists: Ref<MusicPlaylistDTO[]>;
  request: MusicLibraryRequest;
  initialFocus?: MusicManagerFocus | null;
}) {
  const nav = ref<MusicLibraryNav>("library");
  const activePlaylistId = ref<number | null>(null);
  const selectedTrackId = ref<number | null>(null);
  const query = ref("");
  const sort = ref<MusicPlaylistSort>("manual");
  const viewMode = ref<"grid" | "list">("list");
  const selectionMode = ref(false);
  const selectedTrackIds = ref<Set<number>>(new Set());
  const resources = ref<MusicResourcePoolDTO>({ lyrics: [], scores: [] });
  const resourcesLoading = ref(false);
  const resourcesError = ref("");
  let resourcesLoadedOnce = false;

  const activePlaylist = computed(() => options.playlists.value.find((playlist) => playlist.id === activePlaylistId.value) || null);

  const navTracks = computed(() => {
    if (nav.value === "favorites") return options.tracks.value.filter((track) => track.favorited);
    if (nav.value === "playlist") return activePlaylist.value?.tracks || [];
    return options.tracks.value;
  });

  const visibleTracks = computed(() => {
    const filtered = filterMusicTracksByQuery(navTracks.value, query.value);
    // "manual" inside a playlist means the playlist's own order, not the library manual order.
    if (nav.value === "playlist" && sort.value === "manual") return filtered;
    return sortMusicTracks(filtered, sort.value);
  });

  const selectedTrack = computed(() => options.tracks.value.find((track) => track.id === selectedTrackId.value) || null);

  const unboundResourceCount = computed(() => resources.value.lyrics.length + resources.value.scores.length);

  const selectedManageableIds = computed(() =>
    options.tracks.value.filter((track) => selectedTrackIds.value.has(track.id) && track.canManage).map((track) => track.id)
  );

  function selectNav(next: MusicLibraryNav, playlistId: number | null = null) {
    nav.value = next;
    activePlaylistId.value = next === "playlist" ? playlistId : null;
    selectedTrackIds.value = new Set();
    if (next === "resources") void loadResources();
  }

  function openFocus(focus: MusicManagerFocus | null | undefined) {
    const resolved = resolveMusicManagerFocus(focus);
    nav.value = resolved.nav;
    activePlaylistId.value = resolved.playlistId;
    selectedTrackId.value = resolved.trackId;
    selectedTrackIds.value = new Set();
    selectionMode.value = false;
    if (resolved.nav === "resources") void loadResources();
  }

  function openTrackDetail(trackId: number) {
    selectedTrackId.value = trackId;
  }

  function closeTrackDetail() {
    selectedTrackId.value = null;
  }

  function toggleSelectionMode() {
    selectionMode.value = !selectionMode.value;
    if (!selectionMode.value) selectedTrackIds.value = new Set();
  }

  function toggleTrackSelected(trackId: number) {
    selectedTrackIds.value = toggleIdInSet(selectedTrackIds.value, trackId);
  }

  function clearSelection() {
    selectedTrackIds.value = new Set();
  }

  async function loadResources(force = false) {
    if (resourcesLoading.value) return;
    if (resourcesLoadedOnce && !force) return;
    resourcesLoading.value = true;
    resourcesError.value = "";
    try {
      resources.value = await options.request<MusicResourcePoolDTO>("/api/music/resources");
      resourcesLoadedOnce = true;
    } catch (error) {
      resourcesError.value = error instanceof Error ? error.message : "资源加载失败";
    } finally {
      resourcesLoading.value = false;
    }
  }

  async function bindLyrics(lyricId: number, trackId: number) {
    await options.request(`/api/music/lyrics/${lyricId}/bind`, { method: "POST", body: JSON.stringify({ trackId }) });
    await loadResources(true);
  }

  async function unbindLyrics(lyricId: number) {
    await options.request(`/api/music/lyrics/${lyricId}/unbind`, { method: "POST" });
    await loadResources(true);
  }

  async function bindScore(scoreId: number, trackId: number) {
    await options.request(`/api/music/scores/${scoreId}/bind`, { method: "POST", body: JSON.stringify({ trackId }) });
    await loadResources(true);
  }

  async function unbindScore(scoreId: number) {
    await options.request(`/api/music/scores/${scoreId}/unbind`, { method: "POST" });
    await loadResources(true);
  }

  async function deleteLyricsResource(lyricId: number) {
    await options.request(`/api/music/resources/lyrics/${lyricId}`, { method: "DELETE" });
    await loadResources(true);
  }

  async function deleteScoreResource(scoreId: number) {
    await options.request(`/api/music/resources/scores/${scoreId}`, { method: "DELETE" });
    await loadResources(true);
  }

  watch(
    () => options.tracks.value,
    (tracks) => {
      selectedTrackIds.value = pruneSelection(
        selectedTrackIds.value,
        tracks.map((track) => track.id)
      );
      if (selectedTrackId.value && !tracks.some((track) => track.id === selectedTrackId.value)) selectedTrackId.value = null;
    },
    { flush: "sync" }
  );

  watch(
    () => options.playlists.value,
    (playlists) => {
      if (!activePlaylistId.value || playlists.some((playlist) => playlist.id === activePlaylistId.value)) return;
      activePlaylistId.value = null;
      if (nav.value === "playlist") nav.value = "library";
    },
    { flush: "sync" }
  );

  if (options.initialFocus) openFocus(options.initialFocus);

  return {
    nav,
    activePlaylistId,
    activePlaylist,
    selectedTrackId,
    selectedTrack,
    query,
    sort,
    viewMode,
    selectionMode,
    selectedTrackIds,
    selectedManageableIds,
    navTracks,
    visibleTracks,
    resources,
    resourcesLoading,
    resourcesError,
    unboundResourceCount,
    selectNav,
    openFocus,
    openTrackDetail,
    closeTrackDetail,
    toggleSelectionMode,
    toggleTrackSelected,
    clearSelection,
    loadResources,
    bindLyrics,
    unbindLyrics,
    bindScore,
    unbindScore,
    deleteLyricsResource,
    deleteScoreResource
  };
}
