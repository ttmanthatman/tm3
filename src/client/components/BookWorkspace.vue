<script setup lang="ts">
// 图书室负一屏：书架 + EPUB 阅读器。
// 懒加载编排：本组件由 App.vue defineAsyncComponent 分包，进入聊天室不下载；
// 打开书架先渲染书单（小 JSON），并行动态 import foliate-js；
// 未缓存的图书首次点按只下载到当前会话的 Cache Storage，完成后再次点按才打开。
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { Download, ListTree, LoaderCircle, MessagesSquare, Minus, Plus, X } from "lucide-vue-next";
import { FootnoteHandler } from "foliate-js/footnotes.js";
import type { BookDTO } from "@shared/types";
import { api, getToken } from "../api";
import { bookClickAction, downloadBook, isBookDownloaded, type BookDownloadState } from "../books/cache";
import {
  bookTapAction,
  bookFootnoteTargetId,
  bookTouchScrollAction,
  buildBookCSS,
  bookCoverUrl,
  bookFileUrl,
  createEpubBook,
  createStreamingLoader,
  ContinuousBookReader,
  DEFAULT_READER_STYLE,
  globalFraction,
  isBookTouchDrag,
  nudgeFromSectionBoundaries,
  preloadAdjacentSections,
  readerLayoutMetrics,
  READER_THEMES,
  resolveBookLink,
  sectionFractions,
  type ContinuousReaderLocation,
  type EpubBook,
  type FoliateView,
  type ReaderStyle
} from "../books/reader";

const emit = defineEmits<{
  (e: "close"): void;
  (e: "reading-change", activity: { active: boolean; bookTitle: string | null }): void;
}>();

type FoliateModule = unknown;

const STYLE_KEY = "book-reader-style";
const LOCAL_PROGRESS_PREFIX = "book-progress.";
// 记录上次阅读的书，返回图书室时自动打开并恢复进度
const LAST_READ_KEY = "book-last-read";

const books = ref<BookDTO[]>([]);
const shelfLoading = ref(true);
const shelfError = ref("");
const downloadError = ref("");
const downloadStates = ref(new Map<number, BookDownloadState>());
const downloadProgress = ref(new Map<number, number>());

const readerOpen = ref(false);
const openingBook = ref(false);
const readerError = ref("");
const activeBook = ref<BookDTO | null>(null);

const style = ref<ReaderStyle>(loadStyle());
const tocItems = ref<{ label: string; href: string; depth: number }[]>([]);
const tocOpen = ref(false);
const settingsOpen = ref(false);
const chromeVisible = ref(true);
const chapterLabel = ref("");
const progressLabel = ref("0%");
const sliderValue = ref(0);
const footnoteOpen = ref(false);
const footnoteError = ref("");
const footnoteText = ref("");
const footnoteHost = ref<HTMLElement | null>(null);
const coverUrls = new Map<number, string>();

let foliatePromise: Promise<FoliateModule> | null = null;
let view: FoliateView | null = null;
let continuousReader: ContinuousBookReader | null = null;
let epubBook: EpubBook | null = null;
let tocSectionLabels = new Map<number, string>();
let relocateHandler: ((event: Event) => void) | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSavedFraction = -1;
type FootnoteView = HTMLElement & {
  renderer?: { setAttribute?(name: string, value: string): void; setStyles?(css: string): void };
};
const footnoteHandler = new FootnoteHandler();
let footnoteView: FootnoteView | null = null;

function closeFootnote() {
  footnoteView?.remove();
  footnoteView = null;
  footnoteOpen.value = false;
  footnoteError.value = "";
  footnoteText.value = "";
}

function openCurrentDocumentFootnote(doc: Document, anchor: Element, href: string): boolean {
  const targetId = bookFootnoteTargetId(anchor, href);
  const target = targetId ? doc.getElementById(targetId) : null;
  if (!target) return false;
  const copy = target.cloneNode(true) as Element;
  for (const backlink of copy.querySelectorAll("a")) {
    const types = backlink.getAttributeNS?.("http://www.idpf.org/2007/ops", "type")?.split(/\s+/) ?? [];
    const roles = backlink.getAttribute("role")?.split(/\s+/) ?? [];
    if (types.includes("backlink") || roles.includes("doc-backlink")) backlink.remove();
  }
  const text = copy.textContent?.replace(/\s+/g, " ").trim();
  if (!text) return false;
  footnoteView?.remove();
  footnoteView = null;
  footnoteText.value = text;
  footnoteError.value = "";
  footnoteOpen.value = true;
  return true;
}

footnoteHandler.addEventListener("before-render", (event) => {
  const nextView = (event as CustomEvent<{ view: FootnoteView }>).detail.view;
  nextView.renderer?.setAttribute?.("flow", "scrolled");
  nextView.renderer?.setStyles?.(buildBookCSS(style.value));
});

footnoteHandler.addEventListener("render", (event) => {
  const nextView = (event as CustomEvent<{ view: FootnoteView }>).detail.view;
  footnoteView?.remove();
  footnoteView = nextView;
  footnoteError.value = "";
  footnoteOpen.value = true;
  void nextTick(() => {
    if (footnoteView === nextView) footnoteHost.value?.replaceChildren(nextView);
  });
});

function loadStyle(): ReaderStyle {
  try {
    const raw = localStorage.getItem(STYLE_KEY);
    if (raw) return { ...DEFAULT_READER_STYLE, ...JSON.parse(raw) };
  } catch { /* 忽略损坏的本地配置 */ }
  return { ...DEFAULT_READER_STYLE };
}

function persistStyle() {
  localStorage.setItem(STYLE_KEY, JSON.stringify(style.value));
}

function localProgressKey(bookId: number) {
  return `${LOCAL_PROGRESS_PREFIX}${bookId}`;
}

function cachedProgress(book: BookDTO): number {
  if (book.progress != null) return book.progress;
  const raw = localStorage.getItem(localProgressKey(book.id));
  const value = raw == null ? 0 : Number(raw);
  return Number.isFinite(value) && value > 0.005 && value < 0.995 ? value : 0;
}

