<script setup lang="ts">
import "../stories/stories.css";
import "./bookNotes.css";
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from "vue";
import { BookOpen, NotebookPen, Send, Sparkles, X } from "lucide-vue-next";
import { BOOK_QUOTE_MAX, legacyBookNote, type BookNoteDTO, type BookNoteSharePayload } from "@shared/bookNotes";
import { bookLocatorSchema } from "@shared/bookLocator";
import AppModal from "../../components/ui/AppModal.vue";
import ConfirmDialog from "../../components/ui/ConfirmDialog.vue";
import { useChatStore } from "../../store";
import { useMessageSender } from "../../messageSending";
import { bookNotesClient } from "./bookNotesClient";
import { bookExcerptImage, bookReadingUrl, bookShareContent, type BookLocation, type BookReadingContext } from "./bookReading";
import { escapeHtmlText } from "../messages/messageRendering";
import BookNoteEditor from "./BookNoteEditor.vue";
import BookNoteContent from "./BookNoteContent.vue";
import NotesTransfer from "../notes/NotesTransfer.vue";

const props = defineProps<{ selection: BookReadingContext | null; activeChannelId: number | null }>();
const emit = defineEmits<{ clear: []; jump: [location: BookLocation]; 'notes-changed': [bookId: number] }>();
const store = useChatStore();
const available = computed(() => !!store.account && !store.account.isGuest);
const StoryComposer = defineAsyncComponent(() => import("../stories/StoryComposer.vue"));
const channels = computed(() => store.channels.filter((channel) => (channel.kind === "standard" || channel.kind === "direct") && channel.canWrite !== false));
const { send, pending: shareBusy } = useMessageSender({ getSocket: () => store.socket });
const shareContext = ref<BookReadingContext | null>(null);
const shareChannelId = ref<number | null>(null);
const shareError = ref("");
const shareComment = ref("");
const notice = ref("");
let shareRequestId = "";
watch([shareChannelId, shareComment], () => { shareRequestId = crypto.randomUUID(); });
const editor = ref<InstanceType<typeof BookNoteEditor> | null>(null);
const noteBusy = ref(false);
const noteEditorOpen = ref(false);
const sharedNote = ref<BookNoteDTO | null>(null);
const libraryContext = ref<BookReadingContext | null>(null);
const notes = ref<BookNoteDTO[]>([]);
const notesBusy = ref(false);
const notesError = ref("");
let notesSequence = 0;
const deleteNote = ref<BookNoteDTO | null>(null);
const storyImage = ref<File | null>(null);
const storyContext = ref<BookReadingContext | null>(null);
const storyBusy = ref(false);
const selectionTooLong = computed(() => (props.selection?.quote.length || 0) > BOOK_QUOTE_MAX);

