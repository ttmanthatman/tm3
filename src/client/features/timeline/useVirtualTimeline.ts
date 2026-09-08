import { computed, ref, type Ref } from "vue";
import type { MessageDTO } from "@shared/types";
import { APP_VERSION } from "@shared/release";
import { imageDimensionsFromPayload } from "@shared/imageDimensions";
import { useChatStore } from "../../store";
import { formatSeparator, shouldShowSeparator } from "../../time";
import {
  estimatedImageTimelineHeight,
  virtualItemOffset,
  type VirtualTimelineAnchor,
  type VirtualTimelineItem,
  type VirtualTimelineWindow
} from "../../messageVirtualization";

export type TimelineRow =
  | { kind: "time"; label: string; id: string }
  | { kind: "version"; label: string; id: string }
  | { kind: "message"; message: MessageDTO };
export const VIRTUAL_TIMELINE_THRESHOLD = 40;
export const VIRTUAL_TIMELINE_MIN_BACKWARD_OVERSCAN = 2_400;
export const VIRTUAL_TIMELINE_BACKWARD_VIEWPORTS = 4;
export const VIRTUAL_TIMELINE_FORWARD_OVERSCAN = 320;
// Keep layout measurement and history prepends out of native wheel/touch momentum.
export const TIMELINE_SCROLL_IDLE_MS = 500;

interface UseVirtualTimelineOptions {
  scroller: Ref<HTMLElement | null>;
  versionUpdateNotice: Ref<string>;
  // Kept in App.vue (pinned by a responsiveLayout.test.ts literal) and passed in
  // so virtualTimelineItems shares one row-height estimate.
  estimateRowHeight: (row: TimelineRow) => number;
  // Kept in App.vue (pinned by responsiveLayout.test.ts overscan literals) and
  // passed in so windowing and viewport sync share one implementation.
  computeWindow: (scrollTop: number) => VirtualTimelineWindow;
  imagePreloadQueue: MessageDTO[];
  queuedImagePreloads: Set<number>;
  fileThumbUrl: (message: MessageDTO) => string;
}