const sortedBooks = computed(() => {
  return [...books.value].sort((a, b) => {
    const pa = cachedProgress(a);
    const pb = cachedProgress(b);
    const reading = (p: number) => p > 0.005 && p < 0.995;
    if (reading(pa) !== reading(pb)) return reading(pa) ? -1 : 1;
    return b.id - a.id;
  });
});

function coverUrl(book: BookDTO): string {
  let url = coverUrls.get(book.id);
  if (!url) {
    url = `${bookCoverUrl(book.id)}?v=${encodeURIComponent(book.coverName ?? "")}&token=${encodeURIComponent(getToken())}`;
    coverUrls.set(book.id, url);
  }
  return url;
}

async function loadShelf() {
  shelfLoading.value = true;
  shelfError.value = "";
  try {
    const res = await api<{ success: boolean; books: BookDTO[] }>("/api/books");
    books.value = res.books;
    for (const book of res.books) setDownloadState(book.id, "checking");
    await Promise.all(res.books.map(async (book) => {
      try {
        setDownloadState(book.id, await isBookDownloaded(book.id) ? "ready" : "needed");
      } catch {
        setDownloadState(book.id, "needed");
      }
    }));
  } catch (error) {
    shelfError.value = error instanceof Error ? error.message : "书架加载失败";
  } finally {
    shelfLoading.value = false;
  }
}

function setDownloadState(bookId: number, state: BookDownloadState) {
  const next = new Map(downloadStates.value);
  next.set(bookId, state);
  downloadStates.value = next;
}

function setDownloadProgress(bookId: number, progress: number) {
  const next = new Map(downloadProgress.value);
  next.set(bookId, Math.max(0, Math.min(1, progress)));
  downloadProgress.value = next;
}

function bookDownloadState(book: BookDTO): BookDownloadState {
  return downloadStates.value.get(book.id) ?? "checking";
}

function bookDownloadPercent(book: BookDTO): number {
  return Math.round((downloadProgress.value.get(book.id) ?? 0) * 100);
}

async function handleBookClick(book: BookDTO) {
  const action = bookClickAction(bookDownloadState(book));
  if (action === "open") {
    await openBook(book);
    return;
  }
  if (action === "wait") return;
  downloadError.value = "";
  setDownloadState(book.id, "downloading");
  setDownloadProgress(book.id, 0);
  try {
    await downloadBook(book.id, (loaded, total) => {
      const progress = total > 0 ? loaded / total : loaded / Math.max(1, book.fileSize);
      if (Math.round(progress * 100) !== bookDownloadPercent(book)) setDownloadProgress(book.id, progress);
    });
    setDownloadProgress(book.id, 1);
    setDownloadState(book.id, "ready");
  } catch (error) {
    setDownloadState(book.id, "error");
    downloadError.value = error instanceof Error ? error.message : "图书下载失败，请重试";
  }
}

// 打开书架：书单优先，阅读器模块并行预热（不阻塞书架渲染）。
async function preloadFoliate() {
  foliatePromise ??= import("foliate-js/view.js");
  try {
    await foliatePromise;
  } catch {
    foliatePromise = null; // 下次点击图书时重试
  }
}

function backToShelf() {
  closeBookView();
  readerOpen.value = false;
  activeBook.value = null;
  emit("reading-change", { active: false, bookTitle: null });
  void loadShelf();
}

function emitClose() {
  if (readerOpen.value) backToShelf();
  emit("close");
}

function closeBookView() {
  closeFootnote();
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (resizeTimer) {
    clearTimeout(resizeTimer);
    resizeTimer = null;
  }
  window.removeEventListener("resize", onWindowResize);
  flushProgress();
  if (view && relocateHandler) view.removeEventListener("relocate", relocateHandler);
  relocateHandler = null;
  lastPreloadIndex = -1;
  view?.remove();
  view = null;
  continuousReader?.destroy();
  continuousReader = null;
  epubBook?.destroy?.();
  epubBook = null;
  tocSectionLabels = new Map();
  tocItems.value = [];
  chapterLabel.value = "";
  progressLabel.value = "0%";
  sliderValue.value = 0;
}

async function openBook(book: BookDTO) {
  if (openingBook.value) return;
  openingBook.value = true;
  readerError.value = "";
  activeBook.value = book;
  emit("reading-change", { active: true, bookTitle: book.title });
  try {
    await nextTick(); // 等阅读器容器渲染（openingBook 驱动 v-if）
    closeBookView();

    const stage = bookStage.value;
    if (!stage) throw new Error("阅读器容器不可用");
    // 完整文件已由书架下载到私有 SW cache；阅读器仍走 Range 接口，
    // 离线时由缓存切片响应，在线时也不会重复下载整本书。
    const loader = await createStreamingLoader(bookFileUrl(book.id));
    const bookObject = await createEpubBook(loader);
    epubBook = bookObject;

    bookObject.transformTarget?.addEventListener("data", (event) => {
      const detail = (event as CustomEvent<{ data: Promise<unknown> }>).detail;
      detail.data = Promise.resolve(detail.data).catch(() => "");
    });

    const starts = sectionFractions(bookObject.sections);
    const restoreTarget = nudgeFromSectionBoundaries(starts, cachedProgress(book));
    const metadata = bookObject.metadata ?? {};
    activeBookTitle.value = formatLang(metadata.title) || book.title;
    renderTOC(bookObject.toc ?? [], bookObject);

    if (style.value.flow === "scrolled") {
      const continuous = new ContinuousBookReader(bookObject, starts, {
        style: style.value,
        onDocumentLoad: onContinuousDocumentLoad,
        onRelocate: onContinuousRelocate
      });
      continuousReader = continuous;
      stage.append(continuous.element);
      await continuous.open(restoreTarget);
    } else {
      const module = await (foliatePromise ??= import("foliate-js/view.js"));
      await module; // 确保自定义元素已注册
      const element = document.createElement("foliate-view") as unknown as FoliateView;
      stage.append(element as unknown as Node);
      view = element;
      await element.open(bookObject);
      element.renderer.setAttribute("flow", "paginated");
      applyLayout();
      element.renderer.setStyles?.(buildBookCSS(style.value));
      relocateHandler = (event) => onRelocate(event as CustomEvent<RelocateDetail>);
      element.addEventListener("relocate", relocateHandler);
      element.addEventListener("load", onViewLoad);
      element.addEventListener("link", onViewLink);

      if (restoreTarget > 0.005) {
        // 等首帧 relocate（首节渲染完成）再跳转；过早 goToFraction 会被吞掉
        await new Promise<void>((resolve) => {
          const done = () => {
            element.removeEventListener("relocate", done);
            resolve();
          };
          element.addEventListener("relocate", done);
          setTimeout(() => {
            element.removeEventListener("relocate", done);
            resolve();
          }, 4000);
        });
        try {
          await element.goToFraction(restoreTarget);
        } catch (error) {
          console.error("restore failed", error);
        }
      } else {
        element.renderer.next(); // foliate 官方 demo 的初始化手法
      }
    }
    chromeVisible.value = style.value.flow === "paginated";
    settingsOpen.value = false;
    tocOpen.value = false;
    readerOpen.value = true;
    localStorage.setItem(LAST_READ_KEY, String(book.id));
    if (style.value.flow === "paginated") window.addEventListener("resize", onWindowResize);
  } catch (error) {
    console.error(error);
    readerError.value = error instanceof Error ? error.message : "图书打开失败";
    closeBookView();
    activeBook.value = null;
    emit("reading-change", { active: false, bookTitle: null });
  } finally {
    openingBook.value = false;
  }
}

