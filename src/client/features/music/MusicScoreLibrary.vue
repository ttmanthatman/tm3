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
const shareRequest = ref<{ channelId: number; items: { scoreId: number; clientRequestId: string; complete: boolean }[] } | null>(null);
const selectedIds = ref<number[]>([]);
const shareScores = ref<MusicScoreLibraryEntryDTO[]>([]);
const selectedScores = computed(() => scores.value.filter(score => selectedIds.value.includes(score.id)));
function songTitle(score: MusicScoreLibraryEntryDTO) {
  return score.trackTitle.trim() || (/^(screenshot|mmexport|img[_-]|image[_-]|屏幕截图|截屏)/i.test(score.title) ? "未关联歌曲" : score.title);
}
const previewScore = computed(() => selectedScore.value ? { ...selectedScore.value, title: songTitle(selectedScore.value) } : null);
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
function openShare(batch: MusicScoreLibraryEntryDTO[]) {
  if (!batch.length) return;
  shareScores.value = [...batch];
  shareOpen.value = true;
  shareRequest.value = null;
  shareComplete.value = false;
  shareChannelId.value = null;
  channels.value = [];
  void loadChannels();
}
async function shareScore() {
  if (!shareScores.value.length || !shareChannelId.value || shareBusy.value || shareComplete.value) return;
  shareRequest.value ??= { channelId: shareChannelId.value, items: shareScores.value.map(score => ({ scoreId: score.id, clientRequestId: crypto.randomUUID(), complete: false })) };
  const request = shareRequest.value;
  shareBusy.value = true;
  shareStatus.value = "正在分享完整歌谱…";
  try {
    for (const item of request.items) {
      if (item.complete) continue;
      await api(`/api/music/scores/${item.scoreId}/share`, { method: "POST", body: JSON.stringify({ channelId: request.channelId, clientRequestId: item.clientRequestId }) });
      item.complete = true;
    }
    const channelName = shareableChannels.value.find(channel => channel.id === request.channelId)?.name || "聊天室";
    shareStatus.value = `已分享到“${channelName}”`;
    shareComplete.value = true;
  } catch (cause) {
    const complete = request.items.filter(item => item.complete).length;
    shareStatus.value = `${complete ? `已分享 ${complete}/${request.items.length} 份；` : ""}${errorMessage(cause, "分享失败，请重试")}`;
  } finally { shareBusy.value = false; }
}
async function downloadScores(batch: MusicScoreLibraryEntryDTO[]) {
  if (!batch.length || downloadBusy.value) return;
  const controller = new AbortController();
  downloadAbort = controller;
  downloadBusy.value = true;
  actionStatus.value = "正在下载歌谱…";
  try {
    const files: { name: string; blob: Blob }[] = [];
    const pages = batch.flatMap((score, scoreIndex) => [...score.pages].sort((a, b) => a.pageIndex - b.pageIndex).map(page => ({ score, scoreIndex, page })));
    if (!pages.length) throw new Error("所选歌谱没有可下载的页面");
    for (let index = 0; index < pages.length; index++) {
      const { score, scoreIndex, page } = pages[index]!;
      const blob = await fetchBlobWithProgress(pageUrl(score.id, page.id), {
        headers: authHeaders(), signal: controller.signal,
        onProgress: progress => { actionStatus.value = `正在下载 ${index + 1}/${pages.length} 页${progress.percent === null ? "" : ` · ${progress.percent}%`}`; }
      });
      const folder = batch.length > 1 ? `${String(scoreIndex + 1).padStart(2, "0")}-${songTitle(score).replace(/[/\\]/g, "_")}/` : "";
      files.push({ name: folder + (batch.length > 1 ? `${String(page.pageIndex + 1).padStart(2, "0")}-` : "") + page.fileName.replace(/[/\\]/g, "_"), blob });
    }
    if (controller.signal.aborted) return;
    if (batch.length === 1 && files.length === 1) saveBlob(files[0]!.blob, files[0]!.name);
    else {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      for (let index = 0; index < files.length; index++) {
        const file = files[index]!;
        zip.file(batch.length > 1 ? file.name : `${String(index + 1).padStart(2, "0")}-${file.name}`, await file.blob.arrayBuffer());
      }
      actionStatus.value = "正在打包歌谱…";
      const blob = await zip.generateAsync({ type: "blob" });
      if (controller.signal.aborted) return;
      saveBlob(blob, `${batch.length === 1 ? songTitle(batch[0]!).replace(/[/\\]/g, "_") : "所选歌谱"}.zip`);
    }
    actionStatus.value = "歌谱已下载";
  } catch (cause) {
    if (!controller.signal.aborted) actionStatus.value = errorMessage(cause, "下载失败，请重试");
  } finally {
    if (downloadAbort === controller) { downloadAbort = null; downloadBusy.value = false; }
  }
}
onMounted(() => { void loadScores(); });
onBeforeUnmount(() => { lifetime.abort(); downloadAbort?.abort(); });
</script>

