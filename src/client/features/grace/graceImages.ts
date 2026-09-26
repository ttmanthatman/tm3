import { getToken } from "../../api";

export function graceImageUrl(messageId: number, fileName: string) {
  return `/api/grace/${messageId}/images/${encodeURIComponent(fileName)}?token=${encodeURIComponent(getToken())}`;
}

export function graceEditText(html: string) {
  if (!/[<&]/.test(html)) return html;
  const element = document.createElement("div");
  element.innerHTML = html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div)>/gi, "\n");
  return (element.textContent || "").trim();
}

export function graceRequestBody(data: unknown, photos: Array<{ file: File }>): string | FormData {
  if (!photos.length) return JSON.stringify(data);
  const body = new FormData();
  body.append("data", JSON.stringify(data));
  for (const photo of photos) body.append("image", photo.file);
  return body;
}