const bookStage = ref<HTMLElement | null>(null);
const activeBookTitle = ref("");

function formatLang(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const first = record[Object.keys(record)[0] ?? ""];
    if (typeof first === "string") return first;
    if (first && typeof first === "object" && "name" in first) return String((first as { name: unknown }).name);
  }
  return "";
}

type RawTocItem = { label?: string; href?: string; subitems?: unknown[] };

function renderTOC(toc: RawTocItem[], book?: EpubBook) {
  const items: { label: string; href: string; depth: number }[] = [];
  tocSectionLabels = new Map();
  const walk = (list: unknown[], depth: number) => {
    for (const raw of list ?? []) {
      const item = raw as RawTocItem;
      items.push({ label: item.label ?? "（无题）", href: item.href ?? "", depth });
      if (item.href && !tocSectionLabels.has(book?.resolveHref?.(item.href)?.index ?? -1)) {
        const index = book?.resolveHref?.(item.href)?.index;
        if (index !== undefined && index !== null) tocSectionLabels.set(index, item.label ?? "");
      }
      walk(item.subitems ?? [], depth + 1);
    }
  };
  walk(toc, 0);
  tocItems.value = items;
}

function jumpTo(href: string) {
  tocOpen.value = false;
  if (continuousReader) void continuousReader.goToHref(href);
  else void (view as unknown as { goTo(target: string): Promise<void> })?.goTo?.(href);
}

type RelocateDetail = {
  index?: number;
  fraction: number;
  range: Range;
  // foliate-view 重新抛出的事件用 section.current 表示节号，此时 fraction 已是全书比例
  section?: { current?: number };
};

function onRelocate(event: CustomEvent<RelocateDetail>) {
  if (!view) return;
  const detail = event.detail;
  const index = detail.section?.current ?? detail.index ?? 0;
  const { range } = detail;
  const starts = view.getSectionFractions();
  const global = detail.section?.current != null
    ? Math.max(0, Math.min(0.9999, detail.fraction))
    : globalFraction(starts, index, detail.fraction);
  sliderValue.value = global;
  progressLabel.value = `${Math.round(global * 100)}%`;
  try {
    const { tocItem } = (view as unknown as {
      getProgressOf(index: number, range: Range): { tocItem?: { label?: string; href?: string } | null } | null;
    }).getProgressOf(index, range) ?? {};
    chapterLabel.value = tocItem?.label ?? "";
  } catch { /* 章节定位失败不阻塞阅读 */ }
  scheduleSave(global);
  // 预取相邻章：滚动/翻节进入下一章时内容已在缓存里，避免白屏闪烁
  if (index !== lastPreloadIndex) {
    lastPreloadIndex = index;
    preloadAdjacentSections(view, index);
  }
}

function onContinuousRelocate(location: ContinuousReaderLocation) {
  sliderValue.value = location.globalFraction;
  progressLabel.value = `${Math.round(location.globalFraction * 100)}%`;
  chapterLabel.value = tocSectionLabels.get(location.index) ?? chapterLabel.value;
  scheduleSave(location.globalFraction);
}

function onContinuousDocumentLoad(doc: Document, index: number) {
  doc.addEventListener("click", (event) => {
    if (consumeSuppressedDocumentClick()) {
      event.preventDefault();
      return;
    }
    const anchor = (event.target as Element | null)?.closest?.("a[href]");
    if (anchor) {
      const rawHref = anchor.getAttribute("href");
      if (!rawHref) return;
      event.preventDefault();
      if (openCurrentDocumentFootnote(doc, anchor, rawHref)) return;
      const href = epubBook?.sections[index]?.resolveHref?.(rawHref) ?? rawHref;
      followBookLink(anchor, href);
      return;
    }
    if (hasTextSelection(doc)) return;
    toggleChrome();
  });
  bindDocumentTouch(doc);
}

function scheduleSave(global: number) {
  const book = activeBook.value;
  if (!book) return;
  localStorage.setItem(localProgressKey(book.id), String(global));
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => flushProgress(), 1500);
}

function flushProgress() {
  const book = activeBook.value;
  if (!book) return;
  const raw = localStorage.getItem(localProgressKey(book.id));
  const fraction = raw == null ? Number.NaN : Number(raw);
  if (!Number.isFinite(fraction) || Math.abs(fraction - lastSavedFraction) < 0.002) return;
  lastSavedFraction = fraction;
  void api(`/api/books/${book.id}/progress`, {
    method: "PUT",
    body: JSON.stringify({ fraction })
  }).then(() => {
    const idx = books.value.findIndex((b) => b.id === book.id);
    if (idx >= 0) books.value[idx] = { ...books.value[idx], progress: fraction };
  }).catch(() => { /* 离线时保留本地进度，下次同步 */ });
}

