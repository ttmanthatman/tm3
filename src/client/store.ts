import { defineStore } from "pinia";
import { io, type Socket } from "socket.io-client";
import { markRaw } from "vue";
import type { AccountDTO, AppearanceDTO, ChannelDTO, LikeNotificationDTO, MessageDTO, MessageReactionsDTO, PinnedDTO, SermonEndedEvent, SermonInvitedEvent, SermonRemovedEvent, SermonStateDTO } from "@shared/types";
import { api, clearToken, getToken, setToken } from "./api";
import {
  applySermonDirectory,
  applySermonEnded,
  applySermonInvited,
  applySermonRemoved,
  applySermonRequestDecision,
  applySermonState,
  refreshSermonDirectory,
  releaseSermonAudienceSeat,
  resetSermonState,
  setSermonOwnAccountId
} from "./features/sermon/useSermon";
import { DEFAULT_PARALLAX_KITS } from "@shared/parallax";
import { DEFAULT_COMPOSER_PROMPTS, DEFAULT_COMPOSER_PROMPT_APPEAR, DEFAULT_COMPOSER_PROMPT_DISAPPEAR, DEFAULT_COMPOSER_PROMPT_GAP, DEFAULT_COMPOSER_PROMPT_INTERVAL } from "@shared/composerPrompts";
import { UNREAD_COUNT_CAP, isOwnMessage, loadUnreadState, noteUnreadIncoming, recordChannelRead, saveUnreadState } from "./unread";
import { clearPersistedWindows, lastMsgwinAccount, loadPersistedWindow, persistWindowThrottled, rememberMsgwinAccount } from "./messageWindowCache";
import { mergeChannelUpdate, mergeMessageUpdate } from "./messageUpdates";
import { noteChannelMessage, orderChannels } from "./channelOrdering";

type TypingState = Record<string, { displayName: string; timer: number }>;
type MemberRow = {
  id: number;
  accountId?: number;
  kind: string;
  username?: string;
  displayName: string;
  avatarPath?: string | null;
  role?: string;
  membershipRole?: string | null;
  isSiteAdmin?: boolean;
};
type MessageWindowCache = {
  messages: MessageDTO[];
  hasOlder: boolean;
  hasNewer: boolean;
  prefetchedOlder: MessageDTO[];
};
type ChannelReadSync = { channelId: number; lastReadMessageId: number; unreadCount: number };
const MESSAGE_PAGE_SIZE = 80;
const MESSAGE_WINDOW_LIMIT = 480;
const MESSAGE_CACHE_KEY_LIMIT = 24;

// Resolves when the post-identity channel data (channels, messages, members,
// like-notifications) finishes loading in the background. bootstrap() only
// waits for appearance + identity so the chat shell can render cached
// messages after a single round trip; callers that need channels (deep links)
// await this via whenChannelsReady().
let channelsReadyPromise: Promise<void> | null = null;

// Realtime channel events and the matching HTTP mutation response can arrive
// together. Share their revalidation so weak connections do not fetch the
// same channel list and current message window several times in parallel.
let channelLoadPromise: Promise<void> | null = null;

// First message page for the persisted channel, fired by bootstrap() in
// parallel with the identity request — it needs only the token, not the
// account. loadChannels() reuses it when the channel survived revalidation.
let initialMessagesPromise: Promise<void> | null = null;

function loadInitialPersistedWindow(): { accountId: number; messages: MessageDTO[]; hasOlder: boolean } | null {
  try {
    if (!getToken()) return null;
    const accountId = lastMsgwinAccount();
    const channelId = Number(localStorage.getItem("team-chat-current-channel") || 0);
    if (!accountId || !channelId) return null;
    const prayerOnly = localStorage.getItem("team-chat-message-view") === "prayers";
    const persisted = loadPersistedWindow(accountId, `${channelId}:${prayerOnly ? "prayers" : "chat"}`);
    if (!persisted?.messages.length) return null;
    return { accountId, messages: persisted.messages, hasOlder: persisted.hasOlder };
  } catch {
    return null;
  }
}
const defaultAppearance: AppearanceDTO = {
  appTitle: "Team Chat",
  appIconPath: null,
  wallpaperPath: null,
  wallpaperFit: "cover",
  wallpaperPanFocusX: 0.5,
  wallpaperPanDirection: "left",
  wallpaperPanSpeed: 0.18,
  parallaxKit: "none",
  parallaxSpeed: 1,
  parallaxKits: DEFAULT_PARALLAX_KITS.map((kit) => ({ ...kit, layers: kit.layers.map((layer) => ({ ...layer })) })),
  loginIconPath: null,
  loginShowIcon: true,
  loginTitle: "Team Chat",
  loginSubtitle: "轻快、稳定的团队聊天。",
  loginShowSubtitle: true,
  loginBackgroundPath: null,
  loginBackgroundFit: "cover",
  loginFormPosition: "middle",
  registrationEnabled: false,
  musicPanelFontSize: 20,
  prayerBubbleMineColor: "#f0fbf1",
  prayerBubbleOtherColor: "#fffaf0",
  flashEffect: {
    colors: ["#fff176", "#ef4444", "#60a5fa", "#6d28d9", "#34d399", "#111827"],
    intervalSeconds: 0.4,
    transitionMode: "smooth"
  },
  customThemes: [],
  composerPrompts: [...DEFAULT_COMPOSER_PROMPTS],
  composerPromptIntervalSeconds: DEFAULT_COMPOSER_PROMPT_INTERVAL,
  composerPromptAppearSeconds: DEFAULT_COMPOSER_PROMPT_APPEAR,
  composerPromptDisappearSeconds: DEFAULT_COMPOSER_PROMPT_DISAPPEAR,
  composerPromptGapSeconds: DEFAULT_COMPOSER_PROMPT_GAP
};

