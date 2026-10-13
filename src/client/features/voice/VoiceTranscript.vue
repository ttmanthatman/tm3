<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import type { MessageDTO } from "@shared/types";
import { canShowTranscriptChip, useVoiceTranscript, voiceTranscript } from "./useVoiceTranscript";
import { getSharedMessageAudioPlayback, type MessageAudioSnapshot } from "../audio/messageAudioPlayback";
import { revealedTranscriptWords, voiceTranscriptWords } from "./voiceTranscriptTiming";

// 微信样式「转文字」：能力开启且尚未识别时在语音气泡旁显示 chip；识别结果
// （含 socket message:updated 推送的 transcript）以柔和次级气泡展示在语音下方。
const props = defineProps<{
  message: MessageDTO;
}>();

const { asrCapability, asrTimestamps, transcriptNotice, ensureAsrCapability, isTranscriptBusy, transcribeVoice } = useVoiceTranscript();

const transcript = computed(() => voiceTranscript(props.message));
const showChip = computed(() => canShowTranscriptChip(asrCapability.value, props.message, asrTimestamps.value));
const words = computed(() => voiceTranscriptWords(props.message));
const fullTextOpen = ref(false);
const playbackController = getSharedMessageAudioPlayback();
const playback = ref<MessageAudioSnapshot>({ playing: false, progress: 0, durationMs: 0 });
const elapsedMs = computed(() => playback.value.progress * playback.value.durationMs);
const revealedWords = computed(() => revealedTranscriptWords(words.value, elapsedMs.value));
let unsubscribe: (() => void) | undefined;

watch(() => props.message.id, () => {
  unsubscribe?.();
  fullTextOpen.value = false;
  const duration = Number((props.message.payload as { durationMs?: number } | undefined)?.durationMs) || 0;
  unsubscribe = playbackController.subscribe(props.message.id, "", duration, (snapshot) => { playback.value = snapshot; });
}, { immediate: true });
onBeforeUnmount(() => unsubscribe?.());
const transcriptOpen = ref(true);
const transcriptId = useId();

watch(() => props.message.id, () => {
  transcriptOpen.value = true;
});

onMounted(() => {
  void ensureAsrCapability();
});
</script>

<template>
  <template v-if="transcript">
    <div class="voice-transcript-row" @click.stop>
      <button
        class="voice-transcript-chip"
        type="button"
        :aria-expanded="transcriptOpen"
        :aria-controls="transcriptId"
        @click="transcriptOpen = !transcriptOpen"
      >{{ transcriptOpen ? "收起文字" : "展开文字" }}</button>
      <button v-if="words.length && transcriptOpen" class="voice-transcript-chip" type="button" @click="fullTextOpen = !fullTextOpen">
        {{ fullTextOpen ? "播放字幕" : "查看全文" }}
      </button>
      <button v-if="showChip" class="voice-transcript-chip" type="button" :disabled="isTranscriptBusy(message)" @click="transcribeVoice(message)">
        {{ isTranscriptBusy(message) ? "识别中…" : "生成同步字幕" }}
      </button>
      <small v-if="transcriptNotice" class="voice-transcript-notice" role="status">{{ transcriptNotice }}</small>
    </div>
    <div v-show="transcriptOpen" :id="transcriptId" class="voice-transcript-bubble">
      <template v-if="words.length && !fullTextOpen">
        <span v-for="(word, index) in revealedWords" :key="index" :class="{ 'voice-transcript-current': elapsedMs < word.endMs }">{{ word.text }}</span>
        <small v-if="!revealedWords.length" class="voice-transcript-notice">播放语音，文字会随进度显示</small>
      </template>
      <template v-else>{{ transcript }}</template>
    </div>
  </template>
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