// 边距/版式变化时同步 foliate 布局三件套。margin 只管上下页边距且必须带单位；
// 左右留白由 max-inline-size + gap 决定（见 readerLayoutMetrics），
// 其中 gap 在分页模式是栏间距、滚动模式是正文两侧 padding。
function applyLayout() {
  if (!view) return;
  const stage = bookStage.value;
  const metrics = readerLayoutMetrics(style.value, stage?.clientWidth ?? 0, stage?.clientHeight ?? 0);
  view.renderer.setAttribute("margin", `${metrics.margin}px`);
  view.renderer.setAttribute("max-inline-size", `${metrics.maxInlineSize}px`);
  view.renderer.setAttribute("gap", `${metrics.gapPct}%`);
}

let resizeTimer: ReturnType<typeof setTimeout> | null = null;
function onWindowResize() {
  if (!view) return;
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => applyLayout(), 150);
}

function applyStyle() {
  persistStyle();
  continuousReader?.setStyle(style.value);
  view?.renderer.setStyles?.(buildBookCSS(style.value));
  footnoteView?.renderer?.setStyles?.(buildBookCSS(style.value));
}

function setTheme(theme: ReaderStyle["theme"]) {
  style.value = { ...style.value, theme };
  applyStyle();
}

function setFlow(flow: ReaderStyle["flow"]) {
  if (style.value.flow === flow) return;
  style.value = { ...style.value, flow };
  persistStyle();
  // 滚动版式进入沉浸阅读：自动隐藏控制栏（之后向下滚动隐藏、向上滚动或点按中部显示）；
  // 切回分页则恢复显示，保持可发现性
  if (flow === "scrolled") {
    chromeVisible.value = false;
    settingsOpen.value = false;
  } else {
    chromeVisible.value = true;
  }
  const book = activeBook.value;
  if (book) void openBook(book);
}

function stepFont(delta: number) {
  const fontPct = Math.max(70, Math.min(200, style.value.fontPct + delta));
  style.value = { ...style.value, fontPct };
  applyStyle();
}

function stepSpacing(delta: number) {
  const spacing = Math.round(Math.max(1.2, Math.min(2.4, style.value.spacing + delta)) * 10) / 10;
  style.value = { ...style.value, spacing };
  applyStyle();
}

function stepMargin(delta: number) {
  const margin = Math.max(16, Math.min(96, style.value.margin + delta));
  style.value = { ...style.value, margin };
  persistStyle();
  // margin/max-inline-size/gap 是 foliate 分页器属性（不是注入 CSS），改动会触发其重排
  applyLayout();
}

// ---- 内容区交互 ----
// iframe 内的 wheel/touch/click 事件不会冒泡到父文档，外层覆盖层或 capture 监听都收不到；
// 因此所有内容区交互都挂在章节文档上（foliate-view 的 load 事件逐节派发）。
// 链接点击交给 foliate 自带的 link 处理（内部跳转/外链打开），这里只处理空白区点按。

function isLinkClick(event: MouseEvent): boolean {
  const target = event.target as Element | null;
  return !!target?.closest?.("a[href]");
}

function hasTextSelection(doc: Document): boolean {
  const selection = doc.getSelection?.();
  return !!selection && selection.rangeCount > 0 && !selection.isCollapsed;
}

function toggleChrome() {
  chromeVisible.value = !chromeVisible.value;
  if (!chromeVisible.value) settingsOpen.value = false;
}

function pageBy(direction: 1 | -1) {
  const target = view as unknown as { goLeft?(): void; goRight?(): void } | null;
  if (!target) return;
  if (direction > 0) target.goRight?.();
  else target.goLeft?.();
}

// 点按分区：分页时左右翻页、中间显示/隐藏控制栏；滚动时点按切换控制栏
function onDocClick(doc: Document, event: MouseEvent) {
  if (!view || openingBook.value) return;
  if (consumeSuppressedDocumentClick()) {
    event.preventDefault();
    return;
  }
  if (isLinkClick(event)) return;
  if (hasTextSelection(doc)) return; // 选中文字后不翻页
  const width = doc.defaultView?.innerWidth ?? 1;
  const ratio = event.clientX / width;
  const action = bookTapAction(style.value.flow, ratio);
  if (action === "previous") pageBy(-1);
  else if (action === "next") pageBy(1);
  else toggleChrome();
}

// 滚动版式跨节：原生滚动到本节底部/顶部就停住，越过边界时接管翻节。
// renderer.next()/prev() 自带锁定与节内滚动处理，到节尾再调用即翻入下一节。
function chainScrolledSection(event: { preventDefault(): void }, direction: 1 | -1) {
  if (!view) return;
  event.preventDefault();
  if (direction > 0) void view.renderer.next();
  else void view.renderer.prev();
}

function onDocWheel(event: WheelEvent) {
  if (!view) return;
  const renderer = view.renderer;
  if (style.value.flow === "scrolled") {
    // 沉浸阅读：向下滚隐藏控制栏、向上滚显示
    if (event.deltaY > 4 && chromeVisible.value) {
      chromeVisible.value = false;
      settingsOpen.value = false;
    } else if (event.deltaY < -4 && !chromeVisible.value) {
      chromeVisible.value = true;
    }
    const nearBottom = renderer.viewSize - renderer.end <= 8;
    const nearTop = renderer.start <= 8;
    if (event.deltaY > 0 && nearBottom) chainScrolledSection(event, 1);
    else if (event.deltaY < 0 && nearTop) chainScrolledSection(event, -1);
    return;
  }
  // 分页：滚轮按阈值翻页，翻页间隙忽略连续滚动（触控板会连续派发 delta）
  const now = Date.now();
  if (now < pageWheelLockUntil) return;
  pageWheelAccum += Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
  if (Math.abs(pageWheelAccum) >= 80) {
    const direction = pageWheelAccum > 0 ? 1 : -1;
    pageWheelAccum = 0;
    pageWheelLockUntil = now + 400;
    pageBy(direction);
  }
}

let lastPreloadIndex = -1;
let pageWheelAccum = 0;
let pageWheelLockUntil = 0;
let docTouchY: number | null = null;
let docTouchStartX: number | null = null;
let docTouchStartY: number | null = null;
let docTouchAccumulatedY = 0;
let docTouchDragged = false;
let suppressDocumentClickUntil = 0;

