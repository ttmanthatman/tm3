import { onBeforeUnmount, onMounted, watch } from "vue";
import { useChatStore } from "../../store";

export function useSocialRefresh(load: () => Promise<void>, accepts: (event: { channelId: number; pollId?: number }) => boolean) {
  const store = useChatStore();
  let running = false;
  let pending = false;
  let disposed = false;
  async function refresh() {
    if (disposed || document.hidden) return;
    if (running) { pending = true; return; }
    running = true;
    try { do { pending = false; await load(); } while (pending && !disposed); }
    finally { running = false; }
  }
  const changed = (event: { channelId: number; pollId?: number }) => { if (accepts(event)) void refresh(); };
  const visible = () => { if (!document.hidden) void refresh(); };
  watch(() => store.socket, (socket, previous) => {
    previous?.off("social:changed", changed); previous?.off("connect", visible);
    socket?.on("social:changed", changed); socket?.on("connect", visible);
    void refresh();
  }, { immediate: true });
  onMounted(() => document.addEventListener("visibilitychange", visible));
  onBeforeUnmount(() => {
    disposed = true;
    store.socket?.off("social:changed", changed); store.socket?.off("connect", visible);
    document.removeEventListener("visibilitychange", visible);
  });
  return refresh;
}
