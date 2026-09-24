export type TransferProgress = {
  loaded: number;
  total: number | null;
  percent: number | null;
};

export type TransferOptions = {
  headers?: HeadersInit;
  signal?: AbortSignal;
  onProgress?: (progress: TransferProgress) => void;
};

export function transferProgress(loaded: number, total: number | null): TransferProgress {
  const safeLoaded = Math.max(0, loaded);
  const safeTotal = total && Number.isFinite(total) && total > 0 ? total : null;
  return {
    loaded: safeLoaded,
    total: safeTotal,
    percent: safeTotal ? Math.min(100, Math.floor((safeLoaded / safeTotal) * 100)) : null
  };
}

export function fetchBlobWithProgress(url: string, options: TransferOptions = {}): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new DOMException("下载已取消", "AbortError"));
      return;
    }

    const request = new XMLHttpRequest();
    let settled = false;

    const cleanup = () => options.signal?.removeEventListener("abort", abort);
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const abort = () => {
      request.abort();
      finish(() => reject(new DOMException("下载已取消", "AbortError")));
    };

    options.signal?.addEventListener("abort", abort, { once: true });
    request.open("GET", url);
    request.responseType = "blob";
    new Headers(options.headers || {}).forEach((value, name) => request.setRequestHeader(name, value));
    request.onprogress = (event) => {
      options.onProgress?.(transferProgress(event.loaded, event.lengthComputable ? event.total : null));
    };
    request.onload = () => {
      if (request.status < 200 || request.status >= 300) {
        finish(() => reject(new Error(`HTTP ${request.status}`)));
        return;
      }
      if (!request.response) {
        finish(() => reject(new Error("文件内容为空")));
        return;
      }
      options.onProgress?.(transferProgress(request.response.size, request.response.size));
      finish(() => resolve(request.response));
    };
    request.onerror = () => finish(() => reject(new Error("网络连接失败")));
    request.onabort = () => finish(() => reject(new DOMException("下载已取消", "AbortError")));
    request.send();
  });
}

export function saveBlob(blob: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName || "附件";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
}
