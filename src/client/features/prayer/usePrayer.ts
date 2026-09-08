import { computed, nextTick, ref } from "vue";
import type { MessageDTO, PrayerPayload, PrayerStatus } from "@shared/types";
import { api, getToken } from "../../api";
import { useChatStore } from "../../store";
import { adminDate } from "../admin/adminFormat";
import { escapeHtmlText } from "../messages/messageRendering";

interface UsePrayerOptions {
  isMine: (message: MessageDTO) => boolean;
  openAttachmentFromTap: (message: MessageDTO, event?: MouseEvent) => void;
  scrollBottom: (smooth?: boolean) => void;
  positionPromptNearEvent: (event: MouseEvent | PointerEvent | undefined, size: { width: number; height: number }) => { x: number; y: number };
  closeCompetingPrompts: () => void;
}

export function usePrayer(options: UsePrayerOptions) {
  const store = useChatStore();
  const pendingPrayer = ref<MessageDTO | null>(null);
  const pendingPrayerUpdate = ref<MessageDTO | null>(null);
  const prayerUpdateTextarea = ref<HTMLTextAreaElement | null>(null);
  const prayerUpdateContent = ref("");
  const prayerUpdateBusy = ref(false);
  const prayerUpdateError = ref("");
  const prayerUpdatePhotoInput = ref<HTMLInputElement | null>(null);
  const prayerUpdatePhoto = ref<File | null>(null);
  const prayerUpdatePhotoPreview = ref("");
  const prayerComposerPhoto = ref<File | null>(null);
  const prayerComposerPhotoPreview = ref("");
  const expandedAiSuggestionMessageIds = ref<Set<number>>(new Set());
  const aiSuggestionBusyIds = ref<Set<number>>(new Set());
  const aiSuggestionErrors = ref<Record<number, string>>({});
  const prayerPromptPosition = ref({ x: 0, y: 0 });

  const prayerPromptStyle = computed(() => ({
    left: `${prayerPromptPosition.value.x}px`,
    top: `${prayerPromptPosition.value.y}px`
  }));

  function requestPrayerPrayed(message: MessageDTO, event?: MouseEvent) {
    if (prayerPayload(message).status !== "active") return;
    prayerPromptPosition.value = options.positionPromptNearEvent(event, { width: 238, height: 104 });
    pendingPrayer.value = message;
    options.closeCompetingPrompts();
  }

  function clearPrayerComposerPhoto() {
    if (prayerComposerPhotoPreview.value) URL.revokeObjectURL(prayerComposerPhotoPreview.value);
    prayerComposerPhoto.value = null;
    prayerComposerPhotoPreview.value = "";
  }

  function prayerPayload(message: MessageDTO): PrayerPayload {
    const raw = (message.payload || {}) as Partial<PrayerPayload>;
    const status = raw.status === "closed" || raw.status === "answered" ? raw.status : "active";
    return {
      kind: "prayer",
      status,
      statusAt: raw.statusAt,
      statusBy: raw.statusBy,
      effect: raw.effect,
      imageMessageId: Number(raw.imageMessageId || 0) > 0 ? Number(raw.imageMessageId) : null,
      updates: Array.isArray(raw.updates) ? raw.updates : [],
      prayerCount: Number(raw.prayerCount || 0),
      prayerActionCount: Number(raw.prayerActionCount || 0),
      currentUserPrayed: !!raw.currentUserPrayed,
      prayedBy: Array.isArray(raw.prayedBy) ? raw.prayedBy : [],
      aiSuggestions: Array.isArray(raw.aiSuggestions) ? raw.aiSuggestions : [],
      aiSuggestionSuccessCount: Number(raw.aiSuggestionSuccessCount || 0),
      aiSuggestionMaxSuccess: Number(raw.aiSuggestionMaxSuccess || 7)
    };
  }

  function prayerStatusText(status: PrayerStatus) {
    if (status === "answered") return "已蒙应允";
    if (status === "closed") return "无需再代祷";
    return "正在代祷";
  }

  function prayerActionText(message: MessageDTO) {
    const payload = prayerPayload(message);
    if (!payload.prayerCount) return "还没有人记录祷告";
    const names = payload.prayedBy
      .slice(0, 3)
      .map((item) => item.displayName)
      .join("、");
    return `${names}${payload.prayerCount > 3 ? ` 等 ${payload.prayerCount} 人` : ""} 已为此祷告`;
  }

  function prayerLatestTime(message: MessageDTO) {
    const latest = prayerPayload(message).prayedBy[0]?.latestPrayedAt;
    return latest ? adminDate(latest) : "";
  }

  function prayerImageUrl(imageMessageId: number) {
    return `/api/files/${imageMessageId}?token=${encodeURIComponent(getToken())}`;
  }

  function openPrayerImage(message: MessageDTO, imageMessageId: number, event?: MouseEvent) {
    if (event) event.stopPropagation();
    options.openAttachmentFromTap({ id: imageMessageId, channelId: message.channelId, type: "image" } as MessageDTO, event);
  }

  function prayerAiSuggestions(message: MessageDTO) {
    return prayerPayload(message).aiSuggestions || [];
  }

  function prayerAiSuggestionCount(message: MessageDTO) {
    return prayerPayload(message).aiSuggestionSuccessCount || 0;
  }

  function prayerAiSuggestionMax(message: MessageDTO) {
    return prayerPayload(message).aiSuggestionMaxSuccess || 7;
  }

  function prayerAiLimitReached(message: MessageDTO) {
    return prayerAiSuggestionCount(message) >= prayerAiSuggestionMax(message);
  }

  function isPrayerAiExpanded(message: MessageDTO) {
    return expandedAiSuggestionMessageIds.value.has(message.id);
  }

  function isPrayerAiBusy(message: MessageDTO) {
    return aiSuggestionBusyIds.value.has(message.id);
  }

  function setPrayerAiExpanded(message: MessageDTO, expanded: boolean) {
    const next = new Set(expandedAiSuggestionMessageIds.value);
    if (expanded) next.add(message.id);
    else next.delete(message.id);
    expandedAiSuggestionMessageIds.value = next;
  }

  function setPrayerAiBusy(message: MessageDTO, busy: boolean) {
    const next = new Set(aiSuggestionBusyIds.value);
    if (busy) next.add(message.id);
    else next.delete(message.id);
    aiSuggestionBusyIds.value = next;
  }

  function setPrayerAiError(message: MessageDTO, text = "") {
    aiSuggestionErrors.value = { ...aiSuggestionErrors.value, [message.id]: text };
  }

  async function togglePrayerAiSuggestions(message: MessageDTO) {
    const hasSuggestions = prayerAiSuggestions(message).length > 0;
    if (!hasSuggestions && !isPrayerAiBusy(message)) {
      setPrayerAiExpanded(message, true);
      await generatePrayerAiSuggestions(message);
      return;
    }
    setPrayerAiExpanded(message, !isPrayerAiExpanded(message));
  }

  async function generatePrayerAiSuggestions(message: MessageDTO) {
    if (isPrayerAiBusy(message) || prayerAiLimitReached(message)) return;
    setPrayerAiExpanded(message, true);
    setPrayerAiBusy(message, true);
    setPrayerAiError(message);
    try {
      const result = await api<{ success: boolean; message: MessageDTO }>(`/api/messages/${message.id}/ai-suggestions/related-verses`, {
        method: "POST",
        body: JSON.stringify({})
      });
      store.replaceMessage(result.message);
    } catch (error) {
      setPrayerAiError(message, error instanceof Error ? error.message : "生成失败，可以稍后重试。");
    } finally {
      setPrayerAiBusy(message, false);
    }
  }

  async function markPrayerPrayed(message: MessageDTO) {
    await api(`/api/messages/${message.id}/prayed`, { method: "POST", body: JSON.stringify({}) });
    pendingPrayer.value = null;
    await store.loadMessages();
  }

  async function updatePrayerStatus(message: MessageDTO, status: "closed" | "answered") {
    await api(`/api/messages/${message.id}/prayer-status`, { method: "PATCH", body: JSON.stringify({ status }) });
    await store.loadMessages();
  }

  function canPublishPrayerUpdate(message: MessageDTO) {
    return message.type === "prayer" && (options.isMine(message) || !!store.account?.isAdmin);
  }

  function buildPrayerUpdateHtml() {
    return escapeHtmlText(prayerUpdateContent.value.trim());
  }

  const prayerUpdateCanPublish = computed(() => {
    return !!prayerUpdateContent.value.trim();
  });

  function clearPrayerUpdatePhoto() {
    if (prayerUpdatePhotoPreview.value) URL.revokeObjectURL(prayerUpdatePhotoPreview.value);
    prayerUpdatePhoto.value = null;
    prayerUpdatePhotoPreview.value = "";
    if (prayerUpdatePhotoInput.value) prayerUpdatePhotoInput.value.value = "";
  }

  function openPrayerUpdateEditor(message: MessageDTO) {
    pendingPrayerUpdate.value = message;
    prayerUpdateContent.value = "";
    prayerUpdateError.value = "";
    prayerUpdateBusy.value = false;
    clearPrayerUpdatePhoto();
  }

  function closePrayerUpdateEditor() {
    if (prayerUpdateBusy.value) return;
    pendingPrayerUpdate.value = null;
    prayerUpdateContent.value = "";
    prayerUpdateError.value = "";
    clearPrayerUpdatePhoto();
  }

  function handlePrayerUpdatePhotoPick(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    clearPrayerUpdatePhoto();
    prayerUpdatePhoto.value = file;
    prayerUpdatePhotoPreview.value = URL.createObjectURL(file);
    prayerUpdateError.value = "";
  }

  async function uploadPrayerImage(file: File, channelId: number) {
    const form = new FormData();
    form.append("channelId", String(channelId));
    form.append("file", file, file.name);
    const result = await api<{ success: boolean; message?: MessageDTO }>("/api/files/upload", { method: "POST", body: form });
    if (!result.message?.id) throw new Error("照片上传失败");
    return result.message.id;
  }

  async function publishPrayerUpdate() {
    const message = pendingPrayerUpdate.value;
    const content = buildPrayerUpdateHtml();
    if (!message || !prayerUpdateCanPublish.value || prayerUpdateBusy.value) return;
    prayerUpdateBusy.value = true;
    prayerUpdateError.value = "";
    try {
      const imageMessageId = prayerUpdatePhoto.value ? await uploadPrayerImage(prayerUpdatePhoto.value, message.channelId) : null;
      const result = await api<{ success: boolean; message: MessageDTO }>(`/api/messages/${message.id}/prayer-update`, {
        method: "POST",
        body: JSON.stringify({ content, imageMessageId })
      });
      if (result.message) store.appendLocalMessage(result.message);
      pendingPrayerUpdate.value = null;
      prayerUpdateContent.value = "";
      clearPrayerUpdatePhoto();
      await nextTick();
      options.scrollBottom(true);
    } catch (error) {
      prayerUpdateError.value = error instanceof Error ? error.message : "更新最新动态失败";
    } finally {
      prayerUpdateBusy.value = false;
    }
  }

  async function withdrawPrayer(message: MessageDTO) {
    if (!confirm("撤回这条代祷事项？")) return;
    await api(`/api/messages/${message.id}/prayer`, { method: "DELETE" });
    await store.loadMessages();
  }

  return {
    pendingPrayer,
    pendingPrayerUpdate,
    prayerUpdateTextarea,
    prayerUpdateContent,
    prayerUpdateBusy,
    prayerUpdateError,
    prayerUpdatePhotoInput,
    prayerUpdatePhoto,
    prayerUpdatePhotoPreview,
    prayerComposerPhoto,
    prayerComposerPhotoPreview,
    expandedAiSuggestionMessageIds,
    aiSuggestionBusyIds,
    aiSuggestionErrors,
    prayerPromptPosition,
    prayerPromptStyle,
    requestPrayerPrayed,
    clearPrayerComposerPhoto,
    prayerPayload,
    prayerStatusText,
    prayerActionText,
    prayerLatestTime,
    prayerImageUrl,
    openPrayerImage,
    prayerAiSuggestions,
    prayerAiSuggestionCount,
    prayerAiSuggestionMax,
    prayerAiLimitReached,
    isPrayerAiExpanded,
    isPrayerAiBusy,
    setPrayerAiExpanded,
    setPrayerAiBusy,
    setPrayerAiError,
    togglePrayerAiSuggestions,
    generatePrayerAiSuggestions,
    markPrayerPrayed,
    updatePrayerStatus,
    canPublishPrayerUpdate,
    buildPrayerUpdateHtml,
    prayerUpdateCanPublish,
    clearPrayerUpdatePhoto,
    openPrayerUpdateEditor,
    closePrayerUpdateEditor,
    handlePrayerUpdatePhotoPick,
    uploadPrayerImage,
    publishPrayerUpdate,
    withdrawPrayer
  };
}
