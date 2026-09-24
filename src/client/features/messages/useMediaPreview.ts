import { computed, onBeforeUnmount, ref, type Ref } from "vue";
import type { MessageDTO } from "@shared/types";
import { authHeaders } from "../../api";
import { fetchBlobWithProgress, saveBlob, type TransferProgress } from "../files/transfer";
import { useChatStore } from "../../store";

type PinnedMediaBlock = { type: "image" | "file"; fileName: string; filePath: string; fileSize?: number | null };
type PinnedImagePreview = { url: string; fileName: string; score?: boolean; trackId?: number; pageId?: number };

interface UseMediaPreviewOptions {
  isTapSuppressed: () => boolean;
  messageSelectionMode: Ref<boolean>;
  toggleMessageSelected: (message: MessageDTO) => void;
  fileUrl: (message: MessageDTO) => string;
  pinnedFileUrl: (block: PinnedMediaBlock) => string;
  positionPromptNearEvent: (event: MouseEvent | PointerEvent | undefined, size: { width: number; height: number }) => { x: number; y: number };
  closeCompetingPrompts: () => void;
}

export function useMediaPreview(options: UseMediaPreviewOptions) {
  const store = useChatStore();
  const previewMessage = ref<MessageDTO | null>(null);
  const previewPinnedImage = ref<PinnedImagePreview | null>(null);
  const imagePreviewScale = ref(1);
  const imagePreviewOffset = ref({ x: 0, y: 0 });
  const downloadPromptPosition = ref({ x: 0, y: 0 });
  const pendingDownload = ref<MessageDTO | null>(null);
  const mediaTransfer = ref<(TransferProgress & { kind: "preview" | "download"; label: string }) | null>(null);
  const previewMediaUrl = ref("");
  const previewError = ref("");
  let previewAbort: AbortController | null = null;
  let downloadAbort: AbortController | null = null;
  let previewOwnedUrl = false;
  let imagePanStart = { x: 0, y: 0, offsetX: 0, offsetY: 0 };
  let imagePinchStart: { distance: number; scale: number } | null = null;

  const downloadPromptStyle = computed(() => ({
    left: `${downloadPromptPosition.value.x}px`,
    top: `${downloadPromptPosition.value.y}px`
  }));

  function openAttachmentFromTap(message: MessageDTO, event?: MouseEvent) {
    if (options.isTapSuppressed()) return;
    if (event) event.stopPropagation();
    if (options.messageSelectionMode.value && message.id > 0) {
      options.toggleMessageSelected(message);
      return;
    }
    if (canPreviewMessage(message)) {
      openPreviewMessage(message);
      return;
    }
    requestDownload(message, event);
  }

  function openPreviewMessage(message: MessageDTO) {
    previewMessage.value = message;
    previewPinnedImage.value = null;
    pendingDownload.value = null;
    resetImagePreviewTransform();
    void loadPreviewMedia(options.fileUrl(message));
  }

  function openPinnedImage(block: PinnedMediaBlock) {
    previewPinnedImage.value = { url: options.pinnedFileUrl(block), fileName: block.fileName };
    previewMessage.value = {
      id: -1,
      channelId: store.currentChannelId,
      sender: { id: 0, kind: "system", username: "pinned", displayName: "置顶" },
      content: "",
      type: "image",
      fileName: block.fileName,
      fileSize: block.fileSize,
      createdAt: new Date().toISOString()
    };
    pendingDownload.value = null;
    resetImagePreviewTransform();
    void loadPreviewMedia(previewPinnedImage.value.url);
  }

  function resetImagePreviewTransform() {
    imagePreviewScale.value = 1;
    imagePreviewOffset.value = { x: 0, y: 0 };
    imagePinchStart = null;
  }

  function releasePreviewMedia() {
    if (previewOwnedUrl && previewMediaUrl.value) URL.revokeObjectURL(previewMediaUrl.value);
    previewMediaUrl.value = "";
    previewOwnedUrl = false;
  }

  function closePreviewMessage() {
    previewAbort?.abort();
    previewAbort = null;
    releasePreviewMedia();
    previewError.value = "";
    if (mediaTransfer.value?.kind === "preview") mediaTransfer.value = null;
    previewMessage.value = null;
    previewPinnedImage.value = null;
    resetImagePreviewTransform();
  }

  async function loadPreviewMedia(sourceUrl: string) {
    previewAbort?.abort();
    previewAbort = null;
    releasePreviewMedia();
    previewError.value = "";
    if (!sourceUrl) return;
    if (sourceUrl.startsWith("blob:") || sourceUrl.startsWith("data:")) {
      previewMediaUrl.value = sourceUrl;
      return;
    }

    const controller = new AbortController();
    previewAbort = controller;
    mediaTransfer.value = { kind: "preview", label: "正在下载预览", loaded: 0, total: null, percent: null };
    try {
      const blob = await fetchBlobWithProgress(sourceUrl, {
        headers: authHeaders(),
        signal: controller.signal,
        onProgress: (progress) => {
          if (previewAbort !== controller) return;
          mediaTransfer.value = { ...progress, kind: "preview", label: "正在下载预览" };
        }
      });
      if (previewAbort !== controller) return;
      previewMediaUrl.value = URL.createObjectURL(blob);
      previewOwnedUrl = true;
    } catch (error) {
      if (controller.signal.aborted) return;
      previewError.value = error instanceof Error ? error.message : "预览下载失败";
    } finally {
      if (previewAbort === controller) {
        previewAbort = null;
        mediaTransfer.value = null;
      }
    }
  }

  function previewImageSrc() {
    return previewMediaUrl.value;
  }

  function previewMediaSrc() {
    return previewMediaUrl.value;
  }

  async function downloadFromUrl(url: string, fileName: string) {
    downloadAbort?.abort();
    const controller = new AbortController();
    downloadAbort = controller;
    mediaTransfer.value = { kind: "download", label: `正在下载 ${fileName}`, loaded: 0, total: null, percent: null };
    try {
      const blob = await fetchBlobWithProgress(url, {
        headers: authHeaders(),
        signal: controller.signal,
        onProgress: (progress) => {
          if (downloadAbort !== controller) return;
          mediaTransfer.value = { ...progress, kind: "download", label: `正在下载 ${fileName}` };
        }
      });
      if (downloadAbort !== controller) return;
      saveBlob(blob, fileName || "附件");
    } finally {
      if (downloadAbort === controller) {
        downloadAbort = null;
        mediaTransfer.value = null;
      }
    }
  }

  function downloadPreviewImage() {
    if (previewPinnedImage.value) {
      void downloadFromUrl(previewPinnedImage.value.url, previewPinnedImage.value.fileName || "图片").catch((error) => {
        if ((error as Error).name !== "AbortError") alert(error instanceof Error ? error.message : "下载失败");
      });
      return;
    }
    if (previewMessage.value) void downloadFile(previewMessage.value);
  }

  function clampImageScale(value: number) {
    return Math.min(5, Math.max(1, value));
  }

  function imagePreviewTransform() {
    return {
      transform: `translate3d(${imagePreviewOffset.value.x}px, ${imagePreviewOffset.value.y}px, 0) scale(${imagePreviewScale.value})`
    };
  }

  function touchDistance(touches: TouchList) {
    const first = touches[0];
    const second = touches[1];
    return Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
  }

  function onImagePreviewTouchStart(event: TouchEvent) {
    if (event.touches.length === 2) {
      imagePinchStart = { distance: touchDistance(event.touches), scale: imagePreviewScale.value };
      return;
    }
    if (event.touches.length === 1) {
      imagePanStart = {
        x: event.touches[0].clientX,
        y: event.touches[0].clientY,
        offsetX: imagePreviewOffset.value.x,
        offsetY: imagePreviewOffset.value.y
      };
    }
  }

  function onImagePreviewTouchMove(event: TouchEvent) {
    if (event.touches.length === 2 && imagePinchStart) {
      event.preventDefault();
      imagePreviewScale.value = clampImageScale(imagePinchStart.scale * (touchDistance(event.touches) / Math.max(1, imagePinchStart.distance)));
      return;
    }
    if (event.touches.length === 1 && imagePreviewScale.value > 1) {
      event.preventDefault();
      imagePreviewOffset.value = {
        x: imagePanStart.offsetX + event.touches[0].clientX - imagePanStart.x,
        y: imagePanStart.offsetY + event.touches[0].clientY - imagePanStart.y
      };
    }
  }

  function endImagePreviewTouch() {
    imagePinchStart = null;
  }

  function onImagePreviewPointerDown(event: PointerEvent) {
    if (event.pointerType === "touch" || imagePreviewScale.value <= 1) return;
    imagePanStart = {
      x: event.clientX,
      y: event.clientY,
      offsetX: imagePreviewOffset.value.x,
      offsetY: imagePreviewOffset.value.y
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onImagePreviewPointerMove(event: PointerEvent) {
    if (event.pointerType === "touch" || imagePreviewScale.value <= 1 || !(event.buttons & 1)) return;
    imagePreviewOffset.value = {
      x: imagePanStart.offsetX + event.clientX - imagePanStart.x,
      y: imagePanStart.offsetY + event.clientY - imagePanStart.y
    };
  }

  function onImagePreviewWheel(event: WheelEvent) {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    imagePreviewScale.value = clampImageScale(imagePreviewScale.value + (event.deltaY < 0 ? 0.18 : -0.18));
    if (imagePreviewScale.value === 1) imagePreviewOffset.value = { x: 0, y: 0 };
  }

  function requestDownload(message: MessageDTO, event?: MouseEvent) {
    downloadPromptPosition.value = options.positionPromptNearEvent(event, { width: 184, height: 82 });
    pendingDownload.value = message;
    options.closeCompetingPrompts();
  }

  function fileDownloadUrl(message: MessageDTO) {
    return `${options.fileUrl(message)}&download=1`;
  }

  async function downloadFile(message: MessageDTO) {
    try {
      await downloadFromUrl(fileDownloadUrl(message), message.fileName || "附件");
    } catch (error) {
      if ((error as Error).name !== "AbortError") alert(error instanceof Error ? error.message : "下载失败");
    } finally {
      pendingDownload.value = null;
    }
  }

  function cancelMediaTransfer() {
    previewAbort?.abort();
    previewAbort = null;
    downloadAbort?.abort();
    downloadAbort = null;
    mediaTransfer.value = null;
  }

  function fileExtension(message: MessageDTO) {
    return (message.fileName || "").split(".").pop()?.toLowerCase() || "";
  }

  function isPdfMessage(message: MessageDTO) {
    return message.type === "file" && fileExtension(message) === "pdf";
  }

  function isVideoMessage(message: MessageDTO) {
    return message.type === "file" && /\.(mp4|m4v|mov)$/i.test(message.fileName || "");
  }

  function canPreviewMessage(message: MessageDTO) {
    return message.type === "image" || isVideoMessage(message) || isPdfMessage(message);
  }

  function isDocumentMessage(message: MessageDTO) {
    return message.type === "file" && /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|pages|numbers|key|txt|csv)$/i.test(message.fileName || "");
  }

  function documentIconSrc(message: MessageDTO) {
    const ext = fileExtension(message);
    if (ext === "pdf") return "/images/file-icons/pdf.png";
    if (["doc", "docx", "pages"].includes(ext)) return "/images/file-icons/word.png";
    if (["xls", "xlsx", "numbers", "csv"].includes(ext)) return "/images/file-icons/excel.png";
    if (["ppt", "pptx", "key"].includes(ext)) return "/images/file-icons/powerpoint.png";
    if (["txt", "md", "rtf"].includes(ext)) return "/images/file-icons/text.png";
    return "/images/file-icons/document.png";
  }

  function documentKindLabel(message: MessageDTO) {
    const ext = fileExtension(message);
    if (ext === "pdf") return "PDF";
    if (["doc", "docx", "pages"].includes(ext)) return "Word 文档";
    if (["xls", "xlsx", "numbers", "csv"].includes(ext)) return "Excel 表格";
    if (["ppt", "pptx", "key"].includes(ext)) return "演示文稿";
    if (["txt", "md", "rtf"].includes(ext)) return "文本文件";
    if (["zip", "rar", "7z"].includes(ext)) return "压缩包";
    return "文件";
  }

  onBeforeUnmount(cancelMediaTransfer);

  return {
    previewMessage,
    mediaTransfer,
    previewError,
    previewPinnedImage,
    imagePreviewScale,
    imagePreviewOffset,
    downloadPromptPosition,
    downloadPromptStyle,
    pendingDownload,
    openAttachmentFromTap,
    openPreviewMessage,
    openPinnedImage,
    resetImagePreviewTransform,
    closePreviewMessage,
    loadPreviewMedia,
    previewImageSrc,
    previewMediaSrc,
    downloadPreviewImage,
    clampImageScale,
    imagePreviewTransform,
    touchDistance,
    onImagePreviewTouchStart,
    onImagePreviewTouchMove,
    endImagePreviewTouch,
    onImagePreviewPointerDown,
    onImagePreviewPointerMove,
    onImagePreviewWheel,
    requestDownload,
    fileDownloadUrl,
    downloadFile,
    cancelMediaTransfer,
    fileExtension,
    isPdfMessage,
    isVideoMessage,
    canPreviewMessage,
    isDocumentMessage,
    documentIconSrc,
    documentKindLabel
  };
}

export type { PinnedMediaBlock, PinnedImagePreview };
