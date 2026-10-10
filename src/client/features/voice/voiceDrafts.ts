export type VoiceDraft = {
  accountId: number;
  file: Blob;
  name: string;
  durationMs: number;
  waveform: number[];
  notice: string;
};

export interface VoiceDraftStorage {
  load(accountId: number): Promise<VoiceDraft | undefined>;
  save(draft: VoiceDraft): Promise<void>;
  delete(accountId: number): Promise<void>;
}

type StoredVoiceDraft = Omit<VoiceDraft, "file"> & { bytes: ArrayBuffer; type: string };

// One replaceable slot per account, rather than a new file for every save.
async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  if (typeof indexedDB === "undefined") throw new Error("当前浏览器不支持本机录音草稿存储");
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("team-chat-voice-drafts", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("draft", { keyPath: "accountId" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法打开录音草稿存储"));
  });
  return new Promise((resolve, reject) => {
    const tx = database.transaction("draft", mode);
    const request = operation(tx.objectStore("draft"));
    tx.oncomplete = () => { database.close(); resolve(request.result); };
    tx.onabort = tx.onerror = () => { database.close(); reject(tx.error || request.error || new Error("录音草稿存储失败")); };
  });
}

export const voiceDraftStorage: VoiceDraftStorage = {
  load: async (accountId) => {
    const stored = await transaction<StoredVoiceDraft | undefined>("readonly", (store) => store.get(accountId));
    if (!stored) return undefined;
    const { bytes, type, ...metadata } = stored;
    return { ...metadata, file: new Blob([bytes], { type }) };
  },
  save: async ({ file, ...metadata }) => {
    // Safari/WebKit can fail while preparing Blob/File backing data for IDB.
    // Bytes also avoid retaining a browser-managed temporary file after exit.
    const stored: StoredVoiceDraft = { ...metadata, bytes: await file.arrayBuffer(), type: file.type };
    await transaction("readwrite", (store) => store.put(stored));
  },
  delete: async (accountId) => { await transaction("readwrite", (store) => store.delete(accountId)); }
};
