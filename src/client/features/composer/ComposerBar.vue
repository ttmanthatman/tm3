<script setup lang="ts">
import { ref, type CSSProperties, type ComponentPublicInstance, type Ref } from "vue";
import {
  AudioLines,
  CheckCircle2,
  FileUp,
  HeartHandshake,
  Image as ImageIcon,
  Mic,
  Monitor,
  Pause,
  PenLine,
  Play,
  Plus,
  Sparkles,
  RotateCcw,
  Send,
  Square,
  Trash2,
  X
} from "lucide-vue-next";
import type { MessageDTO, MusicTrackDTO } from "@shared/types";
import AvatarImage from "../../components/ui/AvatarImage.vue";
import type { SlashCommandSuggestion } from "./useComposer";
import type { UnconfirmedSend } from "./unconfirmedSends";
import type { ComposerPlaceholderPhase } from "./useComposerPlaceholder";

// Presentation-only home of the chat composer: the textarea, voice/more
// drawers and the suggestion menu moved here verbatim from App.vue. All state
// and behavior still live in App.vue and its composables; they arrive as
// props (values + handlers) or as v-model pairs for the few refs the template
// mutates directly.
type MentionMember = {
  id: number;
  accountId?: number;
  kind: string;
  username?: string;
  displayName: string;
  avatarPath?: string | null;
};

const input = defineModel<string>("input", { required: true });
const replyTo = defineModel<MessageDTO | null>("replyTo", { required: true });
const composerFocused = defineModel<boolean>("composerFocused", { required: true });
const keepOriginalImages = defineModel<boolean>("keepOriginalImages", { required: true });
const previewPlaying = defineModel<boolean>("previewPlaying", { required: true });

const props = defineProps<{
  selectedMusicMention: MusicTrackDTO | null;
  prayerComposerPhotoPreview: string;
  composerPanel: "voice" | "more" | null;
  composerPromptText: string;
  composerPromptPhase: ComposerPlaceholderPhase;
  composerPromptChars: string[];
  prayerOnly: boolean;
  graceOnly: boolean;
  canSendText: boolean;
  canSubmitText: boolean;
  socketReadyToSend: boolean;
  messageSendPending: boolean;
  handwritingAvailable: boolean;
  handwritingPending: { clientRequestId: string } | null;
  retryHandwriting: () => void;
  openHandwriting: () => void;
  composerSendStatus: string;
  composerSendState: string | undefined;
  unconfirmedSends: UnconfirmedSend[];
  retryUnconfirmed: (row: UnconfirmedSend) => void;
  showComposerSuggestionMenu: boolean;
  activeComposerSuggestionKind: "music" | "mention" | "effect" | null;
  matchingMusicMentionTracks: MusicTrackDTO[];
  composerSuggestionIndex: number;
  matchingMentionMembers: MentionMember[];
  matchingSlashCommands: SlashCommandSuggestion[];
  recordingNotice: string;
  audioPreviewUrl: string;
  isRecording: boolean;
  recordingStatus: string;
  recordingDuration: number;
  audioPreviewWaveform: number[];
  previewProgress: number;
  audioPreviewDurationMs: number;
  voiceSending: boolean;
  previewAudioEl: Ref<HTMLAudioElement | null>;
  replyPreviewText: (message: MessageDTO) => string;
  removeMusicMention: () => void;
  clearPrayerComposerPhoto: () => void;
  toggleVoicePanel: () => void;
  focusComposer: () => void;
  syncComposerCaret: () => void;
  composerPromptCharStyle: (index: number) => CSSProperties;
  onInput: () => void;
  onKeydown: (event: KeyboardEvent) => void;
  handleComposerPaste: (event: ClipboardEvent) => void;
  sendText: () => void;
  toggleMorePanel: () => void;
  handlePickedFile: (event: Event) => void;
  handlePickedFiles: (event: Event) => void;
  chooseMusicMentionSuggestion: (track: MusicTrackDTO) => void;
  chooseMentionSuggestion: (member: { displayName: string }) => void;
  chooseSlashCommand: (item: SlashCommandSuggestion) => void;
  avatarText: (name: string) => string;
  isAccountOnline: (accountId?: number | null) => boolean;
  formatDuration: (ms: number) => string;
  stopRecording: () => void;
  startRecording: () => void;
  updatePreviewProgress: () => void;
  syncPreviewMetadata: () => void;
  endPreviewPlayback: () => void;
  resetRecording: () => void;
  togglePreviewPlayback: () => void;
  voiceBarStyle: (bar: number, index: number, total: number, progress: number) => CSSProperties;
  sendVoice: () => void;
  openChainModal: () => void;
  startPrayerComposer: () => void;
  openGraceComposer: () => void;
  openSermonWorkspace: () => void;
}>();

