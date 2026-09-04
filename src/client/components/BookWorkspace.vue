<script setup lang="ts">
// 图书室负一屏：书架 + EPUB 阅读器。
// 懒加载编排：本组件由 App.vue defineAsyncComponent 分包，进入聊天室不下载；
// 打开书架先渲染书单（小 JSON），并行动态 import foliate-js；
// 用户点开某本书才通过 HTTP Range 流式下载该本（只拉取读到的章节）。
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { ListTree, LoaderCircle, MessagesSquare, Minus, Plus, X } from "lucide-vue-next";
import type { BookDTO } from "@shared/types";
import { api, getToken } from "../api";
import {
  buildBookCSS,
  bookCoverUrl,
  bookFileUrl,
  createEpubBook,
  createStreamingLoader,
  DEFAULT_READER_STYLE,
  globalFraction,
  nudgeFromSectionBoundaries,
  READER_THEMES,
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

const books = ref<BookDTO[]>([]);
const shelfLoading = ref(true);
const shelfError = ref("");

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
const coverUrls = new Map<number, string>();

let foliatePromise: Promise<FoliateModule> | null = null;
let view: FoliateView | null = null;
let relocateHandler: ((event: Event) => void) | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSavedFraction = -1;

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
  } catch (error) {
    shelfError.value = error instanceof Error ? error.message : "书架加载失败";
  } finally {
    shelfLoading.value = false;
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
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  flushProgress();
  if (view && relocateHandler) view.removeEventListener("relocate", relocateHandler);
  relocateHandler = null;
  view?.remove();
  view = null;
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
    const module = await (foliatePromise ??= import("foliate-js/view.js"));
    await module; // 确保自定义元素已注册
    closeBookView();

    const stage = bookStage.value;
    if (!stage) throw new Error("阅读器容器不可用");
    const element = document.createElement("foliate-view") as unknown as FoliateView;
    stage.append(element as unknown as Node);
    view = element;

    // 流式打开：只下载中央目录 + 读到的章节，弱网下首屏更快
    const loader = await createStreamingLoader(bookFileUrl(book.id));
    const bookObject = await createEpubBook(loader);
    await element.open(bookObject);

    element.book?.transformTarget?.addEventListener("data", (event) => {
      const detail = (event as CustomEvent<{ data: Promise<unknown> }>).detail;
      detail.data = Promise.resolve(detail.data).catch(() => "");
    });

    element.renderer.setAttribute("flow", style.value.flow);
    element.renderer.setAttribute("margin", String(style.value.margin));
    element.renderer.setStyles?.(buildBookCSS(style.value));

    const restoreTarget = nudgeFromSectionBoundaries(element.getSectionFractions(), cachedProgress(book));
    relocateHandler = (event) => onRelocate(event as CustomEvent<{ index: number; fraction: number; range: Range }>);
    element.addEventListener("relocate", relocateHandler);
    element.addEventListener("load", onViewLoad);

    const metadata = element.book?.metadata ?? {};
    activeBookTitle.value = formatLang(metadata.title) || book.title;
    renderTOC(element.book?.toc ?? []);
    applyStyle();

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
    chromeVisible.value = true;
    settingsOpen.value = false;
    tocOpen.value = false;
    readerOpen.value = true;
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

function renderTOC(toc: RawTocItem[]) {
  const items: { label: string; href: string; depth: number }[] = [];
  const walk = (list: unknown[], depth: number) => {
    for (const raw of list ?? []) {
      const item = raw as RawTocItem;
      items.push({ label: item.label ?? "（无题）", href: item.href ?? "", depth });
      walk(item.subitems ?? [], depth + 1);
    }
  };
  walk(toc, 0);
  tocItems.value = items;
}

function jumpTo(href: string) {
  tocOpen.value = false;
  void (view as unknown as { goTo(target: string): Promise<void> })?.goTo?.(href);
}

function onRelocate(event: CustomEvent<{ index: number; fraction: number; range: Range }>) {
  if (!view) return;
  const { index, fraction, range } = event.detail;
  const starts = view.getSectionFractions();
  const global = globalFraction(starts, index, fraction);
  sliderValue.value = global;
  progressLabel.value = `${Math.round(global * 100)}%`;
  try {
    const { tocItem } = (view as unknown as {
      getProgressOf(index: number, range: Range): { tocItem?: { label?: string; href?: string } | null } | null;
    }).getProgressOf(index, range) ?? {};
    chapterLabel.value = tocItem?.label ?? "";
  } catch { /* 章节定位失败不阻塞阅读 */ }
  scheduleSave(global);
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

function applyStyle() {
  persistStyle();
  if (!view) return;
  view.renderer.setStyles?.(buildBookCSS(style.value));
}

function setTheme(theme: ReaderStyle["theme"]) {
  style.value = { ...style.value, theme };
  applyStyle();
}

function setFlow(flow: ReaderStyle["flow"]) {
  style.value = { ...style.value, flow };
  view?.renderer.setAttribute("flow", flow);
  persistStyle();
  // 滚动版式进入沉浸阅读：自动隐藏控制栏（之后向下滚动隐藏、向上滚动或点按中部显示）；
  // 切回分页则恢复显示，保持可发现性
  if (flow === "scrolled") {
    chromeVisible.value = false;
    settingsOpen.value = false;
  } else {
    chromeVisible.value = true;
  }
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
  // margin 是 foliate 分页器属性（不是注入 CSS），改动会触发其重排
  view?.renderer.setAttribute("margin", String(margin));
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
  if (isLinkClick(event)) return;
  if (hasTextSelection(doc)) return; // 选中文字后不翻页
  const width = doc.defaultView?.innerWidth ?? 1;
  const ratio = event.clientX / width;
  if (style.value.flow === "paginated") {
    if (ratio < 0.3) pageBy(-1);
    else if (ratio > 0.7) pageBy(1);
    else toggleChrome();
  } else {
    toggleChrome();
  }
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

let pageWheelAccum = 0;
let pageWheelLockUntil = 0;
let docTouchY: number | null = null;

function onDocTouchStart(event: TouchEvent) {
  docTouchY = event.touches[0]?.clientY ?? null;
}

// 滚动版式的触摸跨节；分页的滑动手势由 foliate 分页器自带处理（带速度吸附）
function onDocTouchMove(event: TouchEvent) {
  if (!view || style.value.flow !== "scrolled" || docTouchY == null) return;
  const renderer = view.renderer;
  const y = event.touches[0]?.clientY ?? docTouchY;
  const dy = docTouchY - y;
  docTouchY = y;
  if (dy > 8 && chromeVisible.value) {
    chromeVisible.value = false;
    settingsOpen.value = false;
  } else if (dy < -8 && !chromeVisible.value) {
    chromeVisible.value = true;
  }
  const nearBottom = renderer.viewSize - renderer.end <= 8;
  const nearTop = renderer.start <= 8;
  if (dy > 8 && nearBottom) chainScrolledSection(event, 1);
  else if (dy < -8 && nearTop) chainScrolledSection(event, -1);
}

// iframe 之外的页边留白区：点按/滚轮同样生效（iframe 内事件不会冒泡到这里，两套监听互不重复）
function onStageZoneClick(event: MouseEvent) {
  if (!view || openingBook.value) return;
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const ratio = (event.clientX - rect.left) / rect.width;
  if (style.value.flow === "paginated") {
    if (ratio < 0.3) pageBy(-1);
    else if (ratio > 0.7) pageBy(1);
    else toggleChrome();
  } else {
    toggleChrome();
  }
}

function onViewLoad(event: Event) {
  const doc = (event as CustomEvent<{ doc?: Document }>).detail?.doc;
  if (!doc) return;
  doc.addEventListener("click", (e) => onDocClick(doc, e));
  doc.addEventListener("wheel", onDocWheel, { passive: false });
  doc.addEventListener("touchstart", onDocTouchStart, { passive: true });
  doc.addEventListener("touchmove", onDocTouchMove, { passive: false });
}

function onSliderInput(event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  void view?.goToFraction(value);
}

function onKeydown(event: KeyboardEvent) {
  if (!readerOpen.value) return;
  const target = view as unknown as { goLeft?(): void; goRight?(): void };
  if (event.key === "ArrowLeft") target.goLeft?.();
  else if (event.key === "ArrowRight") target.goRight?.();
  else if (event.key === "Escape") {
    if (tocOpen.value) tocOpen.value = false;
    else backToShelf();
  }
}

watch(readerOpen, (open) => {
  if (open) document.addEventListener("keydown", onKeydown);
  else document.removeEventListener("keydown", onKeydown);
});

void loadShelf();
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
      <div v-else class="book-shelf-grid">
        <button v-for="book in sortedBooks" :key="book.id" class="book-card" type="button" @click="openBook(book)">
          <span class="book-cover">
            <img v-if="book.coverName" :src="coverUrl(book)" alt="" loading="lazy" />
            <span v-else class="book-cover-fallback">{{ book.title }}</span>
            <span v-if="cachedProgress(book) > 0.005" class="book-progress"><i :style="{ width: `${Math.round(cachedProgress(book) * 100)}%` }" /></span>
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
