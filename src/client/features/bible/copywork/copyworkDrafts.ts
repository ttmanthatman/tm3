import type { CopyworkGlyph, CopyworkSource, CopyworkSpacing } from "@shared/bibleCopywork";
import type { HandwritingCharacter } from "@shared/handwriting";
export type CopyworkDraft = {
  id: string;
  uploadId?: string;
  pendingCharacters?: Record<number, HandwritingCharacter>;
  accountId: number;
  source: CopyworkSource;
  spacing: CopyworkSpacing;
  glyphs: CopyworkGlyph[];
  current: HandwritingCharacter;
  index: number;
  updatedAt: number;
};
const STORE = "drafts";
async function transact<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  if (typeof indexedDB === "undefined") throw new Error("当前浏览器无法保存抄写草稿");
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("bible-copywork-drafts", 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = operation(tx.objectStore(STORE));
    tx.oncomplete = () => {
      db.close();
      resolve(request.result);
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(tx.error || new Error("草稿保存失败"));
    };
  });
}
export const copyworkDrafts = {
  async list(accountId: number) {
    return ((await transact("readonly", (s) => s.getAll())) as CopyworkDraft[])
      .filter((d) => d.accountId === accountId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  },
  save(draft: CopyworkDraft) {
    return transact("readwrite", (s) => s.put(JSON.parse(JSON.stringify(draft)) as CopyworkDraft));
  },
  remove(id: string) {
    return transact("readwrite", (s) => s.delete(id));
  }
};