function onDocTouchStart(event: TouchEvent) {
  const touch = event.touches[0];
  docTouchY = touch?.clientY ?? null;
  docTouchStartX = touch?.clientX ?? null;
  docTouchStartY = touch?.clientY ?? null;
  docTouchAccumulatedY = 0;
  docTouchDragged = false;
  // 新的一次点按不应继承上一次滚动留下的点击抑制窗口。
  suppressDocumentClickUntil = 0;
}

// 滚动版式的触摸跨节；分页的滑动手势由 foliate 分页器自带处理（带速度吸附）
function onDocTouchMove(event: TouchEvent) {
  if (docTouchY == null || docTouchStartX == null || docTouchStartY == null) return;
  const touch = event.touches[0];
  const x = touch?.clientX ?? docTouchStartX;
  const y = event.touches[0]?.clientY ?? docTouchY;
  const dy = docTouchY - y;
  docTouchY = y;
  docTouchAccumulatedY += dy;
  if (isBookTouchDrag(x - docTouchStartX, y - docTouchStartY)) docTouchDragged = true;
  if (style.value.flow !== "scrolled") return;
  const scrollAction = bookTouchScrollAction(docTouchAccumulatedY);
  if (scrollAction === "hide-chrome" && chromeVisible.value) {
    chromeVisible.value = false;
    settingsOpen.value = false;
  } else if (scrollAction === "show-chrome" && !chromeVisible.value) {
    chromeVisible.value = true;
  }
  if (scrollAction) docTouchAccumulatedY = 0;
  if (!view) return;
  const renderer = view.renderer;
  const nearBottom = renderer.viewSize - renderer.end <= 8;
  const nearTop = renderer.start <= 8;
  if (dy > 8 && nearBottom) chainScrolledSection(event, 1);
  else if (dy < -8 && nearTop) chainScrolledSection(event, -1);
}

function onDocTouchEnd() {
  if (docTouchDragged) suppressDocumentClickUntil = performance.now() + 700;
  docTouchY = null;
  docTouchStartX = null;
  docTouchStartY = null;
  docTouchAccumulatedY = 0;
  docTouchDragged = false;
}

function consumeSuppressedDocumentClick(): boolean {
  if (performance.now() > suppressDocumentClickUntil) return false;
  suppressDocumentClickUntil = 0;
  return true;
}

function bindDocumentTouch(doc: Document) {
  doc.addEventListener("touchstart", onDocTouchStart, { passive: true });
  doc.addEventListener("touchmove", onDocTouchMove, { passive: false });
  doc.addEventListener("touchend", onDocTouchEnd, { passive: true });
  doc.addEventListener("touchcancel", onDocTouchEnd, { passive: true });
}

function followBookLink(anchor: Element, href: string) {
  if (!epubBook) return;
  const resolution = resolveBookLink(epubBook, footnoteHandler, anchor, href);
  if (resolution.kind === "footnote") {
    void resolution.task.catch(() => {
      footnoteError.value = "这个脚注暂时无法显示";
      footnoteOpen.value = true;
    });
  } else if (resolution.kind === "external") {
    window.open(href, "_blank", "noopener");
  } else if (continuousReader) {
    void continuousReader.goToHref(href);
  }
}

function onViewLink(event: Event) {
  if (!epubBook) return;
  const detail = (event as CustomEvent<{ a: Element; href: string }>).detail;
  const ownerDocument = detail.a.ownerDocument;
  if (ownerDocument && openCurrentDocumentFootnote(ownerDocument, detail.a, detail.href)) {
    event.preventDefault();
    return;
  }
  const resolution = resolveBookLink(epubBook, footnoteHandler, detail.a, detail.href);
  if (resolution.kind !== "footnote") return;
  event.preventDefault();
  void resolution.task.catch(() => {
    footnoteError.value = "这个脚注暂时无法显示";
    footnoteOpen.value = true;
  });
}

// iframe 之外的页边留白区：点按/滚轮同样生效（iframe 内事件不会冒泡到这里，两套监听互不重复）
function onStageZoneClick(event: MouseEvent) {
  if (!view || openingBook.value) return;
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const ratio = (event.clientX - rect.left) / rect.width;
  const action = bookTapAction(style.value.flow, ratio);
  if (action === "previous") pageBy(-1);
  else if (action === "next") pageBy(1);
  else toggleChrome();
}

function onViewLoad(event: Event) {
  const doc = (event as CustomEvent<{ doc?: Document }>).detail?.doc;
  if (!doc) return;
  doc.addEventListener("click", (e) => onDocClick(doc, e));
  doc.addEventListener("wheel", onDocWheel, { passive: false });
  bindDocumentTouch(doc);
}

function onSliderInput(event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  if (continuousReader) void continuousReader.goToFraction(value);
  else void view?.goToFraction(value);
}

function onKeydown(event: KeyboardEvent) {
  if (!readerOpen.value) return;
  const target = view as unknown as { goLeft?(): void; goRight?(): void } | null;
  if (event.key === "ArrowLeft") target?.goLeft?.();
  else if (event.key === "ArrowRight") target?.goRight?.();
  else if (event.key === "Escape") {
    if (footnoteOpen.value) closeFootnote();
    else if (tocOpen.value) tocOpen.value = false;
    else backToShelf();
  }
}

watch(readerOpen, (open) => {
  if (open) document.addEventListener("keydown", onKeydown);
  else document.removeEventListener("keydown", onKeydown);
});

void loadShelf().then(() => {
  // 返回图书室自动打开上次读的书；进度恢复走既有 cachedProgress 逻辑。
  // 书被删除（不在书架）时留在书架页。
  const raw = localStorage.getItem(LAST_READ_KEY);
  const id = raw == null ? Number.NaN : Number(raw);
  const book = Number.isFinite(id) ? books.value.find((b) => b.id === id) : undefined;
  if (book && bookDownloadState(book) === "ready") void openBook(book);
});
void preloadFoliate();

onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKeydown);
  closeBookView();
});

defineExpose({ reload: loadShelf });
</script>

