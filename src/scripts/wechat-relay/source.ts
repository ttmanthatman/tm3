import { io, type Socket } from "socket.io-client";
import { z } from "zod";
import type { MessageDTO } from "../../shared/types.js";

export interface TeamChatSourceConfig {
  baseUrl: string;
  username: string;
  password: string;
  channelId: number;
}

export interface RelaySource {
  close(): void;
  catchUp(after: number, onBatch: (messages: MessageDTO[]) => void | Promise<void>): Promise<{ cursor: number; total: number }>;
  ensureSubscription(onMessage: (message: MessageDTO) => void): Promise<void>;
}

const messageSchema = z.object({
  id: z.number().int().positive(),
  channelId: z.number().int().positive(),
  sender: z.object({
    id: z.number().int().positive(),
    kind: z.string(),
    username: z.string(),
    displayName: z.string()
  }).passthrough(),
  content: z.string(),
  type: z.string(),
  createdAt: z.string()
}).passthrough();

const loginSchema = z.object({ token: z.string().min(1) });
const messagesSchema = z.object({ messages: z.array(messageSchema) });

export class TeamChatSource implements RelaySource {
  private token = "";
  private socket: Socket | null = null;
  private onMessage: ((message: MessageDTO) => void) | null = null;

  constructor(
    private readonly config: TeamChatSourceConfig,
    private readonly fetchImplementation: typeof fetch = fetch
  ) {}

  close() {
    this.socket?.close();
    this.socket = null;
  }

  private async login() {
    const response = await this.fetchImplementation(`${this.config.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: this.config.username,
        password: this.config.password,
        deviceName: "WeChat relay",
        appVersion: "wechat-relay/1"
      })
    });
    if (!response.ok) throw new Error(`Relay source login failed with HTTP ${response.status}`);
    this.token = loginSchema.parse(await response.json()).token;
    return this.token;
  }

  private async authenticatedFetch(url: string, retried = false): Promise<Response> {
    if (!this.token) await this.login();
    const response = await this.fetchImplementation(url, {
      headers: { authorization: `Bearer ${this.token}` }
    });
    if (response.status !== 401 || retried) return response;
    this.token = "";
    await this.login();
    return this.authenticatedFetch(url, true);
  }

  async fetchAfter(after: number, limit = 200) {
    const url = new URL("/api/messages", this.config.baseUrl);
    url.searchParams.set("channelId", String(this.config.channelId));
    url.searchParams.set("after", String(Math.max(0, after)));
    url.searchParams.set("limit", String(Math.min(Math.max(limit, 1), 200)));
    const response = await this.authenticatedFetch(url.toString());
    if (!response.ok) throw new Error(`Relay source message fetch failed with HTTP ${response.status}`);
    const payload = messagesSchema.parse(await response.json());
    return payload.messages
      .filter((message) => message.channelId === this.config.channelId)
      .map((message) => message as MessageDTO);
  }

  async catchUp(after: number, onBatch: (messages: MessageDTO[]) => void | Promise<void>) {
    let cursor = after;
    let total = 0;
    for (;;) {
      const messages = await this.fetchAfter(cursor, 200);
      if (!messages.length) return { cursor, total };
      await onBatch(messages);
      total += messages.length;
      cursor = Math.max(cursor, ...messages.map((message) => message.id));
      if (messages.length < 200) return { cursor, total };
    }
  }

  async ensureSubscription(onMessage: (message: MessageDTO) => void) {
    this.onMessage = onMessage;
    if (this.socket) return;
    if (!this.token) await this.login();
    const socket = io(this.config.baseUrl, {
      auth: { token: this.token },
      transports: ["websocket", "polling"],
      reconnection: true
    });
    this.socket = socket;
    socket.on("message:new", (raw: unknown) => {
      const parsed = messageSchema.safeParse(raw);
      if (!parsed.success || parsed.data.channelId !== this.config.channelId) return;
      this.onMessage?.(parsed.data as MessageDTO);
    });
    socket.on("connect_error", (error) => {
      if (!/认证|auth|token|unauthor/i.test(error.message)) return;
      socket.close();
      if (this.socket === socket) this.socket = null;
      this.token = "";
    });
    socket.on("disconnect", (reason) => {
      if (reason !== "io server disconnect") return;
      socket.close();
      if (this.socket === socket) this.socket = null;
    });
  }
}
