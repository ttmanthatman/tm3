import type { LinkPreviewDTO } from "@shared/types";

export type LinkPreviewState = {
  status: "loading" | "ready" | "error";
  preview?: LinkPreviewDTO;
  error?: string;
  attempts?: number;
  failedAt?: number;
};

// 预取并发保持 3：预览请求不能挤占消息与频道流量。
export const LINK_PREVIEW_CONCURRENCY = 3;
export const LINK_PREVIEW_CACHE_LIMIT = 120;
// 失败退避：第 2 次至少隔 5s，第 3 次至少隔 30s，之后本会话内不再重试。
export const LINK_PREVIEW_RETRY_DELAYS_MS = [5_000, 30_000] as const;

export interface LinkPreviewQueueOptions {
  fetchPreview: (url: string, signal: AbortSignal) => Promise<LinkPreviewDTO>;
  onPreviewReady?: () => void;
  now?: () => number;
  cacheLimit?: number;
  retryDelaysMs?: readonly number[];
}

// 链接预览预取队列：只装当前可见（虚拟窗口内）的 URL；切频道/换账号时 reset
// 丢弃排队项并中止进行中请求，主动取消不写入失败缓存。失败按退避重试，
// 缓存按插入序淘汰最旧的非进行中条目，保证有界。
export function createLinkPreviewQueue(options: LinkPreviewQueueOptions) {
  const cache = new Map<string, LinkPreviewState>();
  const queue: string[] = [];
  const queued = new Set<string>();
  const controllers = new Map<string, AbortController>();
  let active = 0;
  let changeListener: (() => void) | null = null;

  const now = options.now || (() => Date.now());
  const cacheLimit = options.cacheLimit ?? LINK_PREVIEW_CACHE_LIMIT;
  const retryDelays = options.retryDelaysMs ?? LINK_PREVIEW_RETRY_DELAYS_MS;

  function notify() {
    changeListener?.();
  }

  function setState(url: string, state: LinkPreviewState) {
    cache.delete(url);
    cache.set(url, state);
    while (cache.size > cacheLimit) {
      const oldest = [...cache.entries()].find(([, entry]) => entry.status !== "loading");
      if (!oldest) break;
      cache.delete(oldest[0]);
    }
    notify();
  }

  function removeState(url: string) {
    if (cache.delete(url)) notify();
  }

  function retryDue(state: LinkPreviewState): boolean {
    if (state.status !== "error") return false;
    const attempts = state.attempts || 1;
    return attempts <= retryDelays.length && now() - (state.failedAt || 0) >= retryDelays[attempts - 1];
  }

  function pump() {
    while (active < LINK_PREVIEW_CONCURRENCY && queue.length) {
      const url = queue.shift() as string;
      active += 1;
      void run(url).finally(() => {
        queued.delete(url);
        active -= 1;
        pump();
      });
    }
  }

  async function run(url: string) {
    const existing = cache.get(url);
    if (existing && existing.status !== "error") return;
    const controller = new AbortController();
    controllers.set(url, controller);
    setState(url, { status: "loading" });
    try {
      const preview = await options.fetchPreview(url, controller.signal);
      if (!preview.title && !preview.image && !preview.description) throw new Error("empty preview");
      setState(url, { status: "ready", preview });
      options.onPreviewReady?.();
    } catch (error) {
      if (controller.signal.aborted) {
        if (cache.get(url)?.status === "loading") removeState(url);
        return;
      }
      setState(url, {
        status: "error",
        error: error instanceof Error ? error.message : "preview failed",
        attempts: (existing?.attempts || 0) + 1,
        failedAt: now()
      });
    } finally {
      if (controllers.get(url) === controller) controllers.delete(url);
    }
  }

  return {
    onStateChange(listener: () => void) {
      changeListener = listener;
    },
    state(): Record<string, LinkPreviewState> {
      return Object.fromEntries(cache);
    },
    previewFor(url: string): LinkPreviewDTO | null {
      const state = cache.get(url);
      if (state?.status !== "ready") return null;
      // 读取刷新淘汰顺序，热点 URL 不被挤出。
      cache.delete(url);
      cache.set(url, state);
      return state.preview || null;
    },
    ensureVisible(urls: string[]) {
      const wanted = new Set(urls);
      for (let index = queue.length - 1; index >= 0; index -= 1) {
        if (wanted.has(queue[index])) continue;
        queued.delete(queue[index]);
        queue.splice(index, 1);
      }
      for (const url of wanted) {
        const cached = cache.get(url);
        if (cached && !retryDue(cached)) continue;
        if (queued.has(url)) continue;
        queued.add(url);
        queue.push(url);
      }
      pump();
    },
    reset({ clearCache = false } = {}) {
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
      queue.length = 0;
      queued.clear();
      if (clearCache) cache.clear();
      else {
        for (const [url, state] of cache) {
          if (state.status === "loading") cache.delete(url);
        }
      }
      notify();
    }
  };
}
