const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
  ".ogg": "audio/ogg",
  ".aac": "audio/aac",
  ".mov": "video/quicktime",
  ".m4v": "video/mp4",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".zip": "application/zip"
};

const INLINE_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp",
  ".mp3", ".mp4", ".m4a", ".wav", ".webm", ".ogg", ".aac", ".mov", ".m4v",
  ".pdf"
]);

const ACTIVE_DOCUMENT_EXTENSIONS = new Set([".html", ".htm", ".svg", ".xml", ".xhtml", ".mhtml"]);

function extension(name: string) {
  const clean = String(name || "").split(/[?#]/, 1)[0].toLowerCase();
  const index = clean.lastIndexOf(".");
  return index >= 0 ? clean.slice(index) : "";
}

export function fileResponsePolicy(name: string, forceDownload: boolean) {
  const ext = extension(name);
  const activeDocument = ACTIVE_DOCUMENT_EXTENSIONS.has(ext);
  const inline = !forceDownload && INLINE_EXTENSIONS.has(ext);
  return {
    contentType: activeDocument ? "application/octet-stream" : CONTENT_TYPES[ext] || "application/octet-stream",
    disposition: inline ? "inline" : "attachment",
    sandbox: inline
  } as const;
}
