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
  const color = ref("");
  const busy = ref(false), error = ref("");
  let id = "", original = "", generation = 0;
  const existing = shallowRef<BookNoteDTO | null>(null);
  let alive = true;
  const content = () => JSON.stringify([text.value, handwriting.value, color.value]);
  const hasContent = computed(() => !!color.value || bookNoteHasContent({ text: text.value, handwriting: handwriting.value }));
  function reset() { generation++; context.value = null; text.value = ""; handwriting.value = null; color.value = ""; busy.value = false; error.value = ""; existing.value = null; }
  function edit(next: BookReadingContext, note?: BookNoteDTO) {
    if (busy.value || !options.accountId()) return;
    generation++;
    context.value = { ...next }; existing.value = note ?? null;
    id = note?.id ?? crypto.randomUUID(); text.value = note?.text ?? ""; handwriting.value = note?.handwriting ?? null;
    color.value = note?.color ?? ""; original = content(); error.value = "";
  }
  async function save(draft: boolean, close = true): Promise<BookNoteDTO | null> {
    const selected = context.value, accountId = options.accountId(), sequence = generation;
    if (!selected || !accountId || busy.value) return null;
    const current = () => alive && generation === sequence && options.accountId() === accountId;
    if (!hasContent.value && !existing.value) { if (close) reset(); return null; }
    if (draft && content() === original) { const note = existing.value; if (close) reset(); return note; }
    busy.value = true; error.value = "";
    try {
      let saved: BookNoteDTO | null = null;
      if (hasContent.value) {
        const locator = bookLocatorSchema.safeParse(selected.locator);
        saved = (await client.save(selected.bookId, id, {
          quote: selected.quote, chapter: selected.chapter, fraction: selected.fraction,
          text: text.value, handwriting: handwriting.value, draft, ...(color.value ? { color: color.value } : {}), ...(locator.success ? { locator: locator.data } : {})
        })).note;
      } else await client.remove(selected.bookId, id);
      if (!current()) return null;
      existing.value = saved; original = content(); options.changed(selected.bookId);
      if (close) reset();
      return saved;
    } catch (cause) {
      if (current()) error.value = cause instanceof Error ? cause.message : "笔记保存失败，内容已保留，请重试";
      return null;
    } finally { if (current()) busy.value = false; }
  }
  async function remove() {
    const selected = context.value, accountId = options.accountId(), sequence = generation;
    if (!selected || !existing.value || !accountId || busy.value) return;
    const current = () => alive && generation === sequence && options.accountId() === accountId;
    busy.value = true; error.value = "";
    try {
      await client.remove(selected.bookId, id);
      if (current()) { options.changed(selected.bookId); reset(); }
    } catch (cause) {
      if (current()) error.value = cause instanceof Error ? cause.message : "删除失败，请重试";
    } finally { if (current()) busy.value = false; }
  }
  async function unfavorite() {
    if (!color.value || busy.value) return;
    const previous = color.value, selected = context.value;
    color.value = "";
    await save(false);
    if (context.value === selected && error.value) color.value = previous;
  }
  watch(options.accountId, reset, { flush: "sync" });
  onScopeDispose(() => { alive = false; generation++; });
  return { context, text, handwriting, color, existing, busy, error, hasContent, edit, save, remove, unfavorite, reset, close: () => save(true) };
}
