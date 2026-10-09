import type { BookNoteDTO, BookNoteInput } from "@shared/bookNotes";
import { api } from "../../api";

async function write<T>(path: string, options: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("请求超时，笔记内容已保留，请重试")), 20_000);
  try { return await api<T>(path, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timeout); }
}

export const bookNotesClient = {
  list(bookId: number) { return api<{ notes: BookNoteDTO[] }>(`/api/books/${bookId}/notes`); },
  save(bookId: number, id: string, note: BookNoteInput) {
    return write<{ note: BookNoteDTO }>(`/api/books/${bookId}/notes/${id}`, { method: "PUT", body: JSON.stringify(note) });
  },
  remove(bookId: number, id: string) { return write<{ success: true }>(`/api/books/${bookId}/notes/${id}`, { method: "DELETE" }); }
};
