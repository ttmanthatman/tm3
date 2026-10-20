import { computed, nextTick, ref, watch, type Ref } from "vue";
import type {
  BibleListenerDTO,
  BibleReaderPresenceDTO,
  BookReaderPresenceDTO,
  FriendListenerDTO,
  FriendProgramDTO,
  MusicListenerDTO,
  MusicPlaylistDTO,
  MusicPlaylistSourceKind,
  MusicTrackDTO
} from "@shared/types";
import { api } from "../../api";
import { sortMusicTracks } from "../../musicPlayer";
import { useChatStore } from "../../store";
import type { MusicManagerFocus } from "./useMusicLibrary";

export type BibleListeningActivity = { bookName: string; chapter: number } | null;

interface UseMusicLibraryIntegrationOptions {
  showChatToolsMenu: Ref<boolean>;
  musicManagerRef: Ref<{ openFocus: (focus: MusicManagerFocus) => void } | null>;
  isMusicPlaying: () => boolean;
  currentTrack: () => MusicTrackDTO | null;
  currentTrackId: () => number | null;
  onlyFavorites: () => boolean;
  pause: (immediate?: boolean) => void;
  replaceCurrentTrack: (track: MusicTrackDTO, continuePlaying: boolean) => void;
  handlePlaylistDeleted: (playlistId: number) => void;
  loadMusicTracks: () => Promise<void>;
  onActivitySocketConnect: () => void;
  getBibleReadingActivity: () => { active: boolean; bookName: string | null };
  getBibleListeningActivity: () => BibleListeningActivity;
  getBookReadingActivity: () => { active: boolean; bookTitle: string | null };
}

