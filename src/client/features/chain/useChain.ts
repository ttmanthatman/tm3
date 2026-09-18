import { ref, type Ref } from "vue";
import type { ChainCreateConfigInput, ChainSelectionInput, MessageDTO } from "../../../shared/types";
import { api } from "../../api";

export interface ChainCreateFormValue {
  topic: string;
  requiredSelection: boolean;
  allowMultiple: boolean;
  options: string[];
}

interface UseChainOptions {
  currentChannelId: Ref<number | null>;
  getReplyToId: () => number | null;
  onOpenCreate?: () => void;
  onCreated?: () => void;
}

export function useChain(options: UseChainOptions) {
  const showCreateDialog = ref(false);
  const createBusy = ref(false);
  const createError = ref("");
  const pendingChain = ref<MessageDTO | null>(null);
  const joinBusy = ref(false);
  const joinError = ref("");
  const pendingEndChain = ref<MessageDTO | null>(null);
  const endBusy = ref(false);
  const endError = ref("");

  function openCreateDialog() {
    createError.value = "";
    showCreateDialog.value = true;
    options.onOpenCreate?.();
  }

  function closeCreateDialog() {
    if (createBusy.value) return;
    showCreateDialog.value = false;
    createError.value = "";
  }

  async function createChain(value: ChainCreateFormValue) {
    if (!options.currentChannelId.value || createBusy.value) return;
    createBusy.value = true;
    createError.value = "";
    try {
      const chainConfig: ChainCreateConfigInput | undefined = value.requiredSelection
        ? { requiredSelection: true, allowMultiple: value.allowMultiple, options: value.options }
        : undefined;
      await api("/api/messages", {
        method: "POST",
        body: JSON.stringify({
          channelId: options.currentChannelId.value,
          type: "chain",
          chainTopic: value.topic,
          chainConfig,
          replyToId: options.getReplyToId()
        })
      });
      showCreateDialog.value = false;
      options.onCreated?.();
    } catch (error) {
      createError.value = error instanceof Error ? error.message : "接龙发布失败";
    } finally {
      createBusy.value = false;
    }
  }

  function openJoin(message: MessageDTO) {
    pendingChain.value = message;
    joinError.value = "";
  }

  function closeJoin() {
    if (joinBusy.value) return;
    pendingChain.value = null;
    joinError.value = "";
  }

  async function joinPendingChain(selection?: ChainSelectionInput) {
    const message = pendingChain.value;
    if (!message || joinBusy.value) return;
    joinBusy.value = true;
    joinError.value = "";
    try {
      await api("/api/messages", {
        method: "POST",
        body: JSON.stringify({
          channelId: message.channelId,
          type: "chain",
          chainRootId: message.chainRootId || message.id,
          chainSelection: selection
        })
      });
      pendingChain.value = null;
    } catch (error) {
      joinError.value = error instanceof Error ? error.message : "参与接龙失败";
    } finally {
      joinBusy.value = false;
    }
  }

  function openEndDialog(message: MessageDTO) {
    pendingEndChain.value = message;
    endError.value = "";
  }

  function closeEndDialog() {
    if (endBusy.value) return;
    pendingEndChain.value = null;
    endError.value = "";
  }

  async function endPendingChain() {
    const message = pendingEndChain.value;
    if (!message || endBusy.value) return;
    endBusy.value = true;
    endError.value = "";
    try {
      await api(`/api/chains/${message.chainRootId || message.id}/end`, {
        method: "POST",
        body: JSON.stringify({})
      });
      pendingEndChain.value = null;
      pendingChain.value = null;
    } catch (error) {
      endError.value = error instanceof Error ? error.message : "终止接龙失败";
    } finally {
      endBusy.value = false;
    }
  }

  function closeChainSurfaces() {
    if (!createBusy.value) showCreateDialog.value = false;
    if (!joinBusy.value) pendingChain.value = null;
    if (!endBusy.value) pendingEndChain.value = null;
    createError.value = "";
    joinError.value = "";
    endError.value = "";
  }

  return {
    showCreateDialog,
    createBusy,
    createError,
    pendingChain,
    joinBusy,
    joinError,
    pendingEndChain,
    endBusy,
    endError,
    openCreateDialog,
    closeCreateDialog,
    createChain,
    openJoin,
    closeJoin,
    joinPendingChain,
    openEndDialog,
    closeEndDialog,
    endPendingChain,
    closeChainSurfaces
  };
}
