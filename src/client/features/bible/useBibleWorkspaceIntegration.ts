import { computed, nextTick, onScopeDispose, ref, watch, type Ref } from "vue";
import type { CopyworkSource } from "@shared/bibleCopywork";
import type { BibleTopicDTO } from "@shared/bibleTopics";
import { registerCopyworkNavigation, viewedCopyworkId } from "./copywork/copyworkViewerState";
import type {
  BibleFavoriteDTO,
  BibleFavoriteKeyDTO,
  BibleLookupDTO,
  BibleSessionPayloadDTO,
  FavoriteMessageDTO,
  MessageDTO
} from "@shared/types";
import { api } from "../../api";
import { useBibleDisplayLayout } from "./useBibleDisplayLayout";
import { groupBibleFavoritePassages, type BibleFavoritePassage } from "../../bibleFavorites";
import { parseBibleSessionPayload } from "../../bibleSessionShare";
import { useChatStore } from "../../store";
import { biblePassageShareContent } from "../reading-shares/readingShareMessage";
import { useMessageSender } from "../../messageSending";

export type BibleWorkspaceHandle = {
  openLookupContext: (lookup: BibleLookupDTO) => Promise<void>;
  openCopyworkContext: (source: CopyworkSource) => Promise<void>;
  openSession: (payload: BibleSessionPayloadDTO) => Promise<void>;
};

interface UseBibleWorkspaceIntegrationOptions {
  showChannels: Ref<boolean>;
  showMembers: Ref<boolean>;
  channelsCollapsed: Ref<boolean>;
  membersCollapsed: Ref<boolean>;
  showFavorites: Ref<boolean>;
  showGraceFavorites: Ref<boolean>;
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
  const layout = useBibleDisplayLayout(() => store.account?.id);
  const { bibleOpen } = layout;
  const bibleTargetChannelId = computed(() => options.currentChannelId());
  function collapseNavigation() {
    options.showChannels.value = false;
    options.showMembers.value = false;
    options.channelsCollapsed.value = true;
    options.membersCollapsed.value = true;
  }
  watch(() => store.account?.id, collapseNavigation);
  const bibleWorkspace = ref<BibleWorkspaceHandle | null>(null);
  onScopeDispose(registerCopyworkNavigation(async (source) => {
    viewedCopyworkId.value = "";
    openBibleWorkspace();
    await nextTick();
    if (!bibleWorkspace.value) throw new Error("圣经阅读器未能打开，请重试");
    await bibleWorkspace.value.openCopyworkContext(source);
  }));
  const bibleReadingActivity = ref<{ active: boolean; bookName: string | null }>({ active: false, bookName: null });
  const bookReadingActivity = ref<{ active: boolean; bookTitle: string | null }>({ active: false, bookTitle: null });
  const bibleFavorites = ref<BibleFavoriteDTO[]>([]);
  const bibleFavoritesLoading = ref(false);
  const bibleFavoritesError = ref("");
  const bibleTopics = ref<BibleTopicDTO[]>([]);
  const bibleTopicsBusy = ref(false);
  const bibleTopicsError = ref("");