export function useMusicLibraryIntegration(options: UseMusicLibraryIntegrationOptions) {
  const store = useChatStore();
  const musicTracks = ref<MusicTrackDTO[]>([]);
  const musicPlaylists = ref<MusicPlaylistDTO[]>([]);
  const musicSourceKind = ref<MusicPlaylistSourceKind>("library");
  const selectedMusicPlaylistId = ref<number | null>(null);
  const musicManagerOpen = ref(false);
  const musicManagerInitialFocus = ref<MusicManagerFocus | null>(null);
  const musicPlayerExpanded = ref(false);
  const musicListeners = ref<MusicListenerDTO[]>([]);
  const bibleReaders = ref<BibleReaderPresenceDTO[]>([]);
  const bibleListeners = ref<BibleListenerDTO[]>([]);
  const bookReaders = ref<BookReaderPresenceDTO[]>([]);
  const friendListeners = ref<FriendListenerDTO[]>([]);
  const friendListeningProgram = ref<FriendProgramDTO | null>(null);
  const presenceEmitCache = new Map<string, string>();
  let musicListenerHeartbeatTimer: number | undefined;

  const sortedMusicTracks = computed(() => sortMusicTracks(musicTracks.value, "manual"));
  const favoriteMusicTracks = computed(() => sortedMusicTracks.value.filter((track) => track.favorited));

  function toggleChatToolsMenu() {
    options.showChatToolsMenu.value = !options.showChatToolsMenu.value;
    if (options.showChatToolsMenu.value) musicPlayerExpanded.value = false;
  }

  function handleMusicFavoriteUpdated(event: { trackId?: number; favorited?: boolean }) {
    if (!Number.isFinite(event?.trackId) || typeof event?.favorited !== "boolean") return;
    musicTracks.value = musicTracks.value.map((track) => track.id === event.trackId ? { ...track, favorited: event.favorited } : track);
    musicPlaylists.value = musicPlaylists.value.map((playlist) => ({
      ...playlist,
      tracks: playlist.tracks.map((track) => track.id === event.trackId ? { ...track, favorited: event.favorited } : track)
    }));
  }

  async function toggleCurrentMusicFavorite(track?: MusicTrackDTO | PointerEvent) {
    const target = track && !(track instanceof PointerEvent) ? track : options.currentTrack();
    if (!target) return;
    const favorited = !target.favorited;
    handleMusicFavoriteUpdated({ trackId: target.id, favorited });
    try {
      await api(`/api/music/tracks/${target.id}/favorite`, {
        method: "PUT",
        body: JSON.stringify({ favorited })
      });
      if (!favorited && options.onlyFavorites() && options.currentTrackId() === target.id) {
        const next = favoriteMusicTracks.value[0];
        if (!next) {
          options.pause(true);
        } else {
          const continuePlaying = options.isMusicPlaying();
          options.replaceCurrentTrack(next, continuePlaying);
        }
      }
    } catch (error) {
      handleMusicFavoriteUpdated({ trackId: target.id, favorited: !favorited });
      alert(error instanceof Error ? error.message : "保存歌曲收藏失败");
    }
  }

  async function loadMusicPlaylists() {
    if (!store.account) return;
    const result = await api<{ playlists: MusicPlaylistDTO[] }>("/api/music/playlists").catch(() => ({ playlists: [] }));
    musicPlaylists.value = result.playlists;
    const selectedId = selectedMusicPlaylistId.value;
    if (selectedId && !musicPlaylists.value.some((playlist) => playlist.id === selectedId)) {
      const shared = await api<{ playlist: MusicPlaylistDTO }>(`/api/music/playlists/${selectedId}`).catch(() => null);
      if (shared?.playlist) musicPlaylists.value = [...musicPlaylists.value, shared.playlist];
      else {
        musicSourceKind.value = "library";
        selectedMusicPlaylistId.value = null;
      }
    }
  }

  function openMusicManager(focus?: MusicManagerFocus) {
    musicManagerInitialFocus.value = focus || null;
    musicManagerOpen.value = true;
    musicPlayerExpanded.value = false;
    options.showChatToolsMenu.value = false;
    if (focus) void nextTick(() => options.musicManagerRef.value?.openFocus(focus));
  }

  function closeMusicSurface() {
    musicManagerOpen.value = false;
    musicPlayerExpanded.value = false;
  }

  function handleMusicUpdated(event?: { action?: string; trackId?: number; heat?: number }) {
    if (event?.action === "heat-updated" && Number.isFinite(event.trackId) && Number.isFinite(event.heat)) {
      musicTracks.value = musicTracks.value.map((track) => (track.id === event.trackId ? { ...track, heat: Number(event.heat) } : track));
      return;
    }
    void options.loadMusicTracks();
  }

  function handleMusicPlaylistUpdated(event?: { playlistId?: number; deleted?: boolean }) {
    if (event?.deleted && Number.isFinite(event.playlistId)) options.handlePlaylistDeleted(Number(event.playlistId));
    void loadMusicPlaylists();
  }

  function handleMusicListeners(listeners: MusicListenerDTO[]) {
    musicListeners.value = Array.isArray(listeners)
      ? listeners.filter(
          (listener) =>
            Number.isFinite(listener?.accountId) &&
            Number.isFinite(listener?.trackId) &&
            typeof listener?.displayName === "string" &&
            typeof listener?.trackTitle === "string"
        )
      : [];
  }

  function handleBookReaders(readers: BookReaderPresenceDTO[]) {
    bookReaders.value = Array.isArray(readers)
      ? readers.filter(
          (reader) =>
            Number.isFinite(reader?.accountId) &&
            typeof reader?.displayName === "string" &&
            typeof reader?.bookTitle === "string"
        )
      : [];
  }

  function handleBibleReaders(readers: BibleReaderPresenceDTO[]) {
    bibleReaders.value = Array.isArray(readers)
      ? readers.filter(
          (reader) =>
            Number.isFinite(reader?.accountId) &&
            typeof reader?.displayName === "string" &&
            (reader.bookName === null || typeof reader.bookName === "string")
        )
      : [];
  }

  function handleBibleListeners(listeners: BibleListenerDTO[]) {
    bibleListeners.value = Array.isArray(listeners)
      ? listeners.filter(
          (listener) =>
            Number.isFinite(listener?.accountId) &&
            typeof listener?.displayName === "string" &&
            typeof listener?.bookName === "string" &&
            Number.isFinite(listener?.chapter)
        )
      : [];
  }

  function handleFriendListeners(listeners: FriendListenerDTO[]) {
    friendListeners.value = Array.isArray(listeners)
      ? listeners.filter(
          (listener) =>
            Number.isFinite(listener?.accountId) &&
            typeof listener?.displayName === "string" &&
            typeof listener?.programId === "string" &&
            typeof listener?.programTitle === "string"
        )
      : [];
  }

  // Presence emits are de-duplicated so idle clients stay silent. The periodic
  // heartbeat passes `keepalive` to force a re-send of *active* states only:
  // an emit can be dropped (server still registering handlers, auth refresh,
  // transport hiccup) and the server would otherwise never learn about it.
  function emitPresence(event: string, payload: unknown, force = false) {
    const serialized = JSON.stringify(payload ?? null);
    if (!force && presenceEmitCache.get(event) === serialized) return;
    presenceEmitCache.set(event, serialized);
    store.socket?.emit(event, payload);
  }

  function clearPresenceEmitCache() {
    presenceEmitCache.clear();
  }

  function publishMusicListening(keepalive = false) {
    const trackId = options.isMusicPlaying() ? options.currentTrack()?.id || null : null;
    emitPresence("music:listening", { trackId }, keepalive && trackId !== null);
  }

  function stopPublishingMusicListening() {
    emitPresence("music:listening", { trackId: null });
  }

  function publishBibleReading(keepalive = false) {
    const activity = options.getBibleReadingActivity();
    emitPresence("bible:reading", activity, keepalive && activity.active);
  }

  function publishBibleListening(keepalive = false) {
    const activity = options.getBibleListeningActivity();
    emitPresence("bible:listening", activity, keepalive && activity !== null);
  }

  function publishBookReading(keepalive = false) {
    const activity = options.getBookReadingActivity();
    emitPresence("book:reading", activity, keepalive && activity.active);
  }

  function stopPublishingBibleReading() {
    emitPresence("bible:reading", { active: false, bookName: null });
  }

  function stopPublishingBookReading() {
    emitPresence("book:reading", { active: false, bookTitle: null });
  }

  function publishFriendListening(keepalive = false) {
    const program = friendListeningProgram.value;
    emitPresence(
      "friend:listening",
      program ? { programId: program.id, programTitle: `${program.seriesTitle}·${program.title}`.slice(0, 200) } : null,
      keepalive && program !== null
    );
  }

  function stopPublishingFriendListening() {
    emitPresence("friend:listening", null);
  }

  function publishPresenceActivities(keepalive = false) {
    publishMusicListening(keepalive);
    publishBibleReading(keepalive);
    publishBibleListening(keepalive);
    publishBookReading(keepalive);
    publishFriendListening(keepalive);
  }

  function handlePresenceHeartbeat() {
    publishPresenceActivities(true);
  }

  function attachMusicSocket() {
    store.socket?.off("music:updated", handleMusicUpdated);
    store.socket?.on("music:updated", handleMusicUpdated);
    store.socket?.off("music:playlist-updated", handleMusicPlaylistUpdated);
    store.socket?.on("music:playlist-updated", handleMusicPlaylistUpdated);
    store.socket?.off("music:favorite-updated", handleMusicFavoriteUpdated);
    store.socket?.on("music:favorite-updated", handleMusicFavoriteUpdated);
    store.socket?.off("music:listeners", handleMusicListeners);
    store.socket?.on("music:listeners", handleMusicListeners);
    store.socket?.off("bible:readers", handleBibleReaders);
    store.socket?.on("bible:readers", handleBibleReaders);
    store.socket?.off("bible:listeners", handleBibleListeners);
    store.socket?.on("bible:listeners", handleBibleListeners);
    store.socket?.off("book:readers", handleBookReaders);
    store.socket?.on("book:readers", handleBookReaders);
    store.socket?.off("friend:listeners", handleFriendListeners);
    store.socket?.on("friend:listeners", handleFriendListeners);
    // The server registers its presence handlers asynchronously after the
    // transport connects and only then emits `session:ready`; publishing on the
    // raw `connect` event raced that setup and the first emits were dropped.
    store.socket?.off("session:ready", options.onActivitySocketConnect);
    store.socket?.on("session:ready", options.onActivitySocketConnect);
    if (musicListenerHeartbeatTimer) window.clearInterval(musicListenerHeartbeatTimer);
    musicListenerHeartbeatTimer = window.setInterval(handlePresenceHeartbeat, 15_000);
    presenceEmitCache.clear();
    publishPresenceActivities();
  }

  // The store replaces its Socket instance after an `io server disconnect`
  // (server restart, session replaced); handlers bound to the old instance
  // would silently stop receiving snapshots, so follow every replacement.
  watch(() => store.socket, (socket, previous) => {
    if (socket && socket !== previous) attachMusicSocket();
  });

  function stopPresenceHeartbeat() {
    if (musicListenerHeartbeatTimer) window.clearInterval(musicListenerHeartbeatTimer);
  }

  return {
    musicTracks,
    musicPlaylists,
    musicSourceKind,
    selectedMusicPlaylistId,
    musicManagerOpen,
    musicManagerInitialFocus,
    musicPlayerExpanded,
    musicListeners,
    bibleReaders,
    bibleListeners,
    bookReaders,
    friendListeners,
    friendListeningProgram,
    sortedMusicTracks,
    favoriteMusicTracks,
    toggleChatToolsMenu,
    handleMusicFavoriteUpdated,
    toggleCurrentMusicFavorite,
    loadMusicPlaylists,
    openMusicManager,
    closeMusicSurface,
    handleMusicUpdated,
    handleMusicPlaylistUpdated,
    handleMusicListeners,
    handleBookReaders,
    handleBibleReaders,
    handleBibleListeners,
    handleFriendListeners,
    clearPresenceEmitCache,
    publishMusicListening,
    stopPublishingMusicListening,
    publishBibleReading,
    publishBibleListening,
    publishBookReading,
    stopPublishingBibleReading,
    stopPublishingBookReading,
    publishFriendListening,
    stopPublishingFriendListening,
    publishPresenceActivities,
    attachMusicSocket,
    stopPresenceHeartbeat
  };
}
