export const BOOK_QUOTE_MAX = 5000;
export const BOOK_NOTE_TEXT_MAX = 10000;
export const BOOK_NOTE_CHAPTER_MAX = 300;

export type BookNoteInput = {
  quote: string;
  text: string;
  chapter: string;
  fraction: number;
};

export type BookNoteDTO = BookNoteInput & {
  id: string;
  bookId: number;
  bookTitle: string;
  createdAt: string;
  updatedAt: string;
};
