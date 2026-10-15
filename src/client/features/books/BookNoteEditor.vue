<script setup lang="ts">
import "./bookNotes.css";
import { defineAsyncComponent, ref, shallowRef, watch } from "vue";
import { Brush, Send, Trash2, X } from "lucide-vue-next";
import { BOOK_NOTE_TEXT_MAX, type BookNoteDTO } from "@shared/bookNotes";
import { HANDWRITING_DEFAULT_GLOBAL_SETTINGS, HANDWRITING_DEFAULT_PREFERENCES, type HandwritingPayload } from "@shared/handwriting";
import AppModal from "../../components/ui/AppModal.vue";
import { useChatStore } from "../../store";
import { useHandwritingPreferences } from "../handwriting/handwritingPreferences";
import type { HandwritingComposerSnapshot } from "../handwriting/useHandwritingComposer";
import { useBookNoteEditor } from "./useBookNoteEditor";
import BookNoteContent from "./BookNoteContent.vue";
const emit = defineEmits<{ saved: [bookId: number]; share: [note: BookNoteDTO]; open: [value: boolean] }>();
const store = useChatStore();
const editor = useBookNoteEditor({ accountId: () => store.account?.id, changed: (bookId) => emit("saved", bookId) });
const { context, text, handwriting, busy, error, hasContent } = editor;
const HandwritingComposer = defineAsyncComponent(() => import("../handwriting/HandwritingComposer.vue"));
const { save: savePreferences, error: preferencesError } = useHandwritingPreferences(store);
const handwritingOpen = ref(false);
const draftState = shallowRef<HandwritingComposerSnapshot>({ key: "", payload: null, revision: 0 });
let inkContext: typeof context.value = null;
let inkAccountId: number | undefined;
function openHandwriting() {
  inkContext = context.value; inkAccountId = store.account?.id;
  draftState.value = { key: crypto.randomUUID(), payload: handwriting.value, revision: 0 };
  handwritingOpen.value = true;
}
function changeInk(payload: HandwritingPayload | null) {
  if (context.value && context.value === inkContext && store.account?.id === inkAccountId) handwriting.value = payload;
}
function finishInk(payload: HandwritingPayload) { changeInk(payload); handwritingOpen.value = false; }
async function share() { const note = await editor.save(false); if (note) emit("share", note); }
watch(context, (value) => { emit("open", !!value); if (!value) handwritingOpen.value = false; });
defineExpose({ edit: editor.edit });
</script>
<template>
  <AppModal :open="!!context" aria-label="阅读笔记" :busy="busy || handwritingOpen" content-class="book-action-dialog book-note-editor" @close="editor.close">
    <template v-if="context">
      <div class="book-note-heading">
        <p>《{{ context.title }}》<span v-if="context.chapter"> · {{ context.chapter }}</span></p>
        <button type="button" aria-label="关闭" :disabled="busy" @click="editor.close"><X :size="20" /></button>
      </div>
      <blockquote>{{ context.quote }}</blockquote>
      <label>笔记内容<textarea v-model="text" :maxlength="BOOK_NOTE_TEXT_MAX" :disabled="busy" rows="6" placeholder="记下此刻的想法…" /></label>
      <BookNoteContent :note="{ text: '', handwriting }" :active="!handwritingOpen" />
      <p v-if="error" role="alert">{{ error }}</p>
      <footer>
        <button type="button" :disabled="busy || !hasContent" @click="editor.save(false)">{{ busy ? '保存中…' : '保存笔记' }}</button>
        <button type="button" aria-label="手写笔记" title="手写笔记" :disabled="busy" @click="openHandwriting"><Brush :size="19" /></button>
        <button v-if="handwriting" type="button" aria-label="清除手写内容" title="清除手写内容" :disabled="busy" @click="handwriting = null"><Trash2 :size="18" /></button>
        <button class="book-note-share" type="button" aria-label="分享笔记到聊天室" title="分享笔记到聊天室" :disabled="busy || !hasContent" @click="share"><Send :size="19" /></button>
      </footer>
      <small>关闭时自动保存草稿；分享后所选聊天室的成员可以查看。</small>
    </template>
  </AppModal>
  <HandwritingComposer v-if="draftState.key" :open="handwritingOpen" :account-id="store.account?.id || 0" :draft-state="draftState" :busy="busy"
    status="手写内容将保存在这条笔记中" submit-label="完成" :socket-ready="!!store.account"
    :preferences="store.account?.handwritingPreferences || HANDWRITING_DEFAULT_PREFERENCES" :preferences-error="preferencesError"
    :global-settings="store.appearance.handwritingSettings || HANDWRITING_DEFAULT_GLOBAL_SETTINGS" :is-admin="store.account?.isAdmin || false"
    @draft-change="changeInk" @preferences-change="savePreferences" @close="handwritingOpen = false" @submit="finishInk" />
</template>
<style scoped>
.book-note-heading { position: sticky; top: -20px; z-index: 2; display: flex; align-items: flex-start; gap: 12px; background: #dfceb0; padding: 4px 0 12px; }
.book-note-heading p { margin: 6px 0; flex: 1; min-width: 0; overflow-wrap: anywhere; line-height: 1.6; }
.book-note-heading button { flex-shrink: 0; }
.book-note-share { margin-left: auto; }
small { display: block; margin-top: 14px; line-height: 1.7; }
</style>
