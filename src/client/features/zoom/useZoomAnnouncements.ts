import { computed, inject, provide, watch, type InjectionKey, type Ref } from "vue";
import type { MessageDTO } from "@shared/types";
import { zoomAnnouncementPayload } from "@shared/zoom";
import { useZoomMeeting, zoomMeetingKey } from "./useZoomMeeting";
import { zoomAnnouncementEnded } from "./zoomAnnouncementState";
import { useWorldExploration } from "./useWorldExploration";

interface PhysicsLayer {
  start: (id: number, bubble: HTMLElement, text: HTMLElement) => Promise<boolean>;
  restore: (id: number) => void;
  isActive: (id: number) => boolean;
}

const announcementsKey: InjectionKey<ReturnType<typeof provideZoomAnnouncements>> = Symbol("zoom-announcements");

export function provideZoomAnnouncements(options: {
  messages: () => readonly MessageDTO[];
  physics: Ref<PhysicsLayer | null>;
  surfaceActive: () => boolean;
  enabled: () => boolean;
}) {
  const zoom = useZoomMeeting(options.enabled);
  const exploration = useWorldExploration();
  provide(zoomMeetingKey, zoom);
  watch(() => options.messages().reduce((latest, message) => message.type === "system" && zoomAnnouncementPayload(message.payload) ? Math.max(latest, message.id) : latest, 0), () => { void zoom.refresh(); });
  const settings = computed(() => zoom.ready.value && !zoom.error.value ? zoom.settings.value : null);
  function ended(message: MessageDTO) {
    return zoomAnnouncementEnded(message, options.messages(), settings.value);
  }
  function drop(message: MessageDTO, event: MouseEvent) {
    if (!options.surfaceActive() || document.visibilityState !== "visible") return;
    const text = event.currentTarget;
    const bubble = text instanceof HTMLElement ? text.closest<HTMLElement>(".bubble") : null;
    const physics = options.physics.value;
    if (!physics || !bubble || !(text instanceof HTMLElement)) return;
    if (physics.isActive(message.id)) physics.restore(message.id);
    else void physics.start(message.id, bubble, text);
  }
  function explore(message: MessageDTO) {
    if (options.surfaceActive()) exploration.publish(message.id);
  }
  const actions = { ended, drop, explore, explorers: exploration.explorers };
  provide(announcementsKey, actions);
  return actions;
}

export function useZoomAnnouncements() {
  return inject(announcementsKey, null);
}
