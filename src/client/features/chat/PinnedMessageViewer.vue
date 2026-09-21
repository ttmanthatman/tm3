<script setup lang="ts">
import { CheckCircle2, FileUp, Pin } from "lucide-vue-next";
import type { MessageDTO, PinnedContentBlockDTO } from "@shared/types";
import type { PinnedMediaBlock } from "../messages/useMediaPreview";
import { chainEnded, chainPayload } from "../chain/chain";
import { compactBytes } from "../../time";

defineProps<{
  pinnedText: string;
  pinnedSummary: string;
  blocks: PinnedContentBlockDTO[];
  chain?: MessageDTO | null;
  textContentHtml: (text: string) => string;
  pinnedFileUrl: (block: PinnedMediaBlock) => string;
}>();

const emit = defineEmits<{
  close: [];
  ack: [];
  join: [];
  openImage: [block: PinnedMediaBlock];
}>();
</script>

<template>
  <section
    class="modal-shell pinned-view-shell"
    role="dialog"
    aria-modal="true"
    aria-label="置顶消息"
    @click.self="emit('close')"
  >
    <div class="pinned-view-modal">
      <header class="pinned-view-head">
        <span class="pinned-view-icon"><Pin :size="17" /></span>
        <span>
          <strong>{{ pinnedText }}</strong>
          <small>{{ pinnedSummary }}</small>
        </span>
      </header>
      <div class="pin-card-body pinned-view-body">
        <template v-for="block in blocks" :key="block.id">
          <p v-if="block.type === 'text'" v-html="textContentHtml(block.text)"></p>
          <button
            v-else-if="block.type === 'image'"
            class="image-preview-button pinned-image-button"
            @click.stop="emit('openImage', block)"
          >
            <img
              class="chat-image pinned-image"
              :src="pinnedFileUrl(block)"
              loading="lazy"
              decoding="async"
              alt="置顶图片"
            />
          </button>
          <a
            v-else
            class="file-card pinned-file-card"
            :href="pinnedFileUrl(block)"
            target="_blank"
            rel="noopener noreferrer"
            @click.stop
          >
            <FileUp :size="24" />
            <span>
              <strong>{{ block.fileName }}</strong>
              <small>{{ block.fileSize ? compactBytes(block.fileSize) : "文件" }}</small>
            </span>
          </a>
        </template>
      </div>
      <footer class="pinned-view-actions">
        <span v-if="chain && chainEnded(chain)" class="pinned-chain-status">接龙已结束</span>
        <span v-else-if="chain" class="pinned-chain-status">已有 {{ chainPayload(chain).participants.length }} 人接龙</span>
        <button v-if="chain && !chainEnded(chain)" class="primary-btn" @click="emit('join')">参与接龙</button>
        <button class="primary-btn pinned-ack-btn" @click="emit('ack')">
          <CheckCircle2 :size="17" />朕知道了
        </button>
      </footer>
    </div>
  </section>
</template>
