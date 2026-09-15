<script setup lang="ts">
import { defineAsyncComponent } from "vue";
import { ChevronLeft, ChevronRight, Download, X } from "lucide-vue-next";
import type { MessageDTO, MusicScoreDTO, MusicScorePageDTO } from "@shared/types";
import type { PinnedImagePreview } from "./useMediaPreview";

// Same lazy split as App.vue: PdfViewer pulls in pdfjs-dist.
const PdfViewer = defineAsyncComponent(() => import("../../components/PdfViewer.vue"));

defineProps<{
  message: MessageDTO;
  pinnedImage: PinnedImagePreview | null;
  scoreTrack: { scores?: MusicScoreDTO[] } | null;
  scoreEntry: MusicScoreDTO | null | undefined;
  scorePages: MusicScorePageDTO[];
  scorePageIndex: number;
  fileUrl: (message: MessageDTO) => string;
  imagePreviewTransform: () => { transform: string };
  previewImageSrc: () => string;
  isVideoMessage: (message: MessageDTO) => boolean;
  isPdfMessage: (message: MessageDTO) => boolean;
  imageTouchStart: (event: TouchEvent) => void;
  imageTouchMove: (event: TouchEvent) => void;
  imageTouchEnd: () => void;
  imagePointerDown: (event: PointerEvent) => void;
  imagePointerMove: (event: PointerEvent) => void;
  imageWheel: (event: WheelEvent) => void;
}>();

const emit = defineEmits<{
  close: [];
  shiftScore: [delta: number];
  downloadPreview: [];
  downloadFile: [message: MessageDTO];
}>();
</script>

<template>
  <section
    class="modal-shell media-preview-shell"
    :class="{ image: message.type === 'image', score: pinnedImage?.score }"
    @click.self="emit('close')"
  >
    <div
      class="media-preview-modal"
      :class="{
        'image-preview-modal': message.type === 'image',
        'score-preview-modal': pinnedImage?.score
      }"
    >
      <header v-if="message.type !== 'image'" class="modal-head">
        <strong>{{ message.fileName || "图片预览" }}</strong>
      </header>
      <button class="preview-control preview-close" @click="emit('close')" aria-label="关闭预览">
        <X :size="22" />
      </button>
      <button
        class="preview-control preview-download"
        @click.stop="
          message.type === 'image' ? emit('downloadPreview') : emit('downloadFile', message)
        "
        aria-label="下载"
      >
        <Download :size="20" />
      </button>
      <div
        v-if="
          pinnedImage?.score && (scorePages.length > 1 || (scoreTrack?.scores?.length || 0) > 1)
        "
        class="score-preview-pager"
      >
        <template v-if="scorePages.length > 1">
          <button type="button" @click.stop="emit('shiftScore', -1)" aria-label="上一页歌谱">
            <ChevronLeft :size="23" />
          </button>
          <span>{{ scorePageIndex + 1 }} / {{ scorePages.length }}</span>
          <button type="button" @click.stop="emit('shiftScore', 1)" aria-label="下一页歌谱">
            <ChevronRight :size="23" />
          </button>
        </template>
        <span v-if="(scoreTrack?.scores?.length || 0) > 1" class="score-preview-score-name">{{
          scoreEntry?.title
        }}</span>
      </div>
      <div
        class="media-preview-body"
        :class="{ 'image-preview-body': message.type === 'image' }"
        @touchstart="message.type === 'image' && imageTouchStart($event)"
        @touchmove="message.type === 'image' && imageTouchMove($event)"
        @touchend="imageTouchEnd"
        @touchcancel="imageTouchEnd"
        @pointerdown="message.type === 'image' && imagePointerDown($event)"
        @pointermove="message.type === 'image' && imagePointerMove($event)"
        @wheel="message.type === 'image' && imageWheel($event)"
        @click.self="message.type === 'image' && emit('close')"
      >
        <img
          v-if="message.type === 'image'"
          class="media-preview-image"
          :style="imagePreviewTransform()"
          :src="previewImageSrc()"
          alt="图片预览"
          draggable="false"
        />
        <video
          v-else-if="isVideoMessage(message)"
          class="media-preview-video"
          :src="fileUrl(message)"
          controls
          autoplay
          playsinline
          preload="metadata"
        ></video>
        <PdfViewer
          v-else-if="isPdfMessage(message)"
          :src="pinnedImage?.score ? pinnedImage.url : fileUrl(message)"
          :file-name="message.fileName || undefined"
          @close="emit('close')"
        />
      </div>
    </div>
  </section>
</template>
