import { onScopeDispose, ref, watch } from "vue";
import { getToken } from "../../api";
import type { BookProgressSnapshot } from "@shared/bookLocator";
import { createBookProgressSync, type BookSyncState } from "./bookProgressSync";

export function useBookProgress(accountId: () => number | undefined) {
  const state = ref<BookSyncState>({ status: "saved" });
  const sync = createBookProgressSync({
    accountId, storage: localStorage, changed: value => { state.value = value; },
    async request(bookId, input, signal) {
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(abort, input ? 10000 : 1500);
      try {
        if (signal.aborted) throw new Error("已结束阅读同步");
        const response = await fetch(`/api/books/${bookId}/progress/v2`, { method: input ? "PUT" : "GET", signal: controller.signal,
          cache: "no-store", headers: { Authorization: `Bearer ${getToken()}`, ...(input ? { "Content-Type": "application/json" } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}) });
        const body = await response.json() as { progress: BookProgressSnapshot };
        return { status: response.status, progress: body.progress };
      } finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
    }
  });
  const online = () => { sync.retry(); };
  window.addEventListener("online", online);
  watch(accountId, () => { sync.stop(); state.value = { status: "signed-out" }; }, { flush: "sync" });
  onScopeDispose(() => { sync.close(); window.removeEventListener("online", online); });
  return { ...sync, state };
}
