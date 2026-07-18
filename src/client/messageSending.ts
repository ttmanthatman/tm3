import { ref } from "vue";

export type MessageSendAck = { success?: boolean; message?: string };
export type MessageSendResult =
  | { ok: true }
  | { ok: false; reason: "disconnected" | "busy" | "timeout" | "rejected" | "transport"; message: string };

export interface MessageSendSocket {
  connected: boolean;
  timeout(timeoutMs: number): MessageSendSocket;
  emit(event: "message:send", payload: unknown, ack: (error: Error | null, response?: MessageSendAck) => void): unknown;
}

export function useMessageSender(options: { getSocket: () => MessageSendSocket | null; timeoutMs?: number }) {
  const pending = ref(false);
  const statusMessage = ref("");

  async function send(payload: unknown): Promise<MessageSendResult> {
    if (pending.value) return { ok: false, reason: "busy", message: "消息正在发送，请稍候" };
    const socket = options.getSocket();
    if (!socket?.connected) {
      const result = { ok: false, reason: "disconnected", message: "连接恢复后再发送" } as const;
      statusMessage.value = result.message;
      return result;
    }
    pending.value = true;
    statusMessage.value = "正在发送…";
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: MessageSendResult) => {
        if (settled) return;
        settled = true;
        pending.value = false;
        statusMessage.value = result.ok ? "" : result.message;
        resolve(result);
      };
      try {
        socket.timeout(options.timeoutMs ?? 10_000).emit("message:send", payload, (error, ack) => {
          if (error) {
            finish({
              ok: false,
              reason: "timeout",
              message: "发送结果未确认，内容已保留；请先检查消息列表后再重试"
            });
            return;
          }
          if (!ack?.success) {
            finish({ ok: false, reason: "rejected", message: ack?.message || "发送失败，内容已保留，请重试" });
            return;
          }
          finish({ ok: true });
        });
      } catch {
        finish({ ok: false, reason: "transport", message: "发送失败，内容已保留，请重试" });
      }
    });
  }

  function clearStatus() {
    if (!pending.value) statusMessage.value = "";
  }

  return { pending, statusMessage, send, clearStatus };
}

export function composerDraftAfterSend(result: MessageSendResult, submittedDraft: string, currentDraft: string) {
  return result.ok && currentDraft === submittedDraft ? "" : currentDraft;
}

export function isComposerSendKey(event: Pick<KeyboardEvent, "key" | "shiftKey" | "isComposing">) {
  return event.key === "Enter" && !event.shiftKey && !event.isComposing;
}
