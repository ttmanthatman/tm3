import { defineStore } from "pinia";
import { io, type Socket } from "socket.io-client";
import type { AccountDTO, AppearanceDTO, ChannelDTO, MessageDTO, PinnedDTO } from "@shared/types";
import { api, clearToken, getToken, setToken } from "./api";

type TypingState = Record<string, { displayName: string; timer: number }>;
type MemberRow = { id: number; accountId?: number; kind: string; username?: string; displayName: string; avatarPath?: string | null; role?: string };
type MessageWindowCache = {
  messages: MessageDTO[];
  hasOlder: boolean;
  hasNewer: boolean;
  prefetchedOlder: MessageDTO[];
};
const MESSAGE_PAGE_SIZE = 80;
const MESSAGE_WINDOW_LIMIT = 480;
const MESSAGE_CACHE_KEY_LIMIT = 24;
const defaultAppearance: AppearanceDTO = {
  appTitle: "Team Chat",
  appIconPath: null,
  wallpaperPath: null,
  wallpaperFit: "cover",
  loginIconPath: null,
  loginShowIcon: true,
  loginTitle: "Team Chat",
  loginSubtitle: "轻快、稳定的团队聊天。",
  loginShowSubtitle: true,
  loginBackgroundPath: null,
  loginBackgroundFit: "cover",
  loginFormPosition: "middle",
  registrationEnabled: false,
  flashEffect: {
    colors: ["#fff176", "#ef4444", "#60a5fa", "#6d28d9", "#34d399", "#111827"],
    intervalSeconds: 0.4,
    transitionMode: "smooth"
  },
  customThemes: []
};

export const useChatStore = defineStore("chat", {
  state: () => ({
    account: null as AccountDTO | null,
    appearance: { ...defaultAppearance } as AppearanceDTO,
    channels: [] as ChannelDTO[],
    currentChannelId: Number(localStorage.getItem("team-chat-current-channel") || 0),
    prayerOnly: localStorage.getItem("team-chat-message-view") === "prayers",
    previousChannelId: 0,
    messages: [] as MessageDTO[],
    messageCache: {} as Record<string, MessageWindowCache>,
    messageCacheOrder: [] as string[],
    hasOlderMessages: false,
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
    socket: null as Socket | null,
    loading: false
  }),
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
      this.messages = cached ? [...cached.messages] : [];
      this.hasOlderMessages = cached?.hasOlder || false;
      this.hasNewerMessages = cached?.hasNewer || false;
      this.prefetchedOlderMessages = cached ? [...cached.prefetchedOlder] : [];
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
      await this.loadAppearance();
      if (!getToken()) return;
      if (await this.refreshCurrentAccount()) this.connectSocket();
    },
    async refreshCurrentAccount(preferredChannelId?: number) {
      if (!getToken()) return false;
      try {
        const channelId = preferredChannelId ?? this.currentChannelId;
        const me = await api<{ account: AccountDTO; token?: string }>("/api/auth/me");
        if (me.token) setToken(me.token);
        this.account = me.account;
        await this.loadChannels(channelId);
        return true;
      } catch {
        await this.logout(false);
        return false;
      }
    },
    async afterLogin(account: AccountDTO) {
      this.account = account;
      await this.loadChannels();
      this.connectSocket();
    },
    async logout(revoke = true) {
      if (revoke && getToken()) await api("/api/auth/logout", { method: "POST", body: JSON.stringify({}) }).catch(() => undefined);
      this.socket?.disconnect();
      this.socket = null;
      this.account = null;
      this.resetMessageWindow();
      this.messageCache = {};
      this.messageCacheOrder = [];
      clearToken();
    },
    async loadAppearance() {
      this.appearance = await api<AppearanceDTO>("/api/settings/appearance").catch(() => ({ ...defaultAppearance }));
    },
    async loadChannels(preferredChannelId = 0) {
      const result = await api<{ channels: ChannelDTO[] }>("/api/channels");
      this.channels = result.channels.filter(Boolean);
      const candidates = [this.currentChannelId, preferredChannelId, this.previousChannelId];
      const nextChannelId = candidates.find((id) => id && this.channels.some((ch) => ch.id === id)) || this.channels[0]?.id || 0;
      this.currentChannelId = nextChannelId;
      if (this.currentChannelId) {
        localStorage.setItem("team-chat-current-channel", String(this.currentChannelId));
        await this.loadMessages();
        await this.loadMembers();
      } else {
        localStorage.removeItem("team-chat-current-channel");
        this.resetMessageWindow();
        this.members = [];
        this.pinned = null;
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
      await this.loadMessages();
      await this.loadMembers();
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
      this.loading = true;
      this.loadingInitialMessages = true;
      this.messageLoadError = "";
      try {
        const result = await api<{ messages: MessageDTO[] }>(this.messageQuery(channelId, prayerOnly));
        if (this.currentChannelId !== channelId || this.prayerOnly !== prayerOnly) return;
        this.messages = this.dedupeMessages(result.messages);
        this.prefetchedOlderMessages = [];
        this.updateMessageWindowFlagsFromRows(result.messages, "initial");
        this.cacheCurrentMessages();
        this.pinned = this.channels.find((ch) => ch.id === this.currentChannelId)?.pinned || null;
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
    async loadMembers() {
      if (!this.currentChannelId) return;
      const result = await api<{ members: MemberRow[] }>(`/api/channels/${this.currentChannelId}/members`);
      this.members = result.members;
    },
    connectSocket() {
      if (!getToken() || this.socket?.connected) return;
      this.socket?.disconnect();
      const socket = io("/", { auth: { token: getToken() }, transports: ["websocket", "polling"] });
      this.socket = socket;
      socket.on("connect", () => {
        if (this.currentChannelId) socket.emit("channel:join", { channelId: this.currentChannelId });
      });
      socket.on("connect_error", (error: Error) => {
        if (error.message === "认证失败") void this.logout(false);
      });
      socket.on("disconnect", (reason) => {
        if (this.socket !== socket) return;
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
      });
      socket.on("message:updated", (message: MessageDTO) => {
        if (message.channelId !== this.currentChannelId || (this.prayerOnly && message.type !== "prayer")) return;
        this.replaceMessage(message);
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
      socket.on("channel:updated", () => this.loadChannels());
      socket.on("account:updated", (account: AccountDTO) => {
        if (account.id === this.account?.id) this.account = account;
      });
      socket.on("appearance:updated", (appearance: AppearanceDTO) => (this.appearance = appearance));
    }
  }
});
