import { computed, nextTick, ref, type Ref } from "vue";
import type {
  BibleFavoriteDTO,
  BibleFavoriteKeyDTO,
  BibleLookupDTO,
  BibleSessionPayloadDTO,
  FavoriteMessageDTO,
  MessageDTO
} from "@shared/types";
import { api } from "../../api";
import { groupBibleFavoritePassages, type BibleFavoritePassage } from "../../bibleFavorites";
import { parseBibleSessionPayload } from "../../bibleSessionShare";
import { useChatStore } from "../../store";
import { escapeHtmlText } from "../messages/messageRendering";

export type BibleWorkspaceHandle = {
  openLookupContext: (lookup: BibleLookupDTO) => Promise<void>;
  openSession: (payload: BibleSessionPayloadDTO) => Promise<void>;
};

interface UseBibleWorkspaceIntegrationOptions {
  showChannels: Ref<boolean>;
  showMembers: Ref<boolean>;
  showFavorites: Ref<boolean>;
  showBibleFavorites: Ref<boolean>;
  sermonWorkspaceOpen: Ref<boolean>;
  bookWorkspaceOpen: Ref<boolean>;
  saveReadPosition: () => void;
  currentChannelId: () => number | null;
  isTapSuppressed: () => boolean;
  publishBibleReading: () => void;
  publishBookReading: () => void;
  jumpToMessageInChannel: (channelId: number, messageId: number) => Promise<void>;
}

