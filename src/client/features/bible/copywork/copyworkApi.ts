import { api } from "../../../api";

/** Every upload has a bounded wait; the caller keeps its stable retry ID and local ink. */
export async function copyworkWrite<T>(path: string, options: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("请求超时，请重试；本机草稿仍然保留")),
    20000
  );
  try {
    return await api<T>(path, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
