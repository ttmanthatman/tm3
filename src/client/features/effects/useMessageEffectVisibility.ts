import { ref } from "vue";
import type { MessageDTO, MessageEffect } from "@shared/types";

interface UseMessageEffectVisibilityOptions {
  messageEffect: (message: MessageDTO) => MessageEffect | null;
}

export function useMessageEffectVisibility(options: UseMessageEffectVisibilityOptions) {
  const pausedEffectIds = ref<Set<number>>(new Set());
  const observedEffectIds = ref<Set<number>>(new Set());
  const visibleEffectIds = ref<Set<number>>(new Set());

  function messageIdForEffectElement(element: Element) {
    const row = element.closest<HTMLElement>(".message-row[data-message-id]");
    const id = Number(row?.dataset.messageId);
    return Number.isFinite(id) ? id : null;
  }

  function setsEqual(left: Set<number>, right: Set<number>) {
    return left.size === right.size && [...left].every((value) => right.has(value));
  }

  function updateEffectVisibility(observed: Set<number>, visible: Set<number>) {
    if (!setsEqual(observedEffectIds.value, observed)) observedEffectIds.value = observed;
    if (!setsEqual(visibleEffectIds.value, visible)) visibleEffectIds.value = visible;
  }

  function toggleMessageEffect(message: MessageDTO) {
    const effect = options.messageEffect(message);
    if (!effect || effect === "rain" || effect === "oops") return false;
    const next = new Set(pausedEffectIds.value);
    if (next.has(message.id)) next.delete(message.id);
    else next.add(message.id);
    pausedEffectIds.value = next;
    return true;
  }

  return {
    pausedEffectIds,
    observedEffectIds,
    visibleEffectIds,
    messageIdForEffectElement,
    updateEffectVisibility,
    toggleMessageEffect
  };
}
