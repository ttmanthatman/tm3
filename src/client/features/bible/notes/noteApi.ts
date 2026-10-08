import type { BibleNoteDTO, BibleNoteSelection } from "@shared/bibleNotes";
import type { CopyworkSource } from "@shared/bibleCopywork";
import type { MessageDTO } from "@shared/types";
import { api } from "../../../api";
import { copyworkWrite as noteWrite } from "../copywork/copyworkApi";

export const noteApi = {
  source(selection: BibleNoteSelection) {
    const { verse, ...location } = selection;
    return api<{ source: CopyworkSource }>("/api/bible/copyworks/source", {
      method: "POST", body: JSON.stringify({ ...location, verseStart: verse, verseEnd: verse })
    });
  },
  preferences() {
    return api<{ alwaysPublic: boolean }>("/api/bible/notes/preferences");
  },
  savePreferences(alwaysPublic: boolean) {
    return noteWrite<{ alwaysPublic: boolean }>("/api/bible/notes/preferences", {
      method: "PATCH", body: JSON.stringify({ alwaysPublic })
    });
  },
  create(id: string, selection: BibleNoteSelection, text: string, isPublic: boolean) {
    return noteWrite<{ note: BibleNoteDTO }>("/api/bible/notes", {
      method: "POST", body: JSON.stringify({ id, ...selection, text, public: isPublic })
    });
  },
  update(id: string, change: { text?: string; public?: boolean }) {
    return noteWrite<{ note: BibleNoteDTO }>(`/api/bible/notes/${id}`, {
      method: "PATCH", body: JSON.stringify(change)
    });
  },
  get(id: string) { return api<{ note: BibleNoteDTO }>(`/api/bible/notes/${id}`); },
  recover(id: string) { return api<{ note: BibleNoteDTO | null }>(`/api/bible/notes/${id}/recovery`); },
  list(scope: "mine" | "public", filter?: BibleNoteSelection, offset = 0) {
    const query = new URLSearchParams({ scope, offset: String(offset) });
    if (filter) Object.entries(filter).forEach(([key, value]) => query.set(key, String(value)));
    return api<{ notes: BibleNoteDTO[]; nextOffset: number | null }>(`/api/bible/notes?${query}`);
  },
  remove(id: string) { return noteWrite<{ success: true }>(`/api/bible/notes/${id}`, { method: "DELETE" }); },
  share(id: string, channelId: number, clientRequestId: string) {
    return noteWrite<{ message: MessageDTO }>(`/api/bible/notes/${id}/share`, {
      method: "POST", body: JSON.stringify({ channelId, clientRequestId })
    });
  }
};
