import { computed, onScopeDispose, ref, watch, type Ref } from "vue";

export type ReadingPanel = "bible" | "study" | "book" | "chat";
export type ReadingArrangement = "grid" | "columns" | "rows";
export const READING_PANELS: { id: ReadingPanel; label: string }[] = [
  { id: "bible", label: "圣经" }, { id: "study", label: "查经" },
  { id: "book", label: "书架" }, { id: "chat", label: "聊天" }
];
export const READING_ARRANGEMENTS = [
  { id: "grid", label: "田字形" }, { id: "columns", label: "横向排列" }, { id: "rows", label: "纵向排列" }
] as const;
type Rect = { left: number; top: number; width: number; height: number };

export function readingPanelRects(panels: ReadingPanel[], arrangement: ReadingArrangement, width: number, height: number, column: number, row: number): Partial<Record<ReadingPanel, Rect>> {
  const rects: Partial<Record<ReadingPanel, Rect>> = {};
  const count = panels.length;
  for (const [index, panel] of panels.entries()) {
    let rect: Rect;
    if (count === 1) rect = { left: 0, top: 0, width, height };
    else if (arrangement === "rows") {
      const first = height * row, rest = (height - first) / (count - 1);
      rect = { left: 0, top: index ? first + (index - 1) * rest : 0, width, height: index ? rest : first };
    } else if (arrangement === "columns" || count === 2) {
      const first = width * column, rest = (width - first) / (count - 1);
      rect = { left: index ? first + (index - 1) * rest : 0, top: 0, width: index ? rest : first, height };
    } else if (count === 3) {
      const first = width * column * 2 / 3;
      const rest = (width - first) / 2;
      rect = { left: index ? first + (index - 1) * rest : 0, top: 0, width: index ? rest : first, height };
    } else {
      const left = index === 0 || (count === 4 && index === 2);
      const full = count === 3 && left;
      const bottom = count === 4 ? index >= 2 : index === 2;
      rect = { left: left ? 0 : width * column, top: bottom ? height * row : 0,
        width: width * (left ? column : 1 - column), height: full ? height : height * (bottom ? 1 - row : row) };
    }
    rects[panel] = rect;
  }
  return rects;
}

