import { computed, onScopeDispose, ref, watch } from "vue";

export const BIBLE_SPLIT_HANDLE_WIDTH = 12;
export const BIBLE_MIN_WIDTH = 320;
export const CHAT_MIN_WIDTH = 360;

export function bibleSplitBounds(width: number) {
  const available = Math.max(BIBLE_MIN_WIDTH + CHAT_MIN_WIDTH, width - BIBLE_SPLIT_HANDLE_WIDTH);
  return { min: BIBLE_MIN_WIDTH / available, max: 1 - CHAT_MIN_WIDTH / available };
}

export function clampBibleSplitRatio(ratio: number, width: number, snap = false) {
  const { min, max } = bibleSplitBounds(width);
  const candidate = snap ? [0.25, 0.5, 0.75].find((stop) => stop >= min && stop <= max && Math.abs(stop - ratio) * (width - BIBLE_SPLIT_HANDLE_WIDTH) <= 14) : undefined;
  return Math.max(min, Math.min(max, candidate ?? ratio));
}

export function useBibleDisplayLayout(accountId: () => number | undefined) {
  const viewportWidth = ref(typeof window === "undefined" ? 0 : window.innerWidth);
  // A phone in landscape still uses one panel; the physical screen does not
  // shrink when a tablet's software keyboard opens.
  const phoneScreen = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches
    && Math.min(window.screen.width, window.screen.height) <= 600;
  const bibleSplitAvailable = computed(() => viewportWidth.value > 760 && !phoneScreen);
  const bibleOpen = ref(false);
  const expanded = ref(false);
  const preferredRatio = ref(0.5);
  const bibleSplit = computed(() => bibleOpen.value && bibleSplitAvailable.value && !expanded.value);
  const bibleFullscreen = computed(() => bibleOpen.value && !bibleSplit.value);
  const bibleSplitRatio = computed(() => clampBibleSplitRatio(preferredRatio.value, viewportWidth.value));
  const bibleLayoutStyle = computed(() => bibleSplit.value ? {
    "--bible-width": `${(viewportWidth.value - BIBLE_SPLIT_HANDLE_WIDTH) * bibleSplitRatio.value}px`
  } : {});

  function resize() { viewportWidth.value = window.innerWidth; }
  if (typeof window !== "undefined") {
    window.addEventListener("resize", resize);
    onScopeDispose(() => window.removeEventListener("resize", resize));
  }
  watch(accountId, (id) => {
    bibleOpen.value = !!id && bibleSplitAvailable.value;
    expanded.value = false;
    preferredRatio.value = 0.5;
  }, { immediate: true });

  function resizeBible(ratio: number, snap = false) {
    preferredRatio.value = clampBibleSplitRatio(ratio, viewportWidth.value, snap);
  }
  function expandBible() { expanded.value = true; }
  function shrinkBible() { expanded.value = false; }
  function openBible() { expanded.value = false; bibleOpen.value = true; }

  return { bibleOpen, bibleSplit, bibleFullscreen, bibleSplitAvailable, bibleSplitRatio, bibleLayoutStyle, viewportWidth, resizeBible, expandBible, shrinkBible, openBible };
}
