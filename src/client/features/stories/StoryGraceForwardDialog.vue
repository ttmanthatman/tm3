<script setup lang="ts">
import { Send, Sparkles } from "lucide-vue-next";
import type { MessageDTO } from "@shared/types";
import AppModal from "../../components/ui/AppModal.vue";
import StoryVoice from "./StoryVoice.vue";
import { storyMediaUrl } from "./storyClient";
import type { useStoryGraceForward } from "./useStoryGraceForward";

const props = defineProps<{ forwarding: ReturnType<typeof useStoryGraceForward> }>();
const emit = defineEmits<{ viewCard: [message: MessageDTO] }>();
const { forwardOpen, forwardBusy, forwardError, story, channelId, result, targetChannels, targetName, canSubmit, close, submit } = props.forwarding;
</script>

<template>
  <AppModal :open="forwardOpen" title="转发为恩典卡片" aria-label="转发为恩典卡片" close-label="关闭故事转发" :busy="forwardBusy" size="medium" content-class="story-grace-forward story-surface" @close="close">
    <div class="story-grace-forward-body">
      <template v-if="result">
        <p class="story-grace-success" role="status"><Sparkles :size="22" />已转发到「{{ targetName }}」</p>
        <div class="story-grace-forward-actions"><button type="button" class="story-secondary-button" @click="close">留在故事</button><button type="button" class="story-primary-button" @click="emit('viewCard', result)">查看卡片</button></div>
      </template>
      <template v-else-if="story">
        <p class="story-muted">将这段故事原样分享为“数算恩典”卡片。</p>
        <p v-if="story.text" class="story-detail-text">{{ story.text }}</p>
        <div v-if="story.media.some(media => media.kind === 'image')" class="story-grace-preview-photos">
          <img v-for="(media, index) in story.media.filter(media => media.kind === 'image')" :key="media.id" :src="storyMediaUrl(media.id, true)" :alt="`转发故事照片 ${index + 1}`" loading="lazy" />
        </div>
        <StoryVoice v-for="media in story.media.filter(media => media.kind === 'voice')" :key="media.id" :src="storyMediaUrl(media.id)" :duration-ms="media.durationMs" />
        <label class="story-field-label" for="story-grace-channel">转发到聊天室</label>
        <select id="story-grace-channel" v-model="channelId" :disabled="forwardBusy || !targetChannels.length">
          <option :value="null" disabled>请选择聊天室</option>
          <option v-for="channel in targetChannels" :key="channel.id" :value="channel.id">{{ channel.name }}</option>
        </select>
        <p v-if="!targetChannels.length" class="story-muted" role="status">暂无可发言的聊天室。</p>
        <p v-if="forwardError" class="story-error" role="alert">{{ forwardError }}</p>
        <div class="story-grace-forward-actions"><button type="button" class="story-secondary-button" :disabled="forwardBusy" @click="close">取消</button><button type="button" class="story-primary-button" :disabled="!canSubmit" @click="submit"><Send :size="17" />{{ forwardBusy ? "正在转发…" : "确认转发" }}</button></div>
      </template>
    </div>
  </AppModal>
</template>

<style scoped>
.story-grace-forward-body { overflow-y: auto; padding: 10px 24px 24px; }
.story-grace-preview-photos { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin: 18px 0; }
.story-grace-preview-photos img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 6px; }
select { width: 100%; min-height: 44px; padding: 8px; border: 1px solid #dce0d4; border-radius: 8px; background: #fffefa; color: #242c36; font: inherit; }
select:focus-visible { outline: 2px solid #678662; outline-offset: 3px; }
.story-grace-forward-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 12px; margin-top: 22px; }
.story-grace-success { display: flex; align-items: center; gap: 10px; overflow-wrap: anywhere; }
@media (max-width: 420px) { .story-grace-forward-body { padding: 8px 16px 20px; } }
</style>

<style>
.story-grace-forward.app-modal-medium { display: flex; flex-direction: column; }
.story-grace-forward .modal-head { flex-shrink: 0; }
</style>
