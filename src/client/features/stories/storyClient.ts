import { api, getToken } from "../../api";
import type { StoryActivityDTO, StoryDTO, StoryFeedPageDTO, StoryInteractionsDTO, StoryPageDTO } from "@shared/stories";

export function loadStoryPage(actorId: number, before?: number | null, signal?: AbortSignal) {
  return api<StoryPageDTO>(`/api/stories?actorId=${actorId}${before ? `&before=${before}` : ""}`, { signal });
}

export function loadStoryFeed(before?: number | null, signal?: AbortSignal) {
  return api<StoryFeedPageDTO>(`/api/stories/feed${before ? `?before=${before}` : ""}`, { signal });
}

export function storyMediaUrl(id: number, thumbnail = false) {
  return `/api/stories/media/${id}?token=${encodeURIComponent(getToken())}${thumbnail ? "&thumb=1" : ""}`;
}

export async function publishStory(requestId: string, text: string, images: File[], voice: File | null, channelId?: number | null, signal?: AbortSignal) {
  const body = new FormData();
  body.append("requestId", requestId);
  body.append("text", text);
  if (channelId) body.append("channelId", String(channelId));
  for (const image of images) body.append("image", image);
  if (voice) body.append("voice", voice);
  return api<{ story: StoryDTO }>("/api/stories", { method: "POST", body, signal });
}

export function markStoryActivityRead(scope: "feed" | "interactions" | "all") {
  return api<StoryActivityDTO>("/api/stories/activity/read", { method: "PATCH", body: JSON.stringify({ scope }) });
}

export function removeStory(id: number) {
  return api<{ success: true }>(`/api/stories/${id}`, { method: "DELETE" });
}

export function saveStoryBio(bio: string) {
  return api<{ bio: string }>("/api/stories/profile", { method: "PATCH", body: JSON.stringify({ bio }) });
}

export function toggleStoryLike(id: number, liked: boolean) {
  return api<{ interactions: StoryInteractionsDTO }>(`/api/stories/${id}/like`, { method: "PUT", body: JSON.stringify({ liked }) });
}

export function addStoryComment(id: number, text: string) {
  return api<{ interactions: StoryInteractionsDTO }>(`/api/stories/${id}/comments`, { method: "POST", body: JSON.stringify({ text }) });
}

export function removeStoryComment(storyId: number, commentId: number) {
  return api<{ interactions: StoryInteractionsDTO }>(`/api/stories/${storyId}/comments/${commentId}`, { method: "DELETE" });
}

export async function prepareStoryPhoto(file: File, signal: AbortSignal): Promise<File> {
  // Browsers may give iPhone files an empty MIME type. Decode before showing
  // an <img>; never leave an unsupported original as a broken draft preview.
  const needsConversion = /\.(heic|heif|tiff?)$/i.test(file.name) || /image\/(heic|heif|tiff)/i.test(file.type);
  if (!needsConversion && await browserCanDecode(file, signal)) return file;
  const body = new FormData();
  body.append("image", file);
  const result = await api<{ base64: string; contentType: string }>("/api/stories/prepare-image", { method: "POST", body, signal });
  const bytes = Uint8Array.from(atob(result.base64), (char) => char.charCodeAt(0));
  const normalized = new File([bytes], `${file.name.replace(/\.[^.]+$/, "")}.webp`, { type: "image/webp" });
  if (!(await browserCanDecode(normalized, signal))) throw new Error("照片预览失败，请重新选择");
  return normalized;
}

function browserCanDecode(file: File, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    const cleanup = () => { clearTimeout(timer); URL.revokeObjectURL(url); image.onload = null; image.onerror = null; signal.removeEventListener("abort", abort); };
    const finish = (ok: boolean) => { cleanup(); resolve(ok); };
    const abort = () => { cleanup(); reject(signal.reason); };
    const timer = setTimeout(() => finish(false), 10_000);
    image.onload = () => finish(image.naturalWidth > 0);
    image.onerror = () => finish(false);
    signal.addEventListener("abort", abort, { once: true });
    image.src = url;
  });
}

export function storyDate(value: string) {
  const date = new Date(value);
  return { day: `${date.getMonth() + 1}月${date.getDate()}日`, year: date.getFullYear(), full: date.toLocaleString("zh-CN") };
}
