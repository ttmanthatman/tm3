<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from "vue";
import { FileMusic, Search } from "lucide-vue-next";
import type { ChannelDTO, MusicScoreLibraryEntryDTO } from "@shared/types";
import { api, authHeaders, getToken } from "../../api";
import AppModal from "../../components/ui/AppModal.vue";
import { fetchBlobWithProgress, saveBlob } from "../files/transfer";

const MusicScorePreview = defineAsyncComponent(() => import("./MusicScorePreview.vue"));
const props = defineProps<{
  currentChannelId?: number | null;
  currentScoreAvailable?: boolean;
  showCurrentScore?: () => void;
}>();
const emit = defineEmits<{ close: [] }>();
const scores = ref<MusicScoreLibraryEntryDTO[]>([]);
const query = ref("");
const loading = ref(false);
const loadError = ref("");
const selectedScore = ref<MusicScoreLibraryEntryDTO | null>(null);
const downloadBusy = ref(false);
const actionStatus = ref("");
const shareOpen = ref(false);
const channels = ref<ChannelDTO[]>([]);
const channelsLoading = ref(false);
const shareChannelId = ref<number | null>(null);
const shareBusy = ref(false);
const shareStatus = ref("");
const shareComplete = ref(false);
const shareRequest = ref<{ channelId: number; clientRequestId: string } | null>(null);
const lifetime = new AbortController();
let downloadAbort: AbortController | null = null;
const visibleScores = computed(() => {
  const text = query.value.trim().toLocaleLowerCase();
  return scores.value.filter(score => !text || [score.title, score.trackTitle, ...score.pages.map(page => page.fileName)]
    .some(value => value.toLocaleLowerCase().includes(text)));
});
const shareableChannels = computed(() => channels.value.filter(channel =>
  (channel.kind === "standard" || channel.kind === "direct") && channel.canWrite !== false));
