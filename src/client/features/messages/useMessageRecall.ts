import { computed, ref, type Ref } from "vue";
import type { MessageDTO } from "@shared/types";
import { api } from "../../api";
import { useChatStore } from "../../store";

interface UseMessageRecallOptions {
  pendingMessageActions: Ref<MessageDTO | null>;
  isMine: (message: MessageDTO) => boolean;
  positionPromptNearEvent: (event: MouseEvent | PointerEvent | undefined, size: { width: number; height: number }) => { x: number; y: number };
  closeChainJoin: () => void;
  closeMessageActionMenu: () => void;
  closeCompetingPrompts: () => void;
}

export function useMessageRecall(options: UseMessageRecallOptions) {
  const store = useChatStore();
  const pendingRecall = ref<MessageDTO | null>(null);
  const recallPromptPosition = ref({ x: 0, y: 0 });

  const recallPromptStyle = computed(() => ({
    left: `${recallPromptPosition.value.x}px`,
    top: `${recallPromptPosition.value.y}px`
  }));

  function recallRemainingMs(message: MessageDTO) {
    return 120_000 - (Date.now() - new Date(message.createdAt).getTime());
  }

  function canRecallMessage(message: MessageDTO) {
    return message.id > 0 && message.type !== "system" && options.isMine(message) && recallRemainingMs(message) > 0;
  }

  function recallRemainingText(message: MessageDTO) {
    const seconds = Math.max(0, Math.ceil(recallRemainingMs(message) / 1000));
    return `${seconds} 秒内可撤回`;
  }

  function openRecallPrompt(message: MessageDTO, event?: MouseEvent) {
    recallPromptPosition.value = options.positionPromptNearEvent(event, { width: 210, height: 104 });
    pendingRecall.value = message;
    options.closeChainJoin();
    options.closeCompetingPrompts();
  }

  async function recallPendingMessage() {
    const message = pendingRecall.value;
    if (!message) return;
    try {
      await api(`/api/messages/${message.id}/recall`, { method: "POST", body: JSON.stringify({}) });
      pendingRecall.value = null;
      await store.loadMessages();
    } catch (error) {
      alert(error instanceof Error ? error.message : "撤回失败");
    }
  }

  function recallActionMessage(event?: MouseEvent) {
    const message = options.pendingMessageActions.value;
    if (!message || !canRecallMessage(message)) return;
    options.closeMessageActionMenu();
    openRecallPrompt(message, event);
  }

  return {
    pendingRecall,
    recallPromptPosition,
    recallPromptStyle,
    recallRemainingMs,
    canRecallMessage,
    recallRemainingText,
    openRecallPrompt,
    recallPendingMessage,
    recallActionMessage
  };
}