  const bibleFavoritePassages = computed(() => groupBibleFavoritePassages(bibleFavorites.value));
  const bibleTargetChannel = computed(() => store.channels.find((channel) => channel.id === bibleTargetChannelId.value) || null);
  const bibleCanSend = computed(() => !!bibleTargetChannel.value && bibleTargetChannel.value.kind !== "music" && bibleTargetChannel.value.canWrite !== false);
  const bibleSendUnavailableReason = computed(() => {
    if (!bibleTargetChannel.value) return "当前聊天室不可用";
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
    void loadBibleTopics();
    try {
      const result = await api<{ success: boolean; favorites: BibleFavoriteDTO[] }>("/api/bible/favorites");
      bibleFavorites.value = result.favorites;
    } catch (error) {
      bibleFavoritesError.value = error instanceof Error ? error.message : "经文收藏加载失败";
    } finally {
      bibleFavoritesLoading.value = false;
    }
  }

  async function loadBibleTopics() {
    bibleTopicsError.value = "";
    try {
      const result = await api<{ success: boolean; topics: BibleTopicDTO[] }>("/api/bible/topics");
      bibleTopics.value = result.topics;
    } catch (error) {
      bibleTopicsError.value = error instanceof Error ? error.message : "经文主题加载失败";
    }
  }

  function replaceBibleTopic(topic: BibleTopicDTO) {
    const index = bibleTopics.value.findIndex((row) => row.id === topic.id);
    if (index >= 0) bibleTopics.value.splice(index, 1, topic);
  }

  async function runBibleTopicAction<T>(action: () => Promise<T>): Promise<T> {
    if (bibleTopicsBusy.value) throw new Error("主题操作进行中，请稍候");
    bibleTopicsBusy.value = true;
    bibleTopicsError.value = "";
    try {
      return await action();
    } catch (error) {
      bibleTopicsError.value = error instanceof Error ? error.message : "经文主题操作失败";
      throw error;
    } finally {
      bibleTopicsBusy.value = false;
    }
  }

  async function createBibleTopic(name: string) {
    const topic = await runBibleTopicAction(async () => {
      const result = await api<{ success: boolean; topic: BibleTopicDTO }>("/api/bible/topics", { method: "POST", body: JSON.stringify({ name }) });
      return result.topic;
    });
    bibleTopics.value = [topic, ...bibleTopics.value];
    return topic;
  }

  async function renameBibleTopic(topicId: number, name: string) {
    const topic = await runBibleTopicAction(async () => {
      const result = await api<{ success: boolean; topic: BibleTopicDTO }>(`/api/bible/topics/${topicId}`, { method: "PATCH", body: JSON.stringify({ name }) });
      return result.topic;
    });
    replaceBibleTopic(topic);
    return topic;
  }

  async function deleteBibleTopic(topicId: number) {
    await runBibleTopicAction(() => api<{ success: boolean }>(`/api/bible/topics/${topicId}`, { method: "DELETE" }));
    bibleTopics.value = bibleTopics.value.filter((topic) => topic.id !== topicId);
  }

  async function addBibleTopicPassages(topicId: number, reference: string) {
    const result = await runBibleTopicAction(() =>
      api<{ success: boolean; topic: BibleTopicDTO; added: number; duplicates: number }>(`/api/bible/topics/${topicId}/passages`, {
        method: "POST",
        body: JSON.stringify({ reference })
      })
    );
    replaceBibleTopic(result.topic);
    return result;
  }

  async function removeBibleTopicPassages(topicId: number, passageIds: number[]) {
    const topic = await runBibleTopicAction(async () => {
      const result = await api<{ success: boolean; topic: BibleTopicDTO }>(`/api/bible/topics/${topicId}/passages`, {
        method: "DELETE",
        body: JSON.stringify({ passageIds })
      });
      return result.topic;
    });
    replaceBibleTopic(topic);
    return topic;
  }

  // 把主题转发到当前聊天室：服务端按主题生成自包含的经文主题卡片消息
  async function shareBibleTopic(topicId: number) {
    const channel = bibleTargetChannel.value;
    if (!channel) throw new Error("当前聊天室不可用");
    if (!bibleCanSend.value) throw new Error(bibleSendUnavailableReason.value || "当前频道不能发送经文");
    return runBibleTopicAction(() =>
      api<{ success: boolean }>(`/api/bible/topics/${topicId}/share`, {
        method: "POST",
        body: JSON.stringify({ channelId: channel.id, clientRequestId: crypto.randomUUID() })
      })
    );
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
    options.showGraceFavorites.value = false;
    options.showChannels.value = false;
    await loadBibleFavorites();
  }

  function openBibleWorkspace() {
    if (!bibleOpen.value) options.saveReadPosition();
    collapseNavigation();
    options.sermonWorkspaceOpen.value = false;
    options.bookWorkspaceOpen.value = false;
    layout.openBible();
  }

  function closeBibleWorkspace() {
    collapseNavigation();
    bibleOpen.value = false;
  }

  async function openBibleFavoritePassage(passage: BibleFavoritePassage) {
    await openBiblePassage(passage.lookup);
  }

  async function openBiblePassage(lookup: BibleLookupDTO) {
    openBibleWorkspace();
    await nextTick();
    if (!bibleWorkspace.value) throw new Error("圣经阅读器未能打开，请重试");
    await bibleWorkspace.value.openLookupContext(lookup);
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

  const { send: sendMergedMessage } = useMessageSender({ getSocket: () => store.socket });
  async function sendBibleText(content: string, requestId: string) {
    const channel = bibleTargetChannel.value;
    if (!channel) throw new Error("当前聊天室不可用");
    if (!bibleCanSend.value) throw new Error(bibleSendUnavailableReason.value || "当前频道不能发送经文");
    const result = await sendMergedMessage({ channelId: channel.id, content, type: "text", replyToId: null, clientRequestId: requestId });
    if (!result.ok) throw new Error(result.message);
  }

  async function sendBiblePassage(lookup: BibleLookupDTO, includeTranslation = false) {
    const channel = bibleTargetChannel.value;
    if (!channel) throw new Error("当前聊天室不可用");
    if (!bibleCanSend.value) throw new Error(bibleSendUnavailableReason.value || "当前频道不能发送经文");
    if (!store.socket?.connected) throw new Error("聊天室连接尚未恢复，请稍后重试");
    const content = biblePassageShareContent(lookup, includeTranslation);
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
    ...layout,
    bibleTargetChannelId,
    bibleWorkspace,
    bibleReadingActivity,
    bookReadingActivity,
    bibleFavorites,
    bibleFavoritesLoading,
    bibleFavoritesError,
    bibleFavoritePassages,
    bibleTopics,
    bibleTopicsBusy,
    bibleTopicsError,
    bibleTargetChannel,
    bibleCanSend,
    bibleSendUnavailableReason,
    bibleShareChannels,
    loadBibleFavorites,
    updateBibleFavorites,
    loadBibleTopics,
    createBibleTopic,
    renameBibleTopic,
    deleteBibleTopic,
    addBibleTopicPassages,
    removeBibleTopicPassages,
    shareBibleTopic,
    openBibleFavorites,
    openBibleWorkspace,
    closeBibleWorkspace,
    openBibleFavoritePassage,
    openBiblePassage,
    openFavoriteMessage,
    openBibleSessionFromMessage,
    handleBibleReadingChange,
    handleBookReadingChange,
    sendBiblePassage,
    sendBibleText
  };
}
