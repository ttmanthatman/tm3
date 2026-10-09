import { z } from "zod";
import { setTimeout as delay } from "node:timers/promises";
import type { MessageDTO } from "../../shared/types.js";
import type { RelaySource } from "./source.js";

const knownMessageType = z.enum([
  "text", "image", "file", "music_playlist", "chain", "prayer", "grace", "sermon_request",
  "why_topic_card", "bible_session", "bible_copywork", "bible_note", "chat_record", "handwriting", "system"
]);

const messageSchema = z.object({
  id: z.number().int().positive(),
  channelId: z.number().int().positive(),
  sender: z.object({
    id: z.number().int().positive(),
    kind: z.enum(["human", "virtual", "system"]),
    username: z.string(),
    displayName: z.string()
  }).passthrough(),
  content: z.string(),
  // The server already renders relayText. A newer site's message kind must not
  // block every later reminder while this device waits for its next update.
  type: z.string().trim().min(1).max(80).transform((value) => {
    const known = knownMessageType.safeParse(value);
    return known.success ? known.data : "text";
  }),
  createdAt: z.string(),
  fileName: z.string().nullable().optional(),
  fileSize: z.number().int().nonnegative().nullable().optional(),
  relayText: z.string().trim().min(1).max(2000).optional(),
  relayMentions: z.array(z.string().trim().min(1).max(80)).max(20).optional()
}).passthrough();

const actionSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string().uuid(), type: z.literal("calibrate"), targetGroup: z.string(), createdAt: z.string() }),
  z.object({ id: z.string().uuid(), type: z.literal("test"), targetGroup: z.string(), text: z.string(), createdAt: z.string() })
]);

const controlSchema = z.object({
  config: z.object({
    enabled: z.boolean(),
    channelId: z.number().int().positive().nullable(),
    targetGroup: z.string(),
    startAfterId: z.number().int().nonnegative(),
    pendingAction: actionSchema.nullable(),
    templates: z.record(z.string(), z.array(z.string())).optional(),
    systemEvents: z.array(z.object({
      slot: z.string().trim().min(1).max(120),
      key: z.string().trim().min(1).max(240),
      message: messageSchema.nullable()
    })).max(20).default([])
  })
});

export type ManagedRelayAction = z.infer<typeof actionSchema>;
export type ManagedRelayControl = z.infer<typeof controlSchema>["config"];
export type ManagedRelaySystemEvent = ManagedRelayControl["systemEvents"][number];

export class ManagedTeamChatSource implements RelaySource {
  private stopped = false;
  private enabled = false;
  private readonly shutdown = new AbortController();

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImplementation: typeof fetch = fetch,
    private readonly requestTimeoutMs = 15000
  ) {}

  close() {
    this.stopped = true;
    this.shutdown.abort();
  }

  async waitForNextPoll(ms: number) {
    try {
      await delay(ms, undefined, { signal: this.shutdown.signal });
    } catch (error) {
      if (!this.stopped) throw error;
    }
  }

  private async request(path: string, init: RequestInit = {}) {
    const response = await this.fetchImplementation(`${this.baseUrl}${path}`, {
      ...init,
      signal: AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(this.requestTimeoutMs)]),
      headers: {
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(init.headers || {}),
        authorization: `Bearer ${this.token}`
      }
    });
    if (!response.ok) throw new Error(`Relay control request ${path} failed with HTTP ${response.status}`);
    return response;
  }

  async control() {
    const response = await this.request("/api/wechat-relay/agent/config");
    const config = controlSchema.parse(await response.json()).config;
    this.enabled = config.enabled && config.channelId !== null;
    return config;
  }

  deliveryEnabled() {
    return !this.stopped && this.enabled;
  }

  async fetchAfter(after: number, limit = 200) {
    const params = new URLSearchParams({
      after: String(Math.max(0, after)),
      limit: String(Math.min(Math.max(limit, 1), 200))
    });
    const response = await this.request(`/api/wechat-relay/agent/messages?${params.toString()}`);
    const payload = z.object({ messages: z.array(messageSchema) }).parse(await response.json());
    return payload.messages as MessageDTO[];
  }

  async catchUp(after: number, onBatch: (messages: MessageDTO[]) => void | Promise<void>) {
    let cursor = after;
    let total = 0;
    while (!this.stopped) {
      const messages = await this.fetchAfter(cursor, 200);
      if (this.stopped) return { cursor, total };
      if (!messages.length) return { cursor, total };
      const nextCursor = Math.max(cursor, ...messages.map((message) => message.id));
      if (nextCursor === cursor) throw new Error("Relay source returned a batch without advancing its cursor");
      await onBatch(messages);
      total += messages.length;
      cursor = nextCursor;
      if (messages.length < 200) return { cursor, total };
    }
    return { cursor, total };
  }

  async ensureSubscription(_onMessage: (message: MessageDTO) => void) {
    // Managed agents use bounded polling so the server never exposes a device socket.
  }

  async heartbeat(payload: {
    deviceName: string;
    driverReady: boolean;
    calibratedTarget?: string | null;
    queue: Record<string, number>;
    attention: number;
    lastError?: string | null;
  }) {
    await this.request("/api/wechat-relay/agent/heartbeat", { method: "POST", body: JSON.stringify(payload) });
  }

  async reportAction(actionId: string, success: boolean, message: string) {
    await this.request("/api/wechat-relay/agent/action-result", {
      method: "POST",
      body: JSON.stringify({ actionId, success, message })
    });
  }

  isStopped() {
    return this.stopped;
  }
}
