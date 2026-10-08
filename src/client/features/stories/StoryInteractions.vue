<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { Brush, Heart, SendHorizontal, Trash2, X } from "lucide-vue-next";
import { STORY_LIMITS, type StoryCommentDTO, type StoryDTO, type StoryInteractionsDTO } from "@shared/stories";
import { HANDWRITING_DEFAULT_GLOBAL_SETTINGS, HANDWRITING_DEFAULT_PREFERENCES } from "@shared/handwriting";
import type { MessageDTO } from "@shared/types";
import AvatarImage from "../../components/ui/AvatarImage.vue";
import { useChatStore } from "../../store";
import HandwritingComposer from "../handwriting/HandwritingComposer.vue";
import HandwritingMessage from "../handwriting/HandwritingMessage.vue";
import { useHandwritingPreferences } from "../handwriting/handwritingPreferences";
import { addStoryComment, removeStoryComment, toggleStoryLike } from "./storyClient";
import { useStoryHandwritingReply } from "./useStoryHandwritingReply";

const props = withDefaults(defineProps<{ story: StoryDTO; surfaceActive?: boolean }>(), { surfaceActive: true });
const emit = defineEmits<{ updated: [interactions: StoryInteractionsDTO]; handwritingOpen: [open: boolean] }>();
const store = useChatStore();
const { save: savePreferences, error: preferencesError } = useHandwritingPreferences(store);
const handwriting = useStoryHandwritingReply({ accountId: () => store.account?.id || 0, storyId: () => props.story.id, onUpdated: (interactions) => { emit("updated", interactions); replyingTo.value = null; } });
const { handwritingOpen, handwritingBusy, handwritingError, persistenceError, draftState, replyLabel } = handwriting;
watch(handwritingOpen, (open) => emit("handwritingOpen", open));
const comment = ref("");
const likeBusy = ref(false);
const commentBusy = ref(false);
const deletingId = ref<number | null>(null);
const replyingTo = ref<StoryCommentDTO | null>(null);
const error = ref("");
const input = ref<HTMLInputElement | null>(null);