// App.vue keeps owning the textarea element (draft restore, caret sync,
// mention insertion); it reads the element back through this expose.
const composerInput = ref<HTMLTextAreaElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const photoInput = ref<HTMLInputElement | null>(null);

function bindPreviewAudioEl(el: Element | ComponentPublicInstance | null) {
  props.previewAudioEl.value = (el as HTMLAudioElement | null) ?? null;
}

defineExpose({ composerInput });
</script>

<template>
  <footer class="composer">
    <div v-if="replyTo" class="reply-bar">
      <button class="icon-btn" @click="replyTo = null" aria-label="取消引用"><X :size="16" /></button>
      <span>引用 {{ replyTo.sender.displayName }}：{{ replyPreviewText(replyTo) || replyTo.type }}</span>
    </div>
    <div v-if="selectedMusicMention" class="music-mention-chip">
      <AudioLines :size="17" />
      <span><small>已提及歌曲</small><strong>{{ selectedMusicMention.title }}</strong></span>
      <button class="icon-btn" type="button" @click="removeMusicMention" aria-label="取消提及歌曲"><X :size="16" /></button>
    </div>
    <div v-if="prayerComposerPhotoPreview" class="music-mention-chip prayer-photo-chip">
      <img :src="prayerComposerPhotoPreview" alt="代祷附带照片预览" />
      <span><small>已附照片</small><strong>随代祷一起发送</strong></span>
      <button class="icon-btn" type="button" @click="clearPrayerComposerPhoto" aria-label="移除附带照片"><X :size="16" /></button>
    </div>
    <div class="composer-input-shell">
      <div class="composer-main" :class="{ raised: composerPanel }">
        <button class="icon-btn composer-edge-btn" :class="{ active: composerPanel === 'voice' }" @click="toggleVoicePanel" aria-label="语音消息"><Mic :size="22" /></button>
        <div class="composer-glow-shell" :class="{ on: composerFocused }">
          <textarea
            ref="composerInput"
            v-model="input"
            rows="1"
            :class="{ 'composer-glow': composerFocused }"
            :placeholder="composerPromptText ? '' : (prayerOnly ? '输入代祷事项' : graceOnly ? '记录一件恩典' : '')"
            @focus="composerFocused = true; focusComposer(); syncComposerCaret()"
            @blur="composerFocused = false"
            @input="onInput"
            @click="syncComposerCaret"
            @keyup="syncComposerCaret"
            @keydown="onKeydown"
            @paste="handleComposerPaste"
          ></textarea>
        </div>
        <span
          v-if="!input.trim() && composerPromptText"
          class="composer-prompt-overlay"
          :class="`phase-${composerPromptPhase}`"
          aria-hidden="true"
        ><span
            v-for="(char, index) in composerPromptChars"
            :key="index"
            class="composer-prompt-char"
            :style="composerPromptCharStyle(index)"
          >{{ char }}</span></span>
        <button
          v-if="canSendText"
          class="send-btn composer-edge-btn composer-send-btn"
          :disabled="!canSubmitText"
          :aria-label="messageSendPending ? '正在发送' : '发送'"
          :title="composerSendStatus || '发送'"
          @click="sendText"
        ><Send :size="19" /></button>
        <button v-else class="icon-btn composer-edge-btn" :class="{ active: composerPanel === 'more' }" @click="toggleMorePanel" aria-label="更多功能"><Plus :size="22" /></button>
        <input ref="fileInput" class="hidden" type="file" @change="handlePickedFile" />
        <input ref="photoInput" class="hidden" type="file" accept="image/*" multiple @change="handlePickedFiles" />
      </div>
      <small
        v-if="composerSendStatus"
        class="composer-send-status"
        :data-send-state="composerSendState"
        role="status"
        aria-live="polite"
      >{{ composerSendStatus }}</small>
      <div v-if="unconfirmedSends.length" class="composer-unconfirmed" role="status">
        <div v-for="row in unconfirmedSends" :key="row.clientRequestId" class="composer-unconfirmed-row">
          <span>未确认 · {{ row.draft.slice(0, 40) }}</span>
          <button type="button" :disabled="messageSendPending || !socketReadyToSend" @click="retryUnconfirmed(row)">重试</button>
        </div>
      </div>
      <div v-if="handwritingPending" class="composer-unconfirmed" role="status">
        <div class="composer-unconfirmed-row">
          <span>未确认 · [手写消息]</span>
          <button type="button" :disabled="messageSendPending || !socketReadyToSend" @click="retryHandwriting">重试</button>
        </div>
      </div>
      <div v-if="showComposerSuggestionMenu" class="composer-suggestion-menu">
        <template v-if="activeComposerSuggestionKind === 'music'">
          <button
            v-for="(track, index) in matchingMusicMentionTracks"
            :key="track.id"
            type="button"
            class="composer-suggestion music-suggestion"
            :class="{ active: index === composerSuggestionIndex }"
            @click="chooseMusicMentionSuggestion(track)"
          >
            <AudioLines :size="18" />
            <span>{{ track.title }}</span>
            <small>热度 {{ track.heat }}</small>
          </button>
        </template>
        <template v-else-if="activeComposerSuggestionKind === 'mention'">
          <button
            v-for="(member, index) in matchingMentionMembers"
            :key="member.id"
            type="button"
            class="composer-suggestion"
            :class="{ active: index === composerSuggestionIndex }"
            @click="chooseMentionSuggestion(member)"
          >
            <div class="avatar presence-avatar" :class="{ bot: member.kind === 'virtual' }">
              <AvatarImage :path="member.avatarPath">
                <span>{{ avatarText(member.displayName) }}</span>
              </AvatarImage>
              <i v-if="isAccountOnline(member.accountId)" class="online-dot" aria-label="在线"></i>
            </div>
            <span>{{ member.displayName }}</span>
            <small>{{ member.username ? `@${member.username}` : member.kind === 'virtual' ? '虚拟角色' : '频道成员' }}</small>
          </button>
        </template>
        <template v-else>
          <button
            v-for="(item, index) in matchingSlashCommands"
            :key="item.command"
            type="button"
            class="composer-suggestion"
            :class="{ active: index === composerSuggestionIndex }"
            @click="chooseSlashCommand(item)"
          >
            <component :is="item.icon" :size="18" />
            <span>{{ item.command }}</span>
            <small>{{ item.hint }}</small>
          </button>
        </template>
      </div>
    </div>
    <div v-if="composerPanel === 'voice'" class="composer-drawer voice-drawer">
      <p v-if="recordingNotice" class="voice-recording-notice" role="alert">{{ recordingNotice }}</p>
      <div v-if="!audioPreviewUrl" class="record-strip" :class="{ recording: isRecording }">
        <span class="record-dot"></span>
        <strong>{{ recordingStatus || "点击麦克风开始录音" }}</strong>
        <small>{{ formatDuration(recordingDuration) }}</small>
        <button v-if="isRecording" class="icon-btn" @click="stopRecording" aria-label="停止录音"><Square :size="18" /></button>
        <button v-else class="icon-btn" @click="startRecording" aria-label="重新录音"><RotateCcw :size="18" /></button>
      </div>
      <div v-if="audioPreviewUrl" class="voice-preview">
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
        <button class="icon-btn danger" @click="resetRecording" aria-label="删除录音"><Trash2 :size="18" /></button>
        <div class="voice-preview-card">
          <button class="preview-play" @click="togglePreviewPlayback" :aria-label="previewPlaying ? '暂停预览' : '播放预览'">
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
        <button class="send-btn" :disabled="voiceSending" @click="sendVoice">{{ voiceSending ? "发送中" : "发送" }}</button>
      </div>
    </div>
    <div v-if="composerPanel === 'more'" class="composer-drawer more-drawer">
      <button
        v-if="handwritingAvailable"
        class="tool-tile"
        :disabled="!!handwritingPending"
        :title="handwritingPending ? '先确认或重试未发送的手写消息' : '逐字手写'"
        @click="toggleMorePanel(); openHandwriting()"
      >
        <span><PenLine :size="25" /></span>
        <small>手写</small>
      </button>
      <button class="tool-tile" @click="fileInput?.click()">
        <span><FileUp :size="25" /></span>
        <small>文件</small>
      </button>
      <div class="tool-tile-wrap photo-tool-wrap">
        <button class="tool-tile" @click="photoInput?.click()">
          <span><ImageIcon :size="25" /></span>
          <small>照片</small>
        </button>
        <label class="original-image-corner" :class="{ active: keepOriginalImages }" title="保留原图">
          <input v-model="keepOriginalImages" type="checkbox" />
          <span class="original-image-check"><CheckCircle2 v-if="keepOriginalImages" :size="13" /></span>
          <small>原图</small>
        </label>
      </div>
      <button class="tool-tile" @click="openChainModal">
        <span><Plus :size="25" /></span>
        <small>接龙</small>
      </button>
      <button class="tool-tile" @click="startPrayerComposer">
        <span><HeartHandshake :size="25" /></span>
        <small>代祷</small>
      </button>
      <button class="tool-tile" @click="toggleMorePanel(); openGraceComposer()">
        <span><Sparkles :size="25" /></span>
        <small>数算恩典</small>
      </button>
      <button class="tool-tile" @click="openSermonWorkspace">
        <span><Monitor :size="25" /></span>
        <small>讲道台</small>
      </button>
    </div>
  </footer>
</template>
