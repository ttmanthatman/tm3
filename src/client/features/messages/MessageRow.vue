<script setup lang="ts">
import { computed, watch } from "vue";
import { AudioLines, BookOpen, ChevronDown, ChevronRight, Download, FileUp, Mic, Pause, Play, Square } from "lucide-vue-next";
import type { BibleLookupDTO, LinkPreviewDTO, MessageDTO } from "@shared/types";
import type { ImageDimensions } from "@shared/imageDimensions";
import InlineAudioPlayer from "../../components/InlineAudioPlayer.vue";
import VoiceTranscript from "../voice/VoiceTranscript.vue";
import NoteCard from "../bible/notes/NoteCard.vue";
import { bibleNotePayload } from "@shared/bibleNotes";
import CopyworkCard from "../bible/copywork/CopyworkCard.vue";
import { copyworkPayload } from "@shared/bibleCopywork";
import HandwritingMessage from "../handwriting/HandwritingMessage.vue";
import {
  isMarkdownMessage,
  messageBibleReferenceScope,
  messageScriptureOnlyReference,
  musicMentionPayload,
  previewSiteName,
  type BibleRichTextSegment
} from "./messageRendering";
import { storyAnnouncementLetters } from "./storyAnnouncement";
import BookNoteShareCard from "../books/BookNoteShareCard.vue";
import { bookNoteSharePayload } from "@shared/bookNotes";
import BiblePassageShareCard from "../bible/BiblePassageShareCard.vue";
import BibleScriptureCard from "../bible/BibleScriptureCard.vue";
import { biblePassageMessagePayload } from "@shared/biblePassages";
import BibleTopicShareCard from "../bible/BibleTopicShareCard.vue";
import { bibleTopicMessagePayload } from "@shared/bibleTopics";
import { parseBiblePassageShare, parseLegacyMergedBiblePassages, readingNoteComment } from "../reading-shares/readingShareMessage";
import BookShareCard from "../books/BookShareCard.vue";
import { parseBookShareMessage } from "../books/bookShareMessage";
import ListenPlaylistCard from "../listen/ListenPlaylistCard.vue";
import { listenPlaylistPayload } from "@shared/listenPlaylist";
import type { ListenSessionSnapshot } from "../listen/useListenSession";

// Shared message-body renderer: the timeline bubble and the favorites card both
// delegate their type branches here. Rendering differences between the two
// surfaces are parameterized by `variant`; interactive state (long press,
// previews, playback, bible references) stays in App.vue and arrives through
// props/emits.
const props = defineProps<{
  message: MessageDTO;
  openBiblePassage: (lookup: BibleLookupDTO) => Promise<void>;
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
  ensureBibleReferenceLookup: (scope: string | number, reference: string) => void;
  formatBibleLookup: (lookup: BibleLookupDTO | null | undefined, originalReference: string) => string;
  canPlayBibleAudio?: (message: MessageDTO) => boolean;
  playBibleAudio?: (message: MessageDTO) => Promise<unknown>;
  consumeHandwritingPlayback?: (message: MessageDTO) => boolean;
  handwritingSurfaceActive?: boolean;
  /** 「/听」清单：这条消息正在播放时返回会话快照，否则 null */
  listenSessionFor?: (message: MessageDTO) => ListenSessionSnapshot | null;
}>();

const bookNoteShare = computed(() => props.message.type === "text" ? bookNoteSharePayload(props.message.payload) : null);
const bookShare = computed(() => props.message.type === "text" ? parseBookShareMessage(props.message.content, window.location.origin) : null);
const listenPlaylist = computed(() => props.message.type === "text" ? listenPlaylistPayload(props.message.payload) : null);

const passageShare = computed(() => props.message.type === "text" ? (biblePassageMessagePayload(props.message.payload) || parseLegacyMergedBiblePassages(props.message.content)) : null);
// Keep the card action stable while the audio manifest loads or recovers.
const playScripture = computed(() => props.playBibleAudio ? () => props.playBibleAudio!(props.message) : undefined);
const bibleShare = computed(() => props.message.type === "text" ? parseBiblePassageShare(props.message.content) : null);
const bibleTopicShare = computed(() => props.message.type === "text" && !bibleShare.value ? bibleTopicMessagePayload(props.message.payload) : null);
const noteComment = computed(() => bookNoteShare.value ? readingNoteComment(props.message.content, bookNoteShare.value.note.bookTitle) : "");