export function useReadingWorkspaceLayout(options: {
  accountId: () => number | undefined; bibleOpen: Ref<boolean>; bookOpen: Ref<boolean>;
  splitAvailable: Ref<boolean>; viewportWidth: Ref<number>; studyOpen: Ref<boolean>;
}) {
  const studyOpen = options.studyOpen, chatOpen = ref(true);
  const arrangement = ref<ReadingArrangement>("grid");
  const columnRatio = ref(.5), rowRatio = ref(.5);
  const fullscreen = ref<ReadingPanel | null>(null), mobilePanel = ref<ReadingPanel>("chat");
  const height = ref(window.visualViewport?.height ?? window.innerHeight);
  const panels = computed(() => READING_PANELS.map(panel => panel.id).filter(panel => isOpen(panel)));
  const active = computed(() => options.bookOpen.value || studyOpen.value || !chatOpen.value || arrangement.value !== "grid" || fullscreen.value === "chat");
  const single = computed(() => fullscreen.value || (!options.splitAvailable.value ? mobilePanel.value : null));
  const rects = computed(() => {
    const width = options.viewportWidth.value, contentHeight = Math.max(0, height.value);
    const layout = readingPanelRects(panels.value, arrangement.value, width, contentHeight, columnRatio.value, rowRatio.value);
    const full = { left: 0, top: 0, width, height: contentHeight };
    if (!options.splitAvailable.value) for (const panel of panels.value) layout[panel] = full;
    if (single.value) layout[single.value] = full;
    return layout;
  });
  const multiple = computed(() => active.value && !single.value && panels.value.length > 1);
  function isOpen(panel: ReadingPanel): boolean {
    return { bible: options.bibleOpen.value, book: options.bookOpen.value, study: studyOpen.value, chat: chatOpen.value }[panel];
  }
  function visible(panel: ReadingPanel) { return isOpen(panel) && (!single.value || single.value === panel); }
  function panelStyle(panel: ReadingPanel) {
    const rect = rects.value[panel];
    if (!active.value || !rect) return {};
    return { '--panel-left': `${rect.left}px`, '--panel-top': `${rect.top}px`, '--panel-width': `${rect.width}px`, '--panel-height': `${rect.height}px` };
  }
  const shellStyle = computed(() => {
    const chat = rects.value.chat;
    return active.value && chat ? { '--chat-left': `${chat.left}px`, '--chat-top': `${chat.top}px`, '--chat-width': `${chat.width}px`, '--chat-height': `${chat.height}px` } : {};
  });
  function focus(panel: ReadingPanel) { fullscreen.value = null; mobilePanel.value = panel; }
  function toggleFullscreen(panel: ReadingPanel) { fullscreen.value = fullscreen.value === panel ? null : panel; }
  function close(panel: ReadingPanel) {
    if (panel === "bible") options.bibleOpen.value = false;
    if (panel === "book") options.bookOpen.value = false;
    if (panel === "study") studyOpen.value = false;
    if (panel === "chat") chatOpen.value = false;
    fullscreen.value = null;
    mobilePanel.value = panels.value.at(-1) ?? "chat";
    if (!panels.value.length) chatOpen.value = true;
  }
  function resize(axis: "column" | "row", ratio: number) {
    const extent = axis === "column" ? options.viewportWidth.value : height.value;
    const min = Math.max(.2, Math.min(.4, (axis === "column" ? 280 : 180) / Math.max(1, extent)));
    (axis === "column" ? columnRatio : rowRatio).value = Math.max(min, Math.min(1 - min, ratio));
  }
  const resizeWindow = () => { height.value = window.visualViewport?.height ?? window.innerHeight; };
  window.addEventListener("resize", resizeWindow);
  window.visualViewport?.addEventListener("resize", resizeWindow);
  onScopeDispose(() => {
    window.removeEventListener("resize", resizeWindow);
    window.visualViewport?.removeEventListener("resize", resizeWindow);
  });
  watch(options.accountId, id => {
    fullscreen.value = null; mobilePanel.value = "chat";
    studyOpen.value = false; options.bookOpen.value = false; chatOpen.value = true;
    arrangement.value = "grid"; columnRatio.value = .5; rowRatio.value = .5;
    if (!id) return;
    try {
      const stored = JSON.parse(localStorage.getItem(`team-chat-reading-layout:${id}`) || "null");
      if (!stored || stored.version !== 1) return;
      options.bibleOpen.value = stored.bible === true;
      options.bookOpen.value = stored.book === true;
      studyOpen.value = stored.study === true;
      chatOpen.value = stored.chat !== false;
      if (["grid", "columns", "rows"].includes(stored.arrangement)) arrangement.value = stored.arrangement;
      if (typeof stored.column === "number" && Number.isFinite(stored.column)) resize("column", stored.column);
      if (typeof stored.row === "number" && Number.isFinite(stored.row)) resize("row", stored.row);
      if (!panels.value.length) chatOpen.value = true;
    } catch { /* An unavailable or outdated local preference uses the defaults. */ }
  }, { immediate: true });
  watch(panels, current => {
    if (!current.includes(mobilePanel.value)) mobilePanel.value = current.at(-1) ?? "chat";
    if (fullscreen.value && !current.includes(fullscreen.value)) fullscreen.value = null;
  });
  watch([panels, arrangement, columnRatio, rowRatio], () => {
    const id = options.accountId();
    if (!id) return;
    try {
      localStorage.setItem(`team-chat-reading-layout:${id}`, JSON.stringify({ version: 1,
        bible: options.bibleOpen.value, book: options.bookOpen.value, study: studyOpen.value, chat: chatOpen.value,
        arrangement: arrangement.value, column: columnRatio.value, row: rowRatio.value }));
    } catch { /* The current layout remains usable when local storage is unavailable. */ }
  });
  return { studyOpen, chatOpen, arrangement, columnRatio, rowRatio, fullscreen, mobilePanel, panels, active, multiple,
    height, rects, shellStyle, isOpen, visible, panelStyle, focus, toggleFullscreen, close, resize };
}