export function useVirtualTimeline(options: UseVirtualTimelineOptions) {
  const store = useChatStore();
  const timelineScrollTop = ref(0);
  const timelineViewportHeight = ref(0);
  const timelineViewportWidth = ref(window.innerWidth);
  const measuredTimelineHeights = ref<Record<string, number>>({});
  const resolvedMessageImageDimensions = ref<Record<number, { width: number; height: number }>>({});
  const timelineScrollActive = ref(false);
  const pendingTimelineHeights = new Map<string, number>();
  let activeMessageImagePreloads = 0;

  const timeline = computed<TimelineRow[]>(() => {
    const rows: TimelineRow[] = [];
    let prev: string | undefined;
    for (const message of store.messages) {
      if (shouldShowSeparator(prev, message.createdAt)) rows.push({ kind: "time", label: formatSeparator(message.createdAt), id: `t-${message.id}` });
      rows.push({ kind: "message", message });
      prev = message.createdAt;
    }
    if (options.versionUpdateNotice.value && !store.loadingInitialMessages) {
      rows.push({ kind: "version", label: options.versionUpdateNotice.value, id: `version-${APP_VERSION}` });
    }
    return rows;
  });

  function timelineRowKey(row: TimelineRow) {
    if (row.kind === "time") return `time:${row.id}`;
    if (row.kind === "version") return `version:${row.id}`;
    return `message:${row.message.id}`;
  }

  function messageImageDimensions(message: MessageDTO) {
    return resolvedMessageImageDimensions.value[message.id] || imageDimensionsFromPayload(message.payload);
  }

  function messageImagePresentationStyle(message: MessageDTO) {
    const dimensions = messageImageDimensions(message);
    if (!dimensions) return undefined;
    const availableWidth = timelineViewportWidth.value > 0 ? timelineViewportWidth.value * 0.62 : 260;
    const width = Math.min(dimensions.width, 260, availableWidth);
    return { width: `${Math.round(width)}px`, aspectRatio: `${dimensions.width} / ${dimensions.height}` };
  }

  function estimatedImageTimelineRowHeight(message: MessageDTO, viewportWidth: number) {
    return estimatedImageTimelineHeight(messageImageDimensions(message), viewportWidth);
  }

  const virtualTimelineItems = computed<VirtualTimelineItem[]>(() => timeline.value.map((row) => ({
    key: timelineRowKey(row),
    estimatedHeight: options.estimateRowHeight(row)
  })));
  const virtualTimelineActive = computed(() => timeline.value.length > VIRTUAL_TIMELINE_THRESHOLD);
  const virtualTimelineWindow = computed(() => {
    if (!virtualTimelineActive.value) {
      const renderedHeight = virtualTimelineItems.value.reduce((sum, item) => sum + (measuredTimelineHeights.value[item.key] || item.estimatedHeight), 0);
      return { start: 0, end: timeline.value.length, topSpacer: 0, bottomSpacer: 0, renderedHeight, totalHeight: renderedHeight };
    }
    return options.computeWindow(timelineScrollTop.value);
  });
  const timelineTopSpacerHeight = computed(() => virtualTimelineWindow.value.topSpacer);
  const timelineBottomSpacerHeight = computed(() => virtualTimelineWindow.value.bottomSpacer);

  function timelineReservedHeight(key: string) {
    const item = virtualTimelineItems.value.find((candidate) => candidate.key === key);
    return measuredTimelineHeights.value[key] || item?.estimatedHeight || 1;
  }

  function syncVirtualTimelineViewport(root = options.scroller.value) {
    if (!root) return;
    const nextScrollTop = root.scrollTop;
    if (virtualTimelineActive.value && nextScrollTop !== timelineScrollTop.value) {
      const current = virtualTimelineWindow.value;
      const candidate = options.computeWindow(nextScrollTop);
      // Skip the reactive write while the rendered window (and its spacers) is unchanged.
      if (candidate.start !== current.start || candidate.end !== current.end) {
        timelineScrollTop.value = nextScrollTop;
      }
    } else {
      timelineScrollTop.value = nextScrollTop;
    }
    timelineViewportHeight.value = root.clientHeight;
    timelineViewportWidth.value = root.clientWidth;
  }

  function measuredTimelineRowHeight(element: HTMLElement) {
    const style = window.getComputedStyle(element);
    const marginTop = Number.parseFloat(style.marginTop) || 0;
    const marginBottom = Number.parseFloat(style.marginBottom) || 0;
    return Math.max(1, element.getBoundingClientRect().height + marginTop + marginBottom);
  }

  function visibleTimelineAnchor(root: HTMLElement): VirtualTimelineAnchor | null {
    const rootTop = root.getBoundingClientRect().top;
    const element = Array.from(root.querySelectorAll<HTMLElement>("[data-timeline-key]")).find((candidate) => candidate.getBoundingClientRect().bottom >= rootTop);
    const key = element?.dataset.timelineKey || "";
    const virtualOffset = key ? virtualItemOffset(virtualTimelineItems.value, measuredTimelineHeights.value, key) : null;
    return element && key && virtualOffset !== null
      ? { key, offset: element.getBoundingClientRect().top - rootTop, scrollTop: root.scrollTop, virtualOffset }
      : null;
  }

  function pumpMessageImagePreloads() {
    while (activeMessageImagePreloads < 2 && options.imagePreloadQueue.length) {
      const message = options.imagePreloadQueue.shift();
      if (!message) return;
      activeMessageImagePreloads += 1;
      void fetch(options.fileThumbUrl(message), { cache: "force-cache", credentials: "same-origin" })
        .then((response) => {
          if (!response.ok) throw new Error(`image preload failed: ${response.status}`);
          return response.blob();
        })
        .catch(() => options.queuedImagePreloads.delete(message.id))
        .finally(() => {
          activeMessageImagePreloads -= 1;
          pumpMessageImagePreloads();
        });
    }
  }

  return {
    timeline,
    timelineScrollTop,
    timelineViewportHeight,
    timelineViewportWidth,
    measuredTimelineHeights,
    resolvedMessageImageDimensions,
    timelineScrollActive,
    pendingTimelineHeights,
    timelineRowKey,
    messageImageDimensions,
    messageImagePresentationStyle,
    estimatedImageTimelineRowHeight,
    virtualTimelineItems,
    virtualTimelineActive,
    virtualTimelineWindow,
    timelineTopSpacerHeight,
    timelineBottomSpacerHeight,
    timelineReservedHeight,
    syncVirtualTimelineViewport,
    measuredTimelineRowHeight,
    visibleTimelineAnchor,
    pumpMessageImagePreloads
  };
}