function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}
async function loadScores() {
  loading.value = true;
  loadError.value = "";
    try { scores.value = (await api<{ scores: MusicScoreLibraryEntryDTO[] }>("/api/music/scores", { signal: lifetime.signal })).scores; }
  catch (cause) { if (!lifetime.signal.aborted) loadError.value = errorMessage(cause, "歌谱加载失败"); }
  finally { loading.value = false; }
}
function pageUrl(scoreId: number, pageId: number) {
  return `/api/music/scores/${scoreId}/pages/${pageId}`;
}
function thumbnail(score: MusicScoreLibraryEntryDTO) {
  return `${pageUrl(score.id, score.pages[0]!.id)}?token=${encodeURIComponent(getToken())}`;
}
function openScore(score: MusicScoreLibraryEntryDTO) {
  actionStatus.value = "";
  selectedScore.value = score;
}
function closePreview() {
  downloadAbort?.abort();
  selectedScore.value = null;
  actionStatus.value = "";
}
async function loadChannels() {
  channelsLoading.value = true;
  shareStatus.value = "";
  try {
    channels.value = (await api<{ channels: ChannelDTO[] }>("/api/channels", { signal: lifetime.signal })).channels;
    shareChannelId.value = shareableChannels.value.some(channel => channel.id === props.currentChannelId)
      ? props.currentChannelId ?? null : shareableChannels.value[0]?.id ?? null;
  } catch (cause) {
    if (!lifetime.signal.aborted) shareStatus.value = errorMessage(cause, "频道加载失败");
  } finally { channelsLoading.value = false; }
}
function openShare() {
  shareOpen.value = true;
  shareRequest.value = null;
  shareComplete.value = false;
  shareChannelId.value = null;
  channels.value = [];
  void loadChannels();
}
async function shareScore() {
  const score = selectedScore.value;
  if (!score || !shareChannelId.value || shareBusy.value || shareComplete.value) return;
  shareRequest.value ??= { channelId: shareChannelId.value, clientRequestId: crypto.randomUUID() };
  shareBusy.value = true;
  shareStatus.value = "正在分享完整歌谱…";
  try {
    await api(`/api/music/scores/${score.id}/share`, { method: "POST", body: JSON.stringify(shareRequest.value) });
    const channelName = shareableChannels.value.find(channel => channel.id === shareRequest.value?.channelId)?.name || "聊天室";
    shareStatus.value = `已分享到“${channelName}”`;
    shareComplete.value = true;
  } catch (cause) { shareStatus.value = errorMessage(cause, "分享失败，请重试"); }
  finally { shareBusy.value = false; }
}
async function downloadScore() {
  const score = selectedScore.value;
  if (!score?.pages.length || downloadBusy.value) return;
  const controller = new AbortController();
  downloadAbort = controller;
  downloadBusy.value = true;
  actionStatus.value = "正在下载歌谱…";
  try {
    const files: { name: string; blob: Blob }[] = [];
    for (let index = 0; index < score.pages.length; index++) {
      const page = score.pages[index]!;
      const blob = await fetchBlobWithProgress(pageUrl(score.id, page.id), {
        headers: authHeaders(), signal: controller.signal,
        onProgress: progress => { actionStatus.value = `正在下载 ${index + 1}/${score.pages.length} 页${progress.percent === null ? "" : ` · ${progress.percent}%`}`; }
      });
      files.push({ name: page.fileName, blob });
    }
    if (controller.signal.aborted) return;
    if (files.length === 1) saveBlob(files[0]!.blob, files[0]!.name);
    else {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      for (let index = 0; index < files.length; index++) {
        const file = files[index]!;
        zip.file(`${String(index + 1).padStart(2, "0")}-${file.name.replace(/[/\\]/g, "_")}`, await file.blob.arrayBuffer());
      }
      actionStatus.value = "正在打包歌谱…";
      const blob = await zip.generateAsync({ type: "blob" });
      if (controller.signal.aborted) return;
      saveBlob(blob, `${score.title.replace(/[/\\]/g, "_") || "歌谱"}.zip`);
    }
    actionStatus.value = "歌谱已下载";
  } catch (cause) {
    if (!controller.signal.aborted) actionStatus.value = errorMessage(cause, "下载失败，请重试");
  } finally {
    if (downloadAbort === controller) { downloadAbort = null; downloadBusy.value = false; }
  }
}
function showPlayingScore() {
  props.showCurrentScore?.();
  emit("close");
}
onMounted(() => { void loadScores(); });
onBeforeUnmount(() => { lifetime.abort(); downloadAbort?.abort(); });
</script>

