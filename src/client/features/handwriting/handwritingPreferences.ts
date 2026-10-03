import { ref } from "vue";
import { normalizeHandwritingPreferences, type HandwritingPreferencesDTO } from "@shared/handwriting";
import type { AccountDTO } from "@shared/types";
import { api } from "../../api";

type AccountStore = { account: AccountDTO | null };
type SavePreferences = (preferences: HandwritingPreferencesDTO) => Promise<{ account: AccountDTO }>;

export function createHandwritingPreferences(
  store: AccountStore,
  persist: SavePreferences
) {
  const error = ref("");
  let chain = Promise.resolve();
  let revision = 0;
  let confirmed: HandwritingPreferencesDTO | null = null;
  let accountId: number | null = null;

  function save(preferences: HandwritingPreferencesDTO) {
    if (!store.account) return Promise.resolve();
    const account = store.account;
    if (accountId !== account.id) {
      accountId = account.id;
      confirmed = normalizeHandwritingPreferences(account.handwritingPreferences);
    }
    const next = normalizeHandwritingPreferences(preferences);
    account.handwritingPreferences = next;
    const currentRevision = ++revision;
    error.value = "";
    chain = chain.then(async () => {
      if (currentRevision !== revision || store.account?.id !== account.id) return;
      try {
        const result = await persist(next);
        if (store.account?.id !== account.id) return;
        confirmed = normalizeHandwritingPreferences(result.account.handwritingPreferences);
        if (currentRevision === revision) store.account.handwritingPreferences = confirmed;
      } catch {
        if (currentRevision === revision && store.account?.id === account.id) {
          if (confirmed) store.account.handwritingPreferences = confirmed;
          error.value = "手写参数保存失败，已恢复上次保存的参数，请重试";
        }
      }
    });
    return chain;
  }
  return { save, error };
}

const writers = new WeakMap<AccountStore, ReturnType<typeof createHandwritingPreferences>>();
export function useHandwritingPreferences(store: AccountStore) {
  let writer = writers.get(store);
  if (!writer) {
    writer = createHandwritingPreferences(store, (preferences) => api<{ account: AccountDTO }>("/api/me/preferences", {
      method: "PATCH",
      body: JSON.stringify({ handwritingPreferences: preferences })
    }));
    writers.set(store, writer);
  }
  return writer;
}
