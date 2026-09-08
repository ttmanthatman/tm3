import { computed, nextTick, ref, type Ref } from "vue";
import type { ChannelDTO, FavoriteMessageDTO, MessageDTO, MessageEffect, MessageReactionsDTO } from "@shared/types";
import { api } from "../../api";
import { useChatStore } from "../../store";
import { isForwardableMessage } from "../../messageForward";
import { canOpenChannelSettings } from "../../channelManagement";

interface UseMessageActionsOptions {
  scroller: Ref<HTMLElement | null>;
  showFavorites: Ref<boolean>;
  oopsActiveMessageIds: Ref<Set<number>>;
  messageEffect: (message: MessageDTO) => MessageEffect | null;
  requestDeviceOrientationPermissionOnce: () => void;
  stirWaterMessage: (message: MessageDTO, event: PointerEvent) => void;
  settleWaterMessage: (message: MessageDTO, event: PointerEvent) => void;
  positionPromptNearEvent: (event: MouseEvent | PointerEvent | undefined, size: { width: number; height: number }) => { x: number; y: number };
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
  const messageActionPromptPosition = ref({ x: 0, y: 0 });
  const textSelectableMessageId = ref<number | null>(null);

  const messageActionPromptStyle = computed(() => ({
    left: `${messageActionPromptPosition.value.x}px`,
    top: `${messageActionPromptPosition.value.y}px`
  }));

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
    messageActionPromptPosition.value = options.positionPromptNearEvent(event, { width: 190, height: 200 + (isForwardableMessage(message) ? 36 : 0) });
    pendingMessageActions.value = message;
    options.closeCompetingPrompts();
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
    messageActionPromptPosition,
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
    closeMessageActionMenu,
    quoteActionMessage,
    selectActionMessageText
  };
}
