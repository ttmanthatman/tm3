import { computed, ref, type ComputedRef, type Ref } from "vue";
import type { ChannelDTO, MessageDTO } from "@shared/types";
import { useChatStore } from "../../store";
import {
  chatRecordPreviewLines,
  chatRecordPreviewPayload,
  chatRecordPreviewTitle,
  forwardTargetChannels as resolveForwardTargetChannels,
  forwardableMessages,
  isForwardableMessage
} from "../../messageForward";

interface UseMessageForwardOptions {
  pendingMessageActions: Ref<MessageDTO | null>;
  pendingChain: Ref<MessageDTO | null>;
  messageSelectionMode: Ref<boolean>;
  selectedMessageIds: Ref<Set<number>>;
  currentChannel: ComputedRef<ChannelDTO | null>;
  toggleMessageSelected: (message: MessageDTO) => void;
  closeMessageActionMenu: () => void;
  submitForward: (payload: { messageIds: number[]; channelIds: number[]; mode: "separate" | "merged" }) => Promise<unknown>;
}

export function useMessageForward(options: UseMessageForwardOptions) {
  const store = useChatStore();
  const forwardActionSheetOpen = ref(false);
  const forwardPickerOpen = ref(false);
  const forwardSourceMessages = ref<MessageDTO[]>([]);
  const forwardMode = ref<"separate" | "merged">("separate");
  const forwardConfirming = ref(false);
  const forwardChannelIds = ref<number[]>([]);
  const forwardBusy = ref(false);
  const forwardError = ref("");
  const forwardSuccess = ref(false);
  let forwardSuccessTimer: ReturnType<typeof setTimeout> | null = null;
  const chatRecordViewMessage = ref<MessageDTO | null>(null);

  const forwardTargetChannels = computed(() => resolveForwardTargetChannels(store.channels));
  const forwardSelectedChannels = computed(() =>
    forwardTargetChannels.value.filter((channel) => forwardChannelIds.value.includes(channel.id))
  );
  const forwardMergedPreviewPayload = computed(() =>
    chatRecordPreviewPayload(chatRecordPreviewTitle(options.currentChannel.value?.name || ""), store.currentChannelId || 0, forwardSourceMessages.value)
  );
  const forwardMergedPreviewLines = computed(() => chatRecordPreviewLines(forwardMergedPreviewPayload.value));

  function resetForwardState() {
    forwardPickerOpen.value = false;
    forwardActionSheetOpen.value = false;
    forwardSourceMessages.value = [];
    forwardChannelIds.value = [];
    forwardMode.value = "separate";
    forwardConfirming.value = false;
    forwardError.value = "";
    forwardSuccess.value = false;
    if (forwardSuccessTimer) {
      clearTimeout(forwardSuccessTimer);
      forwardSuccessTimer = null;
    }
  }

  function closeForwardDialog() {
    if (forwardBusy.value) return;
    resetForwardState();
  }

  function toggleForwardChannel(channelId: number) {
    const next = new Set(forwardChannelIds.value);
    if (next.has(channelId)) next.delete(channelId);
    else next.add(channelId);
    forwardChannelIds.value = [...next];
  }

  function openSingleForward() {
    const message = options.pendingMessageActions.value;
    if (!message || !isForwardableMessage(message)) return;
    resetForwardState();
    forwardSourceMessages.value = [message];
    forwardPickerOpen.value = true;
    options.closeMessageActionMenu();
  }

  function startSelectionFromAction() {
    const message = options.pendingMessageActions.value;
    if (!message || message.id <= 0) return;
    options.messageSelectionMode.value = true;
    options.selectedMessageIds.value = new Set([message.id]);
    options.pendingChain.value = null;
    options.pendingMessageActions.value = null;
  }

  function openForwardActionSheet() {
    const selected = store.messages.filter((message) => options.selectedMessageIds.value.has(message.id));
    const { supported, skippedCount } = forwardableMessages(selected);
    if (!supported.length) {
      alert("所选消息暂不支持转发");
      return;
    }
    if (skippedCount > 0) alert(`有 ${skippedCount} 条消息类型不支持转发，已跳过`);
    resetForwardState();
    forwardSourceMessages.value = supported;
    forwardActionSheetOpen.value = true;
  }

  function chooseForwardMode(mode: "separate" | "merged") {
    forwardMode.value = mode;
    forwardActionSheetOpen.value = false;
    forwardPickerOpen.value = true;
  }

  async function submitMessageForward() {
    if (forwardBusy.value || !forwardChannelIds.value.length || !forwardSourceMessages.value.length) return;
    forwardBusy.value = true;
    forwardError.value = "";
    try {
      await options.submitForward({
        messageIds: forwardSourceMessages.value.map((message) => message.id),
        channelIds: forwardChannelIds.value,
        mode: forwardMode.value
      });
      forwardSuccess.value = true;
      options.messageSelectionMode.value = false;
      options.selectedMessageIds.value = new Set();
      forwardSuccessTimer = setTimeout(() => {
        forwardSuccessTimer = null;
        resetForwardState();
      }, 1200);
    } catch (error) {
      forwardError.value = error instanceof Error ? error.message : "转发失败";
    } finally {
      forwardBusy.value = false;
    }
  }

  function openChatRecord(message: MessageDTO) {
    if (options.messageSelectionMode.value) {
      options.toggleMessageSelected(message);
      return;
    }
    chatRecordViewMessage.value = message;
  }

  return {
    forwardActionSheetOpen,
    forwardPickerOpen,
    forwardSourceMessages,
    forwardMode,
    forwardConfirming,
    forwardChannelIds,
    forwardBusy,
    forwardError,
    forwardSuccess,
    chatRecordViewMessage,
    forwardTargetChannels,
    forwardSelectedChannels,
    forwardMergedPreviewPayload,
    forwardMergedPreviewLines,
    resetForwardState,
    closeForwardDialog,
    toggleForwardChannel,
    openSingleForward,
    startSelectionFromAction,
    openForwardActionSheet,
    chooseForwardMode,
    submitMessageForward,
    openChatRecord
  };
}
