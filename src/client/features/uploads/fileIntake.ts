const IMAGE_EXTENSION_PATTERN = /\.(jpe?g|png|gif|webp|heic|heif|tiff?)$/i;

export function isImageFile(file: File) {
  return file.type.startsWith("image/") || IMAGE_EXTENSION_PATTERN.test(file.name);
}

export function extensionFromImageMime(type: string) {
  if (type === "image/jpeg") return "jpg";
  if (type === "image/png") return "png";
  if (type === "image/gif") return "gif";
  if (type === "image/webp") return "webp";
  if (type === "image/heic") return "heic";
  if (type === "image/heif") return "heif";
  if (type === "image/tiff") return "tiff";
  return "png";
}

export function namedClipboardImage(file: File, index: number) {
  if (IMAGE_EXTENSION_PATTERN.test(file.name)) return file;
  const extension = extensionFromImageMime(file.type);
  return new File([file], `粘贴图片-${Date.now()}-${index + 1}.${extension}`, { type: file.type || "image/png", lastModified: file.lastModified || Date.now() });
}

function namedClipboardFile(file: File, index: number) {
  return isImageFile(file) ? namedClipboardImage(file, index) : file;
}

// 粘贴的截图没有文件名，图片要补名；从系统复制出来的文件保留原名。
export function clipboardUploadFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files: File[] = [];
  for (const item of Array.from(data.items || [])) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  if (!files.length) {
    for (const file of Array.from(data.files || [])) {
      if (file) files.push(file);
    }
  }
  return files.map(namedClipboardFile);
}

// 页面内拖文字/拖元素不带 "Files"，只有外部文件拖入才走上传。
export function dataTransferHasFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.types || []).includes("Files");
}

export function filesFromDataTransfer(dataTransfer: DataTransfer | null): File[] {
  if (!dataTransfer) return [];
  return Array.from(dataTransfer.files || []);
}
