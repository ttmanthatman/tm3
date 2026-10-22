import type { Message, Prisma, PrismaClient } from "@prisma/client";
import type { AiSettingsDTO } from "../../shared/types.js";
import { plainTextFromHtml } from "../textUtils.js";
import { virtualAssistantStopCommand } from "./questionAssistantActivation.js";
import { assistantActivationSuppressed } from "../../shared/assistantActivation.js";
import type { AssistantToolContext } from "./assistantTools.js";
import { assistantMessageUsesFunctions, type QuestionAssistantReply } from "./questionAssistantReply.js";

type Trigger = Pick<Message, "id" | "channelId" | "senderActorId" | "content" | "createdAt">;

export type VirtualDirectAssistantSettings = AiSettingsDTO & {
  systemPrompt?: string;
  thinkingEnabled?: boolean;
  webSearchEnabled?: boolean;
};

export interface VirtualDirectAssistantDependencies {
  prisma: PrismaClient;
  canWriteChannel(accountId: number, channelId: number): Promise<boolean>;
  loadSettings(username: string, config: Prisma.JsonValue): Promise<{ value: VirtualDirectAssistantSettings; apiKey: string }>;
  complete(settings: VirtualDirectAssistantSettings, apiKey: string, contextText: string, context: AssistantToolContext): Promise<string | QuestionAssistantReply>;
  canUseFunctions?(): Promise<boolean>;
  shareScore?(scoreId: number, context: AssistantToolContext, canPublish: () => Promise<boolean>): Promise<void>;
  send(input: { channelId: number; actorId: number; content: string; replyToId: number; payload: Record<string, unknown> }): Promise<unknown>;
  sessions: {
    exclusive<T>(message: Trigger, username: string, action: () => Promise<T>): Promise<T>;
    stoppedSince(message: Trigger, username: string, displayName: string): Promise<boolean>;
    stop(message: Trigger, assistant: { id: number; username: string }): Promise<unknown>;
  };
}

/** Private assistant replies use only the addressed user's own direct conversation. */
export function createVirtualDirectAssistant(deps: VirtualDirectAssistantDependencies) {
  const { prisma, sessions } = deps;

  async function trigger(messageId: number) {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: { sender: true, channel: { select: { kind: true, name: true, directKey: true } } }
    });
    if (!message || message.type !== "text" || message.sender.kind !== "human" || !message.sender.accountId || message.channel.kind !== "direct" || assistantActivationSuppressed(message)) return;
    const accountId = message.sender.accountId;
    const key = /^virtual:([1-9][0-9]*):([^:]+)$/.exec(message.channel.directKey || "");
    if (!key || key[1] !== String(accountId) || key[2] === "ai_slmm") return;
    const username = key[2];
    if (!(await deps.canWriteChannel(accountId, message.channelId))) return;
    const assistant = await prisma.actor.findUnique({ where: { username }, include: { character: true } });
    if (!assistant || assistant.kind !== "virtual" || assistant.status !== "active" || !assistant.character?.enabled) return;
    if (message.channel.directKey !== `virtual:${accountId}:${assistant.username}`) return;
    if (virtualAssistantStopCommand(message.content, username, assistant.displayName).stop) {
      await sessions.stop(message, assistant);
      return;
    }
    const settings = await deps.loadSettings(username, assistant.character.config);
    if (!settings.value.enabled || !settings.apiKey || await sessions.stoppedSince(message, username, assistant.displayName)) return;
    const rows = await prisma.message.findMany({
      where: {
        channelId: message.channelId,
        id: { lte: message.id },
        senderActorId: { in: [message.senderActorId, assistant.id] }
      },
      orderBy: { id: "desc" },
      take: 24
    });
    const stopIndex = rows.findIndex((row) => row.senderActorId === message.senderActorId && row.type === "text" && !assistantActivationSuppressed(row) &&
      virtualAssistantStopCommand(row.content, username, assistant.displayName).stop);
    const history = (stopIndex < 0 ? rows : rows.slice(0, stopIndex)).slice().reverse()
      .map((row) => `${row.senderActorId === assistant.id ? assistant.displayName : message.sender.displayName}：${plainTextFromHtml(row.content, 1200)}`)
      .join("\n").slice(-24_000);
    const contextText = [
      `私聊频道：${message.channel.name}`,
      `发言人：${message.sender.displayName}`,
      "最近对话：", history || "无",
      "当前消息：", plainTextFromHtml(message.content, 4000),
      `请按${assistant.displayName}的角色与提示词回应。`
    ].join("\n");
    const context = { accountId, channelId: message.channelId, triggerMessageId: message.id, assistantActorId: assistant.id };
    const result = await deps.complete(settings.value, settings.apiKey, contextText, context);
    const reply = typeof result === "string" ? { messages: [{ content: result, payload: { contentFormat: "markdown" } }], scoreIds: [] } : result;
    const canPublish = async () => {
      if (!(await deps.canWriteChannel(accountId, message.channelId))) return false;
      const currentAssistant = await prisma.actor.findUnique({ where: { username }, include: { character: true } });
      if (!currentAssistant || currentAssistant.id !== assistant.id || currentAssistant.kind !== "virtual" ||
        currentAssistant.status !== "active" || !currentAssistant.character?.enabled) return false;
      if (!(await deps.loadSettings(username, currentAssistant.character.config)).value.enabled) return false;
      return !(await sessions.stoppedSince(message, username, assistant.displayName));
    };
    await sessions.exclusive(message, username, async () => {
      for (const item of reply.messages) {
        if (!item.content.trim() || item.content.trim() === "[PASS]") continue;
        if (!(await canPublish())) return;
        if (assistantMessageUsesFunctions(item)) {
          if (deps.canUseFunctions && !(await deps.canUseFunctions())) continue;
          if (await sessions.stoppedSince(message, username, assistant.displayName)) return;
        }
        await deps.send({ channelId: message.channelId, actorId: assistant.id, content: item.content, replyToId: message.id,
          payload: { ...item.payload, aiRole: username, triggerMessageId: message.id } });
      }
      for (const scoreId of reply.scoreIds) {
        if (!(await canPublish())) return;
        if (deps.canUseFunctions && !(await deps.canUseFunctions())) return;
        if (await sessions.stoppedSince(message, username, assistant.displayName)) return;
        await deps.shareScore?.(scoreId, context, canPublish);
      }
    });
  }

  return { trigger };
}
