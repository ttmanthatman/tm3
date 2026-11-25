import { ref, watch, type Ref } from "vue";
import { api } from "../../api";
import { useChatStore } from "../../store";
import { isBibleStudyRoom } from "@shared/bibleStudy";

export function useStudyWorkspaceIntegration(options: {
  open: Ref<boolean>; openReader: () => void; focus: () => void;
  openChannel: (id: number) => Promise<void>;
}) {
  const store = useChatStore();
  const channelId = ref<number | null>(null);
  const error = ref("");
  let generation = 0;
  async function enter() {
    const request = ++generation, accountId = store.account?.id;
    if (!accountId) return;
    error.value = "";
    try {
      const result = await api<{ channelId: number }>("/api/bible-study/enter", { method: "POST" });
      if (request !== generation || store.account?.id !== accountId || !options.open.value) return;
      channelId.value = result.channelId;
      store.socket?.emit("channel:join", { channelId: result.channelId });
    } catch (cause) {
      if (request === generation) error.value = cause instanceof Error ? cause.message : "查经打开失败，请重试";
    }
  }
  function open() {
    options.openReader();
    options.open.value = true;
    options.focus();
  }
  function close() { options.open.value = false; }
  watch([options.open, () => store.account?.id], ([opened, accountId], previous) => {
    generation++;
    if (!accountId || accountId !== previous?.[1]) channelId.value = null;
    if (opened) void enter();
  }, { immediate: true });
  watch(() => store.currentChannel, channel => {
    if (!channel || !isBibleStudyRoom(channel.directKey)) return;
    open();
    const channels = store.channels.filter(candidate => !isBibleStudyRoom(candidate.directKey));
    const destination = channels.find(candidate => candidate.id === store.previousChannelId)
      ?? channels.find(candidate => candidate.isDefault) ?? channels[0];
    if (destination) void options.openChannel(destination.id).catch(cause => {
      error.value = cause instanceof Error ? cause.message : "聊天室恢复失败";
    });
  }, { immediate: true });
  return { studyChannelId: channelId, studyOpenError: error, openBibleStudy: open, leaveBibleStudy: close, retryStudy: enter };
}