function share(context: BookReadingContext, note?: BookNoteDTO) {
  if (!available.value) return;
  shareComment.value = "";
  sharedNote.value = note ?? null;
  shareContext.value = { ...context };
  shareChannelId.value = channels.value.find((channel) => channel.id === props.activeChannelId)?.id ?? channels.value[0]?.id ?? null;
  shareRequestId = crypto.randomUUID(); shareError.value = ""; notice.value = "";
}
async function sendShare() {
  const context = shareContext.value, channelId = shareChannelId.value;
  if (!context || !channelId || shareBusy.value) return;
  if (!channels.value.some((channel) => channel.id === channelId)) { shareError.value = "当前聊天室不可发送，请重新选择"; return; }
  const precise = bookLocatorSchema.safeParse(context.locator);
  const noteContent = escapeHtmlText(shareComment.value.trim() || `阅读笔记 · 《${context.title}》`) + (precise.success ? `<br><a href="${escapeHtmlText(bookReadingUrl({ bookId: context.bookId, fraction: context.fraction, locator: precise.data }, window.location.origin))}">打开书中的位置</a>` : "");
  const result = await send({ channelId, type: "text", content: sharedNote.value ? noteContent : bookShareContent(context, window.location.origin, shareComment.value), ...(sharedNote.value ? { payload: { kind: "book_note", note: legacyBookNote(sharedNote.value) } satisfies BookNoteSharePayload } : {}), replyToId: null, clientRequestId: shareRequestId });
  if (!result.ok) { shareError.value = result.message; return; }
  if (sharedNote.value) notice.value = "笔记已分享到聊天室";
  shareContext.value = null; sharedNote.value = null;
  emit('clear');
}
function edit(context: BookReadingContext, existing?: BookNoteDTO) { editor.value?.edit(context, existing); }
function notesSaved(bookId: number) {
  emit('clear'); emit('notes-changed', bookId);
  if (libraryContext.value) void loadNotes(libraryContext.value);
}
function shareNote(note: BookNoteDTO) { share(noteContext(note), note); }
async function loadNotes(context: BookReadingContext) {
  if (!available.value) return;
  const request = ++notesSequence, accountId = store.account?.id;
  const current = () => request === notesSequence && libraryContext.value?.bookId === context.bookId && store.account?.id === accountId;
  libraryContext.value = context; notesBusy.value = true; notesError.value = ""; notes.value = [];
  try {
    const result = await bookNotesClient.list(context.bookId);
    if (current()) notes.value = result.notes;
  } catch (error) { if (current()) notesError.value = error instanceof Error ? error.message : "笔记读取失败"; }
  finally { if (current()) notesBusy.value = false; }
}
function closeLibrary() {
  notesSequence++;
  libraryContext.value = null;
  notes.value = []; notesError.value = ""; notesBusy.value = false;
}
watch(() => store.account?.id, () => { closeLibrary(); shareContext.value = null; sharedNote.value = null; });
onBeforeUnmount(() => { notesSequence++; });
function noteContext(note: BookNoteDTO): BookReadingContext {
  return { bookId: note.bookId, title: note.bookTitle, chapter: note.chapter, fraction: note.fraction, quote: note.quote, ...(note.locator ? { locator: note.locator } : {}) };
}
async function removeNote() {
  const note = deleteNote.value;
  if (!note || noteBusy.value) return;
  noteBusy.value = true;
  try { await bookNotesClient.remove(note.bookId, note.id); notes.value = notes.value.filter((item) => item.id !== note.id); deleteNote.value = null; emit('notes-changed', note.bookId); }
  catch (error) { notesError.value = error instanceof Error ? error.message : "笔记删除失败"; deleteNote.value = null; }
  finally { noteBusy.value = false; }
}
function notesImported() {
  if (libraryContext.value) {
    emit('notes-changed', libraryContext.value.bookId);
    void loadNotes(libraryContext.value);
  }
}
async function shareStory(context: BookReadingContext) {
  if (storyBusy.value) return;
  storyBusy.value = true; notice.value = "";
  try { storyImage.value = await bookExcerptImage(context); storyContext.value = { ...context }; }
  catch (error) { notice.value = error instanceof Error ? error.message : "摘录卡片生成失败"; }
  finally { storyBusy.value = false; }
}
defineExpose({ share, showNotes: loadNotes, openNote: (note: BookNoteDTO) => edit(noteContext(note), note) });
</script>

