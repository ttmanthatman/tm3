import { onScopeDispose, ref } from "vue";
import type { BookDTO } from "@shared/types";
import { authHeaders } from "../../api";
import { bookFileUrl } from "../../books/reader";
import { fetchBlobWithProgress, saveBlob, type TransferOptions } from "../files/transfer";

type DownloadDependencies = {
  fetch: (url: string, options: TransferOptions) => Promise<Blob>;
  save: (blob: Blob, name: string) => void;
  headers: () => HeadersInit;
};

/** Save an EPUB to the device's Downloads, independently of the offline reading cache. */
export function useBookFileDownload(dependencies: DownloadDependencies = { fetch: fetchBlobWithProgress, save: saveBlob, headers: authHeaders }) {
  const busyIds = ref<ReadonlySet<number>>(new Set());
  const error = ref("");
  const requests = new Map<number, AbortController>();

  async function download(book: Pick<BookDTO, "id" | "title">) {
    if (requests.has(book.id)) return;
    const controller = new AbortController();
    requests.set(book.id, controller);
    busyIds.value = new Set(requests.keys());
    error.value = "";
    try {
      const blob = await dependencies.fetch(bookFileUrl(book.id), { headers: dependencies.headers(), signal: controller.signal });
      if (!controller.signal.aborted) {
        const title = book.title.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, "_").trim() || "图书";
        dependencies.save(blob, `${title.replace(/\.epub$/i, "")}.epub`);
      }
    } catch (cause) {
      if (!controller.signal.aborted) error.value = cause instanceof Error ? cause.message : "EPUB 下载失败，请重试";
    } finally {
      requests.delete(book.id);
      busyIds.value = new Set(requests.keys());
    }
  }

  onScopeDispose(() => { for (const controller of requests.values()) controller.abort(); });
  return { busyIds, error, download };
}
