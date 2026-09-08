import { ref, type Ref } from "vue";
import type { ChannelDTO, MusicPlaylistDTO, MusicTrackDTO } from "@shared/types";
import { getToken } from "../../api";
import { useChatStore } from "../../store";

export type AuthMode = "login" | "register" | "reception";

interface UseAuthOptions {
  initialAuthMode: AuthMode;
  showReceptionManager: Ref<boolean>;
  musicTracks: Ref<MusicTrackDTO[]>;
  musicPlaylists: Ref<MusicPlaylistDTO[]>;
  persistPlaybackState: () => void;
}

export function useAuth(options: UseAuthOptions) {
  const store = useChatStore();
  const username = ref("");
  const password = ref("");
  const displayName = ref("");
  const authMode = ref<AuthMode>(options.initialAuthMode);
  const loginError = ref("");

  function upsertReceptionRoom(channel: ChannelDTO) {
    const existing = store.channels.find((row) => row.id === channel.id);
    if (existing) Object.assign(existing, channel);
    else store.channels.push(channel);
  }

  async function handleReceptionCreated(channel: ChannelDTO) {
    upsertReceptionRoom(channel);
    await store.switchChannel(channel.id);
  }

  function handleReceptionUpdated(channel: ChannelDTO) {
    upsertReceptionRoom(channel);
  }

  async function handleReceptionDeleted(channelId: number) {
    const wasCurrent = store.currentChannelId === channelId;
    store.channels = store.channels.filter((row) => row.id !== channelId);
    if (wasCurrent) await store.loadChannels();
  }

  async function selectReceptionRoom(channelId: number) {
    options.showReceptionManager.value = false;
    await store.switchChannel(channelId);
  }

  function handleReceptionClosed() {
    loginError.value = "会客厅已经结束，相关内容已自动清除。";
  }

  async function logoutApp(revoke = true) {
    options.persistPlaybackState();
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.ready.catch(() => null);
      registration?.active?.postMessage({ type: "CLEAR_PRIVATE_CACHE", token: getToken() });
    }
    await store.logout(revoke);
    options.musicTracks.value = [];
    options.musicPlaylists.value = [];
  }

  return {
    username,
    password,
    displayName,
    authMode,
    loginError,
    handleReceptionCreated,
    handleReceptionUpdated,
    handleReceptionDeleted,
    selectReceptionRoom,
    handleReceptionClosed,
    logoutApp
  };
}
