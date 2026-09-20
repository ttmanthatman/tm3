export type PendingUploadDraftOptions = {
  voice?: boolean;
  durationMs?: number;
  waveform?: number[];
  originalImage?: boolean;
};

export type PendingUploadDraft = {
  key: string;
  id: number;
  accountId: number;
  channelId: number;
  createdAt: string;
  file: File;
  options: PendingUploadDraftOptions;
};

const DB_NAME = "team-chat-local-drafts";
const STORE_NAME = "pending-uploads";
const DB_VERSION = 1;

export function pendingUploadDraftKey(accountId: number, id: number) {
  return `${accountId}:${id}`;
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法打开本机草稿存储"));
  });
}

async function withStore<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  const database = await openDatabase();
  if (!database) {
    if (mode === "readwrite") throw new Error("当前浏览器不支持本机草稿存储");
    return undefined;
  }
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = operation(transaction.objectStore(STORE_NAME));
    let result: T | undefined;
    let requestError: DOMException | null = null;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => { requestError = request.error; };
    transaction.oncomplete = () => {
      database.close();
      resolve(result);
    };
    const fail = () => {
      database.close();
      reject(requestError || transaction.error || new Error("本机草稿事务失败"));
    };
    transaction.onerror = fail;
    transaction.onabort = fail;
  });
}

export async function savePendingUploadDraft(draft: Omit<PendingUploadDraft, "key">) {
  await withStore("readwrite", (store) => store.put({ ...draft, key: pendingUploadDraftKey(draft.accountId, draft.id) }));
}

export async function deletePendingUploadDraft(accountId: number, id: number) {
  await withStore("readwrite", (store) => store.delete(pendingUploadDraftKey(accountId, id)));
}

export function selectPendingUploadDrafts(drafts: PendingUploadDraft[], accountId: number, channelId: number) {
  return drafts
    .filter((draft) => draft.accountId === accountId && draft.channelId === channelId && draft.file instanceof Blob)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function listPendingUploadDrafts(accountId: number, channelId: number): Promise<PendingUploadDraft[]> {
  const drafts = (await withStore<PendingUploadDraft[]>("readonly", (store) => store.getAll())) || [];
  return selectPendingUploadDrafts(drafts, accountId, channelId);
}
