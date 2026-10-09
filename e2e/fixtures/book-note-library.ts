import { createApp, h, nextTick, ref } from "vue";
import { createPinia } from "pinia";
import { HANDWRITING_DEFAULT_PREFERENCES } from "../../src/shared/handwriting";
import type { BookNoteDTO } from "../../src/shared/bookNotes";
import { useChatStore } from "../../src/client/store";
import BookReadingActions from "../../src/client/features/books/BookReadingActions.vue";
import { bookNotesClient } from "../../src/client/features/books/bookNotesClient";

/** Isolated real component with deferred own-note reads; no account requests or writes. */
export async function mountBookNoteLibrary(root: HTMLElement) {
  const pinia = createPinia();
  const store = useChatStore(pinia);
  store.account = {
    id: 1, username: "fixture", displayName: "Fixture reader", isAdmin: false,
    canPinMessages: false, actorId: 1, theme: "light", isGuest: false,
    biblePreferences: { outputFormat: "referenceVerseLines", referenceLabelMode: "normalizedFull", combinedPassageMode: "compactEllipsis", quotationStyle: "fullWidth" },
    handwritingPreferences: { ...HANDWRITING_DEFAULT_PREFERENCES }
  };
  const pending: Array<{ resolve: (result: { notes: BookNoteDTO[] }) => void; reject: (error: Error) => void }> = [];
  const originalList = bookNotesClient.list;
  bookNotesClient.list = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
  const actions = ref<InstanceType<typeof BookReadingActions> | null>(null);
  const app = createApp({ render: () => h(BookReadingActions, { ref: actions, selection: null, activeChannelId: null }) });
  app.use(pinia).mount(root);
  await nextTick();
  const note: BookNoteDTO = {
    id: "00000000-0000-4000-8000-000000000001", bookId: 1, bookTitle: "示例图书",
    quote: "原文", text: "导入的笔记", chapter: "第一章", fraction: .15,
    createdAt: "2026-10-09T10:00:00.000Z", updatedAt: "2026-10-09T10:00:00.000Z"
  };
  return {
    note, pending,
    open: () => { void actions.value?.showNotes({ bookId: 1, title: "示例图书", quote: "", chapter: "第一章", fraction: .15 }); },
    changeAccount: () => { if (store.account) store.account = { ...store.account, id: 2 }; },
    destroy: () => { app.unmount(); bookNotesClient.list = originalList; }
  };
}
