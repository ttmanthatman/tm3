<script setup lang="ts">
import { AudioLines, BookOpen, ChevronDown, ChevronRight, Download, FileUp, Mic, Pause, Play, Square } from "lucide-vue-next";
import type { BibleLookupDTO, LinkPreviewDTO, MessageDTO } from "@shared/types";
import type { ImageDimensions } from "@shared/imageDimensions";
import InlineAudioPlayer from "../../components/InlineAudioPlayer.vue";
import {
  isMarkdownMessage,
  messageBibleReferenceScope,
  musicMentionPayload,
  previewSiteName,
  type BibleRichTextSegment
} from "./messageRendering";

// Shared message-body renderer: the timeline bubble and the favorites card both
// delegate their type branches here. Rendering differences between the two
// surfaces are parameterized by `variant`; interactive state (long press,
// previews, playback, bible references) stays in App.vue and arrives through
// props/emits.
defineProps<{
  message: MessageDTO;
  variant: "timeline" | "favorite";
  fileUrl: (message: MessageDTO) => string;
  fileThumbUrl: (message: MessageDTO) => string;
  compactBytes: (size?: number | null) => string;
  formatDuration: (ms: number) => string;
  isAudioMessage: (message: MessageDTO) => boolean;
  isVideoMessage: (message: MessageDTO) => boolean;
  isVoiceMessage: (message: MessageDTO) => boolean;
  voiceDurationMs: (message: MessageDTO) => number;
  hasUnlistenedVoice: (message: MessageDTO) => boolean;
  isDocumentMessage: (message: MessageDTO) => boolean;
  documentIconSrc: (message: MessageDTO) => string;
  documentKindLabel: (message: MessageDTO) => string;
  messageImageDimensions: (message: MessageDTO) => ImageDimensions | undefined;
  messageImagePresentationStyle: (message: MessageDTO) => { width: string; aspectRatio: string } | undefined;
  brokenAttachmentIds: Set<number>;
  sharedMusicPlaylistDescription: (message: MessageDTO) => string;
  markdownMessageHtml: (message: MessageDTO) => string;
  messageContentHtml: (message: MessageDTO) => string;
  messageRichTextSegments: (message: MessageDTO) => BibleRichTextSegment[];
  linkPreviewFor: (message: MessageDTO) => LinkPreviewDTO | null;
  musicMentionTextHtml: (message: MessageDTO) => string;
  musicMentionTitle: (message: MessageDTO) => string;
  musicMentionBackground: (message: MessageDTO) => string;
  isMentionedMusicPlaying: (message: MessageDTO) => boolean;
  isMusicMentionBackgroundExpanded: (message: MessageDTO) => boolean;
  isBibleReferenceExpanded: (scope: string | number, reference: string) => boolean;
  isBibleReferenceBusy: (scope: string | number, reference: string) => boolean;
  bibleReferenceLookup: (scope: string | number, reference: string) => BibleLookupDTO | null | undefined;
  formatBibleLookup: (lookup: BibleLookupDTO | null | undefined, originalReference: string) => string;
}>();

const emit = defineEmits<{
  "open-shared-playlist": [message: MessageDTO];
  "longpress-begin": [message: MessageDTO, event: PointerEvent];
  "longpress-move": [event: PointerEvent];
  "longpress-clear": [];
  "open-attachment": [message: MessageDTO, event: MouseEvent];
  "image-load": [message: MessageDTO, event: Event];
  "image-error": [message: MessageDTO];
  "voice-play": [message: MessageDTO];
  "voice-download": [message: MessageDTO, event: MouseEvent];
  "toggle-mentioned-music": [message: MessageDTO];
  "stop-mentioned-music": [message: MessageDTO];
  "toggle-music-mention-background": [message: MessageDTO];
  "toggle-bible-reference": [scope: string | number, reference: string];
  "open-bible-reference": [scope: string | number, reference: string];
}>();
</script>

