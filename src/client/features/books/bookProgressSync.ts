import { bookLocatorSchema, bookProgressWriteSchema, type BookProgressSnapshot, type BookProgressWrite } from "@shared/bookLocator";
import type { BookLocation } from "./bookReading";

export type BookSyncState = { status: "saved" | "pending" | "offline" | "conflict" | "signed-out" | "storage-error" | "revision-mismatch"; remote?: BookProgressSnapshot };
type Saved = { revision: number; pending?: BookProgressWrite; remote?: BookProgressSnapshot; conflict?: boolean; mismatched?: boolean };
type Session = Saved & { key: string; bookId: number; accountId: number; busy: boolean; conflict: boolean; controller: AbortController };
type Options = {
  accountId(): number | undefined;
  storage: Pick<Storage, "getItem" | "setItem">;
  request(bookId: number, input: BookProgressWrite | null, signal: AbortSignal): Promise<{ status: number; progress: BookProgressSnapshot }>;
  changed(state: BookSyncState): void;
};

/** One coalesced pending position per account/book; revisions, never clocks, order writes. */
export function createBookProgressSync(options: Options) {
  const sessions = new Map<string, Session>();
  let active: Session | undefined;
  const publish = (session: Session, state: BookSyncState) => { if (session === active && options.accountId() === session.accountId) options.changed(state); };
  const persist = (session: Session) => {
    try { options.storage.setItem(session.key, JSON.stringify({ revision: session.revision, pending: session.pending, remote: session.remote, conflict: session.conflict, mismatched: session.mismatched })); return true; }
    catch { publish(session, { status: "storage-error" }); return false; }
  };
  const location = (bookId: number, fraction: number | null | undefined, locator?: unknown): BookLocation | undefined => {
    if (fraction === null || fraction === undefined) return;
    const parsed = bookLocatorSchema.safeParse(locator);
    return { bookId, fraction, ...(parsed.success ? { locator: parsed.data } : {}) };
  };
  async function flush(session = active): Promise<void> {
    if (!session || session.busy || !session.pending || session.conflict || options.accountId() !== session.accountId) return;
    const sent = session.pending;
    session.busy = true;
    try {
      const result = await options.request(session.bookId, sent, session.controller.signal);
      if (options.accountId() !== session.accountId || session.controller.signal.aborted) return;
      if (result.status === 401) { publish(session, { status: "signed-out" }); session.controller.abort(); return; }
      if (result.status === 422) { session.conflict = true; session.mismatched = true; persist(session); publish(session, { status: "revision-mismatch" }); return; }
      if (![200, 409].includes(result.status)) throw new Error("阅读进度暂未同步");
      session.remote = result.progress;
      if (result.status === 409) { session.conflict = true; publish(session, { status: "conflict", remote: result.progress }); }
      else {
        session.revision = result.progress.revision;
        if (session.pending?.mutationId === sent.mutationId) session.pending = undefined;
        else if (session.pending) session.pending = { ...session.pending, baseRevision: session.revision };
        publish(session, { status: session.pending ? "pending" : "saved" });
      }
      persist(session);
    } catch {
      if (!session.controller.signal.aborted) publish(session, { status: "offline" });
    } finally { session.busy = false; }
    // A newer real reading intent supersedes the request in flight.
    if (session.pending && session.pending.mutationId !== sent.mutationId && !session.conflict) await flush(session);
  }
  return {
    async open(bookId: number) {
      const accountId = options.accountId();
      if (!accountId) { active = undefined; return { publicationRevision: null, location: undefined }; }
      const key = `book-progress.v2.${accountId}.${bookId}`;
      let session = sessions.get(key);
      if (!session || session.controller.signal.aborted) {
        let saved: Saved = { revision: 0 };
        try {
          const raw = JSON.parse(options.storage.getItem(key) ?? "null") as Saved | null;
          if (raw && Number.isSafeInteger(raw.revision) && raw.revision >= 0) {
            const pending = bookProgressWriteSchema.safeParse(raw.pending);
            saved = { revision: raw.revision, conflict: raw.conflict === true, mismatched: raw.mismatched === true,
              ...(pending.success && (!pending.data.locator || pending.data.locator.bookId === bookId) ? { pending: pending.data } : {}) };
          }
        } catch { /* A malformed local cache cannot become a precise address. */ }
        session = { ...saved, key, bookId, accountId, busy: false, conflict: saved.conflict ?? false, controller: new AbortController() };
        sessions.set(key, session);
      }
      active = session;
      try {
        const result = await options.request(bookId, null, session.controller.signal);
        if (active !== session || options.accountId() !== accountId || session.controller.signal.aborted) return { publicationRevision: null, location: undefined };
        if (result.status === 401) { publish(session, { status: "signed-out" }); session.controller.abort(); return { publicationRevision: null, location: undefined }; }
        if (result.status !== 200) throw new Error("无法读取远端进度");
        session.remote = result.progress;
        if (!session.pending) session.revision = result.progress.revision;
        if (persist(session)) publish(session, session.conflict ? { status: session.mismatched ? "revision-mismatch" : "conflict", remote: session.remote } : { status: session.pending ? "pending" : "saved" });
        const local = session.pending;
        const restore = local ? location(bookId, local.fraction, local.locator?.publicationRevision === result.progress.publicationRevision ? local.locator : null)
          : location(bookId, result.progress.fraction, result.progress.locator);
        if (local) void flush(session);
        return { publicationRevision: result.progress.publicationRevision, location: restore };
      } catch {
        publish(session, { status: "offline" });
        return { publicationRevision: null, location: location(bookId, session.pending?.fraction) };
      }
    },
    record(position: BookLocation) {
      const session = active;
      if (!session || session.bookId !== position.bookId || session.controller.signal.aborted || options.accountId() !== session.accountId) return;
      const parsed = bookLocatorSchema.safeParse(position.locator);
      if (session.mismatched && (!parsed.success || parsed.data.publicationRevision === session.remote?.publicationRevision)) { session.mismatched = false; session.conflict = false; }
      session.pending = { fraction: position.fraction, locator: parsed.success ? parsed.data : null, baseRevision: session.revision, mutationId: crypto.randomUUID() };
      if (persist(session)) publish(session, session.conflict ? { status: session.mismatched ? "revision-mismatch" : "conflict", remote: session.remote } : { status: "pending" });
    },
    flush,
    retry() { for (const session of sessions.values()) if (session.accountId === options.accountId()) void flush(session); },
    close() { const session = active; active = undefined; if (session) void flush(session); },
    resolve(choice: "local" | "remote") {
      const session = active;
      if (!session?.conflict || !session.remote) return;
      const remote = session.remote;
      session.revision = remote.revision; session.conflict = false;
      if (choice === "remote") { session.pending = undefined; persist(session); publish(session, { status: "saved" }); return location(session.bookId, remote.fraction, remote.locator); }
      if (session.pending) session.pending = { ...session.pending, baseRevision: remote.revision, mutationId: crypto.randomUUID() };
      persist(session); void flush(session);
    },
    stop() { active = undefined; for (const session of sessions.values()) session.controller.abort(); sessions.clear(); }
  };
}
