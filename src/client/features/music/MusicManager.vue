<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRef, watch } from "vue";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  FileText,
  Grid3X3,
  Heart,
  Image as ImageIcon,
  Link,
  List,
  ListChecks,
  ListMusic,
  Music,
  Pencil,
  Play,
  Pause,
  Plus,
  Search,
  Share2,
  Sparkles,
  Trash2,
  Unlink,
  Upload,
  X
} from "lucide-vue-next";
import type {
  ChannelDTO,
  MusicLyricsResourceDTO,
  MusicPlaylistDTO,
  MusicScoreDTO,
  MusicScorePageDTO,
  MusicScoreResourceDTO,
  MusicTrackDTO
} from "@shared/types";
import { api, authHeaders, getToken } from "../../api";
import PdfViewer from "../../components/PdfViewer.vue";
import { compactBytes, formatSeparator } from "../../time";
import { moveMusicTrack, type MusicPlaylistSort } from "../../musicPlayer";
import {
  filterMusicTracksByQuery,
  mergeTrackIds,
  musicUploadAckMessage,
  useMusicLibrary,
  type MusicManagerFocus,
  type MusicResourceUploadAck
} from "./useMusicLibrary";

const props = withDefaults(
  defineProps<{
    tracks: MusicTrackDTO[];
    playlists: MusicPlaylistDTO[];
    currentTrackId: number | null;
    playing: boolean;
    canManageMusic: boolean;
    activeChannelId: number | null;
    embedded?: boolean;
    initialFocus?: MusicManagerFocus | null;
  }>(),
  { embedded: false, initialFocus: null }
);

const emit = defineEmits<{
  close: [];
  "play-track": [track: MusicTrackDTO];
  "toggle-current": [];
  "toggle-favorite": [track: MusicTrackDTO];
  "refresh-tracks": [];
  "refresh-playlists": [];
}>();

const {
  nav,
  activePlaylistId,
  activePlaylist,
  selectedTrack,
  query,
  sort,
  viewMode,
  selectionMode,
  selectedTrackIds,
  selectedManageableIds,
  visibleTracks,
  resources,
  resourcesLoading,
  resourcesError,
  unboundResourceCount,
  selectNav,
  openFocus,
  openTrackDetail,
  closeTrackDetail,
  toggleSelectionMode,
  toggleTrackSelected,
  clearSelection,
  loadResources,
  bindLyrics,
  unbindLyrics,
  bindScore,
  unbindScore,
  deleteLyricsResource,
  deleteScoreResource
} = useMusicLibrary({
  tracks: toRef(props, "tracks"),
  playlists: toRef(props, "playlists"),
  request: api,
  initialFocus: props.initialFocus
});

defineExpose({ openFocus });

watch(
  () => props.initialFocus,
  (focus) => {
    if (focus) openFocus(focus);
  }
);

const favoriteCount = computed(() => props.tracks.filter((track) => track.favorited).length);
const ownedPlaylists = computed(() => props.playlists.filter((playlist) => playlist.isOwner));
const playlistOrderEditable = computed(
  () => nav.value === "playlist" && !!activePlaylist.value?.isOwner && sort.value === "manual" && !query.value.trim()
);

const notice = ref("");
let noticeTimer: number | undefined;
function showNotice(message: string) {
  notice.value = message;
  window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => {
    notice.value = "";
  }, 5000);
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function trackTitleById(id: number) {
  return props.tracks.find((track) => track.id === id)?.title;
}

const channels = ref<ChannelDTO[]>([]);
const musicChannelId = computed(() => channels.value.find((channel) => channel.kind === "music")?.id ?? null);
const shareableChannels = computed(() =>
  channels.value.filter((channel) => (channel.kind === "standard" || channel.kind === "direct") && channel.canWrite !== false)
);

onMounted(() => {
  void api<{ channels: ChannelDTO[] }>("/api/channels")
    .then((result) => {
      channels.value = result.channels;
    })
    .catch(() => undefined);
  void loadResources();
  document.addEventListener("keydown", handleEscape, true);
});

onBeforeUnmount(() => {
  window.clearTimeout(noticeTimer);
  document.removeEventListener("keydown", handleEscape, true);
});

function handleEscape(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  if (previewImage.value) {
    previewImage.value = null;
  } else if (picker.value) {
    picker.value = null;
  } else if (shareTargetId.value) {
    shareTargetId.value = null;
  } else {
    return;
  }
  event.stopImmediatePropagation();
}

type RunOptions = {
  refreshTracks?: boolean;
  refreshPlaylists?: boolean;
  reloadResources?: boolean;
  done?: string;
  fallback: string;
};

const actionBusy = ref(false);

async function runAction(action: () => Promise<unknown>, options: RunOptions) {
  if (actionBusy.value) return;
  actionBusy.value = true;
  try {
    await action();
    if (options.refreshTracks) emit("refresh-tracks");
    if (options.refreshPlaylists) emit("refresh-playlists");
    if (options.reloadResources) await loadResources(true);
    if (options.done) showNotice(options.done);
  } catch (error) {
    showNotice(errorMessage(error, options.fallback));
  } finally {
    actionBusy.value = false;
  }
}

// ---- 播放与收藏（通过 emit 交给 App.vue 的播放引擎）----

function clickPlay(track: MusicTrackDTO) {
  if (track.id === props.currentTrackId) emit("toggle-current");
  else emit("play-track", track);
}

function playLabel(track: MusicTrackDTO) {
  if (track.id === props.currentTrackId) return props.playing ? `暂停《${track.title}》` : `继续播放《${track.title}》`;
  return `播放《${track.title}》`;
}

// ---- 上传 ----

const uploadStatus = ref("");
const songInput = ref<HTMLInputElement | null>(null);
const lyricsPoolInput = ref<HTMLInputElement | null>(null);
const scorePoolInput = ref<HTMLInputElement | null>(null);
const trackLyricsInput = ref<HTMLInputElement | null>(null);
const trackScoreInput = ref<HTMLInputElement | null>(null);

function xhrUpload<T>(method: string, url: string, form: FormData, onProgress?: (percent: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    for (const [key, value] of Object.entries(authHeaders())) xhr.setRequestHeader(key, String(value));
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(Math.max(1, Math.round((event.loaded / event.total) * 100)));
    };
    xhr.onload = () => {
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(xhr.responseText || "{}") as Record<string, unknown>;
      } catch {
        payload = { message: xhr.responseText || "上传失败" };
      }
      if (xhr.status >= 200 && xhr.status < 300 && payload.success !== false) {
        resolve(payload as T);
        return;
      }
      reject(new Error(String(payload.message || payload.error || `HTTP ${xhr.status}`)));
    };
    xhr.onerror = () => reject(new Error("网络连接失败"));
    xhr.send(form);
  });
}

const SCORE_IMAGE_PATTERN = /\.(png|jpe?g|webp|heic|heif)$/i;

