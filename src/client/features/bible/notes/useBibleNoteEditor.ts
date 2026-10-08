import { onScopeDispose, ref, shallowRef } from "vue";
import type { BibleNoteDTO, BibleNoteSelection } from "@shared/bibleNotes";
import type { CopyworkSource } from "@shared/bibleCopywork";
import { noteApi } from "./noteApi";

export function useBibleNoteEditor(client = noteApi, newId: () => string = () => crypto.randomUUID()) {
  const editorOpen = ref(false);
  const publicationOpen = ref(false);
  const editorBusy = ref(false);
  const text = ref("");
  const error = ref("");
  const source = shallowRef<CopyworkSource | null>(null);
  const publish = ref(true);
  const alwaysPublic = ref(false);
  const skipPrompt = ref(false);
  let selection: BibleNoteSelection | null = null;
  let id = "";
  let editing = false;
  let createUnconfirmed = false;
  let sequence = 0;

  async function start(value: BibleNoteSelection, existing?: BibleNoteDTO) {
    if (editorBusy.value || editorOpen.value) return;
    const request = ++sequence;
    selection = value;
    id = existing?.id || newId();
    editing = !!existing;
    createUnconfirmed = false;
    source.value = existing?.source || null;
    text.value = existing?.text || "";
    publish.value = existing ? !!existing.publishedAt : true;
    skipPrompt.value = false;
    publicationOpen.value = false;
    error.value = "";
    editorOpen.value = true;
    editorBusy.value = true;
    try {
      const [canonical, preference] = await Promise.all([
        existing ? Promise.resolve({ source: existing.source }) : client.source(value),
        client.preferences()
      ]);
      if (request !== sequence) return;
      source.value = canonical.source;
      alwaysPublic.value = preference.alwaysPublic;
    } catch (cause) {
      if (request === sequence) error.value = cause instanceof Error ? cause.message : "笔记准备失败，请重试";
    } finally {
      if (request === sequence) editorBusy.value = false;
    }
  }

  async function save(): Promise<BibleNoteDTO | null> {
    if (editorBusy.value || !selection || !source.value || !text.value.trim()) return null;
    editorBusy.value = true;
    error.value = "";
    const request = sequence;
    try {
      if (skipPrompt.value && publish.value) {
        await client.savePreferences(true);
        if (request !== sequence) return null;
        alwaysPublic.value = true;
      }
      if (createUnconfirmed) {
        const recovered = await client.recover(id);
        if (request !== sequence) return null;
        editing = !!recovered.note;
      }
      let result;
      const change = { text: text.value.trim(), public: publish.value };
      if (editing) result = await client.update(id, change);
      else {
        createUnconfirmed = true;
        try { result = await client.create(id, selection, change.text, change.public); }
        catch (cause) {
          if (request !== sequence) return null;
          const recovered = await client.recover(id);
          if (request !== sequence) return null;
          if (!recovered.note) throw cause;
          editing = true;
          result = recovered.note.text === change.text && !!recovered.note.publishedAt === change.public
            ? { note: recovered.note }
            : await client.update(id, change);
        }
      }
      if (request !== sequence) return null;
      editorOpen.value = false;
      publicationOpen.value = false;
      return result.note;
    } catch (cause) {
      if (request === sequence) error.value = cause instanceof Error ? cause.message : "笔记保存失败，请重试";
      return null;
    } finally {
      if (request === sequence) editorBusy.value = false;
    }
  }

  async function finish() {
    if (editorBusy.value) return null;
    if (!text.value.trim()) { editorOpen.value = false; return null; }
    if (!source.value) { error.value = "经文尚未准备好，请重试后保存"; return null; }
    if (!editing && alwaysPublic.value) { publish.value = true; return save(); }
    publicationOpen.value = true;
    return null;
  }
  async function retry() {
    if (!selection || editorBusy.value) return;
    editorBusy.value = true;
    error.value = "";
    const request = sequence;
    try {
      const [canonical, preference] = await Promise.all([client.source(selection), client.preferences()]);
      if (request !== sequence) return;
      source.value = canonical.source;
      alwaysPublic.value = preference.alwaysPublic;
    } catch (cause) {
      if (request === sequence) error.value = cause instanceof Error ? cause.message : "笔记准备失败，请重试";
    } finally { if (request === sequence) editorBusy.value = false; }
  }
  onScopeDispose(() => { sequence++; });
  return { editorOpen, publicationOpen, editorBusy, text, error, source, publish, alwaysPublic, skipPrompt, start, save, finish, retry };
}
