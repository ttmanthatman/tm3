<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { X } from "lucide-vue-next";
import type { ChatRecordItemDTO, ChatRecordPayloadDTO, MessageDTO } from "@shared/types";
import { authHeaders, getToken } from "../../api";
import { compactBytes } from "../../time";
import { chatRecordItemUrl } from "../../messageForward";
import AvatarImage from "../../components/ui/AvatarImage.vue";
import TransferProgressBar from "../../components/ui/TransferProgressBar.vue";
import { fetchBlobWithProgress, saveBlob, type TransferProgress } from "../files/transfer";

const props = defineProps<{ message: MessageDTO }>();
const emit = defineEmits<{ close: [] }>();

const brokenItems = ref<Set<number>>(new Set());
const downloadTransfer = ref<(TransferProgress & { label: string }) | null>(null);
let downloadAbort: AbortController | null = null;

function markItemBroken(index: number) {
  const next = new Set(brokenItems.value);
  next.add(index);
  brokenItems.value = next;
}

const payload = computed(() => {
  const value = props.message.payload as ChatRecordPayloadDTO | undefined;
  return value?.kind === "chat_record" ? value : null;
});

function avatarText(name: string) {
  return (name || "?").slice(0, 1).toUpperCase();
}

function itemTime(value: string) {
  if (!value) return "";
  return new Date(value).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function itemUrl(index: number) {
  return chatRecordItemUrl(props.message.id, index, getToken());
}

function voiceSeconds(item: ChatRecordItemDTO) {
  return Math.max(1, Math.round((item.voiceDurationMs || 0) / 1000));
}

function cancelDownload() {
  downloadAbort?.abort();
  downloadAbort = null;
  downloadTransfer.value = null;
}

async function downloadItem(item: ChatRecordItemDTO, index: number) {
  downloadAbort?.abort();
  const controller = new AbortController();
  downloadAbort = controller;
  const fileName = item.fileName || "附件";
  const label = `正在下载 ${fileName}`;
  downloadTransfer.value = { label, loaded: 0, total: null, percent: null };
  try {
    const blob = await fetchBlobWithProgress(`${itemUrl(index)}&download=1`, {
      headers: authHeaders(),
      signal: controller.signal,
      onProgress: (progress) => {
        if (downloadAbort === controller) downloadTransfer.value = { ...progress, label };
      }
    });
    if (downloadAbort === controller) saveBlob(blob, fileName);
  } catch (error) {
    if (!controller.signal.aborted) alert(error instanceof Error ? error.message : "下载失败");
  } finally {
    if (downloadAbort === controller) {
      downloadAbort = null;
      downloadTransfer.value = null;
    }
  }
}

onBeforeUnmount(cancelDownload);
</script>

<template>
  <section class="modal-shell" role="dialog" aria-modal="true" :aria-label="payload?.title || '聊天记录'" @click.self="emit('close')">
    <div class="small-modal chat-record-view">
      <header class="modal-head">
        <div class="chat-record-view-head">
          <strong>{{ payload?.title || "聊天记录" }}</strong>
          <small v-if="payload">共 {{ payload.itemCount }} 条</small>
        </div>
        <button class="icon-btn" type="button" aria-label="关闭聊天记录" @click="emit('close')"><X :size="20" /></button>
      </header>
      <div v-if="downloadTransfer" class="chat-record-transfer" role="status">
        <TransferProgressBar
          :label="downloadTransfer.label"
          :loaded="downloadTransfer.loaded"
          :total="downloadTransfer.total"
          :percent="downloadTransfer.percent"
        />
        <button type="button" @click="cancelDownload">取消</button>
      </div>
      <div class="chat-record-body">
        <div v-for="(item, index) in payload?.items || []" :key="index" class="chat-record-item">
          <span class="chat-record-avatar" aria-hidden="true">
            <AvatarImage :path="item.senderAvatarPath">
              <span>{{ avatarText(item.senderName) }}</span>
            </AvatarImage>
          </span>
          <div class="chat-record-item-main">
            <span class="chat-record-meta">
              <strong>{{ item.senderName }}</strong>
              <small>{{ itemTime(item.createdAt) }}</small>
            </span>
            <p v-if="item.type === 'text'" class="chat-record-text">{{ item.content }}</p>
            <template v-else-if="item.type === 'image'">
              <p v-if="brokenItems.has(index)" class="chat-record-broken">转发附件已被删除</p>
              <img v-else class="chat-record-image" :src="itemUrl(index)" loading="lazy" alt="聊天记录图片" @error="markItemBroken(index)" />
            </template>
            <div v-else class="chat-record-file">
              <template v-if="item.voiceDurationMs">
                <p v-if="brokenItems.has(index)" class="chat-record-broken">转发附件已被删除</p>
                <template v-else>
                  <span>[语音] {{ voiceSeconds(item) }}″</span>
                  <audio class="chat-record-voice" :src="itemUrl(index)" controls preload="none" @error="markItemBroken(index)"></audio>
                </template>
              </template>
              <template v-else>
                <span class="chat-record-file-name">{{ item.fileName || "文件" }}</span>
                <small v-if="item.fileSize">{{ compactBytes(item.fileSize) }}</small>
                <button class="chat-record-download" type="button" :disabled="!!downloadTransfer" @click="downloadItem(item, index)">下载</button>
              </template>
            </div>
          </div>
        </div>
        <p v-if="!payload?.items?.length" class="chat-record-empty">没有可显示的内容</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.chat-record-transfer {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--line);
  background: #f8fafc;
}

.chat-record-transfer :deep(.transfer-progress) {
  width: 100%;
}

.chat-record-transfer button {
  min-height: 32px;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 0 12px;
  background: #fff;
}

.chat-record-download {
  min-height: 30px;
  border: 0;
  padding: 0;
  color: var(--accent-dark);
  background: transparent;
  text-decoration: underline;
}
</style>
