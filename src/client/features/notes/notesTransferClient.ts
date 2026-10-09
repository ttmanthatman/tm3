import type { BookDTO } from "@shared/types";
import { api } from "../../api";
import { noteApi } from "../bible/notes/noteApi";
import { bookNotesClient } from "../books/bookNotesClient";
import type { NotesBackupClient } from "./notesBackup";

export const notesTransferClient: NotesBackupClient = {
  listBible: (offset) => noteApi.list("mine", undefined, offset),
  createBible: (id, selection, text) => noteApi.create(id, selection, text, false),
  listBooks: () => api<{ books: BookDTO[] }>("/api/books"),
  listBookNotes: (bookId) => bookNotesClient.list(bookId),
  createBook: (bookId, id, note) => bookNotesClient.save(bookId, id, note)
};