<template>
  <Teleport to="body">
    <AppModal :open="true" title="歌谱" size="medium" content-class="music-score-library" @close="emit('close')">
      <div class="score-library-search">
        <label><Search :size="18" /><input v-model="query" type="search" placeholder="搜索歌名、谱名" aria-label="搜索歌谱" /></label>
        <button v-if="currentScoreAvailable" type="button" class="mini-btn secondary" @click="showPlayingScore">当前播放的歌谱</button>
      </div>
      <div class="score-library-results">
        <p v-if="loading" class="score-library-state" role="status">正在加载歌谱…</p>
        <div v-else-if="loadError" class="score-library-state" role="alert"><p>{{ loadError }}</p><button type="button" class="mini-btn secondary" @click="loadScores">重新加载歌谱</button></div>
        <p v-else-if="!visibleScores.length" class="score-library-state">{{ query.trim() ? '没有找到相关歌谱，试试其他歌名或谱名' : '暂无可查看的歌谱，可在音乐管理中上传' }}</p>
        <div v-else class="score-library-grid">
          <button v-for="score in visibleScores" :key="score.id" type="button" class="score-library-item" @click="openScore(score)">
            <span class="score-library-cover"><FileMusic v-if="score.kind === 'pdf' || !score.pages.length" :size="36" /><img v-else :src="thumbnail(score)" alt="" loading="lazy" /></span>
            <strong>{{ score.title }}</strong><small>{{ score.trackTitle || '独立歌谱' }}</small><small>{{ score.kind === 'pdf' ? 'PDF' : `${score.pages.length} 页` }} · 预览歌谱</small>
          </button>
        </div>
      </div>
    </AppModal>
    <MusicScorePreview v-if="selectedScore" :score="selectedScore" :action-busy="downloadBusy" :action-status="actionStatus" @close="closePreview" @share="openShare" @download="downloadScore" />
    <AppModal :open="shareOpen" title="分享歌谱" :busy="shareBusy" @close="shareOpen = false">
      <form class="score-library-share" @submit.prevent="shareScore">
        <p>分享《{{ selectedScore?.title }}》的完整歌谱{{ selectedScore?.kind === 'image' ? `（${selectedScore.pages.length} 页）` : '' }}</p>
        <p v-if="channelsLoading" role="status">正在加载频道…</p>
        <label v-else>发送到<select v-model.number="shareChannelId" aria-label="选择接收歌谱的频道" :disabled="!!shareRequest || shareBusy"><option v-for="channel in shareableChannels" :key="channel.id" :value="channel.id">{{ channel.name }}</option></select></label>
        <p v-if="!channelsLoading && !shareableChannels.length">暂无可分享的聊天频道</p>
        <p v-if="shareStatus" role="status">{{ shareStatus }}</p>
        <button v-if="!channelsLoading && !channels.length" type="button" class="mini-btn secondary" @click="loadChannels">重新加载频道</button>
        <footer><button type="submit" class="primary-btn" :disabled="shareBusy || !shareChannelId || shareComplete">{{ shareBusy ? '分享中…' : shareComplete ? '已分享' : shareRequest ? '重试分享' : '分享' }}</button><button type="button" class="mini-btn secondary" :disabled="shareBusy" @click="shareOpen = false">{{ shareComplete ? '完成' : '取消' }}</button></footer>
      </form>
    </AppModal>
  </Teleport>
</template>

<style scoped>
:deep(.music-score-library) { height: min(760px, calc(var(--app-height, 100dvh) - var(--safe-top, 0px) - var(--safe-bottom, 0px) - 24px)); grid-template-rows: auto auto minmax(0, 1fr); }
.score-library-search { display: grid; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--line); }
.score-library-search label { display: flex; align-items: center; gap: 8px; padding: 9px 12px; border: 1px solid var(--line); border-radius: 8px; }
.score-library-search input { min-width: 0; width: 100%; border: 0; background: transparent; font: inherit; outline-offset: 4px; }
.score-library-search > button { justify-self: start; }
.score-library-results { min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 16px; }
.score-library-state { padding: 24px 8px; color: var(--muted); text-align: center; }
.score-library-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px; }
.score-library-item { min-width: 0; display: grid; align-content: start; gap: 5px; padding: 10px; border: 1px solid var(--line); border-radius: 10px; color: inherit; background: var(--panel); text-align: left; cursor: pointer; }
.score-library-cover { display: grid; place-items: center; width: 100%; height: 138px; overflow: hidden; color: var(--muted); background: #f1f2ed; border-radius: 5px; }
.score-library-cover img { width: 100%; height: 100%; object-fit: contain; object-position: top; }
.score-library-item strong, .score-library-item small { overflow-wrap: anywhere; }
.score-library-item small { color: var(--muted); }
.score-library-item:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.score-library-share { display: grid; gap: 14px; padding: 16px; overflow-y: auto; }
.score-library-share p { margin: 0; }
.score-library-share label { display: grid; gap: 6px; }
.score-library-share select { width: 100%; min-height: 40px; }
.score-library-share footer { display: flex; justify-content: flex-end; gap: 10px; }
@media (max-width: 480px) { .score-library-results { padding: 12px; } .score-library-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; } }
</style>
