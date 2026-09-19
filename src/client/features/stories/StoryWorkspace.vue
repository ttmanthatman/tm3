<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { ArrowLeft, ArrowRight, Feather, Image, Trash2, BookOpen, RefreshCw, Pencil } from "lucide-vue-next";
import { storyTitle, type StoryActivityDTO, type StoryAuthorDTO, type StoryDTO, type StoryInteractionsDTO, type StoryMediaDTO } from "@shared/stories";
import AppModal from "../../components/ui/AppModal.vue";
import AvatarImage from "../../components/ui/AvatarImage.vue";
import ConfirmDialog from "../../components/ui/ConfirmDialog.vue";
import StoryComposer from "./StoryComposer.vue";
import StoryVoice from "./StoryVoice.vue";
import StoryProfileEditor from "./StoryProfileEditor.vue";
import StoryInteractions from "./StoryInteractions.vue";
import { loadStoryFeed, loadStoryPage, markStoryActivityRead, removeStory, storyDate, storyMediaUrl } from "./storyClient";
type StoryWorkspaceMode = "feed" | "own" | "person";
type DisplayStory = StoryDTO & { author?: StoryAuthorDTO };
const props = withDefaults(defineProps<{ actorId: number; initialMode?: StoryWorkspaceMode; channelId?: number | null }>(), { initialMode: "person", channelId: null });
const emit = defineEmits<{ close: []; activityRead: [activity: StoryActivityDTO] }>();
const mode = ref<StoryWorkspaceMode>(props.initialMode);
const author = ref<StoryAuthorDTO | null>(null);
const stories = ref<DisplayStory[]>([]);
const cursor = ref<number | null>(null);
const busy = ref(false);
const error = ref("");
const composerOpen = ref(false);
const profileOpen = ref(false);
const detail = ref<DisplayStory | null>(null);
const image = ref<{ story: DisplayStory; index: number } | null>(null);
const deleteTarget = ref<DisplayStory | null>(null);
const deleteBusy = ref(false);
const deleteError = ref("");
const title = computed(() => mode.value === "feed" ? "我们的故事" : mode.value === "own" ? "我的故事" : storyTitle(author.value?.gender, author.value?.own));
const canToggle = computed(() => mode.value === "feed" || mode.value === "own");
const photos = (story: StoryDTO) => story.media.filter((media) => media.kind === "image");
const voice = (story: StoryDTO) => story.media.find((media) => media.kind === "voice");
const storyAuthor = (story: DisplayStory) => story.author || author.value;
const canDelete = (story: DisplayStory) => !!storyAuthor(story)?.own;
const imageMedia = computed(() => image.value ? photos(image.value.story)[image.value.index] : null);
let controller: AbortController | null = null;
let disposed = false;

async function load(more = false) {
  controller?.abort();
  const request = new AbortController();
  controller = request;
  busy.value = true;
  error.value = "";
  try {
    const result = mode.value === "feed"
      ? await loadStoryFeed(more ? cursor.value : null, request.signal)
      : await loadStoryPage(props.actorId, more ? cursor.value : null, request.signal);
    if (request.signal.aborted) return;
    author.value = "viewer" in result ? result.viewer : result.author;
    stories.value = more ? [...stories.value, ...result.stories.filter((row) => !stories.value.some((old) => old.id === row.id))] : result.stories;
    cursor.value = result.nextCursor;
    if (!more && mode.value !== "person") {
      void markStoryActivityRead(mode.value === "feed" ? "all" : "interactions")
        .then((activity) => { if (!disposed) emit("activityRead", activity); })
        .catch(() => undefined);
    }
  } catch (cause) {
    if (request.signal.aborted) return;
    // Clear previously authorized content when revalidation fails, including
    // a revoked shared-channel relationship. Never leave a playable old view.
    stories.value = [];
    author.value = null;
    detail.value = null;
    image.value = null;
    cursor.value = null;
    error.value = cause instanceof Error ? cause.message : "故事加载失败";
  } finally { if (!request.signal.aborted) busy.value = false; }
}
function published(story: StoryDTO) {
  controller?.abort();
  busy.value = false;
  const displayed = mode.value === "feed" && author.value ? { ...story, author: author.value } : story;
  stories.value = [displayed, ...stories.value.filter((row) => row.id !== story.id)];
  composerOpen.value = false;
}
function toggleMode() {
  if (!canToggle.value) return;
  mode.value = mode.value === "feed" ? "own" : "feed";
  stories.value = [];
  cursor.value = null;
  detail.value = null;
  image.value = null;
  void load();
}
function requestDelete(story: DisplayStory) { deleteError.value = ""; deleteTarget.value = story; }
function updateInteractions(id: number, interactions: StoryInteractionsDTO) {
  stories.value = stories.value.map((story) => story.id === id ? { ...story, interactions } : story);
  if (detail.value?.id === id) detail.value = { ...detail.value, interactions };
}
async function confirmDelete() {
  if (!deleteTarget.value || deleteBusy.value) return;
  deleteBusy.value = true;
  deleteError.value = "";
  const id = deleteTarget.value.id;
  controller?.abort();
  busy.value = false;
  try {
    await removeStory(id);
    if (disposed) return;
    stories.value = stories.value.filter((story) => story.id !== id);
    if (detail.value?.id === id) detail.value = null;
    if (image.value?.story.id === id) image.value = null;
    deleteTarget.value = null;
  } catch (cause) { deleteError.value = cause instanceof Error ? cause.message : "删除失败，请重试"; }
  finally { deleteBusy.value = false; }
}
function openImage(story: DisplayStory, media: StoryMediaDTO) { image.value = { story, index: photos(story).findIndex((item) => item.id === media.id) }; }
function focused() { if (!document.hidden && !profileOpen.value && !composerOpen.value && !deleteBusy.value && !detail.value && !image.value) void load(); }
onMounted(() => { void load(); window.addEventListener("focus", focused); });
onBeforeUnmount(() => { disposed = true; controller?.abort(); window.removeEventListener("focus", focused); });
</script>

