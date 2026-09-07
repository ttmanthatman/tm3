<script setup lang="ts">
import { computed } from "vue";
import type { ChatRecordPayloadDTO, MessageDTO } from "@shared/types";
import { chatRecordPreviewLines } from "../../messageForward";

const props = defineProps<{ message: MessageDTO }>();
const emit = defineEmits<{ open: [message: MessageDTO] }>();

const payload = computed(() => {
  const value = props.message.payload as ChatRecordPayloadDTO | undefined;
  return value?.kind === "chat_record" ? value : null;
});
const previewLines = computed(() => {
  if (!payload.value) return [];
  const lines = chatRecordPreviewLines(payload.value);
  if (payload.value.truncated && lines.length) lines[lines.length - 1] = `${lines[lines.length - 1]} …`;
  return lines;
});
</script>

<template>
  <button v-if="payload" type="button" class="chat-record-card" @click.stop="emit('open', message)">
    <strong class="chat-record-title">{{ payload.title }}</strong>
    <span v-for="(line, index) in previewLines" :key="index" class="chat-record-line">{{ line }}</span>
    <span class="chat-record-footer">聊天记录</span>
  </button>
  <p v-else class="chat-record-invalid">{{ message.content || "这条聊天记录已失效" }}</p>
</template>
