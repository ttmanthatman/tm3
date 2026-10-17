import { computed, inject, onScopeDispose, provide, ref, watch, type InjectionKey } from "vue";
import type { AccountDTO, BiblePreferencesDTO, BibleSearchHistoryDTO } from "@shared/types";
import { api } from "../../api";
import { useChatStore } from "../../store";
import { loadBibleWorkspaceState } from "../../bibleWorkspaceState";

export function provideBibleAccountState(accountId: () => number, open: () => boolean, notify: (message: string) => void) {
  const store = useChatStore();
  const preferences = computed(() => store.account?.biblePreferences);
  const history = ref<BibleSearchHistoryDTO[]>([]);
  const historyError = ref("");
  const preferencesBusy = ref(false);
  let refreshSequence = 0;
  let preferenceRevision = 0;
  async function refreshHistory() {
    const id = accountId(), sequence = ++refreshSequence;
    if (!id) return;
    try {
      const marker = `tm3:bible-history-imported:${id}`;
      const legacy = localStorage.getItem(marker) ? [] : loadBibleWorkspaceState(localStorage, id)?.history || [];
      if (legacy.length) {
        await api("/api/bible/search/history/import", { method: "POST", body: JSON.stringify({ entries: legacy.slice(0, 20).map(entry => ({
          kind: entry.kind, query: entry.query, updatedAt: entry.updatedAt,
          translation: entry.kind === "text" ? entry.translation || entry.result.sourceId || "cmn-cu89s" : "cmn-cu89s",
          count: entry.kind === "text" ? entry.result.total : entry.result.results.length
        })) }) });
      }
      if (accountId() !== id || sequence !== refreshSequence) return;
      localStorage.setItem(marker, "1");
      const response = await api<{ history: BibleSearchHistoryDTO[] }>("/api/bible/search/history");
      if (accountId() !== id || sequence !== refreshSequence) return;
      history.value = response.history;
      historyError.value = "";
    } catch (cause) {
      if (accountId() === id && sequence === refreshSequence) historyError.value = cause instanceof Error ? cause.message : "检索历史同步失败，请重试";
    }
  }
  async function clearHistory() {
    const id = accountId();
    try {
      await api("/api/bible/search/history", { method: "DELETE" });
      if (id === accountId()) { refreshSequence++; history.value = []; historyError.value = ""; }
    } catch (cause) { notify(cause instanceof Error ? cause.message : "清空失败，请重试"); }
  }
  async function savePreferences(patch: Partial<BiblePreferencesDTO>) {
    const id = accountId();
    if (preferencesBusy.value) throw new Error("偏好正在保存，请稍后重试");
    preferenceRevision++;
    preferencesBusy.value = true;
    try {
      const result = await api<{ account: AccountDTO }>("/api/me/preferences", { method: "PATCH", body: JSON.stringify({ biblePreferences: patch }) });
      if (id === accountId() && store.account) store.account.biblePreferences = result.account.biblePreferences;
    } finally { preferencesBusy.value = false; }
  }
  async function refreshPreferences() {
    const id = accountId(), revision = preferenceRevision;
    const result = await api<{ account: AccountDTO }>("/api/auth/me");
    if (id === accountId() && revision === preferenceRevision && store.account && !preferencesBusy.value) store.account.biblePreferences = result.account.biblePreferences;
  }
  function refresh() {
    if (!open()) return;
    void refreshHistory();
    void refreshPreferences().catch(cause => notify(cause instanceof Error ? cause.message : "偏好同步失败"));
  }
  watch(accountId, () => { refreshSequence++; history.value = []; historyError.value = ""; });
  watch([accountId, open], refresh, { immediate: true });
  window.addEventListener("focus", refresh);
  onScopeDispose(() => { refreshSequence++; window.removeEventListener("focus", refresh); });
  const state = { preferences, preferencesBusy, history, historyError, refreshHistory, clearHistory, savePreferences, refreshPreferences };
  provide(bibleAccountStateKey, state);
  return state;
}
export const bibleAccountStateKey: InjectionKey<ReturnType<typeof provideBibleAccountState>> = Symbol("bibleAccountState");
export function useBibleAccountState() {
  const state = inject(bibleAccountStateKey);
  if (!state) throw new Error("Bible account state is unavailable");
  return state;
}
