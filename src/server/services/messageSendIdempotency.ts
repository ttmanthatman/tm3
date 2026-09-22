import { createHash } from "node:crypto";

type StoredSend = { id: number; clientRequestHash: string | null };
type SendResult = { state: "created" | "replayed"; messageId: number } | { state: "conflict" };

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => [key, canonicalJson(entry)]));
  }
  return value;
}

export function messageSendRequestHash(input: {
  channelId: number;
  content: string;
  type: string;
  payload: unknown;
  replyToId: number | null;
}): string {
  return createHash("sha256").update(JSON.stringify(canonicalJson(input))).digest("hex");
}

export function createMessageSendIdempotency(deps: {
  find(actorId: number, clientRequestId: string): Promise<StoredSend | null>;
  isUniqueConflict(error: unknown): boolean;
}) {
  const inFlight = new Map<string, { hash: string; promise: Promise<SendResult> }>();

  async function send(input: {
    actorId: number;
    clientRequestId: string;
    hash: string;
    create(): Promise<StoredSend>;
  }): Promise<SendResult> {
    const key = `${input.actorId}:${input.clientRequestId}`;
    const pending = inFlight.get(key);
    if (pending) {
      if (pending.hash !== input.hash) return { state: "conflict" };
      const result = await pending.promise;
      return result.state === "created" ? { state: "replayed", messageId: result.messageId } : result;
    }

    const promise = (async (): Promise<SendResult> => {
      const resolveExisting = async (): Promise<SendResult | null> => {
        const existing = await deps.find(input.actorId, input.clientRequestId);
        if (!existing) return null;
        return existing.clientRequestHash === input.hash
          ? { state: "replayed", messageId: existing.id }
          : { state: "conflict" };
      };
      const existing = await resolveExisting();
      if (existing) return existing;
      try {
        const created = await input.create();
        return { state: "created", messageId: created.id };
      } catch (error) {
        if (!deps.isUniqueConflict(error)) throw error;
        const raced = await resolveExisting();
        if (raced) return raced;
        throw error;
      }
    })();
    inFlight.set(key, { hash: input.hash, promise });
    try {
      return await promise;
    } finally {
      inFlight.delete(key);
    }
  }

  return { send };
}
