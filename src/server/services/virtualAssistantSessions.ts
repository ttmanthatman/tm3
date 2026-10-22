import type { Message, PrismaClient } from "@prisma/client";
import { virtualAssistantStopCommand } from "./questionAssistantActivation.js";
import { assistantActivationSuppressed } from "../../shared/assistantActivation.js";

type Trigger = Pick<Message, "id" | "channelId" | "senderActorId" | "content" | "createdAt">;

/** Serialize publishing and stopping, while leaving slow model requests outside the lock. */
export function createVirtualAssistantSessions(prisma: PrismaClient, updated: (id: number, channelId: number) => Promise<void>) {
  const queues = new Map<string, Promise<unknown>>();

  async function exclusive<T>(message: Trigger, username: string, action: () => Promise<T>) {
    const key = `${message.channelId}:${message.senderActorId}:${username}`;
    const previous = queues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(action);
    queues.set(key, next);
    try { return await next; }
    finally { if (queues.get(key) === next) queues.delete(key); }
  }

  async function stoppedSince(message: Trigger, username: string, displayName: string) {
    // The command itself is the durable session boundary, including across restarts.
    const rows = await prisma.message.findMany({
      where: { channelId: message.channelId, senderActorId: message.senderActorId, type: "text", id: { gt: message.id } },
      select: { content: true, payload: true }, orderBy: { id: "asc" }
    });
    return rows.some(row => !assistantActivationSuppressed(row) && virtualAssistantStopCommand(row.content, username, displayName).stop);
  }

  async function stop(message: Trigger, assistant: { id: number; username: string }) {
    return exclusive(message, assistant.username, async () => {
      const last = await prisma.message.findFirst({
        where: {
          channelId: message.channelId, senderActorId: assistant.id,
          replyTo: { senderActorId: message.senderActorId, id: { lt: message.id } }
        }, orderBy: { id: "desc" }
      });
      if (!last) return;
      const payload = last.payload && typeof last.payload === "object" && !Array.isArray(last.payload) ? last.payload : {};
      await prisma.message.update({ where: { id: last.id }, data: {
        payload: { ...payload, aiSessionEnded: { at: message.createdAt.toISOString(), byMessageId: message.id, username: assistant.username } }
      } });
      await updated(last.id, message.channelId);
    });
  }

  return { exclusive, stoppedSince, stop };
}