// 整条消息只有一处经文引用：拉取经文后以经文卡片形态展示（取不到则回退普通气泡）
const scriptureOnly = computed(() => {
  const reference = messageScriptureOnlyReference(props.message);
  if (!reference) return null;
  if (passageShare.value || bibleShare.value || bibleTopicShare.value || bookNoteShare.value || bookShare.value || listenPlaylist.value) return null;
  return { reference, scope: messageBibleReferenceScope(props.message, "content") };
});
watch(scriptureOnly, (value) => {
  if (value) props.ensureBibleReferenceLookup(value.scope, value.reference);
}, { immediate: true });
const scriptureOnlyCard = computed(() => {
  const base = scriptureOnly.value;
  if (!base) return null;
  const lookup = props.bibleReferenceLookup(base.scope, base.reference);
  if (!lookup?.verses.length) return null;
  return { reference: base.reference, text: lookup.verses.map((verse) => verse.text).join(""), translation: lookup.translation };
});

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
  "listen-toggle": [message: MessageDTO];
  "listen-play-item": [message: MessageDTO, index: number];
  "listen-previous-verse": [];
  "listen-next-verse": [];
  "listen-previous-chapter": [];
  "listen-next-chapter": [];
}>();
</script>

<template>
  <template v-if="variant === 'favorite'">
    <NoteCard v-if="message.type === 'bible_note' && bibleNotePayload(message.payload)" :paper-seed="message.clientRequestId || message.id" :id="bibleNotePayload(message.payload)!.noteId" :reference="bibleNotePayload(message.payload)!.reference" />
    <CopyworkCard v-else-if="message.type === 'bible_copywork' && copyworkPayload(message.payload)" :id="copyworkPayload(message.payload)!.workId" :reference="copyworkPayload(message.payload)!.reference" message :surface-active="handwritingSurfaceActive ?? true" />
    <HandwritingMessage v-else-if="message.type === 'handwriting'" :message="message" variant="favorite" />
    <img v-else-if="message.type === 'image'" class="favorite-message-image" :src="fileUrl(message)" loading="lazy" alt="收藏的图片" />
    <div v-else-if="isVoiceMessage(message)" class="favorite-message-file"><Mic :size="19" /><span>语音消息 · {{ formatDuration(voiceDurationMs(message)) }}</span></div>
    <div v-else-if="message.type === 'file'" class="favorite-message-file"><FileUp :size="19" /><span>{{ message.fileName || "附件" }}</span><small>{{ compactBytes(message.fileSize) }}</small></div>
    <button v-else-if="message.type === 'music_playlist'" class="music-playlist-message-card" type="button" @click="emit('open-shared-playlist', message)">
      <span class="music-playlist-message-icon"><AudioLines :size="25" /></span>
      <span v-if="message.musicPlaylist" class="music-playlist-message-copy"><strong>{{ message.musicPlaylist.name }}</strong><em>{{ message.musicPlaylist.trackCount }} 首</em></span>
      <span v-else class="music-playlist-message-copy"><small>共享歌单</small><strong>歌单已删除</strong></span>
      <ChevronRight :size="18" />
    </button>
    <ListenPlaylistCard
      v-else-if="listenPlaylist"
      :playlist="listenPlaylist"
      :session="listenSessionFor?.(message) ?? null"
      :scope="messageBibleReferenceScope(message, 'content')"
      :bible-reference-lookup="bibleReferenceLookup"
      :ensure-bible-reference-lookup="ensureBibleReferenceLookup"
      :open-passage="openBiblePassage"
      :paper-seed="message.clientRequestId || message.id"
      @toggle="emit('listen-toggle', message)"
      @play-item="(index) => emit('listen-play-item', message, index)"
      @previous-verse="emit('listen-previous-verse')"
      @next-verse="emit('listen-next-verse')"
      @previous-chapter="emit('listen-previous-chapter')"
      @next-chapter="emit('listen-next-chapter')"
    />
    <BookNoteShareCard v-else-if="bookNoteShare" :note="bookNoteShare.note" :content="message.content" :paper-seed="message.clientRequestId || message.id" :comment="noteComment" :active="handwritingSurfaceActive ?? true" />
    <BookShareCard v-else-if="bookShare" :context="bookShare" :paper-seed="message.clientRequestId || message.id" :comment="bookShare.comment" />
    <BibleScriptureCard v-else-if="passageShare" class="bible-passage-share-card" :passages="passageShare.passages" :source-id="'sourceId' in passageShare ? passageShare.sourceId : undefined" :translation="passageShare.translation" :show-translation="passageShare.showTranslation" :paper-seed="message.clientRequestId || message.id" :open-passage="openBiblePassage" :play="playScripture" />
    <BiblePassageShareCard v-else-if="bibleShare" :paper-seed="message.clientRequestId || message.id" :passage="bibleShare" :open-passage="openBiblePassage" :play="playScripture" />
    <BiblePassageShareCard v-else-if="scriptureOnlyCard" :paper-seed="message.clientRequestId || message.id" :passage="scriptureOnlyCard" :open-passage="openBiblePassage" :play="playScripture" />
    <BibleTopicShareCard v-else-if="bibleTopicShare" :paper-seed="message.clientRequestId || message.id" :topic="bibleTopicShare" :open-passage="openBiblePassage" :play="playScripture" />
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
    <template v-else-if="isAudioMessage(message)">
      <InlineAudioPlayer
        :message="message"
        :src="fileUrl(message)"
        :unread="hasUnlistenedVoice(message)"
        @play="emit('voice-play', message)"
        @download="emit('voice-download', message, $event)"
      />
      <VoiceTranscript v-if="isVoiceMessage(message)" :message="message" :src="fileUrl(message)" @play="emit('voice-play', message)" />
    </template>
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
      <ListenPlaylistCard
        v-if="listenPlaylist"
        :playlist="listenPlaylist"
        :session="listenSessionFor?.(message) ?? null"
        :scope="messageBibleReferenceScope(message, 'content')"
        :bible-reference-lookup="bibleReferenceLookup"
        :ensure-bible-reference-lookup="ensureBibleReferenceLookup"
        :open-passage="openBiblePassage"
        :paper-seed="message.clientRequestId || message.id"
        @toggle="emit('listen-toggle', message)"
        @play-item="(index) => emit('listen-play-item', message, index)"
        @previous-verse="emit('listen-previous-verse')"
        @next-verse="emit('listen-next-verse')"
        @previous-chapter="emit('listen-previous-chapter')"
        @next-chapter="emit('listen-next-chapter')"
      />
      <template v-else-if="musicMentionPayload(message)">
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
        <NoteCard v-if="message.type === 'bible_note' && bibleNotePayload(message.payload)" :paper-seed="message.clientRequestId || message.id" :id="bibleNotePayload(message.payload)!.noteId" :reference="bibleNotePayload(message.payload)!.reference" />
        <CopyworkCard v-else-if="message.type === 'bible_copywork' && copyworkPayload(message.payload)" :id="copyworkPayload(message.payload)!.workId" :reference="copyworkPayload(message.payload)!.reference" message :surface-active="handwritingSurfaceActive ?? true" />
        <HandwritingMessage
          v-else-if="message.type === 'handwriting'"
          :message="message"
          variant="timeline"
          :surface-active="handwritingSurfaceActive ?? true"
          :claim-auto-play="consumeHandwritingPlayback ? () => consumeHandwritingPlayback!(message) : undefined"
        />
        <BookNoteShareCard v-else-if="bookNoteShare" :note="bookNoteShare.note" :content="message.content" :paper-seed="message.clientRequestId || message.id" :comment="noteComment" :active="handwritingSurfaceActive ?? true" />
        <BookShareCard v-else-if="bookShare" :context="bookShare" :paper-seed="message.clientRequestId || message.id" :comment="bookShare.comment" />
        <BibleScriptureCard v-else-if="passageShare" class="bible-passage-share-card" :passages="passageShare.passages" :source-id="'sourceId' in passageShare ? passageShare.sourceId : undefined" :translation="passageShare.translation" :show-translation="passageShare.showTranslation" :paper-seed="message.clientRequestId || message.id" :open-passage="openBiblePassage" :play="playScripture" />
        <BiblePassageShareCard v-else-if="bibleShare" :paper-seed="message.clientRequestId || message.id" :passage="bibleShare" :open-passage="openBiblePassage" :play="playScripture" />
        <BiblePassageShareCard v-else-if="scriptureOnlyCard" :paper-seed="message.clientRequestId || message.id" :passage="scriptureOnlyCard" :open-passage="openBiblePassage" :play="playScripture" />
        <BibleTopicShareCard v-else-if="bibleTopicShare" :paper-seed="message.clientRequestId || message.id" :topic="bibleTopicShare" :open-passage="openBiblePassage" :play="playScripture" />
        <div v-else-if="isMarkdownMessage(message)" class="message-text markdown-render" v-html="markdownMessageHtml(message)"></div>
        <div v-else-if="storyAnnouncementLetters(message)" class="message-text story-announcement-text">
          <span v-for="(letter, index) in storyAnnouncementLetters(message)" :key="index" :style="{ color: letter.color }">{{ letter.text }}</span>
        </div>
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
        <a v-if="!bookShare && linkPreviewFor(message)" class="link-preview-card" :href="linkPreviewFor(message)?.url" target="_blank" rel="noopener noreferrer" @click.stop>
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