<template>
  <Teleport to="body">
    <AppModal :open="true" title="歌谱" size="medium" content-class="music-score-library" @close="emit('close')">
      <div class="score-library-search">
        <label><Search :size="18" /><input v-model="query" type="search" placeholder="搜索歌名、谱名" aria-label="搜索歌谱" /></label>
        <div v-if="selectedIds.length" class="score-library-selection">
          <span>已选 {{ selectedIds.length }} 份</span>
          <button type="button" class="mini-btn" @click="openShare(selectedScores)">分享所选</button>
          <button type="button" class="mini-btn secondary" :disabled="downloadBusy" @click="downloadScores(selectedScores)">下载所选</button>
          <button type="button" class="mini-btn secondary" @click="selectedIds = []">取消选择</button>
        </div>
        <p v-if="actionStatus && !selectedScore" role="status">{{ actionStatus }}</p>
      </div>
      <div class="score-library-results">
        <p v-if="loading" class="score-library-state" role="status">正在加载歌谱…</p>
        <div v-else-if="loadError" class="score-library-state" role="alert"><p>{{ loadError }}</p><button type="button" class="mini-btn secondary" @click="loadScores">重新加载歌谱</button></div>
        <p v-else-if="!visibleScores.length" class="score-library-state">{{ query.trim() ? '没有找到相关歌谱，试试其他歌名或谱名' : '暂无可查看的歌谱，可在音乐管理中上传' }}</p>
        <div v-else class="score-library-grid">
          <article v-for="score in visibleScores" :key="score.id" class="score-library-item" :class="{ selected: selectedIds.includes(score.id) }">
            <input v-model="selectedIds" class="score-library-checkbox" type="checkbox" :value="score.id" :aria-label="`选择《${songTitle(score)}》歌谱`" />
            <button type="button" class="score-library-preview" :aria-label="`预览《${songTitle(score)}》歌谱`" @click="openScore(score)">
              <span class="score-library-cover"><FileMusic v-if="score.kind === 'pdf' || !score.pages.length" :size="36" /><img v-else :src="thumbnail(score)" alt="" loading="lazy" /></span>
              <strong>{{ songTitle(score) }}</strong>
            </button>
          </article>
        </div>
      </div>
    </AppModal>
    <MusicScorePreview v-if="previewScore" :score="previewScore" :action-busy="downloadBusy" :action-status="actionStatus" @close="closePreview" @share="openShare([selectedScore!])" @download="downloadScores([selectedScore!])" />
    <AppModal :open="shareOpen" title="分享歌谱" content-class="score-library-share-modal" :busy="shareBusy" @close="shareOpen = false">
      <form class="score-library-share" @submit.prevent="shareScore">
        <p>{{ shareScores.length === 1 ? `分享《${songTitle(shareScores[0]!)}》的完整歌谱` : `分享所选的 ${shareScores.length} 份完整歌谱` }}</p>
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
:deep(.music-score-library) { color: #40344e; background: radial-gradient(ellipse at 12% 12%, #fff7dfcc 0, transparent 46%), radial-gradient(ellipse at 90% 32%, #fbd1dba8 0, transparent 52%), radial-gradient(ellipse at 15% 92%, #c4d3f1b3 0, transparent 55%), linear-gradient(155deg, #ffe8bd 0%, #f7d4d9 42%, #d8d0ee 73%, #c8dced 100%); height: min(760px, calc(var(--app-height, 100dvh) - var(--safe-top, 0px) - var(--safe-bottom, 0px) - 24px)); grid-template-rows: auto auto minmax(0, 1fr); }
:deep(.music-score-library .modal-head) { color: #40344e; background: #fff8ef33; border-bottom-color: #7c577b24; }
.score-library-search { display: grid; gap: 10px; padding: 12px 16px; border-bottom: 1px solid #7c577b24; }
.score-library-search label { display: flex; align-items: center; gap: 8px; padding: 9px 12px; border: 1px solid #ffffffa6; border-radius: 10px; background: #fffaf0b8; color: #65506f; }
.score-library-search input { min-width: 0; width: 100%; border: 0; background: transparent; color: #40344e; font: inherit; outline-offset: 4px; }
.score-library-results { min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 16px; }
.score-library-state { padding: 24px 8px; color: #65506f; text-align: center; }
.score-library-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 12px; }
.score-library-item { position: relative; min-width: 0; padding: 10px; border: 1px solid #ffffffa6; border-radius: 12px; color: inherit; background: #fffaf078; box-shadow: 0 5px 16px #78527c0a; text-align: left; cursor: pointer; }
.score-library-cover { display: grid; place-items: center; width: 100%; height: 138px; overflow: hidden; color: #65506f; background: #fffdf4c7; border-radius: 5px; }
.score-library-cover img { width: 100%; height: 100%; object-fit: contain; object-position: top; }
.score-library-item strong { overflow-wrap: anywhere; }
.score-library-item.selected { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
.score-library-checkbox { position: absolute; z-index: 1; top: 12px; right: 12px; width: 22px; height: 22px; margin: 0; accent-color: var(--accent); cursor: pointer; }
.score-library-preview { width: 100%; border: 0; padding: 0; display: grid; gap: 8px; text-align: left; background: transparent; color: inherit; font: inherit; cursor: pointer; }
.score-library-selection { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.score-library-search > p { margin: 0; }
:deep(.score-library-share-modal) { width: min(420px, calc(100vw - 32px)); min-width: 0; }
.score-library-preview:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.score-library-share { display: grid; gap: 14px; padding: 16px; overflow-y: auto; }
.score-library-share p { margin: 0; }
.score-library-share label { display: grid; gap: 6px; }
.score-library-share select { width: 100%; min-height: 40px; }
.score-library-share footer { display: flex; justify-content: flex-end; gap: 10px; }
@media (max-width: 480px) { .score-library-results { padding: 12px; } .score-library-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; } }
</style>