<template>
  <template v-if="variant === 'favorite'">
    <img v-if="message.type === 'image'" class="favorite-message-image" :src="fileUrl(message)" loading="lazy" alt="收藏的图片" />
    <div v-else-if="isVoiceMessage(message)" class="favorite-message-file"><Mic :size="19" /><span>语音消息 · {{ formatDuration(voiceDurationMs(message)) }}</span></div>
    <div v-else-if="message.type === 'file'" class="favorite-message-file"><FileUp :size="19" /><span>{{ message.fileName || "附件" }}</span><small>{{ compactBytes(message.fileSize) }}</small></div>
    <button v-else-if="message.type === 'music_playlist'" class="music-playlist-message-card" type="button" @click="emit('open-shared-playlist', message)">
      <span class="music-playlist-message-icon"><AudioLines :size="25" /></span>
      <span v-if="message.musicPlaylist" class="music-playlist-message-copy"><strong>{{ message.musicPlaylist.name }}</strong><em>{{ message.musicPlaylist.trackCount }} 首</em></span>
      <span v-else class="music-playlist-message-copy"><small>共享歌单</small><strong>歌单已删除</strong></span>
      <ChevronRight :size="18" />
    </button>
    <div v-else-if="isMarkdownMessage(message)" class="message-text markdown-render" v-html="markdownMessageHtml(message)"></div>
    <div v-else class="message-text" v-html="messageContentHtml(message)"></div>
  </template>
  <template v-else>
    <template v-if="message.type === 'music_playlist'">
      <p v-if="sharedMusicPlaylistDescription(message)" class="music-playlist-message-text">{{ sharedMusicPlaylistDescription(message) }}</p>
      <button
        class="music-playlist-message-card"
        type="button"
        @pointerdown.stop="emit('longpress-begin', message, $event)"
        @pointermove.stop="emit('longpress-move', $event)"
        @pointerup.stop="emit('longpress-clear')"
        @pointercancel.stop="emit('longpress-clear')"
        @pointerleave.stop="emit('longpress-clear')"
        @click.stop="emit('open-shared-playlist', message)"
      >
        <span class="music-playlist-message-icon"><AudioLines :size="25" /></span>
        <span v-if="message.musicPlaylist" class="music-playlist-message-copy">
          <strong>{{ message.musicPlaylist.name }}</strong>
          <em>{{ message.musicPlaylist.trackCount }} 首<template v-if="message.musicPlaylist.tracks.length"> · {{ message.musicPlaylist.tracks.slice(0, 3).map((track) => track.title).join('、') }}</template></em>
        </span>
        <span v-else class="music-playlist-message-copy"><small>共享歌单</small><strong>歌单已删除</strong><em>创建者已移除这个歌单</em></span>
        <ChevronRight :size="18" />
      </button>
    </template>
    <template v-else-if="message.type === 'image'">
      <p v-if="brokenAttachmentIds.has(message.id)" class="attachment-broken">转发附件已被删除</p>
      <button
        v-else
        class="image-preview-button"
        :class="{ 'image-preview-sized': !!messageImageDimensions(message) }"
        :style="messageImagePresentationStyle(message)"
        aria-label="查看图片"
        @click.stop="emit('open-attachment', message, $event)"
      >
        <img
          class="chat-image"
          :src="fileThumbUrl(message)"
          :width="messageImageDimensions(message)?.width"
          :height="messageImageDimensions(message)?.height"
          loading="lazy"
          decoding="async"
          fetchpriority="low"
          @load="emit('image-load', message, $event)"
          @error="emit('image-error', message)"
          alt=""
        />
      </button>
    </template>
    <InlineAudioPlayer
      v-else-if="isAudioMessage(message)"
      :message="message"
      :src="fileUrl(message)"
      :unread="hasUnlistenedVoice(message)"
      @play="emit('voice-play', message)"
      @download="emit('voice-download', message, $event)"
    />
    <template v-else-if="isVideoMessage(message)">
      <button class="media-file-card video-file-card" @click.stop="emit('open-attachment', message, $event)">
        <span class="media-file-icon"><Play :size="22" /></span>
        <span>{{ message.fileName }}</span>
        <small>{{ compactBytes(message.fileSize) }}</small>
      </button>
    </template>
    <template v-else-if="message.type === 'file'">
      <button class="file-card" data-file-card @click.stop="emit('open-attachment', message, $event)">
        <img v-if="isDocumentMessage(message)" class="file-card-icon" :src="documentIconSrc(message)" alt="" />
        <span v-else class="generic-file-icon"><Download :size="18" /></span>
        <span>{{ message.fileName }}</span>
        <small>{{ documentKindLabel(message) }} · {{ compactBytes(message.fileSize) }}</small>
      </button>
    </template>
    <template v-else>
      <template v-if="musicMentionPayload(message)">
        <div class="message-text music-mention-text" v-html="musicMentionTextHtml(message)"></div>
        <div
          class="music-mention-capsule"
          :class="{ playing: isMentionedMusicPlaying(message) }"
          role="group"
          :aria-label="`${musicMentionTitle(message)}播放控制`"
          @click.stop
          @pointerdown.stop
        >
          <button
            v-if="!isMentionedMusicPlaying(message)"
            type="button"
            class="music-mention-capsule-action music-mention-capsule-play"
            @click="emit('toggle-mentioned-music', message)"
            aria-label="播放歌曲"
          >
            <Play :size="16" fill="currentColor" />
            <span>播放</span>
          </button>
          <template v-else>
            <button type="button" class="music-mention-capsule-action music-mention-capsule-stop" @click="emit('stop-mentioned-music', message)" aria-label="停止歌曲">
              <Square :size="13" fill="currentColor" />
              <span>停止</span>
            </button>
            <i class="music-mention-capsule-divider" aria-hidden="true"></i>
            <button type="button" class="music-mention-capsule-action music-mention-capsule-pause" @click="emit('toggle-mentioned-music', message)" aria-label="暂停歌曲">
              <Pause :size="15" fill="currentColor" />
              <span>暂停</span>
            </button>
          </template>
        </div>
        <button
          v-if="musicMentionBackground(message)"
          type="button"
          class="music-mention-background-toggle"
          :class="{ expanded: isMusicMentionBackgroundExpanded(message) }"
          :aria-expanded="isMusicMentionBackgroundExpanded(message)"
          aria-label="展开或收起写作背景"
          @click.stop="emit('toggle-music-mention-background', message)"
          @pointerdown.stop
        >
          <BookOpen :size="13" />
          <span>写作背景</span>
          <ChevronDown :size="13" class="music-mention-background-chevron" />
        </button>
        <div
          v-if="isMusicMentionBackgroundExpanded(message) && musicMentionBackground(message)"
          class="music-mention-background"
        >{{ musicMentionBackground(message) }}</div>
      </template>
      <template v-else>
        <div v-if="isMarkdownMessage(message)" class="message-text markdown-render" v-html="markdownMessageHtml(message)"></div>
        <div v-else class="message-text bible-rich-text">
          <template v-for="segment in messageRichTextSegments(message)" :key="segment.key">
            <span v-if="segment.kind === 'html'" v-html="segment.html"></span>
            <span v-else class="inline-bible-reference" :class="segment.className" @click.stop>
              <button class="inline-bible-btn" type="button" @click.stop="emit('toggle-bible-reference', messageBibleReferenceScope(message, 'content'), segment.reference)">
                <BookOpen :size="13" />{{ segment.reference }}
              </button>
              <span v-if="isBibleReferenceExpanded(messageBibleReferenceScope(message, 'content'), segment.reference)" class="inline-bible-popover">
                <span v-if="isBibleReferenceBusy(messageBibleReferenceScope(message, 'content'), segment.reference)" class="inline-bible-empty">正在查找经文...</span>
                <template v-else-if="bibleReferenceLookup(messageBibleReferenceScope(message, 'content'), segment.reference)?.verses.length">
                  <small>{{ bibleReferenceLookup(messageBibleReferenceScope(message, 'content'), segment.reference)?.translation }}</small>
                  <span class="inline-bible-passage"><span class="inline-bible-body">{{ formatBibleLookup(bibleReferenceLookup(messageBibleReferenceScope(message, 'content'), segment.reference), segment.reference) }}</span><button class="inline-bible-reader-link" type="button" title="在圣经中阅读" aria-label="在圣经中阅读并高亮这处经文" @click.stop="emit('open-bible-reference', messageBibleReferenceScope(message, 'content'), segment.reference)"><BookOpen :size="15" /></button></span>
                </template>
                <span v-else class="inline-bible-empty">暂时找不到这处经文</span>
              </span>
            </span>
          </template>
        </div>
        <a v-if="linkPreviewFor(message)" class="link-preview-card" :href="linkPreviewFor(message)?.url" target="_blank" rel="noopener noreferrer" @click.stop>
          <span class="link-preview-copy">
            <small>{{ previewSiteName(linkPreviewFor(message)) }}</small>
            <strong>{{ linkPreviewFor(message)?.title }}</strong>
            <em v-if="linkPreviewFor(message)?.description">{{ linkPreviewFor(message)?.description }}</em>
          </span>
          <img v-if="linkPreviewFor(message)?.image" :src="linkPreviewFor(message)?.image" alt="" loading="lazy" />
        </a>
      </template>
    </template>
  </template>
</template>
