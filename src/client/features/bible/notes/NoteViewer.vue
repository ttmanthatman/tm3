<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { BookOpen, MoreHorizontal, Send, Share2 } from "lucide-vue-next";
import type { BibleNoteDTO } from "@shared/bibleNotes";
import { useChatStore } from "../../../store";
import AppModal from "../../../components/ui/AppModal.vue";
import { openCopyworkSource } from "../copywork/copyworkViewerState";
import { noteApi } from "./noteApi";
import NoteManager from "./NoteManager.vue";
import { bibleNotesChanged } from "./noteViewerState";
const props = defineProps<{ id: string }>();
const emit = defineEmits<{ close: []; chat: [] }>();
const store = useChatStore();
const note = ref<BibleNoteDTO | null>(null);
const noteBusy = ref(false);
const error = ref("");
const toolsOpen = ref(false);
const shareOpen = ref(false);
const deleteOpen = ref(false);
const channelId = ref<number | null>(null);
const sharedChannel = ref<number | null>(null);
const manager = ref<InstanceType<typeof NoteManager> | null>(null);
const own = computed(() => note.value?.accountId === store.account?.id);
const channels = computed(() => store.channels.filter((channel) => (channel.kind === "standard" || channel.kind === "direct") && channel.canWrite !== false));
let shareRequestId = "";
let shareTarget: number | null = null;
let sequence = 0;
let alive = true;
async function load() {
  const request = ++sequence;
  noteBusy.value = true;
  error.value = "";
  try {
    const response = await noteApi.get(props.id);
    if (request === sequence && alive) note.value = response.note;
  } catch (cause) {
    if (request === sequence && alive) { note.value = null; error.value = cause instanceof Error ? cause.message : "笔记加载失败"; }
  } finally { if (request === sequence && alive) noteBusy.value = false; }
}
function refresh() { void load(); }
async function publication() {
  if (!note.value || !own.value || noteBusy.value) return;
  noteBusy.value = true;
  error.value = "";
  try {
    note.value = (await noteApi.update(props.id, { public: !note.value.publishedAt })).note;
    toolsOpen.value = false;
    bibleNotesChanged();
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "公开状态保存失败"; }
  finally { noteBusy.value = false; }
}
function openShare() {
  toolsOpen.value = false;
  sharedChannel.value = null;
  channelId.value = channels.value.find((channel) => channel.id === store.currentChannelId)?.id || channels.value[0]?.id || null;
  shareOpen.value = true;
}
async function share() {
  if (!channelId.value || noteBusy.value) return;
  if (shareTarget !== channelId.value || !shareRequestId) { shareTarget = channelId.value; shareRequestId = crypto.randomUUID(); }
  const target = channelId.value;
  noteBusy.value = true;
  error.value = "";
  try {
    await noteApi.share(props.id, target, shareRequestId);
    sharedChannel.value = target;
    shareRequestId = "";
    shareOpen.value = false;
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "分享失败，请重试"; }
  finally { noteBusy.value = false; }
}
async function goToChat() {
  if (!sharedChannel.value || noteBusy.value) return;
  noteBusy.value = true;
  try { await store.switchChannel(sharedChannel.value); emit("chat"); emit("close"); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : "聊天室打开失败"; }
  finally { noteBusy.value = false; }
}
async function openSource() {
  if (!note.value) return;
  try { await openCopyworkSource(note.value.source); emit("close"); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : "经文打开失败"; }
}
async function remove() {
  if (!own.value || noteBusy.value) return;
  noteBusy.value = true;
  error.value = "";
  try { await noteApi.remove(props.id); bibleNotesChanged(); emit("close"); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : "删除失败"; }
  finally { noteBusy.value = false; }
}
function edit() {
  if (!note.value || noteBusy.value) return;
  toolsOpen.value = false;
  manager.value?.edit(note.value);
}
onMounted(() => { refresh(); window.addEventListener("bible-notes-changed", refresh); });
onBeforeUnmount(() => { alive = false; sequence++; window.removeEventListener("bible-notes-changed", refresh); });
</script>
<template>
  <Teleport to="body">
    <AppModal class="note-viewer-shell" :open="true" aria-label="经文笔记便签" size="medium" :busy="noteBusy" content-class="bible-note-sheet" @close="emit('close')">
      <template #header>
        <button v-if="note" class="note-reference" :aria-label="`在圣经中阅读：${note.source.reference}`" @click="openSource"><BookOpen :size="16" />{{ note.source.reference }}</button>
        <span v-else>经文笔记</span>
        <button v-if="note && own" class="note-tools" aria-label="更多笔记操作" :aria-expanded="toolsOpen" :disabled="noteBusy" @click="toolsOpen = !toolsOpen"><MoreHorizontal :size="20" /></button>
      </template>
      <div class="note-sheet-body">
        <div v-if="toolsOpen && note" class="note-menu" aria-label="笔记操作">
          <button v-if="own" :disabled="noteBusy" @click="publication"><Share2 :size="16" />{{ note.publishedAt ? '取消公开' : '分享到圣经' }}</button>
          <button :disabled="noteBusy || !channels.length" @click="openShare"><Send :size="16" />分享到聊天室</button>
          <button v-if="own" :disabled="noteBusy" @click="edit">编辑笔记</button>
          <button v-if="own" :disabled="noteBusy" @click="toolsOpen = false; deleteOpen = true">删除笔记</button>
        </div>
        <template v-if="note">
          <blockquote class="note-verse">{{ note.source.text }}</blockquote>
          <p class="note-writing">{{ note.text }}</p>
          <footer class="note-signature">{{ note.author }} · {{ new Date(note.updatedAt).toLocaleDateString('zh-CN') }}<span>{{ own ? (note.publishedAt ? '已公开' : '仅自己可见') : '' }}</span><small>{{ note.source.translationName }}</small></footer>
        </template>
        <p v-else-if="noteBusy" role="status">正在展开便签…</p>
        <p v-if="error" role="alert">{{ error }} <button v-if="!note" :disabled="noteBusy" @click="load">重试</button></p>
        <p v-if="sharedChannel" class="note-shared" role="status">已分享到聊天室。<button :disabled="noteBusy" @click="goToChat">前往查看</button></p>
      </div>
    </AppModal>
    <AppModal :open="shareOpen" title="分享笔记到聊天室" :busy="noteBusy" content-class="note-share-dialog" @close="shareOpen = false">
      <div class="note-dialog-body"><label>分享到频道<select v-model="channelId" aria-label="分享到频道"><option v-for="channel in channels" :key="channel.id" :value="channel.id">{{ channel.name }}</option></select></label><p v-if="own && !note?.publishedAt">此笔记仍保留为私密，所选聊天室的成员可以查看。</p><p v-if="error" role="alert">{{ error }}</p><button :disabled="noteBusy || !channelId" @click="share">发送笔记</button></div>
    </AppModal>
    <AppModal :open="deleteOpen" title="删除笔记" :busy="noteBusy" @close="deleteOpen = false"><div class="note-dialog-body"><p>删除后，圣经和聊天室里的这篇笔记都无法再查看。</p><p v-if="error" role="alert">{{ error }}</p><button :disabled="noteBusy" @click="remove">确认删除</button></div></AppModal>
    <NoteManager v-if="store.account" ref="manager" :key="store.account.id" :account-id="store.account.id" />
  </Teleport>
