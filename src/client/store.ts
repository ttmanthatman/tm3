import { defineStore } from "pinia";
import { io, type Socket } from "socket.io-client";
import type { AccountDTO, AppearanceDTO, ChannelDTO, MessageDTO, PinnedDTO } from "@shared/types";
import { api, clearToken, getToken } from "./api";

type TypingState = Record<string, { displayName: string; timer: number }>;
type MemberRow = { id: number; accountId?: number; kind: string; username?: string; displayName: string; avatarPath?: string | null; role?: string };
const defaultAppearance: AppearanceDTO = {
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
  customThemes: []
};

export const useChatStore = defineStore("chat", {
  state: () => ({
    account: null as AccountDTO | null,
    appearance: { ...defaultAppearance } as AppearanceDTO,
    channels: [] as ChannelDTO[],
    currentChannelId: Number(localStorage.getItem("team-chat-current-channel") || 0),
    previousChannelId: 0,
    messages: [] as MessageDTO[],
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
    }
  },
  actions: {
    async bootstrap() {
      await this.loadAppearance();
      if (!getToken()) return;
      try {
        const me = await api<{ account: AccountDTO }>("/api/auth/me");
        this.account = me.account;
        await this.loadChannels();
        this.connectSocket();
      } catch {
        clearToken();
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
      this.messages = [];
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
        this.messages = [];
        this.members = [];
        this.pinned = null;
      }
    },
    async switchChannel(id: number) {
      if (this.currentChannelId === id) return;
      this.previousChannelId = this.currentChannelId;
      this.currentChannelId = id;
      localStorage.setItem("team-chat-current-channel", String(id));
      this.messages = [];
      this.pinned = this.channels.find((ch) => ch.id === id)?.pinned || null;
      this.socket?.emit("channel:join", { channelId: id });
      await this.loadMessages();
      await this.loadMembers();
    },
    async loadMessages() {
      if (!this.currentChannelId) return;
      this.loading = true;
      try {
        const result = await api<{ messages: MessageDTO[] }>(`/api/messages?channelId=${this.currentChannelId}&limit=80`);
        this.messages = result.messages;
        this.pinned = this.channels.find((ch) => ch.id === this.currentChannelId)?.pinned || null;
      } finally {
        this.loading = false;
      }
    },
    async loadMembers() {
      if (!this.currentChannelId) return;
      const result = await api<{ members: MemberRow[] }>(`/api/channels/${this.currentChannelId}/members`);
      this.members = result.members;
    },
    connectSocket() {
      if (!getToken() || this.socket?.connected) return;
      this.socket = io("/", { auth: { token: getToken() }, transports: ["websocket", "polling"] });
      this.socket.on("connect", () => {
        if (this.currentChannelId) this.socket?.emit("channel:join", { channelId: this.currentChannelId });
      });
      this.socket.on("connect_error", () => this.logout(false));
      this.socket.on("message:new", (message: MessageDTO) => {
        this.lastIncomingMessage = message;
        if (message.channelId === this.currentChannelId && !this.messages.some((m) => m.id === message.id)) {
          this.messages.push(message);
        }
      });
      this.socket.on("message:typing", (event: { channelId: number; actor: { id: number; displayName: string }; state: "start" | "stop" }) => {
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
      this.socket.on("presence:updated", (users) => (this.online = users));
      this.socket.on("pinned:updated", (pinned: PinnedDTO | null) => {
        this.pinned = pinned;
        const ch = this.channels.find((c) => c.id === this.currentChannelId);
        if (ch) ch.pinned = pinned;
      });
      this.socket.on("voice:listened", (event: { messageId: number }) => {
        const message = this.messages.find((m) => m.id === event.messageId);
        if (message) message.voiceListened = true;
        if (this.pinned?.message?.id === event.messageId) this.pinned.message.voiceListened = true;
      });
      this.socket.on("messages:refresh", (event: { channelId: number }) => {
        if (event.channelId === this.currentChannelId) this.loadMessages();
      });
      this.socket.on("channel:updated", () => this.loadChannels());
      this.socket.on("appearance:updated", (appearance: AppearanceDTO) => (this.appearance = appearance));
    }
  }
});