<template>
  <section class="book-workspace" data-book-workspace>
    <!-- 书架 -->
    <div v-if="!readerOpen && !openingBook" class="book-shelf">
      <header class="book-topbar">
        <button class="book-topbar-btn" type="button" @click="emitClose"><X :size="19" /> 关闭</button>
        <strong class="book-topbar-title">图书室</strong>
        <span class="book-topbar-hint">{{ books.length ? `${books.length} 本` : "" }}</span>
      </header>
      <div v-if="shelfLoading" class="book-shelf-state"><LoaderCircle class="book-spin" :size="22" /> 正在打开书架…</div>
      <div v-else-if="shelfError" class="book-shelf-state error">
        <p>{{ shelfError }}</p>
        <button class="book-btn" type="button" @click="loadShelf">重试</button>
      </div>
      <div v-else-if="!books.length" class="book-shelf-state">
        <p>还没有图书</p>
        <p class="book-shelf-sub">管理员可在「管理 → 图书」上传 EPUB 图书</p>
      </div>
      <p v-if="downloadError" class="book-download-error" role="alert">{{ downloadError }}</p>
      <div v-if="!shelfLoading && !shelfError && books.length" class="book-shelf-grid">
        <button
          v-for="book in sortedBooks"
          :key="book.id"
          class="book-card"
          type="button"
          :aria-label="bookDownloadState(book) === 'ready' ? `阅读《${book.title}》` : `下载《${book.title}》`"
          @click="handleBookClick(book)"
        >
          <span class="book-cover">
            <img v-if="book.coverName" :src="coverUrl(book)" alt="" loading="lazy" />
            <span v-else class="book-cover-fallback">{{ book.title }}</span>
            <span v-if="cachedProgress(book) > 0.005" class="book-progress"><i :style="{ width: `${Math.round(cachedProgress(book) * 100)}%` }" /></span>
            <span
              v-if="bookDownloadState(book) !== 'ready'"
              class="book-download-badge"
              :class="{ error: bookDownloadState(book) === 'error' }"
              aria-hidden="true"
            >
              <LoaderCircle v-if="bookDownloadState(book) === 'checking'" class="book-spin" :size="18" />
              <span v-else-if="bookDownloadState(book) === 'downloading'" class="book-download-percent">{{ bookDownloadPercent(book) }}%</span>
              <Download v-else :size="18" />
            </span>
          </span>
          <span class="book-card-title">{{ book.title }}</span>
          <span class="book-card-author">{{ book.author || "佚名" }}</span>
        </button>
      </div>
    </div>

    <!-- 阅读器 -->
    <div
      v-if="readerOpen || openingBook"
      class="book-reader"
      :data-theme="style.theme"
    >
      <div ref="bookStage" class="book-stage" @click="onStageZoneClick" @wheel="onDocWheel"></div>
      <button
        v-if="style.flow === 'paginated'"
        class="book-page-zone previous"
        type="button"
        tabindex="-1"
        aria-label="上一页"
        @click.stop="pageBy(-1)"
      ></button>
      <button
        v-if="style.flow === 'paginated'"
        class="book-page-zone next"
        type="button"
        tabindex="-1"
        aria-label="下一页"
        @click.stop="pageBy(1)"
      ></button>

      <header class="book-bar book-top" :class="{ 'bar-hidden': !chromeVisible }">
        <button class="book-bar-btn" type="button" @click="backToShelf">‹ 书架</button>
        <div class="book-reader-title">
          <strong>{{ activeBookTitle }}</strong>
          <small>{{ chapterLabel }}</small>
        </div>
        <div class="book-bar-group">
          <button class="book-bar-btn" type="button" :aria-label="'Aa 阅读设置'" @click="settingsOpen = !settingsOpen">Aa</button>
          <button class="book-bar-btn" type="button" :aria-label="'目录'" @click="tocOpen = true"><ListTree :size="17" /></button>
          <button class="book-bar-btn" type="button" @click="emitClose"><MessagesSquare :size="17" /> 聊天室</button>
        </div>
      </header>

      <footer class="book-bar book-bottom" :class="{ 'bar-hidden': !chromeVisible }">
        <span class="book-progress-label">{{ progressLabel }}</span>
        <input type="range" min="0" max="1" step="0.001" :value="sliderValue" aria-label="阅读进度" @input="onSliderInput" />
      </footer>

      <div v-if="footnoteOpen" class="book-footnote-backdrop" @click.self="closeFootnote">
        <section class="book-footnote" role="dialog" aria-modal="true" aria-label="脚注">
          <header class="book-footnote-head">
            <strong>脚注</strong>
            <button class="book-bar-btn" type="button" aria-label="关闭脚注" @click="closeFootnote"><X :size="18" /></button>
          </header>
          <div v-if="footnoteError" class="book-footnote-error">{{ footnoteError }}</div>
          <div v-else-if="footnoteText" class="book-footnote-text">{{ footnoteText }}</div>
          <div v-else ref="footnoteHost" class="book-footnote-content"></div>
        </section>
      </div>

      <div v-if="settingsOpen" class="book-settings" data-book-settings>
        <div class="book-settings-row">
          <span>字号</span>
          <button class="book-bar-btn bordered" type="button" :aria-label="'缩小字号'" @click="stepFont(-10)"><Minus :size="14" /></button>
          <span class="book-font-pct">{{ style.fontPct }}%</span>
          <button class="book-bar-btn bordered" type="button" :aria-label="'放大字号'" @click="stepFont(10)"><Plus :size="14" /></button>
        </div>
        <div class="book-settings-row">
          <span>行距</span>
          <button class="book-bar-btn bordered" type="button" :aria-label="'减小行距'" @click="stepSpacing(-0.2)"><Minus :size="14" /></button>
          <span class="book-font-pct">{{ style.spacing.toFixed(1) }}</span>
          <button class="book-bar-btn bordered" type="button" :aria-label="'增大行距'" @click="stepSpacing(0.2)"><Plus :size="14" /></button>
        </div>
        <div class="book-settings-row">
          <span>边距</span>
          <button class="book-bar-btn bordered" type="button" :aria-label="'减小边距'" @click="stepMargin(-16)"><Minus :size="14" /></button>
          <span class="book-font-pct">{{ style.margin }}</span>
          <button class="book-bar-btn bordered" type="button" :aria-label="'增大边距'" @click="stepMargin(16)"><Plus :size="14" /></button>
        </div>
        <div class="book-settings-row" role="radiogroup" aria-label="主题">
          <span>主题</span>
          <button
            v-for="(theme, key) in READER_THEMES"
            :key="key"
            class="book-bar-btn bordered"
            :class="{ active: style.theme === key }"
            type="button"
            @click="setTheme(key)"
          >{{ theme.label }}</button>
        </div>
        <div class="book-settings-row" role="radiogroup" aria-label="版式">
          <span>版式</span>
          <button class="book-bar-btn bordered" :class="{ active: style.flow === 'paginated' }" type="button" @click="setFlow('paginated')">分页</button>
          <button class="book-bar-btn bordered" :class="{ active: style.flow === 'scrolled' }" type="button" @click="setFlow('scrolled')">滚动</button>
        </div>
      </div>

      <aside v-if="tocOpen" class="book-toc" data-book-toc>
        <header class="book-toc-head">目录</header>
        <div class="book-toc-list">
          <button
            v-for="(item, i) in tocItems"
            :key="i"
            class="book-toc-item"
            :data-depth="item.depth"
            type="button"
            @click="jumpTo(item.href)"
          >{{ item.label }}</button>
        </div>
      </aside>
      <div v-if="tocOpen" class="book-toc-dim" @click="tocOpen = false"></div>

      <div v-if="openingBook" class="book-loading"><LoaderCircle class="book-spin" :size="22" /> 正在打开…</div>
      <div v-else-if="readerError" class="book-loading error">
        <p>{{ readerError }}</p>
        <button class="book-btn" type="button" @click="activeBook && openBook(activeBook)">重试</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.book-workspace {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  flex-direction: column;
  background: #f4f1ea;
  color: #33302a;
}

