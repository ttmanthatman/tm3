import { z } from "zod";
import type { MessageDTO } from "../../shared/types.js";
import type { RelaySource } from "./source.js";

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
  createdAt: z.string(),
  relayText: z.string().trim().min(1).max(1000).optional()
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
    templates: z.record(z.string(), z.array(z.string())).optional()
  })
});

export type ManagedRelayAction = z.infer<typeof actionSchema>;
export type ManagedRelayControl = z.infer<typeof controlSchema>["config"];

export class ManagedTeamChatSource implements RelaySource {
  private stopped = false;

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetchImplementation: typeof fetch = fetch
  ) {}

  close() {
    this.stopped = true;
  }

  private async request(path: string, init: RequestInit = {}) {
    const response = await this.fetchImplementation(`${this.baseUrl}${path}`, {
      ...init,
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
    return controlSchema.parse(await response.json()).config;
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
    for (;;) {
      const messages = await this.fetchAfter(cursor, 200);
      if (!messages.length) return { cursor, total };
      await onBatch(messages);
      total += messages.length;
      cursor = Math.max(cursor, ...messages.map((message) => message.id));
      if (messages.length < 200) return { cursor, total };
    }
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
