import { nextTick, ref, type Ref } from "vue";
import type { MessageDTO } from "@shared/types";
import { useChatStore } from "../../store";

type UploadStatus = "uploading" | "processing" | "failed";
export type PendingUpload = {
  file: File;
  options: { voice?: boolean; durationMs?: number; waveform?: number[]; originalImage?: boolean };
  progress: number;
  status: UploadStatus;
  message?: string;
};

interface UseUploadsOptions {
  composerPanel: Ref<"voice" | "more" | null>;
  keepOriginalImages: Ref<boolean>;
  isMusicChannel: () => boolean;
  scrollBottom: (smooth?: boolean) => void;
  uploadFile: (file: File, options?: { voice?: boolean; durationMs?: number; waveform?: number[]; pendingMessageId?: number; originalImage?: boolean }) => Promise<{ success: boolean; duplicate: boolean; skipped: boolean }>;
}

export function useUploads(options: UseUploadsOptions) {
  const store = useChatStore();
  const pendingUploads = ref<Record<number, PendingUpload>>({});
  let nextPendingMessageId = -1;

  function pendingUploadFor(message: MessageDTO) {
    return pendingUploads.value[message.id];
  }

  function pendingUploadLabel(upload: PendingUpload) {
    if (upload.status === "failed") return upload.message || "发送失败";
    if (upload.status === "processing") return upload.message || "正在发布";
    return `上传中 ${upload.progress}%`;
  }

  function isImageFile(file: File) {
    return file.type.startsWith("image/") || /\.(jpe?g|png|gif|webp|heic|heif|tiff?)$/i.test(file.name);
  }

  function pendingUploadKindLabel(file: File) {
    if (isImageFile(file)) return "图片";
    if (file.type.startsWith("audio/")) return "音频";
    if (file.type.startsWith("video/")) return "视频";
    return "文件";
  }

  function setPendingUpload(id: number, patch: Partial<PendingUpload>) {
    const current = pendingUploads.value[id];
    if (!current) return;
    pendingUploads.value = { ...pendingUploads.value, [id]: { ...current, ...patch } };
  }

  function removePendingUpload(id: number) {
    const next = { ...pendingUploads.value };
    delete next[id];
    pendingUploads.value = next;
  }

  function pushPendingVoiceMessage(file: File, voiceOptions: { durationMs?: number; waveform?: number[] }) {
    if (!store.currentChannelId || !store.account) return 0;
    const id = nextPendingMessageId;
    nextPendingMessageId -= 1;
    pendingUploads.value = {
      ...pendingUploads.value,
      [id]: {
        file,
        options: { voice: true, durationMs: voiceOptions.durationMs, waveform: voiceOptions.waveform },
        progress: 0,
        status: "uploading"
      }
    };
    store.appendLocalMessage({
      id,
      channelId: store.currentChannelId,
      sender: {
        id: store.account.actorId,
        kind: "human",
        username: store.account.username,
        displayName: store.account.displayName,
        avatarPath: store.account.avatarPath
      },
      content: "",
      type: "file",
      payload: { kind: "voice", durationMs: voiceOptions.durationMs, waveform: voiceOptions.waveform },
      fileName: file.name,
      fileSize: file.size,
      voiceListened: true,
      createdAt: new Date().toISOString()
    });
    void nextTick(() => options.scrollBottom(true));
    return id;
  }

  function pushPendingFileMessage(file: File, fileOptions: { originalImage?: boolean } = {}) {
    if (!store.currentChannelId || !store.account) return 0;
    const id = nextPendingMessageId;
    nextPendingMessageId -= 1;
    const type = isImageFile(file) ? "image" : "file";
    pendingUploads.value = {
      ...pendingUploads.value,
      [id]: {
        file,
        options: fileOptions,
        progress: 0,
        status: "uploading"
      }
    };
    store.appendLocalMessage({
      id,
      channelId: store.currentChannelId,
      sender: {
        id: store.account.actorId,
        kind: "human",
        username: store.account.username,
        displayName: store.account.displayName,
        avatarPath: store.account.avatarPath
      },
      content: "",
      type,
      fileName: file.name,
      fileSize: file.size,
      voiceListened: true,
      createdAt: new Date().toISOString()
    });
    void nextTick(() => options.scrollBottom(true));
    return id;
  }

  function replacePendingMessage(pendingId: number, message: MessageDTO) {
    store.replaceMessage(message, pendingId);
  }

  function shouldKeepOriginalImage(file: File) {
    return options.keepOriginalImages.value && isImageFile(file);
  }

  function uploadPickedFile(file: File) {
    if (options.isMusicChannel() && !/\.(mp3|m4a)$/i.test(file.name)) {
      alert("音乐频道只支持上传 MP3 和 M4A 文件");
      return Promise.resolve({ success: false, duplicate: false, skipped: false });
    }
    const uploadOptions = { originalImage: shouldKeepOriginalImage(file) };
    const pendingMessageId = pushPendingFileMessage(file, uploadOptions);
    return options.uploadFile(file, { ...uploadOptions, pendingMessageId });
  }

  function handlePickedFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) uploadPickedFile(file);
    input.value = "";
  }

  function extensionFromImageMime(type: string) {
    if (type === "image/jpeg") return "jpg";
    if (type === "image/png") return "png";
    if (type === "image/gif") return "gif";
    if (type === "image/webp") return "webp";
    if (type === "image/heic") return "heic";
    if (type === "image/heif") return "heif";
    if (type === "image/tiff") return "tiff";
    return "png";
  }

  function namedClipboardImage(file: File, index: number) {
    if (/\.(jpe?g|png|gif|webp|heic|heif|tiff?)$/i.test(file.name)) return file;
    const extension = extensionFromImageMime(file.type);
    return new File([file], `粘贴图片-${Date.now()}-${index + 1}.${extension}`, { type: file.type || "image/png", lastModified: file.lastModified || Date.now() });
  }

  function clipboardImageFiles(event: ClipboardEvent) {
    const data = event.clipboardData;
    if (!data) return [];
    const files: File[] = [];
    for (const item of Array.from(data.items || [])) {
      if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
      const file = item.getAsFile();
      if (file) files.push(file);
    }
    if (!files.length) {
      for (const file of Array.from(data.files || [])) {
        if (isImageFile(file)) files.push(file);
      }
    }
    return files;
  }

  function handleComposerPaste(event: ClipboardEvent) {
    const files = clipboardImageFiles(event);
    if (!files.length) return;
    event.preventDefault();
    files.forEach((file, index) => uploadPickedFile(namedClipboardImage(file, index)));
  }

  function removePendingMessage(id: number) {
    store.removeMessage(id);
    removePendingUpload(id);
  }

  async function retryPendingUpload(id: number) {
    const upload = pendingUploads.value[id];
    if (!upload || upload.status !== "failed") return;
    setPendingUpload(id, { status: "uploading", progress: 0, message: "" });
    await options.uploadFile(upload.file, { ...upload.options, pendingMessageId: id });
  }

  return {
    pendingUploads,
    setPendingUpload,
    removePendingUpload,
    replacePendingMessage,
    pendingUploadFor,
    pendingUploadLabel,
    pendingUploadKindLabel,
    pushPendingVoiceMessage,
    isImageFile,
    uploadPickedFile,
    handlePickedFile,
    handleComposerPaste,
    removePendingMessage,
    retryPendingUpload
  };
}
