import {
  HANDWRITING_DRAFT_LIMITS,
  HANDWRITING_SEND_LIMITS,
  normalizeHandwritingPayload,
  type HandwritingPayload
} from "@shared/handwriting";

export const HANDWRITING_DRAFT_CHANNEL_LIMIT = 8;

export type HandwritingDraftScope = {
  accountId: number;
  actorId: number;
  channelId: number;
};

export type HandwritingDraftSnapshot = {
  revision: number;
  payload: HandwritingPayload;
  updatedAt: number;
};

export type HandwritingPendingSend = {
  clientRequestId: string;
  revision: number;
  payload: HandwritingPayload;
  replyToId: number | null;
  createdAt: number;
};

export type HandwritingDraftRecord = HandwritingDraftScope & {
  key: string;
  draft?: HandwritingDraftSnapshot;
  pending?: HandwritingPendingSend;
};

export interface HandwritingDraftStorage {
  list(): Promise<HandwritingDraftRecord[]>;
  put(record: HandwritingDraftRecord): Promise<void>;
  delete(key: string): Promise<void>;
}

const DB_NAME = "team-chat-handwriting-drafts";
const STORE_NAME = "channel-drafts";
const DB_VERSION = 1;

export function handwritingDraftKey(scope: HandwritingDraftScope) {
  return `${scope.accountId}:${scope.actorId}:${scope.channelId}`;
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法打开手写草稿存储"));
  });
}

async function withStore<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  const database = await openDatabase();
  if (!database) {
    if (mode === "readwrite") throw new Error("当前浏览器不支持手写草稿存储");
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
      reject(requestError || transaction.error || new Error("手写草稿事务失败"));
    };
    transaction.onerror = fail;
    transaction.onabort = fail;
  });
}

export function createIndexedDbHandwritingDraftStorage(): HandwritingDraftStorage {
  return {
    async list() {
      return (await withStore<HandwritingDraftRecord[]>("readonly", (store) => store.getAll())) || [];
    },
    async put(record) {
      await withStore("readwrite", (store) => store.put(record));
    },
    async delete(key) {
      await withStore("readwrite", (store) => store.delete(key));
    }
  };
}

function sameOwner(record: HandwritingDraftRecord, scope: Pick<HandwritingDraftScope, "accountId" | "actorId">) {
  return record.accountId === scope.accountId && record.actorId === scope.actorId;
}

export function createHandwritingDraftRepository(storage: HandwritingDraftStorage = createIndexedDbHandwritingDraftStorage()) {
  async function records(scope: Pick<HandwritingDraftScope, "accountId" | "actorId">) {
    return (await storage.list()).filter((record) => sameOwner(record, scope));
  }

  async function record(scope: HandwritingDraftScope) {
    return (await records(scope)).find((item) => item.key === handwritingDraftKey(scope));
  }

  async function ensureChannelCapacity(scope: HandwritingDraftScope, existing?: HandwritingDraftRecord) {
    if (existing) return;
    const active = await records(scope);
    if (active.length >= HANDWRITING_DRAFT_CHANNEL_LIMIT) {
      throw new Error(`手写草稿最多保留 ${HANDWRITING_DRAFT_CHANNEL_LIMIT} 个频道，请先处理已有草稿或未确认消息`);
    }
  }

  async function saveDraft(scope: HandwritingDraftScope, payload: unknown, revision: number, now = Date.now()) {
    const normalized = normalizeHandwritingPayload(payload, HANDWRITING_DRAFT_LIMITS);
    const existing = await record(scope);
    await ensureChannelCapacity(scope, existing);
    await storage.put({
      ...(existing || scope),
      key: handwritingDraftKey(scope),
      draft: { revision, payload: normalized, updatedAt: now }
    });
  }

  async function savePending(
    scope: HandwritingDraftScope,
    pending: Omit<HandwritingPendingSend, "payload"> & { payload: unknown }
  ) {
    const normalized = normalizeHandwritingPayload(pending.payload, HANDWRITING_SEND_LIMITS);
    const existing = await record(scope);
    await ensureChannelCapacity(scope, existing);
    if (existing?.pending && existing.pending.clientRequestId !== pending.clientRequestId) {
      throw new Error("当前频道已有一条未确认的手写消息，请先确认或重试");
    }
    await storage.put({
      ...(existing || scope),
      key: handwritingDraftKey(scope),
      pending: { ...pending, payload: normalized }
    });
  }

  async function confirmPending(scope: HandwritingDraftScope, clientRequestId: string, canCommit: () => boolean = () => true) {
    const existing = await record(scope);
    if (!existing?.pending || existing.pending.clientRequestId !== clientRequestId) return false;
    if (!canCommit()) return false;
    const keepDraft = existing.draft && existing.draft.revision !== existing.pending.revision ? existing.draft : undefined;
    if (keepDraft) await storage.put({ ...existing, draft: keepDraft, pending: undefined });
    else await storage.delete(existing.key);
    return true;
  }

  async function discardPending(scope: HandwritingDraftScope, clientRequestId: string) {
    const existing = await record(scope);
    if (!existing?.pending || existing.pending.clientRequestId !== clientRequestId) return false;
    if (existing.draft) await storage.put({ ...existing, pending: undefined });
    else await storage.delete(existing.key);
    return true;
  }

  async function clearDraft(scope: HandwritingDraftScope) {
    const existing = await record(scope);
    if (!existing) return;
    if (existing.pending) await storage.put({ ...existing, draft: undefined });
    else await storage.delete(existing.key);
  }

  async function clearAccount(accountId: number) {
    const owned = (await storage.list()).filter((item) => item.accountId === accountId);
    await Promise.all(owned.map((item) => storage.delete(item.key)));
  }

  return { records, record, saveDraft, savePending, confirmPending, discardPending, clearDraft, clearAccount };
}

export type HandwritingDraftRepository = ReturnType<typeof createHandwritingDraftRepository>;
