<script setup lang="ts">
import { computed } from "vue";
import { X } from "lucide-vue-next";
import type { ChatRecordItemDTO, ChatRecordPayloadDTO, MessageDTO } from "@shared/types";
import { getToken } from "../../api";
import { compactBytes } from "../../time";
import { chatRecordItemUrl } from "../../messageForward";

const props = defineProps<{ message: MessageDTO }>();
const emit = defineEmits<{ close: [] }>();

const payload = computed(() => {
  const value = props.message.payload as ChatRecordPayloadDTO | undefined;
  return value?.kind === "chat_record" ? value : null;
});

function itemAvatarUrl(path?: string | null) {
  if (!path) return "";
  return path.startsWith("/") ? path : `/avatars/${path}`;
}

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
      <div class="chat-record-body">
        <div v-for="(item, index) in payload?.items || []" :key="index" class="chat-record-item">
          <span class="chat-record-avatar" aria-hidden="true">
            <img v-if="itemAvatarUrl(item.senderAvatarPath)" :src="itemAvatarUrl(item.senderAvatarPath)" alt="" />
            <span v-else>{{ avatarText(item.senderName) }}</span>
          </span>
          <div class="chat-record-item-main">
            <span class="chat-record-meta">
              <strong>{{ item.senderName }}</strong>
              <small>{{ itemTime(item.createdAt) }}</small>
            </span>
            <p v-if="item.type === 'text'" class="chat-record-text">{{ item.content }}</p>
            <img v-else-if="item.type === 'image'" class="chat-record-image" :src="itemUrl(index)" loading="lazy" alt="聊天记录图片" />
            <div v-else class="chat-record-file">
              <template v-if="item.voiceDurationMs">
                <span>[语音] {{ voiceSeconds(item) }}″</span>
                <audio class="chat-record-voice" :src="itemUrl(index)" controls preload="none"></audio>
              </template>
              <template v-else>
                <span class="chat-record-file-name">{{ item.fileName || "文件" }}</span>
                <small v-if="item.fileSize">{{ compactBytes(item.fileSize) }}</small>
                <a class="chat-record-download" :href="`${itemUrl(index)}&download=1`" :download="item.fileName || undefined">下载</a>
              </template>
            </div>
          </div>
        </div>
        <p v-if="!payload?.items?.length" class="chat-record-empty">没有可显示的内容</p>
      </div>
    </div>
  </section>
</template>