function validateScoreImages(files: File[]) {
  if (!files.length) return "请选择歌谱图片";
  if (files.length > 20) return "一份歌谱最多上传 20 页";
  if (files.some((file) => !SCORE_IMAGE_PATTERN.test(file.name))) return "歌谱只支持 PNG、JPG、JPEG、WebP、HEIC 和 HEIF 图片";
  if (files.some((file) => file.size > 20 * 1024 * 1024)) return "单页歌谱不能超过 20MB";
  return "";
}

async function handleSongPicked(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files || []);
  input.value = "";
  if (!files.length) return;
  const channelId = musicChannelId.value;
  if (!channelId) {
    showNotice("未找到音乐频道，无法上传歌曲");
    return;
  }
  if (files.some((file) => !/\.(mp3|m4a)$/i.test(file.name))) {
    showNotice("歌曲只支持 MP3 和 M4A 文件");
    return;
  }
  let skipped = 0;
  let failed = 0;
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const form = new FormData();
    form.append("channelId", String(channelId));
    form.append("file", file);
    try {
      const result = await xhrUpload<{ success?: boolean; skipped?: boolean }>(
        "POST",
        "/api/files/upload",
        form,
        (percent) => (uploadStatus.value = `正在上传 ${index + 1}/${files.length}：${file.name}（${percent}%）`)
      );
      if (result.skipped) skipped += 1;
    } catch {
      failed += 1;
    }
  }
  uploadStatus.value = "";
  emit("refresh-tracks");
  if (failed) showNotice(`有 ${failed} 首上传失败${skipped ? `，${skipped} 首重复歌曲已跳过` : ""}`);
  else if (skipped) showNotice(`已按文件内容跳过 ${skipped} 首重复歌曲`);
  else showNotice("歌曲上传完成");
}

async function handleLyricsPoolPicked(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (!/\.(srt|lrc)$/i.test(file.name)) {
    showNotice("歌词只支持 SRT、LRC 和 Enhanced LRC 文件");
    return;
  }
  if (file.size > 1024 * 1024) {
    showNotice("歌词文件不能超过 1MB");
    return;
  }
  const form = new FormData();
  form.append("file", file);
  await runAction(
    async () => {
      const ack = await api<MusicResourceUploadAck>("/api/music/resources/lyrics", { method: "POST", body: form });
      showNotice(musicUploadAckMessage(ack, trackTitleById) || "歌词已上传");
      if (ack.boundTrackId) emit("refresh-tracks");
    },
    { reloadResources: true, fallback: "歌词上传失败" }
  );
}

async function handleScorePoolPicked(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files || []);
  input.value = "";
  const invalid = validateScoreImages(files);
  if (!files.length) return;
  if (invalid) {
    showNotice(invalid);
    return;
  }
  const form = new FormData();
  for (const file of files) form.append("pages", file);
  await runAction(
    async () => {
      const ack = await api<MusicResourceUploadAck>("/api/music/resources/scores", { method: "POST", body: form });
      showNotice(musicUploadAckMessage(ack, trackTitleById) || "歌谱已上传");
      if (ack.boundTrackId) emit("refresh-tracks");
    },
    { reloadResources: true, fallback: "歌谱上传失败" }
  );
}

// ---- 曲目操作 ----

