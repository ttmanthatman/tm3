import { computed, ref, type ComputedRef, type Ref } from "vue";
import type { MessageDTO } from "@shared/types";
import { api } from "../../api";
import { useChatStore } from "../../store";

interface UseMessageSelectionOptions {
  showChatToolsMenu: Ref<boolean>;
  showAdmin: Ref<boolean>;
  adminMsg: Ref<string>;
  pinnedExpanded: Ref<boolean>;
  canPinCurrentChannel: ComputedRef<boolean>;
  restoreChatSurface: () => Promise<void>;
  closeCompetingPrompts: () => void;
}

export function useMessageSelection(options: UseMessageSelectionOptions) {
  const store = useChatStore();
  const messageSelectionMode = ref(false);
  const selectedMessageIds = ref<Set<number>>(new Set());

  const selectableMessages = computed(() => store.messages.filter((message) => message.id > 0));
  const selectedMessageCount = computed(() => selectedMessageIds.value.size);
  const visibleMessagesSelected = computed(() => selectableMessages.value.length > 0 && selectableMessages.value.every((message) => selectedMessageIds.value.has(message.id)));

  function toggleMessageSelectionMode() {
    options.showChatToolsMenu.value = false;
    messageSelectionMode.value = !messageSelectionMode.value;
    selectedMessageIds.value = new Set();
    options.closeCompetingPrompts();
  }

  async function startMessageSelectionMode() {
    options.showAdmin.value = false;
    messageSelectionMode.value = true;
    selectedMessageIds.value = new Set();
    await options.restoreChatSurface();
  }

  function toggleMessageSelected(message: MessageDTO) {
    if (message.id <= 0) return;
    const next = new Set(selectedMessageIds.value);
    if (next.has(message.id)) next.delete(message.id);
    else next.add(message.id);
    selectedMessageIds.value = next;
  }

  function toggleVisibleMessageSelection() {
    selectedMessageIds.value = visibleMessagesSelected.value ? new Set() : new Set(selectableMessages.value.map((message) => message.id));
  }

  async function deleteSelectedMessages() {
    const ids = [...selectedMessageIds.value];
    if (!ids.length) return;
    if (!confirm(`删除选中的 ${ids.length} 条聊天记录？附件文件也会一并删除。`)) return;
    const result = await api<{ deleted: number }>("/api/admin/messages", {
      method: "DELETE",
      body: JSON.stringify({ ids })
    });
    options.adminMsg.value = `已删除 ${result.deleted} 条聊天记录`;
    selectedMessageIds.value = new Set();
    await store.loadMessages();
  }

  async function pinSelectedMessages() {
    const ids = [...selectedMessageIds.value];
    if (!ids.length || !store.currentChannelId || !options.canPinCurrentChannel.value) return;
    const result = await api<{ pinned: NonNullable<typeof store.pinned> }>(`/api/channels/${store.currentChannelId}/pinned`, {
      method: "POST",
      body: JSON.stringify({ messageIds: ids, active: true })
    });
    store.pinned = result.pinned;
    const ch = store.channels.find((channel) => channel.id === store.currentChannelId);
    if (ch) ch.pinned = result.pinned;
    options.pinnedExpanded.value = true;
    selectedMessageIds.value = new Set();
    messageSelectionMode.value = false;
  }

  return {
    messageSelectionMode,
    selectedMessageIds,
    selectableMessages,
    selectedMessageCount,
    visibleMessagesSelected,
    toggleMessageSelectionMode,
    startMessageSelectionMode,
    toggleMessageSelected,
    toggleVisibleMessageSelection,
    deleteSelectedMessages,
    pinSelectedMessages
  };
}
