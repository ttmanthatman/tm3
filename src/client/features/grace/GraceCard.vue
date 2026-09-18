<script setup lang="ts">
import { computed } from "vue";
import { Sparkles } from "lucide-vue-next";
import type { MessageDTO } from "@shared/types";
import { getToken } from "../../api";
import { useChatStore } from "../../store";
import InlineAudioPlayer from "../../components/InlineAudioPlayer.vue";
import VoiceTranscript from "../voice/VoiceTranscript.vue";
import { adminDate } from "../admin/adminFormat";
import { gracePayload } from "./useGrace";

// 频道消息流与恩典收藏共用的恩典卡片。
const props = defineProps<{
  message: MessageDTO;
}>();

const emit = defineEmits<{
  "open-image": [imageMessageId: number, event: MouseEvent];
}>();

const store = useChatStore();
const payload = computed(() => gracePayload(props.message));

// 语音本体是当前频道里的一条语音消息：优先复用消息列表里已加载的那条
// （这样 socket 推送的 transcript 能响应式更新），未加载时退化为按 id 直链播放。
const voiceMessage = computed<MessageDTO | null>(() => {
  const id = payload.value.voiceMessageId;
  if (!id) return null;
  const existing = store.messages.find((row) => row.id === id);
  if (existing) return existing;
  return {
    id,
    channelId: props.message.channelId,
    sender: props.message.sender,
    content: "",
    type: "file",
    payload: { kind: "voice" },
    fileName: "恩典语音",
    createdAt: props.message.createdAt
  } as MessageDTO;
});
const voiceSrc = computed(() => (voiceMessage.value ? `/api/files/${voiceMessage.value.id}?token=${encodeURIComponent(getToken())}` : ""));
const imageUrl = computed(() => (payload.value.imageMessageId ? `/api/files/${payload.value.imageMessageId}?token=${encodeURIComponent(getToken())}` : ""));
</script>

<template>
  <div class="grace-card" @click.stop>
    <div class="grace-card-head">
      <span><Sparkles :size="17" /></span>
      <strong>数算恩典</strong>
      <em>恩典见证</em>
    </div>
    <div v-if="message.content" class="grace-card-text" v-html="message.content"></div>
    <div v-if="voiceMessage" class="grace-voice-capsule">
      <InlineAudioPlayer :message="voiceMessage" :src="voiceSrc" />
      <VoiceTranscript :message="voiceMessage" />
    </div>
    <button
      v-if="payload.imageMessageId"
      class="image-preview-button grace-card-photo"
      type="button"
      aria-label="查看恩典照片"
      @click.stop="emit('open-image', payload.imageMessageId!, $event)"
    >
      <img class="chat-image" :src="imageUrl" alt="恩典记录附带照片" loading="lazy" />
    </button>
    <div class="grace-card-foot">
      <span class="grace-card-tag">收藏这一份恩典，也把盼望留给彼此</span>
      <time class="grace-card-date">{{ adminDate(message.createdAt) }}</time>
    </div>
  </div>
</template>
