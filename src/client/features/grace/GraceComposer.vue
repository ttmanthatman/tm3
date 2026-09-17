<script setup lang="ts">
import { Image as ImageIcon, Mic, Pause, Play, Square, Trash2, X } from "lucide-vue-next";
import { ref, type ComponentPublicInstance } from "vue";
import AppModal from "../../components/ui/AppModal.vue";
import type { useGrace } from "./useGrace";

// 「记录恩典」提交弹窗：文字（可选）+ 录音 + 可选照片，文字或语音至少其一。
// 交互模式复用 ComposerBar 的 voice-drawer；全部状态由 useGrace 持有。
const props = defineProps<{
  grace: ReturnType<typeof useGrace>;
}>();

const {
  graceComposerOpen,
  graceBusy,
  graceError,
  graceContent,
  gracePhotoPreview,
  graceCanSubmit,
  handleGracePhotoPick,
  clearGracePhoto,
  closeGraceComposer,
  submitGrace,
  isRecording,
  audioPreviewUrl,
  audioPreviewWaveform,
  audioPreviewDurationMs,
  previewAudioEl,
  previewPlaying,
  previewProgress,
  recordingDuration,
  recordingStatus,
  recordingNotice,
  resetRecording,
  startRecording,
  stopRecording,
  formatDuration,
  voiceBarStyle,
  togglePreviewPlayback,
  updatePreviewProgress,
  syncPreviewMetadata,
  endPreviewPlayback
} = props.grace;

const gracePhotoInput = ref<HTMLInputElement | null>(null);

function bindPreviewAudioEl(el: Element | ComponentPublicInstance | null) {
  previewAudioEl.value = (el as HTMLAudioElement | null) ?? null;
}

function handlePhotoPick(event: Event) {
  handleGracePhotoPick(event);
  (event.target as HTMLInputElement).value = "";
}
</script>

<template>
  <AppModal
    :open="graceComposerOpen"
    content-class="grace-composer-modal"
    :busy="graceBusy"
    aria-label="记录恩典"
    close-label="关闭恩典记录"
    @close="closeGraceComposer()"
  >
    <template #header>
      <span class="grace-modal-title">记录恩典</span>
    </template>
    <form class="form-grid modal-form grace-composer-form" @submit.prevent="submitGrace">
      <textarea
        v-model="graceContent"
        rows="5"
        placeholder="记下这一刻的恩典……也可以只录一段语音"
        :disabled="graceBusy"
      ></textarea>

      <div class="grace-voice-block">
        <p v-if="recordingNotice" class="voice-recording-notice" role="alert">{{ recordingNotice }}</p>
        <div v-if="!audioPreviewUrl" class="record-strip" :class="{ recording: isRecording }">
          <span class="record-dot"></span>
          <strong>{{ recordingStatus || "点击麦克风录一段感恩的话" }}</strong>
          <small>{{ formatDuration(recordingDuration) }}</small>
          <button v-if="isRecording" type="button" class="icon-btn" aria-label="停止录音" @click="stopRecording"><Square :size="18" /></button>
          <button v-else type="button" class="icon-btn" aria-label="开始录音" :disabled="graceBusy" @click="startRecording"><Mic :size="18" /></button>
        </div>
        <div v-else class="voice-preview">
          <audio
            :ref="bindPreviewAudioEl"
            class="hidden"
            :src="audioPreviewUrl"
            preload="metadata"
            @timeupdate="updatePreviewProgress"
            @loadedmetadata="syncPreviewMetadata"
            @ended="endPreviewPlayback"
            @pause="previewPlaying = false"
          ></audio>
          <button type="button" class="icon-btn danger" aria-label="删除录音" :disabled="graceBusy" @click="resetRecording"><Trash2 :size="18" /></button>
          <div class="voice-preview-card grace-voice-preview-card">
            <button type="button" class="preview-play" :aria-label="previewPlaying ? '暂停预览' : '播放预览'" @click="togglePreviewPlayback">
              <Pause v-if="previewPlaying" :size="20" />
              <Play v-else :size="20" />
            </button>
            <div class="preview-waveform">
              <span
                v-for="(bar, idx) in audioPreviewWaveform"
                :key="idx"
                class="voice-bar"
                :class="{ active: idx / audioPreviewWaveform.length <= previewProgress }"
                :style="voiceBarStyle(bar, idx, audioPreviewWaveform.length, previewProgress)"
              ></span>
            </div>
            <span>{{ formatDuration(audioPreviewDurationMs) }}</span>
          </div>
        </div>
      </div>

      <div class="grace-attach-row">
        <button class="mini-btn secondary" type="button" :disabled="graceBusy" @click="gracePhotoInput?.click()">
          <ImageIcon :size="15" />附上照片
        </button>
        <span v-if="gracePhotoPreview" class="grace-photo-chip">
          <img :src="gracePhotoPreview" alt="已选照片预览" />
          <button class="icon-btn" type="button" :disabled="graceBusy" aria-label="移除照片" @click="clearGracePhoto">
            <X :size="14" />
          </button>
        </span>
      </div>
      <input ref="gracePhotoInput" class="hidden" type="file" accept="image/*" @change="handlePhotoPick" />

      <p v-if="graceError" class="form-error">{{ graceError }}</p>
      <div class="confirm-actions">
        <button class="mini-btn secondary" type="button" :disabled="graceBusy" @click="closeGraceComposer()">取消</button>
        <button class="grace-submit-btn" type="submit" :disabled="graceBusy || !graceCanSubmit">
          {{ graceBusy ? "正在存入…" : "存入恩典册" }}
        </button>
      </div>
    </form>
  </AppModal>
</template>