async function saveRename(track: MusicTrackDTO) {
  const name = renameDraft.value.trim();
  if (!name || name === track.title) return;
  await runAction(
    () => api(`/api/music/tracks/${track.id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
    { refreshTracks: true, done: "已重命名", fallback: "重命名失败" }
  );
}

async function removeTrack(track: MusicTrackDTO) {
  if (!confirm(`永久删除《${track.title}》？此操作无法恢复。`)) return;
  await runAction(
    async () => {
      await api(`/api/music/tracks/${track.id}`, { method: "DELETE" });
      closeTrackDetail();
    },
    { refreshTracks: true, done: "歌曲已删除", fallback: "删除歌曲失败" }
  );
}

const renameDraft = ref("");
const backgroundDraft = ref("");
const lyricsTextDraft = ref("");
const newScoreTitle = ref("");
const editingScoreId = ref<number | null>(null);
const scoreTitleDraft = ref("");

watch(
  selectedTrack,
  (track) => {
    renameDraft.value = track?.title || "";
    backgroundDraft.value = track?.background || "";
    lyricsTextDraft.value = track?.lyricsText || "";
    newScoreTitle.value = "";
    editingScoreId.value = null;
  },
  { immediate: true }
);

async function saveTrackInfo(track: MusicTrackDTO) {
  await runAction(
    () =>
      api(`/api/music/tracks/${track.id}/info`, {
        method: "PUT",
        body: JSON.stringify({ background: backgroundDraft.value.trim(), lyricsText: lyricsTextDraft.value.trim() })
      }),
    { refreshTracks: true, done: "资料已保存", fallback: "保存资料失败" }
  );
}

const aiBusy = ref(false);

async function runAiInfo(track: MusicTrackDTO, overwrite = false): Promise<void> {
  if (aiBusy.value) return;
  aiBusy.value = true;
  try {
    const response = await fetch(`/api/music/tracks/${track.id}/ai-info`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ overwrite }),
      cache: "no-store"
    });
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    if (response.ok) {
      emit("refresh-tracks");
      showNotice("AI 已补全资料，可继续手动编辑后保存");
      return;
    }
    if (response.status === 409) {
      if (confirm("该歌曲已有写作背景或知识歌词，要用 AI 结果覆盖吗？")) await runAiInfo(track, true);
      return;
    }
    showNotice(payload.message || "AI 补全失败，请稍后再试");
  } catch {
    showNotice("网络连接失败");
  } finally {
    aiBusy.value = false;
  }
}

async function handleTrackLyricsPicked(event: Event) {
  const track = selectedTrack.value;
  if (!track) return;
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (!/\.(srt|lrc)$/i.test(file.name)) {
    showNotice("歌词只支持 SRT、LRC 和 Enhanced LRC 文件");
    return;
  }
  if (file.size > 1024 * 1024) {
    showNotice("歌词文件不能超过 1MB");
    return;
  }
  const form = new FormData();
  form.append("lyrics", file);
  await runAction(
    () => xhrUpload("PUT", `/api/music/tracks/${track.id}/lyrics`, form),
    { refreshTracks: true, done: "歌词已绑定", fallback: "歌词上传失败" }
  );
}

async function removeTrackLyrics(track: MusicTrackDTO) {
  if (!confirm(`删除《${track.title}》已绑定的歌词？歌词文件将一并删除。`)) return;
  await runAction(
    () => api(`/api/music/tracks/${track.id}/lyrics`, { method: "DELETE" }),
    { refreshTracks: true, done: "歌词已删除", fallback: "删除歌词失败" }
  );
}

async function unbindTrackLyrics(track: MusicTrackDTO) {
  if (!track.lyrics) return;
  await runAction(() => unbindLyrics(track.lyrics!.id), { refreshTracks: true, done: "歌词已解绑，移入待绑定资源", fallback: "解绑失败" });
}

async function handleTrackScorePicked(event: Event) {
  const track = selectedTrack.value;
  if (!track) return;
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files || []);
  input.value = "";
  if (!files.length) return;
  const invalid = validateScoreImages(files);
  if (invalid) {
    showNotice(invalid);
    return;
  }
  const form = new FormData();
  for (const file of files) form.append("pages", file);
  const title = newScoreTitle.value.trim();
  const url = `/api/music/tracks/${track.id}/score${title ? `?title=${encodeURIComponent(title)}` : ""}`;
  await runAction(
    async () => {
      await xhrUpload("PUT", url, form);
      newScoreTitle.value = "";
    },
    { refreshTracks: true, done: "歌谱已上传", fallback: "歌谱上传失败" }
  );
}

function beginScoreRename(score: MusicScoreDTO) {
  editingScoreId.value = score.id;
  scoreTitleDraft.value = score.title;
}

async function saveScoreRename(score: MusicScoreDTO) {
  const title = scoreTitleDraft.value.trim();
  if (!title || title === score.title) {
    editingScoreId.value = null;
    return;
  }
  await runAction(
    async () => {
      await api(`/api/music/scores/${score.id}`, { method: "PATCH", body: JSON.stringify({ title }) });
      editingScoreId.value = null;
    },
    { refreshTracks: true, done: "谱名已修改", fallback: "修改谱名失败" }
  );
}

async function removeScore(track: MusicTrackDTO, score: MusicScoreDTO) {
  if (!confirm(`删除《${track.title}》的“${score.title}”（共 ${score.pages.length} 页）？`)) return;
  await runAction(
    () => api(`/api/music/scores/${score.id}`, { method: "DELETE" }),
    { refreshTracks: true, done: "歌谱已删除", fallback: "删除歌谱失败" }
  );
}

async function unbindTrackScore(score: MusicScoreDTO) {
  await runAction(() => unbindScore(score.id), { refreshTracks: true, done: "歌谱已解绑，移入待绑定资源", fallback: "解绑失败" });
}

async function moveScorePage(score: MusicScoreDTO, index: number, delta: number) {
  const pageIds = moveMusicTrack(score.pages, index, delta).map((page) => page.id);
  await runAction(
    () => api(`/api/music/scores/${score.id}/pages`, { method: "PATCH", body: JSON.stringify({ pageIds }) }),
    { refreshTracks: true, fallback: "调整页序失败" }
  );
}

async function removeScorePage(score: MusicScoreDTO, page: MusicScorePageDTO) {
  if (!confirm(`删除“${score.title}”的第 ${page.pageIndex + 1} 页？`)) return;
  await runAction(
    () => api(`/api/music/scores/${score.id}/pages/${page.id}`, { method: "DELETE" }),
    { refreshTracks: true, done: "谱页已删除", fallback: "删除谱页失败" }
  );
}

function scorePageUrl(scoreId: number, pageId: number) {
  return `/api/music/scores/${scoreId}/pages/${pageId}?token=${encodeURIComponent(getToken())}`;
}

const previewImage = ref<{ url: string; label: string; pdf?: boolean } | null>(null);

function previewScorePage(score: MusicScoreDTO, page: MusicScorePageDTO) {
  const isPdf = page.fileName.toLowerCase().endsWith(".pdf");
  previewImage.value = { url: scorePageUrl(score.id, page.id), label: `${score.title} · ${isPdf ? "PDF" : `第 ${page.pageIndex + 1} 页`}`, pdf: isPdf };
}

// ---- 绑定选择器 ----

type Picker =
  | { mode: "track"; kind: "lyrics" | "score"; resourceId: number }
  | { mode: "lyrics-resource"; trackId: number };

const picker = ref<Picker | null>(null);
const pickerQuery = ref("");
const pickerTracks = computed(() => filterMusicTracksByQuery(props.tracks, pickerQuery.value));

function openTrackPicker(kind: "lyrics" | "score", resourceId: number) {
  pickerQuery.value = "";
  picker.value = { mode: "track", kind, resourceId };
}

function openLyricsResourcePicker(trackId: number) {
  pickerQuery.value = "";
  picker.value = { mode: "lyrics-resource", trackId };
  void loadResources();
}

async function choosePickerTrack(trackId: number) {
  const current = picker.value;
  if (!current || current.mode !== "track") return;
  picker.value = null;
  await runAction(
    () => (current.kind === "lyrics" ? bindLyrics(current.resourceId, trackId) : bindScore(current.resourceId, trackId)),
    { refreshTracks: true, done: "绑定成功", fallback: "绑定失败" }
  );
}

async function choosePickerLyrics(lyric: MusicLyricsResourceDTO) {
  const current = picker.value;
  if (!current || current.mode !== "lyrics-resource") return;
  picker.value = null;
  await runAction(() => bindLyrics(lyric.id, current.trackId), { refreshTracks: true, done: "歌词已绑定", fallback: "绑定失败" });
}

async function removeLyricsResource(lyric: MusicLyricsResourceDTO) {
  if (!confirm(`删除待绑定歌词“${lyric.fileName}”？`)) return;
  await runAction(() => deleteLyricsResource(lyric.id), { done: "歌词资源已删除", fallback: "删除失败" });
}

async function removeScoreResource(score: MusicScoreResourceDTO) {
  if (!confirm(`删除待绑定歌谱“${score.title}”（共 ${score.pageCount} 页）？`)) return;
  await runAction(() => deleteScoreResource(score.id), { done: "歌谱资源已删除", fallback: "删除失败" });
}

// ---- 批量选择 ----

const batchPlaylistId = ref<number | null>(null);

watch(ownedPlaylists, (playlists) => {
  if (batchPlaylistId.value && !playlists.some((playlist) => playlist.id === batchPlaylistId.value)) {
    batchPlaylistId.value = playlists[0]?.id ?? null;
  }
});

async function addSelectedToPlaylist() {
  const playlist = ownedPlaylists.value.find((item) => item.id === Number(batchPlaylistId.value));
  if (!playlist) {
    showNotice("请先选择一个自己的歌单");
    return;
  }
  const existingIds = playlist.tracks.map((track) => track.id);
  const addedIds = [...selectedTrackIds.value].filter((id) => !existingIds.includes(id));
  if (!addedIds.length) {
    showNotice("所选歌曲已经在这个歌单中");
    return;
  }
  await runAction(
    () =>
      api(`/api/music/playlists/${playlist.id}/tracks`, {
        method: "PUT",
        body: JSON.stringify({ trackIds: mergeTrackIds(existingIds, addedIds) })
      }),
    { refreshPlaylists: true, done: `已加入“${playlist.name}”`, fallback: "加入歌单失败" }
  );
  clearSelection();
}

async function deleteSelectedTracks() {
  const ids = [...selectedManageableIds.value];
  if (!ids.length) {
    showNotice("所选歌曲中没有你可以管理的歌曲");
    return;
  }
  let deleted = 0;
  for (const id of ids) {
    const track = props.tracks.find((item) => item.id === id);
    if (!track) continue;
    if (!confirm(`永久删除《${track.title}》？此操作无法恢复。`)) continue;
    try {
      await api(`/api/music/tracks/${id}`, { method: "DELETE" });
      deleted += 1;
    } catch (error) {
      showNotice(errorMessage(error, "删除歌曲失败"));
      break;
    }
  }
  clearSelection();
  if (deleted) {
    emit("refresh-tracks");
    showNotice(`已删除 ${deleted} 首歌曲`);
  }
}

// ---- 歌单 ----

async function createPlaylist() {
  await runAction(
    async () => {
      const result = await api<{ playlist: MusicPlaylistDTO }>("/api/music/playlists", { method: "POST", body: JSON.stringify({}) });
      emit("refresh-playlists");
      selectNav("playlist", result.playlist.id);
    },
    { done: "已创建歌单，可在右侧改名", fallback: "创建歌单失败" }
  );
}

const playlistRenameDraft = ref("");
const playlistEditingName = ref(false);

function beginPlaylistRename(playlist: MusicPlaylistDTO) {
  playlistRenameDraft.value = playlist.name;
  playlistEditingName.value = true;
}

watch(activePlaylistId, () => {
  playlistEditingName.value = false;
});

async function savePlaylistRename(playlist: MusicPlaylistDTO) {
  const name = playlistRenameDraft.value.trim();
  playlistEditingName.value = false;
  if (!name || name === playlist.name) return;
  await runAction(
    () => api(`/api/music/playlists/${playlist.id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
    { refreshPlaylists: true, done: "歌单已改名", fallback: "歌单改名失败" }
  );
}

async function removePlaylist(playlist: MusicPlaylistDTO) {
  if (!confirm(`删除歌单“${playlist.name}”？聊天室中分享过的卡片将显示为已删除。`)) return;
  await runAction(
    async () => {
      await api(`/api/music/playlists/${playlist.id}`, { method: "DELETE" });
      selectNav("library");
    },
    { refreshPlaylists: true, done: "歌单已删除", fallback: "删除歌单失败" }
  );
}

async function savePlaylistTracks(playlist: MusicPlaylistDTO, trackIds: number[], done = "") {
  await runAction(
    () => api(`/api/music/playlists/${playlist.id}/tracks`, { method: "PUT", body: JSON.stringify({ trackIds }) }),
    { refreshPlaylists: true, done, fallback: "保存歌单失败" }
  );
}

async function movePlaylistTrack(playlist: MusicPlaylistDTO, trackId: number, delta: number) {
  const index = playlist.tracks.findIndex((track) => track.id === trackId);
  if (index < 0) return;
  const trackIds = moveMusicTrack(playlist.tracks, index, delta).map((track) => track.id);
  await savePlaylistTracks(playlist, trackIds);
}

async function removeFromPlaylist(playlist: MusicPlaylistDTO, trackId: number) {
  await savePlaylistTracks(
    playlist,
    playlist.tracks.filter((track) => track.id !== trackId).map((track) => track.id),
    "已从歌单移除"
  );
}

const pickerPlaylistId = ref<number | null>(null);
const playlistPickerIds = ref<Set<number>>(new Set());

function openPlaylistPicker(playlist: MusicPlaylistDTO) {
  pickerPlaylistId.value = playlist.id;
  playlistPickerIds.value = new Set(playlist.tracks.map((track) => track.id));
}

function togglePlaylistPickerTrack(trackId: number) {
  const next = new Set(playlistPickerIds.value);
  if (next.has(trackId)) next.delete(trackId);
  else next.add(trackId);
  playlistPickerIds.value = next;
}

async function savePlaylistPicker() {
  const playlist = props.playlists.find((item) => item.id === pickerPlaylistId.value);
  if (!playlist) {
    pickerPlaylistId.value = null;
    return;
  }
  const trackIds = props.tracks.filter((track) => playlistPickerIds.value.has(track.id)).map((track) => track.id);
  await savePlaylistTracks(playlist, trackIds, "歌单曲目已保存");
  pickerPlaylistId.value = null;
}

// ---- 分享歌单 ----

const shareTargetId = ref<number | null>(null);
const shareChannelId = ref<number | null>(null);
const shareDescription = ref("");
const shareBusy = ref(false);
const shareStatus = ref("");
const shareTarget = computed(() => props.playlists.find((playlist) => playlist.id === shareTargetId.value) || null);

function openShare(playlist: MusicPlaylistDTO) {
  shareTargetId.value = playlist.id;
  shareDescription.value = "";
  shareStatus.value = "";
  shareChannelId.value =
    props.activeChannelId && shareableChannels.value.some((channel) => channel.id === props.activeChannelId)
      ? props.activeChannelId
      : shareableChannels.value[0]?.id ?? null;
}

async function sharePlaylist() {
  const playlist = shareTarget.value;
  const channelId = Number(shareChannelId.value);
  if (!playlist || shareBusy.value) return;
  if (!channelId) {
    shareStatus.value = "请先选择接收频道";
    return;
  }
  shareBusy.value = true;
  shareStatus.value = "分享中…";
  try {
    await api(`/api/music/playlists/${playlist.id}/share`, {
      method: "POST",
      body: JSON.stringify({ channelId, description: shareDescription.value })
    });
    const channelName = shareableChannels.value.find((channel) => channel.id === channelId)?.name || "聊天室";
    shareStatus.value = `已分享到“${channelName}”`;
  } catch (error) {
    shareStatus.value = errorMessage(error, "分享歌单失败");
  } finally {
    shareBusy.value = false;
  }
}

const SORT_OPTIONS: Array<{ value: MusicPlaylistSort; label: string }> = [
  { value: "manual", label: "默认排序" },
  { value: "heat", label: "热度优先" },
  { value: "uploaded", label: "最新上传" },
  { value: "filename", label: "文件名" }
];
</script>

<template>
  <div
    :class="embedded ? 'music-manager-root embedded' : 'music-manager-shell'"
    @click.self="!embedded && emit('close')"
  >
    <section
      class="music-manager"
      :class="{ embedded }"
      :role="embedded ? undefined : 'dialog'"
      :aria-modal="embedded ? undefined : true"
      aria-label="音乐管理"
    >
      <header class="music-manager-head">
        <div>
          <strong>音乐管理</strong>
          <small>歌曲、歌词、歌谱与歌单的统一管理</small>
        </div>
        <button v-if="!embedded" class="music-manager-icon-btn" aria-label="关闭音乐管理" @click="emit('close')">
          <X :size="20" />
        </button>
      </header>

      <div v-if="notice" class="music-manager-notice" role="status">{{ notice }}</div>

      <div class="music-manager-body">
        <nav class="music-manager-nav" aria-label="音乐导航">
          <button :class="{ active: nav === 'library' }" @click="selectNav('library')">
            <Music :size="16" /><span>全部诗歌</span><b>{{ tracks.length }}</b>
          </button>
          <button :class="{ active: nav === 'favorites' }" @click="selectNav('favorites')">
            <Heart :size="16" /><span>我的收藏</span><b>{{ favoriteCount }}</b>
          </button>
          <div class="music-manager-nav-group">
            <div class="music-manager-nav-title">
              <span>我的歌单</span>
              <button aria-label="新建歌单" @click="createPlaylist"><Plus :size="15" /></button>
            </div>
            <button
              v-for="playlist in playlists"
              :key="playlist.id"
              :class="{ active: nav === 'playlist' && activePlaylistId === playlist.id }"
              @click="selectNav('playlist', playlist.id)"
            >
              <ListMusic :size="16" /><span>{{ playlist.name }}</span><b>{{ playlist.trackCount }}</b>
            </button>
            <p v-if="!playlists.length" class="music-manager-nav-empty">还没有歌单</p>
          </div>
          <button :class="{ active: nav === 'resources' }" @click="selectNav('resources')">
            <Link :size="16" /><span>待绑定资源</span><b v-if="unboundResourceCount">{{ unboundResourceCount }}</b>
          </button>
        </nav>

        <div class="music-manager-main">
          <!-- 曲库 / 收藏 / 歌单 曲目工具行 -->
          <div v-if="nav !== 'resources' && (nav !== 'playlist' || activePlaylist)" class="music-manager-toolbar">
            <template v-if="nav === 'playlist' && activePlaylist">
              <button class="music-manager-btn" @click="selectNav('playlist', null)"><ArrowLeft :size="16" />歌单列表</button>
              <template v-if="activePlaylist.isOwner">
                <button class="music-manager-btn" :disabled="actionBusy" @click="openPlaylistPicker(activePlaylist)">
                  <Plus :size="16" />从曲库添加
                </button>
                <button class="music-manager-btn" :disabled="actionBusy" @click="openShare(activePlaylist)">
                  <Share2 :size="16" />分享
                </button>
              </template>
            </template>
            <template v-else>
              <button v-if="canManageMusic" class="music-manager-btn primary" :disabled="!!uploadStatus" @click="songInput?.click()">
                <Upload :size="16" />上传歌曲
              </button>
              <button class="music-manager-btn" :disabled="actionBusy" @click="lyricsPoolInput?.click()">
                <FileText :size="16" />上传歌词
              </button>
              <button class="music-manager-btn" :disabled="actionBusy" @click="scorePoolInput?.click()">
                <ImageIcon :size="16" />上传歌谱
              </button>
            </template>
            <label class="music-manager-search">
              <Search :size="16" />
              <input v-model="query" type="search" placeholder="搜索歌曲名或文件名" />
            </label>
            <select v-model="sort" aria-label="排序方式">
              <option v-for="option in SORT_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
            <div class="music-manager-view-switch" aria-label="显示方式">
              <button :class="{ active: viewMode === 'grid' }" aria-label="网格" @click="viewMode = 'grid'"><Grid3X3 :size="16" /></button>
              <button :class="{ active: viewMode === 'list' }" aria-label="列表" @click="viewMode = 'list'"><List :size="16" /></button>
            </div>
            <button v-if="nav !== 'playlist'" class="music-manager-btn" :class="{ active: selectionMode }" @click="toggleSelectionMode">
              <ListChecks :size="16" />选择
            </button>
          </div>

          <p v-if="uploadStatus" class="music-manager-upload-status" role="status">{{ uploadStatus }}</p>

          <!-- 歌单列表 -->
          <div v-if="nav === 'playlist' && !activePlaylist" class="music-manager-playlists">
            <article v-for="playlist in playlists" :key="playlist.id" class="music-manager-playlist-card">
              <button class="music-manager-playlist-open" @click="selectNav('playlist', playlist.id)">
                <ListMusic :size="22" />
                <strong>{{ playlist.name }}</strong>
                <small>{{ playlist.trackCount }} 首 · {{ playlist.ownerName }}</small>
              </button>
              <div v-if="playlist.isOwner" class="music-manager-playlist-actions">
                <button aria-label="分享歌单" @click="openShare(playlist)"><Share2 :size="15" /></button>
                <button aria-label="删除歌单" class="danger" @click="removePlaylist(playlist)"><Trash2 :size="15" /></button>
              </div>
            </article>
            <div v-if="!playlists.length" class="music-manager-empty">
              <ListMusic :size="34" />
              <strong>还没有歌单</strong>
              <small>点击左侧“我的歌单”旁的 + 新建一个歌单。</small>
            </div>
          </div>

          <!-- 歌单详情头 -->
          <div v-else-if="nav === 'playlist' && activePlaylist" class="music-manager-playlist-head">
            <template v-if="playlistEditingName">
              <input
                v-model="playlistRenameDraft"
                class="music-manager-rename-input"
                maxlength="60"
                aria-label="歌单名称"
                @keydown.enter="savePlaylistRename(activePlaylist)"
                @keydown.esc="playlistEditingName = false"
              />
              <button class="music-manager-btn primary" :disabled="actionBusy" @click="savePlaylistRename(activePlaylist)">保存</button>
            </template>
            <template v-else>
              <strong>{{ activePlaylist.name }}</strong>
              <small>{{ activePlaylist.trackCount }} 首 · 由 {{ activePlaylist.ownerName }} 创建</small>
              <button
                v-if="activePlaylist.isOwner"
                class="music-manager-icon-btn"
                aria-label="歌单改名"
                @click="beginPlaylistRename(activePlaylist)"
              >
                <Pencil :size="15" />
              </button>
              <button
                v-if="activePlaylist.isOwner"
                class="music-manager-icon-btn danger"
                aria-label="删除歌单"
                @click="removePlaylist(activePlaylist)"
              >
                <Trash2 :size="15" />
              </button>
            </template>
          </div>

          <!-- 曲目列表 -->
          <template v-if="nav !== 'resources' && (nav !== 'playlist' || activePlaylist)">
            <div v-if="!visibleTracks.length" class="music-manager-empty">
              <Music :size="34" />
              <strong>{{ query ? "没有符合条件的歌曲" : "这里还没有歌曲" }}</strong>
              <small v-if="nav === 'favorites' && !query">点击歌曲右侧的爱心即可收藏。</small>
            </div>
            <div v-else class="music-manager-tracks" :class="`view-${viewMode}`">
              <article
                v-for="track in visibleTracks"
                :key="track.id"
                class="music-manager-track"
                :class="{ selected: selectedTrackIds.has(track.id), current: track.id === currentTrackId }"
              >
                <label v-if="selectionMode" class="music-manager-check" :aria-label="`选择 ${track.title}`">
                  <input type="checkbox" :checked="selectedTrackIds.has(track.id)" @change="toggleTrackSelected(track.id)" />
                </label>
                <button class="music-manager-play" :aria-label="playLabel(track)" @click="clickPlay(track)">
                  <Pause v-if="track.id === currentTrackId && playing" :size="17" />
                  <Play v-else :size="17" />
                </button>
                <button class="music-manager-track-main" @click="openTrackDetail(track.id)">
                  <strong>{{ track.title }}</strong>
                  <small>{{ compactBytes(track.fileSize) }} · 热度 {{ track.heat }}</small>
                </button>
                <span class="music-manager-badges">
                  <span class="badge" :class="{ off: !track.lyrics }" :title="track.lyrics ? `歌词：${track.lyrics.fileName}` : '未绑定歌词'">词</span>
                  <span class="badge" :class="{ off: !track.scores.length }" :title="`${track.scores.length} 份歌谱`">谱×{{ track.scores.length }}</span>
                </span>
                <button
                  class="music-manager-heart"
                  :class="{ active: track.favorited }"
                  :aria-label="track.favorited ? `取消收藏《${track.title}》` : `收藏《${track.title}》`"
                  @click="emit('toggle-favorite', track)"
                >
                  <Heart :size="16" :fill="track.favorited ? 'currentColor' : 'none'" />
                </button>
                <template v-if="nav === 'playlist' && activePlaylist?.isOwner && playlistOrderEditable">
                  <button class="music-manager-icon-btn" aria-label="上移" :disabled="actionBusy" @click="movePlaylistTrack(activePlaylist, track.id, -1)">
                    <ChevronUp :size="15" />
                  </button>
                  <button class="music-manager-icon-btn" aria-label="下移" :disabled="actionBusy" @click="movePlaylistTrack(activePlaylist, track.id, 1)">
                    <ChevronDown :size="15" />
                  </button>
                  <button class="music-manager-icon-btn" aria-label="从歌单移除" :disabled="actionBusy" @click="removeFromPlaylist(activePlaylist, track.id)">
                    <X :size="15" />
                  </button>
                </template>
                <button
                  v-else-if="nav === 'playlist' && activePlaylist?.isOwner"
                  class="music-manager-icon-btn"
                  aria-label="从歌单移除"
                  :disabled="actionBusy"
                  @click="removeFromPlaylist(activePlaylist, track.id)"
                >
                  <X :size="15" />
                </button>
                <template v-else-if="!selectionMode">
                  <button
                    v-if="track.canManage"
                    class="music-manager-icon-btn danger"
                    :aria-label="`删除《${track.title}》`"
                    :disabled="actionBusy"
                    @click="removeTrack(track)"
                  >
                    <Trash2 :size="15" />
                  </button>
                </template>
              </article>
            </div>

            <!-- 批量操作栏 -->
            <footer v-if="selectionMode" class="music-manager-bulk-bar">
              <span>已选 <b>{{ selectedTrackIds.size }}</b> 首</span>
              <select v-model.number="batchPlaylistId" aria-label="目标歌单">
                <option :value="null" disabled>选择歌单</option>
                <option v-for="playlist in ownedPlaylists" :key="playlist.id" :value="playlist.id">{{ playlist.name }}</option>
              </select>
              <button class="music-manager-btn" :disabled="!selectedTrackIds.size || !ownedPlaylists.length || actionBusy" @click="addSelectedToPlaylist">
                加入歌单
              </button>
              <button class="music-manager-btn danger" :disabled="!selectedManageableIds.length || actionBusy" @click="deleteSelectedTracks">
                <Trash2 :size="15" />删除
              </button>
              <button class="music-manager-btn" @click="toggleSelectionMode">取消</button>
            </footer>
          </template>

          <!-- 待绑定资源 -->
          <div v-if="nav === 'resources'" class="music-manager-resources">
            <div class="music-manager-resources-head">
              <p>歌词和歌谱会先按文件名自动绑定同名歌曲；没绑上的会留在这里，可以手动绑定或删除。</p>
              <div>
                <button class="music-manager-btn" :disabled="actionBusy" @click="lyricsPoolInput?.click()"><FileText :size="16" />上传歌词</button>
                <button class="music-manager-btn" :disabled="actionBusy" @click="scorePoolInput?.click()"><ImageIcon :size="16" />上传歌谱</button>
                <button class="music-manager-btn" :disabled="resourcesLoading" @click="loadResources(true)">刷新</button>
              </div>
            </div>
            <div v-if="resourcesError" class="music-manager-error" role="alert">
              {{ resourcesError }}<button @click="loadResources(true)">重试</button>
            </div>
            <p v-else-if="resourcesLoading && !unboundResourceCount" class="music-manager-loading">正在读取待绑定资源…</p>
            <div v-else-if="!unboundResourceCount" class="music-manager-empty">
              <Link :size="34" />
              <strong>没有待绑定的资源</strong>
              <small>上传的歌词、歌谱若自动匹配到同名歌曲会直接绑定。</small>
            </div>
            <template v-else>
              <section v-if="resources.lyrics.length" class="music-manager-resource-section">
                <h3>歌词（{{ resources.lyrics.length }}）</h3>
                <article v-for="lyric in resources.lyrics" :key="lyric.id" class="music-manager-resource-row">
                  <FileText :size="18" />
                  <div class="music-manager-resource-info">
                    <strong>{{ lyric.fileName }}</strong>
                    <small>{{ lyric.cueCount }} 句 · {{ lyric.uploadedByName || "未知上传者" }} · {{ formatSeparator(lyric.createdAt) }}</small>
                  </div>
                  <button class="music-manager-btn" :disabled="actionBusy" @click="openTrackPicker('lyrics', lyric.id)">绑定到歌曲…</button>
                  <button class="music-manager-icon-btn danger" aria-label="删除歌词" :disabled="actionBusy" @click="removeLyricsResource(lyric)">
                    <Trash2 :size="15" />
                  </button>
                </article>
              </section>
              <section v-if="resources.scores.length" class="music-manager-resource-section">
                <h3>歌谱（{{ resources.scores.length }}）</h3>
                <article v-for="score in resources.scores" :key="score.id" class="music-manager-resource-row">
                  <FileText v-if="score.kind === 'pdf'" :size="18" />
                  <img
                    v-else-if="score.previewPageId"
                    class="music-manager-resource-thumb"
                    :src="scorePageUrl(score.id, score.previewPageId)"
                    alt=""
                    loading="lazy"
                  />
                  <ImageIcon v-else :size="18" />
                  <div class="music-manager-resource-info">
                    <strong>{{ score.title }}</strong>
                    <small>{{ score.pageCount }} 页 · {{ score.uploadedByName || "未知上传者" }} · {{ formatSeparator(score.createdAt) }}</small>
                  </div>
                  <button class="music-manager-btn" :disabled="actionBusy" @click="openTrackPicker('score', score.id)">绑定到歌曲…</button>
                  <button class="music-manager-icon-btn danger" aria-label="删除歌谱" :disabled="actionBusy" @click="removeScoreResource(score)">
                    <Trash2 :size="15" />
                  </button>
                </article>
              </section>
            </template>
          </div>
        </div>

        <!-- 详情面板 -->
        <aside v-if="selectedTrack" class="music-manager-detail" aria-label="歌曲详情">
          <header>
            <div>
              <strong>{{ selectedTrack.title }}</strong>
              <small>{{ selectedTrack.fileName }} · {{ compactBytes(selectedTrack.fileSize) }} · {{ formatSeparator(selectedTrack.createdAt) }}</small>
            </div>
            <button class="music-manager-icon-btn" aria-label="关闭详情" @click="closeTrackDetail"><X :size="18" /></button>
          </header>
          <div class="music-manager-detail-body">
            <div class="music-manager-detail-play">
              <button class="music-manager-btn primary" @click="clickPlay(selectedTrack)">
                <Pause v-if="selectedTrack.id === currentTrackId && playing" :size="16" />
                <Play v-else :size="16" />
                {{ selectedTrack.id === currentTrackId && playing ? "暂停" : "播放" }}
              </button>
              <button
                class="music-manager-heart"
                :class="{ active: selectedTrack.favorited }"
                :aria-label="selectedTrack.favorited ? '取消收藏' : '收藏'"
                @click="emit('toggle-favorite', selectedTrack)"
              >
                <Heart :size="18" :fill="selectedTrack.favorited ? 'currentColor' : 'none'" />
              </button>
              <span class="music-manager-detail-heat">热度 {{ selectedTrack.heat }}</span>
            </div>

            <template v-if="selectedTrack.canManage">
              <section class="music-manager-detail-section">
                <h4>重命名</h4>
                <div class="music-manager-inline-form">
                  <input v-model="renameDraft" maxlength="200" aria-label="歌曲名称" @keydown.enter="saveRename(selectedTrack)" />
                  <button class="music-manager-btn" :disabled="actionBusy || !renameDraft.trim() || renameDraft.trim() === selectedTrack.title" @click="saveRename(selectedTrack)">保存</button>
                </div>
              </section>

              <section class="music-manager-detail-section">
                <h4>写作背景</h4>
                <textarea v-model="backgroundDraft" rows="4" maxlength="5000" placeholder="这首诗歌的写作背景、出处等资料"></textarea>
                <h4>知识歌词</h4>
                <textarea v-model="lyricsTextDraft" rows="6" maxlength="20000" placeholder="完整歌词纯文本（不含时间轴），供诗歌推荐等功能使用"></textarea>
                <div class="music-manager-inline-form">
                  <button class="music-manager-btn primary" :disabled="actionBusy || aiBusy" @click="saveTrackInfo(selectedTrack)">保存资料</button>
                  <button class="music-manager-btn" :disabled="aiBusy || actionBusy" @click="runAiInfo(selectedTrack)">
                    <Sparkles :size="15" />{{ aiBusy ? "AI 生成中…" : "AI 补全资料" }}
                  </button>
                </div>
              </section>

              <section class="music-manager-detail-section">
                <h4>歌词</h4>
                <template v-if="selectedTrack.lyrics">
                  <div class="music-manager-lyrics-bound">
                    <FileText :size="16" />
                    <div>
                      <strong>{{ selectedTrack.lyrics.fileName }}</strong>
                      <small>{{ selectedTrack.lyrics.cues.length }} 句时间轴</small>
                    </div>
                  </div>
                  <div class="music-manager-inline-form">
                    <button class="music-manager-btn" :disabled="actionBusy" @click="trackLyricsInput?.click()">重新上传</button>
                    <button class="music-manager-btn" :disabled="actionBusy" @click="unbindTrackLyrics(selectedTrack)"><Unlink :size="15" />解绑</button>
                    <button class="music-manager-btn danger" :disabled="actionBusy" @click="removeTrackLyrics(selectedTrack)"><Trash2 :size="15" />删除</button>
                  </div>
                </template>
                <template v-else>
                  <p class="music-manager-detail-hint">还没有绑定歌词。</p>
                  <div class="music-manager-inline-form">
                    <button class="music-manager-btn" :disabled="actionBusy" @click="trackLyricsInput?.click()"><Upload :size="15" />上传歌词并绑定</button>
                    <button class="music-manager-btn" :disabled="actionBusy || !resources.lyrics.length" @click="openLyricsResourcePicker(selectedTrack.id)">
                      从待绑定资源选择
                    </button>
                  </div>
                </template>
              </section>

              <section class="music-manager-detail-section">
                <h4>歌谱（{{ selectedTrack.scores.length }} 份）</h4>
                <div v-for="score in selectedTrack.scores" :key="score.id" class="music-manager-score">
                  <div class="music-manager-score-head">
                    <template v-if="editingScoreId === score.id">
                      <input v-model="scoreTitleDraft" maxlength="255" aria-label="谱名" @keydown.enter="saveScoreRename(score)" @keydown.esc="editingScoreId = null" />
                      <button class="music-manager-btn" :disabled="actionBusy" @click="saveScoreRename(score)">保存</button>
                    </template>
                    <template v-else>
                      <strong>{{ score.title }}</strong>
                      <button class="music-manager-icon-btn" aria-label="修改谱名" @click="beginScoreRename(score)"><Pencil :size="14" /></button>
                    </template>
                    <span class="music-manager-score-actions">
                      <button class="music-manager-icon-btn" aria-label="解绑这份谱" title="解绑" :disabled="actionBusy" @click="unbindTrackScore(score)"><Unlink :size="14" /></button>
                      <button class="music-manager-icon-btn danger" aria-label="删除这份谱" title="删除" :disabled="actionBusy" @click="removeScore(selectedTrack, score)"><Trash2 :size="14" /></button>
                    </span>
                  </div>
                  <div class="music-manager-score-pages">
                    <figure v-for="(page, pageIndex) in score.pages" :key="page.id">
                      <div
                        v-if="page.fileName.toLowerCase().endsWith('.pdf')"
                        class="music-manager-score-pdf"
                        @click="previewScorePage(score, page)"
                      >
                        <FileText :size="28" />
                        <span>{{ page.fileName }}</span>
                        <small>PDF</small>
                      </div>
                      <img
                        v-else
                        :src="scorePageUrl(score.id, page.id)"
                        :alt="`${score.title} 第 ${pageIndex + 1} 页`"
                        loading="lazy"
                        @click="previewScorePage(score, page)"
                      />
                      <figcaption>
                        <span>{{ pageIndex + 1 }}</span>
                        <template v-if="!page.fileName.toLowerCase().endsWith('.pdf')">
                          <button aria-label="上移" :disabled="actionBusy || pageIndex === 0" @click="moveScorePage(score, pageIndex, -1)"><ChevronUp :size="13" /></button>
                          <button aria-label="下移" :disabled="actionBusy || pageIndex === score.pages.length - 1" @click="moveScorePage(score, pageIndex, 1)"><ChevronDown :size="13" /></button>
                          <button aria-label="删除这一页" :disabled="actionBusy" @click="removeScorePage(score, page)"><Trash2 :size="13" /></button>
                        </template>
                      </figcaption>
                    </figure>
                  </div>
                </div>
                <div class="music-manager-inline-form">
                  <input v-model="newScoreTitle" maxlength="255" placeholder="新谱名（可选，如：吉他谱）" aria-label="新谱名" />
                  <button class="music-manager-btn" :disabled="actionBusy" @click="trackScoreInput?.click()"><Upload :size="15" />上传新谱</button>
                </div>
              </section>

              <section class="music-manager-detail-section danger-zone">
                <button class="music-manager-btn danger" :disabled="actionBusy" @click="removeTrack(selectedTrack)">
                  <Trash2 :size="15" />删除这首歌曲
                </button>
              </section>
            </template>
            <p v-else class="music-manager-detail-hint">你是这首歌的听众，只有上传者或管理角色可以编辑资料。</p>
          </div>
        </aside>
      </div>

      <!-- 隐藏文件输入 -->
      <input ref="songInput" type="file" accept=".mp3,.m4a" multiple hidden @change="handleSongPicked" />
      <input ref="lyricsPoolInput" type="file" accept=".lrc,.srt" hidden @change="handleLyricsPoolPicked" />
      <input ref="scorePoolInput" type="file" accept=".png,.jpg,.jpeg,.webp,.heic,.heif,.pdf" multiple hidden @change="handleScorePoolPicked" />
      <input v-if="selectedTrack" ref="trackLyricsInput" type="file" accept=".lrc,.srt" hidden @change="handleTrackLyricsPicked" />
      <input v-if="selectedTrack" ref="trackScoreInput" type="file" accept=".png,.jpg,.jpeg,.webp,.heic,.heif,.pdf" multiple hidden @change="handleTrackScorePicked" />

      <!-- 绑定选择器 -->
      <section v-if="picker" class="music-manager-modal-shell" role="dialog" aria-modal="true" aria-label="选择绑定目标" @click.self="picker = null">
        <div class="music-manager-modal">
          <header>
            <strong>{{ picker.mode === "track" ? "绑定到歌曲" : "选择待绑定歌词" }}</strong>
            <button class="music-manager-icon-btn" aria-label="关闭" @click="picker = null"><X :size="18" /></button>
          </header>
          <label v-if="picker.mode === 'track'" class="music-manager-search">
            <Search :size="16" />
            <input v-model="pickerQuery" type="search" placeholder="搜索歌曲名或文件名" />
          </label>
          <div class="music-manager-modal-list">
            <template v-if="picker.mode === 'track'">
              <button v-for="track in pickerTracks" :key="track.id" class="music-manager-modal-row" :disabled="actionBusy" @click="choosePickerTrack(track.id)">
                <Music :size="16" />
                <span>{{ track.title }}</span>
                <small>{{ track.fileName }}</small>
              </button>
              <p v-if="!pickerTracks.length" class="music-manager-detail-hint">没有符合条件的歌曲。</p>
            </template>
            <template v-else>
              <button v-for="lyric in resources.lyrics" :key="lyric.id" class="music-manager-modal-row" :disabled="actionBusy" @click="choosePickerLyrics(lyric)">
                <FileText :size="16" />
                <span>{{ lyric.fileName }}</span>
                <small>{{ lyric.cueCount }} 句</small>
              </button>
              <p v-if="!resources.lyrics.length" class="music-manager-detail-hint">待绑定资源里还没有歌词。</p>
            </template>
          </div>
        </div>
      </section>

      <!-- 歌单选曲 picker -->
      <section v-if="pickerPlaylistId" class="music-manager-modal-shell" role="dialog" aria-modal="true" aria-label="从曲库添加歌曲" @click.self="pickerPlaylistId = null">
        <div class="music-manager-modal">
          <header>
            <strong>从曲库添加歌曲</strong>
            <button class="music-manager-icon-btn" aria-label="关闭" @click="pickerPlaylistId = null"><X :size="18" /></button>
          </header>
          <div class="music-manager-modal-list">
            <label v-for="track in tracks" :key="track.id" class="music-manager-modal-row">
              <input type="checkbox" :checked="playlistPickerIds.has(track.id)" @change="togglePlaylistPickerTrack(track.id)" />
              <span>{{ track.title }}</span>
              <small>{{ compactBytes(track.fileSize) }}</small>
            </label>
          </div>
          <footer>
            <button class="music-manager-btn primary" :disabled="actionBusy" @click="savePlaylistPicker">保存</button>
            <button class="music-manager-btn" @click="pickerPlaylistId = null">取消</button>
          </footer>
        </div>
      </section>

      <!-- 分享歌单 -->
      <section v-if="shareTarget" class="music-manager-modal-shell" role="dialog" aria-modal="true" aria-label="分享歌单" @click.self="shareTargetId = null">
        <form class="music-manager-modal" @submit.prevent="sharePlaylist">
          <header>
            <div>
              <strong>分享“{{ shareTarget.name }}”</strong>
              <small>选择歌单要发送到哪里</small>
            </div>
            <button type="button" class="music-manager-icon-btn" aria-label="关闭" @click="shareTargetId = null"><X :size="18" /></button>
          </header>
          <div class="music-manager-share-body">
            <label>
              分享到
              <select v-model.number="shareChannelId" aria-label="选择接收歌单的频道">
                <option :value="null" disabled>选择频道</option>
                <option v-for="channel in shareableChannels" :key="channel.id" :value="channel.id">{{ channel.name }}</option>
              </select>
            </label>
            <label>
              附言（可选）
              <textarea v-model="shareDescription" rows="2" maxlength="200" placeholder="说点什么…"></textarea>
            </label>
            <p v-if="shareStatus" class="music-manager-share-status" role="status">{{ shareStatus }}</p>
          </div>
          <footer>
            <button type="submit" class="music-manager-btn primary" :disabled="shareBusy || !shareChannelId">分享</button>
            <button type="button" class="music-manager-btn" @click="shareTargetId = null">关闭</button>
          </footer>
        </form>
      </section>

      <!-- 谱页预览 -->
      <section v-if="previewImage" class="music-manager-preview" role="dialog" aria-modal="true" aria-label="谱页预览" @click.self="previewImage = null">
        <header>
          <span>{{ previewImage.label }}</span>
          <button class="music-manager-icon-btn" aria-label="关闭预览" @click="previewImage = null"><X :size="20" /></button>
        </header>
        <PdfViewer v-if="previewImage.pdf" :src="previewImage.url" :file-name="previewImage.label" @close="previewImage = null" />
        <img v-else :src="previewImage.url" :alt="previewImage.label" />
      </section>
    </section>
  </div>
</template>