export function useBibleWorkspaceIntegration(options: UseBibleWorkspaceIntegrationOptions) {
  const store = useChatStore();
  const bibleOpen = ref(false);
  const bibleTargetChannelId = ref<number | null>(null);
  const bibleWorkspace = ref<BibleWorkspaceHandle | null>(null);
  const bibleReadingActivity = ref<{ active: boolean; bookName: string | null }>({ active: false, bookName: null });
  const bookReadingActivity = ref<{ active: boolean; bookTitle: string | null }>({ active: false, bookTitle: null });
  const bibleFavorites = ref<BibleFavoriteDTO[]>([]);
  const bibleFavoritesLoading = ref(false);
  const bibleFavoritesError = ref("");

  const bibleFavoritePassages = computed(() => groupBibleFavoritePassages(bibleFavorites.value));
  const bibleTargetChannel = computed(() => store.channels.find((channel) => channel.id === bibleTargetChannelId.value) || null);
  const bibleCanSend = computed(() => !!bibleTargetChannel.value && bibleTargetChannel.value.kind !== "music" && bibleTargetChannel.value.canWrite !== false);
  const bibleSendUnavailableReason = computed(() => {
    if (!bibleTargetChannel.value) return "进入圣经前的聊天室已不可用";
    if (bibleTargetChannel.value.kind === "music") return "音乐频道不能发送文字经文";
    if (bibleTargetChannel.value.canWrite === false) return "你在当前频道没有发送权限";
    return "";
  });
  // “打开的圣经”可分享到的频道：公开/私密聊天频道与私聊，且当前账号可发言
  const bibleShareChannels = computed(() =>
    store.channels.filter((channel) => (channel.kind === "standard" || channel.kind === "direct") && channel.canWrite !== false)
  );

  async function loadBibleFavorites() {
    if (!store.account || bibleFavoritesLoading.value) return;
    bibleFavoritesLoading.value = true;
    bibleFavoritesError.value = "";
    try {
      const result = await api<{ success: boolean; favorites: BibleFavoriteDTO[] }>("/api/bible/favorites");
      bibleFavorites.value = result.favorites;
    } catch (error) {
      bibleFavoritesError.value = error instanceof Error ? error.message : "经文收藏加载失败";
    } finally {
      bibleFavoritesLoading.value = false;
    }
  }

  async function updateBibleFavorites(verses: BibleFavoriteKeyDTO[], favorited: boolean, color?: string) {
    if (!verses.length || bibleFavoritesLoading.value) return;
    bibleFavoritesLoading.value = true;
    bibleFavoritesError.value = "";
    try {
      const result = await api<{ success: boolean; favorites: BibleFavoriteDTO[] }>("/api/bible/favorites", {
        method: favorited ? "POST" : "DELETE",
        body: JSON.stringify({ verses, ...(favorited && color ? { color } : {}) })
      });
      bibleFavorites.value = result.favorites;
    } catch (error) {
      bibleFavoritesError.value = error instanceof Error ? error.message : "经文收藏更新失败";
      throw error;
    } finally {
      bibleFavoritesLoading.value = false;
    }
  }

  async function openBibleFavorites() {
    if (!options.showBibleFavorites.value) options.saveReadPosition();
    options.showBibleFavorites.value = true;
    options.showFavorites.value = false;
    options.showChannels.value = false;
    await loadBibleFavorites();
  }

  function openBibleWorkspace() {
    if (!bibleOpen.value) options.saveReadPosition();
    options.showChannels.value = false;
    options.showMembers.value = false;
    options.sermonWorkspaceOpen.value = false;
    options.bookWorkspaceOpen.value = false;
    bibleTargetChannelId.value = options.currentChannelId();
    bibleOpen.value = true;
  }

  function closeBibleWorkspace() {
    bibleOpen.value = false;
  }

  async function openBibleFavoritePassage(passage: BibleFavoritePassage) {
    openBibleWorkspace();
    await nextTick();
    await bibleWorkspace.value?.openLookupContext(passage.lookup);
  }

  async function openFavoriteMessage(favorite: FavoriteMessageDTO) {
    await options.jumpToMessageInChannel(favorite.channel.id, favorite.message.id);
  }

  // 打开聊天室里分享的“打开的圣经”：各自在本地按相同窗格布局一起阅读
  async function openBibleSessionFromMessage(message: MessageDTO) {
    if (options.isTapSuppressed()) return;
    const payload = parseBibleSessionPayload(message.payload);
    if (!payload) {
      alert("这条圣经分享内容已失效");
      return;
    }
    openBibleWorkspace();
    await nextTick();
    await bibleWorkspace.value?.openSession(payload);
  }

  function handleBibleReadingChange(activity: { active: boolean; bookName: string | null }) {
    bibleReadingActivity.value = activity;
    options.publishBibleReading();
  }

  function handleBookReadingChange(activity: { active: boolean; bookTitle: string | null }) {
    bookReadingActivity.value = activity;
    options.publishBookReading();
  }

  async function sendBiblePassage(lookup: BibleLookupDTO) {
    const channel = bibleTargetChannel.value;
    if (!channel) throw new Error("进入圣经前的聊天室已不可用");
    if (!bibleCanSend.value) throw new Error(bibleSendUnavailableReason.value || "当前频道不能发送经文");
    if (!store.socket?.connected) throw new Error("聊天室连接尚未恢复，请稍后重试");
    const body = lookup.verses.map((verse) => verse.text).join("");
    const content = `${escapeHtmlText(lookup.normalizedReference)}<br>“${escapeHtmlText(body)}”<br>——${escapeHtmlText(lookup.translation)}`;
    await new Promise<void>((resolve, reject) => {
      store.socket?.emit(
        "message:send",
        { channelId: channel.id, content, type: "text", replyToId: null },
        (ack: { success?: boolean; message?: string }) => {
          if (ack?.success) resolve();
          else reject(new Error(ack?.message || "发送失败，请重试"));
        }
      );
    });
  }

  return {
    bibleOpen,
    bibleTargetChannelId,
    bibleWorkspace,
    bibleReadingActivity,
    bookReadingActivity,
    bibleFavorites,
    bibleFavoritesLoading,
    bibleFavoritesError,
    bibleFavoritePassages,
    bibleTargetChannel,
    bibleCanSend,
    bibleSendUnavailableReason,
    bibleShareChannels,
    loadBibleFavorites,
    updateBibleFavorites,
    openBibleFavorites,
    openBibleWorkspace,
    closeBibleWorkspace,
    openBibleFavoritePassage,
    openFavoriteMessage,
    openBibleSessionFromMessage,
    handleBibleReadingChange,
    handleBookReadingChange,
    sendBiblePassage
  };
}