export const useChatStore = defineStore("chat", {
  state: () => {
    const hydrated = loadInitialPersistedWindow();
    return {
    account: null as AccountDTO | null,
    appearance: { ...defaultAppearance } as AppearanceDTO,
    channels: [] as ChannelDTO[],
    currentChannelId: Number(localStorage.getItem("team-chat-current-channel") || 0),
    prayerOnly: localStorage.getItem("team-chat-message-view") === "prayers",
    previousChannelId: 0,
    messages: (hydrated ? [...hydrated.messages] : []) as MessageDTO[],
    messageCache: {} as Record<string, MessageWindowCache>,
    messageCacheOrder: [] as string[],
    hasOlderMessages: hydrated?.hasOlder ?? false,
    hasNewerMessages: false,
    prefetchedOlderMessages: [] as MessageDTO[],
    loadingInitialMessages: false,
    loadingOlderMessages: false,
    loadingNewerMessages: false,
    prefetchingOlderMessages: false,
    messageLoadError: "",
    oldestMessageReached: false,
    members: [] as MemberRow[],
    pinned: null as PinnedDTO | null,
    online: [] as Array<{ accountId: number; actorId: number; displayName: string; avatarPath?: string | null }>,
    typing: {} as TypingState,
    lastIncomingMessage: null as MessageDTO | null,
    unreadCounts: {} as Record<number, number>,
    unreadLastRead: {} as Record<number, number>,
    unreadAccountId: 0,
    unreadSeeded: false,
    likeNotifications: [] as LikeNotificationDTO[],
    socket: null as Socket | null,
    connectionState: "offline" as "offline" | "connecting" | "connected",
    loading: false,
    hydratedPersistedAccountId: hydrated?.accountId ?? 0
    };
  },
  getters: {
    currentChannel(state) {
      return state.channels.find((ch) => ch.id === state.currentChannelId) || state.channels[0] || null;
    },
    aiChannel(state) {
      return state.channels.find((ch) => ch.kind === "aiLounge") || null;
    },
    defaultChannel(state) {
      return state.channels.find((ch) => ch.isDefault) || null;
    }
  },
  actions: {
    messageCacheKey(channelId?: number, prayerOnly?: boolean) {
      const id = channelId ?? this.currentChannelId;
      const prayers = prayerOnly ?? this.prayerOnly;
      return `${id}:${prayers ? "prayers" : "chat"}`;
    },
    restoreCachedMessages(channelId?: number, prayerOnly?: boolean) {
      const cached = this.messageCache[this.messageCacheKey(channelId, prayerOnly)];
      // Windows parked mid-history would flash stale content before the latest
      // page replaces them; only restore windows anchored at the newest message.
      const usable = cached && !cached.hasNewer ? cached : null;
      this.messages = usable ? [...usable.messages] : [];
      this.hasOlderMessages = usable?.hasOlder || false;
      this.hasNewerMessages = false;
      this.prefetchedOlderMessages = usable ? [...usable.prefetchedOlder] : [];
      this.loadingInitialMessages = false;
      this.loadingOlderMessages = false;
      this.loadingNewerMessages = false;
      this.prefetchingOlderMessages = false;
      this.messageLoadError = "";
      this.oldestMessageReached = false;
    },
    cacheCurrentMessages() {
      if (!this.currentChannelId) return;
      const key = this.messageCacheKey();
      this.messageCache[key] = {
        messages: [...this.messages],
        hasOlder: this.hasOlderMessages,
        hasNewer: this.hasNewerMessages,
        prefetchedOlder: [...this.prefetchedOlderMessages]
      };
      this.messageCacheOrder = [key, ...this.messageCacheOrder.filter((item) => item !== key)].slice(0, MESSAGE_CACHE_KEY_LIMIT);
      for (const staleKey of Object.keys(this.messageCache)) {
        if (!this.messageCacheOrder.includes(staleKey)) delete this.messageCache[staleKey];
      }
      if (this.account && !this.hasNewerMessages) persistWindowThrottled(this.account.id, key, this.messages, this.hasOlderMessages);
    },
    resetMessageWindow() {
      this.messages = [];
      this.hasOlderMessages = false;
      this.hasNewerMessages = false;
      this.prefetchedOlderMessages = [];
      this.loadingInitialMessages = false;
      this.loadingOlderMessages = false;
      this.loadingNewerMessages = false;
      this.prefetchingOlderMessages = false;
      this.messageLoadError = "";
      this.oldestMessageReached = false;
    },
    dedupeMessages(messages: MessageDTO[]) {
      const seen = new Set<number>();
      const rows: MessageDTO[] = [];
      for (const message of messages) {
        if (seen.has(message.id)) {
          const index = rows.findIndex((row) => row.id === message.id);
          if (index >= 0) rows.splice(index, 1, message);
          continue;
        }
        seen.add(message.id);
        rows.push(message);
      }
      return rows;
    },
    trimMessageWindow(preferKeep: "older" | "newer" = "newer") {
      if (this.messages.length <= MESSAGE_WINDOW_LIMIT) return;
      const extra = this.messages.length - MESSAGE_WINDOW_LIMIT;
      if (preferKeep === "older") {
        this.messages.splice(MESSAGE_WINDOW_LIMIT, extra);
        this.hasNewerMessages = true;
      } else {
        this.messages.splice(0, extra);
        this.hasOlderMessages = true;
        this.prefetchedOlderMessages = [];
      }
    },
    updateMessageWindowFlagsFromRows(rows: MessageDTO[], direction: "older" | "newer" | "initial") {
      if (direction === "older") {
        this.hasOlderMessages = rows.length >= MESSAGE_PAGE_SIZE;
        if (!this.hasOlderMessages) this.oldestMessageReached = true;
      }
      if (direction === "newer") this.hasNewerMessages = rows.length >= MESSAGE_PAGE_SIZE;
      if (direction === "initial") {
        this.hasOlderMessages = rows.length >= MESSAGE_PAGE_SIZE;
        this.hasNewerMessages = false;
        this.oldestMessageReached = rows.length < MESSAGE_PAGE_SIZE;
      }
    },
    messageQuery(channelId: number, prayerOnly: boolean, params: Record<string, number | string> = {}) {
      const query = new URLSearchParams({ channelId: String(channelId), limit: String(MESSAGE_PAGE_SIZE) });
      if (prayerOnly) query.set("prayers", "1");
      for (const [key, value] of Object.entries(params)) query.set(key, String(value));
      return `/api/messages?${query.toString()}`;
    },
    async bootstrap() {
      const tasks: Promise<unknown>[] = [this.loadAppearance()];
      if (getToken()) {
        // The first message page needs only the persisted channel and token,
        // so it starts now instead of waiting for identity and channels.
        // Failures already surface through messageLoadError.
        if (this.currentChannelId) initialMessagesPromise = this.loadMessages().catch(() => undefined);
        tasks.push(this.refreshCurrentAccount().then((ok) => { if (ok) this.connectSocket(); }));
      }
      await Promise.all(tasks);
    },
    whenChannelsReady() {
      return channelsReadyPromise ?? Promise.resolve();
    },
    async refreshCurrentAccount(preferredChannelId?: number) {
      if (!getToken()) return false;
      try {
        const channelId = preferredChannelId ?? this.currentChannelId;
        const me = await api<{ account: AccountDTO; token?: string }>("/api/auth/me");
        if (me.token) setToken(me.token);
        this.account = me.account;
        if (this.hydratedPersistedAccountId && this.hydratedPersistedAccountId !== me.account.id) {
          this.resetMessageWindow();
          // bootstrap() fired the first page before identity was known; if it
          // already landed, the reset above wiped it, so fetch it again.
          if (initialMessagesPromise) initialMessagesPromise = this.loadMessages().catch(() => undefined);
        }
        this.hydratedPersistedAccountId = 0;
        rememberMsgwinAccount(me.account.id);
        this.initUnreadForAccount();
        channelsReadyPromise = Promise.all([this.loadLikeNotifications(), this.loadChannels(channelId)])
          .then(() => {
            void this.seedUnreadCounts();
          })
          .catch((error: unknown) => {
            // Channel data revalidates in the background after the identity
            // phase; a failure here surfaces inline instead of replacing the
            // already-rendered cached messages with a full-screen error.
            this.messageLoadError = error instanceof Error ? error.message : "频道加载失败";
          });
        return true;
      } catch {
        await this.logout(false);
        return false;
      }
    },
    async afterLogin(account: AccountDTO) {
      this.account = account;
      rememberMsgwinAccount(account.id);
      this.initUnreadForAccount();
      await Promise.all([this.loadLikeNotifications(), this.loadChannels()]);
      void this.seedUnreadCounts();
      this.connectSocket();
    },
    async logout(revoke = true) {
      if (revoke && getToken()) await api("/api/auth/logout", { method: "POST", body: JSON.stringify({}) }).catch(() => undefined);
      clearPersistedWindows(this.account?.id || lastMsgwinAccount());
      rememberMsgwinAccount(0);
      this.socket?.disconnect();
      this.socket = null;
      this.connectionState = "offline";
      this.account = null;
      resetSermonState();
      this.likeNotifications = [];
      this.unreadCounts = {};
      this.unreadLastRead = {};
      this.unreadAccountId = 0;
      this.unreadSeeded = false;
      this.hydratedPersistedAccountId = 0;
      initialMessagesPromise = null;
      this.resetMessageWindow();
      this.messageCache = {};
      this.messageCacheOrder = [];
      clearToken();
    },
    async loadAppearance() {
      this.appearance = await api<AppearanceDTO>("/api/settings/appearance").catch(() => ({ ...defaultAppearance }));
    },
    async loadLikeNotifications() {
      const result = await api<{ notifications: LikeNotificationDTO[] }>("/api/like-notifications").catch(() => ({ notifications: [] }));
      this.likeNotifications = result.notifications;
    },
    initUnreadForAccount() {
      if (!this.account || this.unreadAccountId === this.account.id) return;
      const state = loadUnreadState(this.account.id);
      this.unreadAccountId = this.account.id;
      this.unreadLastRead = state.lastRead;
      this.unreadCounts = state.counts;
      this.unreadSeeded = false;
    },
    persistUnreadState() {
      if (!this.unreadAccountId) return;
      saveUnreadState(this.unreadAccountId, { lastRead: this.unreadLastRead, counts: this.unreadCounts });
    },
    noteUnreadMessage(message: MessageDTO) {
      const channel = this.channels.find((ch) => ch.id === message.channelId);
      this.channels = noteChannelMessage(this.channels, message.channelId, message.id);
      const current = message.channelId === this.currentChannelId && !this.prayerOnly;
      noteUnreadIncoming(
        { lastRead: this.unreadLastRead, counts: this.unreadCounts },
        {
          channelId: message.channelId,
          messageId: message.id,
          own: isOwnMessage(message.sender, this.account),
          current,
          chatCapable: channel ? channel.kind !== "music" : true
        }
      );
      this.persistUnreadState();
      if (current) void this.syncChannelRead(message.channelId, message.id);
    },
    applyChannelRead(event: ChannelReadSync) {
      const currentPosition = this.unreadLastRead[event.channelId] ?? 0;
      if (event.lastReadMessageId < currentPosition) return;
      this.unreadLastRead[event.channelId] = event.lastReadMessageId;
      this.unreadCounts[event.channelId] = Math.min(Math.max(0, Math.floor(event.unreadCount) || 0), UNREAD_COUNT_CAP);
      this.persistUnreadState();
    },
    async syncChannelRead(channelId: number, lastReadMessageId: number) {
      if (!Number.isInteger(channelId) || channelId <= 0 || !Number.isInteger(lastReadMessageId) || lastReadMessageId <= 0) return;
      try {
        const result = await api<ChannelReadSync>(`/api/channels/${channelId}/read`, {
          method: "PUT",
          body: JSON.stringify({ lastReadMessageId })
        });
        if (Number.isInteger(result.channelId) && Number.isInteger(result.lastReadMessageId) && Number.isFinite(result.unreadCount)) {
          this.applyChannelRead(result);
        }
      } catch {
        // Local persistence remains the offline fallback; the next seed merges
        // this position into the account-level server state.
      }
    },
    markChannelRead(channelId?: number) {
      const id = channelId ?? this.currentChannelId;
      if (!id) return;
      const channel = this.channels.find((ch) => ch.id === id);
      const newestLoaded = id === this.currentChannelId ? this.messages.reduce((max, message) => Math.max(max, message.id), 0) : 0;
      const lastReadMessageId = Math.max(channel?.lastMessageId ?? 0, newestLoaded);
      recordChannelRead({ lastRead: this.unreadLastRead, counts: this.unreadCounts }, id, lastReadMessageId);
      this.persistUnreadState();
      void this.syncChannelRead(id, lastReadMessageId);
    },
    async seedUnreadCounts() {
      if (this.unreadSeeded || !this.account) return;
      this.unreadSeeded = true;
      const chatChannels = this.channels.filter((channel) => channel.kind !== "music");
      const latestAtStart = new Map(chatChannels.map((channel) => [channel.id, channel.lastMessageId ?? 0]));
      const readAtStart = new Map(chatChannels.map((channel) => [channel.id, this.unreadLastRead[channel.id]]));
      const localHints = Object.fromEntries(
        chatChannels
          .filter((channel) => this.unreadLastRead[channel.id] !== undefined)
          .map((channel) => [channel.id, this.unreadLastRead[channel.id]])
      );
      try {
        const result = await api<{ counts: Record<string, number>; lastRead: Record<string, number> }>(
          `/api/messages/unread-counts?lastRead=${encodeURIComponent(JSON.stringify(localHints))}`
        );
        const serverPositions = result.lastRead || {};
        let needsResync = false;
        for (const channel of chatChannels) {
          const currentChannel = this.channels.find((row) => row.id === channel.id);
          if ((currentChannel?.lastMessageId ?? 0) > (latestAtStart.get(channel.id) ?? 0) || this.unreadLastRead[channel.id] !== readAtStart.get(channel.id)) {
            needsResync = true;
            continue;
          }
          this.unreadCounts[channel.id] = Math.min(Math.max(0, Math.floor(Number(result.counts[channel.id])) || 0), UNREAD_COUNT_CAP);
          const position = Math.floor(Number(serverPositions[channel.id]));
          if (Number.isFinite(position) && position >= 0) this.unreadLastRead[channel.id] = position;
        }
        this.persistUnreadState();
        if (needsResync) {
          this.unreadSeeded = false;
          void this.seedUnreadCounts();
        }
      } catch {
        this.unreadSeeded = false;
      }
    },
    updateMessageReactions(messageId: number, reactions: Partial<MessageReactionsDTO>) {
      const message = this.messages.find((row) => row.id === messageId);
      if (message) message.reactions = { ...(message.reactions || { likeCount: 0, likedBy: [], favoriteCount: 0, currentUserLiked: false, currentUserFavorited: false }), ...reactions };
      if (this.pinned?.message?.id === messageId) {
        this.pinned.message.reactions = { ...(this.pinned.message.reactions || { likeCount: 0, likedBy: [], favoriteCount: 0, currentUserLiked: false, currentUserFavorited: false }), ...reactions };
      }
      this.cacheCurrentMessages();
    },
    async loadChannels(preferredChannelId = 0) {
      if (channelLoadPromise) return channelLoadPromise;
      const currentLoad = (async () => {
        const result = await api<{ channels: ChannelDTO[] }>("/api/channels");
        this.channels = orderChannels(result.channels.filter(Boolean));
        const restoredChannelId = this.currentChannelId;
        const candidates = [this.currentChannelId, preferredChannelId, this.previousChannelId];
        const nextChannelId = candidates.find((id) => id && this.channels.some((ch) => ch.id === id)) || this.channels[0]?.id || 0;
        this.currentChannelId = nextChannelId;
        if (this.currentChannelId) {
          localStorage.setItem("team-chat-current-channel", String(this.currentChannelId));
          // bootstrap() may already have the first page in flight (or done) for
          // the restored channel; reuse it instead of duplicating the request.
          const earlyMessages = initialMessagesPromise;
          initialMessagesPromise = null;
          const messagesReady = earlyMessages && nextChannelId === restoredChannelId ? earlyMessages : this.loadMessages();
          await Promise.all([messagesReady, this.loadMembers()]);
        } else {
          initialMessagesPromise = null;
          localStorage.removeItem("team-chat-current-channel");
          this.resetMessageWindow();
          this.members = [];
          this.pinned = null;
        }
      })();
      channelLoadPromise = currentLoad;
      try {
        await currentLoad;
      } finally {
        if (channelLoadPromise === currentLoad) channelLoadPromise = null;
      }
    },
    async switchChannel(id: number) {
      if (this.currentChannelId === id && !this.prayerOnly) return;
      this.cacheCurrentMessages();
      this.previousChannelId = this.currentChannelId;
      this.currentChannelId = id;
      this.prayerOnly = false;
      localStorage.setItem("team-chat-message-view", "chat");
      localStorage.setItem("team-chat-current-channel", String(id));
      this.restoreCachedMessages(id, false);
      this.pinned = this.channels.find((ch) => ch.id === id)?.pinned || null;
      this.socket?.emit("channel:join", { channelId: id });
      await Promise.all([this.loadMessages(), this.loadMembers()]);
    },
    async switchPrayerView(id: number) {
      this.cacheCurrentMessages();
      if (this.currentChannelId !== id) {
        this.previousChannelId = this.currentChannelId;
        this.currentChannelId = id;
        localStorage.setItem("team-chat-current-channel", String(id));
        this.socket?.emit("channel:join", { channelId: id });
      }
      this.prayerOnly = true;
      localStorage.setItem("team-chat-message-view", "prayers");
      this.restoreCachedMessages(id, true);
      this.pinned = this.channels.find((ch) => ch.id === id)?.pinned || null;
      await this.loadMessages();
      await this.loadMembers();
    },
    async switchChatView() {
      if (!this.prayerOnly) return;
      this.cacheCurrentMessages();
      this.prayerOnly = false;
      localStorage.setItem("team-chat-message-view", "chat");
      this.restoreCachedMessages(this.currentChannelId, false);
      await this.loadMessages();
    },
    async loadMessages() {
      if (!this.currentChannelId) return;
      const channelId = this.currentChannelId;
      const prayerOnly = this.prayerOnly;
      const messageIdsBeforeLoad = new Set(this.messages.map((message) => message.id));
      this.loading = true;
      this.loadingInitialMessages = true;
      this.messageLoadError = "";
      try {
        const result = await api<{ messages: MessageDTO[] }>(this.messageQuery(channelId, prayerOnly));
        if (this.currentChannelId !== channelId || this.prayerOnly !== prayerOnly) return;
        const messagesReceivedDuringLoad = this.messages.filter((message) => !messageIdsBeforeLoad.has(message.id));
        this.messages = this.dedupeMessages([...result.messages, ...messagesReceivedDuringLoad]);
        this.prefetchedOlderMessages = [];
        this.updateMessageWindowFlagsFromRows(result.messages, "initial");
        this.cacheCurrentMessages();
        this.pinned = this.channels.find((ch) => ch.id === this.currentChannelId)?.pinned || null;
        if (!prayerOnly) this.markChannelRead(channelId);
        void this.prefetchOlderMessages();
      } catch (error) {
        if (this.currentChannelId === channelId && this.prayerOnly === prayerOnly) this.messageLoadError = error instanceof Error ? error.message : "消息加载失败";
        throw error;
      } finally {
        if (this.currentChannelId === channelId && this.prayerOnly === prayerOnly) {
          this.loading = false;
          this.loadingInitialMessages = false;
        }
      }
    },
    async prefetchOlderMessages() {
      if (!this.currentChannelId || !this.hasOlderMessages || this.prefetchedOlderMessages.length || this.prefetchingOlderMessages || this.loadingOlderMessages) return;
      const channelId = this.currentChannelId;
      const prayerOnly = this.prayerOnly;
      const before = this.messages.find((message) => message.id > 0)?.id || 0;
      if (!before) return;
      this.prefetchingOlderMessages = true;
      try {
        const result = await api<{ messages: MessageDTO[] }>(this.messageQuery(channelId, prayerOnly, { before }));
        if (this.currentChannelId !== channelId || this.prayerOnly !== prayerOnly) return;
        this.prefetchedOlderMessages = result.messages;
        if (result.messages.length < MESSAGE_PAGE_SIZE) this.hasOlderMessages = false;
        this.cacheCurrentMessages();
      } catch {
        // Prefetch is an optimization; visible loading will report errors.
      } finally {
        this.prefetchingOlderMessages = false;
      }
    },
    async loadOlderMessages() {
      if (!this.currentChannelId || this.loadingOlderMessages || (!this.hasOlderMessages && !this.prefetchedOlderMessages.length)) return false;
      this.loadingOlderMessages = true;
      this.messageLoadError = "";
      const channelId = this.currentChannelId;
      const prayerOnly = this.prayerOnly;
      try {
        const before = this.messages.find((message) => message.id > 0)?.id || 0;
        const rows = this.prefetchedOlderMessages.length
          ? this.prefetchedOlderMessages
          : before
            ? (await api<{ messages: MessageDTO[] }>(this.messageQuery(channelId, prayerOnly, { before }))).messages
            : [];
        if (this.currentChannelId !== channelId || this.prayerOnly !== prayerOnly) return false;
        this.prefetchedOlderMessages = [];
        this.messages = this.dedupeMessages([...rows, ...this.messages]);
        this.updateMessageWindowFlagsFromRows(rows, "older");
        this.trimMessageWindow("older");
        this.cacheCurrentMessages();
        void this.prefetchOlderMessages();
        return rows.length > 0;
      } catch (error) {
        if (this.currentChannelId === channelId && this.prayerOnly === prayerOnly) this.messageLoadError = error instanceof Error ? error.message : "更早消息加载失败";
        return false;
      } finally {
        if (this.currentChannelId === channelId && this.prayerOnly === prayerOnly) this.loadingOlderMessages = false;
      }
    },
    async loadNewerMessages() {
      if (!this.currentChannelId || this.loadingNewerMessages || !this.hasNewerMessages) return false;
      this.loadingNewerMessages = true;
      this.messageLoadError = "";
      const channelId = this.currentChannelId;
      const prayerOnly = this.prayerOnly;
      try {
        const positiveMessages = this.messages.filter((message) => message.id > 0);
        const after = positiveMessages[positiveMessages.length - 1]?.id || 0;
        const result = after ? await api<{ messages: MessageDTO[] }>(this.messageQuery(channelId, prayerOnly, { after })) : { messages: [] };
        if (this.currentChannelId !== channelId || this.prayerOnly !== prayerOnly) return false;
        this.messages = this.dedupeMessages([...this.messages, ...result.messages]);
        this.updateMessageWindowFlagsFromRows(result.messages, "newer");
        this.trimMessageWindow("newer");
        this.cacheCurrentMessages();
        return result.messages.length > 0;
      } catch (error) {
        if (this.currentChannelId === channelId && this.prayerOnly === prayerOnly) this.messageLoadError = error instanceof Error ? error.message : "较新消息加载失败";
        return false;
      } finally {
        if (this.currentChannelId === channelId && this.prayerOnly === prayerOnly) this.loadingNewerMessages = false;
      }
    },
    appendLocalMessage(message: MessageDTO) {
      if (message.channelId !== this.currentChannelId || (this.prayerOnly && message.type !== "prayer")) return;
      if (this.messages.some((row) => row.id === message.id)) return;
      this.messages.push(message);
      this.trimMessageWindow("newer");
      this.cacheCurrentMessages();
    },
    replaceMessage(message: MessageDTO, pendingId?: number) {
      const duplicateIndex = this.messages.findIndex((row) => row.id === message.id);
      const pendingIndex = pendingId ? this.messages.findIndex((row) => row.id === pendingId) : -1;
      if (duplicateIndex >= 0) {
        this.messages.splice(duplicateIndex, 1, message);
        if (pendingIndex >= 0 && pendingIndex !== duplicateIndex) this.messages.splice(pendingIndex, 1);
      } else if (pendingIndex >= 0) {
        this.messages.splice(pendingIndex, 1, message);
      } else {
        this.appendLocalMessage(message);
        return;
      }
      this.cacheCurrentMessages();
    },
    removeMessage(id: number) {
      const index = this.messages.findIndex((message) => message.id === id);
      if (index >= 0) this.messages.splice(index, 1);
      this.cacheCurrentMessages();
    },
    async loadMembers(channelId?: number) {
      const targetChannelId = channelId ?? this.currentChannelId;
      if (!targetChannelId) return [];
      const result = await api<{ members: MemberRow[] }>(`/api/channels/${targetChannelId}/members`);
      if (targetChannelId === this.currentChannelId) this.members = result.members;
      return result.members;
    },
    connectSocket() {
      if (!getToken() || this.socket?.connected) return;
      this.socket?.disconnect();
      this.connectionState = "connecting";
      const socket = markRaw(io("/", { auth: { token: getToken() }, transports: ["websocket", "polling"] }));
      let connectedOnce = false;
      this.socket = socket;
      socket.on("connect", () => {
        const reconnecting = connectedOnce;
        connectedOnce = true;
        this.connectionState = "connected";
        if (this.currentChannelId) socket.emit("channel:join", { channelId: this.currentChannelId });
        // 演示目录兜底：连接建立即拉取一次，socket 断档期间的生命周期变化由此补齐。
        void refreshSermonDirectory().catch(() => undefined);
        if (reconnecting) {
          this.unreadSeeded = false;
          void this.seedUnreadCounts();
          if (this.currentChannelId) void this.loadMessages().catch(() => undefined);
        }
      });
      socket.on("connect_error", (error: Error) => {
        this.connectionState = "offline";
        if (error.message === "认证失败") void this.logout(false);
      });
      socket.on("disconnect", (reason) => {
        if (this.socket !== socket) return;
        this.connectionState = "offline";
        // 观众断线服务端即释席：本地同步释放非本人主持的入座，覆盖层随之卸载。
        releaseSermonAudienceSeat();
        if (reason !== "io server disconnect") return;
        this.socket = null;
        if (!getToken()) return;
        window.setTimeout(async () => {
          if (await this.refreshCurrentAccount()) this.connectSocket();
        }, 500);
      });
      socket.on("message:new", (message: MessageDTO) => {
        this.lastIncomingMessage = message;
        this.appendLocalMessage(message);
        this.noteUnreadMessage(message);
      });
      socket.on("channel:read", (event: ChannelReadSync) => this.applyChannelRead(event));
      socket.on("message:updated", (message: MessageDTO) => {
        if (message.channelId !== this.currentChannelId || (this.prayerOnly && message.type !== "prayer")) return;
        const existing = this.messages.find((row) => row.id === message.id);
        this.replaceMessage(mergeMessageUpdate(existing, message));
      });
      socket.on("message:reaction", (event: { messageId: number; channelId: number; reactions: Partial<MessageReactionsDTO> }) => {
        if (event.channelId === this.currentChannelId) this.updateMessageReactions(event.messageId, event.reactions);
      });
      socket.on("message:liked", (notification: LikeNotificationDTO) => {
        this.likeNotifications = [notification, ...this.likeNotifications.filter((item) => item.id !== notification.id)].slice(0, 20);
      });
      socket.on("message:typing", (event: { channelId: number; actor: { id: number; displayName: string }; state: "start" | "stop" }) => {
        if (event.channelId !== this.currentChannelId || event.actor.id === this.account?.actorId) return;
        const key = String(event.actor.id);
        if (this.typing[key]?.timer) window.clearTimeout(this.typing[key].timer);
        if (event.state === "stop") {
          delete this.typing[key];
          return;
        }
        const timer = window.setTimeout(() => delete this.typing[key], 12000);
        this.typing[key] = { displayName: event.actor.displayName, timer };
      });
      socket.on("presence:updated", (users) => (this.online = users));
      // 讲道经文：state 只推房间内成员，applySermonState 按本人主持的/入座的演示定向应用。
      setSermonOwnAccountId(this.account?.id ?? null);
      socket.on("sermon:state", (state: SermonStateDTO) => applySermonState(state));
      socket.on("sermon:request:decided", (event: { messageId: number; approve: boolean; until: string | null }) => applySermonRequestDecision(event));
      socket.on("sermon:directory", (list: Parameters<typeof applySermonDirectory>[0]) => applySermonDirectory(list));
      socket.on("sermon:invited", (event: SermonInvitedEvent) => applySermonInvited(event));
      socket.on("sermon:removed", (event: SermonRemovedEvent) => applySermonRemoved(event));
      socket.on("sermon:ended", (event: SermonEndedEvent) => applySermonEnded(event));
      socket.on("pinned:updated", (pinned: PinnedDTO | null) => {
        this.pinned = pinned;
        const ch = this.channels.find((c) => c.id === this.currentChannelId);
        if (ch) ch.pinned = pinned;
      });
      socket.on("voice:listened", (event: { messageId: number }) => {
        const message = this.messages.find((m) => m.id === event.messageId);
        if (message) message.voiceListened = true;
        if (this.pinned?.message?.id === event.messageId) this.pinned.message.voiceListened = true;
      });
      socket.on("messages:refresh", (event: { channelId: number }) => {
        if (event.channelId === this.currentChannelId) this.loadMessages();
      });
      socket.on("channel:updated", (event?: { action?: string; channel?: ChannelDTO; channelId?: number }) => {
        const incoming = event?.channel;
        const existing = incoming ? this.channels.find((ch) => ch.id === incoming.id) : null;
        if (incoming && existing) {
          mergeChannelUpdate(existing, incoming);
          return;
        }
        if (incoming && event?.action === "reception-created") {
          this.channels.push(incoming);
          return;
        }
        // New channels, deletions, and payload-less events still reload.
        void this.loadChannels();
      });
      socket.on("account:updated", (account: AccountDTO) => {
        if (account.id === this.account?.id) this.account = account;
      });
      socket.on("reception:closed", () => {
        if (!this.account?.isGuest) {
          void this.loadChannels();
          return;
        }
        window.dispatchEvent(new Event("reception-closed"));
        void this.logout(false);
      });
      socket.on("appearance:updated", (appearance: AppearanceDTO) => (this.appearance = appearance));
    }
  }
});