</template>
<style scoped>
:deep(.bible-note-sheet) { width: min(680px, 100%); grid-template-rows: auto minmax(0, 1fr); color: #5e513b; background: #fff6d5; border-radius: 2px; box-shadow: 0 12px 40px #201b1833; }
:deep(.bible-note-sheet > .modal-head) { gap: 10px; border: 0; background: transparent; padding: 14px 18px; }
.note-reference { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 4px 0; background: transparent; border: 0; color: inherit; font: inherit; font-size: 14px; cursor: pointer; }
.note-tools { display: grid; place-items: center; margin-left: auto; width: 36px; height: 36px; border: 0; border-radius: 50%; background: transparent; color: inherit; cursor: pointer; }
.note-sheet-body { overflow: auto; min-height: 0; padding: 12px 32px 28px; }
.note-verse { margin: 0 0 22px; padding: 0 0 18px; border-bottom: 1px solid #d8c99b70; color: #9a8760; font-size: 14px; line-height: 1.9; }
.note-writing { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 2; font-size: var(--message-content-font-size, 18px); margin: 0; min-height: 140px; }
.note-signature { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 28px; color: #978360; font-size: 11px; }
.note-signature small { flex-basis: 100%; font-size: inherit; }
.note-menu { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid #d8c99b70; }
.note-menu button { display: flex; justify-content: center; align-items: center; gap: 7px; min-height: 44px; border: 1px solid #d5c69c; border-radius: 5px; padding: 8px; background: #fffaf0; font: inherit; color: inherit; font-size: 13px; cursor: pointer; }
.note-dialog-body { display: grid; gap: 16px; padding: 20px; }
.note-dialog-body label { display: grid; gap: 10px; }
.note-dialog-body select, .note-dialog-body button, .note-shared button { min-height: 44px; border: 1px solid #d5c69c; border-radius: 5px; padding: 8px 12px; background: #fffaf0; font: inherit; color: #62533e; }
.note-dialog-body p, .note-shared { font-size: 13px; line-height: 1.8; margin: 0; }
[role=alert] { color: #a14d38; font-size: 13px; overflow-wrap: anywhere; }
.note-shared { margin-top: 20px; }
@media (max-width: 480px) { .note-sheet-body { padding: 12px 20px 24px; } }
</style>
