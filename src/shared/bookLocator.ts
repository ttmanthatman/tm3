import { z } from "zod";

export const BOOK_TEXT_REVISION = "epub-text-v1" as const;
export type BookPublication = { bookId: number; publicationRevision: string | null; sessionId?: string };

// Persisted addresses always identify immutable EPUB bytes. Session addresses
// remain client-only until a publication digest is available.
export const bookLocatorSchema = z.object({
  version: z.literal(1),
  bookId: z.number().int().positive().max(2147483647),
  publicationRevision: z.string().regex(/^[a-f0-9]{64}$/),
  textRevision: z.literal(BOOK_TEXT_REVISION),
  sectionHref: z.string().min(1).max(1000).refine(value => {
    try { const url = new URL(value, "https://epub.invalid/"); return url.origin === "https://epub.invalid" && url.pathname.slice(1) === value && !url.search && !url.hash; }
    catch { return false; }
  }),
  sectionIndex: z.number().int().min(0).max(100000).optional(),
  start: z.number().int().min(0).max(100000000),
  end: z.number().int().positive().max(100000000),
  cfi: z.string().max(4000).startsWith("epubcfi(").endsWith(")").optional(),
  quote: z.object({ exact: z.string().min(1).max(256), prefix: z.string().max(48), suffix: z.string().max(48), length: z.number().int().positive().max(100000000), tail: z.string().min(1).max(128).optional() }).strict(),
  fraction: z.number().finite().min(0).max(1).optional()
}).strict().refine(value => value.end > value.start && value.quote.length === value.end - value.start && value.quote.exact.length <= value.quote.length);

export type PersistedBookLocator = z.infer<typeof bookLocatorSchema>;
export type BookLocatorV1 = Omit<PersistedBookLocator, "publicationRevision"> & BookPublication;
export const bookProgressWriteSchema = z.object({
  fraction: z.number().finite().min(0).max(1), locator: bookLocatorSchema.nullable(),
  baseRevision: z.number().int().min(0).max(2147483646), mutationId: z.string().uuid()
}).strict();
export type BookProgressWrite = z.infer<typeof bookProgressWriteSchema>;
export type BookProgressSnapshot = {
  bookId: number; publicationRevision: string | null; fraction: number | null;
  locator: PersistedBookLocator | null; revision: number; locatorRevision: number | null;
};
