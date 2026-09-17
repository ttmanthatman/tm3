<script setup lang="ts">
import { computed, onMounted } from "vue";
import type { MessageDTO } from "@shared/types";
import { canShowTranscriptChip, useVoiceTranscript, voiceTranscript } from "./useVoiceTranscript";

// 微信样式「转文字」：能力开启且尚未识别时在语音气泡旁显示 chip；识别结果
// （含 socket message:updated 推送的 transcript）以柔和次级气泡展示在语音下方。
const props = defineProps<{
  message: MessageDTO;
}>();

const { asrCapability, transcriptNotice, ensureAsrCapability, isTranscriptBusy, transcribeVoice } = useVoiceTranscript();

const transcript = computed(() => voiceTranscript(props.message));
const showChip = computed(() => canShowTranscriptChip(asrCapability.value, props.message));

onMounted(() => {
  void ensureAsrCapability();
});
</script>

<template>
  <div v-if="transcript" class="voice-transcript-bubble">{{ transcript }}</div>
  <div v-else-if="showChip || transcriptNotice" class="voice-transcript-row" @click.stop>
    <button
      v-if="showChip"
      class="voice-transcript-chip"
      type="button"
      :disabled="isTranscriptBusy(message)"
      @click="transcribeVoice(message)"
    >{{ isTranscriptBusy(message) ? "识别中…" : "转文字" }}</button>
    <small v-if="transcriptNotice" class="voice-transcript-notice" role="status">{{ transcriptNotice }}</small>
  </div>
</template>
