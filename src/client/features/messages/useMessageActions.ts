import { nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";
import type { ChannelDTO, FavoriteMessageDTO, MessageDTO, MessageEffect, MessageReactionsDTO } from "@shared/types";
import { api } from "../../api";
import { useChatStore } from "../../store";
import { canOpenChannelSettings } from "../../channelManagement";

interface UseMessageActionsOptions {
  scroller: Ref<HTMLElement | null>;
  showFavorites: Ref<boolean>;
  oopsActiveMessageIds: Ref<Set<number>>;
  messageEffect: (message: MessageDTO) => MessageEffect | null;
  requestDeviceOrientationPermissionOnce: () => void;
  stirWaterMessage: (message: MessageDTO, event: PointerEvent) => void;
  settleWaterMessage: (message: MessageDTO, event: PointerEvent) => void;
  suppressNextTap: () => void;
  openFavoriteMessage: (favorite: FavoriteMessageDTO) => Promise<void>;
  openFavorites: () => Promise<void>;
  openEditChannelEditor: (channel: ChannelDTO) => void;
  pickReply: (message: MessageDTO) => void;
  closeCompetingPrompts: () => void;
}

export function useMessageActions(options: UseMessageActionsOptions) {
  const store = useChatStore();
  const longPressMs = 520;
  let longPressTimer: number | undefined;
  let longPressStartedAt = { x: 0, y: 0 };
  let favoriteLongPressTimer: number | undefined;
  let favoriteLongPressStartedAt = { x: 0, y: 0 };
  let channelLongPressTimer: number | undefined;
  let channelLongPressStartedAt = { x: 0, y: 0 };
  const pendingMessageActions = ref<MessageDTO | null>(null);
  const messageActionPopoverElement = ref<HTMLElement | null>(null);
  const messageActionPromptStyle = ref<Record<string, string>>({ visibility: "hidden" });
  let menuAnchor = { x: 0, y: 0 };
  let positionFrame: number | undefined;
  let resizeObserver: ResizeObserver | undefined;
  const textSelectableMessageId = ref<number | null>(null);

  async function updateMenuPosition() {
    const element = messageActionPopoverElement.value;
    if (!element) return;
    const viewport = window.visualViewport;
    const rootStyle = getComputedStyle(document.documentElement);
    const safeTop = parseFloat(rootStyle.getPropertyValue("--safe-top")) || 0;
    const safeBottom = parseFloat(rootStyle.getPropertyValue("--safe-bottom")) || 0;
    const left = (viewport?.offsetLeft || 0) + 12;
    const top = (viewport?.offsetTop || 0) + safeTop + 12;
    const right = (viewport?.offsetLeft || 0) + (viewport?.width || window.innerWidth) - 12;
    const bottom = (viewport?.offsetTop || 0) + (viewport?.height || window.innerHeight) - safeBottom - 12;
    messageActionPromptStyle.value = {
      ...messageActionPromptStyle.value,
      maxWidth: `${Math.max(0, right - left)}px`,
      maxHeight: `${Math.max(0, bottom - top)}px`
    };
    await nextTick();
    if (element !== messageActionPopoverElement.value) return;
    const rect = element.getBoundingClientRect();
    messageActionPromptStyle.value = {
      ...messageActionPromptStyle.value,
      left: `${Math.min(Math.max(menuAnchor.x + 10, left), Math.max(left, right - rect.width))}px`,
      top: `${Math.min(Math.max(menuAnchor.y + 10, top), Math.max(top, bottom - rect.height))}px`,
      visibility: "visible"
    };
  }

  function scheduleMenuPosition() {
    if (positionFrame !== undefined) window.cancelAnimationFrame(positionFrame);
    positionFrame = window.requestAnimationFrame(() => {
      positionFrame = undefined;
      void updateMenuPosition();
    });
  }

  watch(messageActionPopoverElement, (element, previous) => {
    if (previous) resizeObserver?.unobserve(previous);
    if (element) {
      resizeObserver?.observe(element);
      scheduleMenuPosition();
    } else if (positionFrame !== undefined) {
      window.cancelAnimationFrame(positionFrame);
      positionFrame = undefined;
    }
  }, { flush: "post" });

  onMounted(() => {
    resizeObserver = new ResizeObserver(scheduleMenuPosition);
    window.addEventListener("resize", scheduleMenuPosition, { passive: true });
    window.visualViewport?.addEventListener("resize", scheduleMenuPosition, { passive: true });
    window.visualViewport?.addEventListener("scroll", scheduleMenuPosition, { passive: true });
  });
  onBeforeUnmount(() => {
    if (positionFrame !== undefined) window.cancelAnimationFrame(positionFrame);
    resizeObserver?.disconnect();
    window.removeEventListener("resize", scheduleMenuPosition);
    window.visualViewport?.removeEventListener("resize", scheduleMenuPosition);
    window.visualViewport?.removeEventListener("scroll", scheduleMenuPosition);
  });

  function handleBubblePointerMove(message: MessageDTO, event: PointerEvent) {
    moveMessageLongPress(event);
    options.stirWaterMessage(message, event);
  }

  function handleBubblePointerLeave(message: MessageDTO, event: PointerEvent) {
    clearMessageLongPress();
    options.settleWaterMessage(message, event);
  }

  function beginMessageLongPress(message: MessageDTO, event: PointerEvent) {
    if (options.messageEffect(message) === "water" || options.messageEffect(message) === "dripGooey") options.requestDeviceOrientationPermissionOnce();
    if (options.oopsActiveMessageIds.value.has(message.id)) return;
    if (message.id <= 0 || message.type === "system" || event.button !== 0) return;
    const target = event.target;
    if (target instanceof Element && target.closest(".reply-preview, .chain-card button, .voice-card button, .prayer-actions, .message-bible, .message-select-btn, a, audio, video, iframe")) return;
    longPressStartedAt = { x: event.clientX, y: event.clientY };
    clearMessageLongPress();
    longPressTimer = window.setTimeout(() => {
      openMessageActionMenu(message, event);
      options.suppressNextTap();
      navigator.vibrate?.(12);
    }, longPressMs);
  }

  function moveMessageLongPress(event: PointerEvent) {
    if (!longPressTimer) return;
    const distance = Math.hypot(event.clientX - longPressStartedAt.x, event.clientY - longPressStartedAt.y);
    if (distance > 10) clearMessageLongPress();
  }

  function clearMessageLongPress() {
    if (longPressTimer) window.clearTimeout(longPressTimer);
    longPressTimer = undefined;
  }

  function beginFavoriteLongPress(favorite: FavoriteMessageDTO, event: PointerEvent) {
    if (event.button !== 0) return;
    const target = event.target;
    if (target instanceof Element && target.closest("button, a, audio, video")) return;
    favoriteLongPressStartedAt = { x: event.clientX, y: event.clientY };
    clearFavoriteLongPress();
    favoriteLongPressTimer = window.setTimeout(() => {
      favoriteLongPressTimer = undefined;
      options.suppressNextTap();
      navigator.vibrate?.(12);
      void options.openFavoriteMessage(favorite);
    }, longPressMs);
  }

  function moveFavoriteLongPress(event: PointerEvent) {
    if (!favoriteLongPressTimer) return;
    const distance = Math.hypot(event.clientX - favoriteLongPressStartedAt.x, event.clientY - favoriteLongPressStartedAt.y);
    if (distance > 10) clearFavoriteLongPress();
  }

  function clearFavoriteLongPress() {
    if (favoriteLongPressTimer) window.clearTimeout(favoriteLongPressTimer);
    favoriteLongPressTimer = undefined;
  }

  function beginChannelLongPress(channel: ChannelDTO, event: PointerEvent) {
    if (!canOpenChannelSettings(channel) || event.button !== 0) return;
    const target = event.target;
    if (target instanceof Element && target.closest("input, label, a")) return;
    channelLongPressStartedAt = { x: event.clientX, y: event.clientY };
    clearChannelLongPress();
    channelLongPressTimer = window.setTimeout(() => {
      options.openEditChannelEditor(channel);
      options.suppressNextTap();
      navigator.vibrate?.(12);
    }, longPressMs);
  }

  function moveChannelLongPress(event: PointerEvent) {
    if (!channelLongPressTimer) return;
    const distance = Math.hypot(event.clientX - channelLongPressStartedAt.x, event.clientY - channelLongPressStartedAt.y);
    if (distance > 10) clearChannelLongPress();
  }

  function clearChannelLongPress() {
    if (channelLongPressTimer) window.clearTimeout(channelLongPressTimer);
    channelLongPressTimer = undefined;
  }

  function openChannelContextMenu(channel: ChannelDTO, event: MouseEvent) {
    if (!canOpenChannelSettings(channel)) return;
    event.preventDefault();
    options.suppressNextTap();
    options.openEditChannelEditor(channel);
  }

  function openMessageActionMenu(message: MessageDTO, event: PointerEvent) {
    clearMessageLongPress();
    menuAnchor = { x: event.clientX, y: event.clientY };
    messageActionPromptStyle.value = { visibility: "hidden" };
    pendingMessageActions.value = message;
    options.closeCompetingPrompts();
    nextTick(scheduleMenuPosition);
  }

  function defaultMessageReactions(): MessageReactionsDTO {
    return { likeCount: 0, likedBy: [], favoriteCount: 0, currentUserLiked: false, currentUserFavorited: false };
  }

  async function toggleMessageLike(message: MessageDTO) {
    if (message.id <= 0 || message.type === "system") return;
    const previous = message.reactions || defaultMessageReactions();
    const liked = !previous.currentUserLiked;
    message.reactions = {
      ...previous,
      currentUserLiked: liked,
      likeCount: Math.max(0, previous.likeCount + (liked ? 1 : -1))
    };
    try {
      const result = await api<{ reactions: MessageReactionsDTO }>(`/api/messages/${message.id}/like`, {
        method: "PUT",
        body: JSON.stringify({ liked })
      });
      store.updateMessageReactions(message.id, result.reactions);
    } catch {
      message.reactions = previous;
    }
  }

  async function toggleMessageFavorite(message: MessageDTO) {
    if (message.id <= 0 || message.type === "system") return false;
    const previous = message.reactions || defaultMessageReactions();
    const favorited = !previous.currentUserFavorited;
    message.reactions = {
      ...previous,
      currentUserFavorited: favorited,
      favoriteCount: Math.max(0, previous.favoriteCount + (favorited ? 1 : -1))
    };
    try {
      const result = await api<{ reactions: MessageReactionsDTO }>(`/api/messages/${message.id}/favorite`, {
        method: "PUT",
        body: JSON.stringify({ favorited })
      });
      store.updateMessageReactions(message.id, result.reactions);
      if (options.showFavorites.value) await options.openFavorites();
      return true;
    } catch {
      message.reactions = previous;
      return false;
    }
  }

  async function likeActionMessage() {
    const message = pendingMessageActions.value;
    if (!message) return;
    await toggleMessageLike(message);
    closeMessageActionMenu();
  }

  async function favoriteActionMessage() {
    const message = pendingMessageActions.value;
    if (!message) return;
    const shouldOpenFavorites = message.type === "music_playlist" && !message.reactions?.currentUserFavorited;
    const updated = await toggleMessageFavorite(message);
    closeMessageActionMenu();
    if (updated && shouldOpenFavorites) await options.openFavorites();
  }

  function likedByTitle(message: MessageDTO) {
    return message.reactions?.likedBy.map((person) => person.displayName).join("、") || "";
  }

  async function dismissLikeNotification(id: number) {
    store.likeNotifications = store.likeNotifications.filter((item) => item.id !== id);
    await api(`/api/like-notifications/${id}/dismiss`, { method: "PATCH", body: JSON.stringify({}) }).catch(() => undefined);
  }

  async function dismissFavoriteNotification(id: number) {
    store.favoriteNotifications = store.favoriteNotifications.filter((item) => item.id !== id);
    await api(`/api/favorite-notifications/${id}/dismiss`, { method: "PATCH", body: JSON.stringify({}) }).catch(() => undefined);
  }

  function closeMessageActionMenu() {
    pendingMessageActions.value = null;
  }

  function quoteActionMessage() {
    const message = pendingMessageActions.value;
    if (!message) return;
    options.pickReply(message);
    closeMessageActionMenu();
  }

  async function selectActionMessageText() {
    const message = pendingMessageActions.value;
    if (!message) return;
    textSelectableMessageId.value = message.id;
    closeMessageActionMenu();
    await nextTick();
    const row = options.scroller.value?.querySelector<HTMLElement>(`.message-row[data-message-id="${message.id}"]`);
    const selectionTarget =
      row?.querySelector<HTMLElement>(".message-text, .prayer-text, .chain-card h3, .media-file-card span, .file-card span") ||
      row?.querySelector<HTMLElement>(".bubble");
    if (!selectionTarget) return;
    const range = document.createRange();
    range.selectNodeContents(selectionTarget);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  return {
    pendingMessageActions,
    messageActionPopoverElement,
    messageActionPromptStyle,
    textSelectableMessageId,
    handleBubblePointerMove,
    handleBubblePointerLeave,
    beginMessageLongPress,
    moveMessageLongPress,
    clearMessageLongPress,
    beginFavoriteLongPress,
    moveFavoriteLongPress,
    clearFavoriteLongPress,
    beginChannelLongPress,
    moveChannelLongPress,
    clearChannelLongPress,
    openChannelContextMenu,
    openMessageActionMenu,
    defaultMessageReactions,
    toggleMessageLike,
    toggleMessageFavorite,
    likeActionMessage,
    favoriteActionMessage,
    likedByTitle,
    dismissLikeNotification,
    dismissFavoriteNotification,
    closeMessageActionMenu,
    quoteActionMessage,
    selectActionMessageText
  };
}
