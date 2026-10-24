import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { WORLD_EXPLORATION_THROTTLE_MS, WORLD_EXPLORATION_TTL_MS, type WorldExplorerDTO } from "@shared/worldExploration";
import { useChatStore } from "../../store";

export function useWorldExploration() {
  const store = useChatStore();
  const explorers = ref<WorldExplorerDTO[]>([]);
  const deadlines = new Map<number, number>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastPublished: number | null = null;

  function clear() {
    clearTimeout(timer);
    timer = undefined;
    deadlines.clear();
    explorers.value = [];
    lastPublished = null;
  }
  function prune() {
    clearTimeout(timer);
    for (const [id, deadline] of deadlines) if (deadline <= Date.now()) deadlines.delete(id);
    explorers.value = explorers.value.filter(explorer => deadlines.has(explorer.accountId));
    if (deadlines.size) timer = setTimeout(prune, Math.max(0, Math.min(...deadlines.values()) - Date.now()));
  }
  function receive(value: WorldExplorerDTO) {
    if (document.visibilityState !== "visible" || !Number.isSafeInteger(value?.accountId) || value.accountId <= 0 || typeof value.displayName !== "string") return;
    deadlines.set(value.accountId, Date.now() + WORLD_EXPLORATION_TTL_MS);
    explorers.value = [...explorers.value.filter(explorer => explorer.accountId !== value.accountId), { accountId: value.accountId, displayName: value.displayName }];
    prune();
  }
  function publish(messageId: number) {
    if (!store.socket?.connected || !store.account || store.account.isGuest || document.visibilityState !== "visible") return;
    if (lastPublished !== null && Date.now() - lastPublished < WORLD_EXPLORATION_THROTTLE_MS) return;
    lastPublished = Date.now();
    store.socket.emit("zoom:exploring", { messageId });
  }
  const visibilityChanged = () => { if (document.visibilityState !== "visible") clear(); };
  const stopWatching = watch(() => store.socket, (socket, previous) => {
    previous?.off("zoom:exploring", receive);
    previous?.off("disconnect", clear);
    clear();
    socket?.on("zoom:exploring", receive);
    socket?.on("disconnect", clear);
  }, { immediate: true });
  onMounted(() => {
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("pagehide", clear);
  });
  onBeforeUnmount(() => {
    stopWatching();
    store.socket?.off("zoom:exploring", receive);
    store.socket?.off("disconnect", clear);
    document.removeEventListener("visibilitychange", visibilityChanged);
    window.removeEventListener("pagehide", clear);
    clear();
  });
  return { explorers, publish };
}