<template>
  <aside v-if="selection && available" class="book-selection-actions" aria-label="摘录操作" @pointerdown.prevent>
    <span>{{ selectionTooLong ? `请选择 ${BOOK_QUOTE_MAX} 字以内的文字` : `已选 ${selection.quote.length} 字` }}</span>
    <button type="button" :disabled="selectionTooLong" @click="edit(selection)"><NotebookPen :size="16" />做笔记</button>
    <button type="button" :disabled="selectionTooLong" @click="share(selection)"><Send :size="16" />聊天室</button>
    <button type="button" :disabled="selectionTooLong || storyBusy" @click="shareStory(selection)"><Sparkles :size="16" />我的故事</button>
    <button type="button" aria-label="取消选择" @click="emit('clear')"><X :size="16" /></button>
  </aside>
  <div v-if="notice" class="book-action-notice" role="status">{{ notice }}<button aria-label="关闭提示" @click="notice = ''"><X :size="14" /></button></div>
  <AppModal :open="!!libraryContext" title="我的阅读笔记" content-class="book-action-dialog" @close="closeLibrary">
    <NotesTransfer v-if="available && store.account" domain="books" :account-id="store.account.id" @imported="notesImported" />
    <p v-if="notesBusy" role="status">正在读取笔记…</p>
    <p v-else-if="notesError" role="alert">{{ notesError }} <button v-if="libraryContext" @click="loadNotes(libraryContext)">重试</button></p>
    <p v-else-if="!notes.length">还没有笔记。长按或拖动选择正文，再点“做笔记”。</p>
    <article v-for="note in notes" :key="note.id" class="book-note-entry">
      <small>{{ note.draft ? "草稿 · " : "" }}{{ note.chapter }} · {{ Math.round(note.fraction * 100) }}%</small><blockquote>{{ note.quote }}</blockquote><BookNoteContent :note="note" :active="!shareContext && !noteEditorOpen && !deleteNote" />
      <footer>
        <button @click="emit('jump', note); closeLibrary()"><BookOpen :size="15" />回到原文</button>
        <button @click="edit(noteContext(note), note)">编辑</button>
        <button @click="shareNote(note)"><Send :size="15" />聊天室</button>
        <button :disabled="storyBusy" @click="shareStory(noteContext(note))">我的故事</button>
        <button @click="deleteNote = note">删除</button>
      </footer>
    </article>
  </AppModal>
  <AppModal :open="!!shareContext" :title="sharedNote ? '分享笔记到聊天室' : shareContext?.quote ? '分享阅读摘录' : '邀请大家一起读'" :busy="shareBusy" content-class="book-action-dialog book-share-dialog" @close="shareContext = null">
    <template v-if="shareContext">
      <p><strong>《{{ shareContext.title }}》</strong></p>
      <small>{{ shareContext.chapter }} · {{ Math.round(shareContext.fraction * 100) }}%</small>
      <blockquote v-if="shareContext.quote">{{ shareContext.quote }}</blockquote>
      <BookNoteContent v-if="sharedNote" :note="sharedNote" />
      <p v-if="sharedNote">将发送当前笔记的副本，包含文字和手写内容。</p>
      <p v-else>大家点击消息中的链接，就能打开这本书的阅读位置。</p>
      <label>分享感言（选填）<textarea v-model="shareComment" aria-label="分享感言（选填）" rows="3" maxlength="500" :disabled="shareBusy" placeholder="说说你为什么想分享…"></textarea><small>感言将单独显示在卡片上方 · {{ shareComment.length }}/500</small></label>
      <label>发送到聊天室<select v-model="shareChannelId" :disabled="shareBusy"><option v-for="channel in channels" :key="channel.id" :value="channel.id">{{ channel.name }}</option></select></label>
      <p v-if="!channels.length">没有可以发送的聊天室</p>
      <p v-if="shareError" role="alert">{{ shareError }}</p>
      <footer><button :disabled="shareBusy || !shareChannelId" @click="sendShare">{{ shareBusy ? '发送中…' : '发送到聊天室' }}</button></footer>
    </template>
  </AppModal>
  <BookNoteEditor ref="editor" @open="noteEditorOpen = $event" @saved="notesSaved" @share="shareNote" />
  <ConfirmDialog :open="!!deleteNote" title="删除这条阅读笔记？" message="删除后无法恢复。" :busy="noteBusy" confirm-text="删除" @close="deleteNote = null" @confirm="removeNote" />
  <StoryComposer v-if="storyImage && storyContext" :initial-image="storyImage" :initial-text="`读《${storyContext.title}》有感${storyContext.chapter ? '\n' + storyContext.chapter : ''}`" @close="storyImage = null; storyContext = null" @published="storyImage = null; storyContext = null; notice = '摘录已发布到我的故事'" />
</template>

<style scoped>
.book-selection-actions { position: absolute; z-index: 35; bottom: calc(64px + env(safe-area-inset-bottom, 0px)); left: 50%; transform: translateX(-50%); width: min(460px, calc(100% - 24px)); display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)) auto; justify-content: center; align-items: center; gap: 6px; padding: 8px; background: #493b2e; color: #fff7e8; border: 1px solid #7b6248; border-radius: 12px; box-shadow: 0 5px 24px #0005; }
.book-selection-actions span { grid-column: 1 / -1; font-size: 12px; }
.book-selection-actions button, .book-action-notice button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-height: 36px; border: 1px solid #d8c6a9; border-radius: 7px; padding: 6px 10px; color: #604b32; background: #f7efdf; font: inherit; cursor: pointer; }
.book-selection-actions button { font-size: 14px; padding: 6px; background: #6b543e; border-color: #a68b6a; color: #fff7e8; }
button:disabled { opacity: .5; cursor: default; }
.book-note-entry { padding: 16px 0; border-bottom: 1px solid #d8c6a9; }
.book-action-notice { position: absolute; z-index: 40; top: calc(64px + env(safe-area-inset-top, 0px)); left: 50%; transform: translateX(-50%); width: max-content; max-width: calc(100% - 32px); padding: 8px 12px; border-radius: 10px; background: #fffaf0; color: #604b32; box-shadow: 0 4px 20px #0002; }
.book-action-notice button { min-height: 28px; padding: 4px; margin-left: 8px; }
</style>