<template>
  <AppModal open :title="title" size="medium" content-class="story-workspace story-surface" close-label="关闭故事" @close="emit('close')">
    <template #header><button type="button" class="story-back" aria-label="返回聊天" @click="emit('close')"><ArrowLeft :size="21" /></button><button v-if="canToggle" type="button" class="story-title-toggle" :aria-label="`${title}，点击切换`" @click="toggleMode"><strong>{{ title }}</strong></button><strong v-else>{{ title }}</strong></template>
    <div class="story-scroll">
      <template v-if="author">
        <header class="story-profile">
          <div class="story-avatar"><AvatarImage :path="author.avatarPath"><span>{{ author.displayName.slice(0, 1) }}</span></AvatarImage></div>
          <div class="story-identity"><h2>{{ mode === "feed" ? "每个人的故事，汇成一条时间线" : author.displayName }}</h2><button v-if="mode !== 'feed' && author.own" type="button" class="story-bio" aria-label="编辑故事签名" @click="profileOpen = true">{{ author.bio }}<Pencil :size="13" /></button><p v-else class="story-bio">{{ mode === "feed" ? "看看大家最近记录的生活，也留下你的这一刻。" : author.bio }}</p></div>
          <button v-if="author.own" type="button" class="story-primary-button" @click="composerOpen = true"><Feather :size="18" /><span>发布</span></button>
        </header>
        <div class="story-banner" aria-hidden="true"></div>
        <div class="story-paper-body">
        <div v-if="!stories.length && !busy" class="story-empty">
          <BookOpen :size="34" :stroke-width="1.3" /><h3>{{ mode === "feed" ? "大家的故事正在酝酿" : author.own ? "故事，从这一刻开始" : "故事正在酝酿" }}</h3>
          <p>{{ mode === "feed" ? "第一段生活片段发布后，就会出现在这里。" : author.own ? "一张照片，一段声音，都值得被记住。" : "等一段声音，等一张生活的照片。" }}</p>
          <button v-if="author.own" type="button" class="story-primary-button" @click="composerOpen = true">留下第一段故事</button>
        </div>
        <ol v-else class="story-timeline" aria-label="故事时间线">
          <li v-for="story in stories" :key="story.id" class="story-moment">
            <time :datetime="story.createdAt" :title="storyDate(story.createdAt).full"><strong>{{ storyDate(story.createdAt).day }}</strong><span>{{ storyDate(story.createdAt).year }}</span></time>
            <article class="story-moment-content">
              <div v-if="mode === 'feed' && storyAuthor(story)" class="story-feed-author"><AvatarImage :path="storyAuthor(story)!.avatarPath"><span>{{ storyAuthor(story)!.displayName.slice(0, 1) }}</span></AvatarImage><span><strong>{{ storyAuthor(story)!.displayName }}</strong><small>{{ storyAuthor(story)!.bio }}</small></span></div>
              <button type="button" class="story-caption" :aria-label="`查看故事：${story.text.slice(0, 30) || storyDate(story.createdAt).day}`" @click="detail = story">{{ story.text || (photos(story).length ? "把这一刻，留在这里" : "一些想留下的声音") }}</button>
              <div v-if="photos(story).length" class="story-photos" :class="{ single: photos(story).length === 1 }">
                <button v-for="(media, index) in photos(story).slice(0, 3)" :key="media.id" type="button" :aria-label="`查看照片 ${index + 1}，共 ${photos(story).length} 张`" @click="openImage(story, media)">
                  <img :src="storyMediaUrl(media.id, true)" alt="故事照片" loading="lazy" :width="media.width || undefined" :height="media.height || undefined" />
                  <span v-if="index === 2 && photos(story).length > 3" class="story-photo-more">+{{ photos(story).length - 3 }}</span>
                </button>
              </div>
              <StoryVoice v-if="voice(story) && !detail && !composerOpen && !image" :src="storyMediaUrl(voice(story)!.id)" :duration-ms="voice(story)!.durationMs" />
              <div class="story-moment-footer"><button type="button" class="story-text-button" @click="detail = story">展开故事 <ArrowRight :size="13" /></button><button v-if="canDelete(story)" type="button" class="story-delete" aria-label="删除故事" @click="requestDelete(story)"><Trash2 :size="15" /></button></div>
              <StoryInteractions :story="story" @updated="updateInteractions(story.id, $event)" />
            </article>
          </li>
        </ol>
        <button v-if="cursor" type="button" class="story-load-more" :disabled="busy" @click="load(true)">{{ busy ? "正在翻阅…" : "再往前翻一页" }}</button>
        <p v-else-if="stories.length" class="story-end">我们的故事，都在祂的故事里。</p>
        </div>
      </template>
      <div v-if="busy && !stories.length" class="story-empty" role="status">正在翻开故事…</div>
      <div v-if="error" class="story-empty"><p class="story-error" role="alert">{{ error }}</p><button type="button" class="story-secondary-button" @click="load()"><RefreshCw :size="17" />重新读取</button></div>
    </div>
  </AppModal>

  <AppModal v-if="detail" open title="故事详情" size="medium" content-class="story-detail story-surface" @close="detail = null">
    <div class="story-detail-body">
      <p class="story-muted">{{ storyAuthor(detail)?.displayName }} · {{ storyDate(detail.createdAt).full }}</p>
      <p class="story-detail-text">{{ detail.text }}</p>
      <div class="story-detail-photos"><button v-for="media in photos(detail)" :key="media.id" type="button" aria-label="放大故事照片" @click="openImage(detail, media)"><img :src="storyMediaUrl(media.id, true)" alt="故事照片" loading="lazy" /></button></div>
      <StoryVoice v-if="voice(detail) && !image" :src="storyMediaUrl(voice(detail)!.id)" :duration-ms="voice(detail)!.durationMs" />
      <StoryInteractions :story="detail" @updated="updateInteractions(detail.id, $event)" />
      <button v-if="canDelete(detail)" type="button" class="story-text-button" @click="requestDelete(detail)"><Trash2 :size="16" />删除这段故事</button>
    </div>
  </AppModal>

  <AppModal v-if="image && imageMedia" open :title="`照片 ${image.index + 1} / ${photos(image.story).length}`" size="medium" content-class="story-lightbox story-surface" @close="image = null">
    <div class="story-lightbox-body"><img :src="storyMediaUrl(imageMedia.id)" alt="故事原图" /><nav aria-label="照片翻页"><button type="button" class="story-secondary-button" :disabled="image.index === 0" aria-label="上一张照片" @click="image.index--"><ArrowLeft :size="20" /></button><Image :size="18" /><button type="button" class="story-secondary-button" :disabled="image.index === photos(image.story).length - 1" aria-label="下一张照片" @click="image.index++"><ArrowRight :size="20" /></button></nav></div>
  </AppModal>
  <StoryComposer v-if="composerOpen" :channel-id="channelId" @close="composerOpen = false" @published="published" />
  <StoryProfileEditor v-if="profileOpen && author?.own" :bio="author.bio" @close="profileOpen = false" @saved="author.bio = $event; profileOpen = false" />
  <ConfirmDialog :open="!!deleteTarget" title="删除这段故事？" message="照片、语音和文字将一起删除，删除后无法恢复。" confirm-text="删除故事" danger :busy="deleteBusy" :error="deleteError" @close="deleteTarget = null" @confirm="confirmDelete" />
</template>

<style src="./stories.css"></style>