function commentTime(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

async function like() {
  if (likeBusy.value) return;
  likeBusy.value = true;
  error.value = "";
  try { emit("updated", (await toggleStoryLike(props.story.id, !props.story.interactions.liked)).interactions); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : "点赞失败，请重试"; }
  finally { likeBusy.value = false; }
}

async function submitComment() {
  const text = comment.value.trim();
  if (!text || commentBusy.value) return;
  const storyId = props.story.id;
  const accountId = store.account?.id;
  commentBusy.value = true;
  error.value = "";
  try {
    const response = await addStoryComment(storyId, text, replyingTo.value?.id);
    if (props.story.id !== storyId || store.account?.id !== accountId) return;
    emit("updated", response.interactions);
    comment.value = "";
    replyingTo.value = null;
  } catch (cause) { error.value = cause instanceof Error ? cause.message : "评论失败，请重试"; }
  finally { commentBusy.value = false; }
}

async function remove(commentId: number) {
  if (deletingId.value !== null) return;
  deletingId.value = commentId;
  error.value = "";
  try {
    emit("updated", (await removeStoryComment(props.story.id, commentId)).interactions);
    if (replyingTo.value?.id === commentId) replyingTo.value = null;
  }
  catch (cause) { error.value = cause instanceof Error ? cause.message : "删除评论失败，请重试"; }
  finally { deletingId.value = null; }
}

async function focusComment() {
  await nextTick();
  input.value?.focus();
}

async function replyToComment(item: StoryCommentDTO) {
  replyingTo.value = item;
  await focusComment();
}

function handwritingMessage(item: StoryCommentDTO): MessageDTO {
  return { id: item.id, channelId: 0, type: "handwriting", content: "手写回复", payload: item.handwriting, sender: { id: item.author.actorId, kind: "human", username: "", displayName: item.author.displayName, avatarPath: item.author.avatarPath }, createdAt: item.createdAt };
}

watch([() => props.story.id, () => store.account?.id], () => {
  comment.value = "";
  replyingTo.value = null;
  error.value = "";
});
</script>

<template>
  <section class="story-interactions" :aria-label="`故事互动，共 ${story.interactions.likeCount} 个赞、${story.interactions.commentCount} 条评论`">
    <div class="story-like-row">
      <button type="button" class="story-social-icon" :class="{ active: story.interactions.liked }" :disabled="likeBusy" :aria-label="story.interactions.liked ? '取消点赞' : '点赞'" :aria-pressed="story.interactions.liked" @click="like">
        <Heart :size="28" :fill="story.interactions.liked ? 'currentColor' : 'none'" />
      </button>
      <div v-if="story.interactions.likes.length" class="story-like-people" aria-label="点赞成员">
        <span v-for="person in story.interactions.likes" :key="person.accountId" class="avatar story-person-avatar" :title="person.displayName">
          <AvatarImage :path="person.avatarPath"><span>{{ person.displayName.slice(0, 1) }}</span></AvatarImage>
        </span>
      </div>
      <button v-else type="button" class="story-first-like" :disabled="likeBusy" @click="like">成为第一个点赞的人</button>
    </div>
    <div class="story-comment-row">
      <button type="button" class="story-social-icon" aria-label="手写回复" title="手写回复" :disabled="handwritingBusy" @click="handwriting.open(replyingTo)"><Brush :size="27" /></button>
      <div class="story-comment-main">
        <ul v-if="story.interactions.comments.length" class="story-comment-list" aria-label="评论列表">
          <li v-for="item in story.interactions.comments" :key="item.id">
            <span class="avatar story-comment-avatar"><AvatarImage :path="item.author.avatarPath"><span>{{ item.author.displayName.slice(0, 1) }}</span></AvatarImage></span>
            <div class="story-comment-content">
              <div class="story-comment-meta">
                <strong>{{ item.author.displayName }}</strong>
                <time :datetime="item.createdAt">{{ commentTime(item.createdAt) }}</time>
                <button type="button" class="story-comment-reply" :aria-label="`回复 ${item.author.displayName} 的评论`" @click="replyToComment(item)">回复</button>
              </div>
              <p v-if="item.replyTo || item.text"><span v-if="item.replyTo" class="story-comment-reply-prefix">回复 <strong>{{ item.replyTo.author.displayName }}</strong>：</span>{{ item.text }}</p>
              <HandwritingMessage v-if="item.handwriting" :message="handwritingMessage(item)" variant="favorite" interactive :surface-active="surfaceActive && !handwritingOpen" />
            </div>
            <button v-if="item.canDelete" type="button" class="story-comment-delete" :disabled="deletingId === item.id" :aria-label="`删除 ${item.author.displayName} 的评论`" @click="remove(item.id)"><Trash2 :size="14" /></button>
          </li>
        </ul>
        <div v-if="replyingTo" class="story-comment-replying" role="status">
          <span>回复 <strong>{{ replyingTo.author.displayName }}</strong></span>
          <button type="button" aria-label="取消回复" @click="replyingTo = null"><X :size="14" /></button>
        </div>
        <form class="story-comment-form" @submit.prevent="submitComment">
          <input ref="input" v-model="comment" type="text" :maxlength="STORY_LIMITS.comment" :placeholder="replyingTo ? `回复 ${replyingTo.author.displayName}…` : '写下祝福…'" aria-label="评论内容" />
          <button type="submit" :disabled="!comment.trim() || commentBusy" aria-label="发表评论"><SendHorizontal :size="18" /></button>
        </form>
      </div>
    </div>
    <p v-if="error" class="story-social-error" role="alert">{{ error }}</p>
    <p v-if="!handwritingOpen && (handwritingError || persistenceError)" class="story-social-error" role="alert">{{ handwritingError || persistenceError }}</p>
  </section>
  <HandwritingComposer
    v-if="draftState.key"
    :open="handwritingOpen"
    :account-id="store.account?.id || 0"
    :draft-state="draftState"
    :busy="handwritingBusy"
    :status="handwritingError || persistenceError || '手写回复，草稿保存在本机'"
    :socket-ready="!!store.account"
    :reply-label="replyLabel"
    :preferences="store.account?.handwritingPreferences || HANDWRITING_DEFAULT_PREFERENCES"
    :preferences-error="preferencesError"
    :global-settings="store.appearance.handwritingSettings || HANDWRITING_DEFAULT_GLOBAL_SETTINGS"
    :is-admin="store.account?.isAdmin || false"
    @close="handwriting.close"
    @draft-change="handwriting.saveDraft"
    @preferences-change="savePreferences"
    @submit="handwriting.submit"
  />
</template>
