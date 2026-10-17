import { computed, onScopeDispose, ref, shallowRef, watch } from "vue";
import { bookNoteHasContent, type BookNoteDTO } from "@shared/bookNotes";
import type { HandwritingPayload } from "@shared/handwriting";
import { bookNotesClient } from "./bookNotesClient";
import type { BookReadingContext } from "./bookReading";
import { bookLocatorSchema } from "@shared/bookLocator";

type Options = { accountId(): number | undefined; changed(bookId: number): void; client?: typeof bookNotesClient };
export function useBookNoteEditor(options: Options) {
  const client = options.client ?? bookNotesClient;
  const context = shallowRef<BookReadingContext | null>(null);
  const text = ref("");
  const handwriting = shallowRef<HandwritingPayload | null>(null);
  const busy = ref(false), error = ref("");
  let id = "", original = "", existing: BookNoteDTO | null = null, generation = 0;
  let alive = true;
  const content = () => JSON.stringify([text.value, handwriting.value]);
  const hasContent = computed(() => bookNoteHasContent({ text: text.value, handwriting: handwriting.value }));
  function reset() { generation++; context.value = null; text.value = ""; handwriting.value = null; busy.value = false; error.value = ""; existing = null; }
  function edit(next: BookReadingContext, note?: BookNoteDTO) {
    if (busy.value || !options.accountId()) return;
    generation++;
    context.value = { ...next }; existing = note ?? null;
    id = note?.id ?? crypto.randomUUID(); text.value = note?.text ?? ""; handwriting.value = note?.handwriting ?? null;
    original = content(); error.value = "";
  }
  async function save(draft: boolean, close = true): Promise<BookNoteDTO | null> {
    const selected = context.value, accountId = options.accountId(), sequence = generation;
    if (!selected || !accountId || busy.value) return null;
    const current = () => alive && generation === sequence && options.accountId() === accountId;
    if (!hasContent.value && !existing) { if (close) reset(); return null; }
    if (draft && content() === original) { const note = existing; if (close) reset(); return note; }
    busy.value = true; error.value = "";
    try {
      let saved: BookNoteDTO | null = null;
      if (hasContent.value) {
        const locator = bookLocatorSchema.safeParse(selected.locator);
        saved = (await client.save(selected.bookId, id, {
          quote: selected.quote, chapter: selected.chapter, fraction: selected.fraction,
          text: text.value, handwriting: handwriting.value, draft, ...(locator.success ? { locator: locator.data } : {})
        })).note;
      } else await client.remove(selected.bookId, id);
      if (!current()) return null;
      existing = saved; original = content(); options.changed(selected.bookId);
      if (close) reset();
      return saved;
    } catch (cause) {
      if (current()) error.value = cause instanceof Error ? cause.message : "笔记保存失败，内容已保留，请重试";
      return null;
    } finally { if (current()) busy.value = false; }
  }
  watch(options.accountId, reset, { flush: "sync" });
  onScopeDispose(() => { alive = false; generation++; });
  return { context, text, handwriting, busy, error, hasContent, edit, save, reset, close: () => save(true) };
}
