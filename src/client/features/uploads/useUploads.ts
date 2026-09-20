import { nextTick, ref, watch, type Ref } from "vue";
import type { MessageDTO } from "@shared/types";
import { useChatStore } from "../../store";
import {
  deletePendingUploadDraft,
  listPendingUploadDrafts,
  savePendingUploadDraft,
  type PendingUploadDraft,
  type PendingUploadDraftOptions
} from "./pendingUploadDrafts";

type UploadStatus = "uploading" | "processing" | "failed";
export type PendingUpload = {
  file: File;
  options: PendingUploadDraftOptions;
  accountId: number;
  channelId: number;
  createdAt: string;
  progress: number;
  status: UploadStatus;
  message?: string;
  localDraftReady?: boolean;
};

interface UseUploadsOptions {
  composerPanel: Ref<"voice" | "more" | null>;
  keepOriginalImages: Ref<boolean>;
  isMusicChannel: () => boolean;
  scrollBottom: (smooth?: boolean) => void;
  uploadFile: (file: File, options?: { voice?: boolean; durationMs?: number; waveform?: number[]; pendingMessageId?: number; originalImage?: boolean; channelId?: number }) => Promise<{ success: boolean; duplicate: boolean; skipped: boolean }>;
}

export function useUploads(options: UseUploadsOptions) {
  const store = useChatStore();
  const pendingUploads = ref<Record<number, PendingUpload>>({});
  const draftWrites = new Map<number, Promise<void>>();
  let nextPendingMessageId = -Date.now();
  let restoreGeneration = 0;

  function allocatePendingMessageId() {
    const id = nextPendingMessageId;
    nextPendingMessageId -= 1;
    return id;
  }

  function pendingUploadFor(message: MessageDTO) {
    return pendingUploads.value[message.id];
  }

  function pendingUploadLabel(upload: PendingUpload) {
    if (upload.status === "failed") return `${upload.message || "发送失败"} · ${upload.localDraftReady ? "已暂存在本机" : "可重试"}`;
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
    const upload = pendingUploads.value[id];
    const next = { ...pendingUploads.value };
    delete next[id];
    pendingUploads.value = next;
    if (upload) {
      void (async () => {
        await draftWrites.get(id)?.catch(() => undefined);
        draftWrites.delete(id);
        await deletePendingUploadDraft(upload.accountId, id).catch(() => undefined);
      })();
    }
  }

  function persistPendingUpload(id: number, upload: PendingUpload) {
    const write = savePendingUploadDraft({
      id,
      accountId: upload.accountId,
      channelId: upload.channelId,
      createdAt: upload.createdAt,
      file: upload.file,
      options: upload.options
    }).then(() => {
      setPendingUpload(id, { localDraftReady: true });
    }).catch(() => {
      setPendingUpload(id, { localDraftReady: false });
    });
    draftWrites.set(id, write);
    return write;
  }

  function pendingMessageFromDraft(draft: PendingUploadDraft): MessageDTO {
    const account = store.account!;
    return {
      id: draft.id,
      channelId: draft.channelId,
      sender: {
        id: account.actorId,
        kind: "human",
        username: account.username,
        displayName: account.displayName,
        avatarPath: account.avatarPath
      },
      content: "",
      type: draft.options.voice ? "file" : isImageFile(draft.file) ? "image" : "file",
      ...(draft.options.voice ? { payload: { kind: "voice", durationMs: draft.options.durationMs, waveform: draft.options.waveform } } : {}),
      fileName: draft.file.name,
      fileSize: draft.file.size,
      voiceListened: true,
      createdAt: draft.createdAt
    };
  }

  async function restorePendingUploads() {
    const accountId = store.account?.actorId;
    const channelId = store.currentChannelId;
    if (!accountId || !channelId || store.prayerOnly || store.graceOnly || store.loadingInitialMessages) return;
    const generation = ++restoreGeneration;
    const drafts = await listPendingUploadDrafts(accountId, channelId).catch(() => []);
    if (generation !== restoreGeneration || store.account?.actorId !== accountId || store.currentChannelId !== channelId || store.prayerOnly || store.graceOnly || store.loadingInitialMessages) return;
    for (const draft of drafts) {
      nextPendingMessageId = Math.min(nextPendingMessageId, draft.id - 1);
      if (!pendingUploads.value[draft.id]) {
        pendingUploads.value = {
          ...pendingUploads.value,
          [draft.id]: {
            file: draft.file,
            options: draft.options,
            accountId: draft.accountId,
            channelId: draft.channelId,
            createdAt: draft.createdAt,
            progress: 0,
            status: "failed",
            message: "上次发送未完成",
            localDraftReady: true
          }
        };
      }
      if (!store.messages.some((message) => message.id === draft.id)) store.appendLocalMessage(pendingMessageFromDraft(draft));
    }
  }

  async function pushPendingVoiceMessage(file: File, voiceOptions: { durationMs?: number; waveform?: number[] }) {
    if (!store.currentChannelId || !store.account) return 0;
    const account = store.account;
    const channelId = store.currentChannelId;
    const id = allocatePendingMessageId();
    const createdAt = new Date().toISOString();
    const upload: PendingUpload = {
      file,
      options: { voice: true, durationMs: voiceOptions.durationMs, waveform: voiceOptions.waveform },
      accountId: account.actorId,
      channelId,
      createdAt,
      progress: 0,
      status: "uploading"
    };
    pendingUploads.value = {
      ...pendingUploads.value,
      [id]: upload
    };
    store.appendLocalMessage({
      id,
      channelId,
      sender: {
        id: account.actorId,
        kind: "human",
        username: account.username,
        displayName: account.displayName,
        avatarPath: account.avatarPath
      },
      content: "",
      type: "file",
      payload: { kind: "voice", durationMs: voiceOptions.durationMs, waveform: voiceOptions.waveform },
      fileName: file.name,
      fileSize: file.size,
      voiceListened: true,
      createdAt
    });
    await persistPendingUpload(id, upload);
    void nextTick(() => options.scrollBottom(true));
    return { id, channelId };
  }

  async function pushPendingFileMessage(file: File, fileOptions: { originalImage?: boolean } = {}) {
    if (!store.currentChannelId || !store.account) return 0;
    const account = store.account;
    const channelId = store.currentChannelId;
    const id = allocatePendingMessageId();
    const type = isImageFile(file) ? "image" : "file";
    const createdAt = new Date().toISOString();
    const upload: PendingUpload = {
      file,
      options: fileOptions,
      accountId: account.actorId,
      channelId,
      createdAt,
      progress: 0,
      status: "uploading"
    };
    pendingUploads.value = {
      ...pendingUploads.value,
      [id]: upload
    };
    store.appendLocalMessage({
      id,
      channelId,
      sender: {
        id: account.actorId,
        kind: "human",
        username: account.username,
        displayName: account.displayName,
        avatarPath: account.avatarPath
      },
      content: "",
      type,
      fileName: file.name,
      fileSize: file.size,
      voiceListened: true,
      createdAt
    });
    await persistPendingUpload(id, upload);
    void nextTick(() => options.scrollBottom(true));
    return { id, channelId };
  }

  function replacePendingMessage(pendingId: number, message: MessageDTO) {
    store.replaceMessage(message, pendingId);
  }

  function shouldKeepOriginalImage(file: File) {
    return options.keepOriginalImages.value && isImageFile(file);
  }

  async function uploadPickedFile(file: File) {
    if (options.isMusicChannel() && !/\.(mp3|m4a)$/i.test(file.name)) {
      alert("音乐频道只支持上传 MP3 和 M4A 文件");
      return { success: false, duplicate: false, skipped: false };
    }
    const uploadOptions = { originalImage: shouldKeepOriginalImage(file) };
    const pending = await pushPendingFileMessage(file, uploadOptions);
    if (!pending) return { success: false, duplicate: false, skipped: true };
    return options.uploadFile(file, { ...uploadOptions, pendingMessageId: pending.id, channelId: pending.channelId });
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
    await options.uploadFile(upload.file, { ...upload.options, pendingMessageId: id, channelId: upload.channelId });
  }

  watch(
    () => [
      store.account?.actorId || 0,
      store.currentChannelId,
      store.prayerOnly,
      store.graceOnly,
      store.loadingInitialMessages
    ] as const,
    () => { void restorePendingUploads(); },
    { immediate: true }
  );

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