/* ---------- 书架 ---------- */
.book-shelf { min-height: 0; flex: 1; display: flex; flex-direction: column; }
.book-topbar {
  min-height: calc(54px + var(--safe-top, 0px));
  padding: var(--safe-top, 0px) 14px 0;
  display: grid;
  grid-template-columns: minmax(84px, 1fr) auto minmax(84px, 1fr);
  align-items: center;
  border-bottom: 1px solid rgba(90, 72, 50, .14);
  background: rgba(250, 247, 240, .96);
}
.book-topbar-btn {
  justify-self: start;
  border: 0;
  background: transparent;
  color: #6d573d;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font: inherit;
  font-weight: 700;
  padding: 10px 0;
  cursor: pointer;
}
.book-topbar-title { font-size: 17px; font-weight: 800; }
.book-topbar-hint { justify-self: end; color: #97836a; font-size: 12px; }
.book-shelf-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: #8a765c;
  font-size: 14px;
}
.book-shelf-state.error { color: #a33; }
.book-shelf-sub { font-size: 12px; color: #a08c72; }
.book-download-error {
  margin: 12px max(16px, calc((100vw - 980px) / 2)) 0;
  padding: 9px 12px;
  border-radius: 9px;
  color: #9b2c2c;
  background: #fff0ed;
  font-size: 13px;
}
.book-shelf-grid {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
  gap: 22px 14px;
  padding: 22px max(16px, calc((100vw - 980px) / 2)) calc(36px + var(--safe-bottom, 0px));
  align-content: start;
}
.book-card { border: 0; background: none; padding: 0; text-align: left; cursor: pointer; font: inherit; color: inherit; }
.book-cover {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 2 / 3;
  border-radius: 8px;
  overflow: hidden;
  background: #ddd5c4;
  box-shadow: 0 2px 8px rgba(60, 44, 22, .16);
}
.book-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
.book-cover-fallback { display: grid; place-items: center; height: 100%; padding: 10px; font-size: 14px; color: #77644c; text-align: center; }
.book-download-badge {
  position: absolute;
  right: 8px;
  bottom: 8px;
  z-index: 2;
  width: 34px;
  height: 34px;
  border: 1px solid rgba(255, 255, 255, .76);
  border-radius: 50%;
  background: rgba(51, 45, 37, .84);
  color: #fff;
  box-shadow: 0 2px 8px rgba(36, 27, 16, .28);
  display: grid;
  place-items: center;
}
.book-download-badge.error { background: rgba(153, 45, 45, .9); }
.book-download-percent { font-size: 10px; font-weight: 800; font-variant-numeric: tabular-nums; }
.book-progress { position: absolute; left: 0; right: 0; bottom: 0; height: 4px; background: rgba(255, 255, 255, .45); }
.book-progress > i { display: block; height: 100%; background: #e0862a; }
.book-card-title { margin-top: 8px; font-size: 13.5px; font-weight: 700; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.book-card-author { display: block; margin-top: 2px; font-size: 11.5px; color: #97836a; }

/* ---------- 阅读器 ---------- */
.book-reader { position: absolute; inset: 0; display: flex; flex-direction: column; }
.book-reader[data-theme="light"] { background: #ffffff; color: #1c1c1e; }
.book-reader[data-theme="sepia"] { background: #f7f0e0; color: #3f3222; }
.book-reader[data-theme="dark"] { background: #161617; color: #e5e5ea; }
.book-stage { position: absolute; inset: 0; }
.book-stage :deep(foliate-view) { width: 100%; height: 100%; display: block; }
.book-stage :deep(.book-continuous-scroll) { position: absolute; inset: 0; overflow-y: auto; overscroll-behavior: contain; }
.book-stage :deep(.book-continuous-section) { width: 100%; min-height: 1px; }
.book-stage :deep(.book-continuous-frame) { display: block; width: 100%; min-height: 1px; border: 0; }
.book-page-zone {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 10;
  width: min(22vw, 220px);
  border: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
}
.book-page-zone.previous { left: 0; }
.book-page-zone.next { right: 0; }
/* 阅读器控制条与书架顶栏同一套暖纸视觉：同底色、同分隔线、同按钮字色 */
.book-bar {
  position: absolute;
  left: 0;
  right: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(250, 247, 240, .96);
  backdrop-filter: blur(14px);
  transition: transform .2s ease, opacity .2s ease;
}
.book-top { top: 0; padding: calc(8px + var(--safe-top, 0px)) 12px 8px; border-bottom: 1px solid rgba(90, 72, 50, .14); }
.book-bottom { bottom: 0; padding: 8px 12px calc(8px + var(--safe-bottom, 0px)); border-top: 1px solid rgba(90, 72, 50, .14); }
.book-reader[data-theme="dark"] .book-bar { background: rgba(38, 33, 28, .94); }
.book-reader[data-theme="dark"] .book-top { border-bottom-color: rgba(232, 221, 201, .16); }
.book-reader[data-theme="dark"] .book-bottom { border-top-color: rgba(232, 221, 201, .16); }
.book-bar.bar-hidden { opacity: 0; pointer-events: none; }
.book-top.bar-hidden { transform: translateY(-100%); }
.book-bottom.bar-hidden { transform: translateY(100%); }
.book-bar-btn {
  border: 0;
  background: none;
  color: #6d573d;
  font: inherit;
  font-size: 15px;
  font-weight: 700;
  padding: 6px 8px;
  border-radius: 8px;
  cursor: pointer;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.book-reader[data-theme="dark"] .book-bar-btn { color: #d9cbb6; }
.book-bar-btn.bordered { border: 1px solid rgba(90, 72, 50, .25); font-weight: 400; }
.book-reader[data-theme="dark"] .book-bar-btn.bordered { border-color: rgba(232, 221, 201, .22); }
.book-bar-btn.active { background: #6d573d; color: #fff; border-color: transparent; }
.book-reader[data-theme="dark"] .book-bar-btn.active { background: #e8ddc9; color: #26211c; }
.book-reader-title { flex: 1; min-width: 0; text-align: center; }
.book-reader-title strong { display: block; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.book-reader-title small { display: block; font-size: 11.5px; color: #97836a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.book-reader[data-theme="dark"] .book-reader-title small { color: #a89a86; }
.book-bar-group { display: flex; align-items: center; gap: 4px; }
.book-progress-label { font-size: 12px; color: #97836a; width: 42px; text-align: right; font-variant-numeric: tabular-nums; }
.book-reader[data-theme="dark"] .book-progress-label { color: #a89a86; }
.book-bottom input { flex: 1; }

.book-footnote-backdrop {
  position: absolute;
  inset: 0;
  z-index: 55;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 20px 14px calc(20px + var(--safe-bottom, 0px));
  background: rgba(0, 0, 0, .26);
}
.book-footnote {
  width: min(560px, 100%);
  max-height: min(62vh, 520px);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(90, 72, 50, .14);
  border-radius: 16px;
  background: #faf7f0;
  color: #2f2922;
  box-shadow: 0 18px 54px rgba(0, 0, 0, .24);
}
.book-reader[data-theme="dark"] .book-footnote { background: #26211c; color: #e8ddc9; border-color: rgba(232, 221, 201, .16); }
.book-footnote-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 10px 8px 16px; border-bottom: 1px solid rgba(90, 72, 50, .12); }
.book-reader[data-theme="dark"] .book-footnote-head { border-bottom-color: rgba(232, 221, 201, .14); }
.book-footnote-content { min-height: 110px; height: min(40vh, 360px); }
.book-footnote-content :deep(foliate-view) { display: block; width: 100%; height: 100%; }
.book-footnote-text { overflow-y: auto; padding: 18px; line-height: 1.65; white-space: pre-wrap; }
.book-footnote-error { padding: 24px 18px; color: #a33; text-align: center; }

.book-settings {
  position: absolute;
  right: 12px;
  top: calc(54px + var(--safe-top, 0px));
  z-index: 40;
  background: rgba(250, 247, 240, .97);
  backdrop-filter: blur(14px);
  border-radius: 12px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, .16);
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 232px;
}
.book-reader[data-theme="dark"] .book-settings { background: rgba(38, 33, 28, .97); }
.book-settings-row { display: flex; align-items: center; gap: 8px; font-size: 14px; }
.book-settings-row > span:first-child { width: 34px; color: #97836a; }
.book-reader[data-theme="dark"] .book-settings-row > span:first-child { color: #a89a86; }
.book-font-pct { flex: 1; text-align: center; font-variant-numeric: tabular-nums; }

.book-toc {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 50;
  width: min(320px, 86vw);
  background: #fff;
  box-shadow: -4px 0 24px rgba(0, 0, 0, .14);
  display: flex;
  flex-direction: column;
}
.book-reader[data-theme="dark"] .book-toc { background: #26211c; color: #e8ddc9; }
.book-toc-head { padding: calc(16px + var(--safe-top, 0px)) 16px 10px; font-weight: 800; font-size: 16px; border-bottom: 1px solid rgba(0, 0, 0, .07); }
.book-toc-list { overflow-y: auto; padding: 6px 0 calc(20px + var(--safe-bottom, 0px)); }
.book-toc-item {
  display: block;
  width: 100%;
  text-align: left;
  border: 0;
  background: none;
  padding: 9px 16px;
  font: inherit;
  font-size: 14px;
  color: inherit;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.book-toc-item[data-depth="1"] { padding-left: 32px; }
.book-toc-item[data-depth="2"] { padding-left: 48px; }
.book-toc-dim { position: absolute; inset: 0; z-index: 45; background: rgba(0, 0, 0, .25); }

.book-loading {
  position: absolute;
  inset: 0;
  z-index: 60;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: inherit;
  color: #8a8a8e;
  font-size: 14px;
}
.book-loading.error { color: #a33; }
.book-btn { border: 1px solid rgba(0, 0, 0, .14); border-radius: 8px; background: #fff; color: #2f7de1; padding: 8px 18px; font: inherit; cursor: pointer; }
.book-spin { animation: book-reader-spin 1s linear infinite; }
@keyframes book-reader-spin { to { transform: rotate(360deg); } }

@media (min-width: 900px) {
  .book-shelf-grid { grid-template-columns: repeat(auto-fill, minmax(146px, 1fr)); }
}
</style>
